/**
 * V2 — Employees repository (الباب الوحيد إلى /api/employees*)
 * ═══════════════════════════════════════════════════════════════════════
 *
 * CONTRACT COPIED FROM THE SERVER, NOT INVENTED
 *   GET /employees?page=&limit=&sort=id&order=asc → { data, pagination }
 *     (app.js:81 apiList shape. READ HAS NO ROLE GATE: employees is in
 *     neither sensitiveReadEntities nor ENTITY_READ_ROLES, so every
 *     authenticated principal reads the list — that is what lets the
 *     employee portal serve all roles. The salary column is masked
 *     server-side for non-elevated roles: maskEmployeeRowForRole DELETES
 *     the key outside admin|manager|hr — schema-registry.js:825-838.)
 *   GET /hrDepartments?... → same shape; rows carry { code, name, ... }
 *     (features/hr.js:752 joins d.code === emp.department for display.)
 *
 * DISPLAY ALLOWLIST — READ THIS BEFORE ADDING A COLUMN
 *   The API returns full rows, including salary, iqamaNumber, qr tokens
 *   and fingerprints (verified column list, 2026-10-13). The legacy screen
 *   renders selected columns the same way; field-level redaction would
 *   need a backend change, which V2 never makes. Therefore employeeToRow
 *   returns ONLY the safe roster fields below. Anything sensitive must
 *   never be added to the row — not hidden, not title-attr, nowhere.
 *   Allowed: employeeId, name, department, position, phone, status.
 *
 * SALARY — THE ONE DOCUMENTED EXCEPTION (screen 02 cards, 2026-10-14)
 *   Legacy employee CARDS show salary (features/employees.js:90), and the
 *   only roles that may open this screen are admin|manager|hr — the same
 *   audience. Salary therefore reaches the card painter through a
 *   SEPARATE id→extras map (cardExtrasMap, below: salary, device number,
 *   shift facts), never through the row: tests/v2-employees.test.js pins
 *   the row shape, and generic consumers (tables, selection, logs) must
 *   never see a salary. iqama, tokens and fingerprints stay out of every
 *   path — no exception for those.
 *
 * READS + WRITES — EACH DOOR PINNED TO ITS SERVER LINE (W2-2)
 *   The fetch functions serve screen 02 (the roster) AND the name/department
 *   join of screen 01 (attendance) — one source of truth, so the two screens
 *   can never disagree about who belongs to which department. The derived
 *   layer (counts, chips, filters) is screen 02's arithmetic; what a stored
 *   status LOOKS like is decided only by js/v2/status.js, which the screen
 *   passes in as `labelOf`.
 *
 *   Writes go through the SAME generic CRUD every legacy write uses, and
 *   every rule below is a copy of the server's, not a policy of our own:
 *     • POST /employees   — server.js:1780 (guard :1779-1780) + :1802-1829
 *       (required name+employeeId via schema-registry.js:92, department must
 *       exist in hrDepartments else 422 INVALID_HR_DEPARTMENT, shift norm
 *       :1820-1827, auto_checkout/auto_lock dropped for non-admin :1814-1817)
 *     • PUT /employees/:id — server.js:2037 + :2093-2112 (no department
 *       existence check on update; same shift + auto rules)
 *     • DELETE /employees/:id — server.js:2286 (hard delete, not protected)
 *   Write roles: OPEN_ENTITY_WRITE_ROLES.employees = admin|manager|hr
 *   (schema-registry.js:776-799) OR an hr.edit grant (permissions.js:21-26);
 *   grants are not visible client-side, so empWriteVisible is a UI
 *   convenience only — the server re-checks every request.
 *
 *   buildEmployeePayload NEVER invents a field: it emits exactly the 24
 *   writeable keys of schema-registry.js:81-91, and only the subset the form
 *   carries. The server rejects unknown keys outright (filterBody → 400
 *   INVALID_PAYLOAD), so smuggling anything else is not a silent no-op — it
 *   kills the whole request. digitalFingerprint and cardId are NOT client
 *   fields in V2: the server provisions both when a QR card is issued
 *   (hr-routes.js:91-108), and the legacy client-side SHA-256 fingerprint
 *   (smart-card.js:20-28) is a declared deviation, not a dependency.
 *
 * EMPLOYEE FILE (كشف) DOORS — server-gated, mirrored as reads
 *   GET  /hr/employees/:id/card           hr-routes.js:173 (ADMIN_ROLES or
 *     own userId; may provision a card server-side on first read)
 *   POST /hr/employees/:id/qr/regenerate  hr-routes.js:190 (admin|hr|manager)
 *   GET  /hr/attendance/report            hr-routes.js:210 (non-admin forced
 *     to own record — the screen never invents employee_id it wasn't given)
 *
 * SHEET IMPORT/EXPORT — legacy texts mirrored, columns narrowed by design
 *   EMP_SHEET_COLS is the legacy import template verbatim
 *   (features/employees.js:465). Export follows the SAME 12 columns instead
 *   of the legacy export's 11 (which mismatched the template — a legacy
 *   bug), but drops البصمة الرقمية and رقم البطاقة: identifiers the V2
 *   posture never exports. normArSheet/sheetNormDate mirror
 *   features/employees.js:466-474 exactly so the same files stay readable.
 */

