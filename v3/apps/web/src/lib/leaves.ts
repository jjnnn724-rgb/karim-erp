import { z } from 'zod';
import { fetchJson } from './api';
import { getAccessToken } from './auth';
import { arSearchKey } from './employees';

/**
 * الإجازات — قراءة فقط من `/api/hr/leave-workflow` و`/api/leaveTypes`.
 *
 * العقد منسوخ من `frontend/app/js/v2/data/leaves-repo.js` — بابٌ واحد للقراءة:
 *
 *   GET /api/hr/leave-workflow → مصفوفةٌ خام من صفوف `leaveRequests` مدمجة
 *     بسلسلة الاعتماد واسم الموظف واسم النوع وأحداث الاعتماد
 *     (`backend/leave-workflow-routes.js:110-121`). بلا LIMIT: الخادم يرسل ما
 *     يراه دور القارئ وحده — admin|manager|hr كل الطلبات، رئيس القسم طلبات
 *     أقسامه، وأي دورٍ آخر طلباته هو فقط أو قائمة فارغة (`:97-109`).
 *   GET /api/leaveTypes?page&limit=1000&sort=id&order=asc → `{data,pagination}`
 *     (CRUD العام في `backend/server.js:1766-1857`). `leaveTypes` ليست في
 *     `sensitiveReadEntities` (`server.js:1401`)، فالقراءة متاحة لكل حساب.
 *
 *   `GET /api/leaveRequests` قائمةٌ غير مقيّدة: يراها كل حساب مُصادق
 *   (`leaveRequests` ليست في `sensitiveReadEntities`، `server.js:1401`)،
 *   ولهذا لم تُستدعى هنا — باب السلسلة هو ما تستعمله الشاشة القديمة، وهو
 *   ما يقيّد النطاق على الخادم لا على الواجهة.
 *
 * لا كتابة في هذا الملف: الإنشاء والاعتماد والرفض وإعادة الطلب وإعادة
 * إرساله كلها كتابة، وتبقى في V2 (`leaves-repo.js:387-413`).
 *
 * لا قيم مخترعة: كلمات الحالات من سجل `status.js` نفسه، وكلمات المراحل
 * والأحداث من خريطة الخادم (`leave-workflow-routes.js:12-18, :90-92`)،
 * والمدة محسوبة من التاريخين المخزَّنين بقاعدة القديم نفسها
 * (`leaves-repo.js:164-171` — شاملةً ليوم البداية). تاريخٌ ناقص أو
 * معكوسٌ يعطي `null` فتُطبع «—» ولا تُخمَّن مدة.
 */

const idValue = z.union([z.string(), z.number()]).transform((value) => String(value));
const optionalId = z
    .union([z.string(), z.number()])
    .nullable()
    .optional()
    .transform((value) => (value === null || value === undefined ? null : String(value)));
const text = z
    .union([z.string(), z.number()])
    .nullable()
    .optional()
    .transform((value) => (value === null || value === undefined ? '' : String(value)));

/* ─── المخططات ─────────────────────────────────────────────────────────── */

/** حدثُ اعتماد داخل السلسلة (`leave_approval_events`) — `leave-workflow-routes.js:42-51`. */
export const leaveWorkflowEventSchema = z
    .object({
        id: z.union([z.string(), z.number()]).nullable().optional(),
        workflow_id: z.union([z.string(), z.number()]).nullable().optional(),
        stage: text,
        action: text,
        note: text,
        actor_role: text,
        created_at: text,
    })
    .passthrough();

export type LeaveWorkflowEvent = z.infer<typeof leaveWorkflowEventSchema>;

/** صفُّ الباب: `leaveRequests` + `leave_approval_workflows` + الأسماء والأحداث. */
export const leaveWorkflowRowSchema = z
    .object({
        id: idValue,
        employeeId: optionalId,
        leaveTypeId: optionalId,
        startDate: text,
        endDate: text,
        status: text,
        reason: text,
        rejectionReason: text,
        requestDate: text,
        approvedDate: text,
        rejectedDate: text,
        completed_at: text,
        workflow_id: optionalId,
        current_stage: text,
        workflow_status: text,
        current_note: text,
        employee_name: text,
        leave_type_name: text,
        leave_type_icon: text,
        events: z.array(leaveWorkflowEventSchema).nullable().optional(),
    })
    .passthrough();

export type LeaveWorkflowRow = z.infer<typeof leaveWorkflowRowSchema>;

