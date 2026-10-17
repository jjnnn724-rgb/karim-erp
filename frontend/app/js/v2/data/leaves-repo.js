/**
 * V2 — Leaves repository (الباب الوحيد إلى /api/hr/leave-workflow + /api/leaveTypes)
 * ═══════════════════════════════════════════════════════════════════════
 *
 * CONTRACT COPIED FROM THE SERVER, NOT INVENTED
 *   GET /hr/leave-workflow → bare ARRAY of leaveRequests rows joined with
 *     their workflow, employee name, leave-type name/icon and the approval
 *     events (leave-workflow-routes.js:97-126). No LIMIT: the door sends
 *     every row the caller's role may see, ordered requestDate DESC NULLS
 *     LAST, id DESC (:123).
 *   THE DOOR SCOPES BY ROLE — and says nothing about it, so this file does:
 *     admin|manager|hr      → كل الطلبات            (isPrivileged :71, filter '' :103-105)
 *     dept_head             → طلبات قسمه/أقسامه      (:105-109, dept_code CSV)
 *     أي دور آخر            → طلباته هو فقط، أو قائمة فارغة إن لم يكن حسابه
 *                             موصولًا بملف موظف (:110-112)
 *   GET /leaveTypes?page&limit&sort=id&order → { data, pagination }
 *     (generic entity list, server.js:1454-1521; MAX_LIMIT 1000,
 *     MAX_OFFSET 50000 — pagination.js:16-18). Rows carry id, name, days,
 *     icon, paid (schema-registry.js:196-206).
 *   Failure shapes: 500 {error:'LEAVE_WORKFLOW_LIST_FAILED'} (:125).
 *
 * WHY THIS DOOR AND NOT THE GENERIC REGISTER
 *   GET /api/leaveRequests is an unscoped list: every authenticated account
 *   would pull everyone's leave dates AND reason text into the browser
 *   (leaveRequests is not in sensitiveReadEntities, server.js:1240). The
 *   workflow door is the one the legacy HR page already uses (features/hr.js:580),
 *   it joins the names the table needs, and it carries the approval chain —
 *   which is the only thing that makes a pending row actionable.
 *
 *   One disclosure this door owes its reader: reading it runs
 *   ensureLeaveWorkflowSchema() (:99), a CREATE TABLE IF NOT EXISTS plus an
 *   idempotent backfill of missing workflow rows (:29-64), cached in a
 *   promise. It is self-bootstrapping, not a write screen asks for — stated
 *   here because "read-only screen" must mean exactly what it says.
 *
 * NO INVENTED DISPLAY VALUES
 *   Status words live in the shared registry (status.js:79-97), whose labels
 *   are copied from features/hr.js:573-574 — this file only decides WHICH
 *   domain a stored value belongs to. Stage words, event words and action
 *   gates are the server's own maps (leave-workflow-routes.js:11-22, :93-95)
 *   mirrored with line numbers; an unmirrored value renders raw.
 *   Duration is computed HERE from the two stored dates, inclusively — the
 *   same rule the legacy page applies (features/hr.js:586). A malformed or
 *   reversed range yields null and prints «—», never a guessed number.
 *
 * WRITES (wave 2, owner-approved): decisions go ONLY through the staged
 *   workflow. The server forbids direct edits of this entity
 *   (405 LEAVE_WORKFLOW_REQUIRED, server.js:2056) and re-checks stage, role,
 *   self-approval ban and department scope on every click. This file offers
 *   اعتماد and رفض because those are what شاشة 10 promised in the ledger;
 *   return/resubmit exist on the door (:179) and stay unexposed until their
 *   own screen decides.
 */

import { apiFetch } from '../../core/api.js?v=4.9.145';

/** Server caps for the reference walk, copied from pagination.js:17-18. */
export const LEAVES_TYPE_PAGE = 1000;
export const LEAVES_TYPE_PAGES = 5;

/* leave-workflow-routes.js:11-17 — the chain's own words for each stage. */
export const STAGE_LABELS_AR = {
    employee: 'الموظف',
    direct_manager: 'المدير المباشر',
    operations_manager: 'مدير التشغيل', // مرحلة ملغاة، محفوظة للسجلات القديمة (:14)
    general_manager: 'المدير العام',
    hr: 'شؤون العاملين',
};