import { apiFetch } from '../../core/api.js?v=4.9.130';

/** Bounded pagination shared by both lists (5 × 1000). */
async function fetchPaged(path) {
    const rows = [];
    for (let page = 1; page <= 5; page += 1) {
        const sep = path.includes('?') ? '&' : '?';
        const res = await apiFetch(`${path}${sep}page=${page}&limit=1000&sort=id&order=asc`);
        const batch = res && Array.isArray(res.data) ? res.data
            : (Array.isArray(res) ? res : []);
        rows.push(...batch);
        const totalPages = Number(res && res.pagination && res.pagination.totalPages) || 0;
        if (!batch.length || (totalPages > 0 && page >= totalPages) || batch.length < 1000) {break;}
    }
    return rows;
}

/** @returns {Promise<any[]>} */
export function fetchEmployees() {
    return fetchPaged('/employees');
}

/** @returns {Promise<any[]>} */
export function fetchDepartments() {
    return fetchPaged('/hrDepartments');
}

export function employeeMap(employees = []) {
    const map = new Map();
    for (const e of employees) {
        if (e && e.id !== undefined && e.id !== null) {map.set(String(e.id), e);}
    }
    return map;
}

export function departmentMap(departments = []) {
    const map = new Map();
    for (const d of departments) {
        if (d && d.code !== undefined && d.code !== null) {map.set(String(d.code), d);}
    }
    return map;
}

/**
 * id → card-only extras (salary, photo, device enrolment number, shift
 * facts). The ONLY non-row path in V2, feeding the employee card painter
 * directly — see the header note. Pure and exported so it is testable
 * without a browser.
 */
export function cardExtrasMap(employees = []) {
    const map = new Map();
    for (const e of employees) {
        if (e && e.id !== undefined && e.id !== null) {
            // عمود الراتب يجوز أن يكون NULL في القاعدة، و Number(null) هو 0:
            // بطاقةٌ تطبع «الراتب الأساسي: 0.00» لموظفٍ لا راتب مسجّلًا له
            // تكذب، والخصم التقديري يُبنى فوقها. القاعدة نفسها مطبَّقة في
            // مسار التصدير أدناه (:686)، فتركها هنا كان سهوًا لا قرارًا.
            const salary = e.salary === null || e.salary === undefined || e.salary === ''
                ? null : Number(e.salary);
            map.set(String(e.id), {
                salary: Number.isFinite(salary) ? salary : null,
                photo: e.photo ? String(e.photo) : '',
                deviceUserId: e.deviceUserId !== undefined && e.deviceUserId !== null
                    && String(e.deviceUserId) !== '' ? String(e.deviceUserId) : '',
                shift_start: e.shift_start !== undefined && e.shift_start !== null
                    ? String(e.shift_start) : '',
                shift_karim: Number(e.shift_karim) > 0 ? Number(e.shift_karim) : 0,
                auto_checkout: !!e.auto_checkout,
                auto_lock: !!e.auto_lock,
                day_off: e.day_off !== undefined && e.day_off !== null ? Number(e.day_off) : null,
            });
        }
    }
    return map;
}

/** First letters of the first two words — the legacy avatar fallback
 *  (features/employees.js:76), Latin and Arabic alike. */
export function initialsOf(name) {
    return String(name || '').split(' ').map((w) => w[0]).join('').substring(0, 2) || '؟';
}

/** Photo URLs the card <img> accepts. Anything else (javascript:, blobs
 *  from unknown schemes, markup) falls back to initials — the legacy
 *  screen renders the stored string raw; V2 does not. */
