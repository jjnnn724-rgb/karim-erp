import { z } from 'zod';
import { fetchJson } from './api';
import { getAccessToken } from './auth';
import { arSearchKey, type Employee, type HrDepartment } from './employees';

/**
 * الحضور والانصراف — قراءة فقط من `/api/attendance/range`.
 *
 * العقد منسوخ من `frontend/app/js/v2/data/attendance-repo.js`:
 *   GET `/api/attendance/range?from=YYYY-MM-DD&to=YYYY-MM-DD&limit=N`
 *     → `{ data, total, from, to }`
 *     (الباب الحقيقي في `backend/server.js:1438`؛ القديم `attendance-repo.js:340-352`).
 *     → 400 MISSING_DATES بلا تاريخين، والقراءة لـ`[...SENSITIVE_READ_ROLES,'hr','dept_head']`
 *       أو صلاحية `hr.view`، **ورؤوس الأقسام تُقصى صفوفها على الخادم** نفسه
 *       (`server.js:1445-1452`) — فالخادم هو الحاكم في النطاق، لا الشاشة.
 *   GET `/api/employees` و`/api/hrDepartments` — اسم الموظف واسم قسمه
 *     (`attendance-repo.js:11-14`، `employees-repo.js:100-123`).
 *   GET `/api/hr/leave-workflow` — طلبات الإجازة، لاثبات «معذور» في صندوق
 *     استثناءات اليوم (`leaves-repo.js:127-130`).
 *
 * **الشاشة قراءة فقط**: تسجيل البصمة وتصحيحها واعتماد العذر والاستكمال
 * وباب النواقص كلها كتابة وتبقى في V2 (`attendance-repo.js:1049-1062`).
 *
 * قواعد العرض الموروثة كما هي:
 *  · التواريخ نصوص `YYYY-MM-DD` تُعرض كما وردت (ADR-05) — لا `new Date` على
 *    تاريخ مخزَّن، والحساب كله على أجزاء التاريخ.
 *  · لا مبلغ في هذه الشاشة أصلًا (لا `NUMERIC` ولا دفعة) — فلا تحويل
 *    `Number()` على مال (ADR-04).
 *  · التأخير/الانصراف المبكر/البصمة الناقصة **مستخرَجة** لا مخزَّنة، فلتُعرَض
 *    كنقطةٍ لونية ونصٍّ عربي، والشارة الوحيدة `on_leave` المخزَّنة
 *    (`attendance-repo.js:21-26`).
 */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^(\d{1,2}):(\d{2})$/;

/* ─── المخططات ──────────────────────────────────────────────────────────── */

const idValue = z.union([z.string(), z.number()]).transform((value) => String(value));
const optionalText = z.string().nullable().optional();
const numericText = z.union([z.string(), z.number()]).nullable().optional();

/**
 * صف الحضور كما يرده `/api/attendance/range` — `SELECT * FROM attendance`
 * (`server.js:1453-1457`) مع حقول المرحلة الأولى: `status` و`lateMinutes`
 * و`arrivalLateMinutes` و`earlyLeaveMinutes` (`server.js:1467-1476`).
 * الحقول المجهولة تُترك كما وردت (`passthrough`) فلا تُختلق.
 */
export const attendanceRecordSchema = z
    .object({
        id: idValue,
        employeeId: idValue.nullable().optional(),
        date: optionalText,
        checkIn: optionalText,
        checkOut: optionalText,
        late: z.boolean().nullable().optional(),
        early_leave: z.boolean().nullable().optional(),
        on_leave: z.boolean().nullable().optional(),
        checkin_inferred: z.boolean().nullable().optional(),
        checkout_inferred: z.boolean().nullable().optional(),
        workMinutes: numericText,
        lateMinutes: numericText,
        arrivalLateMinutes: numericText,
        earlyLeaveMinutes: numericText,
        source: optionalText,
        notes: optionalText,
        status: optionalText,
    })
    .passthrough();

export type AttendanceRecordRaw = z.infer<typeof attendanceRecordSchema>;

export const attendanceRangeSchema = z
    .object({
        data: z.array(attendanceRecordSchema),
        total: z.number().nullable().optional(),
        from: optionalText,
        to: optionalText,
    })
    .passthrough();

export type AttendanceRange = {
    rows: AttendanceRecord[];
    total: number;
    from: string;
    to: string;
};

/** طلب إجازة كما يرده `/api/hr/leave-workflow` — نحتاج منه «معذور» فقط. */
export const leaveRequestSchema = z
    .object({
        id: idValue,
        employeeId: idValue.nullable().optional(),
        startDate: optionalText,
        endDate: optionalText,
        status: optionalText,
    })
    .passthrough();

export type LeaveRequest = z.infer<typeof leaveRequestSchema>;