const leaveWorkflowListSchema = z.union([
    z.array(leaveWorkflowRowSchema),
    z.object({ data: z.array(leaveWorkflowRowSchema) }).passthrough(),
]);

/** نوعُ إجازة مخزّن (`schema-registry.js:198-206`): id, name, days, icon, paid. */
export const leaveTypeSchema = z
    .object({
        id: idValue,
        name: text,
        days: z.union([z.string(), z.number()]).nullable().optional(),
        icon: text,
        paid: z
            .union([z.boolean(), z.number(), z.string()])
            .nullable()
            .optional()
            .transform((value) => value === true || value === 1 || value === '1' || value === 'true'),
    })
    .passthrough();

export type LeaveType = z.infer<typeof leaveTypeSchema>;

const paginationSchema = z
    .object({
        total: z.union([z.string(), z.number()]).nullable().optional(),
        totalPages: z.union([z.string(), z.number()]).nullable().optional(),
    })
    .partial()
    .passthrough();

const leaveTypeListSchema = z.union([
    z.array(leaveTypeSchema),
    z
        .object({
            data: z.array(leaveTypeSchema),
            pagination: paginationSchema.nullable().optional(),
        })
        .passthrough(),
]);

/* ─── الجلب ────────────────────────────────────────────────────────────── */

/** سقف صفحة الأنواع ومسارها — `leaves-repo.js:58, :138`. */
export const LEAVES_TYPE_PAGE = 1000;
export const LEAVES_TYPE_PAGES = 5;

export function leaveWorkflowPath(): string {
    return '/api/hr/leave-workflow';
}

export function leaveTypesPath(page: number): string {
    return `/api/leaveTypes?page=${String(page)}&limit=${String(LEAVES_TYPE_PAGE)}&sort=id&order=asc`;
}

/** `leaves-repo.js:127-130` حرفيًا: الباب يرسل مصفوفة، والغلاف `{data}` مقبول. */
export async function fetchLeaveWorkflow(signal?: AbortSignal): Promise<LeaveWorkflowRow[]> {
    const body = await fetchJson(leaveWorkflowListSchema, leaveWorkflowPath(), getAccessToken(), signal ? { signal } : {});
    return Array.isArray(body) ? body : body.data;
}

export type LeaveTypesResult = {
    rows: LeaveType[];
    total: number;
    capped: boolean;
};

/** `leaves-repo.js:133-147` حرفيًا: مشيٌ محدود 5 × 1000 مع علم القطع الصادق. */
export async function fetchLeaveTypes(signal?: AbortSignal): Promise<LeaveTypesResult> {
    const rows: LeaveType[] = [];
    let total = 0;
    let capped = false;
    for (let page = 1; page <= LEAVES_TYPE_PAGES; page += 1) {
        const body = await fetchJson(leaveTypeListSchema, leaveTypesPath(page), getAccessToken(), signal ? { signal } : {});
        const batch = Array.isArray(body) ? body : body.data;
        const pagination = Array.isArray(body) ? undefined : body.pagination;
        const parsedTotal = Number(pagination?.total ?? 0);
        if (Number.isFinite(parsedTotal) && parsedTotal > 0) {
            total = parsedTotal;
        }
        rows.push(...batch);
        const totalPages = Number(pagination?.totalPages ?? 0);
        if (!batch.length || (totalPages > 0 && page >= totalPages) || batch.length < LEAVES_TYPE_PAGE) {
            break;
        }
        if (page === LEAVES_TYPE_PAGES) {
            capped = true;
        }
    }
    return { rows, total: total || rows.length, capped };
}

/* ─── خرائط الكلمات ────────────────────────────────────────────────────── */

/** كلمات المراحل من خريطة الخادم — `leave-workflow-routes.js:12-18`. */
export const STAGE_LABELS_AR: Record<string, string> = {
    employee: 'الموظف',
    direct_manager: 'المدير المباشر',
    // مرحلة ملغاة، محفوظة للسجلات القديمة (leave-workflow-routes.js:15).
    operations_manager: 'مدير التشغيل',
    general_manager: 'المدير العام',
    hr: 'شؤون العاملين',
};

/** كلمات الأحداث — `eventLabel()` في `leave-workflow-routes.js:90-92` حرفيًا. */
export const EVENT_LABELS_AR: Record<string, string> = {
    submitted: 'تم تقديم الطلب',
    approve: 'تمت الموافقة على المرحلة',
    reject: 'تم رفض الطلب',
    return: 'أعيد للموظف للتعديل',
    resubmit: 'أعيد إرسال الطلب',
};

