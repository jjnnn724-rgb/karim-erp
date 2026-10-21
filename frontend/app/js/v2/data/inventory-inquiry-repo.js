/**
 * V2 — Inventory inquiry repository (الباب الوحيد إلى /api/inventory-inquiry/*)
 * ═══════════════════════════════════════════════════════════════════════════
 * CONTRACT COPIED FROM THE SERVER (backend/inventory-inquiry.js), NOT INVENTED
 *
 * Doors (all GET, read-only — this file never writes and never posts):
 *   items        ?from&to&dept&q&cat&only&sort&dir&limit&offset
 *   item/:id     ?from&to                     — ملف الصنف الكامل
 *   departments  ?from&to                    — تكلفة كل قسم والكوست العام
 *
 * Server rules mirrored here:
 *   - المدى YYYY-MM-DD؛ الصيغة الخاطئة عند الخادم تُسقط على آخر 30 يومًا، لذا
 *     ترفضها هذه البوابة محليًا قبل أي طلب (rangeError مستوردة من yara-reports-repo —
 *     نفس قاعدة السقف 93 يومًا ونفس الرسائل، لا نسخة ثانية منها).
 *   - القراءة للمدير والسو-شيف فقط: READ_ROLES = ['admin','sous_chef'] وصلاحية
 *     'inventory-inquiry.view'. الرفض قرار الخادم (403) لا حجب زر في المتصفح.
 *   - الباركود يُطابق حرفيًا والاسم/التصنيف ILIKE — والبحث الجزئي هنا للمعاينة
 *     فقط، والترتيب النهائي مسؤولية الخادم.
 *
 * WHAT THE NUMBERS MEAN — الخادم يشرح مصدر كل رقم في رأس ملفه؛ أهمها هنا:
 *   qtyInPurchases صافي مُوقَّع يشمل عكوس الإلغاء والتعديل، وqtyOutTotal كل
 *   ما خرج، وqtyNet الفرق الصافي — السلال لا تُجمع إلى qtyNet جمعًا حرفيًا.
 *   soldPos (ربط بالمعرّف، حقيقة) وsoldYara (ربط بالاسم المطبَّع، تقريب) —
 *   لا يُجمعان في رقم واحد أبدًا؛ من يعرضهما يسمّي كل واحد بمصدره.
 */

import { apiFetch } from '../../core/api.js?v=4.9.186';
import { rangeError, spanDays } from './yara-reports-repo.js?v=4.9.186';
import { formatInt, formatQty, formatMoney } from './reports-repo.js?v=4.9.186';

export { rangeError, spanDays };

/** مرآة READ_ROLES في الخادم — للعرض فقط؛ الحاكم هو الخادم. */
export const INQ_READ_ROLES = ['admin', 'sous_chef'];

/** قيم `only` التي يقبلها الخادم (itemFilter في backend/inventory-inquiry.js). */
export const INQ_FILTERS = ['all', 'moved', 'active', 'low', 'expired'];

/** أعمدة الترتيب كما عرّفها الخادم في SORT_COLS. */
export const INQ_SORTS = ['name', 'onHand', 'qtyIn', 'qtyOut', 'sold', 'value', 'cost', 'movements', 'expiry'];

function qs(params) {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
        if (v !== undefined && v !== null && String(v) !== '') {p.set(k, String(v));}
    }
    const s = p.toString();
    return s ? `?${s}` : '';
}

/** GET /items — محرك الاستعلامات: ما دخل، ما في المخزن، ما انصرف، ما بيع، والتكلفة. */
export async function fetchInquiryItems({ from, to, dept = '', q = '', cat = '', only = 'all',
    sort = 'movements', dir = 'desc', limit = 100, offset = 0 } = {}) {
    return apiFetch(`/inventory-inquiry/items${qs({ from, to, dept, q, cat, only, sort, dir, limit, offset })}`);
}

/** GET /item/:id — ملف الصنف: كاردكس برصيد جاري، فواتير، أقسام، دُفعات، مبيعات. */
export async function fetchInquiryItem(itemId, { from, to } = {}) {
    return apiFetch(`/inventory-inquiry/item/${encodeURIComponent(itemId)}${qs({ from, to })}`);
}

/** GET /departments — تكلفة كل قسم والكوست العام (بلا ازدواج مصاريف الصرف). */
export async function fetchInquiryDepartments({ from, to } = {}) {
    return apiFetch(`/inventory-inquiry/departments${qs({ from, to })}`);
}

/* ── Pure transforms — قابلة للاختبار بلا متصفح ── */

const num = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
};

/**
 * بطاقات المحرك — تُقرأ من `totals` نفسها التي يبنيها الخادم من نفس CTE التي
 * يبني منها الصفوف، فلا تتفارق البطاقة عن الجدول أبدًا.
 */