/** الردّ قد يكون مصفوفةً أو `{data}` — كما في `leaves-repo.js:129`. */
const leaveWorkflowSchema = z
    .union([z.array(leaveRequestSchema), z.object({ data: z.array(leaveRequestSchema) }).passthrough()])
    .transform((body) => (Array.isArray(body) ? body : body.data));

/* ─── الأرقام والحقول المستخرَجة ────────────────────────────────────────── */

/** `null` = الحقل غائب — والحضورُ بين الغائب والموجود فرقٌ في الحكم. */
function numOrNull(value: string | number | null | undefined): number | null {
    if (value === null || value === undefined) {
        return null;
    }
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
}

function boolOf(value: boolean | null | undefined): boolean {
    return value === true;
}

/** السجل بعد التطبيع — الأسماء العربية تُحسم في العرض لا هنا. */
export type AttendanceRecord = {
    id: string;
    employeeId: string | null;
    date: string;
    checkIn: string | null;
    checkOut: string | null;
    late: boolean;
    earlyLeave: boolean;
    onLeave: boolean;
    checkinInferred: boolean;
    checkoutInferred: boolean;
    workMinutes: number | null;
    lateMinutes: number | null;
    arrivalLateMinutes: number | null;
    earlyLeaveMinutes: number | null;
    source: string;
    notes: string;
    status: string;
};

/** `attendance-repo.js:116-143` — تطبيع خام بلا اختراع. */
export function attendanceRecordToFacts(raw: AttendanceRecordRaw): AttendanceRecord {
    return {
        id: String(raw.id),
        employeeId: raw.employeeId === null || raw.employeeId === undefined ? null : String(raw.employeeId),
        date: raw.date ? String(raw.date) : '',
        checkIn: raw.checkIn ? String(raw.checkIn) : null,
        checkOut: raw.checkOut ? String(raw.checkOut) : null,
        late: boolOf(raw.late),
        earlyLeave: boolOf(raw.early_leave),
        onLeave: boolOf(raw.on_leave),
        checkinInferred: boolOf(raw.checkin_inferred),
        checkoutInferred: boolOf(raw.checkout_inferred),
        workMinutes: numOrNull(raw.workMinutes),
        lateMinutes: numOrNull(raw.lateMinutes),
        arrivalLateMinutes: numOrNull(raw.arrivalLateMinutes),
        earlyLeaveMinutes: numOrNull(raw.earlyLeaveMinutes),
        source: raw.source ? String(raw.source) : '',
        notes: raw.notes ? String(raw.notes) : '',
        status: raw.status ? String(raw.status) : '',
    };
}

/**
 * الدقائق بين البصمة المعروضة أولًا ثم الثانية (تُ guarding against قيمٍ
 * غريبة مثل `25:43`)، والالتفاف الليلي فقط حين الخروج قبل الدخول، ثم
 * `workMinutes` المخزَّن — الخوارزمية نفسها `attendance-repo.js:74-86`
 * (المنسوخة من `features/hr.js:254-261`).
 */
export function attendanceMinutes(rec: {
    checkIn?: string | null;
    checkOut?: string | null;
    workMinutes?: number | null;
}): number | null {
    const m = String(rec.checkIn || '').match(TIME_RE);
    const o = String(rec.checkOut || '').match(TIME_RE);
    if (m && o) {
        let d = Number(o[1]) * 60 + Number(o[2]) - (Number(m[1]) * 60 + Number(m[2]));
        if (d < 0) {
            d += 24 * 60;
        }
        return Math.max(0, d);
    }
    if (rec.workMinutes !== null && rec.workMinutes !== undefined && Number.isFinite(rec.workMinutes)) {
        return Math.max(0, rec.workMinutes);
    }
    return null;
}

/**
 * المرحلة 1 (2026-11-07): `lateMinutes` المحسوب من عجز ساعات الوردية هو
 * الحاكم حين يصل، والعلم المخزَّن وحده لا يقرر — `attendance-repo.js:94-97`.
 */
export function rowLateNow(rec: { lateMinutes?: number | null; late?: boolean }): boolean {
    if (rec.lateMinutes !== null && rec.lateMinutes !== undefined) {
        return rec.lateMinutes > 0;
    }
    return rec.late === true;
}

/** `attendance-repo.js:99-106`: من أكمل ورديته يظهر «حاضر» ولو حُفظ عليه
 *  `early_leave` قديم. */
export function rowEarlyNow(rec: {
    lateMinutes?: number | null;
    arrivalLateMinutes?: number | null;
    earlyLeaveMinutes?: number | null;
    earlyLeave?: boolean;
}): boolean {
    if (rec.lateMinutes !== null && rec.lateMinutes !== undefined) {
        return (
            rec.lateMinutes > 0 &&
            !(rec.arrivalLateMinutes !== null && rec.arrivalLateMinutes !== undefined && rec.arrivalLateMinutes > 0) &&
            rec.earlyLeaveMinutes !== null &&
            rec.earlyLeaveMinutes !== undefined &&
            rec.earlyLeaveMinutes > 0
        );
    }
    return rec.earlyLeave === true;
}