/* leave-workflow-routes.js:93-95 — eventLabel(), verbatim. */
export const EVENT_LABELS_AR = {
    submitted: 'تم تقديم الطلب',
    approve: 'تمت الموافقة على المرحلة',
    reject: 'تم رفض الطلب',
    return: 'أعيد للموظف للتعديل',
    resubmit: 'أعيد إرسال الطلب',
};

/* leave-workflow-routes.js:18-22 — which role holds which stage. The server
 * is the authority; this mirror only decides which buttons a screen paints. */
export const STAGE_ROLES = {
    direct_manager: ['manager', 'admin', 'dept_head'],
    general_manager: ['admin', 'manager'],
    hr: ['hr', 'admin'],
};

/* leave-workflow-routes.js:10 — STAGES, the chain's order. An approve walks it
 * (:212-215) and the last one closes the request instead of passing it on, so
 * a confirmation that promises «المرحلة التالية» at hr would promise a stage
 * that does not exist. */
export const LEAVE_CHAIN = ['direct_manager', 'general_manager', 'hr'];

/** Where an approve at `stage` leaves the request, in the chain's own keys:
 *  `final` when it closes (hr, :214), the next holder otherwise (:215), and
 *  `known:false` for a stage the server's chain does not contain — the screen
 *  then says nothing about a next stage rather than inventing one. */
export function approveOutcome(stage) {
    const at = LEAVE_CHAIN.indexOf(String(stage || ''));
    if (at < 0) {return { known: false, final: false, next: '' };}
    if (at === LEAVE_CHAIN.length - 1) {return { known: true, final: true, next: '' };}
    return { known: true, final: false, next: LEAVE_CHAIN[at + 1] };
}

/**
 * Mirror of canActOnStage (:75-78) plus the legacy page's own actionable test
 * (features/hr.js:582): only an in_progress chain can be decided, admin acts
 * at any stage, everyone else must match STAGE_ROLES for that stage.
 */
export function canActOnStage(role, stage, workflowStatus) {
    if (workflowStatus !== 'in_progress') {return false;}
    if (role === 'admin') {return true;}
    return (STAGE_ROLES[stage] || []).includes(role);
}

/** The roles the door treats as privileged (:71) — used only to tell the
 *  reader what scope their own list has. */
export function doorScopeNote(role) {
    const r = String(role || '');
    if (['admin', 'manager', 'hr'].includes(r)) {
        return 'نطاق الباب: كل الطلبات (admin|manager|hr — :103)';
    }
    if (r === 'dept_head') {return 'نطاق الباب: طلبات قسمك/أقسامك (:105-109)';}
    return 'نطاق الباب: طلباتك أنت فقط؛ بلا ملف موظف موصول بالحساب تكون القائمة فارغة (:110-112)';
}

/** @returns {Promise<any[]>} joined rows exactly as the door sent them */
export async function fetchLeaveWorkflow() {
    const res = await apiFetch('/hr/leave-workflow');
    return Array.isArray(res) ? res : (res && Array.isArray(res.data) ? res.data : []);
}

/** Bounded walk of the reference list (5 × 1000) + its honest truncation flag. */
export async function fetchLeaveTypes() {
    const rows = [];
    let total = 0;
    let capped = false;
    for (let page = 1; page <= LEAVES_TYPE_PAGES; page += 1) {
        const res = await apiFetch(`/leaveTypes?page=${page}&limit=${LEAVES_TYPE_PAGE}&sort=id&order=asc`);
        const batch = res && Array.isArray(res.data) ? res.data : (Array.isArray(res) ? res : []);
        total = Number(res && res.pagination && res.pagination.total) || total;
        rows.push(...batch);
        const totalPages = Number(res && res.pagination && res.pagination.totalPages) || 0;
        if (!batch.length || (totalPages > 0 && page >= totalPages) || batch.length < LEAVES_TYPE_PAGE) {break;}
        if (page === LEAVES_TYPE_PAGES) {capped = true;}
    }
    return { rows, total: total || rows.length, capped };
}