/** حالات السلسلة — `status.js:105-108` (نفس كلمات `features/hr.js:573`). */
export const LEAVE_WORKFLOW_STATUS_AR: Record<string, string> = {
    in_progress: 'قيد الاعتماد',
    returned: 'عاد للموظف للتعديل',
    completed: 'معتمد نهائيًا',
    rejected: 'مرفوض',
};

/** حالات الكيان المخزّنة — `status.js:96-99`. */
export const LEAVE_STATUS_AR: Record<string, string> = {
    pending: 'معلق',
    approved: 'معتمد',
    rejected: 'مرفوض',
    returned: 'عاد للموظف للتعديل',
};

export type StatusPresentation = { label: string; known: boolean };

function lookupLabel(map: Record<string, string>, key: string): StatusPresentation {
    if (!key) {
        return { label: '—', known: false };
    }
    return Object.hasOwn(map, key) ? { label: map[key] ?? key, known: true } : { label: key, known: false };
}

/** كلمة الحالة كما تُعرض: من نطاق السلسلة إن وُجد، وإلا من نطاق الكيان. */
export function leaveStatusLabel(domain: 'leave_workflow' | 'leave', key: string): StatusPresentation {
    return domain === 'leave_workflow' ? lookupLabel(LEAVE_WORKFLOW_STATUS_AR, key) : lookupLabel(LEAVE_STATUS_AR, key);
}

/**
 * `leaves-repo.js:117-124` حرفيًا: سطر النطاق يقول للقارئ ما يراه دوره،
 * فلا يُقرأ فراغُ القائمة «لا إجازات في الشركة».
 */
export function doorScopeNote(role: string): string {
    const r = String(role ?? '');
    if (['admin', 'manager', 'hr'].includes(r)) {
        return 'نطاق العرض: كل الطلبات — يراها مدير النظام ومدير المطعم والموارد البشرية';
    }
    if (r === 'dept_head') {
        return 'نطاق العرض: طلبات قسمك أو أقسامك';
    }
    return 'نطاق العرض: طلباتك أنت فقط؛ وبلا ملف موظف مرتبط بالحساب تبقى القائمة فارغة';
}

/* ─── المدة ────────────────────────────────────────────────────────────── */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * عدد الأيام شاملاً يوم البداية — `leaves-repo.js:164-171` حرفيًا (نفس قاعدة
 * `features/hr.js:574` في القديم: `Math.ceil(diff/86400000)+1`).
 * التواريخ مخزَّنة `YYYY-MM-DD` (ADR-05) فلا تُبنى تاريخٌ من تاريخ: الحساب
 * على طابع UTC مبنيّ من النصّ المخزَّن، والنطاق المعكوس أو الناقص يعطي
 * `null` فتُطبع «—» بدل مدةٍ مخترعة.
 */