export function validPhotoSrc(photo) {
    const s = String(photo || '').trim();
    if (/^data:image\//i.test(s) || /^\//.test(s) || /^https?:\/\//i.test(s)) {return s;}
    return '';
}

/**
 * Shift facts for the card line — pure replica of the legacy chip logic
 * (features/employees.js:48-64 empShiftChip): start time, length,
 * overnight flag, auto-checkout, lock, weekly day off. Presentation
 * (badges vs dots) stays in the screen; numbers here are identical to
 * the legacy ones.
 */
export function shiftSummary(emp = {}) {
    const st = String(emp.shift_start || '09:00');
    const hrs = Number(emp.shift_karim) > 0 ? Number(emp.shift_karim) : 10;
    const m = st.match(/^(\d{1,2}):(\d{2})$/);
    let overnight = false;
    if (m) {
        const startMin = Number(m[1]) * 60 + Number(m[2]);
        const end = (startMin + Math.round(hrs * 60)) % (24 * 60);
        overnight = end <= startMin;
    }
    const offNames = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
    const offIdx = Number(emp.day_off);
    return {
        start: st,
        hours: String(hrs).replace(/\.0$/, ''),
        overnight,
        auto: !!emp.auto_checkout,
        locked: !!emp.auto_lock,
        off: (emp.day_off === 0 || emp.day_off) && offNames[offIdx] ? offNames[offIdx] : '',
    };
}

/**
 * Database row → table row. ALLOWLIST subset (see header) — pure and
 * exported so it is testable without a browser (branches-repo.js pattern).
 */
export function employeeToRow(e = {}, deptByCode = new Map()) {
    const deptCode = e.department !== undefined && e.department !== null ? String(e.department) : '';
    const dept = deptByCode.get(deptCode);
    const status = e.status !== undefined && e.status !== null ? String(e.status) : '';
    return {
        id: e.id,
        code: e.employeeId !== undefined && e.employeeId !== null ? String(e.employeeId) : '—',
        name: e.name ? String(e.name) : `#${e.id ?? '؟'}`,
        nameResolved: !!e.name,
        dept: dept && dept.name ? String(dept.name) : (deptCode || '—'),
        deptCode,
        deptResolved: !!(dept && dept.name),
        position: e.position ? String(e.position) : '—',
        phone: e.phone ? String(e.phone) : '—',
        status,
    };
}

/* ── Derived layer (شاشة 02) ──────────────────────────────────────────────
 * Pure arithmetic over the roster the screen already holds. What a stored
 * status LOOKS like is never decided here: the labels, tones and glyphs come
 * from js/v2/status.js, the single authority for statuses.
 */

/** Integer convention shared with the other V2 screens (Latin digits +
 *  thousands grouping) — attendance-repo.js, briefing-repo.js. */
export function formatInt(v) {
    return Math.round(Number(v) || 0).toLocaleString('en-US');
}

/** A share needs a real base: an empty roster gets a stated dash, not "0%"
 *  of nothing. `label` is what the pill names, so the aria never guesses. */
export function rosterPill(count, base, label) {
    if (!(base > 0)) {
        return { text: '—', on: false, aria: `لا موظفين في الدليل — لا نسبة تُحسب لـ${label}` };
    }
    const pct = (count / base) * 100;
    return {
        text: `${pct.toFixed(1)}%`, on: true,
        aria: `${label}: ${formatInt(count)} من ${formatInt(base)} موظفًا (${pct.toFixed(1)}%)`,
    };
}

/**
 * Count rows by one raw field, most frequent first. Keys stay the stored
 * strings — '' is a real case (the field was empty) and is kept, not merged
 * into whatever label reads best.
 * @param {any[]} rows
 * @param {(row:any)=>any} pick
 */
export function countBy(rows = [], pick = (r) => r) {
    const map = new Map();
    for (const r of rows) {
        const key = String(pick(r) ?? '');
        map.set(key, (map.get(key) || 0) + 1);
    }
    return [...map.entries()]
        .map(([value, count]) => ({ value, count }))
        .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value, 'ar'));
}

/** @returns {{value:string,count:number}[]} status as stored, largest first */
export function statusCounts(rows = []) {
    return countBy(rows, (r) => (r && r.status !== undefined && r.status !== null ? String(r.status) : ''));
}

/**
 * Department distribution keyed by the STORED code, so two codes that happen
 * to carry the same name stay two rows. `label` is the join result the row
 * already shows; `resolved:false` means it is a bare code (or empty) and the
 * screen says so instead of inventing a department.
 */
export function deptCounts(rows = []) {
    const byCode = new Map();
    for (const r of rows) {
        const code = String((r && r.deptCode) ?? '');
        const hit = byCode.get(code);
        if (hit) {hit.count += 1; continue;}
        byCode.set(code, {
            code,
            label: r && r.dept ? String(r.dept) : '—',
            resolved: !!(r && r.deptResolved),
            count: 1,
        });
    }
    return [...byCode.values()]
        .sort((a, b) => b.count - a.count
            || (a.label || '—').localeCompare(b.label || '—', 'ar'));
}

/** Screen-level filters. Empty string (or 'all') = that filter is off.
 *  '—' is the option the screen shows for a field the record does not
 *  carry, so it must match rows whose stored value is empty — the only
 *  other choice would be a filter that silently returns nothing. */
export function applyEmployeeFilters(rows = [], { dept = '', status = '' } = {}) {
    const want = (v) => (!v || v === 'all' ? null : String(v === '—' ? '' : v));
    const d = want(dept);
    const s = want(status);
    return rows.filter((r) => (d === null || String((r && r.deptCode) ?? '') === d)
        && (s === null || String((r && r.status) ?? '') === s));
}

/* ── البحث (W2-6) ───────────────────────────────────────────────────────
 * الدليل كله محمَّل في الذاكرة (fetchPaged أعلى: 5 × 1000)، فالباب بحثٌ
 * محليٌّ لا شبكة فيه — والقديم كان يبحث هكذا فعلًا
 * (features/employees.js:172-181 للاسم/الكود/الوظيفة، و:107-129 لرقم
 * الموظف والبصمة بعدادلةٍ رقمية). الناقص في V2 كان التطبيع نفسه.
 */

/** جدول الحروف نفسه في core/utils.js:165-172 — نسخةٌ هنا لأن طبقة البيانات
 *  لا تستورد طبقة العرض، وهو نفس ما صنعه dispatch-repo.js:253. الاختبار
 *  يقرأ الملفين معًا ويثبّت أن الجدولين لم يتباعدا. */
