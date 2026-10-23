/**
 * V2 — Attendance repository (الباب الوحيد إلى /api/attendance/*)
 * ═══════════════════════════════════════════════════════════════════════
 *
 * CONTRACT COPIED FROM THE SERVER, NOT INVENTED
 *   GET /attendance/range?from=YYYY-MM-DD&to=YYYY-MM-DD&limit=N
 *     → { data:[…], total, from, to }              (server.js:1276)
 *     → 400 MISSING_DATES when from/to absent
 *     → jwtAuth + [...SENSITIVE_READ_ROLES,'hr','dept_head'] / 'hr.view';
 *       dept_head rows are pre-filtered by the server to their departments.
 *   GET /employees?page=&limit=&sort=id&order=asc → { data, pagination }
 *     (app.js:81 apiList shape; read gate = SENSITIVE_READ_ROLES —
 *     the same family as the range endpoint, so whoever may read
 *     attendance may resolve its names.)
 *   Row columns (DB, read-only SELECT verified 2026-10-13):
 *     id, employeeId, date(varchar), checkIn, checkOut, late(bool),
 *     notes, checkInAt, checkOutAt, workMinutes, source, operatorId,
 *     checkin_inferred, checkout_inferred, early_leave, on_leave, branch_id.
 *   employees: id, name, department, status.
 *
 * PRESENTATION RULE (no invented persisted values)
 *   Lateness/early-leave/missing-punch are DERIVED booleans, not stored
 *   states, so they render as tone dots + Arabic text — never as a badge
 *   that claims a persisted value. The single badge case is on_leave, a
 *   stored boolean whose verified adapter value is leave/approved
 *   (Gate B showcase). Unknown combinations show raw text, never a guess.
 *
 * READS + WRITES — EACH DOOR PINNED TO ITS SERVER LINE (W2-3)
 *   Until W2-3 this file carried a "never writes" rule; the screen now owns
 *   the same cycle the current system does, so the rule is replaced by the
 *   doors below, each cited to the line that authorises it:
 *     • PUT  /api/attendance/:id  server.js:2037 (write roles :1778
 *       admin|manager|hr — attendance is deliberately OUT of
 *       OPEN_ENTITY_WRITE_ROLES, schema-registry.js:776) + the self-service
 *       guard :1182, which limits every other role to its own record.
 *     • POST /api/attendance      server.js:1780 (same gates).
 *     • POST /api/leaveRequests   schema-registry.js:789 (admin|manager|hr);
 *       a request created with status 'approved' gets a completed workflow
 *       chain server-side, so an administrative excuse also appears in the
 *       leaves follow-up screen — exactly as it does today.
 *       NOTE: PUT /api/leaveRequests/:id refuses the decision keys
 *       (server.js: 405 LEAVE_WORKFLOW_REQUIRED) — decisions stay on the
 *       chain, so this file never edits a leave status.
 *     • POST /api/hr/attendance/scan           hr-routes.js:421
 *     • POST /api/hr/attendance/revert-inferred hr-routes.js:530 (admin only)
 *     • POST /api/hr/shifts/apply              hr-routes.js:1067
 *     • GET  /api/hr/shifts/analysis           hr-routes.js:1052
 *     • GET  /api/hr/strict-audit              hr-routes.js:409
 *     • GET  /api/hr/attendance/monthly        hr-routes.js:331
 *     • GET  /api/settings/main_settings       (workStartHour, the same
 *       fallback the current screen reads from STATE.settings)
 *   Every validation message and every audit-note format below is copied
 *   from features/hr.js, not reworded: two screens that phrase the same
 *   refusal differently read as two different rules.
 *
 *   OUT OF SCOPE BY DESIGN: self check-in/out (the PWA geofence door,
 *   window.mobileDoPunch — W2-4), penalties (payroll_adjustments — W2-6,
 *   money last) and ZKTeco device operations (W2-5).
 *
 * DERIVED LAYER (buildAttendanceKpis / buildPunchBars / sharePill)
 *   Every chip, bar and percentage is arithmetic on rows the server already
 *   sent — no second request, no invented baseline. A ratio without a real
 *   denominator shows a stated dash, and a filtered view always names its
 *   own scope so a subset never reads as the whole period.
 */

import { apiFetch } from '../../core/api.js?v=4.9.197';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^(\d{1,2}):(\d{2})$/;

/**
 * Minutes between the displayed check-in/out first (guards odd values like
 * 25:43), overnight wrap only when out<in — then the stored workMinutes
 * fallback. Algorithm copied from features/hr.js:254-261 (attRawMinutes),
 * the same numbers the legacy screen shows.
 */
export function attendanceMinutes(rec = {}) {
    const m = String(rec.checkIn || '').match(TIME_RE);
    const o = String(rec.checkOut || '').match(TIME_RE);
    if (m && o) {
        let d = (Number(o[1]) * 60 + Number(o[2])) - (Number(m[1]) * 60 + Number(m[2]));
        if (d < 0) {d += 24 * 60;}
        return Math.max(0, d);
    }
    if (rec.workMinutes != null && Number.isFinite(Number(rec.workMinutes))) {
        return Math.max(0, Number(rec.workMinutes));
    }
    return null;
}

/**
 * Database row → table row. Pure and exported so it is testable
 * without a browser (branches-repo.js pattern).
 *
 * `deptByCode` is optional: without it the department shows the stored code
 * (features/hr.js:752 joins the same way for its label). A code that has no
 * department record stays a code — it is never renamed into a guess.
 */
export function attendanceToRow(rec = {}, empById = new Map(), deptByCode = new Map()) {
    const emp = empById.get(String(rec.employeeId));
    const deptCode = emp && emp.department !== undefined && emp.department !== null
        ? String(emp.department) : '';
    const dept = deptByCode.get(deptCode);
    const hasIn = !!String(rec.checkIn || '').match(TIME_RE);
    const hasOut = !!String(rec.checkOut || '').match(TIME_RE);
    let state = 'present';
    if (rec.on_leave) {state = 'leave';}
    else if (!hasIn && !hasOut) {state = 'none';}
    else if (rec.late) {state = 'late';}
    else if (rec.early_leave) {state = 'early';}
    else if (hasIn !== hasOut) {state = 'missing';}
    return {
        id: rec.id,
        employeeId: rec.employeeId,
        employee: emp && emp.name ? String(emp.name) : `#${rec.employeeId ?? '؟'}`,
        nameResolved: !!(emp && emp.name),
        dept: dept && dept.name ? String(dept.name) : (deptCode || '—'),
        deptCode,
        deptResolved: !!(dept && dept.name),
        date: String(rec.date || ''),
        in: hasIn ? String(rec.checkIn) : '—',
        out: hasOut ? String(rec.checkOut) : '—',
        minutes: attendanceMinutes(rec),
        source: rec.source ? String(rec.source) : '—',
        state,
    };
}

export const ATTENDANCE_STATE_AR = {
    present: 'حاضر', late: 'متأخر', early: 'انصراف مبكر',
    missing: 'بصمة ناقصة', leave: 'إجازة', none: 'لا بصمات',
};

/** Counts per state for the summary chips — derived, never fetched. */
export function summarizeAttendance(rows = []) {
    const counts = { present: 0, late: 0, early: 0, missing: 0, leave: 0, none: 0 };
    for (const r of rows) {
        if (counts[r.state] !== undefined) {counts[r.state] += 1;}
    }
    return counts;
}

/* ── Derived presentation models (pure: no DOM, no fetch) ────────────────
 *  Same rules as the counters above: every number below is arithmetic on
 *  rows the server already sent, and a ratio that has no real denominator
 *  says so instead of printing 0% or NaN.
 */

/** Integer convention shared with the briefing screen (Latin digits +
 *  thousands grouping) — briefing-repo.js:70. */