/* ─── الصفّ للعرض ───────────────────────────────────────────────────────── */

export type AttendanceState = 'present' | 'late' | 'early' | 'missing' | 'leave' | 'none';

/** `attendance-repo.js:146-149` — تسميات الحالات كما في القديم. */
export const ATTENDANCE_STATE_AR: Record<AttendanceState, string> = {
    present: 'حاضر',
    late: 'متأخر',
    early: 'انصراف مبكر',
    missing: 'بصمة ناقصة',
    leave: 'إجازة',
    none: 'لا بصمات',
};

/** `attendance-repo.js:1005-1015` — تسميات المصدر؛ ومصدرٌ جديد يُقرأ خامًا
 *  لا يُترجم إلى «يدوي» كذبًا. */
export const ATTENDANCE_SOURCE_AR: Record<string, string> = {
    device: 'بصمة',
    qr: 'QR',
    portal: 'كاميرا التطبيق',
    backfill: 'أرشيف',
    builder: 'محرّك الجلسات (آلي)',
    repair: 'إصلاح آلي',
    manual: 'إدخال يدوي',
    api: 'واجهة API',
};

export function sourceLabelAr(source: string): string {
    const value = String(source || '');
    if (!value || value === '—') {
        return '—';
    }
    return ATTENDANCE_SOURCE_AR[value] ?? value;
}

export type AttendanceRow = {
    id: string;
    employeeId: string;
    employee: string;
    nameResolved: boolean;
    dept: string;
    deptCode: string;
    deptResolved: boolean;
    date: string;
    in: string;
    out: string;
    minutes: number | null;
    source: string;
    sourceLabel: string;
    state: AttendanceState;
    stateLabel: string;
};

/**
 * `attendance-repo.js:116-144` حرفيًا: اسمٌ موظَّفٍ أو `#id` إذا لم تُحلَّ
 * الهوية (وهي حقيقة عن الصلة لا اسمٌ يُخمَّن)، وقسمٌ باسمه أو بكوده
 * المخزَّن، والحالة مشتقّة بالترتيب نفسه.
 */
export function attendanceToRow(
    rec: AttendanceRecord,
    empById: ReadonlyMap<string, Employee> = new Map(),
    deptByCode: ReadonlyMap<string, HrDepartment> = new Map(),
): AttendanceRow {
    const emp = empById.get(String(rec.employeeId));
    const deptCode = emp && emp.department !== undefined && emp.department !== null ? String(emp.department) : '';
    const dept = deptByCode.get(deptCode);
    const hasIn = Boolean(String(rec.checkIn || '').match(TIME_RE));
    const hasOut = Boolean(String(rec.checkOut || '').match(TIME_RE));
    let state: AttendanceState = 'present';
    if (rec.onLeave) {
        state = 'leave';
    } else if (!hasIn && !hasOut) {
        state = 'none';
    } else if (rowLateNow(rec)) {
        state = rowEarlyNow(rec) ? 'early' : 'late';
    } else if (rowEarlyNow(rec)) {
        state = 'early';
    } else if (hasIn !== hasOut) {
        state = 'missing';
    }
    const source = rec.source ? String(rec.source) : '—';
    return {
        id: rec.id,
        employeeId: rec.employeeId === null ? '' : String(rec.employeeId),
        employee: emp?.name ? String(emp.name) : `#${rec.employeeId ?? '؟'}`,
        nameResolved: Boolean(emp?.name),
        dept: dept?.name ? String(dept.name) : deptCode || '—',
        deptCode,
        deptResolved: Boolean(dept?.name),
        date: String(rec.date || ''),
        in: hasIn ? String(rec.checkIn) : '—',
        out: hasOut ? String(rec.checkOut) : '—',
        minutes: attendanceMinutes(rec),
        source,
        sourceLabel: sourceLabelAr(source),
        state,
        stateLabel: ATTENDANCE_STATE_AR[state],
    };
}

/* ─── العدّ والمؤشرات ───────────────────────────────────────────────────── */

/** `attendance-repo.js:152-158` — عدّ لكل حالة، مشتقٌّ لا مقروء. */
export function summarizeAttendance(rows: readonly AttendanceRow[]): Record<AttendanceState, number> {
    const counts: Record<AttendanceState, number> = {
        present: 0,
        late: 0,
        early: 0,
        missing: 0,
        leave: 0,
        none: 0,
    };
    for (const row of rows) {
        counts[row.state] += 1;
    }
    return counts;
}