export function arSearchKey(s) {
    return String(s || '').toLowerCase()
        .replace(/[\u064B-\u065F\u0640]/g, '')
        .replace(/[أإآٱ]/g, 'ا').replace(/ة/g, 'ه').replace(/[ىئی]/g, 'ي').replace(/ؤ/g, 'و').replace(/ک/g, 'ك')
        .replace(/[ذز]/g, 'ز').replace(/[ضص]/g, 'ص').replace(/[ظط]/g, 'ط').replace(/[شس]/g, 'س')
        .replace(/[ثت]/g, 'ت').replace(/[خج]/g, 'ح').replace(/[قف]/g, 'ف').replace(/[غع]/g, 'ع')
        .replace(/\s+/g, ' ').trim();
}

/** «007» و«7» رقمٌ واحد — نفس معادلة القديم (features/employees.js:115). */
function digitForm(v) {
    const s = String(v ?? '').trim();
    return /^\d+$/.test(s) ? String(Number(s)) : '';
}

/** حقول السطر التي يجوز أن يُبحث فيها — لا شيء غير ما تعرضه الشاشة أصلًا،
 *  فالحقل الذي لا يراه الموظف لا يُبحث فيه. */
function searchFields(row, extrasById) {
    const ex = extrasById.get(String(row && row.id)) || {};
    const pick = (v) => (v === undefined || v === null ? '' : String(v));
    return {
        name: pick(row && row.name),
        code: pick(row && row.code),
        position: pick(row && row.position),
        dept: pick(row && row.dept),
        phone: pick(row && row.phone),
        fp: pick(ex.deviceUserId),
    };
}

/** درجة كلمةٍ واحدة في سطر: 3 معادلةُ رقمٍ مخزَّن، 2 الاسم، 1 ما عداه، 0 لا. */
function tokenScore(tok, v) {
    const raw = tok.toLowerCase();
    const key = arSearchKey(tok);
    if (/^\d+$/.test(raw)) {
        const d = digitForm(raw);
        if (d && (digitForm(v.code) === d || digitForm(v.fp) === d)) {return { score: 3, folded: false };}
    }
    if (raw && (v.code.toLowerCase() === raw || v.fp.toLowerCase() === raw)) {return { score: 3, folded: false };}
    if (raw && v.name.toLowerCase().includes(raw)) {return { score: 2, folded: false };}
    if (key && arSearchKey(v.name).includes(key)) {return { score: 2, folded: true };}
    for (const f of ['code', 'position', 'dept', 'phone', 'fp']) {
        if (raw && v[f].toLowerCase().includes(raw)) {return { score: 1, folded: false };}
        if (key && arSearchKey(v[f]).includes(key)) {return { score: 1, folded: true };}
    }
    // تليفونٌ مكتوبٌ بأرقامٍ وحدها: «1001234» يلاقي «+20 100 123 4567».
    if (/^\d{3,}$/.test(raw)) {
        const digits = raw.replace(/\D/g, '');
        if (v.phone.replace(/\D/g, '').includes(digits) || v.code.replace(/\D/g, '').includes(digits)) {
            return { score: 1, folded: false };
        }
    }
    return { score: 0, folded: false };
}

/**
 * بحثٌ مطبَّع بدرجاتٍ معلنة: كلُّ كلمة في الكتابة لازم تلاقي موضعًا في السطر
 * (AND)، ودرجةُ السطر أدنىُ درجات كلماته — فيأتي «كريم شيف» لسطرٍ فيه
 * الاثنتان ولا يأتي سطرٌ فيه إحداهما. الترتيب بعدَها بالأولوية، ومرتبُ
 * الدليل محفوظٌ داخل كل أولوية (فرزٌ مستقر).
 *
 * @returns {{rows:Array<object>, matched:boolean, exact:number, folded:boolean, hits:number}}
 *   `exact`  عدُّ المطابقات التامة لرقم موظف أو بصمة (درجة 3)
 *   `folded` نتيجةٌ واحدة على الأقل لم تأتِ إلا بعد التطبيع — تقولها الشاشة
 *            ولا تُخفيها، وإلا صار البحث الذكيُّ خطأً صامتًا.
 */
export function searchEmployees(rows = [], query = '', extrasById = new Map()) {
    const raw = String(query ?? '').trim();
    if (!raw) {return { rows, matched: false, exact: 0, folded: false, hits: rows.length };}
    const tokens = raw.split(/\s+/).filter(Boolean);
    const scored = [];
    for (const row of rows) {
        const v = searchFields(row, extrasById);
        let score = 3;
        let folded = false;
        for (const tok of tokens) {
            const t = tokenScore(tok, v);
            if (t.score === 0) {score = 0; break;}
            if (t.score < score) {score = t.score;}
            if (t.folded) {folded = true;}
        }
        if (score > 0) {scored.push({ row, score, folded });}
    }
    scored.sort((a, b) => b.score - a.score);
    return {
        rows: scored.map((x) => x.row),
        matched: true,
        exact: scored.filter((x) => x.score === 3).length,
        folded: scored.some((x) => x.folded),
        hits: scored.length,
    };
}

/**
 * The chips on top of the roster. One per status the rows actually contain
 * (a brand-new enum value therefore gets its own chip instead of hiding
 * inside a total), plus the two numbers a manager asks next: how many
 * departments the roster spans, and who has no phone on file.
 * @param {any[]} rows
 * @param {{scope?:string, labelOf?:(value:string)=>{label:string,tone:string,icon:string}}} opts
 */