export function formatInt(v) {
    return Math.round(Number(v) || 0).toLocaleString('en-US');
}

/**
 * A share needs a real base. With zero rows the pill admits it rather than
 * inventing "0%" of nothing.
 * @returns {{text:string, aria:string, on:boolean}}
 */
export function sharePill(count, base, label) {
    if (!(base > 0)) {
        return { text: '—', on: false, aria: `لا سجلات في الفترة — لا نسبة تُحسب لـ${label}` };
    }
    const pct = (count / base) * 100;
    return {
        text: `${pct.toFixed(1)}%`, on: true,
        aria: `${label}: ${formatInt(count)} من ${formatInt(base)} سجلًا (${pct.toFixed(1)}%)`,
    };
}

/** Distinct real values of one field — the filter list is built from the
 *  rows themselves, never from a hard-coded list of departments. */
export function distinctValues(rows = [], key) {
    const set = new Set();
    for (const r of rows) {
        const v = r ? r[key] : null;
        if (v === undefined || v === null || v === '' || v === '—') {continue;}
        set.add(String(v));
    }
    return [...set].sort((a, b) => a.localeCompare(b, 'ar'));
}

export function countDistinct(rows = [], key) {
    return distinctValues(rows.map((r) => ({ [key]: r ? r[key] : null })), key).length;
}

/**
 * Punches per calendar day, grouped by the STORED date string and labelled
 * dd/MM from that same string — a locale would silently disagree with the
 * row it summarises. Keeps the last `maxDays` of the range (the bars stay
 * legible), oldest first.
 */
export function buildPunchBars(rows = [], { maxDays = 14 } = {}) {
    const byDay = new Map();
    for (const r of rows) {
        const day = String(r && r.date || '');
        if (!DATE_RE.test(day)) {continue;}
        const d = byDay.get(day) || { date: day, records: 0, inCount: 0, outCount: 0, late: 0 };
        d.records += 1;
        if (r.in && r.in !== '—') {d.inCount += 1;}
        if (r.out && r.out !== '—') {d.outCount += 1;}
        if (r.state === 'late') {d.late += 1;}
        byDay.set(day, d);
    }
    const bars = [...byDay.values()]
        .sort((a, b) => a.date.localeCompare(b.date))
        .map((d) => ({ ...d, label: `${d.date.slice(8, 10)}/${d.date.slice(5, 7)}` }));
    return maxDays > 0 ? bars.slice(-maxDays) : bars;
}

/**
 * Mean worked time over the rows that actually have both punches. An
 * incomplete row is excluded from the average but still counted in the
 * «بصمة ناقصة» chip — the two facts never cancel each other out.
 */
export function averageWorked(rows = []) {
    const done = rows.filter((r) => Number.isFinite(r && r.minutes));
    if (!done.length) {
        return { text: '—', minutes: null, base: 0, hint: 'لا سجل فيه دخول وخروج معًا في الفترة' };
    }
    const m = Math.round(done.reduce((a, r) => a + r.minutes, 0) / done.length);
    return {
        text: `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`,
        minutes: m, base: done.length,
        hint: `متوسط ${formatInt(done.length)} سجل مكتمل`,
    };
}

/** The six decision numbers on top of the screen + the two the chips leave
 *  to the legend. `scope` names what the shares are taken over, because a
 *  filtered view must not read like the whole period. */
export function buildAttendanceKpis(rows = [], opts = {}) {
    const c = summarizeAttendance(rows);
    const total = rows.length;
    const days = new Set(rows.map((r) => String(r && r.date || '')).filter(Boolean)).size;
    const avg = averageWorked(rows);
    const scope = opts.scope || 'سجلات الفترة';
    const pill = (n, label) => ({ ...sharePill(n, total, label), label });
    return [
        { id: 'total', icon: 'clipboard-list', tone: 'neutral', label: 'إجمالي السجلات', en: 'Records',
          value: formatInt(total), unit: '', hint: `${formatInt(days)} يومًا · ${formatInt(countDistinct(rows, 'employeeId'))} موظفًا`,
          pill: pill(total, 'إجمالي السجلات') },
        { id: 'present', icon: 'user-check', tone: 'success', label: 'حاضر', en: 'On time',
          value: formatInt(c.present), unit: '', hint: 'دخول وخروج بلا تأخير مسجّل',
          pill: pill(c.present, 'حاضر') },
        { id: 'late', icon: 'alarm', tone: 'warning', label: 'متأخر', en: 'Late',
          value: formatInt(c.late), unit: '', hint: 'علامة التأخير كما وردت من البصمة',
          pill: pill(c.late, 'متأخر') },
        { id: 'early', icon: 'hourglass', tone: 'warning', label: 'انصراف مبكر', en: 'Early leave',
          value: formatInt(c.early), unit: '', hint: 'الخروج قبل نهاية الوردية',
          pill: pill(c.early, 'انصراف مبكر') },
        { id: 'missing', icon: 'circle-alert', tone: 'info', label: 'بصمة ناقصة', en: 'Missing punch',
          value: formatInt(c.missing), unit: '', hint: 'دخول بلا خروج أو العكس',
          pill: pill(c.missing, 'بصمة ناقصة') },
        { id: 'avg', icon: 'clock', tone: 'brand', label: 'متوسط العمل', en: 'Avg worked',
          value: avg.text, unit: 'س:د', hint: avg.hint,
          pill: { text: `${formatInt(avg.base)}`, on: avg.base > 0, label: 'سجل مكتمل', aria: `متوسط محسوب على ${formatInt(avg.base)} سجل من ${formatInt(total)} في ${scope}` } },
    ];
}

/** The two states the chips leave out — shown in the legend under the bars. */
export function buildAttendanceLegend(rows = []) {
    const c = summarizeAttendance(rows);
    const total = rows.length;
    return [
        { key: 'leave', label: 'إجازة مسجّلة', tone: 'success', count: c.leave, pill: sharePill(c.leave, total, 'إجازة') },
        { key: 'none', label: 'لا بصمات', tone: 'neutral', count: c.none, pill: sharePill(c.none, total, 'لا بصمات') },
    ];
}

/** Screen-level filters. Empty string (or 'all') = that filter is off. */
export function applyAttendanceFilters(rows = [], { dept = '', state = '' } = {}) {
    const on = (v) => v && v !== 'all';
    return rows.filter((r) => (!on(dept) || String(r.dept) === String(dept))
        && (!on(state) || r.state === state));
}

/* ── Calendar helpers (string in, string out — no timezone surprises) ─── */

export const PERIODS = {
    today: { seg: 'اليوم', days: 1 },
    week: { seg: '٧ أيام', days: 7 },
    month: { seg: '٣٠ يومًا', days: 30 },
};

const pad = (n) => String(n).padStart(2, '0');
const toIso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fromIso = (iso) => {
    const [y, m, d] = String(iso).split('-').map(Number);
    return new Date(y, (m || 1) - 1, d || 1);
};

/** Today on the DEVICE calendar — the same basis the legacy screen uses
 *  (features/hr.js today()), so V2 and the old screen show the same range. */
export function todayIso() {
    return toIso(new Date());
}

/**
 * Inclusive {from,to} for a quick period. Backward-safe on 'YYYY-MM-DD'
 * parts only: no Date arithmetic on a parsed UTC string.
 */
export function periodRange(kind, endIso = todayIso()) {
    const p = PERIODS[kind];
    if (!p) {return null;}
    const end = fromIso(endIso);
    const start = new Date(end.getTime());
    start.setDate(start.getDate() - (p.days - 1));
    return { from: toIso(start), to: toIso(end) };
}