/**
 * `attendance-repo.js:177-186`: النسبة تحتاج مقامًا حقيقيًا — بلا سجلات
 * تعترف بذلك ولا تطبع «0%» من لا شيء.
 */
export function sharePill(
    count: number,
    base: number,
    label: string,
): { text: string; on: boolean; aria: string; label: string } {
    if (!(base > 0)) {
        return { text: '—', on: false, aria: `لا سجلات في الفترة — لا نسبة تُحسب لـ${label}`, label };
    }
    const pct = (count / base) * 100;
    return {
        text: `${pct.toFixed(1)}%`,
        on: true,
        aria: `${label}: ${count} من ${base} سجلًا (${pct.toFixed(1)}%)`,
        label,
    };
}

/**
 * `attendance-repo.js:190-198`: قائمة المرشّحات تُبنى من الصفوف المحمّلة
 * نفسها، لا من قائمة أقسامٍ ثابتة.
 */
export function distinctValues(rows: readonly AttendanceRow[], key: 'dept' | 'date'): string[] {
    const set = new Set<string>();
    for (const row of rows) {
        const value = row[key];
        if (value === undefined || value === null || value === '' || value === '—') {
            continue;
        }
        set.add(String(value));
    }
    return [...set].sort((a, b) => a.localeCompare(b, 'ar'));
}

/** `attendance-repo.js:200-202`. */
export function countDistinct(rows: readonly AttendanceRow[], key: 'employeeId'): number {
    const set = new Set<string>();
    for (const row of rows) {
        if (row[key]) {
            set.add(String(row[key]));
        }
    }
    return set.size;
}

/**
 * `attendance-repo.js:233-244`: متوسط العمل على السجلات التي لها دخولٌ
 * وخروج معًا فقط — السجل الناقص يُستثنى من المتوسط ويبقى محسوبًا في شريحة
 * «بصمة ناقصة»؛ فال Facts لا يلغيان بعضهما.
 */
export function averageWorked(rows: readonly AttendanceRow[]): {
    text: string;
    minutes: number | null;
    base: number;
    hint: string;
} {
    const done = rows.filter((row) => row.minutes !== null && Number.isFinite(row.minutes));
    if (!done.length) {
        return { text: '—', minutes: null, base: 0, hint: 'لا سجل فيه دخول وخروج معًا في الفترة' };
    }
    const total = done.reduce((sum, row) => sum + (row.minutes ?? 0), 0);
    const minutes = Math.round(total / done.length);
    return {
        text: `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`,
        minutes,
        base: done.length,
        hint: `متوسط ${done.length} سجل مكتمل`,
    };
}

export type AttendanceKpi = {
    id: string;
    label: string;
    en: string;
    value: string;
    unit: string;
    hint: string;
    pill: { text: string; on: boolean; aria: string; label: string };
};

/**
 * `attendance-repo.js:249-276`: ستة أرقام قرار — النسبة تُؤخذ على **نطاق
 * العرض** لا على الفترة كلها، فتصفيةٌ لا تقرأ كأنها الكل.
 */
export function buildAttendanceKpis(rows: readonly AttendanceRow[], opts: { scope?: string } = {}): AttendanceKpi[] {
    const counts = summarizeAttendance(rows);
    const total = rows.length;
    const days = new Set(rows.map((row) => row.date).filter(Boolean)).size;
    const avg = averageWorked(rows);
    const scope = opts.scope || 'سجلات الفترة';
    const pill = (count: number, label: string) => sharePill(count, total, label);
    return [
        {
            id: 'total',
            label: 'إجمالي السجلات',
            en: 'Records',
            value: String(total),
            unit: '',
            hint: `${days} يومًا · ${countDistinct(rows, 'employeeId')} موظفًا`,
            pill: pill(total, 'إجمالي السجلات'),
        },
        {
            id: 'present',
            label: 'حاضر',
            en: 'On time',
            value: String(counts.present),
            unit: '',
            hint: 'دخول وخروج بلا تأخير مسجّل',
            pill: pill(counts.present, 'حاضر'),
        },
        {
            id: 'late',
            label: 'متأخر',
            en: 'Late',
            value: String(counts.late),
            unit: '',
            hint: 'علامة التأخير كما وردت من البصمة',
            pill: pill(counts.late, 'متأخر'),
        },
        {
            id: 'early',
            label: 'انصراف مبكر',
            en: 'Early leave',
            value: String(counts.early),
            unit: '',
            hint: 'الخروج قبل نهاية الوردية',
            pill: pill(counts.early, 'انصراف مبكر'),
        },
        {
            id: 'missing',
            label: 'بصمة ناقصة',
            en: 'Missing punch',
            value: String(counts.missing),
            unit: '',
            hint: 'دخول بلا خروج أو العكس',
            pill: pill(counts.missing, 'بصمة ناقصة'),
        },
        {
            id: 'avg',
            label: 'متوسط العمل',
            en: 'Avg worked',
            value: avg.text,
            unit: 'س:د',
            hint: avg.hint,
            pill: {
                text: String(avg.base),
                on: avg.base > 0,
                aria: `متوسط محسوب على ${avg.base} سجل من ${total} في ${scope}`,
                label: 'سجل مكتمل',
            },
        },
    ];
}

