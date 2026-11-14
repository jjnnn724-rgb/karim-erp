/**
 * V2 — التحويلات الداخلية بين الأقسام (الباب الوحيد إلى /api/warehouse/dept-transfers)
 * ═══════════════════════════════════════════════════════════════════════
 *
 * CONTRACT COPIED FROM THE SERVER (backend/dept-transfer-routes.js), NOT INVENTED:
 *   GET    /api/warehouse/dept-transfers?limit=      → [ { ...transfer, items: [...] } ]
 *            كل صف يحمّل metadata.sourceDeptCode/destDeptCode — أسماء الأقسام
 *            يحلها العميل من /departments (الخادم يعيد الأكواد).
 *   GET    /api/warehouse/dept-transfers/stock?dept=&scope=month → { location, items }
 *   GET    /api/warehouse/dept-transfers/summary?from=&to= → لوحة التحويلات
 *            { from, to, totals, bySource, byDest, topItems, daily, recent }
 *   POST   /api/warehouse/dept-transfers             { sourceDeptCode?, destDeptCode, items:[{inventory_id, qty}], notes? }
 *   POST   /api/warehouse/dept-transfers/external    { sourceDeptCode?, destDeptCode?, items, notes? } — تنفيذ فوري بلا اعتماد
 *   POST   /api/warehouse/dept-transfers/:id/approve  → اعتماد الشيف = تنفيذ فوري
 *   POST   /api/warehouse/dept-transfers/:id/reject   { reason }
 *   POST   /api/warehouse/dept-transfers/:id/cancel   — قبل الاعتماد فقط (مالك الطلب أو الإدارة)
 *
 * حالات السجل: requested (بانتظار الشيف) → received (منفَّذ) | rejected | cancelled.
 * قيد الحالة في الجدول لا يحوي 'completed' — الخادم يستخدم 'received' للإتمام.
 */

import { apiFetch } from '../../core/api.js?v=4.9.330';

/** مرآة أدوار الخادم (dept-transfer-routes.js) — لا تُخترع هنا. */
export const WRITE_ROLES = ['admin', 'manager', 'warehouse', 'kitchen', 'sous_chef', 'dept_head'];
export const APPROVE_ROLES = ['admin', 'manager', 'kitchen', 'sous_chef'];

export const EXTERNAL_SALE_DEPT = 'external_sales';

/** منافذ البيع الخارجية الثلاثة — مرآة EXTERNAL_DESTS في الخادم بالترتيب نفسه.
 *  الاسم هنا احتياطي فقط؛ الاسم الحقيقي يُحل من /departments عند التحميل. */
export const EXTERNAL_DESTINATIONS = [
    { code: 'external_sales', name: 'البيع الخارجي' },
    { code: 'CAF', name: 'كافيهshop' },
    { code: 'NAS', name: 'كافيه ناصر' },
];

export function isExternalDestination(code) {
    const want = String(code || '').trim().toLowerCase();
    return EXTERNAL_DESTINATIONS.some((d) => d.code.toLowerCase() === want);
}

/** الأدوار الحرة في اختيار القسم المرسل (resolveSourceDept في الخادم):
 *  الأدمن والمدير والمخزن. غيرهم مُجبر على قسمه. */
export function canChooseSourceDept(role) {
    return ['admin', 'manager', 'warehouse'].includes(String(role || '').toLowerCase());
}

export async function fetchDeptTransfers(limit = 200) {
    return apiFetch(`/warehouse/dept-transfers?limit=${limit}`);
}

export async function fetchDeptStock(deptCode, scope = '') {
    const extra = scope ? `&scope=${encodeURIComponent(scope)}` : '';
    return apiFetch(`/warehouse/dept-transfers/stock?dept=${encodeURIComponent(deptCode)}${extra}`);
}

/** لوحة التحويلات: إجماليات وتوزيعات الفترة (تاريخ بتوقيت الرياض).
 *  mode: '' = كل التحويلات · 'external' = البيع الخارجي فقط · 'internal' = الداخلية فقط. */
export async function fetchTransferSummary(from, to, mode = '') {
    const qs = new URLSearchParams();
    if (from) {qs.set('from', from);}
    if (to) {qs.set('to', to);}
    if (mode) {qs.set('mode', mode);}
    const tail = qs.toString() ? `?${qs.toString()}` : '';
    return apiFetch(`/warehouse/dept-transfers/summary${tail}`);
}

export async function createDeptTransfer(body) {
    return apiFetch('/warehouse/dept-transfers', { method: 'POST', body: JSON.stringify(body) });
}

export async function createExternalSaleTransfer(body) {
    return apiFetch('/warehouse/dept-transfers/external', { method: 'POST', body: JSON.stringify(body) });
}