/** Whole calendar days between two dates, inclusive (1 when equal). */
export function spanDays(fromIsoStr, toIsoStr) {
    if (!DATE_RE.test(String(fromIsoStr)) || !DATE_RE.test(String(toIsoStr))) {return 0;}
    const ms = fromIso(toIsoStr) - fromIso(fromIsoStr);
    return Math.max(0, Math.round(ms / 86400000) + 1);
}

/**
 * @param {{from:string, to:string, limit?:number}} opts
 * @returns {Promise<{rows:any[], total:number, from:string, to:string}>}
 */
export async function fetchAttendanceRange({ from, to, limit = 30000 } = {}) {
    if (!DATE_RE.test(String(from || '')) || !DATE_RE.test(String(to || ''))) {
        throw new Error('حدّد تاريخ البداية والنهاية (YYYY-MM-DD)');
    }
    if (String(from) > String(to)) {
        throw new Error('تاريخ البداية بعد تاريخ النهاية');
    }
    const res = await apiFetch(
        `/attendance/range?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&limit=${Math.min(Number(limit) || 30000, 50000)}`
    );
    const data = res && Array.isArray(res.data) ? res.data : [];
    return { rows: data, total: Number(res && res.total) || data.length, from, to };
}

/**
 * GET /api/hr/attendance/report — hr-routes.js:210. The server defaults the
 * period to the current month and, for non-ADMIN_ROLES, forces the caller's
 * OWN record regardless of employee_id — the كشف panel passes the id it was
 * asked about and displays whatever comes back, it never re-derives scope.
 * @param {{employeeId:number|string, from?:string, to?:string}} opts
 * @returns {Promise<{employee:any, records:any[], summary:any}>}
 */
export async function fetchAttendanceReport({ employeeId, from = '', to = '' } = {}) {
    const params = [`employee_id=${encodeURIComponent(employeeId)}`];
    if (DATE_RE.test(String(from || ''))) {params.push(`from=${encodeURIComponent(from)}`);}
    if (DATE_RE.test(String(to || ''))) {params.push(`to=${encodeURIComponent(to)}`);}
    return apiFetch(`/hr/attendance/report?${params.join('&')}`);
}

/* ═══ W2-3 · دورة الكتابة: التصحيحات والاستكمال ═══════════════════════════
 * Everything below is either (a) a door cited in the header, or (b) a pure
 * function whose numbers and sentences are copied from features/hr.js. Pure
 * first, doors last — so the arithmetic a manager is about to persist can
 * be tested without a browser and without touching production.
 */

/* ── الأدوار والأدوات ──────────────────────────────────────────────────── */

/** server.js:1778 — الحضور يُكتب لهذه الأدوار الثلاثة فقط. بقية الأدوار
 *  يمرّون من enforceAttendanceSelfService (server.js:1182) على سجلّهم هم،
 *  وهو مسار البوابة الذاتية (W2-4) لا هذه الشاشة. */
export const ATT_WRITE_ROLES = ['admin', 'manager', 'hr'];

/** ADMIN_ROLES في hr-routes.js:15 — أبواب الورديات والتدقيق والكشف الشهري. */
export const ATT_ADMIN_ROLES = ['admin', 'hr', 'manager'];

/** صلاحية عرض في الواجهة فقط — الخادم يعيد فحص كل طلب. */
export function attWriteVisible(role) {
    return ATT_WRITE_ROLES.includes(String(role || ''));
}

/** أدوات الشريط السبع، بتوزيع الشاشة الحالية نفسه (features/hr.js:163-170):
 *  رئيس القسم لا يرى إلا التصدير، و«إلغاء الاستكمال للكل» للمدير العام وحده
 *  (hr-routes.js:530 requireRole('admin')).
 *
 *  انحرافان معلانان عن التوزيع القديم:
 *   1. «مراجعة النواقص» و«التدقيق الصارم» و«الكشف الشهري» مقصورة على
 *      admin|hr|manager بدل !dept_head — فالثلاثة أبوابُ خادمها يرفض غير
 *      هذه الأدوار (403)، وقائمة النواقص تُشتق من سجلات الفترة كاملة،
 *      ومن لا يقرأها كلها يرى غيابًا مختلَقًا لمن لا يراهم.
 *   2. «مسح بطاقة» و«الورديات» كذلك (كتابةٌ محكومة بالدور نفسه). */
export const ATT_TOOL_DEFS = [
    { id: 'scan', label: 'مسح بطاقة موظف', icon: 'camera', gate: 'write', deptHead: false },
    { id: 'shifts', label: 'الورديات — تطبيق وإعادة حساب', icon: 'clock', gate: 'write', deptHead: false },
    { id: 'export', label: 'تصدير Excel', icon: 'download', gate: 'read', deptHead: true },
    { id: 'monthly', label: 'كشف شهري مجمع', icon: 'printer', gate: 'admin', deptHead: false },
    { id: 'audit', label: 'تدقيق صارم', icon: 'shield-check', gate: 'admin', deptHead: false },
    { id: 'gaps', label: 'مراجعة نواقص الشهر', icon: 'alert-triangle', gate: 'admin', deptHead: false },
    { id: 'revert', label: 'إلغاء الاستكمال للكل', icon: 'undo', gate: 'owner', deptHead: false },
];

/** @returns {typeof ATT_TOOL_DEFS} الأدوات التي يراها هذا الدور */
export function attToolsFor(role) {
    const r = String(role || '');
    const isDeptHead = r === 'dept_head';
    return ATT_TOOL_DEFS.filter((t) => (isDeptHead ? t.deptHead : true))
        .filter((t) => {
            if (t.gate === 'read') {return true;}
            if (t.gate === 'write') {return ATT_WRITE_ROLES.includes(r);}
            if (t.gate === 'admin') {return ATT_ADMIN_ROLES.includes(r);}
            return r === 'admin';
        });
}

/** هل يملك هذا الدور سجلات الفترة كاملة؟ الشرط الذي تُبنى عليه قائمة
 *  النواقص واستثناءات اليوم: من يقرأ سجلات قسمه فقط لا يمكنه أن يشتق
 *  غياب بقية الأقسام — فيُعرض عليه ما ثبت من سجلاته وحدها. */
export function seesFullPeriod(role) {
    return ATT_ADMIN_ROLES.includes(String(role || ''));
}

/* ── حساب الوقت والتأخير (hr.js:401-408 و :500-505) ───────────────────── */

/** سماحية التأخير — قرار المالك 2026-10-10، والمحرك والخادم يعملان بها. */
export const GRACE_MIN = 15;

