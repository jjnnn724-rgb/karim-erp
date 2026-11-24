/**
 * V2 — Dispatches repository (الباب الوحيد إلى /api/dispatches)
 * ═══════════════════════════════════════════════════════════════════════
 *
 * CONTRACT COPIED FROM THE SERVER, NOT INVENTED
 *   GET /dispatches?page=&limit=&sort=id&order=desc → { data, pagination }
 *     (generic entity list, app.js:81 apiList shape. The server stays the
 *     authority on who may read dispatch orders.)
 *   dispatches columns (DB, read-only SELECT verified 2026-10-14):
 *     id, deptCode, deptName, items(jsonb), status, date, createdBy,
 *     notes, approvedDate, approvedBy, approveNotes, approvedItems(jsonb),
 *     rejectionReason, rejectedBy, rejectedDate, requestedAt, ...,
 *     warehouseApproved{At,By}, warehouseRejected{At,By},
 *     kitchenReceived{At,By}, receivedItems(jsonb), receiptNotes,
 *     closed{At,By}, needsChefApproval, chefApproved{At,By},
 *     chefRejected{At,By}, creatorRole, creatorUserId, lastEventHash,
 *     cancelled{At,By}, cancellationReason, reopened{At,By}, reopenReason,
 *     voided{At,By}, voidReason, voidedJournalCount.
 *   Direct status edits are rejected server-side (405
 *   DISPATCH_WORKFLOW_REQUIRED, server.js:1935) — decisions travel the
 *   dispatch workflow, a separate screen, never a row button here.
 *
 * DISPLAY ALLOWLIST — READ THIS BEFORE ADDING A COLUMN
 *   Signature blobs and hashes (requestSignatureData/Hash,
 *   warehouse*Signature*, kitchenReceiptSignature*, chefApprovalSignature*,
 *   lastEventHash) are attestation material, not register columns — never
 *   rendered, referenced or put in a title attribute. Items jsonb travels
 *   as a computed one-line summary (itemsText), not raw JSON. The ONE
 *   exception is the printed note document (printDispatchNote parity,
 *   kitchen.js:1233-1253): it fetches the single full row on demand and
 *   paints the signature images onto the sheet — never into the register.
 *
 * W1 (2026-10-15) — THIS FILE IS NOW THE SINGLE DOOR OF THE DECISION CYCLE
 *   The read register stays read-only; the cycle writes live below with
 *   contracts copied from the server, not invented:
 *     POST   /api/dispatches                         server.js:1544 (create roles)
 *     POST   /warehouse/dispatches/:id/cancel       dispatch-routes.js:101
 *     POST   /warehouse/dispatches/:id/reopen       dispatch-routes.js:135
 *     POST   /warehouse/dispatches/:id/void         dispatch-routes.js:180
 *     POST   /warehouse/dispatches/:id/chef-approve warehouse-routes.js:829
 *     POST   /warehouse/dispatches/:id/chef-reject  warehouse-routes.js:886
 *     POST   /warehouse/dispatches/:id/approve      warehouse-routes.js:621
 *     POST   /warehouse/dispatches/:id/reject       warehouse-routes.js:1039
 *     POST   /warehouse/dispatches/:id/receive      warehouse-routes.js:1076
 *     PUT    /warehouse/dispatches/:id/edit         warehouse-routes.js:932
 *   All decisions except cancellation require the account-locked electronic
 *   signature (requireSignature, warehouse-routes.js:365). Every write carries
 *   X-Idempotency-Key; the server remains the authority on every gate.
 */

import { apiFetch } from '../../core/api.js?v=4.9.323';

/** قراءة أذون الصرف. scope='month' (الافتراضي) = الشهر الحالي بفلتر الخادم
 *  (server.js:1680 يطبّق dateRange عند v2_period=month وحده)؛ scope='all' =
 *  السجل كله دون معلمة الفترة — بلا أي تغيير في الخادم. 'all' يسمح حتى 40
 *  صفحة (40×1000) حدًّا أمانيًّا صريحًا، فالكشف التاريخي قد يطول. */