export function leaveDays(from: string, to: string): number | null {
    const a = String(from ?? '').slice(0, 10);
    const b = String(to ?? '').slice(0, 10);
    if (!DATE_RE.test(a) || !DATE_RE.test(b) || a > b) {
        return null;
    }
    const ms = Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`);
    if (!Number.isFinite(ms) || ms < 0) {
        return null;
    }
    return Math.round(ms / 86400000) + 1;
}

/* ─── الصفّ ────────────────────────────────────────────────────────────── */

/** خريطة الأنواع بالـid — `leaves-repo.js:149-155`. */
export function leaveTypeMap(types: readonly LeaveType[]): Map<string, LeaveType> {
    const map = new Map<string, LeaveType>();
    for (const type of types) {
        if (type && type.id !== undefined && type.id !== null) {
            map.set(String(type.id), type);
        }
    }
    return map;
}

export type LeaveRequestRow = {
    id: string;
    employee: string;
    employeeResolved: boolean;
    employeeKey: string;
    type: string;
    typeResolved: boolean;
    typeId: string;
    typePaid: boolean;
    start: string;
    end: string;
    days: number | null;
    requestDate: string;
    decidedAt: string;
    note: string;
    status: string;
    wfStatus: string;
    hasChain: boolean;
    stage: string;
    stageAr: string;
    stageKnown: boolean;
    stateDomain: 'leave_workflow' | 'leave';
    stateKey: string;
    stateLabel: string;
    stateKnown: boolean;
    events: LeaveWorkflowEvent[];
};

/**
 * صفُّ الباب ← صفُّ الجدول — `leaves-repo.js:181-223` حرفيًا.
 *
 * حالة السلسلة (`workflow_status`) هي التي يقودها الشارة والترشيح، وحالة
 * الكيان (`status`) تبقى factٌ ثانويٌّ على الصفّ — طلبٌ معتمدٌ عند المدير
 * العام يقرأ «معلّقًا» في الكيان.
 */
export function leaveToRow(
    raw: LeaveWorkflowRow,
    typeById: ReadonlyMap<string, LeaveType> = new Map<string, LeaveType>(),
): LeaveRequestRow {
    const type = typeById.get(String(raw.leaveTypeId ?? ''));
    const status = raw.status;
    const wf = raw.workflow_status;
    const stage = raw.current_stage;
    const start = raw.startDate ? raw.startDate.slice(0, 10) : '';
    const end = raw.endDate ? raw.endDate.slice(0, 10) : '';
    const typeName = raw.leave_type_name ? raw.leave_type_name : type?.name ? String(type.name) : '';
    // `features/hr.js:574` يطبع الملاحظةُ الحالية قبل السبب — كلمةُ السلسلة
    // الأحدث هي الأحدث fact.
    const note = raw.current_note ? raw.current_note : raw.rejectionReason ? raw.rejectionReason : raw.reason;
    const state = leaveStateOf(wf, status);
    const stateLabel = leaveStatusLabel(state.domain, state.key);
    const stageKnown = Object.hasOwn(STAGE_LABELS_AR, stage);
    return {
        id: raw.id,
        employee: raw.employee_name ? raw.employee_name : raw.employeeId ? `#${raw.employeeId}` : '—',
        employeeResolved: Boolean(raw.employee_name),
        employeeKey: raw.employeeId ?? '',
        type: typeName || (raw.leaveTypeId ? `#${raw.leaveTypeId}` : '—'),
        typeResolved: Boolean(typeName),
        typeId: raw.leaveTypeId ?? '',
        typePaid: Boolean(type?.paid),
        start,
        end,
        days: leaveDays(start, end),
        requestDate: raw.requestDate ? raw.requestDate.slice(0, 10) : '',
        decidedAt: raw.completed_at
            ? raw.completed_at.slice(0, 10)
            : raw.approvedDate
              ? raw.approvedDate.slice(0, 10)
              : raw.rejectedDate
                ? raw.rejectedDate.slice(0, 10)
                : '',
        note,
        status,
        wfStatus: wf,
        hasChain: raw.workflow_id !== null && raw.workflow_id !== undefined,
        stage,
        stageAr: STAGE_LABELS_AR[stage] ?? '',
        stageKnown,
        stateDomain: state.domain,
        stateKey: state.key,
        stateLabel: stateLabel.label,
        stateKnown: stateLabel.known,
        events: Array.isArray(raw.events) ? raw.events : [],
    };
}

/** `leaves-repo.js:230-233`: السلسلة أولًا، وإلا حالة الكيان المخزّنة. */
export function leaveStateOf(wfStatus: string, status: string): { domain: 'leave_workflow' | 'leave'; key: string } {
    if (wfStatus) {
        return { domain: 'leave_workflow', key: wfStatus };
    }
    return { domain: 'leave', key: status };
}

/* ─── المجاميع ─────────────────────────────────────────────────────────── */

export type LeaveSummary = {
    total: number;
    inProgress: number;
    completed: number;
    rejected: number;
    returned: number;
    other: number;
    daysApproved: number;
    daysApprovedOf: number;
    avgDays: number | null;
    avgDaysOf: number;
    employees: number;
};

/** `leaves-repo.js:236-263` حرفيًا: العدّ على السجل الذي أرسله الباب. */
export function summarizeLeaves(rows: readonly LeaveRequestRow[]): LeaveSummary {
    const summary: LeaveSummary = {
        total: rows.length,
        inProgress: 0,
        completed: 0,
        rejected: 0,
        returned: 0,
        other: 0,
        daysApproved: 0,
        daysApprovedOf: 0,
        avgDays: null,
        avgDaysOf: 0,
        employees: 0,
    };
    const employees = new Set<string>();
    const durations: number[] = [];
    for (const row of rows) {
        if (row.wfStatus === 'completed') {
            summary.completed += 1;
        } else if (row.wfStatus === 'rejected') {
            summary.rejected += 1;
        } else if (row.wfStatus === 'returned') {
            summary.returned += 1;
        } else if (row.wfStatus === 'in_progress') {
            summary.inProgress += 1;
        }
        // طلبٌ معتمدٌ في منتصف السلسلة ما زال مفتوحًا، فمجموع الأيام يعدّ
        // الإقرارات المغلقة فقط — ويعلن في التلميح عدد الطلبات التي عُدّت.
        if (row.wfStatus === 'completed' || row.status === 'approved') {
            summary.daysApprovedOf += 1;
            if (row.days !== null) {
                summary.daysApproved += row.days;
            }
        }
        if (row.days !== null) {
            durations.push(row.days);
        }
        if (row.employeeKey) {
            employees.add(row.employeeKey);
        }
    }
    summary.employees = employees.size;
    summary.avgDaysOf = durations.length;
    summary.avgDays = durations.length ? Math.round((durations.reduce((a, b) => a + b, 0) / durations.length) * 10) / 10 : null;
    return summary;
}