/** صيغة خانة الوقت كما تتحقق منها الشاشة الحالية (hr.js:422/:496). */
export const TIME_INPUT_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** HH:MM → دقائق، و null لأي نصٍّ ليس وقتًا (لا استثناءات في مسار كتابة). */
export function toMinutes(value) {
    const m = String(value || '').match(TIME_RE);
    return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/** بداية وردية الموظف إن كانت صالحة، وإلا ساعة بدء العمل من الإعدادات،
 *  وإلا 09:00 — نفس سلسلة hr.js:415/:504 حرفيًا. */
export function shiftStartFor(emp, workStartHour) {
    const stored = String((emp && emp.shift_start) || '');
    if (/^\d{2}:\d{2}/.test(stored)) {return stored;}
    const h = Number(workStartHour);
    return `${String(Number.isFinite(h) && h > 0 ? Math.floor(h) : 9).padStart(2, '0')}:00`;
}

/**
 * دقائق العمل + علامة التأخير قبل الحفظ.
 * `keepLate` هو سلوك التصحيح (hr.js:505): بلا بصمة دخول تبقى العلامة
 * المخزونة كما هي بدل أن تُخترع علامة جديدة — أما التعبئة (hr.js:407)
 * فبلا دخول = بلا تأخير.
 * @returns {{workMinutes: number|null, late: boolean}}
 */
export function calcPunchTimes({ checkIn = '', checkOut = '', shiftStart = '09:00', keepLate = false } = {}) {
    const ci = toMinutes(checkIn);
    const co = toMinutes(checkOut);
    let workMinutes = null;
    if (ci !== null && co !== null) {
        let d = co - ci;
        if (d < 0) {d += 1440;}          // التفاف الوردية الليلية
        workMinutes = d;
    }
    const start = toMinutes(shiftStart);
    const late = (ci !== null && start !== null) ? ci > start + GRACE_MIN : !!keepLate;
    return { workMinutes, late };
}

/* ── سطور التدقيق (hr.js:426/:445/:506) ────────────────────────────────── */

/** صيغ التدقيق الثلاث حرفيًا — الاسم والتاريخ والسبب، حتى يبقى سجل
 *  الملاحظات قابلًا للمقارنة بين الشاشتين. */
export function auditNote(kind, { who = '', reason = '', date = '', withName = '' } = {}) {
    const r = String(reason || '').trim();
    const w = String(who || '');
    if (kind === 'fill') {return `[تعبئة ${date} بواسطة ${w}: ${r}]`;}
    if (kind === 'correct') {return `[تصحيح يدوي ${date} بواسطة ${w}: ${r}]`;}
    if (kind === 'swap') {return `[تبديل وردية ${date} مع ${withName} بواسطة ${w}: ${r}]`;}
    return '';
}

/** الملاحظات سلسلة تدقيق تُلاحَق ولا تُستبدل — الفاصل ' | ' نفسه
 *  (hr.js:429/:507)، وقيمتها المخزونة قد تكون null فتُترك وحدها. */
export function joinNotes(existing, line) {
    return [existing, line].filter(Boolean).join(' | ');
}

/* ── التحقق (رسائل الشاشة الحالية نفسها) ──────────────────────────────── */

/**
 * فحص نموذج البصمة قبل الشبكة: بصمة واحدة على الأقل، صيغة HH:MM، سبب
 * إجباري. الرسائل من hr.js:423-424/:497-499/:413/:465 حرفيًا.
 * `reasonLabel` يختلف بين التصحيح («اكتب سبب التصحيح») والمعالجة
 * («اكتب السبب») — نفس فرق الشاشة الحالية.
 */
export function validatePunchForm({ checkIn = '', checkOut = '', reason = '', reasonLabel = 'اكتب السبب' } = {}) {
    const ci = String(checkIn || '').trim();
    const co = String(checkOut || '').trim();
    if (!ci && !co) {return { ok: false, message: 'أدخل بصمة واحدة على الأقل' };}
    if ((ci && !TIME_INPUT_RE.test(ci)) || (co && !TIME_INPUT_RE.test(co))) {
        return { ok: false, message: 'صيغة الوقت HH:MM' };
    }
    if (!String(reason || '').trim()) {return { ok: false, message: reasonLabel };}
    return { ok: true, checkIn: ci, checkOut: co, reason: String(reason).trim() };
}

/** سبب العذر وحده يكفى للرفض — hr.js:465/:413. */
export function validateReason(reason, message = 'اكتب السبب') {
    return String(reason || '').trim() ? { ok: true, reason: String(reason).trim() } : { ok: false, message };
}

/* ── أجسام الطلبات (whitelist الخادم وحده) ─────────────────────────────── */

/**
 * جسم PUT/PUT attendance — مفاتيح schema-registry.js:129 فقط؛ أي مفتاح
 * آخر يقتل الطلب كله (filterBody → 400 INVALID_PAYLOAD) فلا خطأ صامت.
 * القيم الفارغة null لا محذوفة: «امسح الخروج المستنتَج» عملية حقيقية.
 */
export function buildPunchPayload({ checkIn = '', checkOut = '', workMinutes = null, late = false, notes = '' } = {}) {
    return {
        checkIn: checkIn || null,
        checkOut: checkOut || null,
        workMinutes: workMinutes === null || workMinutes === undefined || !Number.isFinite(Number(workMinutes))
            ? null : Number(workMinutes),
        late: !!late,
        notes: String(notes || ''),
    };
}

/** جسم POST attendance: required employeeId+date (schema-registry.js:129). */
export function buildAttendanceCreate({ employeeId, date, checkIn = '', checkOut = '', workMinutes = null, late = false, notes = '' } = {}) {
    if (employeeId === undefined || employeeId === null || String(employeeId).trim() === '') {
        throw new Error('حدّد الموظف');
    }
    if (!DATE_RE.test(String(date || ''))) {throw new Error('التاريخ بصيغة YYYY-MM-DD');}
    return {
        employeeId: String(employeeId),
        date: String(date),
        ...buildPunchPayload({ checkIn, checkOut, workMinutes, late, notes }),
    };
}

/** بادئات سبب العذر — النصوص المخزّنة نفسها (hr.js:436/:442/:468). */
export const EXCUSE_PREFIX = { admin: 'عذر إداري: ', approved: 'عذر معتمد: ' };

/**
 * عذر إداري = طلب إجازة معتمد ليوم واحد. مفاتيح schema-registry.js:210
 * وحدها. `requestDate`/`approvedDate` اليوم (كما في الشاشة الحالية) بينما
 * `startDate`/`endDate` يوم الغياب نفسه — الفرق مقصود: العذر يُعتمد اليوم
 *  عن يومٍ مضى.
 * الخادم ينشئ سلسلة اعتماد مكتملة لأي طلب حالته approved، فيظهر العذر في
 *  متابعة الإجازات (server.js POST leaveRequests) — لا تعديل مباشر لاحقًا
 *  على الحالة (405 LEAVE_WORKFLOW_REQUIRED).
 */
export function buildExcusePayload({ employeeId, date, reason, kind = 'approved', userId = null, withName = '', todayStr = '' } = {}) {
    const { ok, message, reason: r } = validateReason(reason, kind === 'admin' ? 'اكتب سبب العذر' : 'اكتب السبب');
    if (!ok) {throw new Error(message);}
    if (employeeId === undefined || employeeId === null || String(employeeId).trim() === '') {
        throw new Error('حدّد الموظف');
    }
    if (!DATE_RE.test(String(date || ''))) {throw new Error('التاريخ بصيغة YYYY-MM-DD');}
    const day = String(date);
    const text = kind === 'swap'
        ? `تبديل وردية مع ${withName || employeeId}: ${r}`
        : `${EXCUSE_PREFIX[kind] || EXCUSE_PREFIX.approved}${r}`;
    const payload = {
        employeeId: String(employeeId),
        startDate: day,
        endDate: day,
        status: 'approved',
        reason: text,
    };
    const today = DATE_RE.test(String(todayStr || '')) ? String(todayStr) : day;
    payload.requestDate = today;
    payload.approvedDate = today;
    if (userId !== null && userId !== undefined && String(userId).trim() !== '') {
        payload.requestedBy = userId;
        payload.approvedBy = userId;
    }
    return payload;
}

/* ── بطاقة QR: فحصٌ قبل الشبكة ─────────────────────────────────────────── */

/** رسالة الرفض التي يعرفها المشغّل (hr.js:517-518) — تسمّي البطاقة
 *  الصالحة بدل أن تتركه يخمّن. */
export const QR_INVALID_MESSAGE = 'الكود الممسوح غير صالح — استخدم بطاقة موظف صادرة من مطاعم الشرفه العالمي';

/**
 * قواعد الخادم (hr-routes.js:424) حرفيًا: system/type/employeeId/cardId/
 * token/signature.
 * انحراف معلن: الشاشة الحالية تقبل system باسم التطبيق أيضًا
 * (CONFIG.APP_NAME = 'مطاعم الشرفه العالمي') والخادم لا يقبل إلا
 * 'Karim ERP'، فتصل البطاقة إلى 422 بعد المسح؛ هنا يُرفض محليًا ما
 * سيرفضه الخادم حتمًا.
 * @returns {{ok:true, data:object}|{ok:false, message:string}}
 */
export function parseScanPayload(text) {
    let data = text;
    if (typeof text === 'string') {
        try { data = JSON.parse(text); } catch { return { ok: false, message: QR_INVALID_MESSAGE }; }
    }
    if (!data || typeof data !== 'object') {return { ok: false, message: QR_INVALID_MESSAGE };}
    if (data.system !== 'Karim ERP' || data.type !== 'employee_card'
        || !data.employeeId || !data.cardId || !data.token || !data.signature) {
        return { ok: false, message: QR_INVALID_MESSAGE };
    }
    return { ok: true, data };
}

/* ── الورديات: النص والاقتراح والنتيجة ─────────────────────────────────── */

export const SHIFTS_TEXT_MAX = 8000;         // hr-routes.js:1069
export const SHIFTS_DRIFT_MIN = 30;          // hr.js:1022
export const SHIFTS_SUGGEST_CAP = 200;       // hr.js:1027

/** الخادم يقصّ النص عند 8000 حرف بلا رسالة (slice) — فالأسطر الزائدة
 *  تُطبَّق صامتةً ناقصة. الرفض هنا يعلن ما كان سيضيع. */
export function validateShiftsText(text) {
    const t = String(text || '').trim();
    if (!t) {return { ok: false, message: 'اكتب الورديات أولاً' };}
    if (t.length > SHIFTS_TEXT_MAX) {
        return { ok: false, message: `النص ${formatInt(t.length)} حرفًا والحد ${formatInt(SHIFTS_TEXT_MAX)} — قسّمه على دفعتين` };
    }
    return { ok: true, text: t };
}

/** الشهر YYYY-MM من أي تاريخ، وإلا '' (لا شهر مُخترَع). */
export function monthOf(isoDate) {
    const s = String(isoDate || '').slice(0, 7);
    return /^\d{4}-\d{2}$/.test(s) ? s : '';
}

/** رسالة الخادم نفسها (hr-routes.js:333/:411). */
export function validateMonth(month) {
    const m = String(month || '');
    if (!/^\d{4}-\d{2}$/.test(m)) {throw new Error('الشهر بصيغة YYYY-MM');}
    const n = Number(m.slice(5, 7));
    if (n < 1 || n > 12) {throw new Error('شهر غير صالح');}
    return m;
}

/**
 * أسطر الورديات المقترحة من واقع البصمة لمن لم يُذكر في النص — نية
 * hr.js:1019-1031: فجوة ≥ 30 دقيقة، استبعاد المذكور، 200 سطرًا كحدٍّ أقصى.
 * انحراف معلن: المقارنة هنا بلا حساسية حالة الأحرف، و`emp- 19` (بمسافات)
 * تُعد ذكرًا للموظف — أما هناك فـ `\s` داخل نصٍّ عادي ليست escape صالحًا
 * فتصبح /emp-s*19/ ولا تطابق شيئًا أبدًا، والاسم اللاتيني يُقارن
 * بحالتيه فيُكرَّر.
 * @returns {string[]} أسطر «الاسم realityP25» جاهزة للإلحاق
 */
export function suggestShiftLines(text, analysisItems = []) {
    const base = String(text || '');
    const lower = base.toLowerCase();
    const items = Array.isArray(analysisItems) ? analysisItems : [];
    const mentionedById = (id) => new RegExp(`emp-\\s*${String(id).replace(/[^\w-]/g, '')}\\b`, 'i').test(base);
    const extra = items
        .filter((x) => Math.abs(Number(x && x.driftMinutes) || 0) >= SHIFTS_DRIFT_MIN)
        .filter((x) => {
            const name = String((x && x.name) || '');
            if (name && lower.includes(name.toLowerCase())) {return false;}
            if (mentionedById(x && x.id)) {return false;}
            return !name.toLowerCase().split(/\s+/).some((w) => w.length >= 3 && lower.includes(w));
        })
        .slice(0, SHIFTS_SUGGEST_CAP);
    return extra.map((x) => `${x.name} ${x.realityP25}`);
}

/** يلحق الأسطر المقترحة بالنص — سطرٌ لكل اقتراح، وبلا إلحاق إن لم يوجد. */
export function withSuggestedLines(text, lines = []) {
    const base = String(text || '');
    return lines.length ? `${base}\n${lines.join('\n')}` : base;
}

/**
 * نتيجة التطبيق مقروءةً من الحقول الحقيقية.
 * انحراف معلن عن hr.js:1039: هناك `res.failed.slice(0,5)` والخادم يرسل
 * failed عددًا و failures مصفوفة نصوص (shifts-engine.js:144-145)، فالسطر
 * يخرج «غير مطبق: undefined» أو لا يخرج؛ هنا العدد من failed والأسامي من
 * failures، وإن خلا المصفوفة يُقال العدد وحده.
 * @returns {string[]} سطور النتيجة (تُعرض pre-line كما في الشاشة الحالية)
 */
export function formatShiftsResult(res = {}) {
    const rc = (res && res.recompute) || {};
    const failures = Array.isArray(res && res.failures) ? res.failures : [];
    const failedCount = Number(res && res.failed) || failures.length;
    const lines = [
        `تطبيق: ${formatInt(res && res.applied)}/${formatInt(res && res.parsed)} موظف`,
        `أيام التأخير: ${formatInt(rc.lateDaysBefore)} → ${formatInt(rc.lateDaysAfter)}`,
        `دقائق التأخير: ${formatInt(rc.lateMinutesBefore)} → ${formatInt(rc.lateMinutesAfter)}`,
    ];
    if (failedCount > 0) {
        const names = failures.slice(0, 5).map((f) => String(f || '').trim()).filter(Boolean);
        lines.push(names.length
            ? `غير مطبق (${formatInt(failedCount)}): ${names.join(' · ')}`
            : `غير مطبق: ${formatInt(failedCount)} سطر`);
    }
    return lines;
}

/* ── التدقيق الصارم (hr-routes.js:409) ─────────────────────────────────── */

/** تسميات الحالات الثلاث من smart-card.js:535 — لا رابع لها. */
export const AUDIT_STATUS_AR = { PASS: 'سليم', WARN: 'تنبيه', FAIL: 'فشل' };

/** صف فحص → ما يُعرض: اسم وحالة وعدد وتفصيل مختصر. حالةٌ غير معروفة
 *  تبقى كما وردت بدل أن تُترجم إلى تخمين. */
export function auditRows(res = {}) {
    const checks = Array.isArray(res && res.checks) ? res.checks : [];
    return checks.map((c) => {
        const status = String((c && c.status) || '');
        const detail = Array.isArray(c && c.detail) ? c.detail : [];
        return {
            name: String((c && c.name) || '—'),
            status,
            statusAr: AUDIT_STATUS_AR[status] || status || '—',
            tone: status === 'PASS' ? 'success' : status === 'WARN' ? 'warning' : status === 'FAIL' ? 'danger' : 'neutral',
            count: Number(c && c.count) || 0,
            detail: detail.map((d) => ({
                emp: String((d && d.emp) || ''),
                lateDays: d && d.lateDays !== undefined && d.lateDays !== null ? Number(d.lateDays) : null,
                days: d && d.days !== undefined && d.days !== null ? Number(d.days) : null,
            })),
        };
    });
}

/** خلاصة التدقيق: هل اعتمدت البيانات أم لا، وعدّاد لكل حالة. */
export function summarizeAudit(res = {}) {
    const rows = auditRows(res);
    return {
        ok: !!(res && res.ok),
        rows,
        counts: {
            PASS: rows.filter((r) => r.status === 'PASS').length,
            WARN: rows.filter((r) => r.status === 'WARN').length,
            FAIL: rows.filter((r) => r.status === 'FAIL').length,
        },
    };
}

/* ── الكشف الشهري المجمع (hr-routes.js:331) ────────────────────────────── */

/**
 * صف موظف في الكشف الشهري → صف عرض. كل رقم من الخادم كما هو: العجز
 * والتأخير والاكتمال محسوبة هناك على وردية الموظف السارية في تاريخ كل
 * يوم (monthly-attendance-query.js + loadShiftHistoryMap)، وإعادة اشتقاقها
 * هنا تعني رقمين مختلفين عن الورق المطبوع.
 * أسماء الأعمدة من smart-card.js:559-568: «التأخير» = العجز عن إتمام
 * ساعات الوردية (قرار المالك 2026-09)، لا دقائق الدخول المتأخر وحدها.
 */
export function monthlyRow(e = {}) {
    const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
    return {
        id: e.id,
        name: String(e.name || '—'),
        employeeId: String(e.employeeId || '—'),
        department: String(e.department || '—'),
        position: String(e.position || ''),
        shiftStart: String(e.shift_start || ''),
        shiftKarim: num(e.shift_karim),
        records: num(e.days),
        present: num(e.present),
        complete: num(e.complete),
        completeWorkDays: num(e.completeWorkDays),
        shortDays: num(e.shortDays),
        deficitMinutes: num(e.deficitMinutes),
        deficitHours: num(e.deficitHours),
        lateInDays: num(e.lateInDays),
        karimHours: num(e.karimHours),
        leaveDays: num(e.leaveDays),
        reviewDays: num(e.reviewDays),
        workDayMinutes: num(e.workDayMinutes),
    };
}

/**
 * الكشف كله: صفوف + إجماليات. الإجماليات جمعُ صفوف الخادم نفسه
 *  (smart-card.js:560-567) — لا معدل ولا إعادة حساب.
 * @returns {{month:string, workDayMinutes:number, rows:any[], totals:object, employees:number}}
 */
export function buildMonthlySheet(data = {}) {
    const list = Array.isArray(data && data.employees) ? data.employees : [];
    const rows = list.map(monthlyRow);
    const sum = (pick) => rows.reduce((s, r) => s + pick(r), 0);
    return {
        month: monthOf(data && data.month) || '',
        workDayMinutes: Number(data && data.workDayMinutes) || 600,
        rows,
        employees: rows.length,
        totals: {
            records: sum((r) => r.records),
            present: sum((r) => r.present),
            completeWorkDays: sum((r) => r.completeWorkDays),
            shortDays: sum((r) => r.shortDays),
            deficitMinutes: sum((r) => r.deficitMinutes),
            lateInDays: sum((r) => r.lateInDays),
            karimHours: Math.round(sum((r) => r.karimHours) * 10) / 10,
            leaveDays: sum((r) => r.leaveDays),
            reviewDays: sum((r) => r.reviewDays),
        },
    };
}

/** دقائق → «س:د» للعرض والطباعة؛ null يبقى شرطة لا صفرًا. */
export function minutesToHM(minutes) {
    const m = Number(minutes);
    if (!Number.isFinite(m) || m <= 0) {return '—';}
    return `${Math.floor(m / 60)}:${String(Math.round(m % 60)).padStart(2, '0')}`;
}

/* ── تقويم: اليوم التالي واسم اليوم (hr.js:348-350) ────────────────────── */

/** T12:00 لتفادي انزياح المنطقة الزمنية — نفس حيلة الشاشة الحالية. */
export function nextDayIso(iso) {
    if (!DATE_RE.test(String(iso || ''))) {return '';}
    const d = new Date(`${String(iso).slice(0, 10)}T12:00:00`);
    d.setDate(d.getDate() + 1);
    return toIso(d);
}

export const WEEKDAY_AR = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];