export async function fetchDispatches(scope = 'month') {
    const rows = [];
    const maxPages = scope === 'all' ? 40 : 5;
    for (let page = 1; page <= maxPages; page += 1) {
        const params = new URLSearchParams({
            page: String(page), limit: '1000', sort: 'id', order: 'desc',
        });
        if (scope !== 'all') {params.set('v2_period', 'month');}
        const res = await apiFetch(`/dispatches?${params}`);
        const batch = res && Array.isArray(res.data) ? res.data
            : (Array.isArray(res) ? res : []);
        rows.push(...batch);
        const totalPages = Number(res && res.pagination && res.pagination.totalPages) || 0;
        if (!batch.length || (totalPages > 0 && page >= totalPages) || batch.length < 1000) {break;}
    }
    return rows;
}

const num = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
};

/** items jsonb → one compact line (first two + count), legacy wording
 *  (features/kitchen.js:143: name + approvedQty/qty). */
export function itemsSummary(items) {
    if (!Array.isArray(items) || !items.length) {return '';}
    const names = items.map((i) => {
        const n = i && (i.itemName || i.name) ? String(i.itemName || i.name) : '—';
        const q = num(i && (i.approvedQty ?? i.qty));
        return `${n} (${q.toLocaleString('en-US', { maximumFractionDigits: 3 })})`;
    });
    return names.length > 2 ? `${names.slice(0, 2).join('، ')}، +${names.length - 2}` : names.join('، ');
}

/**
 * Database row → table row. Pure and exported so it is testable
 * without a browser.
 */
export function dispatchToRow(d = {}) {
    const status = d.status !== undefined && d.status !== null ? String(d.status) : '';
    return {
        id: d.id,
        dept: d.deptName ? String(d.deptName) : (d.deptCode ? String(d.deptCode) : '—'),
        deptCode: d.deptCode ? String(d.deptCode) : '',
        deptResolved: !!(d.deptName),
        itemsText: itemsSummary(d.items),
        /* الأصناف الخام (اسم + كمية معتمدة) — البحث بالصنف يطابق هذه لا
           itemsText، فالملخص يعرض أول صنفين فقط (itemsSummary). */
        items: Array.isArray(d.items) ? d.items.map((i) => ({
            name: String((i && (i.itemName || i.name)) || ''),
            qty: num(i && (i.approvedQty ?? i.qty)),
        })).filter((it) => it.name) : [],
        itemsCount: Array.isArray(d.items) ? d.items.length : 0,
        date: d.date ? String(d.date).slice(0, 10) : '',
        status,
        by: d.createdBy ? String(d.createdBy) : '—',
        receivedBy: d.kitchenReceivedBy ? String(d.kitchenReceivedBy) : '',
    };
}

/** هل صفُّ الإذن يطابق بحثَ الصنف؟ يطابق أسماء الأصناف الخام بتطبيع
 *  arSearchKey (همزات/تاء مربوطة/تشبيك) — فـ«دجاج» تجد «الدجاج»
 *  و«بدجاجه». بلا مفتاح = الكل (لا فلترة). نقيةٌ للاختبار بلا متصفح. */
export function matchDispatchProduct(row, productQuery) {
    const key = arSearchKey(productQuery);
    if (!key) {return true;}
    if (!row || !Array.isArray(row.items)) {return false;}
    return row.items.some((it) => arSearchKey(it.name).includes(key));
}

/** تجميع المسحوب لصنف البحث عبر الصفوف: كل صنفٍ خامٍ مطابقٍ يُجمَّع
 *  باسمه الحرفي (لا بالتطبيع) فتظهر الأسماء كما في القاعدة. يعيد
 *  {vouchers, byName: Map(اسم→كمية معتمدة)}. نقيةٌ للاختبار. */
export function summarizeProductWithdrawal(rows, productQuery) {
    const key = arSearchKey(productQuery);
    const byName = new Map();
    let vouchers = 0;
    for (const row of rows || []) {
        if (!row || !Array.isArray(row.items)) {continue;}
        let hit = false;
        for (const it of row.items) {
            if (key && arSearchKey(it.name).includes(key)) {
                hit = true;
                byName.set(it.name, (byName.get(it.name) || 0) + num(it.qty));
            }
        }
        if (hit) {vouchers += 1;}
    }
    return { vouchers, byName };
}

