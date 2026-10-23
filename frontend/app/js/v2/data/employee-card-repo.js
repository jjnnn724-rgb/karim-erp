/**
 * V2 — Employee card repository · بطاقة الموظف — المشتقات وباب الجدولة
 * ═══════════════════════════════════════════════════════════════════════
 *
 * WHY THIS DOOR EXISTS
 *   features/smart-card.js:134-318 draws the legacy employee card: an
 *   attendance rate, a four-state badge, a late-deduction net salary, the
 *   scheduled-shift notice and two QR codes (system + human-readable). V2 had
 *   kept only the QR half of that card (screens/employees.js fillQr), so the
 *   كشف panel stood beside it as «بيانات أولية». This module lifts the
 *   arithmetic out of the painter so a test can pin it — the same shape every
 *   other V2 door has.
 *
 * WHAT IS ARITHMETIC HERE — AND WHAT IS NOT
 *   Nothing in this file invents a fact: every figure is a stated function of
 *   a server payload. The attendance KPIs read GET /hr/attendance/report's own
 *   summary (backend/hr-routes.js:229-241). V2 does NOT re-derive lateness from
 *   checkIn strings the way smart-card.js:154-180 did — that second copy was the
 *   root of the stale-`late`-flag bug the legacy file itself documents at
 *   :152-153, and one authority is the whole point of a rewrite.
 *
 * DOCUMENTED DEVIATIONS (legacy bugs, not features)
 *   • The legacy card printed «نسبة الحضور» and «في الموعد» from the SAME
 *     expression (smart-card.js:181-182). Two labels over one number is not
 *     information, so V2 states the rate once.
 *   • With zero attendance days the legacy payroll line divided by zero and
 *     printed a net of 0 (smart-card.js:198 — `salary / (0 * 10)` = Infinity).
 *     cardPayroll returns null there instead of a number nobody earned.
 *   • كشف اليوم/الفترة (rangeReportRows below) corrects three more of the same
 *     family: the legacy sheet read `employee.shift_hours` and
 *     `summary.totalHours`, neither of which this endpoint ever sends — so
 *     every «تأخير» was a guessed 10-hour shift and «إجمالي الساعات» printed 0 —
 *     and it called every punch-free day «لم يحضر», rest days included.
 *
 * ONE IMPORT FROM ANOTHER DOOR — AND WHY
 *   `isWeeklyOff` comes from attendance-repo.js rather than being re-typed
 *   here: which day of the week a stored `day_off` number means is decided
 *   once in this app (attendance-repo.js:828), and a second copy is exactly
 *   the drift this rewrite exists to remove.
 *
 * READ THE PAINTER FOR THE REST
 *   Expiry warnings, the profile facts and the QR rendering live in
 *   screens/employees.js: they are presentation, and this file stays pure.
 */

import { apiFetch, API_BASE } from '../../core/api.js?v=4.9.131';
import { isWeeklyOff } from './attendance-repo.js?v=4.9.131';

const int = (v) => { const n = Number(v); return Number.isFinite(n) ? Math.trunc(n) : 0; };
// A missing salary is not zero: Number(null) is 0, and a card that prints
// «الراتب: 0» for an employee whose salary the server withheld is a lie.
const num = (v) => {
    if (v === null || v === undefined || v === '') {return null;}
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
};

/**
 * GET /hr/shift-schedule/:employeeId — backend/hr-routes.js:1639.
 * Returns `{ ok, current, scheduled[] }`; the server owns the scope check
 * (privileged role, the employee's own userId, or a dept_head of that dept).
 * @param {number|string} employeeId
 */
export async function fetchEmployeeSchedule(employeeId) {
    const id = Number(employeeId);
    if (!Number.isInteger(id) || id <= 0) {throw new Error('معرف الموظف غير صحيح');}
    return apiFetch(`/hr/shift-schedule/${id}`);
}

/**
 * «⏳ مجدول من <تاريخ>: <بداية> (<ساعات>س)» — smart-card.js:33-44.
 * No scheduled row is silence, never a zero-row: a promotion that has not
 * taken effect yet must not read as «دوام اليوم».
 * @param {{scheduled?: Array<object>}} [res]
 * @returns {{effectiveFrom: string, start: string, hours: string, extra: number}|null}
 */