export function buildEmployeeKpis(rows = [], opts = {}) {
    const total = rows.length;
    const scope = opts.scope || 'الدليل كله';
    const labelOf = opts.labelOf || ((v) => ({ label: v || 'غير محدد', tone: 'neutral', icon: 'circle-help' }));
    const pill = (n, label) => ({ ...rosterPill(n, total, label), label });

    const chips = [{
        id: 'total', icon: 'users', tone: 'neutral', label: 'إجمالي الدليل', en: 'Roster',
        value: formatInt(total), unit: '',
        hint: `${scope} · بلا تكرار ولا تصفية`,
        pill: pill(total, 'إجمالي الدليل'),
    }];

    for (const s of statusCounts(rows)) {
        const pres = labelOf(s.value);
        chips.push({
            id: `status:${s.value}`, icon: pres.icon, tone: pres.tone,
            label: pres.label, en: 'Status',
            value: formatInt(s.count), unit: '',
            hint: s.value ? `الحالة كما هي مخزّنة: ${s.value}` : 'لا حالة مخزّنة في السجل',
            pill: pill(s.count, pres.label),
        });
    }

    const depts = deptCounts(rows);
    const named = depts.filter((d) => d.resolved).length;
    const biggest = depts[0];
    chips.push({
        id: 'depts', icon: 'building-2', tone: 'info', label: 'الأقسام', en: 'Departments',
        value: formatInt(depts.length), unit: 'قسمًا',
        hint: depts.length
            ? (named === depts.length
                ? 'كل قسم معروف في دليل الأقسام'
                : `${formatInt(named)} من ${formatInt(depts.length)} أقسام معروفة في دليل الأقسام`)
            : 'لا أقسام في الدليل',
        // A count of departments has no share of the roster, so the pill
        // carries the next real number instead: how big the biggest one is.
        pill: biggest
            ? { text: formatInt(biggest.count), on: true, label: 'في أكبر قسم',
                aria: `${biggest.code === '' ? 'بلا قسم' : biggest.label}: ${formatInt(biggest.count)} من ${formatInt(total)} موظفًا` }
            : { text: '—', on: false, label: 'في أكبر قسم', aria: 'لا قسم في الدليل — لا أكبر قسم' },
    });

    const noPhone = rows.filter((r) => !r || !r.phone || r.phone === '—').length;
    chips.push({
        id: 'no-phone', icon: 'phone', tone: noPhone ? 'warning' : 'success',
        label: 'بلا هاتف مسجّل', en: 'No phone',
        value: formatInt(noPhone), unit: '',
        hint: noPhone ? 'حقل الهاتف فارغ في قاعدة البيانات' : 'كل موظف في الدليل له هاتف',
        pill: pill(noPhone, 'بلا هاتف'),
    });

    return chips;
}

/* ── Write doors (W2-2) ──────────────────────────────────────────────────
 * Every rule here is a copy of the server's; see the file header for the
 * exact line references. The server stays the authority — these checks
 * only spare the user a round-trip for mistakes the form can see.
 */

/** Mirror of OPEN_ENTITY_WRITE_ROLES.employees (schema-registry.js) OR an
 *  hr.edit grant (permissions.js) — UI convenience, never a security gate. */
export const EMP_WRITE_ROLES = ['admin', 'manager', 'hr'];
export function empWriteVisible(role) {
    return EMP_WRITE_ROLES.includes(String(role || ''));
}

const isBlank = (v) => v === null || v === undefined || String(v).trim() === '';

/** Employee field length limits — schema-registry.js:117-123 verbatim. */
const EMP_MAX_LENGTH = {
    name: 255, employeeId: 50, department: 50, position: 255,
    phone: 50, email: 255, status: 50,
    iqamaExpiry: 50, healthCertExpiry: 50, healthEduExpiry: 50,
    deviceUserId: 64, shift_start: 5,
};

/**
 * Client-side mirror of the server's create/update checks for employees.
 * @param {object} form flat form values (strings, as read from inputs)
 * @param {{editing?:boolean, existingIds?:Set<string>|string[],
 *          deptCodes?:string[]|null}} [opts]
 * @returns {{field:string, message:string}[]} errors, empty when clean
 */