/** Counts per stored status for the summary line — derived, never fetched. */
export function summarizeDispatches(rows = []) {
    const counts = {};
    for (const r of rows) {
        const k = r.status || '';
        counts[k] = (counts[k] || 0) + 1;
    }
    return counts;
}

/* ═══════════════════════════════════════════════════════════════════════
 * W1 — دورات القرار: الأدوار والبوابات وأبواب الكتابة
 * ═══════════════════════════════════════════════════════════════════════ */

/** من ينشئ إذن صرف — مرآة createRoles (server.js:1544). */
export const CREATE_ROLES = ['admin', 'manager', 'warehouse', 'kitchen', 'sous_chef', 'dept_head'];
/** من يعتمد/يرفض نيابة عن الشيف العمومي — مرآة CHEF_APPROVAL_ROLES
 *  (warehouse-routes.js:18) وcanDecideChef (kitchen.js:291) معًا. */
export const CHEF_DECIDE_ROLES = ['admin', 'manager', 'kitchen', 'sous_chef'];
/** من يعتمد/يرفض نيابة عن المخازن — مرآة WRITE_ROLES/APPROVAL_ROLES
 *  (warehouse-routes.js:14-15) وcanDecideWarehouse (kitchen.js:292). */
export const WAREHOUSE_DECIDE_ROLES = ['admin', 'manager', 'warehouse'];
/** من يستلم من المخزن في واجهة القرار — مرآة canReceive (kitchen.js:293).
 *  الخادم أوسع قليلًا (RECEIVE_ROLES يضم warehouse، warehouse-routes.js:16)
 *  وواجهة القرار هنا مرآة القديم عمدًا؛ القرار النهائي للخادم دائمًا. */
export const RECEIVE_ROLES = ['admin', 'manager', 'kitchen', 'sous_chef'];
/** من يعدّل قبل اعتماد المخازن — مرآة canEditDispatch (kitchen.js:343-353). */
export const EDIT_ROLES = ['kitchen', 'sous_chef', 'admin', 'manager'];
/** الإلغاء قبل الصرف متاح للمخازن والإدارة، ولمنشئ الإذن ضمن أدوار الإنشاء. */
export const CANCEL_ROLES = ['admin', 'manager', 'warehouse'];
/** الإرجاع والإبطال للمدير العام فقط — مرآة requireRoleOrPerm(dispatch.void). */
export const LIFECYCLE_ROLES = ['admin', 'manager'];
/** الحالات التي يُطبع فيها الإذن، بما فيها المستندات الموقّعة الملغاة/المبطلة. */
export const PRINT_STATUSES = ['approved', 'partially_received', 'received', 'cancelled', 'voided'];

/** كلمات مرحلة السلسلة — القديمة كما هي، مع حالتي الإلغاء والإبطال الجديدتين. */
export const CHAIN_STAGE_AR = {
    chefWait: 'بانتظار اعتماد الشيف العمومي',
    whWait: 'بانتظار اعتماد المخازن',
    chefDone: 'اعتمد الشيف — بانتظار صرف المخازن',
    dispensed: 'صُرف من المخازن — بانتظار الاستلام',
    partial: 'استُلم جزئيًا',
    received: 'مستلم ومغلق',
    rejected: 'مرفوض',
    cancelled: 'ملغى قبل الصرف',
    voided: 'مُبطل وعُكست آثاره المخزنية والمالية',
};

/** مرحلة السلسلة الحالية — مرآة dispatchChainStage (kitchen.js:220-229). */
export function chainStage(row = {}) {
    const st = String(row.status || '');
    if (st === 'pending') {return row.needsChefApproval ? CHAIN_STAGE_AR.chefWait : CHAIN_STAGE_AR.whWait;}
    if (st === 'chef_approved') {return CHAIN_STAGE_AR.chefDone;}
    if (st === 'approved') {return CHAIN_STAGE_AR.dispensed;}
    if (st === 'partially_received') {return CHAIN_STAGE_AR.partial;}
    if (st === 'received') {return CHAIN_STAGE_AR.received;}
    if (st === 'rejected') {return CHAIN_STAGE_AR.rejected;}
    if (st === 'cancelled') {return CHAIN_STAGE_AR.cancelled;}
    if (st === 'voided') {return CHAIN_STAGE_AR.voided;}
    return '';
}