export function scheduleNotice(res = {}) {
    const list = Array.isArray(res && res.scheduled) ? res.scheduled : [];
    const next = list[0];
    if (!next) {return null;}
    // Number(null) هو 0، و«0س» مجدولة ليست معلومة غائبة: العمود يجوز فيه
    // shift_karim/shift_start أن يكونا فارغين، فلا يُطبع إلا رقمٌ موجب.
    const hours = Number(next.shift_karim);
    return {
        effectiveFrom: String(next.effective_from || '').slice(0, 10),
        start: String(next.shift_start || '').slice(0, 5),
        hours: Number.isFinite(hours) && hours > 0 ? String(hours) : '',
        extra: Math.max(0, list.length - 1),
    };
}

/**
 * The four badge states, in the order they are tested — the thresholds are
 * smart-card.js:192-195, unchanged. `tone` is V2's own badge vocabulary.
 */
export const CARD_BADGES = [
    { min: 95, label: 'ممتاز', tone: 'success' },
    { min: 85, label: 'ممتاز', tone: 'info' },
    { min: 70, label: 'جيد', tone: 'warning' },
    { min: Number.NEGATIVE_INFINITY, label: 'يحتاج تحسين', tone: 'danger' },
];

/**
 * Card KPIs from the attendance report summary. Zero working days is a stated
 * dash (`rate: null`), never «100% of nothing».
 * @param {object} [summary] backend/hr-routes.js:229-241
 */
export function cardKpis(summary = {}) {
    const workDays = int(summary.daysPresent);
    const completeDays = int(summary.completeDays);
    const lateDays = int(summary.lateDays);
    const reviewDays = int(summary.reviewDays);
    const lateHours = num(summary.totalLateHours) ?? 0;
    const lateMinutes = Math.max(0, int(summary.totalLateMinutes));
    const rate = workDays > 0
        ? Number((((workDays - lateDays) / workDays) * 100).toFixed(1))
        : null;
    const badge = rate === null ? null : CARD_BADGES.find((b) => rate >= b.min);
    return {
        workDays,
        completeDays,
        lateDays,
        reviewDays,
        lateHours,
        lateMinutes,
        rate,
        badge: badge ? badge.label : null,
        badgeTone: badge ? badge.tone : 'neutral',
    };
}

/**
 * الصافي التقديري — the legacy card's own equation (smart-card.js:197-198):
 * one hour deducted per 60 late minutes, hourly wage = salary ÷ (days × 10).
 * «تقديري» is not modesty: the ACTUAL deduction is computed by the payroll
 * engine (backend/hr-routes.js:969) and applied from the payroll screen.
 * Null when there is no salary, or no attendance to deduct against.
 * @param {{salary?: number|string, lateMinutes?: number|string, workDays?: number|string}} [input]
 */
export function cardPayroll({ salary, lateMinutes, workDays } = {}) {
    const basic = num(salary);
    if (basic === null) {return null;}
    const days = Math.max(0, int(workDays));
    if (days <= 0) {return null;}
    const mins = Math.max(0, int(lateMinutes));
    const deductionHours = Math.round(mins / 60);
    const deduction = Math.round(deductionHours * (basic / (days * 10)));
    return {
        basic,
        lateMinutes: mins,
        lateHours: Number((mins / 60).toFixed(2)),
        deductionHours,
        deduction,
        net: Math.max(0, Math.round(basic - deduction)),
        estimated: true,
    };
}

/**
 * رمز النظام — the payload exactly as the server sealed it. It is never
 * rebuilt client-side: a client-made payload is a payload the kiosk cannot
 * verify (backend/hr-routes.js:758 verifies against the stored token hash).
 * @param {{qrPayload?: object}} [card]
 */
export function systemQrText(card = {}) {
    const payload = card && card.qrPayload;
    if (!payload) {return '';}
    return JSON.stringify(payload);
}

/**
 * رمز البيانات — the readable twin (smart-card.js:78-89): scanned by a phone
 * to SHOW data, never by the kiosk. A field with no value is written «—» so
 * the reader learns the field is absent, not that the code failed to load.
 * @param {{employeeName?:string, employeeCode?:string, deptName?:string,
 *          position?:string, deviceUserId?:string, cardId?:string, company?:string}} [input]
 */
