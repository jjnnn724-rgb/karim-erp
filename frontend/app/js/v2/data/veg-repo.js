/**
 * V2 — Vegetable requests repository (الباب الوحيد إلى /api/veg-requests)
 * ═══════════════════════════════════════════════════════════════════════
 *
 * CONTRACT COPIED FROM THE SERVER, NOT INVENTED
 *   GET /veg-requests?status&mine&limit → { ok, requests[], summary }
 *     (veg-requests-routes.js:154-190 · read gate sous_chef|admin|owner +
 *     warehouse, same file :25-26. Server-side status filter
 *     pending|received|cancelled; limit default 60, cap 200.)
 *     summary: { pending, pending_today, today } — counted in SQL (:182).
 *   Row columns (SELECT list :173-176): id, request_no, created_by,
 *     created_by_name, created_by_role, department, priority, status,
 *     items, items_count, notes, received_by, received_by_name,
 *     received_by_dept, received_at, total, priced_by_name, priced_at,
 *     expense_id, print_count, created_at.
 *   Stored statuses: pending | received | priced | cancelled (CHECK :57);
 *     every one now has an entry in v2/status.js veg_request:* (the read
 *     wave verified pending only; W1-4 registered the other three from
 *     the legacy badge words features/veg-requests.js:28-32).
 *
 * W1-4 (2026-10-15) — THE FULL VEG CYCLE'S DOORS LIVE HERE NOW
 *   Reads added:
 *     GET /veg-requests/catalog            (:102, READ_ROLES)
 *       → { ok, categories: VEG_CATALOG, units: UNITS } — the catalogue
 *       is the server's (veg-requests-logic.js:10-58); the screen never
 *       invents items.
 *   Writes added, one per server route, exact paths and bodies:
 *     POST   /veg-requests                     (:110) body {items, priority, notes}
 *     POST   /veg-requests/:id/receive         (:199) body {rejections, quantities[, prices]}
 *     POST   /veg-requests/:id/price           (:320) body {prices}
 *     PUT    /veg-requests/:id/items           (:391) body {items}
 *     POST   /veg-requests/:id/cancel          (:444) body {reason}
 *     POST   /veg-requests/:id/printed         (:476) — عدّاد الطباعة
 *
 *   Server role truth (spaced lines copied verbatim):
 *     CREATE_ROLES :25  = sous_chef|admin|owner
 *     READ_ROLES   :26  = above + warehouse
 *     RECEIVE_ROLES:27  = sous_chef|admin|owner (403 «الاستلام والتوقيع
 *       للسو شيف فقط» :196)
 *     price :320        = warehouse|admin|owner|manager
 *     EDIT_ROLES :390   = sous_chef|admin|owner ثم فحص داخلي (:403-408):
 *       isBoss = admin|owner|manager أو isDeptHead أو isCreator
 *
 * ANNOUNCED DEVIATION — edition button (like deleteVisible in pr-repo)
 *   Legacy features/veg-requests.js:508-513 shows «تعديل الكميات» to seven
 *   roles (warehouse, admin, owner, manager, kitchen, sous_chef, dept_head)
 *   or the creator while status is pending. The server middleware
 *   requireRole(sous_chef|admin|owner) :391 then the inner check :406 mean
 *   what it will actually accept is: admin|owner (any) or the CREATOR —
 *   everything else fails 403. V2 shows the button only for those two
 *   buckets instead of offering a button the server must reject.
 *
 * ANNOUNCED HARDENING — path segment encoding
 *   Legacy encodes the id for the items PUT alone (:535) and sends the raw
 *   id elsewhere. V2 encodes every id path segment (same rule as the
 *   dispatch and PR repos) — the only build from input is encodeURIComponent.
 *
 * PRINT READ — fetchVegRequestById re-reads the list (limit 200) and finds
 *   the row, exactly as the legacy print did (features/veg-requests.js:573).
 *   The print counter POST is fire-and-forget like the legacy (:576) —
 *   await-ed nowhere, its failure never blocks the paper.
 *
 * DISPLAY RULE (no invented persisted values)
 *   The stored row is passed through raw; statuses render from the shared
 *   register, never relabelled here.
 *
 * PAIRS WITH: screens/veg-requests.js (screen 14 in js/v2/MIGRATION.md).
 */

import { apiFetch } from '../../core/api.js?v=4.9.197';

const num = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
};

/* ── ثوابت الأدوار — مرايا سطور الخادم :25-27 و:320 و:390 حرفيًا ────────── */

export const VEG_CREATE_ROLES = ['sous_chef', 'admin', 'owner'];
export const VEG_READ_ROLES = [...VEG_CREATE_ROLES, 'warehouse'];
export const VEG_RECEIVE_ROLES = ['sous_chef', 'admin', 'owner'];
export const VEG_PRICE_ROLES = ['warehouse', 'admin', 'owner', 'manager'];
export const VEG_EDIT_ROLES = ['sous_chef', 'admin', 'owner'];