export type LeaveKpi = {
    id: string;
    label: string;
    en: string;
    value: number;
    unit: string;
    hint: string;
};

/**
 * `leaves-repo.js:270-305` حريفًا: ستّ بطاقات، وكل تلميحٍ يسمّي أساس عدّه —
 * الباب بلا LIMIT، فالأساس «ما أرسله دورك».
 */
export function buildLeavesKpis(summary: LeaveSummary, typeCount: number, paidTypes: number): LeaveKpi[] {
    return [
        {
            id: 'in_progress',
            label: 'قيد الاعتماد',
            en: 'In Chain',
            value: summary.inProgress,
            unit: '',
            hint: `من ${summary.total} طلبًا أرسله الباب لدورك`,
        },
        {
            id: 'completed',
            label: 'معتمدة نهائيًا',
            en: 'Approved',
            value: summary.completed,
            unit: '',
            hint: `من ${summary.total} طلبًا في هذا السجل — القفل لدى شؤون العاملين`,
        },
        {
            id: 'rejected',
            label: 'مرفوضة',
            en: 'Rejected',
            value: summary.rejected,
            unit: '',
            hint: `من ${summary.total} طلبًا في هذا السجل؛ سبب الرفض في عمود الملاحظة`,
        },
        {
            id: 'returned',
            label: 'عادت للموظف',
            en: 'Returned',
            value: summary.returned,
            unit: '',
            hint: `من ${summary.total} طلبًا في هذا السجل — أُعيدت إلى الموظف عند مرحلة employee`,
        },
        {
            id: 'days',
            label: 'أيام معتمدة',
            en: 'Approved Days',
            value: summary.daysApproved,
            unit: 'يوم',
            hint: summary.daysApprovedOf
                ? `مجموع المدة المحسوبة تقويمًا شاملًا لـ${summary.daysApprovedOf} طلبًا معتمدًا من هذا السجل (غير المحسوبة لا تُجمَع)`
                : 'لا طلب معتمد في السجل المرسل',
        },
        {
            id: 'types',
            label: 'أنواع الإجازات',
            en: 'Leave Types',
            value: typeCount,
            unit: '',
            hint: paidTypes ? `${paidTypes} مدفوعة الأجر من ${typeCount} نوعًا مخزّنًا` : `لا نوع مدفوع من ${typeCount} مخزّنًا`,
        },
    ];
}

export type TopRequester = {
    name: string;
    resolved: boolean;
    count: number;
    open: number;
};

/**
 * `leaves-repo.js:312-327` حرفيًا: ترتيبٌ محسوب هنا، وتساويُ الروابط
 * بترتيب الخادم (الأحدث طلبًا أولًا) — يعلنه نصُّ اللوحة.
 */
export function topRequesters(rows: readonly LeaveRequestRow[], limit = 6): TopRequester[] {
    const by = new Map<string, TopRequester>();
    for (const row of rows) {
        const key = row.employeeKey || row.employee;
        const current = by.get(key);
        if (current) {
            current.count += 1;
        } else {
            by.set(key, { name: row.employee, resolved: row.employeeResolved, count: 1, open: 0 });
        }
        if (row.wfStatus === 'in_progress') {
            const hit = by.get(key);
            if (hit) {
                hit.open += 1;
            }
        }
    }
    return [...by.values()]
        .map((value, index) => ({ value, index }))
        .sort((a, b) => b.value.count - a.value.count || a.index - b.index)
        .slice(0, limit)
        .map((item) => item.value);
}

export type LeaveEventRow = {
    key: string;
    requestId: string;
    employee: string;
    stage: string;
    stageAr: string;
    stageKnown: boolean;
    action: string;
    actionAr: string;
    actionKnown: boolean;
    note: string;
    actorRole: string;
    at: string;
};

