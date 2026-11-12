import { z } from 'zod';
import { ApiError, fetchJson } from './api';
import { getAccessToken } from './auth';
import { arSearchKey } from './employees';

/**
 * شبكة الدوام الأسبوعية — قراءة فقط من `/api/hr/dept-roster-week`.
 *
 * العقد منسوخ من `frontend/app/js/v2/data/roster-repo.js` — بابٌ واحد:
 *   GET `/hr/dept-roster-week` (:105-113) بمعاملين اختياريين: `week`
 *   (`YYYY-MM-DD`) و`dept` (كود القسم). basePath القديم `/api`
 *   (`frontend/app/js/core/api.js:8`) فالمسار في v3 هو
 *   `/api/hr/dept-roster-week` (والمركّب في `backend/server.js:598`).
 *
 * **القراءة فقط**: تحرير خلايا الشبكة ونسخ الصف ونسخ الأسبوع السابق وحفظها
 * (`POST /hr/dept-roster-week`) واعتماد الطباعة
 * (`POST /hr/dept-roster-approval/request|approve`) تبقى في V2. لا POST ولا
 * PUT ولا PATCH ولا DELETE في هذا الملف ولا في الشاشة.
 *
 * **التواريخ**: نصوص `YYYY-MM-DD` تُعرض كما أرسلها الخادم (ADR-05). الخادم
 * هو من يقرّر بداية الأسبوع (السبت) ويجيب عنها
 * (`backend/hr-routes.js:1179-1183`)، فالشاشة لا تبني تاريخًا من عندها.
 * الاستثناء الوحيد `weekOf` أدناه: حساب *تاريخ الطلب* ل-week navigation —
 * نسخةٌ حرفية من باب القديم (`roster-repo.js:47-52`) بموجة UTC ظهرًا
 * (`T12:00:00Z`) فلا يقع انزياح يومٍ بين المناطق الزمنية.
 *
 * **النطاق**: يقرّره الخادم من دور المستخدم (`backend/hr-routes.js:938-954`)
 * فيرد `depts` و`fixed` — ولا نخمّن نطاقًا في الواجهة.
 */

/* ─── المخططات ─────────────────────────────────────────────────────────── */

const idValue = z.union([z.string(), z.number()]).transform((value) => String(value));
const optionalText = z.string().nullable().optional();

/** `NUMERIC` من pg يعود نصًّا أحيانًا (`shift_karim`) — نقبل النصّ والعدد. */
const numberish = z
    .union([z.string(), z.number()])
    .nullable()
    .optional()
    .transform((value) => {
        if (value === null || value === undefined || value === '') {
            return null;
        }
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
    });

export const rosterDaySchema = z
    .object({
        date: z.string(),
        weekday: z.number(),
        isPast: z.boolean().optional(),
        isToday: z.boolean().optional(),
    })
    .passthrough();

export const rosterCellSchema = z
    .object({
        date: z.string(),
        shift_start: optionalText,
        shift_hours: numberish,
        day_off: numberish,
        onLeave: z.boolean().optional(),
        leaveType: optionalText,
        explicit: z.boolean().optional(),
        editable: z.boolean().optional(),
    })
    .passthrough();

export const rosterGridRowSchema = z
    .object({
        id: idValue,
        name: optionalText,
        employeeId: optionalText,
        position: optionalText,
        department: optionalText,
        base: z
            .object({
                shift_start: optionalText,
                shift_hours: numberish,
                day_off: numberish,
            })
            .passthrough()
            .optional(),
        cells: z.array(rosterCellSchema),
    })
    .passthrough();

export const rosterLogSchema = z
    .object({
        employee_id: idValue,
        name: optionalText,
        emp_no: optionalText,
        shift_start: optionalText,
        shift_karim: numberish,
        effective_from: optionalText,
        created_at: optionalText,
        by_name: optionalText,
    })
    .passthrough();

export const rosterApprovalSchema = z
    .object({
        requested_name: optionalText,
        requested_at: optionalText,
        approved_name: optionalText,
        approved_at: optionalText,
    })
    .passthrough();

export const rosterWeekSchema = z
    .object({
        ok: z.boolean().optional(),
        weekStart: z.string(),
        days: z.array(rosterDaySchema),
        grid: z.array(rosterGridRowSchema),
        depts: z.array(z.string()),
        fixed: z.boolean(),
        today: z.string(),
        validDepts: z.array(z.string()),
        recentLog: z.array(rosterLogSchema),
        approval: rosterApprovalSchema.nullable(),
    })
    .passthrough();

