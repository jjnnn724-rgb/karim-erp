/**
 * V2 — مبيعات الكاشير · باب البيانات الوحيد لفواتير الكاشيريات وأصنافها
 * ═══════════════════════════════════════════════════════════════════════
 *   GET /api/cashier-sales/summary            مجاميع + سلسلة + كاشيريات + دفع + ساعات + أصناف صدارة
 *   GET /api/cashier-sales/orders             الفواتير مرقَّمةً (العدد الكامل من الخادم)
 *   GET /api/cashier-sales/items              الأصناف مجمَّعة برمزها
 *   GET /api/cashier-sales/item/:code         ملف الصنف: كميّته وكل فواتيره
 *   GET /api/cashier-sales/invoice/:docNo     الفاتورة على الشاشة: سطورها ودفعها
 *   GET /api/cashier-sales/invoice/:docNo/html   إيصال 80مم مطبوعًا
 *   GET /api/cashier-sales/html?view=…        الكشف A4 مطبوعًا (أوراق | أصناف | صنف)
 *
 * الورقتان HTML تُجلبان بـ fetch خام برؤوس المصادقة: قفزة المتصفح لا تحمل
 * x-api-key فتعود 401. الشاشة لا تعرف هذا — تستدعي الدالتين وتكتب النص في
 * عارض V2 وشريطه هو مَن يطبع.
 *
 * لا حسابٌ هنا: المجاميع والنسب والمتوسطات واسم الكاشير والعملة كلها تصل
 * جاهزة من الخادم. هذا الملف يهيّئ الردّ ويُنظّف النوع (صفيف/رقم/سلسلة) —
 * ولا يجمع ولا يقسّم ولا يُقارن.
 */

import { apiFetch, API_BASE } from '../../core/api.js?v=4.9.151';

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

/** كميةٌ قد تكسر: تُعرض بخانتين فقط عند الحاجة، بلا أصفارٍ زائفة. */
export function qty(value) {
    const n = num(value);
    return n.toLocaleString('en-US', { maximumFractionDigits: 3 });
}

function authHeaders() {
    const headers = {};
    if (typeof window !== 'undefined' && window._jwt) {headers.Authorization = `Bearer ${window._jwt}`;}
    if (typeof window !== 'undefined' && window._appKey) {headers['x-api-key'] = window._appKey;}
    return headers;
}

/**
 * ورقة HTML جاهزة للعرض في العارض.
 * @param {string} path مسارٌ نسبي كامل داخل /api/cashier-sales
 * @param {string} failText رسالة الفشل العامة حين لا يرد الخادم رسالة
 * @returns {Promise<string>}
 */
async function fetchDocHtml(path, failText) {
    const res = await fetch(`${API_BASE}/cashier-sales${path}`, { headers: authHeaders() });
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

/** إيصال الفاتورة 80مم — يُعرض في عارض V2 وشريطُه هو مَن يطبع. */
export function fetchInvoiceHtml(docNo) {
    return fetchDocHtml(`/invoice/${encodeURIComponent(String(docNo))}/html`, 'تعذر توليد الفاتورة');
}

/**
 * الكشف المطبوع A4 بنفس مرشّحات الشاشة الحالية.
 * @param {{view?:'orders'|'items'|'item',code?:string,from?:string,to?:string,
 *          cashier?:string,q?:string,limit?:number}} [filters]
 */
export function fetchSheetHtml(filters = {}) {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(filters)) {
        if (v !== '' && v !== null && v !== undefined) {q.set(k, String(v));}
    }
    if (!q.has('view')) {q.set('view', 'orders');}
    return fetchDocHtml(`/html?${q.toString()}`, 'تعذر توليد الكشف');
}

/** تحويل المرشّحات إلى query string — المرشّح الفارغ لا يُرسل. */
function qs(filters = {}, extra = {}) {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...filters, ...extra })) {
        if (v !== '' && v !== null && v !== undefined) {q.set(k, String(v));}
    }
    return q.toString();
}

const arr = (v) => (Array.isArray(v) ? v : []);

/**
 * ملخّص الفترة: كل ما تُظهره اللوحة من أرقامٍ ومنحنيات في طلبٍ واحد.
 * @param {{from?:string,to?:string,cashier?:string,q?:string}} [filters]
 */
export async function fetchSummary(filters = {}) {
    const data = await apiFetch(`/cashier-sales/summary?${qs(filters)}`);
    return {
        totals: data.totals || {},
        series: arr(data.series),
        peak: data.peak || null,
        quiet: data.quiet || null,
        cashiers: arr(data.cashiers),
        payments: arr(data.payments),
        hours: arr(data.hours),
        topItems: arr(data.top_items),
        mirror: data.mirror || {},
        zatca: data.zatca || null,
        currency: String(data.currency || '').trim(),
        brand: String(data.brand || '').trim(),
        from: data.from || '', to: data.to || '',
    };
}

/**
 * الفواتير — صفحة واحدة في كل مرة، والعدد الكامل في totals.count.
 * @param {{from?:string,to?:string,cashier?:string,q?:string,
 *          limit?:number,offset?:number,sort?:string,dir?:string}} [filters]
 */
export async function fetchOrders(filters = {}) {
    const data = await apiFetch(`/cashier-sales/orders?${qs(filters)}`);
    return {
        rows: arr(data.rows),
        totals: data.totals || {},
        currency: String(data.currency || '').trim(),
        from: data.from || '', to: data.to || '',
        page: data.page || {},
    };
}

/** الأصناف المباعة مجمَّعة برمزها (لا باسمه — الكود الواحد قد يحمل اسمين). */
export async function fetchItems(filters = {}) {
    const data = await apiFetch(`/cashier-sales/items?${qs(filters)}`);
    return {
        rows: arr(data.rows),
        totals: data.totals || {},
        reconcile: data.reconcile || null,
        currency: String(data.currency || '').trim(),
        page: data.page || {},
    };
}

/** ملف الصنف: أجا + أسماء + أسعار + سلسلة + كاشيريات + فواتير مرقَّمة. */
export async function fetchItem(code, filters = {}) {
    const data = await apiFetch(`/cashier-sales/item/${encodeURIComponent(String(code))}?${qs(filters)}`);
    return {
        code: String(data.code || code || ''),
        currency: String(data.currency || '').trim(),
        agg: data.agg || {},
        names: arr(data.names),
        prices: arr(data.prices),
        series: arr(data.series),
        cashiers: arr(data.cashiers),
        invoices: arr(data.invoices),
        totals: data.totals || {},
        page: data.page || {},
        from: data.from || '', to: data.to || '', cashier: data.cashier || '',
    };
}

/** فاتورة واحدة على الشاشة: بياناتها + سطورها + حالة اعتمادها. */
export async function fetchInvoice(docNo) {
    return apiFetch(`/cashier-sales/invoice/${encodeURIComponent(String(docNo))}`);
}

const isoDay = (offset = 0) => {
    const d = new Date();
    d.setDate(d.getDate() + offset);
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

/**
 * اختصارات الفترة — كلٌّ منها يعطي من/إلى إلى الخادم، واليوم الحالي يشمل
 * ما سبقه في نفس اليوم (لا midnight-فجوة). «كل الفترة» يترك المدى فارغًا
 * فيأخذ الخادم كل ما في المرآة.
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