export function engineKpis(totals = {}, currency = '') {
    const money = (v) => formatMoney(v, currency);
    return [
        { key: 'stockValue', icon: 'banknote', label: 'قيمة المخزون', en: 'Stock Value', kind: 'money', ...money(totals.stockValue), raw: num(totals.stockValue) },
        { key: 'qtyInPurchases', icon: 'download', label: 'داخل من الفواتير', en: 'Received', kind: 'qty', value: formatQty(totals.qtyInPurchases), raw: num(totals.qtyInPurchases) },
        { key: 'qtyOutTotal', icon: 'upload', label: 'منصرف', en: 'Issued', kind: 'qty', value: formatQty(totals.qtyOutTotal), raw: num(totals.qtyOutTotal) },
        { key: 'purchaseCost', icon: 'wallet', label: 'تكلفة المشتريات', en: 'Purchase Cost', kind: 'money', ...money(totals.purchaseCost), raw: num(totals.purchaseCost) },
        { key: 'outCost', icon: 'arrow-right', label: 'تكلفة المنصرف', en: 'Issued Cost', kind: 'money', ...money(totals.outCost), raw: num(totals.outCost) },
        { key: 'items', icon: 'layers', label: 'أصناف مُجمَّعة', en: 'Items', kind: 'int', value: formatInt(totals.items), raw: num(totals.items) },
    ];
}

/** حالة الصلاحية من تاريخ الدفتر الأقرب — «انتهت» قرار لا يُترك للمتخيل. */
export function expiryState(nearestExpiry, today = '') {
    if (!nearestExpiry) {return { key: 'none', ar: '—', tone: '' };}
    const d = String(nearestExpiry).slice(0, 10);
    const t = String(today).slice(0, 10) || new Date().toISOString().slice(0, 10);
    if (d < t) {return { key: 'expired', ar: 'منتهية', tone: 'danger' };}
    const days = Math.round((new Date(`${d}T12:00:00Z`) - new Date(`${t}T12:00:00Z`)) / 86400000);
    if (days <= 7) {return { key: 'soon', ar: `خلال ${formatInt(days)} يومًا`, tone: 'warning' };}
    return { key: 'ok', ar: 'سليمة', tone: 'success' };
}

/** أعمدة تصدير المحرك — عناوين صريحة بمصدر كل رقم. */
export const EXPORT_COLUMNS = [
    { header: 'الصنف', get: (r) => r.itemName },
    { header: 'التصنيف', get: (r) => r.category },
    { header: 'الوحدة', get: (r) => r.unit },
    { header: 'الرصيد بالمخزن', get: (r) => r.onHand },
    { header: 'داخل من الفواتير (صافي)', get: (r) => r.qtyInPurchases },
    { header: 'داخل آخر', get: (r) => r.qtyInOther },
    { header: 'المنصرف كله', get: (r) => r.qtyOutTotal },
    { header: 'صرف للأقسام', get: (r) => r.qtyOutDispatch },
    { header: 'مستهلك في البيع', get: (r) => r.qtyOutSale },
    { header: 'صافي الحركة', get: (r) => r.qtyNet },
    { header: 'تكلفة المشتريات', get: (r) => r.purchaseCost },
    { header: 'قيمة المخزون', get: (r) => r.stockValue },
    { header: 'مبيع بالعدد (POS — معرّف)', get: (r) => r.soldPos },
    { header: 'إيراد POS', get: (r) => r.revenuePos },
    { header: 'مبيع بالعدد (مرآة يارا — اسم)', get: (r) => r.soldYara },
    { header: 'أقرب صلاحية', get: (r) => r.nearestExpiry || '' },
];

/** صفوف Excel بنفس ترتيب الأعمدة — بلا أي حساب جديد في المتصفح. */
export function toExportAoa(rows = []) {
    return [EXPORT_COLUMNS.map((c) => c.header),
        ...rows.map((r) => EXPORT_COLUMNS.map((c) => (c.get(r) == null ? '' : c.get(r))))];
}

/** ملخص القسم للبطاقة: تكلفة + تشغيلي + صرف، وكل رقم مسمّى بمصدره. */
export function deptCostSummary(payload = {}) {
    const t = payload.totals || {};
    return {
        departments: num(t.departments),
        costTotal: num(t.costTotal),
        issuedCost: num(t.issuedCost),
        expenseOperating: num(t.expenseOperating),
        expenseStock: num(t.expenseStock),
        stockValue: num(t.stockValue),
        unattributedCost: num((payload.unattributed || {}).issuedCost) + num((payload.unattributed || {}).expenseOperating),
    };
}
