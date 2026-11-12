import { z } from 'zod';
import { fetchJson } from './api';
import { getAccessToken } from './auth';
import { isWriteRole, writeAck, writeJson } from './write';

/**
 * كتابة الدوام — الأبواب الثلاثة التي كانت في V2:
 *
 *   حفظ شبكة الأسبوع   POST /api/hr/dept-roster-week            (hr-routes.js:1341)
 *   طلب اعتماد الطباعة POST /api/hr/dept-roster-approval/request (hr-routes.js:1280)
 *   اعتماد الطباعة     POST /api/hr/dept-roster-approval/approve (hr-routes.js:1319)
 *   طلبات معلّقة       GET  /api/hr/dept-roster-approval/pending (hr-routes.js:1301)
 *
 * قواعد الخادم المنقولة حرفيًّا:
 *   · الخلية الماضية مرفوضة (`ROSTER_PAST_DATE`) — الماضي محمي.
 *   · الوقت `HH:MM` أو فارغ (فارغ = تبقى وردية الموظف السارية).
 *   · الساعات 1–24، ويوم الراحة 0–6 أو فارغ.
 *   · حد أقصى 700 خلية في الحفظة الواحدة.
 *   · الحفظ يصفّر اعتماد الأسبوع (السلامة أولًا) — الشاشة تعيد قراءة الحالة.
 */

/** أدوار الحفظ — `ROSTER_ROLES` في hr-routes.js:1141. */
export const ROSTER_WRITE_ROLES = ['admin', 'hr', 'manager', 'dept_head', 'kitchen', 'sous_chef', 'warehouse', 'accountant'] as const;

/** أدوار اعتماد الطباعة — `requireRole('hr','admin')` في الخادم. */
export const ROSTER_APPROVE_ROLES = ['hr', 'admin'] as const;

export function canWriteRoster(role: string | null | undefined): boolean {
    return isWriteRole(role, ROSTER_WRITE_ROLES);
}

export function canApproveRoster(role: string | null | undefined): boolean {
    return isWriteRole(role, ROSTER_APPROVE_ROLES);
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^(\d{1,2}):(\d{2})$/;
const MAX_CELLS = 700;

export interface RosterCellPayload {
    id: string;
    date: string;
    shift_start: string | null;
    shift_hours: number | null;
    day_off: number | null;
}

export interface RosterCellEdit {
    id: string;
    date: string;
    shiftStart: string;
    shiftHours: string;
    dayOff: string;
}

/**
 * تحقق خلية واحدة قبل الإرسال — نفس رسائل الخادم العربية. يعيد '' عند السلامة.
 * `today` يُمرَّر من استجابة الخادم (`data.today`) لا من ساعة المتصفح.
 */
export function rosterCellError(cell: RosterCellEdit, weekStart: string, today: string): string {
    if (!/^\d+$/.test(String(cell.id))) {
        return 'خلية بمعرف موظف غير صالح';
    }
    if (!DATE_PATTERN.test(cell.date)) {
        return `تاريخ خلية غير صالح: ${cell.date}`;
    }
    const day = new Date(`${cell.date}T12:00:00Z`).getTime();
    const start = new Date(`${weekStart}T12:00:00Z`).getTime();
    if (!Number.isFinite(day) || !Number.isFinite(start)) {
        return 'بداية الأسبوع YYYY-MM-DD';
    }
    const diff = Math.round((day - start) / 86_400_000);
    if (diff < 0 || diff > 6) {
        return `تاريخ خلية خارج الأسبوع: ${cell.date}`;
    }
    if (DATE_PATTERN.test(today) && cell.date < today) {
        return `لا يمكن تعديل ماضٍ (${cell.date}) — القديم محمي`;
    }
    const time = String(cell.shiftStart ?? '').trim();
    if (time) {
        const match = TIME_PATTERN.exec(time);
        if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) {
            return `وقت غير صالح (${cell.date}) — الصيغة HH:MM`;
        }
        const hours = Number(cell.shiftHours);
        if (!Number.isFinite(hours) || hours < 1 || hours > 24) {
            return `مدة الدوام 1-24 (${cell.date})`;
        }
    }
    const off = String(cell.dayOff ?? '').trim();
    if (off !== '') {
        const value = Number(off);
        if (!Number.isInteger(value) || value < 0 || value > 6) {
            return `يوم الراحة 0-6 (${cell.date})`;
        }
    }
    return '';
}

/** خلية الواجهة → حمولة الخادم — الحقول الفارغة تصبح `null` كما يفكّها الخادم. */
export function rosterCellPayload(cell: RosterCellEdit): RosterCellPayload {
    const start = String(cell.shiftStart ?? '').trim();
    const time = start ? TIME_PATTERN.exec(start) : null;
    const normalized = time ? `${String(time[1]).padStart(2, '0')}:${time[2]}` : null;
    const hours = normalized ? Number(cell.shiftHours) : null;
    const off = String(cell.dayOff ?? '').trim();
    return {
        id: String(cell.id),
        date: String(cell.date),
        shift_start: normalized,
        shift_hours: normalized && Number.isFinite(hours) ? hours : null,
        day_off: off === '' ? null : Number(off),
    };
}