export type RosterWeek = z.infer<typeof rosterWeekSchema>;

/* ─── الأبواب ──────────────────────────────────────────────────────────── */

/**
 * `roster-repo.js:106-113` حرفيًا: `week` و`dept` لا يُرسَلان إلا إذا
 * كان لهما قيمة — و«بلا قسم = كل الأقسام» (لدى المخوَّلين).
 */
export function rosterWeekPath(week: string, dept: string): string {
    const params = new URLSearchParams();
    if (week) {
        params.set('week', String(week));
    }
    if (dept) {
        params.set('dept', String(dept));
    }
    const query = params.toString();
    return `/api/hr/dept-roster-week${query ? `?${query}` : ''}`;
}

export async function fetchRosterWeek(week: string, dept: string, signal?: AbortSignal): Promise<RosterWeek> {
    return fetchJson(rosterWeekSchema, rosterWeekPath(week, dept), getAccessToken(), signal ? { signal } : {});
}

/* ─── الأسبوع والأيام ──────────────────────────────────────────────────── */

/**
 * `roster-repo.js:39` حرفيًا: ترتيب الخادم — `days[i].weekday = i`
 * و0 = السبت. ترتيب الأعمدة في RTL يتبع ترتيب هذه المصفوفة كما في القديم
 * (`screens/roster.js:275-282`).
 */
export const ROSTER_DAY_LABELS = ['السبت', 'الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة'] as const;

export function rosterDayLabel(index: number): string {
    return ROSTER_DAY_LABELS[index] ?? '';
}

/**
 * `roster-repo.js:47-52` حرفيًا: خطوة أسبوع كامل من `weekStart` أرسله
 * الخادم. ليست حساب بداية الأسبوع — الخادم وحده يقرّرها
 * (`backend/hr-routes.js:1180-1183`) — بل تاريخ *طلب* ننتقل إليه.
 */
export function weekOf(weekStart: string, deltaWeeks: number): string {
    const d = new Date(`${String(weekStart || '')}T12:00:00Z`);
    if (Number.isNaN(d.getTime())) {
        return '';
    }
    d.setUTCDate(d.getUTCDate() + (Number(deltaWeeks) || 0) * 7);
    return d.toISOString().slice(0, 10);
}

/** `screens/roster.js:355` حرفيًا: `weekStart — يوم السبت الأخير`. */
export function rosterWeekLabel(weekStart: string, days: readonly RosterDay[]): string {
    if (days.length >= 7) {
        const last = days[6];
        return `${weekStart} — ${last ? last.date : ''}`;
    }
    return String(weekStart || '');
}