export function leaveTypeMap(types = []) {
    const map = new Map();
    for (const t of types) {
        if (t && t.id !== undefined && t.id !== null) {map.set(String(t.id), t);}
    }
    return map;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Inclusive day count between two stored YYYY-MM-DD dates — the legacy page's
 * rule (features/hr.js:586 adds the start day). Malformed or reversed ranges
 * yield null so the table prints «—» instead of inventing a duration.
 */
export function leaveDays(from, to) {
    const a = String(from || '').slice(0, 10);
    const b = String(to || '').slice(0, 10);
    if (!DATE_RE.test(a) || !DATE_RE.test(b) || a > b) {return null;}
    const ms = Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`);
    if (!Number.isFinite(ms) || ms < 0) {return null;}
    return Math.round(ms / 86400000) + 1;
}

/**
 * Door row → table row. Pure and exported so it is testable without a browser.
 *
 * The chain's state (workflow_status) is what a decision acts on, so it
 * drives the badge and the filter; the stored leaveRequests.status stays on
 * the row as the secondary fact, because an approved chain at the
 * general-manager stage still reads pending in the entity (:219).
 */
export function leaveToRow(l = {}, typeById = new Map()) {
    const type = typeById.get(String(l.leaveTypeId));
    const status = l.status !== undefined && l.status !== null ? String(l.status) : '';
    const wf = l.workflow_status !== undefined && l.workflow_status !== null
        ? String(l.workflow_status) : '';
    const stage = l.current_stage !== undefined && l.current_stage !== null
        ? String(l.current_stage) : '';
    const start = l.startDate ? String(l.startDate).slice(0, 10) : '';
    const end = l.endDate ? String(l.endDate).slice(0, 10) : '';
    const typeName = l.leave_type_name ? String(l.leave_type_name)
        : (type && type.name ? String(type.name) : '');
    // features/hr.js:586 prints current_note before reason — the chain's
    // latest word wins because it is the newer fact.
    const note = l.current_note ? String(l.current_note)
        : (l.rejectionReason ? String(l.rejectionReason)
            : (l.reason ? String(l.reason) : ''));
    return {
        id: l.id,
        employee: l.employee_name ? String(l.employee_name)
            : (l.employeeId ? `#${l.employeeId}` : '—'),
        employeeResolved: !!l.employee_name,
        employeeKey: l.employeeId !== undefined && l.employeeId !== null ? String(l.employeeId) : '',
        type: typeName || (l.leaveTypeId ? `#${l.leaveTypeId}` : '—'),
        typeResolved: !!typeName,
        typeId: l.leaveTypeId !== undefined && l.leaveTypeId !== null ? String(l.leaveTypeId) : '',
        typePaid: !!(type && type.paid),
        start,
        end,
        days: leaveDays(start, end),
        requestDate: l.requestDate ? String(l.requestDate).slice(0, 10) : '',
        decidedAt: l.completed_at ? String(l.completed_at).slice(0, 10)
            : (l.approvedDate ? String(l.approvedDate).slice(0, 10)
                : (l.rejectedDate ? String(l.rejectedDate).slice(0, 10) : '')),
        note,
        status,
        wfStatus: wf,
        hasChain: l.workflow_id !== undefined && l.workflow_id !== null,
        stage,
        stageAr: STAGE_LABELS_AR[stage] || '',
        stageKnown: !!STAGE_LABELS_AR[stage],
        events: Array.isArray(l.events) ? l.events : [],
    };
}

/**
 * Door row → badge inputs. The chain word is the display state when the row
 * carries a workflow; without one the stored entity status is shown under
 * the `leave` domain (the door backfills, so this is the rare path).
 */
export function leaveStateOf(row) {
    if (row.wfStatus) {return { domain: 'leave_workflow', key: row.wfStatus };}
    return { domain: 'leave', key: row.status };
}