export function weekdayAr(iso) {
    const d = new Date(`${String(iso || '').slice(0, 10)}T12:00:00`);
    return Number.isNaN(d.getTime()) ? '—' : WEEKDAY_AR[d.getDay()];
}

/** 0=الأحد … 6=السبت — نفس ترميز day_off المخزّن (smart-card.js:592). */
export function weekdayIndex(iso) {
    const d = new Date(`${String(iso || '').slice(0, 10)}T12:00:00`);
    return Number.isNaN(d.getTime()) ? -1 : d.getDay();
}

/** يوم الراحة الأسبوعية للموظف — يُعلَم ولا يُخفى: القائمة تُقرأ بالعين
 *  (ملاحظة الشاشة الحالية نفسها)، والعلامة تمنع أن يُعدّ يومُ راحةٍ
 *  غيابًا بالخطأ. */
export function isWeeklyOff(emp, iso) {
    const off = emp && (emp.day_off !== undefined ? emp.day_off : emp.dayOff);
    if (off === null || off === undefined || off === '') {return false;}
    return Number(off) === weekdayIndex(iso);
}

/* ── الإجازات المعتمدة: استبعادٌ من النواقص لا اختراعٌ له ─────────────── */

/** هل يغطي عذر/إجازة معتمدة هذا اليوم لهذا الموظف؟ (hr.js:334/:123) */
export function isExcusedByLeave(leaves = [], employeeId, date) {
    const d = String(date || '');
    return (Array.isArray(leaves) ? leaves : []).some((l) => l
        && String(l.status) === 'approved'
        && String(l.employeeId) === String(employeeId)
        && String(l.startDate) <= d && d <= String(l.endDate));
}