/** بوابات القديم حرفيًا — vegCanCreate/vegCanPrice/vegIsBoss/vegCanReceive
 *  (features/veg-requests.js:18-26). */
export const VEG_UI_CREATE_ROLES = ['sous_chef', 'admin', 'owner'];
export const VEG_UI_PRICE_ROLES = ['warehouse', 'admin', 'owner'];
export const VEG_UI_BOSS_ROLES = ['admin', 'owner'];

/** The server's own status enum (`:160`) — nothing else is sent. */
export const VEG_STATUS_FILTERS = ['all', 'pending', 'received', 'cancelled'];

/* ── أبواب القراءة ────────────────────────────────────────────────────── */

/**
 * @param {{status?:string, limit?:number}} opts
 * @returns {Promise<{rows:any[], summary:object}>}
 */
export async function fetchVegRequests({ status = 'all', limit = 60 } = {}) {
    const params = new URLSearchParams();
    if (VEG_STATUS_FILTERS.includes(status) && status !== 'all') {params.set('status', status);}
    params.set('limit', String(Math.min(200, Math.max(1, Number(limit) || 60))));
    const res = await apiFetch(`/veg-requests?${params.toString()}`);
    if (!res || typeof res !== 'object') {return { rows: [], summary: {}};}
    return {
        rows: Array.isArray(res.requests) ? res.requests : [],
        summary: res.summary && typeof res.summary === 'object' ? res.summary : {},
    };
}

/** قايمة الخضار المصنّفة + الوحدات — كما ينطق الخادم (:102-106). */
export async function fetchVegCatalog() {
    const res = await apiFetch('/veg-requests/catalog');
    return {
        categories: res && Array.isArray(res.categories) ? res.categories : [],
        units: res && Array.isArray(res.units) && res.units.length ? res.units : ['كجم'],
    };
}

/** صف واحد طازج لورقة الطباعة — مشي القديم :573 نفسه (قايمة 200 ثم إيجاد). */
export async function fetchVegRequestById(id) {
    const res = await apiFetch('/veg-requests?limit=200');
    const rows = res && Array.isArray(res.requests) ? res.requests : [];
    return rows.find((r) => Number(r.id) === Number(id)) || null;
}

/* ── أبواب الكتابة — المسارات كما هي عند الخادم، والرسائل تصعد كما ترد ── */

/** إنشاء طلب — POST /veg-requests (:110). */
export async function createVegRequest(body) {
    return apiFetch('/veg-requests', { method: 'POST', body: JSON.stringify(body) });
}

/** استلام (ورفض صنف/صنف + كميات سليمة + أسعار اختيارية) — POST /:id/receive (:199). */
export async function receiveVegRequest(id, body) {
    return apiFetch(`/veg-requests/${encodeURIComponent(id)}/receive`, { method: 'POST', body: JSON.stringify(body) });
}

/** تسعير المخزن — POST /:id/price (:320). */
export async function priceVegRequest(id, prices) {
    return apiFetch(`/veg-requests/${encodeURIComponent(id)}/price`, { method: 'POST', body: JSON.stringify({ prices }) });
}

/** تعديل الكميات قبل الاعتماد — PUT /:id/items (:391). */
export async function editVegItems(id, items) {
    return apiFetch(`/veg-requests/${encodeURIComponent(id)}/items`, { method: 'PUT', body: JSON.stringify({ items }) });
}

/** إلغاء — POST /:id/cancel (:444). */
export async function cancelVegRequest(id, reason) {
    return apiFetch(`/veg-requests/${encodeURIComponent(id)}/cancel`, { method: 'POST', body: JSON.stringify({ reason }) });
}

/** عدّاد الطباعة — POST /:id/printed (:476). القديم يطلقه ولا ينتظره :576. */
export async function markVegPrinted(id) {
    return apiFetch(`/veg-requests/${encodeURIComponent(id)}/printed`, { method: 'POST' });
}

/* ── المحوّلات النقية ─────────────────────────────────────────────────── */

/**
 * Database row → table row. Pure and exported so it is testable
 * without a browser.
 */
export function vegRequestToRow(r = {}) {
    const status = r.status !== undefined && r.status !== null ? String(r.status) : '';
    return {
        id: r.id,
        number: r.request_no ? String(r.request_no) : `#${r.id ?? '؟'}`,
        numberResolved: !!r.request_no,
        itemsCount: Math.round(num(r.items_count)),
        priority: r.priority ? String(r.priority) : '',
        urgent: String(r.priority || '').toLowerCase() === 'urgent',
        status,
        total: num(r.total),
        by: r.created_by_name ? String(r.created_by_name) : (r.created_by ? `#${r.created_by}` : '—'),
        created: r.created_at ? String(r.created_at).slice(0, 10) : '',
        receivedBy: r.received_by_name ? String(r.received_by_name) : '',
        notes: r.notes ? String(r.notes) : '',
    };
}