export function validateEmployeeForm(form = {}, opts = {}) {
    const errors = [];
    const editing = !!opts.editing;

    if (isBlank(form.name)) {errors.push({ field: 'name', message: 'أدخل الاسم والرقم الوظيفي' });}
    if (!editing && isBlank(form.employeeId)) {errors.push({ field: 'employeeId', message: 'أدخل الاسم والرقم الوظيفي' });}
    if (!editing && !isBlank(form.employeeId) && opts.existingIds) {
        const ids = opts.existingIds instanceof Set ? opts.existingIds : new Set([...opts.existingIds].map(String));
        const code = String(form.employeeId).trim();
        if (ids.has(code)) {errors.push({ field: 'employeeId', message: 'الرقم الوظيفي موجود بالفعل' });}
    }

    // shift-day.js:100-115 — the server's normalizeShiftStart, mirrored.
    if (!isBlank(form.shift_start)) {
        const m = String(form.shift_start).trim().match(/^(\d{1,2}):(\d{2})$/);
        if (!m) {
            errors.push({ field: 'shift_start', message: 'بداية الوردية بصيغة HH:MM (مثال 22:00)' });
        } else if (Number(m[1]) > 23 || Number(m[2]) > 59) {
            errors.push({ field: 'shift_start', message: 'بداية الوردية ساعة غير صالحة' });
        }
    }
    // shift-day.js:118-126 — normalizeShiftKarim, mirrored.
    if (!isBlank(form.shift_karim)) {
        const n = Number(form.shift_karim);
        if (!Number.isFinite(n) || n < 1 || n > 24) {
            errors.push({ field: 'shift_karim', message: 'ساعات الوردية بين 1 و 24' });
        }
    }
    if (!isBlank(form.salary)) {
        const n = Number(form.salary);
        if (!Number.isFinite(n) || n < 0) {errors.push({ field: 'salary', message: 'الراتب غير صحيح' });}
    }
    if (!isBlank(form.day_off)) {
        const n = Number(form.day_off);
        if (!Number.isInteger(n) || n < 0 || n > 6) {errors.push({ field: 'day_off', message: 'يوم الراحة بين 0 و 6' });}
    }
    // server.js:1805-1809 — a chosen department must exist in hrDepartments.
    if (opts.deptCodes && !isBlank(form.department) && !opts.deptCodes.includes(String(form.department).trim())) {
        errors.push({ field: 'department', message: 'القسم الوظيفي غير موجود، اختر قسمًا من أقسام الموارد البشرية' });
    }
    for (const [field, max] of Object.entries(EMP_MAX_LENGTH)) {
        const v = form[field];
        if (typeof v === 'string' && v.length > max) {
            errors.push({ field, message: `الحقل "${field}" أطول من المسموح (الحد الأقصى ${max} حرفًا)` });
        }
    }
    return errors;
}

/**
 * Form values → the exact JSON body POST/PUT accept. Emits ONLY the 24
 * writeable keys (schema-registry.js:81-91); anything else would fail the
 * server's filterBody with 400 INVALID_PAYLOAD, so less is the safe side.
 *
 * Conventions, mirroring the server:
 *   • create: blanks are OMITTED (column defaults apply). department blank →
 *     omitted → the server stores NULL (server.js:1803-1804).
 *   • update: blanks on clearable fields are sent as null/'', because
 *     "leave it blank" must be able to erase a stored value (DELETE of a
 *     phone number is a real operation; omitting it would keep the old one).
 *   • employeeId is create-only — the legacy edit dialog is readonly.
 *   • auto_checkout/auto_lock only for admin (server.js:1814-1817 drops them
 *     for everyone else silently; we never send what would be dropped).
 * @param {object} form
 * @param {{role?:string, editing?:boolean}} [opts]
 */
export function buildEmployeePayload(form = {}, opts = {}) {
    const editing = !!opts.editing;
    const isAdmin = String(opts.role || '') === 'admin';
    const p = {};
    const putText = (key, value) => { if (!isBlank(value)) {p[key] = String(value).trim();} };
    const putTextOrNull = (key, value) => { p[key] = isBlank(value) ? null : String(value).trim(); };
    const putNum = (key, value) => { if (!isBlank(value)) {p[key] = Number(value);} };
    const putNumOrNull = (key, value) => { p[key] = isBlank(value) ? null : Number(value); };

    putText('name', form.name);
    // The shift pair is always sent: the server normalizes '' itself
    // (server.js:1821-1824 — '' → '09:00' and '' → 9), so a cleared field
    // reaches a server-chosen value instead of a silent column default.
    p.shift_start = String(form.shift_start ?? '').trim();
    p.shift_karim = isBlank(form.shift_karim) ? '' : Number(form.shift_karim);

    if (editing) {
        putTextOrNull('department', form.department);
        putTextOrNull('position', form.position);
        putTextOrNull('phone', form.phone);
        putTextOrNull('email', form.email);
        putTextOrNull('status', form.status);
        putTextOrNull('deviceUserId', form.deviceUserId);
        putTextOrNull('joinDate', form.joinDate);
        putNumOrNull('salary', form.salary);
        putTextOrNull('iqamaExpiry', form.iqamaExpiry);
        putTextOrNull('healthCertExpiry', form.healthCertExpiry);
        putTextOrNull('healthEduExpiry', form.healthEduExpiry);
        putNumOrNull('day_off', form.day_off);
    } else {
        putText('employeeId', form.employeeId);
        putText('department', form.department);
        putText('position', form.position);
        putText('phone', form.phone);
        putText('email', form.email);
        putText('status', form.status);
        putText('deviceUserId', form.deviceUserId);
        putText('joinDate', form.joinDate);
        putNum('salary', form.salary);
        putText('iqamaExpiry', form.iqamaExpiry);
        putText('healthCertExpiry', form.healthCertExpiry);
        putText('healthEduExpiry', form.healthEduExpiry);
        putNum('day_off', form.day_off);
    }

    if (form.photo && typeof form.photo === 'string' && form.photo.startsWith('data:image/')) {p.photo = form.photo;}

    if (isAdmin) {
        if (form.auto_checkout !== undefined) {p.auto_checkout = !!form.auto_checkout;}
        if (form.auto_lock !== undefined) {p.auto_lock = !!form.auto_lock;}
    }
    return p;
}