/** Counts over the register the door sent — derived, never fetched. */
export function summarizeLeaves(rows = []) {
    const s = {
        total: rows.length,
        inProgress: 0, completed: 0, rejected: 0, returned: 0, other: 0,
        daysApproved: 0, daysApprovedOf: 0, avgDays: null, avgDaysOf: 0,
        employees: 0,
    };
    const emps = new Set();
    const durations = [];
    for (const r of rows) {
        if (r.wfStatus === 'completed') {s.completed += 1;} else if (r.wfStatus === 'rejected') {s.rejected += 1;}
        else if (r.wfStatus === 'returned') {s.returned += 1;} else if (r.wfStatus === 'in_progress') {s.inProgress += 1;}
        // An approved entity at a mid-chain stage is still an open case, so
        // the day total counts closed approvals only — and says which rows.
        if (r.wfStatus === 'completed' || r.status === 'approved') {
            s.daysApprovedOf += 1;
            if (r.days !== null) {s.daysApproved += r.days;}
        }
        if (r.days !== null) {durations.push(r.days);}
        if (r.employeeKey) {emps.add(r.employeeKey);}
    }
    s.employees = emps.size;
    s.avgDaysOf = durations.length;
    s.avgDays = durations.length
        ? Math.round((durations.reduce((a, b) => a + b, 0) / durations.length) * 10) / 10
        : null;
    return s;
}

/**
 * The KPI band. Six cards, and each hint names the base its number counts —
 * the door has no LIMIT, so the base is «what your role was sent», which
 * differs between an HR account and a department head.
 */
export function buildLeavesKpis(s = {}, typeCount = 0, paidTypes = 0) {
    return [
        {
            id: 'in_progress', icon: 'hourglass', label: 'قيد الاعتماد', en: 'In Chain',
            value: s.inProgress, unit: '',
            hint: `من ${s.total} طلبًا أرسله الباب لدورك`,
        },
        {
            id: 'completed', icon: 'circle-check', label: 'معتمدة نهائيًا', en: 'Approved',
            value: s.completed, unit: '',
            hint: `من ${s.total} طلبًا في هذا السجل — القفل لدى شؤون العاملين (:214)`,
        },
        {
            id: 'rejected', icon: 'circle-x', label: 'مرفوضة', en: 'Rejected',
            value: s.rejected, unit: '',
            hint: `من ${s.total} طلبًا في هذا السجل؛ سبب الرفض في عمود الملاحظة`,
        },
        {
            id: 'returned', icon: 'corner-up-left', label: 'عادت للموظف', en: 'Returned',
            value: s.returned, unit: '',
            hint: `من ${s.total} طلبًا في هذا السجل — أُعيدت إلى الموظف عند مرحلة employee (:217)`,
        },
        {
            id: 'days', icon: 'calendar-days', label: 'أيام معتمدة', en: 'Approved Days',
            value: s.daysApproved, unit: 'يوم',
            hint: s.daysApprovedOf
                ? `مجموع المدة المحسوبة تقويمًا شاملًا لـ${s.daysApprovedOf} طلبًا معتمدًا من هذا السجل (غير المحسوبة لا تُجمَع)`
                : 'لا طلب معتمد في السجل المرسل',
        },
        {
            id: 'types', icon: 'clipboard-list', label: 'أنواع الإجازات', en: 'Leave Types',
            value: typeCount, unit: '',
            hint: paidTypes ? `${paidTypes} مدفوعة الأجر من ${typeCount} نوعًا مخزّنًا` : `لا نوع مدفوع من ${typeCount} مخزّنًا`,
        },
    ];
}

/**
 * Employees with the most requests in the sent register — a ranking computed
 * HERE, so the caller must name its base. Server order (newest request first)
 * breaks ties, and the caller declares that in the portlet note.
 */
export function topRequesters(rows = [], limit = 6) {
    const by = new Map();
    for (const r of rows) {
        const key = r.employeeKey || r.employee;
        const cur = by.get(key);
        if (cur) {cur.count += 1;} else {
            by.set(key, { name: r.employee, resolved: r.employeeResolved, count: 1, open: 0 });
        }
        if (r.wfStatus === 'in_progress') {by.get(key).open += 1;}
    }
    return [...by.values()]
        .map((v, i) => ({ v, i }))
        .sort((a, b) => (b.v.count - a.v.count) || (a.i - b.i))
        .slice(0, limit)
        .map((x) => x.v);
}

/** Events flattened across the register, newest first — the audit trail the
 *  chain exists for (door sends them per request, created_at ASC :116). */