/** `leaves-repo.js:331-355` حرفيًا: أحداث السلسلة مسطّحة، الأحدث أولًا. */
export function flattenEvents(rows: readonly LeaveRequestRow[]): LeaveEventRow[] {
    const out: LeaveEventRow[] = [];
    for (const row of rows) {
        for (const event of row.events) {
            if (!event || typeof event !== 'object') {
                continue;
            }
            const action = event.action ? String(event.action) : '';
            const stage = event.stage ? String(event.stage) : '';
            const stageKnown = Object.hasOwn(STAGE_LABELS_AR, stage);
            const actionKnown = Object.hasOwn(EVENT_LABELS_AR, action);
            out.push({
                key: `${event.workflow_id ?? row.id}-${event.id ?? out.length}`,
                requestId: row.id,
                employee: row.employee,
                stage,
                stageAr: STAGE_LABELS_AR[stage] ?? '',
                stageKnown,
                action,
                actionAr: EVENT_LABELS_AR[action] ?? '',
                actionKnown,
                note: event.note ? String(event.note) : '',
                actorRole: event.actor_role ? String(event.actor_role) : '',
                at: event.created_at ? String(event.created_at).slice(0, 16).replace('T', ' ') : '',
            });
        }
    }
    return out.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
}

export type LeaveTypeRow = {
    id: string;
    name: string;
    days: number | null;
    paid: boolean;
    icon: string;
    requests: number;
};

/** `leaves-repo.js:358-369` حرفيًا: `days` رصيدٌ مخزَّن قد يكون فارغًا. */
export function typeToRow(type: LeaveType, requestCount = 0): LeaveTypeRow {
    const raw = type.days;
    const days = raw === null || raw === undefined || raw === '' ? Number.NaN : Number(raw);
    return {
        id: type.id,
        name: type.name ? String(type.name) : `#${type.id}`,
        days: Number.isFinite(days) ? days : null,
        paid: Boolean(type.paid),
        icon: type.icon ? String(type.icon) : '',
        requests: requestCount,
    };
}

/** عدد الطلبات لكل نوع — `leaves.js:614-618` في الشاشة القديمة. */
export function requestsByType(rows: readonly LeaveRequestRow[]): Map<string, number> {
    const byType = new Map<string, number>();
    for (const row of rows) {
        if (row.typeId) {
            byType.set(row.typeId, (byType.get(row.typeId) ?? 0) + 1);
        }
    }
    return byType;
}

/* ─── البحث ────────────────────────────────────────────────────────────── */

export type LeaveSearch = {
    rows: LeaveRequestRow[];
    matched: boolean;
    folded: boolean;
    hits: number;
};

/**
 * بحثُ الجدول القديم: نصٌّ واحدٌ يُطابَق كسلسلةٍ فرعية في أي عمودٍ ظاهر
 * (`data-table.js:191-195` في V2). هنا تمرّ المطابقة الخامسة أولًا، ثم
 * المطابقة المطبَّعة عبر `arSearchKey` (جدول `employees-repo.js:306-314`)،
 * وتُعلَن المطبَّعة صراحةً — البحث الذكي مطبَّق لا صامت.
 */
function searchFields(row: LeaveRequestRow): string[] {
    return [
        row.employee,
        row.type,
        row.stageKnown ? row.stageAr : row.stage,
        row.note,
        row.stateLabel,
        row.start,
        row.end,
        row.requestDate,
    ].map((field) => String(field ?? ''));
}

export function searchLeaveRequests(rows: readonly LeaveRequestRow[], query: string): LeaveSearch {
    const raw = String(query ?? '').trim();
    if (!raw) {
        return { rows: [...rows], matched: false, folded: false, hits: rows.length };
    }
    const lower = raw.toLowerCase();
    const key = arSearchKey(raw);
    const kept: { row: LeaveRequestRow; folded: boolean }[] = [];
    for (const row of rows) {
        const fields = searchFields(row);
        if (fields.some((field) => field.toLowerCase().includes(lower))) {
            kept.push({ row, folded: false });
            continue;
        }
        if (key && fields.some((field) => arSearchKey(field).includes(key))) {
            kept.push({ row, folded: true });
        }
    }
    return {
        rows: kept.map((item) => item.row),
        matched: true,
        folded: kept.some((item) => item.folded),
        hits: kept.length,
    };
}