/** POST /api/employees — server.js:1780 (201 → the created row). */
export function createEmployee(payload) {
    return apiFetch('/employees', { method: 'POST', body: JSON.stringify(payload) });
}

/** PUT /api/employees/:id — server.js:2037 (200 → the updated row). */
export function updateEmployee(id, payload) {
    return apiFetch(`/employees/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(payload) });
}

/** DELETE /api/employees/:id — server.js:2286 (hard delete; the employees
 *  entity is not in PROTECTED_DELETE_ENTITIES). */
export function deleteEmployee(id) {
    return apiFetch(`/employees/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

/* ── Employee-file doors (كشف) — every one of them is a server gate ────── */

/** GET /api/hr/employees/:id/card — hr-routes.js:173. May provision the QR
 *  card server-side on first read; 403 for roles outside admin|hr|manager
 *  unless it is the caller's own record. */
export function fetchEmployeeCard(id) {
    return apiFetch(`/hr/employees/${encodeURIComponent(id)}/card`);
}

/** POST /api/hr/employees/:id/qr/regenerate — hr-routes.js:190. Invalidates
 *  the previous QR (qrVersion+1); admin|hr|manager only, re-checked server-side. */
export function regenerateEmployeeQr(id) {
    return apiFetch(`/hr/employees/${encodeURIComponent(id)}/qr/regenerate`, { method: 'POST' });
}

/* ── Sheet import/export (W2-2) ─────────────────────────────────────────
 * The template columns are the legacy ones verbatim (features/employees.js:465);
 * the two normalizers mirror features/employees.js:466-474 so files written
 * for the legacy screen import without edits.
 */

export const EMP_SHEET_COLS = [
    'الرقم الوظيفي', 'الاسم', 'القسم', 'المنصب', 'الهاتف', 'البريد',
    'تاريخ الالتحاق', 'الراتب', 'الحالة',
    'انتهاء الإقامة', 'انتهاء الشهادة الصحية', 'انتهاء التثقيف الصحي',
];

/** Header + two sample rows — features/employees.js:475-483 verbatim. */
export function sheetTemplateRows() {
    return [
        [...EMP_SHEET_COLS],
        ['EMP-201', 'أحمد محمد', 'الإنتاج', 'عامل', '0500000001', 'a@x.com', '2024-01-15', 4500, 'نشط', '2027-01-01', '2027-06-01', '2027-06-01'],
        ['EMP-202', 'سارة علي', 'الإدارة', 'محاسبة', '0500000002', '', '2023-03-01', 7000, 'نشط', '', '', ''],
    ];
}

/** features/employees.js:466 verbatim — أ/إ/آ→ا, ة→ه, lowercase. */
export function normArSheet(s) {
    return String(s || '').replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').toLowerCase();
}

/** features/employees.js:467-474 verbatim — Excel serial, YYYY-MM-DD and
 *  DD-MM-YYYY accepted; anything else non-empty returns 'INVALID'. */
export function sheetNormDate(v) {
    if (v === null || v === undefined || v === '') {return '';}
    if (typeof v === 'number' && isFinite(v) && v > 20000 && v < 80000) {
        const d = new Date(Math.round((v - 25569) * 86400 * 1000));
        return isNaN(d) ? '' : d.toISOString().slice(0, 10);
    }
    const s = String(v).trim();
    let m = s.match(/^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})/);
    if (m) {return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;}
    m = s.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{4})/);
    if (m) {return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;}
    return s ? 'INVALID' : '';
}

/**
 * Sheet rows (matrix without header) → preflight model. Same rules and the
 * same words as features/employees.js:507-525: name+id required, duplicate
 * inside the file, already-existing skipped (not an error), bad dates and
 * negative salaries rejected, unknown department warned and left empty.
 * @param {any[][]} raw matrix rows (header row excluded by the caller)
 * @param {{existingIds?:Set<string>|string[], departments?:{code:string,name:string}[],
 *          statusByLabel?:Map<string,string>|Record<string,string>}} [opts]
 */
