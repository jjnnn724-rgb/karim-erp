import { z } from 'zod';
import { fetchJson } from './api';
import { getAccessToken } from './auth';
import { mainSettingsSchema } from './settings';
import { isWriteRole, writeAck } from './write';

/**
 * كتابة الحضور — الأبواب الخمسة التي كانت في V2 وحده، بعقودها نفسها:
 *
 *   تصحيح/تعبئة سجل   PUT  /api/attendance/:id                     (server.js:2037)
 *   إنشاء سجل ناقص    POST /api/attendance                         (server.js:1780)
 *   عذر إداري/معتمد/تبديل  POST /api/leaveRequests                 (server.js POST leaveRequests)
 *   سجل التدقيق        GET  /api/attendance/audit                  (server.js:1757)
 *   التدقيق الصارم     GET  /api/hr/strict-audit?month=YYYY-MM     (hr-routes.js:409)
 *   الكشف الشهري       GET  /api/hr/attendance/monthly?month=&detail=1 (hr-routes.js:315)
 *
 * قواعد V2 المنقولة حرفيًّا:
 *  · الأدوار `admin|hr|manager` (بوابة الخادم نفسها).
 *  · جسم PUT/POST مفاتيح schema-registry فقط: أي مفتاح زائد يرفض الطلب كله.
 *  · السبب إجباري على كل إجراء كتابي، ويُخزَّن سطر تدقيق في `notes` يُلاحَق
 *    لا يُستبدل (الفاصل ' | ').
 *  · لا سماحية (قرار المالك 2026-11-05): `late` = الدخول بعد بداية الوردية.
 *  · العذر = طلب إجازة معتمد ليوم واحد عبر `leaveRequests`، لا تعديل حالة
 *    مباشر (الخادم يرفض تعديل حالة الطلب عبر CRUD).
 *  · الكشف الشهري يُعرض كما جمعه الخادم؛ لا إعادة حساب في الواجهة.
 */

/** أدوار الكتابة — بوابة الخادم `admin|hr|manager` (server.js:1778). */
export const ATT_WRITE_ROLES = ['admin', 'hr', 'manager'] as const;