export function humanQrText(input = {}) {
    const { employeeName, employeeCode, deptName, position, deviceUserId, cardId, company } = input;
    const line = (label, value) => `${label}: ${value ? String(value) : '—'}`;
    const head = company ? `${String(company)} — بطاقة موظف` : 'بطاقة موظف';
    return [
        head,
        line('الاسم', employeeName),
        line('الرقم الوظيفي', employeeCode),
        line('القسم', deptName),
        line('المنصب', position),
        line('رقم البصمة', deviceUserId),
        line('رقم البطاقة', cardId),
    ].join('\n');
}

/* ═══ W2-5 · كشف يوم/فترة + بطاقة الطباعة الرسمية ══════════════════════════
 * النصف الثاني من البطاقة القديمة (smart-card.js:716-808): كشف يوم، وكشف
 * فترة حرّة، وبطاقة «lux» يولّدها الخادم ويطبعها. نفس قاعدة وجه البطاقة أعلى
 * الملف: أرقام الخادم تُقرأ، ولا يُعاد اشتقاقها في المتصفح.
 */

/** سقف أيام الكشف — رقم القديم نفسه (smart-card.js:758)، لا سقفًا مُخترعًا. */
export const MAX_RANGE_DAYS = 62;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * أيام الفترة بترتيب تصاعدي، شاملة الطرفين — smart-card.js:756-761 حرفًا
 * (بناء T12:00 حتى لا يُزيح تحويل المنطقة يومًا كاملًا). يومٌ بلا سجل يجب أن
 * يظهر «لم يحضر»: جدولٌ مبنيّ من السجلات وحدها يخفي الغياب، وهو نصف المعلومة.
 * @param {string} from YYYY-MM-DD
 * @param {string} to   YYYY-MM-DD
 * @param {number} [max] سقف الأيام
 * @returns {string[]} أيام ISO
 */
export function rangeDays(from, to, max = MAX_RANGE_DAYS) {
    if (!DATE_RE.test(String(from || '')) || !DATE_RE.test(String(to || ''))) {return [];}
    const out = [];
    const end = new Date(`${String(to).slice(0, 10)}T12:00:00`);
    for (let d = new Date(`${String(from).slice(0, 10)}T12:00:00`); d <= end && out.length < max; d.setDate(d.getDate() + 1)) {
        out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
    }
    return out;
}

/** حارس الشكل: يوم ISO صالح. */
const isIsoDay = (v) => DATE_RE.test(String(v || ''));

/**
 * كشف الفترة: صفٌّ لكل يوم في المدى + ملخّصٌ من حقول الخادم وحدها.
 *
 * THREE LEGACY BUGS CORRECTED (declared, never silent — all three in
 * smart-card.js:749-796):
 *   • :752 read `employee.shift_hours`, a field GET /hr/attendance/report never
 *     returns (it returns shift_karim, hr-routes.js:242), so the shift was
 *     always the 10-hour fallback and every «تأخير» in the legacy sheet was a
 *     second, guessed figure. Here a row's state comes from the record's own
 *     `lateMinutes` (hr-routes.js:218) — the same number the attendance screen
 *     shows, so sheet and screen cannot disagree.
 *   • :787 printed «إجمالي الساعات» from `summary.totalHours` — also never
 *     sent, so the legacy paper always read 0. `totalKarim` (hr-routes.js:241)
 *     is what is printed here.
 *   • Every day with no punch became «لم يحضر», including the employee's
 *     rostered weekly rest day, so a printed sheet accused a person of
 *     absence on a day they were never scheduled. `day_off` is in this same
 *     payload (hr-routes.js:242) and the encoding is 0=الأحد…6=السبت; the
 *     screen already refuses that misreading through isWeeklyOff
 *     (attendance-repo.js:828, whose comment states the rule). The sheet here
 *     asks the same authority, so كشف and شاشة cannot diverge on it. A rest
 *     day that WAS punched keeps its punched state — presence is the newer
 *     fact. مدىً بلا أي سجل يعيد الخادم فيه `employee: null` (hr-routes.js:242)،
 *     فلا تُدَّعى راحةٌ ولا يُخترع جدول: غياب المعلومة ليس معلومةً عن الغياب.
 *
 * @param {{employee?:object, records?:Array<object>, summary?:object}} [report]
 * @returns {{employee:object|null, rows:Array<object>, summary:object, truncated:boolean}}
 */