/** أصناف الصف الخام — JSONB قد يصل نصًّا (كما يفعل الخادم :213). */
export function vegItemsOf(raw = {}) {
    if (Array.isArray(raw.items)) {return raw.items;}
    try {
        const parsed = JSON.parse(raw.items || '[]');
        return Array.isArray(parsed) ? parsed : [];
    } catch (_) {
        return [];
    }
}

/**
 * أصناف الإنشاء — مشي القديم vegCollectItems :224-248 حرفيًا:
 *   • كتالوج: كمية موجبة فقط → {name, qty, unit} (بلا note)
 *   • يدوي: اسم غير فارغ وكمية موجبة → {name, qty, unit أو 'وحدة', note أو null}
 */
export function collectVegItems(catalogPicks = [], customRows = []) {
    const items = [];
    for (const row of Array.isArray(catalogPicks) ? catalogPicks : []) {
        const qty = Number(row && row.qty);
        if (Number.isFinite(qty) && qty > 0) {
            items.push({ name: String(row.name || ''), qty, unit: String(row.unit || 'وحدة') });
        }
    }
    for (const row of Array.isArray(customRows) ? customRows : []) {
        const name = String((row && row.name) || '').trim();
        const qty = Number(row && row.qty);
        if (name && Number.isFinite(qty) && qty > 0) {
            items.push({
                name,
                qty,
                unit: String((row && row.unit) || '').trim() || 'وحدة',
                note: String((row && row.note) || '').trim() || null,
            });
        }
    }
    return items;
}

/** حمولة الإنشاء — حقول القديم :260-262 (وpriority بالتطبيع نفسه). */
export function vegCreatePayload({ items = [], notes = '', priority = 'normal' } = {}) {
    return {
        items,
        notes: String(notes || '').trim(),
        priority: priority === 'urgent' ? 'urgent' : 'normal',
    };
}

/** حمولة الاستلام — القديم :424-426: الأسعار تُضاف فقط عند الاعتماد المباشر. */
export function vegReceivePayload({ rejections = [], quantities = [], prices = null, direct = false } = {}) {
    const body = { rejections, quantities };
    if (direct && Array.isArray(prices) && prices.length) {body.prices = prices;}
    return body;
}

/** حمولة التعديل — القديم :530-535: name/qty/unit لكل صنف قائم. */
export function vegEditPayload(rows = []) {
    return rows.map((r) => ({
        name: String((r && r.name) || ''),
        qty: Number(r && r.qty),
        unit: (r && r.unit) || '',
    }));
}

/* ── بوابات الأزرار — شروط القديم :18-26 و:340 و:508-513 ─────────────── */

/** زر «طلب جديد» — vegCanCreate :18 يساوي CREATE_ROLES الخادمية حرفيًا. */
export function vegCreateVisible(role) {return VEG_UI_CREATE_ROLES.includes(role);}

/** زر الاستلام — pending && vegCanReceive :22-25 (يساوي RECEIVE_ROLES). */
export function vegReceiveVisible(role, status) {
    return status === 'pending' && VEG_RECEIVE_ROLES.includes(role);
}

/** زر السعر — received && vegCanPrice :19 (الخادم يضم manager أيضًا —
 *  الواجهة تبقى على قايمة القديم الضيقة عمدًا: لا زر أوسع من القديم). */
export function vegPriceVisible(role, status) {
    return status === 'received' && VEG_UI_PRICE_ROLES.includes(role);
}

/** زر التعديل — الانحراف المعلن: ما سيقبله الخادم فعلًا فقط.
 *  الميدل وير :391 يقصر الأدوار على sous_chef|admin|owner أولًا (فwarehouse
 *  وdept_head يسقطان قبل فحص المنشئ)، ثم البوابة الداخلية :403-408 تقبل
 *  admin/owner أيًّا كان أو منشئ الطلب — فزر التعديل لهذين الحقلين وحدهما. */
export function vegEditVisible(role, status, raw = {}, userId = null) {
    if (status !== 'pending') {return false;}
    if (VEG_UI_BOSS_ROLES.includes(role)) {return true;}
    return VEG_EDIT_ROLES.includes(role) && userId != null && Number(raw.created_by) === Number(userId);
}

/** زر الإلغاء — شرط القديم :340: pending && (صاحب الطلب أو الإدارة). */
export function vegCancelVisible(role, status, raw = {}, userId = null) {
    if (status !== 'pending') {return false;}
    if (VEG_UI_BOSS_ROLES.includes(role)) {return true;}
    return userId != null && Number(raw.created_by) === Number(userId);
}