/* ── نواقص الفترة (hr.js:331-347) ──────────────────────────────────────── */

export const GAP_TYPES_AR = { absent: 'لم يحضر تمامًا', missOut: 'نسي الخروج', missIn: 'نسي الدخول' };
export const GAP_TONES = { absent: 'danger', missOut: 'warning', missIn: 'warning' };
export const GAPS_CAP = 300;                 // hr.js:374 — والباقي يُعلَن عدًّا

/**
 * قائمة النواقص: موظف نشط × يوم في الفترة، بلا سجل = غياب، دخول بلا خروج
 * غير مستنتَج = نسي الخروج، خروج بلا دخول = نسي الدخول. الأيام المعذورة
 * بإجازة معتمدة تُستبعد (وإلا عُوقب من أُذن له)، والأيام بعد اليوم تُستبعد
 *  أيضًا — فالمستقبل ليس غيابًا (قاعدة الجدول الرئيسي hr.js:130، وكانت
 *  قائمة النواقص القديمة تخلو منها فتعدّ أيامًا لم تأت).
 *
 * `full` = هل يقرأ هذا الدور سجلات الفترة كلها؛ بدونه لا تُشتق قائمة
 * الغياب من دليل الموظفين (من يرى قسمه فقط سيقرأ غيابًا مختلَقًا لبقية
 * الأقسام)، وتبقى النواقص ما ثبت من السجلات المحمّلة وحدها.
 *
 * @returns {{rows:any[], total:number, counts:object, truncated:boolean, cappedAt:number}}
 */