export type RosterSaveValidation = { ok: true; cells: RosterCellPayload[] } | { ok: false; error: string };

/** تحقق الحفظة كاملة — بالترتيب نفسه الذي يعتمده الخادم. */
export function validateRosterSave(edits: readonly RosterCellEdit[], weekStart: string, today: string): RosterSaveValidation {
    if (!edits.length) {
        return { ok: false, error: 'لا توجد خلايا للحفظ' };
    }
    if (edits.length > MAX_CELLS) {
        return { ok: false, error: 'حد أقصى 700 خلية في الحفظة الواحدة' };
    }
    if (!DATE_PATTERN.test(weekStart)) {
        return { ok: false, error: 'بداية الأسبوع YYYY-MM-DD' };
    }
    for (const edit of edits) {
        const error = rosterCellError(edit, weekStart, today);
        if (error) {
            return { ok: false, error };
        }
    }
    return { ok: true, cells: edits.map(rosterCellPayload) };
}

const saveSchema = z
    .object({ ok: z.boolean().optional(), updated: z.union([z.string(), z.number()]).optional(), week_start: z.string().optional() })
    .passthrough();

export type RosterSaveResult = z.infer<typeof saveSchema>;

export async function saveRosterWeek(weekStart: string, cells: readonly RosterCellPayload[], dept: string): Promise<RosterSaveResult> {
    const payload: Record<string, unknown> = { week_start: weekStart, cells };
    if (dept) {
        payload.dept = dept;
    }
    return writeJson(saveSchema, '/api/hr/dept-roster-week', 'POST', payload);
}

/** طلب اعتماد الطباعة — يعيد ضبط الاعتماد السابق (الخادم). */
export async function requestRosterApproval(weekStart: string, dept: string): Promise<void> {
    const body: Record<string, unknown> = { week_start: weekStart };
    if (dept) {
        body.dept = dept;
    }
    await writeAck('/api/hr/dept-roster-approval/request', 'POST', body);
}

/** اعتماد الطباعة — `dept_key` هو مفتاح الأسبوع الذي يرسله الخادم. */
export async function approveRosterApproval(weekStart: string, deptKey: string): Promise<void> {
    await writeAck('/api/hr/dept-roster-approval/approve', 'POST', {
        week_start: weekStart,
        dept_key: deptKey,
    });
}

const pendingSchema = z
    .object({
        ok: z.boolean().optional(),
        week: z.string().optional(),
        pending: z.array(
            z
                .object({
                    dept_key: z.string(),
                    week_start: z.string(),
                    requested_name: z.string().nullable().optional(),
                    requested_at: z.string().nullable().optional(),
                })
                .passthrough(),
        ),
    })
    .passthrough();

export type RosterPending = z.infer<typeof pendingSchema>;

export async function fetchPendingRosterApprovals(week: string, signal?: AbortSignal): Promise<RosterPending> {
    const query = week ? `?week=${encodeURIComponent(week)}` : '';
    return fetchJson(pendingSchema, `/api/hr/dept-roster-approval/pending${query}`, getAccessToken(), {
        ...(signal ? { signal } : {}),
    });
}

export const ROSTER_WRITE_TEXT = {
    save: 'حفظ الأسبوع',
    saveHint: 'الخلايا الماضية مقفلة عند الخادم. الحفظ يلغي اعتماد الطباعة السابق لهذا الأسبوع.',
    saved: (count: number) => `حُفظت ${String(count)} خلية دوام`,
    saveFailed: 'تعذر حفظ شبكة الأسبوع',
    dirty: (count: number) => `${String(count)} خلية معدّلة لم تُحفظ بعد`,
    noChanges: 'لا تغييرات للحفظ',
    request: 'طلب اعتماد الطباعة',
    requestHint: 'يوقّع شؤون العاملين على دوامات الأسبوع قبل الطباعة.',
    requested: 'أُرسل طلب اعتماد الطباعة',
    requestFailed: 'تعذر إرسال طلب الاعتماد',
    approve: 'اعتماد الطباعة',
    approveHint: 'يعتمد دوامات الأسبوع المطلوب من رئيس القسم.',
    approved: 'اعتُمدت دوامات الأسبوع',
    approveFailed: 'تعذر اعتماد الدوامات',
    pendingTitle: 'طلبات اعتماد معلّقة',
    pendingEmpty: 'لا طلبات اعتماد معلّقة لهذا الأسبوع.',
    close: 'إغلاق',
} as const;
