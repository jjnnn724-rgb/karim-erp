/**
 * V2 — Warehouse registers repository (الباب إلى /api/inventoryTx + /api/kitchenReturns)
 * — سجلان للقراءة + دورة مرتجعات المطبخ الكاملة (W1-5)
 * ═══════════════════════════════════════════════════════════════════════
 *
 * CONTRACT COPIED FROM THE SERVER, NOT INVENTED
 *
 *  A) entity walk — GET /api/{inventoryTx|kitchenReturns}?page=&limit=&sort=id&order=desc
 *     (generic entity API, server.js:1454-1521, app.js:81 apiList shape.
 *     Read is plain jwtAuth for these two — any signed-in user, no role
 *     restriction on read for inventoryTx/kitchenReturns; server.js:1240
 *     sensitiveReadEntities does not list them.)
 *     inventoryTx row columns (schema-registry.js:354 WAILABLE + DB):
 *       id, itemId, itemName, qty, type, date, cost, totalValue, notes,
 *       invoiceNumber, supplierName, weight, dispatchId,
 *       catch_weight_qty, catch_weight_unit.
 *     kitchenReturns row columns (schema-registry.js:459):
 *       id, date, items, status, notes, reason, dispatchId, deptCode,
 *       deptName, totalValue, createdBy.
 *     walk caps at 8 pages newest-first (documented in the UI).
 *
 *  B) purchase-requests registers moved OUT of this file (W1-3): the whole
 *     PR cycle — reads AND the seven write doors — lives in
 *     js/v2/data/pr-repo.js now (screen 21). Screen 19 (wh-moves) is a
 *     pure reader of this file and still never writes.
 *
 *  C) W1-5 (screen 20): the returns cycle —
 *       POST   /warehouse/returns        warehouse-routes.js:1318
 *              (dispatchId غائب ⇒ إرجاع مباشر :1207-1327؛ وإلا مرتبط بإذن)
 *       DELETE /warehouse/returns/:id    warehouse-routes.js:1506
 *              (عكس الأثر المخزني كاملًا؛ والقديم بلا ربط يُرفض 409)
 *     plus the create panel's reads: approved dispatches (legacy pit :1256),
 *     departments (legacy filter :1259) and inventory names (:1263).
 *     The write doors exist for screen 20's cycle only.
 *
 * DISPLAY ALLOWLIST
 *   Inventory types (warehouse.js renderWhMoves typed dispatch codes
 *   backend/warehouse-routes.js:735,...): in | out | return | adjustment;
 *   any other stored value renders as the legacy "افتتاحي" badge — never
 *   relabelled here.
 *   kitchenReturns.status is stored as 'approved' exactly on insert
 *   (warehouse-routes.js:1460); the legacy section renders it via
 *   deleteKitchenReturn gates only.
 *   Receipts' e-signature/signature data, purchase-request shima-
 *   exclusive fields (chefApprovedBy, warehouseReceivedBy…) are status/
 *   approval data we keep as RAW read-only facts.
 */

import { apiFetch } from '../../core/api.js?v=4.9.149';

export function isoDay(offsetDays = 0, base = new Date()) {
    const d = new Date(base);
    d.setDate(d.getDate() + offsetDays);
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function firstOfMonth(now = new Date()) {
    const p = (n) => String(n).padStart(2, '0');
    return `${now.getFullYear()}-${p(now.getMonth() + 1)}-01`;
}

export const WALK_PAGES = 8;

async function walkEntity(entity) {
    const rows = [];
    for (let page = 1; page <= WALK_PAGES; page += 1) {
        const res = await apiFetch(`/${entity}?page=${page}&limit=1000&sort=id&order=desc`);
        const batch = res && Array.isArray(res.data) ? res.data
            : (Array.isArray(res) ? res : []);
        rows.push(...batch);
        const totalPages = Number(res && res.pagination && res.pagination.totalPages) || 0;
        if (!batch.length || (totalPages > 0 && page >= totalPages) || batch.length < 1000) {break;}
    }
    return rows;
}

export const fetchInventoryTx = () => walkEntity('inventoryTx');
export const fetchKitchenReturns = () => walkEntity('kitchenReturns');

const num = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
};