export function buildAttendanceGaps({
    records = [], employees = [], leaves = [], from = '', to = '',
    todayStr = '', full = true, cap = GAPS_CAP,
} = {}) {
    const today = DATE_RE.test(String(todayStr || '')) ? String(todayStr) : todayIso();
    if (!DATE_RE.test(String(from || '')) || !DATE_RE.test(String(to || '')) || String(from) > String(to)) {
        return { rows: [], total: 0, counts: { absent: 0, missOut: 0, missIn: 0 }, truncated: false, cappedAt: Number(cap) || GAPS_CAP };
    }
    const recByEmpDate = new Map();
    for (const a of (Array.isArray(records) ? records : [])) {
        if (a && a.employeeId !== undefined && a.employeeId !== null) {
            recByEmpDate.set(`${String(a.employeeId)}|${a.date}`, a);
        }
    }
    const gaps = [];
    const push = (emp, date, type, rec) => {
        if (date > today) {return;}                       // المستقبل ليس غيابًا
        if (isExcusedByLeave(leaves, emp.id, date)) {return;}
        gaps.push({
            emp, date, type, rec,
            label: GAP_TYPES_AR[type] || type,
            tone: GAP_TONES[type] || 'neutral',
            weekday: weekdayAr(date),
            weeklyOff: isWeeklyOff(emp, date),
        });
    };
    const active = (Array.isArray(employees) ? employees : []).filter((e) => e && e.status === 'active');
    if (full) {
        for (const emp of active) {
            for (let d = String(from); d <= String(to) && d <= today; d = nextDayIso(d)) {
                const rec = recByEmpDate.get(`${String(emp.id)}|${d}`);
                if (!rec) {push(emp, d, 'absent', null); continue;}
                if (rec.checkIn && !rec.checkOut && !rec.checkout_inferred) {push(emp, d, 'missOut', rec); continue;}
                if (!rec.checkIn && rec.checkOut) {push(emp, d, 'missIn', rec);}
            }
        }
    } else {
        // بلا رؤية كاملة: السجلات المحمّلة وحدها مصدر الحقيقة.
        const byId = new Map(active.map((e) => [String(e.id), e]));
        for (const rec of (Array.isArray(records) ? records : [])) {
            if (!rec || !DATE_RE.test(String(rec.date || ''))) {continue;}
            if (String(rec.date) < String(from) || String(rec.date) > String(to)) {continue;}
            const emp = byId.get(String(rec.employeeId));
            if (!emp) {continue;}
            if (rec.checkIn && !rec.checkOut && !rec.checkout_inferred) {push(emp, rec.date, 'missOut', rec); continue;}
            if (!rec.checkIn && rec.checkOut) {push(emp, rec.date, 'missIn', rec); continue;}
            if (!rec.checkIn && !rec.checkOut) {push(emp, rec.date, 'absent', rec);}
        }
    }
    const counts = { absent: 0, missOut: 0, missIn: 0 };
    for (const g of gaps) {counts[g.type] = (counts[g.type] || 0) + 1;}
    const limit = Number(cap) > 0 ? Number(cap) : GAPS_CAP;
    return {
        rows: gaps.slice(0, limit),
        total: gaps.length,
        counts,
        truncated: gaps.length > limit,
        cappedAt: limit,
    };
}

/** تطبيع البحث العربي — hr.js:363 حرفيًا (أ/إ/آ→ا، ة→ه، حالة الأحرف). */
export function normArSearch(s) {
    return String(s || '').replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').toLowerCase();
}

/** بحث النواقص بالاسم أو الكود أو القسم — نفس الحقول الثلاثة (hr.js:364). */
export function filterGaps(gaps = [], query = '') {
    const q = normArSearch(String(query || '').trim());
    if (!q) {return gaps;}
    return gaps.filter((g) => normArSearch(
        `${(g.emp && g.emp.name) || ''} ${(g.emp && g.emp.employeeId) || ''} ${(g.emp && g.emp.department) || ''}`
    ).includes(q));
}

/* ── استثناءات اليوم (hr.js:267-317) ────────────────────────────────────── */

export const EXCEPTION_TYPES_AR = {
    absent: 'لم يحضر', late: 'متأخر', early: 'انصراف مبكر', missing: 'بصمة ناقصة',
};
export const EXCEPTION_TONES = {
    absent: 'danger', late: 'warning', early: 'warning', missing: 'info',
};

/**
 * ساعات العمل المعروضة في صندوق الاستثناءات — hr.js:294-303 حرفيًا،
 * بما فيها القاعدة التي تقول الحقيقة: بصمة ناقصة اليوم تُحسب «حتى الآن»،
 * وفي يومٍ مضت تُحسب صفرًا لأن لا نهاية لها، وخروجٌ بلا دخول لا يُحسب
 * أصلًا ('—') فالحساب يحتاج الطرفين.
 * @returns {string} عدد عشري («3.50») أو «—»
 */
export function workedHoursText(rec, { todayStr = '', nowMinutes = null } = {}) {
    const today = DATE_RE.test(String(todayStr || '')) ? String(todayStr) : todayIso();
    if (!rec || (!rec.checkIn && !rec.checkOut)) {return '0.0';}
    const a = toMinutes(rec.checkIn);
    if (a === null) {return '—';}                 // انصراف بلا حضور: لا يُحسب
    let b = toMinutes(rec.checkOut);
    let fromClock = false;
    if (b === null) {
        // «حتى الآن» مشروطةٌ بتمرير الساعة: غيابها يعني صفرًا لا «حتى الآن».
        const live = String(rec.date || today) === today && nowMinutes !== null;
        if (live) {b = Number(nowMinutes); fromClock = true;} else {b = a;}
    }
    if (fromClock && b < a) {return '—';}         // الساعة قبل البصمة: لا نهاية بعد
    let diff = b - a;
    if (diff < 0) {diff += 1440;}                 // ورديةٌ تعبر منتصف الليل
    return (diff / 60).toFixed(2);
}

/**
 * صندوق استثناءات اليوم: غياب/تأخير/انصراف مبكر/بصمة ناقصة في مكان واحد،
 * بنفس ترتيب فحوص الشاشة الحالية (hr.js:281-285) وبنفس نصوص التفاصيل.
 * `full` يقرر هل يُشتق الغياب من دليل الموظفين النشطين (من يقرأ كل
 * السجلات) أم من سجلات اليوم المحمّلة وحدها.
 * @returns {{rows:any[], open:number, excused:number, date:string, weekday:string}}
 */
export function buildTodayExceptions({
    records = [], employees = [], leaves = [], todayStr = '', nowMinutes = null, full = true,
} = {}) {
    const today = DATE_RE.test(String(todayStr || '')) ? String(todayStr) : todayIso();
    const todays = (Array.isArray(records) ? records : []).filter((r) => r && String(r.date) === today);
    const active = (Array.isArray(employees) ? employees : []).filter((e) => e && e.status === 'active');
    const rows = [];
    const classify = (emp, rec) => {
        let type = null;
        let detail = '';
        if (!rec || (!rec.checkIn && !rec.checkOut)) {type = 'absent'; detail = 'لا بصمات اليوم';}
        else if (rec.checkIn && !rec.checkOut && !rec.checkout_inferred) {type = 'missing'; detail = `حضور ${rec.checkIn} بلا انصراف`;}
        else if (!rec.checkIn && rec.checkOut) {type = 'missing'; detail = `انصراف ${rec.checkOut} بلا حضور`;}
        else if (rec.late) {type = 'late'; detail = `حضور ${rec.checkIn}`;}
        else if (rec.early_leave) {type = 'early'; detail = `انصراف ${rec.checkOut}`;}
        if (!type) {return;}
        const excused = isExcusedByLeave(leaves, emp.id, today);
        rows.push({
            emp, rec, type, detail, excused,
            label: EXCEPTION_TYPES_AR[type],
            tone: EXCEPTION_TONES[type],
            hours: workedHoursText(rec, { todayStr: today, nowMinutes }),
            checkIn: (rec && rec.checkIn) || '',
            checkOut: (rec && rec.checkOut) || '',
            checkinInferred: !!(rec && rec.checkin_inferred),
            checkoutInferred: !!(rec && rec.checkout_inferred),
        });
    };
    const recByEmp = new Map(todays.map((r) => [String(r.employeeId), r]));
    if (full) {
        for (const emp of active) {classify(emp, recByEmp.get(String(emp.id)) || null);}
    } else {
        const byId = new Map(active.map((e) => [String(e.id), e]));
        for (const rec of todays) {
            const emp = byId.get(String(rec.employeeId));
            if (emp) {classify(emp, rec);}
        }
    }
    return {
        rows,
        date: today,
        weekday: weekdayAr(today),
        excused: rows.filter((r) => r.excused).length,
        open: rows.filter((r) => !r.excused).length,
    };
}

