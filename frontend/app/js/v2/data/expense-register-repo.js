/**
 * V2 — Expense register repository · باب البيانات الوحيد لسجلّ الصرف
 * ═══════════════════════════════════════════════════════════════════════
 *   GET /api/expense-register              rows + totals + series + depts + types
 *   GET /api/expense-register/voucher/:id  إذن الصرف باعتماداته وتواقيعه
 *   GET /api/expense-register/html         كشف السجل مطبوع (نفس المرشّحات)
 *   GET /api/expense-register/voucher/:id/html   ورقة إذن الصرف A4
 *
 * الورقتان HTML تُجلبان بـ fetch خام برؤوس المصادقة: قفزة المتصفح لا تحمل
 * x-api-key فتعود 401. الشاشة لا تعرف هذا — تستدعي الدالتين وتكتب النص في
 * عارض V2.
 */

import { apiFetch, API_BASE } from '../../core/api.js?v=4.9.130';

/** قيم expenses.adjustmentType كما تُخزَّن، والواصف العربي لها. */
const TYPE_LABEL = {
    dispatch: 'صرف مخزون', count_correction: 'تصحيح جرد', transfer: 'تحويل',
    receipt: 'وارد مخزون', stock_transfer: 'تحويل مخزون', inventory_transfer: 'تحويل مخزون',
    kitchen_return: 'مرتجع مطبخ', count_correction_receipt: 'إذن جرد', manual: 'يدوي',
};

/** قيمة نوعٍ مجهولة تُعرض كما هي — لا تُسمَّى باسم نوعٍ آخر. */
export function typeLabel(value) {
    return TYPE_LABEL[String(value ?? '')] || String(value || 'يدوي');
}

const num = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
};

/** مبلغٌ بتنسيقٍ ثابت (خانتان) — الوحدة تصل من الخادم، لا من نصٍّ في الواجهة. */
export function money(value, currency) {
    return `${num(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${String(currency || '').trim()}`.trim();
}

/** عددٌ صحيح بتنسيق المجموعة نفسه المستخدم في بقية شاشات V2. */
export function count(v) {
    return num(v).toLocaleString('en-US');
}

function authHeaders() {
    const headers = {};
    if (typeof window !== 'undefined' && window._jwt) {headers.Authorization = `Bearer ${window._jwt}`;}
    if (typeof window !== 'undefined' && window._appKey) {headers['x-api-key'] = window._appKey;}
    return headers;
}

/**
 * ورقة HTML جاهزة للعرض في العارض.
 * @param {string} path مسارٌ نسبي داخل /api/expense-register
 * @param {string} failText رسالة الفشل العامة حين لا يرد الخادم رسالة
 * @returns {Promise<string>}
 */
async function fetchDocHtml(path, failText) {
    const res = await fetch(`${API_BASE}/expense-register${path}`, { headers: authHeaders() });
    if (!res.ok) {
        let msg = `${failText} (${res.status})`;
        try {
            const e = await res.clone().json();
            if (e && (e.message || e.error)) {msg = e.message || e.error;}
        } catch (_) { /* الردّ HTML — يبقى النص العام */ }
        throw new Error(msg);
    }
    return res.text();
}

/** ورقة إذن الصرف A4 — تُعرض في عارض V2 وشريطُه هو مَن يطبع. */
export function fetchVoucherHtml(id) {
    return fetchDocHtml(`/voucher/${encodeURIComponent(String(id))}/html`, 'تعذر توليد الإذن');
}

/** كشف سجلّ الصرف المطبوع بنفس مرشّحات الشاشة الحالية. */
export function fetchRegisterHtml(filters = {}) {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(filters)) { if (v) {q.set(k, String(v));} }
    q.set('limit', '400');
    return fetchDocHtml(`/html?${q.toString()}`, 'تعذر توليد الكشف');
}

/**
 * سجلّ الصرف — صفحة واحدة منه في كل مرة، والمجاميع من الخادم.
 * @param {{from?:string,to?:string,type?:string,dept?:string,q?:string,
 *          limit?:number,offset?:number,sort?:string,dir?:string}} [filters]
 */
export async function fetchExpenseRegister(filters = {}) {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(filters)) {
        if (v !== '' && v !== null && v !== undefined) {q.set(k, String(v));}
    }
    const data = await apiFetch(`/expense-register?${q.toString()}`);
    return {
        rows: Array.isArray(data.rows) ? data.rows : [],
        totals: data.totals || {},
        series: Array.isArray(data.series) ? data.series : [],
        depts: Array.isArray(data.depts) ? data.depts : [],
        top: Array.isArray(data.top) ? data.top : [],
        types: Array.isArray(data.types) ? data.types : [],
        currency: String(data.currency || '').trim(),
        from: data.from || '', to: data.to || '',
    };
}

/** إذن الصرف كاملًا: dispatch · items · events · issued · received · totals. */
export async function fetchVoucher(id) {
    return apiFetch(`/expense-register/voucher/${encodeURIComponent(String(id))}`);
}

/* ── محوّل الصف إلى ما تعرضه الشاشة ─────────────────────────────────────── */

/**
 * البيان المولَّد آليًا يبدأ بوصف الحركة ثم « - » ثم الصنف:
 *   «صرف مخزون - فلفل حار ماليزي (1 كيلو)»
 * يُفصل الوصف عن الصنف للعرض فقط؛ ولو اختلف النصّ عن القالب عُرض كاملًا
 * كما هو — لا اقتطاعٌ يخترع بيانات.
 */
export function splitDesc(desc, label) {
    const text = String(desc || '');
    if (!text) {return { lead: '', rest: '' };}
    const lead = String(label || '');
    if (lead && text.startsWith(`${lead} - `)) {
        return { lead, rest: text.slice(lead.length + 3) };
    }
    return { lead: '', rest: text };
}

/** رقم الإذن يُعرض مختصرًا مع بقاء كامله في الـ title للنسخ. */
export function voucherRef(id) {
    const s = String(id ?? '');
    if (!s) {return { full: '', short: '' };}
    return { full: s, short: s.length > 8 ? `…${s.slice(-6)}` : s };
}

const isoDay = (offset = 0) => {
    const d = new Date();
    d.setDate(d.getDate() + offset);
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

/**
 * اختصارات الفترة — كلٌّ منها يعطي من/إلى إلى الخادم، واليوم الحالي يشمل
 * ما سبقه في نفس اليوم (لا midnight-فجوة).
 * @returns {Array<{key:string, label:string, from:string, to:string}>}
 */
export function periodPresets() {
    return [
        { key: 'today', label: 'اليوم', from: isoDay(0), to: isoDay(0) },
        { key: 'week', label: '٧ أيام', from: isoDay(-6), to: isoDay(0) },
        { key: 'month', label: 'هذا الشهر', from: `${isoDay(0).slice(0, 7)}-01`, to: isoDay(0) },
        { key: 'all', label: 'كل الفترة', from: '', to: '' },
    ];
}

export { isoDay };