/** inv type label — legacy badges. */
export const INV_TYPE_AR = {
    in: 'وارد', out: 'صادر', return: 'مرتجع', adjustment: 'تسوية',
};
export const INV_TYPE_TONE = {
    in: 'success', out: 'warning', return: 'info', adjustment: 'neutral',
};

export function invTxToRow(t = {}) {
    const type = t.type ? String(t.type) : '';
    return {
        id: t.id,
        date: t.date ? String(t.date).slice(0, 10) : '',
        itemName: t.itemName ? String(t.itemName) : (t.itemId ? `#${t.itemId}` : '—'),
        itemId: t.itemId,
        unit: t.unit || '',
        type,
        typeLabel: INV_TYPE_AR[type] || 'افتتاحي',
        typeKnown: Object.prototype.hasOwnProperty.call(INV_TYPE_AR, type),
        qty: num(t.qty),
        cost: num(t.cost),
        totalValue: num(t.totalValue),
        ref: t.invoiceNumber || t.dispatchId || t.notes || '',
    };
}

export function kitchenReturnToRow(r = {}) {
    const items = Array.isArray(r.items) ? r.items : [];
    const summary = items.map((it) => {
        const name = it && (it.itemName || it.name) ? String(it.itemName || it.name) : '—';
        return `${name} (${num(it.qty)})`;
    }).join('، ');
    return {
        id: r.id,
        deptCode: r.deptCode ? String(r.deptCode) : '',
        deptName: r.deptName ? String(r.deptName) : (r.deptCode ? String(r.deptCode) : '—'),
        dispatchId: r.dispatchId || null,
        itemsSummary: summary || '—',
        itemsCount: items.length,
        reason: r.reason ? String(r.reason) : (r.notes ? String(r.notes) : ''),
        totalValue: num(r.totalValue),
        date: r.date ? String(r.date).slice(0, 10) : '',
        status: r.status ? String(r.status) : '',
    };
}

/* ═══════════════════════════════════════════════════════════════════════
 * W1-5 — دورة المرتجعات: قراءات لوحة الإنشاء وبابا الكتابة (شاشة 20)
 * ═══════════════════════════════════════════════════════════════════════ */

/** من يُنشئ مرتجعًا — مرآة RETURN_ROLES (warehouse-routes.js:16). */
export const RETURN_ROLES = ['admin', 'manager', 'warehouse', 'kitchen', 'sous_chef', 'dept_head'];
/** من يحذف سجل مرتجع بعكس أثره — مرآة requireRole في :1506. */
export const RETURN_DELETE_ROLES = ['admin', 'manager', 'warehouse'];

export function returnCreateVisible(role) {
    return RETURN_ROLES.includes(String(role || ''));
}

export function returnDeleteVisible(role) {
    return RETURN_DELETE_ROLES.includes(String(role || ''));
}

/** إذونات الصرف المعتمدة للاختيار — عين القديم :1256 (status==='approved'). */
export async function fetchReturnDispatches() {
    const rows = await walkEntity('dispatches');
    return rows
        .filter((d) => String((d && d.status) || '') === 'approved')
        .map(returnDispatchOption);
}

/** صف إذن → اختيار اللوحة: الأصناف من approvedItems ثم items (:1314) والكمية
 *  approvedQty ?? qty (:1315) — بلا تخمين. */
export function returnDispatchOption(d = {}) {
    const items = Array.isArray(d.approvedItems) && d.approvedItems.length
        ? d.approvedItems
        : (Array.isArray(d.items) ? d.items : []);
    return {
        id: d.id,
        deptName: d.deptName ? String(d.deptName) : (d.deptCode ? String(d.deptCode) : '—'),
        date: d.date ? String(d.date).slice(0, 10) : '',
        items: items.map((it) => ({
            name: String((it && (it.itemName || it.name)) || ''),
            unit: String((it && it.unit) || ''),
            qty: num(it && (it.approvedQty ?? it.qty)),
        })).filter((it) => it.name),
    };
}