export async function approveTransfer(id) {
    return apiFetch(`/warehouse/dept-transfers/${encodeURIComponent(id)}/approve`, { method: 'POST', body: '{}' });
}

export async function rejectTransfer(id, reason) {
    return apiFetch(`/warehouse/dept-transfers/${encodeURIComponent(id)}/reject`, { method: 'POST', body: JSON.stringify({ reason }) });
}

export async function cancelTransfer(id) {
    return apiFetch(`/warehouse/dept-transfers/${encodeURIComponent(id)}/cancel`, { method: 'POST', body: '{}' });
}

/* ── المصنع (قرار المالك 2026-11-03) ───────────────────────────────────
 * قسم مُصنِّع (is_factory) يسلّم إنتاجه لمنافذ البيع الخارجية، والتسوية
 * بسعر القائمة الحالي (pos_products.price) — إيراد للمصنع يُحمَّل على المنفذ.
 * مرايا الخادم في dept-transfer-routes.js — لا تُخترع هنا. */

/** روابط أصناف المصنع بمنتجات القائمة (إدارة فقط) — مصدر التسعير التلقائي.
 *  يعيد { dept, factory, items:[{inventory_id,item_name,unit,menu_product_id,menu_name,price}],
 *          menu_products:[{id,name_ar,price}] } */
export async function factoryLinks(dept) {
    return apiFetch(`/warehouse/dept-transfers/factory-links?dept=${encodeURIComponent(dept)}`);
}

/** حفظ ربط صنف مخزن بمنتج قائمة — product_id = null يفك الربط. */
export async function saveFactoryLink(inventoryId, productId) {
    return apiFetch('/warehouse/dept-transfers/factory-links', {
        method: 'PUT',
        body: JSON.stringify({ inventory_id: inventoryId, product_id: productId }),
    });
}

/** تقرير فرق المصنع الشهري: قيمة التحويل بسعر القائمة مقابل مبيعات المنفذ
 *  الفعلية لنفس المنتجات (بكود Yara وبكاشيرات المنفذ نفسه فقط). */
export async function fetchFactoryVariance(month) {
    return apiFetch(`/warehouse/dept-transfers/factory-variance?month=${encodeURIComponent(month)}`);
}

/** قفل فرق الشهر لمصنع: فرق كل منفذ يُقيَّد إيرادًا للمصنع وتحميلًا على
 *  المنفذ مع قيد محاسبي — idempotent لكل (مصنع، منفذ، شهر). */
export async function closeFactoryVariance(month, deptCode) {
    return apiFetch(`/warehouse/dept-transfers/factory-variance/${encodeURIComponent(month)}/close`, {
        method: 'POST',
        body: JSON.stringify({ deptCode }),
    });
}

/** أقسام النظام — المشي نفسه على السجل العام (نمط dispatch-repo fetchDepartmentOptions). */
export async function fetchDeptOptions() {
    const rows = [];
    for (let page = 1; page <= 3; page += 1) {
        const res = await apiFetch(`/departments?page=${page}&limit=1000&sort=id&order=asc`);
        const batch = res && Array.isArray(res.data) ? res.data : (Array.isArray(res) ? res : []);
        rows.push(...batch);
        const totalPages = Number(res && res.pagination && res.pagination.totalPages) || 0;
        if (!batch.length || (totalPages > 0 && page >= totalPages) || batch.length < 1000) {break;}
    }
    return rows.map((d) => ({ code: String(d.code || ''), name: String(d.name || d.code || '') }));
}

export function deptNameByCode(options, code) {
    const want = String(code || '').trim().toLowerCase();
    if (!want) {return '';}
    const row = (options || []).find((d) => String(d.code).toLowerCase() === want);
    return row ? row.name : '';
}

/** حالة السجل بالعربية — نفس أشكال statusBadge (نغمة/أيقونة) لكن محصورة هنا
 *  كي لا نمس ملف status.js المشترك وقيد اختباراته. */
const STATUS_AR = {
    requested: { label: 'بانتظار اعتماد الشيف', tone: 'warning', icon: 'hourglass' },
    received: { label: 'منفَّذ ومكتمل', tone: 'success', icon: 'package' },
    rejected: { label: 'مرفوض', tone: 'danger', icon: 'circle-x' },
    cancelled: { label: 'ملغى', tone: 'neutral', icon: 'x' },
};

export function transferStatus(value) {
    const raw = String(value || '');
    const hit = STATUS_AR[raw];
    return hit ? { ...hit, known: true, raw } : { label: raw || 'غير محدد', tone: 'neutral', icon: 'circle-help', known: false, raw };
}

export function transferBadge(value) {
    const s = transferStatus(value);
    return `<span class="erp-badge" data-tone="${s.tone}" data-unknown="${s.known ? 'false' : 'true'}" data-raw="${s.raw}">`
        + `<i class="ji" data-i="${s.icon}" aria-hidden="true"></i>`
        + `<span class="erp-badge-label">${s.label}</span></span>`;
}