export function buildSheetImport(raw = [], opts = {}) {
    const existing = opts.existingIds instanceof Set
        ? new Set([...opts.existingIds].map((x) => String(x).trim()))
        : new Set((opts.existingIds || []).map((x) => String(x).trim()));
    const deptByName = new Map((opts.departments || []).map((d) => [normArSheet(String(d.name || '')), d.code]));
    const deptCodes = new Set((opts.departments || []).map((d) => String(d.code)));
    const labelMap = opts.statusByLabel instanceof Map
        ? opts.statusByLabel
        : new Map(Object.entries(opts.statusByLabel || {}));

    const rows = [];
    const seen = new Set();
    for (const r of raw) {
        if (!String(r[0] || '').trim() && !String(r[1] || '').trim()) {continue;}
        const o = {
            id: String(r[0] || '').trim(), name: String(r[1] || '').trim(),
            dept: String(r[2] || '').trim(), pos: String(r[3] || '').trim(),
            phone: String(r[4] || '').trim(), email: String(r[5] || '').trim(),
            join: sheetNormDate(r[6]), sal: parseFloat(r[7]) || 0,
            st: String(r[8] || 'نشط').trim(),
            iq: sheetNormDate(r[9]), hc: sheetNormDate(r[10]), he: sheetNormDate(r[11]),
            err: '', warn: '',
        };
        if (!o.name || !o.id) {o.err = 'الاسم والرقم الوظيفي مطلوبان';}
        else if (seen.has(o.id)) {o.err = 'رقم مكرر داخل الملف';}
        else if (existing.has(o.id)) {o.err = 'موجود مسبقًا — سيُتخطى';}
        else if (o.join === 'INVALID' || o.iq === 'INVALID' || o.hc === 'INVALID' || o.he === 'INVALID') {o.err = 'صيغة تاريخ غير صحيحة (YYYY-MM-DD)';}
        else if (o.sal < 0) {o.err = 'الراتب غير صحيح';}
        seen.add(o.id);
        if (!o.err && o.dept) {
            const byName = deptByName.get(normArSheet(o.dept));
            const code = byName || (deptCodes.has(o.dept) ? o.dept : '');
            o.deptCode = code || '';
            if (!code) {o.warn = 'قسم غير معروف — سيُترك فارغًا';}
        } else {
            o.deptCode = '';
        }
        // Legacy maps only «غير» → inactive; V2 first tries the exact label
        // map the screen builds from status.js, then falls back to legacy.
        o.status = labelMap.get(o.st) || (o.st.includes('غير') ? 'inactive' : 'active');
        rows.push(o);
    }
    const ok = rows.filter((x) => !x.err).length;
    const dup = rows.filter((x) => x.err && x.err.includes('موجود')).length;
    const bad = rows.filter((x) => x.err && !x.err.includes('موجود')).length;
    return { rows, counts: { total: rows.length, ok, dup, bad } };
}

/** Preflight row → create payload (legacy features/employees.js:545-549
 *  fields, minus the null-filled columns the server defaults alike). */
export function sheetRowToPayload(row = {}, todayIsoStr = '') {
    const p = {
        name: row.name, employeeId: row.id,
        position: row.pos, phone: row.phone, email: row.email,
        joinDate: row.join || todayIsoStr,
        salary: row.sal, status: row.status,
    };
    if (row.deptCode) {p.department = row.deptCode;}
    if (row.iq) {p.iqamaExpiry = row.iq;}
    if (row.hc) {p.healthCertExpiry = row.hc;}
    if (row.he) {p.healthEduExpiry = row.he;}
    return p;
}

/**
 * Visible rows → export matrix over EMP_SHEET_COLS. Department exports the
 * joined NAME (legacy features/employees.js:456), falling back to the raw
 * code so a row is never silently blanked; salary is only included when the
 * rows actually carry it (non-elevated roles get it masked server-side).
 * statusLabelOf is REQUIRED, not optional: the repository must never carry a
 * second copy of a status label — the screen passes status.js's resolveStatus
 * (the same authority the roster chips use).
 * @param {any[]} rows roster rows (the screen's own shape)
 * @param {Map<string,any>} rawById id → raw API row (masked as the server chose)
 * @param {Map<string,any>} deptByCode
 * @param {{statusLabelOf:(v:string)=>string}} opts
 */
export function exportSheetRows(rows = [], rawById = new Map(), deptByCode = new Map(), opts = {}) {
    if (typeof opts.statusLabelOf !== 'function') {
        throw new Error('exportSheetRows: statusLabelOf مطلوبة — مرِّر resolveStatus من status.js');
    }
    const withSalary = rows.some((r) => {
        const raw = rawById.get(String(r.id));
        return raw && Object.prototype.hasOwnProperty.call(raw, 'salary') && raw.salary !== null && raw.salary !== undefined;
    });
    const header = withSalary ? [...EMP_SHEET_COLS] : EMP_SHEET_COLS.filter((c) => c !== 'الراتب');
    const matrix = [header];
    for (const r of rows) {
        const raw = rawById.get(String(r.id)) || {};
        const dept = deptByCode.get(String(raw.department || ''));
        const statusLabel = opts.statusLabelOf(r.status);
        const line = [
            r.code === '—' ? '' : r.code, r.nameResolved ? r.name : '',
            dept && dept.name ? String(dept.name) : String(raw.department || ''),
            r.position === '—' ? '' : r.position,
            r.phone === '—' ? '' : r.phone,
            raw.email ? String(raw.email) : '',
            raw.joinDate ? String(raw.joinDate) : '',
        ];
        if (withSalary) {line.push(Number(raw.salary) || 0);}
        line.push(statusLabel);
        line.push(raw.iqamaExpiry ? String(raw.iqamaExpiry) : '');
        line.push(raw.healthCertExpiry ? String(raw.healthCertExpiry) : '');
        line.push(raw.healthEduExpiry ? String(raw.healthEduExpiry) : '');
        matrix.push(line);
    }
    return matrix;
}