/** كل الأقسام — فلتر الإرجاع المباشر النقي يُطبَّق في directReturnDepartments. */
export async function fetchReturnDepartments() {
    return walkEntity('departments');
}

/** أقسام الإرجاع المباشر — فلتر القديم :1259 حرفًا (يسقط مرايا ys_ والمطبخ
 *  والبيع الخارجي وأبناء المطبخ) مع اسم السقوط name_ar ثم الكود. */
export function directReturnDepartments(rows = []) {
    return (Array.isArray(rows) ? rows : []).filter((d) => d
        && !String(d.code || '').startsWith('ys_') && d.code !== 'kitchen'
        && d.code !== 'external_sales' && d.parent_code !== 'kitchen')
        .map((d) => ({
            code: String(d.code || ''),
            name: String(d.name || d.name_ar || d.code || ''),
        }));
}

/** اسم قسم من صفوف جدول الأقسام — بالكود الصغير والباقي يُعرض خامًا. */
export function deptLabelOf(rows, code) {
    const want = String(code || '').trim().toLowerCase();
    const hit = (Array.isArray(rows) ? rows : []).find((d) => d
        && String(d.code || '').toLowerCase() === want);
    return hit ? String(hit.name || hit.name_ar || hit.code || '') : String(code || '');
}

/** أسماء المخزون للإرجاع المباشر — قايمة القديم :1263 (بلا بوابة رصيد:
 *  الإرجاع يزيد الرصيد والخادم يطابق الاسم :1237-1241). */
export async function fetchReturnInventory() {
    const rows = await walkEntity('inventory');
    return rows.map(returnInventoryOption).filter((r) => r.name);
}

export function returnInventoryOption(raw = {}) {
    return {
        id: raw.id,
        name: String(raw.name || ''),
        unit: String(raw.unit || ''),
        qty: num(raw.qty),
    };
}

/** أكواد أقسام صاحب الحساب — dept_code يقبل قائمة بفواصل (server.js:1276،
 *  نفس ديبات dispatch-repo.deptCodesOf). */
export function returnDeptCodesOf(deptCode) {
    return String(deptCode || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
}

/** حمولة الإنشاء — الشكلان كما يرسلهما القديم :1360/:1385، والصفوف الفارغة
 *  تسقط كما يسقطها جمعه :1356 (اسم وكمية موجبة فقط). */
export function returnCreatePayload({ deptCode = '', dispatchId = null, reason = '', notes = '', items = [] } = {}) {
    const body = {
        reason: String(reason || ''),
        notes: String(notes || '').trim(),
        items: (Array.isArray(items) ? items : []).map((r) => ({
            name: String((r && r.name) || '').trim(),
            qty: Number(r && r.qty),
        })).filter((r) => r.name && Number.isFinite(r.qty) && r.qty > 0),
    };
    if (dispatchId !== null && dispatchId !== undefined && String(dispatchId).trim() !== '') {
        body.dispatchId = dispatchId;
    } else {
        body.deptCode = String(deptCode || '').trim();
    }
    return body;
}

/** إرجاع جديد — POST /warehouse/returns (:1318، والمباشر :1326-1327): المخزون
 *  يُحرَّك والمصروف يُعكس عند الخادم، والرد يحمل totalValue. */
export async function createKitchenReturn(body) {
    return apiFetch('/warehouse/returns', { method: 'POST', body: JSON.stringify(body) });
}

/** حذف سجل مرتجع مع عكس أثره المخزني — DELETE /warehouse/returns/:id (:1506). */
export async function deleteKitchenReturn(id) {
    return apiFetch(`/warehouse/returns/${encodeURIComponent(id)}`, { method: 'DELETE' });
}