export function rangeReportRows(report = {}) {
    const summary = (report && report.summary) || {};
    const emp = (report && report.employee) || {};
    const records = Array.isArray(report && report.records) ? report.records : [];
    const byDate = new Map();
    for (const rec of records) {
        const key = String((rec && rec.date) || '').slice(0, 10);
        if (isIsoDay(key)) {byDate.set(key, rec);}
    }
    const from = String(summary.from || '').slice(0, 10);
    const to = String(summary.to || '').slice(0, 10);
    let days = rangeDays(from, to);
    const truncated = days.length === MAX_RANGE_DAYS
        && rangeDays(from, to, MAX_RANGE_DAYS + 1).length > MAX_RANGE_DAYS;
    if (!days.length) {days = [...byDate.keys()].sort();}

    const rows = days.map((date) => {
        const off = isWeeklyOff(emp, date);
        const rec = byDate.get(date);
        if (!rec) {
            return {
                date, state: off ? 'day-off' : 'absent', weeklyOff: off,
                minutes: 0, lateMinutes: 0, checkIn: '', checkOut: '',
            };
        }
        const checkIn = String(rec.checkIn || '').trim();
        const checkOut = String(rec.checkOut || '').trim();
        const lateMinutes = Math.max(0, int(rec.lateMinutes));
        let state;
        // راحةٌ أسبوعية بلا بصمة ليست «بلا حضور»؛ وراحةٌ بُصم عليها يومٌ عملٍ
        // كما هو — الحضور حقيقةٌ أحدث من الجدول.
        if (!checkIn && off) {state = 'day-off';}
        // Order matters only for readability: the server's needsReview flag
        // already implies both punches present (hr-routes.js:217).
        else if (rec.needsReview) {state = 'review';}
        else if (!checkIn) {state = 'no-in';}
        else if (!checkOut) {state = 'no-out';}
        else if (lateMinutes > 0) {state = 'late';}
        else {state = 'in-time';}
        return {
            date, state, checkIn, checkOut, weeklyOff: off,
            minutes: Math.max(0, int(rec.workMinutes)),
            lateMinutes,
        };
    });

    const countable = records.filter((r) => r && !r.needsReview);
    const onTimeDays = countable
        .filter((r) => r.checkIn && r.checkOut && !(Number(r.lateMinutes) > 0))
        .length;
    return {
        employee: (report && report.employee) || null,
        rows,
        truncated,
        summary: {
            from,
            to,
            daysPresent: int(summary.daysPresent),
            completeDays: int(summary.completeDays),
            lateDays: int(summary.lateDays),
            onTimeDays,
            reviewDays: int(summary.reviewDays),
            reviewMinutes: int(summary.reviewMinutes),
            totalKarim: num(summary.totalKarim) ?? 0,
            totalLateMinutes: int(summary.totalLateMinutes),
            totalLateHours: num(summary.totalLateHours) ?? 0,
        },
    };
}

/**
 * GET /hr/employees/:id/lux-card — بطاقة «lux» يولّدها الخادم من
 * tools/employee-card/generate-card.js ويعيدها **HTML** لا JSON، فيلزم fetch
 * خام مع رأس المصادقة (apiFetch يرمي على res.json() فيعيد null صامتًا —
 * core/api.js:17+؛ وهذا احتمال الخطأ الوحيد الذي يُفسد الميزة بلا رسالة).
 * الدور: ADMIN_ROLES أو الموظف نفسه (hr-routes.js:279-284)، وموظفٌ بلا رقم
 * بصمة يرد 422 برسالته العربية. نفس نمط printLuxCard في smart-card.js:702-714.
 * @param {number|string} employeeId
 * @returns {Promise<string>} صفحة البطاقة كما ولّدها الخادم
 */
export async function fetchLuxCardHtml(employeeId) {
    const id = Number(employeeId);
    if (!Number.isInteger(id) || id <= 0) {throw new Error('معرف الموظف غير صحيح');}
    const headers = {};
    if (typeof window !== 'undefined' && window._jwt) {headers.Authorization = `Bearer ${window._jwt}`;}
    if (typeof window !== 'undefined' && window._appKey) {headers['x-api-key'] = window._appKey;}
    const res = await fetch(`${API_BASE}/hr/employees/${id}/lux-card`, { headers });
    if (!res.ok) {
        let msg = `تعذر توليد البطاقة (${res.status})`;
        try {
            const e = await res.clone().json();
            if (e && (e.message || e.error)) {msg = e.message || e.error;}
        } catch (_) { /* صفحة HTML — يبقى الردّ العام + الرمز */ }
        throw new Error(msg);
    }
    return res.text();
}