export function flattenEvents(rows = []) {
    const out = [];
    for (const r of rows) {
        for (const e of r.events) {
            if (!e || typeof e !== 'object') {continue;}
            const action = e.action ? String(e.action) : '';
            const stage = e.stage ? String(e.stage) : '';
            out.push({
                key: `${e.workflow_id ?? r.id}-${e.id ?? out.length}`,
                requestId: r.id,
                employee: r.employee,
                stage,
                stageAr: STAGE_LABELS_AR[stage] || '',
                stageKnown: !!STAGE_LABELS_AR[stage],
                action,
                actionAr: EVENT_LABELS_AR[action] || '',
                actionKnown: !!EVENT_LABELS_AR[action],
                note: e.note ? String(e.note) : '',
                actorRole: e.actor_role ? String(e.actor_role) : '',
                at: e.created_at ? String(e.created_at).slice(0, 16).replace('T', ' ') : '',
            });
        }
    }
    return out.sort((a, b) => (a.at < b.at ? 1 : (a.at > b.at ? -1 : 0)));
}

/** Reference row → row; `days` is the stored allowance and may be null. */
export function typeToRow(t = {}, requestCount = 0) {
    const raw = t.days;
    const days = raw === null || raw === undefined || raw === '' ? NaN : Number(raw);
    return {
        id: t.id,
        name: t.name ? String(t.name) : `#${t.id ?? '؟'}`,
        days: Number.isFinite(days) ? days : null,
        paid: !!t.paid,
        icon: t.icon ? String(t.icon) : '',
        requests: requestCount,
    };
}

/* ── Workflow decisions (wave 2 — explicit owner approval) ──────────────
 * The server FORBIDS direct leave edits (405 LEAVE_WORKFLOW_REQUIRED,
 * server.js:2056) — decisions go ONLY through the staged workflow, and it
 * enforces stage, actor, self-approval ban (:84-89) and department scope
 * (:201-209) with verbatim Arabic messages. The screen shows the buttons;
 * the server has the final word on every click.
 *
 * A rejection without a reason is not accepted here either: the legacy page
 * refuses it (features/hr.js:624) and the server otherwise stores its own
 * fallback text (:220), which would be a reason nobody wrote. */

/**
 * @param {number|string} id leave_request_id
 * @param {'approve'|'reject'|'return'|'resubmit'} action
 * @param {string} [note]
 */
export async function decideLeave(id, action, note = '') {
    if (action !== 'approve' && action !== 'reject' && action !== 'return' && action !== 'resubmit') {
        throw new Error('إجراء غير معروف — المتاح: اعتماد أو رفض.');
    }
    return apiFetch(`/hr/leave-workflow/${encodeURIComponent(id)}/action`, {
        method: 'POST', body: JSON.stringify({ action, note: String(note || '') }),
    });
}

/**
 * طلب إجازة جديد — POST /hr/leave-requests (leave-workflow-routes.js:149).
 * الحمولة نفسها في القديم (hr.js:620): employeeId/leaveTypeId/startDate/
 * endDate/reason. الخادم يشتق الموظف من الحساب لغير المخوّلين (:158) ويرفض
 * بلا ربط (:159) — 201 ترد {leave, workflow, stage_label}.
 */
export async function createLeaveRequest({ employeeId, leaveTypeId, startDate, endDate, reason }) {
    if (!Number.isInteger(Number(leaveTypeId)) || !startDate || !endDate || new Date(endDate) < new Date(startDate)) {
        throw new Error('تحقق من نوع الإجازة والتواريخ');
    }
    return apiFetch('/hr/leave-requests', {
        method: 'POST',
        body: JSON.stringify({
            employeeId: employeeId === undefined || employeeId === null || employeeId === '' ? undefined : Number(employeeId),
            leaveTypeId: Number(leaveTypeId), startDate, endDate, reason: String(reason || ''),
        }),
    });
}

/** أدوار النطاق الكامل للباب (:71 — مرآة doorScopeNote). */
export function isPrivilegedLeaveRole(role) {
    return ['admin', 'manager', 'hr'].includes(String(role || ''));
}