/** أكواد أقسام صاحب الحساب — dept_code يقبل قائمة مفصولة بفواصل (server.js:1276). */
export function deptCodesOf(user) {
    return String((user && user.deptCode) || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
}

/**
 * مرادفات أكواد الأقسام — مرآة `DEPT_CODE_ALIASES` في backend/warehouse-routes.js.
 * أذون الصرف تُسجّل القسم التشغيلي (`hot_hall`) بينما حسابات HR قد تحمل
 * الاسم الآخر (`SERVICE`): بلا توحيد كانت مقارنة النصّ تُسقط زر الاستلام
 * والتعديل لرئيس القسم. نفس الجدول في الخادم هنا — الواجهة لا تخمّن.
 */
const DEPT_CODE_ALIASES = Object.freeze({
    shop: 'CAF', caf: 'CAF',
    ca1: 'NAS', nas: 'NAS',
    juice: 'G', g: 'G',
    service: 'hot_hall', hot_hall: 'hot_hall',
    kitchen: 'kitchen', storeroom: 'storeroom',
    external_sales: 'external_sales', salads: 'salads', sweets: 'sweets',
    bakery: 'bakery', hot_kitchen: 'hot_kitchen', butcher: 'butcher',
    fnb: 'fnb', open_buffet: 'open_buffet', kstore: 'kstore',
});

export function canonicalDeptCode(code) {
    const clean = String(code || '').trim().toLowerCase();
    if (!clean) {return '';}
    return DEPT_CODE_ALIASES[clean] || String(code || '').trim();
}

/** هل إذن هذا الصف يخص قسم صاحب الحساب؟ — مرآة deptsMatch (warehouse-routes.js)
 *  بالمقارنة على الكود الموحّد، لا نصّ الحساب نصّ الإذن. */
export function rowDeptMatches(user, row) {
    const codes = deptCodesOf(user);
    const target = canonicalDeptCode(row && row.deptCode).toLowerCase();
    return codes.length > 0 && codes.some((code) => canonicalDeptCode(code).toLowerCase() === target);
}

/* ── بوابات ظهور الإجراءات لكل صف ─────────────────────────────────────── */

/** V2 يحمل هوية الحساب في userId — لا id. نفس فصل المهام المفروض بالخادم. */
function isDispatchCreator(row, user) {
    const creatorId = Number(row && row.creatorUserId);
    const actorId = Number(user && user.userId);
    return Number.isInteger(creatorId) && creatorId > 0
        && Number.isInteger(actorId) && actorId > 0 && actorId === creatorId;
}

/** الأصناف المعتمدة (أو المطلوبة قبل الاعتماد) كما يراها مسار الاستلام. */
function dispatchLines(row = {}) {
    if (Array.isArray(row.approvedItems) && row.approvedItems.length) {return row.approvedItems;}
    return Array.isArray(row.items) ? row.items : [];
}

const receiptItemKey = (item) => String((item && (item.itemName || item.name)) || '').trim().toLowerCase();

/** رصيد صنف في الاستلام: المعتمد والمستلم تراكميًا والمتبقي للتكملة.
 *  receivedItems في قاعدة البيانات تراكمية، لذا لا تُجمع قيمها؛ يُطابَق آخر
 *  سطر بالاسم كما يفعل مسار الاستلام. packagingQty للوزن المتغير صناديق. */
export function dispatchReceiptBalance(row = {}, index = 0) {
    const item = dispatchLines(row)[index] || {};
    const itemKey = receiptItemKey(item);
    let prior = null;
    for (const received of (Array.isArray(row.receivedItems) ? row.receivedItems : [])) {
        if (receiptItemKey(received) === itemKey) {prior = received;}
    }
    const approved = Math.max(0, num(item.approvedQty ?? item.qty));
    const received = Math.max(0, num(prior && prior.receivedQty));
    const approvedPackaging = Math.max(0, num(item.packagingQty ?? item.approvedPackagingQty));
    const receivedPackaging = Math.max(0, num(prior && prior.receivedPackagingQty));
    return {
        item,
        approved,
        received,
        remaining: Math.max(0, approved - received),
        isCatchWeight: Boolean(item.catchWeightEnabled || item.actualWeight || approvedPackaging > 0),
        approvedPackaging,
        receivedPackaging,
        remainingPackaging: Math.max(0, approvedPackaging - receivedPackaging),
    };
}

/** هل بقي وزن/كمية أو صناديق وزن متغير قابلة للاستلام؟ دالة نقية بلا DOM. */
export function hasRemaining(row = {}) {
    const items = dispatchLines(row);
    return items.some((_, index) => {
        const balance = dispatchReceiptBalance(row, index);
        return balance.remaining > 1e-6
            || (balance.isCatchWeight && balance.remainingPackaging > 1e-6);
    });
}

/** أزرار الشيف: pending && needsChefApproval، ولا قرار لمنشئ الإذن. */
export function chefActionsVisible(role, row = {}, user = null) {
    return String(row.status) === 'pending' && !!row.needsChefApproval
        && CHEF_DECIDE_ROLES.includes(role) && !isDispatchCreator(row, user);
}

/** أزرار المخازن: (pending && !needsChefApproval) || chef_approved، وفصل المهام. */
export function warehouseActionsVisible(role, row = {}, user = null) {
    const st = String(row.status);
    return ((st === 'pending' && !row.needsChefApproval) || st === 'chef_approved')
        && WAREHOUSE_DECIDE_ROLES.includes(role) && !isDispatchCreator(row, user);
}

/** الإلغاء قبل الصرف فقط: الإدارة/المخازن، أو منشئ الإذن ضمن أدوار الإنشاء. */
export function cancelVisible(role, row = {}, user = null) {
    return ['pending', 'chef_approved', 'rejected'].includes(String(row.status))
        && CREATE_ROLES.includes(role)
        && (CANCEL_ROLES.includes(role) || isDispatchCreator(row, user));
}

/** الإرجاع للمراجعة: معتمد ولم يبدأ استلامه؛ يعكس الصرف والتكلفة بتوقيع. */
export function reopenVisible(role, row = {}) {
    return LIFECYCLE_ROLES.includes(role) && String(row.status) === 'approved'
        && !row.kitchenReceivedAt
        && !(Array.isArray(row.receivedItems) && row.receivedItems.length > 0);
}

/** الإبطال: مستند مرحّل (معتمد/جزئي/مستلم)، للمدير العام بتوقيع وسبب. */
export function voidVisible(role, row = {}) {
    return LIFECYCLE_ROLES.includes(role)
        && ['approved', 'partially_received', 'received'].includes(String(row.status));
}

/** الاستلام: approved|partially_received مع متبقٍ، وفصل المهام؛ رئيس القسم
 *  يستلم قسمه فقط (مطابقة canReceiveDispatch بالكود الموحّد). */
export function receiveVisible(role, row = {}, user = null) {
    if (!['approved', 'partially_received'].includes(String(row.status))) {return false;}
    if (!hasRemaining(row) || isDispatchCreator(row, user)) {return false;}
    if (RECEIVE_ROLES.includes(role)) {return true;}
    return role === 'dept_head' && rowDeptMatches(user, row);
}

/** التعديل: pending|chef_approved وقبل اعتماد المخازن (kitchen.js:343-353). */
export function editVisible(role, row, user) {
    if (!['pending', 'chef_approved'].includes(String(row.status))) {return false;}
    if (EDIT_ROLES.includes(role)) {return true;}
    if (role === 'dept_head' && rowDeptMatches(user, row)) {return true;}
    return row.creatorUserId != null && String(row.creatorUserId) === String(user && user.userId);
}

/** الطباعة: الحالات الموقّعة/المصروفة فقط (kitchen.js:294). */
export function printVisible(row) {
    return PRINT_STATUSES.includes(String(row.status));
}

/* ── قراءات نموذج الإنشاء/التعديل ─────────────────────────────────────── */

/** أرصدة المخزن الرئيسي لكل صنف — بوابة «الصنف صفر لا يُعرض» (kitchen.js:743-758). */
export async function fetchMainAvailability() {
    const res = await apiFetch('/warehouse/main-availability');
    const map = new Map();
    for (const item of (res && Array.isArray(res.items)) ? res.items : []) {
        map.set(Number(item.id), Number(item.on_hand) || 0);
    }
    return map;
}

/** مشي محدود على سجل المخزون — نفس سقف بقية السجلات (5 × 1000). */
export async function fetchDispatchCatalog() {
    const rows = [];
    for (let page = 1; page <= 5; page += 1) {
        const res = await apiFetch(`/inventory?page=${page}&limit=1000&sort=id&order=asc`);
        const batch = res && Array.isArray(res.data) ? res.data
            : (Array.isArray(res) ? res : []);
        rows.push(...batch);
        const totalPages = Number(res && res.pagination && res.pagination.totalPages) || 0;
        if (!batch.length || (totalPages > 0 && page >= totalPages) || batch.length < 1000) {break;}
    }
    return rows;
}

/** صف مخزون → حقول نموذج الطلب وحدها (kitchen.js:359-370). */
export function catalogItem(raw = {}) {
    const secondary = Array.isArray(raw.secondary_units)
        ? raw.secondary_units.filter((u) => u && u.uom && Number(u.factor) > 0)
        : [];
    return {
        id: raw.id,
        name: String(raw.name || ''),
        unit: String(raw.unit || 'قطعة'),
        barcode: raw.barcode ? String(raw.barcode) : '',
        catchWeight: !!raw.catch_weight_enabled,
        packagingUom: String(raw.packaging_uom || 'كرتون'),
        avgBoxPerCrate: Number(raw.packaging_qty_per_base) || 0,
        avgCost: Number(raw.avgCost) || 0,
        catchWeightUom: String(raw.catch_weight_uom || 'kg'),
        secondaryUnits: secondary.map((u) => ({ uom: String(u.uom), factor: Number(u.factor) })),
    };
}

/** بحث عربي مطبَّع — منسوخ من core/utils.js:165-176 (نفس جدول الحروف). */
export function arSearchKey(s) {
    return String(s || '').toLowerCase()
        .replace(/[\u064B-\u065F\u0640]/g, '')
        .replace(/[أإآٱ]/g, 'ا').replace(/ة/g, 'ه').replace(/[ىئی]/g, 'ي').replace(/ؤ/g, 'و').replace(/ک/g, 'ك')
        .replace(/[ذز]/g, 'ز').replace(/[ضص]/g, 'ص').replace(/[ظط]/g, 'ط').replace(/[شس]/g, 'س')
        .replace(/[ثت]/g, 'ت').replace(/[خج]/g, 'ح').replace(/[قف]/g, 'ف').replace(/[غع]/g, 'ع')
        .replace(/\s+/g, ' ').trim();
}

/** بحث «بازنجان تجد باذنجان» — الحرفي أولًا ثم المطبَّع (kitchen.js:803-807). */
export function searchCatalog(catalog, query, availFn) {
    const q = String(query || '').trim().toLowerCase();
    const withAvail = catalog.filter((i) => availFn(i) > 0);
    if (!q) {return withAvail;}
    const hit = (i) => i.name.toLowerCase().includes(q) || (i.barcode && i.barcode.includes(q));
    let matches = withAvail.filter(hit);
    if (!matches.length) {
        const nq = arSearchKey(q);
        matches = withAvail.filter((i) => arSearchKey(i.name).includes(nq) || (i.barcode && i.barcode.includes(q)));
    }
    return matches.slice(0, 30);
}

/** أقسام الطلب — المشي نفسه على السجل العام (kitchen.js:693-698 مصدره STATE.departments). */
export async function fetchDepartmentOptions() {
    const rows = [];
    for (let page = 1; page <= 3; page += 1) {
        const res = await apiFetch(`/departments?page=${page}&limit=1000&sort=id&order=asc`);
        const batch = res && Array.isArray(res.data) ? res.data
            : (Array.isArray(res) ? res : []);
        rows.push(...batch);
        const totalPages = Number(res && res.pagination && res.pagination.totalPages) || 0;
        if (!batch.length || (totalPages > 0 && page >= totalPages) || batch.length < 1000) {break;}
    }
    return rows.map((d) => ({ code: String(d.code || ''), name: String(d.name || d.name_ar || d.code || '') }));
}

/** اسم القسم من قائمة الأقسام — بعدّاد الأكواد نفسه في kitchen.js:213-218. */
export function deptNameByCode(options, code) {
    const want = String(code || '').trim().toLowerCase();
    if (!want) {return '';}
    const row = (options || []).find((d) => String(d.code).toLowerCase() === want);
    return row ? row.name : '';
}

/** صف الإعدادات الواحد (اسم المطبعة/العملة/الشعار) — للوحة الاعتماد وورقة الطباعة. */
export async function fetchDispatchSettings() {
    const res = await apiFetch('/settings/main_settings');
    const row = Array.isArray(res) ? res[0] : res;
    return {
        name: row && row.name ? String(row.name) : '',
        currency: row && row.currency != null ? String(row.currency).trim() : '',
        logoB64: row && row.logoB64 ? String(row.logoB64) : '',
    };
}

/** الصف الكامل للطباعة — التواقيع لا تُجلب إلا هنا (kitchen.js:1236-1240). */
export async function fetchDispatchFull(id) {
    const res = await apiFetch(`/dispatches/${encodeURIComponent(id)}`);
    return (res && (res.data || res.id)) ? (res.data || res) : null;
}

/* ── أبواب الكتابة — المسارات كما هي عند الخادم، والرسائل تصعد كما ترد ── */

function operationKey(action, id) {
    const unique = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    return `dispatch-${action}:${id}:${unique}`;
}

function writeDispatch(path, method, body, action, id) {
    return apiFetch(path, {
        method,
        body: JSON.stringify(body),
        headers: { 'X-Idempotency-Key': operationKey(action, id) },
    });
}

/** إنشاء طلب صرف — POST /api/dispatches (server.js:1544-1621). */
export async function createDispatch(body) {
    return writeDispatch('/dispatches', 'POST', body, 'create', 'new');
}

/** تعديل قبل اعتماد المخازن — PUT /warehouse/dispatches/:id/edit (:932). */
export async function editDispatch(id, body) {
    return writeDispatch(`/warehouse/dispatches/${encodeURIComponent(id)}/edit`, 'PUT', body, 'edit', id);
}

/** إلغاء موثّق قبل صرف المخزون — POST /warehouse/dispatches/:id/cancel. */
export async function cancelDispatch(id, body) {
    return writeDispatch(`/warehouse/dispatches/${encodeURIComponent(id)}/cancel`, 'POST', body, 'cancel', id);
}

/** إرجاع الإذن المعتمد غير المستلم للمراجعة وعكس أثره — /reopen موقّع. */
export async function reopenDispatch(id, body) {
    return writeDispatch(`/warehouse/dispatches/${encodeURIComponent(id)}/reopen`, 'POST', body, 'reopen', id);
}

/** إبطال إذن مرحّل وعكس آثاره المخزنية والمالية — /void موقّع. */
export async function voidDispatch(id, body) {
    return writeDispatch(`/warehouse/dispatches/${encodeURIComponent(id)}/void`, 'POST', body, 'void', id);
}

/** اعتماد الشيف — POST /warehouse/dispatches/:id/chef-approve (:829). */
export async function chefApproveDispatch(id, body) {
    return writeDispatch(`/warehouse/dispatches/${encodeURIComponent(id)}/chef-approve`, 'POST', body, 'chef-approve', id);
}

/** رفض الشيف — POST /warehouse/dispatches/:id/chef-reject (:886). */
export async function chefRejectDispatch(id, body) {
    return writeDispatch(`/warehouse/dispatches/${encodeURIComponent(id)}/chef-reject`, 'POST', body, 'chef-reject', id);
}

/** اعتماد المخازن — POST /warehouse/dispatches/:id/approve (:621). */
export async function approveDispatch(id, body) {
    return writeDispatch(`/warehouse/dispatches/${encodeURIComponent(id)}/approve`, 'POST', body, 'approve', id);
}

/** رفض المخازن — POST /warehouse/dispatches/:id/reject (:1039). */
export async function rejectDispatch(id, body) {
    return writeDispatch(`/warehouse/dispatches/${encodeURIComponent(id)}/reject`, 'POST', body, 'reject', id);
}

/** استلام القسم — POST /warehouse/dispatches/:id/receive (:1076). */
export async function receiveDispatch(id, body) {
    return writeDispatch(`/warehouse/dispatches/${encodeURIComponent(id)}/receive`, 'POST', body, 'receive', id);
}