/* ── تصدير Excel (hr.js:550-564) ───────────────────────────────────────── */

export const ATT_SHEET_COLS = ['التاريخ', 'الموظف', 'الحضور', 'الانصراف', 'ساعات العمل', 'المصدر'];

/** تسميات المصدر من الشاشة الحالية (hr.js:557) — وأي مصدر جديد يُقرأ
 *  كما ورد بدل أن يُترجم إلى «يدوي» كذبًا. */
export const ATT_SOURCE_AR = { device: 'بصمة', qr: 'QR', portal: 'كاميرا التطبيق', backfill: 'أرشيف' };

export function sourceLabelAr(source) {
    const s = String(source || '');
    if (!s || s === '—') {return '—';}
    return ATT_SOURCE_AR[s] || s;
}

/**
 * مصفوفة التصدير: نفس الأعمدة الستة ونفس الترتيب (تاريخٌ تنازلي ثم
 * employeeId تصاعديًا — hr.js:554) ونفس صيغة الساعات (attRawHours،
 * منزلتان أو «—»).
 * الاسم هو ما تعرضه الشاشة: رقمٌ بلا هوية يُصدَّر كما يُرى (#12) لا
 * فارغًا، فصفٌّ بلا اسم يُقرأ في الملف كأنه خطأ تصدير.
 * @param {any[]} rows صفوف الشاشة (applyAttendanceFilters بعدها إن صُفّيت)
 */
export function buildExportMatrix(rows = []) {
    const sorted = [...(Array.isArray(rows) ? rows : [])]
        .sort((a, b) => (a.date > b.date ? -1 : a.date < b.date ? 1 : Number(a.employeeId) - Number(b.employeeId)));
    return [
        ATT_SHEET_COLS,
        ...sorted.map((r) => [
            r.date,
            r.employee,
            r.in === '—' ? '' : r.in,
            r.out === '—' ? '' : r.out,
            r.minutes === null || r.minutes === undefined ? '—' : (Number(r.minutes) / 60).toFixed(2),
            sourceLabelAr(r.source),
        ]),
    ];
}

/** اسم الملف — نفس قالب الشاشة الحالية (hr.js:563). */
export function exportFileName(from, to) {
    return `attendance_${from}_to_${to}.xlsx`;
}

/* ── أبواب الشبكة (كلٌّ منها مسطّر إلى موضعه في الخادم) ────────────────── */

/** PUT /api/attendance/:id — server.js:2037 (+ حرس الخدمة الذاتية :1182). */
export function updateAttendance(id, payload) {
    return apiFetch(`/attendance/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(payload) });
}

/** POST /api/attendance — server.js:1780 (201 → الصف المنشور). */
export function createAttendance(payload) {
    return apiFetch('/attendance', { method: 'POST', body: JSON.stringify(payload) });
}

/** POST /api/leaveRequests بعذر معتمد — schema-registry.js:789؛ الخادم
 *  ينشئ سلسلة اعتماد مكتملة لأي طلب حالته approved. */
export function createApprovedLeave(payload) {
    return apiFetch('/leaveRequests', { method: 'POST', body: JSON.stringify(payload) });
}

/**
 * POST /api/hr/attendance/scan — hr-routes.js:421 (admin|hr|manager +
 * QR_SECRET). الجسم {qr_payload} كما يتوقعه الخادم (:423)، والفحص المحلي
 * قبل الإرسال (parseScanPayload). أخطاء الخادم المقروءة: 422
 * INVALID_EMPLOYEE_QR / INVALID_QR_SIGNATURE / STALE_EMPLOYEE_QR، و409
 * SHIFT_LOCKED / ATTENDANCE_COMPLETE.
 * @returns {Promise<{action:'check_in'|'check_out', employee:object, record:object}>}
 */
export function scanAttendance(qrPayload) {
    return apiFetch('/hr/attendance/scan', { method: 'POST', body: JSON.stringify({ qr_payload: qrPayload }) });
}

/** رسالة نتيجة المسح — نفس جملة الشاشة الحالية (hr.js:525-526). */
export function scanResultText(res = {}) {
    const action = res && res.action === 'check_in' ? 'تسجيل حضور' : 'تسجيل انصراف';
    const who = (res && res.employee && res.employee.name) || '—';
    const rec = (res && res.record) || {};
    const time = res && res.action === 'check_in' ? (rec.checkIn || '—') : (rec.checkOut || '—');
    return `${action}: ${who} — ${time}`;
}

/** POST /api/hr/attendance/revert-inferred — hr-routes.js:530 (admin فقط).
 *  الجملة التي تُعرض قبل التنفيذ هي نفسها في الشاشة الحالية
 *  (features/employees.js:140) حتى لا يختلف وزن القرار بين الشاشتين. */
export const REVERT_INFERRED_CONFIRM = 'إلغاء كل الاستكمال التلقائي؟ ستُمسح القيم المستنتَجة ويُعاد فتح الصفوف. القيم الحقيقية لن تُمس.';

export function revertInferred() {
    return apiFetch('/hr/attendance/revert-inferred', { method: 'POST', body: JSON.stringify({}) });
}

/** رسالة نتيجة الإلغاء الجماعي — features/employees.js:146 حرفيًا. */
export function revertResultText(res = {}) {
    return `تم: مسح خروج ${formatInt(res && res.clearedCheckouts)} — مسح دخول ${formatInt(res && res.clearedCheckins)} — حذف فارغ ${formatInt(res && res.deletedEmpty)}`;
}

/** GET /api/hr/shifts/analysis?month= — hr-routes.js:1052. */
export function fetchShiftsAnalysis(month) {
    return apiFetch(`/hr/shifts/analysis?month=${encodeURIComponent(validateMonth(month))}`);
}

/** POST /api/hr/shifts/apply — hr-routes.js:1067 (نص ≤ 8000 حرف). */
export function applyShifts(text) {
    return apiFetch('/hr/shifts/apply', { method: 'POST', body: JSON.stringify({ text: String(text || '') }) });
}

/** GET /api/hr/strict-audit?month= — hr-routes.js:409 (ADMIN_ROLES). */
export function fetchStrictAudit(month) {
    return apiFetch(`/hr/strict-audit?month=${encodeURIComponent(validateMonth(month))}`);
}

/** GET /api/hr/attendance/monthly?month=&detail=1 — hr-routes.js:331
 *  (ADMIN_ROLES، وإلا 403 «التقرير الشهري للإدارة فقط»). */
export function fetchMonthlyAttendance(month) {
    return apiFetch(`/hr/attendance/monthly?month=${encodeURIComponent(validateMonth(month))}&detail=1`);
}

/**
 * ساعة بدء العمل من الإعدادات — الأساس الذي يُحسب عليه التأخير لمن لا
 * وردية مسجّلة له (hr.js:415 يقرأها من STATE.settings.workStartHour).
 * تُقرأ مرة واحدة وتُخزَّن؛ وإن تعذّرت تُعلن الشاشة أن الحساب على
 * 09:00 الافتراضية بدل أن تدّعي أساسًا لم تقرأه.
 * @returns {Promise<{hour:number, ok:boolean}>}
 */
let workStartCache = null;
export async function fetchWorkStartHour() {
    if (workStartCache) {return workStartCache;}
    try {
        const res = await apiFetch('/settings/main_settings');
        const row = Array.isArray(res) ? res[0] : res;
        const h = Number(row && row.workStartHour);
        workStartCache = { hour: Number.isFinite(h) && h > 0 ? Math.floor(h) : 9, ok: true };
    } catch {
        workStartCache = { hour: 9, ok: false };
    }
    return workStartCache;
}