/** `screens/roster.js:43-47` — ساعة القراءة `HH:MM` كما كانت في القديم. */
export function clockNow(now: Date = new Date()): string {
    const date = now instanceof Date ? now : new Date(now);
    if (Number.isNaN(date.getTime())) {
        return '';
    }
    const pad = (value: number) => String(value).padStart(2, '0');
    return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/* ─── الاعتماد ─────────────────────────────────────────────────────────── */

/** `roster-repo.js:55-58` حرفيًا: مفتاح الأسبوع من أقسام الخادم نفسها. */
export function rosterApprovalKey(depts: readonly string[]): string {
    const list = depts.map((value) => String(value || '').trim()).filter(Boolean);
    return (list.length ? list.join(',') : '*').toLowerCase();
}

export type RosterApproval = { key: 'none' } | { key: 'pending'; by: string; at: string } | { key: 'approved'; by: string; at: string };

/** `roster-repo.js:61-69` حرفيًا: ثلاث حالات — لا شيء / بانتظار / معتمد. */
export function rosterApprovalState(approval: RosterApprovalRow | null): RosterApproval {
    const a = approval || {};
    if (!a.requested_name && !a.approved_name) {
        return { key: 'none' };
    }
    const at = (value: string | null | undefined) => (value ? String(value).replace('T', ' ').slice(0, 16) : '');
    if (a.approved_name) {
        return { key: 'approved', by: String(a.approved_name), at: at(a.approved_at) };
    }
    return { key: 'pending', by: String(a.requested_name), at: at(a.requested_at) };
}

export type RosterApprovalRow = z.infer<typeof rosterApprovalSchema>;

/* ─── الصفّ ─────────────────────────────────────────────────────────────── */

export type RosterDay = {
    date: string;
    weekday: number;
    label: string;
    isPast: boolean;
    isToday: boolean;
};

export type RosterCell = {
    date: string;
    shiftStart: string;
    shiftHours: number | null;
    dayOff: number | null;
    onLeave: boolean;
    leaveType: string;
    explicit: boolean;
    editable: boolean;
};

export type RosterRow = {
    id: string;
    name: string;
    employeeId: string;
    position: string;
    department: string;
    cells: RosterCell[];
};

/** التسمية بالفهرس لا بالترتيب المرسوم — `screens/roster.js:280`. */
export function rosterDays(days: readonly z.infer<typeof rosterDaySchema>[]): RosterDay[] {
    return days.map((day, index) => ({
        date: String(day.date),
        weekday: day.weekday,
        label: rosterDayLabel(index),
        isPast: Boolean(day.isPast),
        isToday: Boolean(day.isToday),
    }));
}

/** `screens/roster.js:245-250` — «راحة» حين `day_off` موجود، وإلا الوقت. */
export function rosterCellToCell(raw: z.infer<typeof rosterCellSchema>): RosterCell {
    return {
        date: String(raw.date ?? ''),
        shiftStart: raw.shift_start ? String(raw.shift_start) : '—',
        shiftHours: raw.shift_hours,
        dayOff: raw.day_off,
        onLeave: Boolean(raw.onLeave),
        leaveType: raw.leaveType ? String(raw.leaveType) : '',
        explicit: Boolean(raw.explicit),
        editable: Boolean(raw.editable),
    };
}

/** `screens/roster.js:284-288` — الاسم، ثم رمز الموظف، ثم الوظيفة. */
export function rosterToRow(raw: z.infer<typeof rosterGridRowSchema>): RosterRow {
    return {
        id: raw.id,
        name: raw.name ? String(raw.name) : `#${raw.id}`,
        employeeId: raw.employeeId ? String(raw.employeeId) : '',
        position: raw.position ? String(raw.position) : '',
        department: raw.department ? String(raw.department) : '',
        cells: raw.cells.map(rosterCellToCell),
    };
}

export type RosterLogRow = {
    key: string;
    employee: string;
    empNo: string;
    start: string;
    hours: string;
    effectiveFrom: string;
    by: string;
    at: string;
};

/** `screens/roster.js:225-235` حرفيًا — نفس السقوط إلى '—' ونفس الطابع. */
export function rosterLogToRow(raw: z.infer<typeof rosterLogSchema>): RosterLogRow {
    const employee = raw.name ? String(raw.name) : `#${raw.employee_id}`;
    const empNo = raw.emp_no ? String(raw.emp_no) : '';
    const start = String(raw.shift_start || '—');
    const hours = raw.shift_karim === null ? '—' : String(raw.shift_karim);
    const effectiveFrom = String(raw.effective_from || '—');
    const by = String(raw.by_name || '—');
    const at = raw.created_at ? String(raw.created_at).replace('T', ' ').slice(0, 16) : '—';
    return {
        key: `${empNo}:${effectiveFrom}:${at}`,
        employee,
        empNo,
        start,
        hours,
        effectiveFrom,
        by,
        at,
    };
}

/* ─── النطاق والمجاميع ─────────────────────────────────────────────────── */

/** `screens/roster.js:357-359` حرفيًا: نطاقٌ يحدده الخادم أو اختيارٌ ظاهر. */
export function rosterScopeNote(fixed: boolean, depts: readonly string[], dept: string): string {
    if (fixed) {
        return `دورك مقصور على قسمك (${depts.join(', ') || 'بلا قسم مسجَّل'} — الخادم يحدده)`;
    }
    return dept ? `نطاق مختار: ${dept}` : 'دور مخوّل: كل الأقسام';
}

export type RosterSummary = {
    employees: number;
    days: number;
    pastDays: number;
    editableCells: number;
    leaveCells: number;
    restCells: number;
    logs: number;
};

/**
 * العدّادات كلها من أعلام الخادم نفسها:
 *  · `employees` = عدد صفوف الشبكة (`screens/roster.js:266`).
 *  · `pastDays` = الأيام المقفلة (`backend/hr-routes.js:1188`).
 *  · `editableCells` = الخلايا التي سمح الخادم بتعديلها
 *    (`backend/hr-routes.js:1273`، والقديم يعرضها كمدخلات
 *    `screens/roster.js:254-259`).
 *  · `leaveCells`/`restCells` = خلايا الإجازة والراحة
 *    (`screens/roster.js:240-252`).
 */
export function rosterSummary(rows: readonly RosterRow[], days: readonly RosterDay[], logs: number): RosterSummary {
    let editableCells = 0;
    let leaveCells = 0;
    let restCells = 0;
    for (const row of rows) {
        for (const cell of row.cells) {
            if (cell.editable) {
                editableCells += 1;
            }
            if (cell.onLeave) {
                leaveCells += 1;
            }
            if (cell.dayOff !== null) {
                restCells += 1;
            }
        }
    }
    return {
        employees: rows.length,
        days: days.length,
        pastDays: days.filter((day) => day.isPast).length,
        editableCells,
        leaveCells,
        restCells,
        logs,
    };
}

/* ─── البحث ────────────────────────────────────────────────────────────── */

export type RosterSearch<T> = {
    rows: T[];
    matched: boolean;
    folded: boolean;
    hits: number;
};

/**
 * مطابقةٌ حرفية أولًا ثم مطابقةٌ بعد تطبيع الحروف العربية
 * (`arSearchKey` — نفس جدول `employees-repo.js:306-314` المستعمل في
 * شاشات v3 الأخرى). المطابقة بعد التطبيع وحدها تُعلَن للمستخدم.
 */
function tokenScore(token: string, values: readonly string[]): { score: number; folded: boolean } {
    const raw = token.toLowerCase();
    const key = arSearchKey(token);
    if (raw && values.some((value) => value.toLowerCase().includes(raw))) {
        return { score: 2, folded: false };
    }
    if (key && values.some((value) => arSearchKey(value).includes(key))) {
        return { score: 1, folded: true };
    }
    return { score: 0, folded: false };
}

function searchBy<T>(rows: readonly T[], query: string, fields: (row: T) => string[]): RosterSearch<T> {
    const raw = String(query ?? '').trim();
    if (!raw) {
        return { rows: [...rows], matched: false, folded: false, hits: rows.length };
    }
    const tokens = raw.split(/\s+/).filter(Boolean);
    const kept: { row: T; folded: boolean }[] = [];
    for (const row of rows) {
        const values = fields(row);
        let folded = false;
        let matchedAll = true;
        for (const token of tokens) {
            const hit = tokenScore(token, values);
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

/** الموظف: الاسم ورمزه وظيفته وقسمه (`screens/roster.js:284-288`). */
export function searchRoster(rows: readonly RosterRow[], query: string): RosterSearch<RosterRow> {
    return searchBy(rows, query, (row) => [row.name, row.employeeId, row.position, row.department]);
}

/** سجل التغييرات: الموظف ومن سجّل وتاريخ السريان والوقت (`screens/roster.js:199-221`). */
export function searchRosterLogs(rows: readonly RosterLogRow[], query: string): RosterSearch<RosterLogRow> {
    return searchBy(rows, query, (row) => [row.employee, row.empNo, row.by, row.effectiveFrom, row.start]);
}

/* ─── الأخطاء ──────────────────────────────────────────────────────────── */

/**
 * `screens/roster.js:370-378` — ثلاث رسائل: انتهاء الجلسة، لا صلاحية،
 * وخطأ التحميل. `ApiError` يحمل `status` لا `code`، فنوازن 401/403.
 */
export function rosterErrorMessage(error: unknown): string {
    if (error instanceof ApiError) {
        if (error.status === 401) {
            return 'انتهت الجلسة — سجّل الدخول في النظام الحالي ثم أعد فتح الوضع الحيّ.';
        }
        if (error.status === 403) {
            return 'لا صلاحية لعرض الدوام بهذا الحساب — القرار للخادم وحده.';
        }
        return `تعذّر تحميل شبكة الدوام: ${error.message}`;
    }
    if (error instanceof Error) {
        return `تعذّر تحميل شبكة الدوام: ${error.message}`;
    }
    return 'تعذّر تحميل شبكة الدوام: خطأ';
}