/** كود قسم المرسل الافتراضي للحساب: أول قسم من dept_code، وإن لم يوجد
 *  (الشيف/السو-شيف بلا قسم) فالمطبخ — نفس منطق الخادم resolveSourceDept. */
export function mySourceDeptCode(user = {}) {
    const own = String(user.dept_code || '').split(',').map((s) => s.trim()).filter(Boolean);
    if (own.length) {return own[0];}
    const role = String(user.role || '').toLowerCase();
    return (role === 'kitchen' || role === 'sous_chef') ? 'kitchen' : '';
}

export function canCreate(role) {
    return WRITE_ROLES.includes(String(role || '').toLowerCase());
}

export function canApprove(role) {
    return APPROVE_ROLES.includes(String(role || '').toLowerCase());
}

/** زر «تحويل لمنافذ البيع الخارجية» — قرار المالك 2026-11-01: متاح لأي قسم
 *  (المطبخ، الجزار، الحلواني، الخباز...) بلا اعتماد، بشرط أن تكون البضاعة
 *  داخلة القسم بأذونات صرف الشهر الحالي (الخادم يفرض ذلك: NOT_FROM_CURRENT_DISPATCH).
 *  الخادم هو الحكم النهائي وهذه مرآته للإظهار. */
export function canExternalSale(user = {}) {
    return canCreate(user.role);
}

/** قيمة التحويل: للمنفَّذ التكلفة الفعلية المسجلة، وللمعلَّق تقدير لقطة الطلب. */
export function transferValue(t = {}) {
    const items = Array.isArray(t.items) ? t.items : [];
    let sum = 0;
    for (const it of items) {
        const qty = Number(it.received_qty ?? it.requested_qty) || 0;
        sum += qty * (Number(it.unit_cost) || 0);
    }
    return sum;
}

/** كمية إجمالية للعرض. */
export function transferQty(t = {}) {
    const items = Array.isArray(t.items) ? t.items : [];
    return items.reduce((s, it) => s + (Number(it.received_qty ?? it.requested_qty) || 0), 0);
}

export function itemsText(t = {}, max = 3) {
    const items = Array.isArray(t.items) ? t.items : [];
    const names = items.map((it) => String(it.item_name || `صنف #${it.inventory_id}`));
    if (!names.length) {return '—';}
    const head = names.slice(0, max).join('، ');
    return names.length > max ? `${head} +${names.length - max}` : head;
}

/** صف سجل جاهز للعرض — أسماء الأقسام تُحل من قائمة الأقسام المحمّلة. */
export function transferToRow(t = {}, deptNames = {}) {
    const meta = t.metadata || {};
    const fromCode = String(meta.sourceDeptCode || '');
    const toCode = String(meta.destDeptCode || '');
    return {
        id: t.id,
        number: t.transfer_number,
        status: t.status,
        fromCode,
        toCode,
        fromName: deptNames[fromCode.toLowerCase()] || fromCode || '—',
        toName: deptNames[toCode.toLowerCase()] || toCode || '—',
        mode: String(meta.mode || ''),
        /* تحويل تحقق حي (metadata.test) — مُخفى من الشاشة بقرار المالك 2026-11-02. */
        test: meta.test === true || String(meta.test) === 'true',
        /* تحويل مصنع (metadata.factory): القيمة في الجدول تبقى التكلفة الفعلية،
           وتسوية سعر القائمة تُعرض بجانبها — إيراد المصنع المسجَّل. */
        factory: meta.factory === true || String(meta.factory) === 'true',
        factoryValue: Number(meta.factory_total_value) || 0,
        factoryPricing: Array.isArray(meta.factory_pricing) ? meta.factory_pricing : [],
        itemsText: itemsText(t),
        itemCount: Array.isArray(t.items) ? t.items.length : 0,
        qty: transferQty(t),
        value: transferValue(t),
        requestedBy: t.requested_by_name || '—',
        approvedBy: t.approved_by_name || '',
        createdAt: t.created_at,
        approvedAt: t.approved_at,
        notes: t.notes || '',
        rejectionReason: String((t.metadata && t.metadata.rejection_reason) || ''),
    };
}

export function summarizeTransfers(rows = []) {
    const s = { total: rows.length, pending: 0, done: 0, rejected: 0, cancelled: 0, value: 0 };
    for (const t of rows) {
        if (t.status === 'requested') {s.pending += 1;}
        else if (t.status === 'received') {s.done += 1; s.value += transferValue(t);}
        else if (t.status === 'rejected') {s.rejected += 1;}
        else if (t.status === 'cancelled') {s.cancelled += 1;}
    }
    return s;
}