export function canWriteAttendance(role: string | null | undefined): boolean {
    return isWriteRole(role, ATT_WRITE_ROLES);
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_RE = /^\d{4}-\d{2}$/;
export const TIME_INPUT_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** صيغة الشهر المعتمدة عند الخادم — برسالة الخادم نفسها. */
export function attendanceMonthError(month: unknown): string {
    const value = String(month ?? '').trim();
    if (!MONTH_RE.test(value)) {
        return 'الشهر بصيغة YYYY-MM';
    }
    const number = Number(value.slice(5, 7));
    return number >= 1 && number <= 12 ? '' : 'شهر غير صالح';
}

/* ─── التحقق (رسائل V2 نفسها) ───────────────────────────────────────────── */

export function validateReason(reason: unknown, message = 'اكتب السبب'): { ok: true; reason: string } | { ok: false; message: string } {
    const text = String(reason ?? '').trim();
    return text ? { ok: true, reason: text } : { ok: false, message };
}

export type PunchForm = { checkIn: string; checkOut: string; reason: string };

/** فحص نموذج البصمة قبل الشبكة — بصمة واحدة على الأقل، HH:MM، سبب إجباري. */
export function validatePunchForm({
    checkIn = '',
    checkOut = '',
    reason = '',
    reasonLabel = 'اكتب السبب',
}: {
    checkIn?: string;
    checkOut?: string;
    reason?: string;
    reasonLabel?: string;
}): { ok: true; checkIn: string; checkOut: string; reason: string } | { ok: false; message: string } {
    const ci = String(checkIn ?? '').trim();
    const co = String(checkOut ?? '').trim();
    if (!ci && !co) {
        return { ok: false, message: 'أدخل بصمة واحدة على الأقل' };
    }
    if ((ci && !TIME_INPUT_RE.test(ci)) || (co && !TIME_INPUT_RE.test(co))) {
        return { ok: false, message: 'صيغة الوقت HH:MM' };
    }
    const checked = validateReason(reason, reasonLabel);
    if (!checked.ok) {
        return checked;
    }
    return { ok: true, checkIn: ci, checkOut: co, reason: checked.reason };
}

/* ─── الحساب قبل الحفظ (نفس hr.js) ──────────────────────────────────────── */

function toMinutes(value: string | null | undefined): number | null {
    const match = String(value ?? '').match(/^(\d{1,2}):(\d{2})$/);
    return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

/** بداية الوردية من بطاقة الموظف، وإلا ساعة بدء العمل، وإلا 09:00. */
export function shiftStartFor(employee: { shift_start?: string | null | undefined } | null | undefined, workStartHour: number): string {
    const stored = String(employee?.shift_start ?? '');
    if (/^\d{2}:\d{2}/.test(stored)) {
        return stored;
    }
    const hour = Number(workStartHour);
    return `${String(Number.isFinite(hour) && hour > 0 ? Math.floor(hour) : 9).padStart(2, '0')}:00`;
}

/**
 * دقائق العمل وعلامة التأخير قبل الحفظ — `calcPunchTimes` في V2 حرفيًّا.
 * `keepLate` (نمط التصحيح): بلا بصمة دخول تبقى العلامة المخزَّنة كما هي
 * بدل اختراع علامة جديدة؛ أما التعبئة فبلا دخول = بلا تأخير.
 * السماحية صفر بقرار المالك 2026-11-05.
 */
export function calcPunchTimes({
    checkIn = '',
    checkOut = '',
    shiftStart = '09:00',
    keepLate = false,
}: {
    checkIn?: string;
    checkOut?: string;
    shiftStart?: string;
    keepLate?: boolean;
}): { workMinutes: number | null; late: boolean } {
    const ci = toMinutes(checkIn);
    const co = toMinutes(checkOut);
    let workMinutes: number | null = null;
    if (ci !== null && co !== null) {
        let diff = co - ci;
        if (diff < 0) {
            diff += 1440;
        }
        workMinutes = diff;
    }
    const start = toMinutes(shiftStart);
    const late = ci !== null && start !== null ? ci > start : Boolean(keepLate);
    return { workMinutes, late };
}

/** سطور التدقيق الثلاثة حرفيًّا — قابلة للمقارنة بين الشاشتين. */
export function auditNote(
    kind: 'fill' | 'correct' | 'swap',
    { who = '', reason = '', date = '', withName = '' }: { who?: string; reason?: string; date?: string; withName?: string },
): string {
    const text = String(reason ?? '').trim();
    const actor = String(who ?? '');
    if (kind === 'fill') {
        return `[تعبئة ${date} بواسطة ${actor}: ${text}]`;
    }
    if (kind === 'correct') {
        return `[تصحيح يدوي ${date} بواسطة ${actor}: ${text}]`;
    }
    return `[تبديل وردية ${date} مع ${withName} بواسطة ${actor}: ${text}]`;
}

/** الملاحظات سلسلة تدقيق تُلاحَق ولا تُستبدل. */
export function joinNotes(existing: unknown, line: string): string {
    return [existing ? String(existing) : '', line].filter(Boolean).join(' | ');
}

/* ─── الأجسام (whitelist الخادم) ────────────────────────────────────────── */

export interface PunchPayload {
    checkIn: string | null;
    checkOut: string | null;
    workMinutes: number | null;
    late: boolean;
    notes: string;
}

export function buildPunchPayload({
    checkIn = '',
    checkOut = '',
    workMinutes = null,
    late = false,
    notes = '',
}: {
    checkIn?: string;
    checkOut?: string;
    workMinutes?: number | null;
    late?: boolean;
    notes?: string;
}): PunchPayload {
    const minutes = Number(workMinutes);
    return {
        checkIn: checkIn || null,
        checkOut: checkOut || null,
        workMinutes: workMinutes === null || workMinutes === undefined || !Number.isFinite(minutes) ? null : minutes,
        late: Boolean(late),
        notes: String(notes ?? ''),
    };
}

export interface AttendanceCreatePayload extends PunchPayload {
    employeeId: string;
    date: string;
}

export function buildAttendanceCreate({
    employeeId,
    date,
    checkIn = '',
    checkOut = '',
    workMinutes = null,
    late = false,
    notes = '',
}: {
    employeeId: string | number;
    date: string;
    checkIn?: string;
    checkOut?: string;
    workMinutes?: number | null;
    late?: boolean;
    notes?: string;
}): AttendanceCreatePayload {
    if (employeeId === undefined || employeeId === null || String(employeeId).trim() === '') {
        throw new Error('حدّد الموظف');
    }
    if (!DATE_RE.test(String(date ?? ''))) {
        throw new Error('التاريخ بصيغة YYYY-MM-DD');
    }
    return {
        employeeId: String(employeeId),
        date: String(date),
        ...buildPunchPayload({ checkIn, checkOut, workMinutes, late, notes }),
    };
}

export const EXCUSE_PREFIX = { admin: 'عذر إداري: ', approved: 'عذر معتمد: ' } as const;

export interface ExcusePayload {
    employeeId: string;
    startDate: string;
    endDate: string;
    status: 'approved';
    reason: string;
    requestDate: string;
    approvedDate: string;
    requestedBy?: string | number;
    approvedBy?: string | number;
}

/**
 * عذر إداري = طلب إجازة معتمد ليوم واحد. `requestDate/approvedDate` اليوم،
 * بينما `startDate/endDate` يوم الغياب نفسه — الفرق مقصود.
 */
export function buildExcusePayload({
    employeeId,
    date,
    reason,
    kind = 'approved',
    userId = null,
    withName = '',
    todayStr = '',
}: {
    employeeId: string | number;
    date: string;
    reason: string;
    kind?: 'admin' | 'approved' | 'swap';
    userId?: string | number | null;
    withName?: string;
    todayStr?: string;
}): ExcusePayload {
    const checked = validateReason(reason, kind === 'admin' ? 'اكتب سبب العذر' : 'اكتب السبب');
    if (!checked.ok) {
        throw new Error(checked.message);
    }
    if (employeeId === undefined || employeeId === null || String(employeeId).trim() === '') {
        throw new Error('حدّد الموظف');
    }
    if (!DATE_RE.test(String(date ?? ''))) {
        throw new Error('التاريخ بصيغة YYYY-MM-DD');
    }
    const day = String(date);
    const text =
        kind === 'swap'
            ? `تبديل وردية مع ${withName || String(employeeId)}: ${checked.reason}`
            : `${EXCUSE_PREFIX[kind] ?? EXCUSE_PREFIX.approved}${checked.reason}`;
    const today = DATE_RE.test(String(todayStr ?? '')) ? String(todayStr) : day;
    const payload: ExcusePayload = {
        employeeId: String(employeeId),
        startDate: day,
        endDate: day,
        status: 'approved',
        reason: text,
        requestDate: today,
        approvedDate: today,
    };
    if (userId !== null && userId !== undefined && String(userId).trim() !== '') {
        payload.requestedBy = userId;
        payload.approvedBy = userId;
    }
    return payload;
}

/* ─── ساعة بدء العمل من الإعدادات ───────────────────────────────────────── */

export interface WorkStartHour {
    hour: number;
    ok: boolean;
}

/** تُقرأ من `settings/main_settings`، وإن تعذّرت فـ09:00 مع `ok:false`. */
export async function fetchWorkStartHour(signal?: AbortSignal): Promise<WorkStartHour> {
    try {
        const settings = await fetchJson(mainSettingsSchema, '/api/settings/main_settings', getAccessToken(), signal ? { signal } : {});
        const hour = Number(settings.workStartHour);
        return { hour: Number.isFinite(hour) && hour > 0 ? Math.floor(hour) : 9, ok: true };
    } catch {
        return { hour: 9, ok: false };
    }
}

/* ─── الكتابات ──────────────────────────────────────────────────────────── */

export async function updateAttendance(id: string | number, payload: PunchPayload): Promise<void> {
    await writeAck(`/api/attendance/${encodeURIComponent(String(id))}`, 'PUT', payload);
}

export async function createAttendance(payload: AttendanceCreatePayload): Promise<void> {
    await writeAck('/api/attendance', 'POST', payload);
}

export async function createApprovedLeave(payload: ExcusePayload): Promise<void> {
    await writeAck('/api/leaveRequests', 'POST', payload);
}

/* ─── سجل التدقيق ───────────────────────────────────────────────────────── */

const auditEditRowSchema = z
    .object({
        id: z.union([z.string(), z.number()]).optional(),
        action: z.string().nullable().optional(),
        employee_name: z.string().nullable().optional(),
        employee_no: z.string().nullable().optional(),
        actorName: z.string().nullable().optional(),
        actorRole: z.string().nullable().optional(),
        reason: z.string().nullable().optional(),
        source: z.string().nullable().optional(),
        createdAt: z.string().nullable().optional(),
        changedFields: z.record(z.string(), z.unknown()).nullable().optional(),
    })
    .passthrough();

const auditListSchema = z
    .object({
        rows: z.array(auditEditRowSchema).optional(),
        total: z.union([z.string(), z.number()]).nullable().optional(),
        limit: z.union([z.string(), z.number()]).nullable().optional(),
        offset: z.union([z.string(), z.number()]).nullable().optional(),
    })
    .passthrough();

export const ATT_AUDIT_ACTIONS_AR: Record<string, string> = {
    create: 'إضافة',
    update: 'تصحيح',
    delete: 'حذف',
};

export interface AttendanceAuditRow {
    id: string;
    action: string;
    actionAr: string;
    tone: 'danger' | 'success' | 'warning';
    employeeName: string;
    employeeNo: string;
    actorName: string;
    actorRole: string;
    reason: string;
    source: string;
    at: string;
    fields: { field: string; before: string; after: string }[];
}

function fieldText(value: unknown): string {
    if (value === null || value === undefined || value === '') {
        return '—';
    }
    return String(value);
}

export function auditEditRows(body: z.infer<typeof auditListSchema>): AttendanceAuditRow[] {
    return (body.rows ?? []).map((row) => {
        const changes = row.changedFields ?? {};
        const action = String(row.action ?? '');
        return {
            id: String(row.id ?? ''),
            action,
            actionAr: ATT_AUDIT_ACTIONS_AR[action] ?? action ?? '—',
            tone: action === 'delete' ? 'danger' : action === 'create' ? 'success' : 'warning',
            employeeName: String(row.employee_name ?? '—'),
            employeeNo: String(row.employee_no ?? '—'),
            actorName: String(row.actorName ?? '—'),
            actorRole: String(row.actorRole ?? ''),
            reason: String(row.reason ?? ''),
            source: String(row.source ?? ''),
            at: String(row.createdAt ?? ''),
            fields: Object.entries(changes).map(([field, value]) => {
                const change = (value ?? {}) as { before?: unknown; after?: unknown };
                return { field, before: fieldText(change.before), after: fieldText(change.after) };
            }),
        };
    });
}

export interface AttendanceAuditPage {
    rows: AttendanceAuditRow[];
    total: number;
    limit: number;
    offset: number;
}

export async function fetchAttendanceAudit({
    from = '',
    to = '',
    action = '',
    limit = 200,
    offset = 0,
    signal,
}: {
    from?: string;
    to?: string;
    action?: string;
    limit?: number;
    offset?: number;
    signal?: AbortSignal;
} = {}): Promise<AttendanceAuditPage> {
    const query = new URLSearchParams();
    if (DATE_RE.test(from)) {
        query.set('from', from);
    }
    if (DATE_RE.test(to)) {
        query.set('to', to);
    }
    if (action) {
        query.set('action', action);
    }
    query.set('limit', String(Math.min(500, Math.max(1, Number(limit) || 200))));
    query.set('offset', String(Math.max(0, Number(offset) || 0)));
    const body = await fetchJson(auditListSchema, `/api/attendance/audit?${query.toString()}`, getAccessToken(), signal ? { signal } : {});
    return {
        rows: auditEditRows(body),
        total: Number(body.total ?? 0) || 0,
        limit: Number(body.limit ?? 200) || 200,
        offset: Number(body.offset ?? 0) || 0,
    };
}

/* ─── التدقيق الصارم ────────────────────────────────────────────────────── */

export const AUDIT_STATUS_AR: Record<string, string> = { PASS: 'سليم', WARN: 'تنبيه', FAIL: 'فشل' };

const strictAuditSchema = z
    .object({
        ok: z.boolean().optional(),
        checks: z
            .array(
                z
                    .object({
                        name: z.string().nullable().optional(),
                        status: z.string().nullable().optional(),
                        count: z.union([z.string(), z.number()]).nullable().optional(),
                        detail: z
                            .array(
                                z
                                    .object({
                                        emp: z.string().nullable().optional(),
                                        lateDays: z.union([z.string(), z.number()]).nullable().optional(),
                                        days: z.union([z.string(), z.number()]).nullable().optional(),
                                    })
                                    .passthrough(),
                            )
                            .nullable()
                            .optional(),
                    })
                    .passthrough(),
            )
            .nullable()
            .optional(),
    })
    .passthrough();

export interface StrictAuditCheck {
    name: string;
    status: string;
    statusAr: string;
    tone: 'success' | 'warning' | 'danger' | 'neutral';
    count: number;
    details: { emp: string; lateDays: number | null; days: number | null }[];
}

export interface StrictAudit {
    ok: boolean;
    checks: StrictAuditCheck[];
    counts: { PASS: number; WARN: number; FAIL: number };
}

export async function fetchStrictAudit(month: string, signal?: AbortSignal): Promise<StrictAudit> {
    const error = attendanceMonthError(month);
    if (error) {
        throw new Error(error);
    }
    const body = await fetchJson(
        strictAuditSchema,
        `/api/hr/strict-audit?month=${encodeURIComponent(month)}`,
        getAccessToken(),
        signal ? { signal } : {},
    );
    const checks: StrictAuditCheck[] = (body.checks ?? []).map((check) => {
        const status = String(check.status ?? '');
        return {
            name: String(check.name ?? '—'),
            status,
            statusAr: AUDIT_STATUS_AR[status] ?? status ?? '—',
            tone: status === 'PASS' ? 'success' : status === 'WARN' ? 'warning' : status === 'FAIL' ? 'danger' : 'neutral',
            count: Number(check.count ?? 0) || 0,
            details: (check.detail ?? []).map((detail) => ({
                emp: String(detail.emp ?? ''),
                lateDays: detail.lateDays === undefined || detail.lateDays === null ? null : Number(detail.lateDays),
                days: detail.days === undefined || detail.days === null ? null : Number(detail.days),
            })),
        };
    });
    return {
        ok: body.ok === true,
        checks,
        counts: {
            PASS: checks.filter((check) => check.status === 'PASS').length,
            WARN: checks.filter((check) => check.status === 'WARN').length,
            FAIL: checks.filter((check) => check.status === 'FAIL').length,
        },
    };
}

/* ─── الكشف الشهري المجمع ───────────────────────────────────────────────── */

const monthlySchema = z
    .object({
        month: z.string().nullable().optional(),
        workDayMinutes: z.union([z.string(), z.number()]).nullable().optional(),
        employees: z.array(z.record(z.string(), z.unknown())).nullable().optional(),
    })
    .passthrough();

function num(value: unknown): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
}

export interface MonthlyAttendanceRow {
    id: string;
    name: string;
    employeeId: string;
    department: string;
    position: string;
    shiftStart: string;
    records: number;
    present: number;
    completeWorkDays: number;
    shortDays: number;
    deficitMinutes: number;
    deficitHours: number;
    lateInDays: number;
    karimHours: number;
    leaveDays: number;
    reviewDays: number;
    workDayMinutes: number;
}

export interface MonthlyAttendanceSheet {
    month: string;
    workDayMinutes: number;
    employees: number;
    rows: MonthlyAttendanceRow[];
    totals: {
        records: number;
        present: number;
        completeWorkDays: number;
        shortDays: number;
        deficitMinutes: number;
        lateInDays: number;
        karimHours: number;
        leaveDays: number;
        reviewDays: number;
    };
}

export function monthlyRow(raw: Record<string, unknown>): MonthlyAttendanceRow {
    return {
        id: String(raw.id ?? ''),
        name: String(raw.name ?? '—'),
        employeeId: String(raw.employeeId ?? '—'),
        department: String(raw.department ?? '—'),
        position: String(raw.position ?? ''),
        shiftStart: String(raw.shift_start ?? ''),
        records: num(raw.days),
        present: num(raw.present),
        completeWorkDays: num(raw.completeWorkDays),
        shortDays: num(raw.shortDays),
        deficitMinutes: num(raw.deficitMinutes),
        deficitHours: num(raw.deficitHours),
        lateInDays: num(raw.lateInDays),
        karimHours: num(raw.karimHours),
        leaveDays: num(raw.leaveDays),
        reviewDays: num(raw.reviewDays),
        workDayMinutes: num(raw.workDayMinutes),
    };
}

/** الكشف كله: صفوف + إجماليات جمع صفوف الخادم نفسه — لا إعادة حساب. */
export function buildMonthlySheet(body: z.infer<typeof monthlySchema>): MonthlyAttendanceSheet {
    const rows = (body.employees ?? []).map(monthlyRow);
    const sum = (pick: (row: MonthlyAttendanceRow) => number): number => rows.reduce((total, row) => total + pick(row), 0);
    return {
        month: MONTH_RE.test(String(body.month ?? '')) ? String(body.month) : '',
        workDayMinutes: num(body.workDayMinutes) || 600,
        employees: rows.length,
        rows,
        totals: {
            records: sum((row) => row.records),
            present: sum((row) => row.present),
            completeWorkDays: sum((row) => row.completeWorkDays),
            shortDays: sum((row) => row.shortDays),
            deficitMinutes: sum((row) => row.deficitMinutes),
            lateInDays: sum((row) => row.lateInDays),
            karimHours: Math.round(sum((row) => row.karimHours) * 10) / 10,
            leaveDays: sum((row) => row.leaveDays),
            reviewDays: sum((row) => row.reviewDays),
        },
    };
}

export function minutesToHM(minutes: number | null | undefined): string {
    const value = Number(minutes);
    if (!Number.isFinite(value) || value <= 0) {
        return '—';
    }
    return `${Math.floor(value / 60)}:${String(Math.round(value % 60)).padStart(2, '0')}`;
}

export async function fetchMonthlyAttendance(month: string, signal?: AbortSignal): Promise<MonthlyAttendanceSheet> {
    const error = attendanceMonthError(month);
    if (error) {
        throw new Error(error);
    }
    const body = await fetchJson(
        monthlySchema,
        `/api/hr/attendance/monthly?month=${encodeURIComponent(month)}&detail=1`,
        getAccessToken(),
        signal ? { signal } : {},
    );
    return buildMonthlySheet(body);
}

/* ─── النصوص ────────────────────────────────────────────────────────────── */

export const ATT_WRITE_TEXT = {
    correct: 'تصحيح',
    correctTitle: 'تصحيح بصمة',
    correctHint: 'املأ الخانة الناقصة أو عدّل الاثنتين. السبب إجباري ويُخزَّن في سجل التدقيق.',
    resolve: 'معالجة',
    resolveTitle: 'معالجة سجل اليوم',
    resolveHint: 'تعبئة بصمة ناقصة، أو عذر معتمد، أو تبديل وردية — كلها بحجة مكتوبة.',
    excuse: 'عذر إداري',
    excuseTitle: 'عذر إداري',
    excuseHint: 'عذر ليوم واحد يُعتمد الآن ويظهر في متابعة الإجازات.',
    fill: 'تعبئة البصمة الناقصة',
    excuseKind: 'عذر معتمد',
    swap: 'تبديل وردية',
    reason: 'السبب (إجباري)',
    reasonPlaceholder: 'مثال: نسي البصمة — ظرف عائلي — تبديل متفق عليه',
    checkIn: 'بصمة الحضور',
    checkOut: 'بصمة الانصراف',
    employee: 'الموظف',
    date: 'التاريخ',
    withEmployee: 'تبديل مع الموظف',
    save: 'اعتماد',
    saving: 'جارٍ الحفظ…',
    close: 'إغلاق',
    saved: 'حُفظ الإجراء',
    audit: 'سجل التدقيق',
    auditTitle: 'سجل تدقيق الحضور',
    auditHint: 'كل تعديل يترك سطرًا دائمًا: من غيّر، ماذا، متى، ولماذا.',
    strict: 'التدقيق الصارم',
    strictTitle: 'التدقيق الصارم',
    strictHint: 'فحوص بيانات الشهر التي يعتمدها الخادم قبل الرواتب.',
    monthly: 'الكشف الشهري',
    monthlyTitle: 'الكشف الشهري المجمع',
    monthlyHint: 'أرقام الخادم كما هي — التأخير هو العجز عن إتمام ساعات الوردية.',
    noAudit: 'لا تعديلات في النطاق المحدد.',
    noChecks: 'لا فحوص لهذا الشهر.',
    noMonthly: 'لا موظفين في الكشف.',
    loadFailed: 'تعذّر تحميل البيانات',
    saveFailed: 'تعذّر حفظ الإجراء',
} as const;