/** `attendance-repo.js:279-286` — الحالتان اللتان تتركهما المؤشرات للوسيلة. */
export function buildAttendanceLegend(rows: readonly AttendanceRow[]): {
    key: string;
    label: string;
    tone: string;
    count: number;
    pill: { text: string; on: boolean; aria: string; label: string };
}[] {
    const counts = summarizeAttendance(rows);
    const total = rows.length;
    return [
        {
            key: 'leave',
            label: 'إجازة مسجّلة',
            tone: 'success',
            count: counts.leave,
            pill: sharePill(counts.leave, total, 'إجازة'),
        },
        {
            key: 'none',
            label: 'لا بصمات',
            tone: 'neutral',
            count: counts.none,
            pill: sharePill(counts.none, total, 'لا بصمات'),
        },
    ];
}

/**
 * `attendance-repo.js:289-293`: مرشّحات الشاشة — '' أو 'all' تعني «مطفأ».
 * المجموع والنطاق كما هما: المرشّح بالقسم يطابق `row.dept` (الاسم بعد
 * الصلة، أو الكود الخام حين تعذّرت).
 */
export function applyAttendanceFilters(
    rows: readonly AttendanceRow[],
    filters: { dept?: string; state?: string } = {},
): AttendanceRow[] {
    const dept = filters.dept ?? '';
    const state = filters.state ?? '';
    const deptOn = Boolean(dept) && dept !== 'all';
    const stateOn = Boolean(state) && state !== 'all';
    return rows.filter((row) => (!deptOn || String(row.dept) === String(dept)) && (!stateOn || row.state === state));
}

/* ─── البصمات لكل يوم ───────────────────────────────────────────────────── */

export type PunchBar = {
    date: string;
    label: string;
    records: number;
    inCount: number;
    outCount: number;
    late: number;
};

/**
 * `attendance-repo.js:210-226`: التجميع على **نصّ التاريخ المخزَّن** لا على
 * تاريخٍ مُحلَّل — فلغةٌ محلية غيرها صامتة عن الصف الذي تلخّصه. ويُبقي
 * آخر `maxDays` يومًا (14) لأن الأعمدة تبقى مقروءة، الأقدم أولًا.
 */
export function buildPunchBars(
    rows: readonly AttendanceRow[],
    { maxDays = 14 }: { maxDays?: number } = {},
): PunchBar[] {
    const byDay = new Map<string, PunchBar>();
    for (const row of rows) {
        const day = String(row.date || '');
        if (!DATE_RE.test(day)) {
            continue;
        }
        const entry = byDay.get(day) || { date: day, label: '', records: 0, inCount: 0, outCount: 0, late: 0 };
        entry.records += 1;
        if (row.in && row.in !== '—') {
            entry.inCount += 1;
        }
        if (row.out && row.out !== '—') {
            entry.outCount += 1;
        }
        if (row.state === 'late') {
            entry.late += 1;
        }
        byDay.set(day, entry);
    }
    const bars = [...byDay.values()]
        .sort((a, b) => a.date.localeCompare(b.date))
        .map((day) => ({ ...day, label: `${day.date.slice(8, 10)}/${day.date.slice(5, 7)}` }));
    return maxDays > 0 ? bars.slice(-maxDays) : bars;
}

/* ─── التقويم: نصوص لا تواريخ مُحلَّلة ──────────────────────────────────── */

function pad(value: number): string {
    return String(value).padStart(2, '0');
}

/** أجزاء التاريخ من نصّ `YYYY-MM-DD` — بلا `new Date(string)` (ADR-05). */
function dateParts(iso: string): { year: number; month: number; day: number } | null {
    const text = String(iso || '');
    if (!DATE_RE.test(text)) {
        return null;
    }
    const year = Number(text.slice(0, 4));
    const month = Number(text.slice(5, 7));
    const day = Number(text.slice(8, 10));
    if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
        return null;
    }
    return { year, month, day };
}

/** يومٌ بعد (أو قبل) يومًا — حسابٌ على أجزاء UTC، فلا انزياح ولا تفسير. */
export function shiftIsoDays(iso: string, days: number): string {
    const parts = dateParts(iso);
    if (!parts) {
        return '';
    }
    const stamp = Date.UTC(parts.year, parts.month - 1, parts.day) + days * 86400000;
    const date = new Date(stamp);
    return `${String(date.getUTCFullYear())}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

/** `attendance-repo.js:330-334`: عدد أيام التقويم بين تاريخين شاملين. */
export function spanDays(fromIso: string, toIso: string): number {
    const from = dateParts(fromIso);
    const to = dateParts(toIso);
    if (!from || !to) {
        return 0;
    }
    const diff = Date.UTC(to.year, to.month - 1, to.day) - Date.UTC(from.year, from.month - 1, from.day);
    return Math.max(0, Math.round(diff / 86400000) + 1);
}

/**
 * `attendance-repo.js:312-314`: اليوم على **تقويم الجهاز** — نفس أساس
 * الشاشة القديمة، فتتطابق فترتان بين الواجهتين.
 */
export function todayIso(now: Date = new Date()): string {
    if (Number.isNaN(now.getTime())) {
        return '';
    }
    return `${String(now.getFullYear())}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** دقائق الساعة الآن — لعمود «حتى الآن» في بصمة ناقصة اليوم. */
export function nowLocalMinutes(now: Date = new Date()): number {
    return now.getHours() * 60 + now.getMinutes();
}

/** الفترات السريعة — `attendance-repo.js:297-301`. */
export const PERIODS = {
    today: { seg: 'اليوم', days: 1 },
    week: { seg: '٧ أيام', days: 7 },
    month: { seg: '٣٠ يومًا', days: 30 },
} as const;

export type AttendancePeriodKind = keyof typeof PERIODS;

/** `attendance-repo.js:320-327`: مدى شامل لنهايةٍ معطاة. */
export function periodRange(
    kind: AttendancePeriodKind,
    endIso: string = todayIso(),
): { from: string; to: string } | null {
    const period = PERIODS[kind];
    if (!period) {
        return null;
    }
    const from = shiftIsoDays(endIso, -(period.days - 1));
    if (!from || !DATE_RE.test(from)) {
        return null;
    }
    return { from, to: endIso };
}

export const WEEKDAY_AR = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];

/** 0=الأحد … 6=السبت — من أجزاء التاريخ لا من نصّ مُحلَّل. */
export function weekdayIndex(iso: string): number {
    const parts = dateParts(iso);
    if (!parts) {
        return -1;
    }
    return new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay();
}

export function weekdayAr(iso: string): string {
    const index = weekdayIndex(iso);
    return index < 0 ? '—' : (WEEKDAY_AR[index] ?? '—');
}

/* ─── الإجازات المعتمدة ─────────────────────────────────────────────────── */

/** `attendance-repo.js:805-811`: عذرٌ أو إجازةٌ معتمدة تغطي هذا اليوم لهذا الموظف. */
export function isExcusedByLeave(leaves: readonly LeaveRequest[], employeeId: string, date: string): boolean {
    const day = String(date || '');
    return leaves.some(
        (leave) =>
            String(leave.status) === 'approved' &&
            String(leave.employeeId) === String(employeeId) &&
            String(leave.startDate) <= day &&
            day <= String(leave.endDate),
    );
}

/* ─── استثناءات اليوم ──────────────────────────────────────────────────── */

export type TodayException = {
    employeeId: string;
    employeeName: string;
    department: string;
    type: 'absent' | 'late' | 'early' | 'missing';
    label: string;
    tone: string;
    detail: string;
    hours: string;
    excused: boolean;
};

/** `attendance-repo.js:909-911` — تسميات ونغمات الاستثناءات. */
export const EXCEPTION_TYPES_AR: Record<TodayException['type'], string> = {
    absent: 'لم يحضر',
    late: 'متأخر',
    early: 'انصراف مبكر',
    missing: 'بصمة ناقصة',
};

export const EXCEPTION_TONES: Record<TodayException['type'], string> = {
    absent: 'danger',
    late: 'warning',
    early: 'warning',
    missing: 'info',
};

/**
 * `attendance-repo.js:923-939` حرفيًا: بصمة ناقصة اليوم تُحسب «حتى الآن»،
 * وفي يومٍ مضت تُحسب صفرًا لأن لا نهاية لها، وخروجٌ بلا دخول لا يُحسب
 * أصلًا ('—') فالحساب يحتاج الطرفين.
 */
export function workedHoursText(
    rec: { checkIn?: string | null; checkOut?: string | null; date?: string } | null,
    { todayStr = '', nowMinutes = null }: { todayStr?: string; nowMinutes?: number | null } = {},
): string {
    const today = DATE_RE.test(String(todayStr || '')) ? String(todayStr) : todayIso();
    if (!rec || (!rec.checkIn && !rec.checkOut)) {
        return '0.0';
    }
    const a = toMinutes(rec.checkIn);
    if (a === null) {
        return '—';
    }
    let b = toMinutes(rec.checkOut);
    let fromClock = false;
    if (b === null) {
        const live = String(rec.date || today) === today && nowMinutes !== null;
        if (live) {
            b = Number(nowMinutes);
            fromClock = true;
        } else {
            b = a;
        }
    }
    if (fromClock && b < a) {
        return '—';
    }
    let diff = b - a;
    if (diff < 0) {
        diff += 1440;
    }
    return (diff / 60).toFixed(2);
}

/** HH:MM → دقائق، و`null` لأي نصٍّ ليس وقتًا. */
export function toMinutes(value: string | null | undefined): number | null {
    const match = String(value || '').match(TIME_RE);
    return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

/**
 * `attendance-repo.js:948-997`: صندوق اليوم — غياب/تأخير/انصراف مبكر/بصمة
 * ناقصة في مكان واحد، بنفس ترتيب الفحوص ونصوص التفاصيل. `full` يقرر هل
 * يُشتق الغياب من دليل الموظفين النشطين أم من سجلات اليوم المحمّلة وحدها
 * (من لا يرى إلا قسمه لا يُشتق له غياب بقية الأقسام).
 */
export function buildTodayExceptions({
    records = [],
    employees = [],
    leaves = [],
    deptByCode = new Map<string, HrDepartment>(),
    todayStr = '',
    nowMinutes = null,
    full = true,
}: {
    records?: readonly AttendanceRecord[];
    employees?: readonly Employee[];
    leaves?: readonly LeaveRequest[];
    deptByCode?: ReadonlyMap<string, HrDepartment>;
    todayStr?: string;
    nowMinutes?: number | null;
    full?: boolean;
}): { rows: TodayException[]; date: string; weekday: string; excused: number; open: number } {
    const today = DATE_RE.test(String(todayStr || '')) ? String(todayStr) : todayIso();
    const todays = records.filter((record) => record.date === today);
    const active = employees.filter((employee) => employee && employee.status === 'active');
    const rows: TodayException[] = [];

    const deptLabel = (employee: Employee): string => {
        const code = String(employee.department ?? '');
        const department = deptByCode.get(code);
        return department?.name ? String(department.name) : code || '—';
    };

    const classify = (employee: Employee, rec: AttendanceRecord | null): void => {
        let type: TodayException['type'] | null = null;
        let detail = '';
        if (!rec || (!rec.checkIn && !rec.checkOut)) {
            type = 'absent';
            detail = 'لا بصمات اليوم';
        } else if (rec.checkIn && !rec.checkOut && !rec.checkoutInferred) {
            type = 'missing';
            detail = `حضور ${rec.checkIn} بلا انصراف`;
        } else if (!rec.checkIn && rec.checkOut) {
            type = 'missing';
            detail = `انصراف ${rec.checkOut} بلا حضور`;
        } else if (rowLateNow(rec)) {
            const earlyOnly = rowEarlyNow(rec);
            type = earlyOnly ? 'early' : 'late';
            detail = earlyOnly ? `انصراف ${rec.checkOut}` : `حضور ${rec.checkIn}`;
        } else if (rowEarlyNow(rec)) {
            type = 'early';
            detail = `انصراف ${rec.checkOut}`;
        }
        if (!type) {
            return;
        }
        const excused = isExcusedByLeave(leaves, String(employee.id), today);
        rows.push({
            employeeId: String(employee.id),
            employeeName: employee.name ? String(employee.name) : `#${employee.id}`,
            department: deptLabel(employee),
            type,
            label: EXCEPTION_TYPES_AR[type],
            tone: EXCEPTION_TONES[type],
            detail,
            hours: workedHoursText(rec, { todayStr: today, nowMinutes }),
            excused,
        });
    };

    const recByEmp = new Map(todays.map((record) => [String(record.employeeId), record]));
    if (full) {
        for (const employee of active) {
            classify(employee, recByEmp.get(String(employee.id)) ?? null);
        }
    } else {
        const byId = new Map(active.map((employee) => [String(employee.id), employee]));
        for (const record of todays) {
            const employee = byId.get(String(record.employeeId));
            if (employee) {
                classify(employee, record);
            }
        }
    }

    return {
        rows,
        date: today,
        weekday: weekdayAr(today),
        excused: rows.filter((row) => row.excused).length,
        open: rows.filter((row) => !row.excused).length,
    };
}

/* ─── الأدوار ───────────────────────────────────────────────────────────── */

/** `attendance-repo.js:383-384` (ADMIN_ROLES في hr-routes.js:15). */
export const ATT_ADMIN_ROLES = ['admin', 'hr', 'manager'];

/**
 * `attendance-repo.js:418-420`: من يقرأ سجلات الفترة كلها يشتق الغياب من
 * دليل الموظفين؛ ومن لا يقرأ إلا قسمه تبقى سجلاته المحمّلة مصدر الحقيقة.
 */
export function seesFullPeriod(role: string): boolean {
    return ATT_ADMIN_ROLES.includes(String(role || ''));
}

/* ─── البحث ─────────────────────────────────────────────────────────────── */

/**
 * بحثٌ كل كلمة فيه لازم تلاقي موضعًا (AND) — كما في `weight.ts`. المطابقة
 * الخام أولًا ثم المطابقة **بعد تطبيع الحروف العربية** (`arSearchKey`)،
 * والصفوف التي ظهرت بالتطبيع فقط تُعلَن للمستخدم فلا يظنّ أنها weren't there.
 */
function tokenScore(token: string, row: AttendanceRow): { score: number; folded: boolean } {
    const raw = token.toLowerCase();
    const key = arSearchKey(token);
    const fields = [row.employee, row.dept, row.date, row.sourceLabel, row.stateLabel];
    if (raw && fields.some((field) => field.toLowerCase().includes(raw))) {
        return { score: 2, folded: false };
    }
    if (key && fields.some((field) => arSearchKey(field).includes(key))) {
        return { score: 1, folded: true };
    }
    return { score: 0, folded: false };
}

export type AttendanceSearch = {
    rows: AttendanceRow[];
    matched: boolean;
    folded: boolean;
    hits: number;
};

export function searchAttendanceRows(rows: readonly AttendanceRow[], query: string): AttendanceSearch {
    const raw = String(query ?? '').trim();
    if (!raw) {
        return { rows: [...rows], matched: false, folded: false, hits: rows.length };
    }
    const tokens = raw.split(/\s+/).filter(Boolean);
    const kept: { row: AttendanceRow; folded: boolean }[] = [];
    for (const row of rows) {
        let folded = false;
        let matchedAll = true;
        for (const token of tokens) {
            const hit = tokenScore(token, row);
            if (hit.score === 0) {
                matchedAll = false;
                break;
            }
            if (hit.folded) {
                folded = true;
            }
        }
        if (matchedAll) {
            kept.push({ row, folded });
        }
    }
    return {
        rows: kept.map((item) => item.row),
        matched: true,
        folded: kept.some((item) => item.folded),
        hits: kept.length,
    };
}

/* ─── الجلب ─────────────────────────────────────────────────────────────── */

export const ATTENDANCE_RANGE_LIMIT = 30000;

/** `attendance-repo.js:340-352`: نفس المسار ونفسParameters الثلاثة. */
export function attendanceRangePath(from: string, to: string, limit: number = ATTENDANCE_RANGE_LIMIT): string {
    const capped = Math.min(Number(limit) || ATTENDANCE_RANGE_LIMIT, 50000);
    return `/api/attendance/range?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&limit=${String(capped)}`;
}

export async function fetchAttendanceRange({
    from,
    to,
    limit = ATTENDANCE_RANGE_LIMIT,
    signal,
}: {
    from: string;
    to: string;
    limit?: number;
    signal?: AbortSignal;
}): Promise<AttendanceRange> {
    if (!DATE_RE.test(String(from || '')) || !DATE_RE.test(String(to || ''))) {
        throw new Error('حدّد تاريخ البداية والنهاية (YYYY-MM-DD)');
    }
    if (String(from) > String(to)) {
        throw new Error('تاريخ البداية بعد تاريخ النهاية');
    }
    const body = await fetchJson(
        attendanceRangeSchema,
        attendanceRangePath(from, to, limit),
        getAccessToken(),
        signal ? { signal } : {},
    );
    return {
        rows: body.data.map(attendanceRecordToFacts),
        total: body.total === null || body.total === undefined ? body.data.length : body.total,
        from,
        to,
    };
}

/** `leaves-repo.js:127-130` — نفس الباب الذي تقرأه الشاشة القديمة. */
export async function fetchAttendanceLeaves(signal?: AbortSignal): Promise<LeaveRequest[]> {
    return fetchJson(leaveWorkflowSchema, '/api/hr/leave-workflow', getAccessToken(), signal ? { signal } : {});
}

/* ─── تصدير CSV (يفتح في Excel مباشرة بترميز UTF-8 BOM) ───────────────── */

function csvCell(value: string): string {
    const text = String(value ?? '');
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** التصدير من الصفوف الظاهرة نفسها — ما تراه هو ما يُصدَّر. */
export function attendanceCsv(rows: readonly AttendanceRow[]): string {
    const header = ['الموظف', 'القسم', 'التاريخ', 'الدخول', 'الخروج', 'الدقائق', 'المصدر', 'الحالة'];
    const body = rows.map((row) => [
        row.employee,
        row.dept,
        row.date,
        row.in,
        row.out,
        row.minutes === null ? '' : String(row.minutes),
        row.sourceLabel,
        row.stateLabel,
    ]);
    return [header, ...body].map((line) => line.map(csvCell).join(',')).join('\r\n');
}
