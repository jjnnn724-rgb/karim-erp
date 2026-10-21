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
 *     chefRejected{At,By}, creatorRole, creatorUserId, lastEventHash.
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
 *     POST   /api/dispatches                        server.js:1544 (create roles)
 *     DELETE /api/dispatches/:id                    server.js delete block
 *     POST   /warehouse/dispatches/:id/chef-approve warehouse-routes.js:829
 *     POST   /warehouse/dispatches/:id/chef-reject  warehouse-routes.js:886
 *     POST   /warehouse/dispatches/:id/approve      warehouse-routes.js:621
 *     POST   /warehouse/dispatches/:id/reject       warehouse-routes.js:1039
 *     POST   /warehouse/dispatches/:id/receive      warehouse-routes.js:1076
 *     PUT    /warehouse/dispatches/:id/edit         warehouse-routes.js:932
 *   Every decision endpoint requires the account-locked electronic
 *   signature (requireSignature, warehouse-routes.js:365) and the server
 *   remains the authority on every gate — this file only names the paths.
 */

import { apiFetch } from '../../core/api.js?v=4.9.186';

/** Bounded current-month entity walk (5 × 1000), newest first. */
export async function fetchDispatches() {
    const rows = [];
    for (let page = 1; page <= 5; page += 1) {
        const params = new URLSearchParams({
            page: String(page), limit: '1000', sort: 'id', order: 'desc',
            v2_period: 'month',
        });
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
        itemsCount: Array.isArray(d.items) ? d.items.length : 0,
        date: d.date ? String(d.date).slice(0, 10) : '',
        status,
        by: d.createdBy ? String(d.createdBy) : '—',
        receivedBy: d.kitchenReceivedBy ? String(d.kitchenReceivedBy) : '',
    };
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
/** الحالات التي يُطبع فيها الإذن — مرآة شرط زر الطباعة (kitchen.js:294). */
export const PRINT_STATUSES = ['approved', 'partially_received', 'received'];

/** كلمات مرحلة السلسلة — منسوخة من core/i18n.js:98-100 كما تنطقها الشاشة القديمة. */
export const CHAIN_STAGE_AR = {
    chefWait: 'بانتظار اعتماد الشيف العمومي',
    whWait: 'بانتظار اعتماد المخازن',
    chefDone: 'اعتمد الشيف — بانتظار صرف المخازن',
    dispensed: 'صُرف من المخازن — بانتظار الاستلام',
    partial: 'استُلم جزئيًا',
    received: 'مستلم ومغلق',
    rejected: 'مرفوض',
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
    return '';
}

/** أكواد أقسام صاحب الحساب — dept_code يقبل قائمة مفصولة بفواصل (server.js:1276). */
export function deptCodesOf(user) {
    return String((user && user.deptCode) || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
}

/** هل إذن هذا الصف يخص قسم صاحب الحساب؟ — مرآة deptsMatch (warehouse-routes.js). */
export function rowDeptMatches(user, row) {
    const codes = deptCodesOf(user);
    return codes.length > 0 && codes.includes(String((row && row.deptCode) || '').trim().toLowerCase());
}

/* ── بوابات ظهور الإجراءات لكل صف — مرايا أسطر الشاشة القديمة ────────── */

/** أزرار الشيف: pending && needsChefApproval (kitchen.js:294). */
export function chefActionsVisible(role, row) {
    return String(row.status) === 'pending' && !!row.needsChefApproval && CHEF_DECIDE_ROLES.includes(role);
}

/** أزرار المخازن: (pending && !needsChefApproval) || chef_approved (kitchen.js:294). */
export function warehouseActionsVisible(role, row) {
    const st = String(row.status);
    return ((st === 'pending' && !row.needsChefApproval) || st === 'chef_approved')
        && WAREHOUSE_DECIDE_ROLES.includes(role);
}

/** الحذف: معلّق للمخازن والمدير، وأي حالة للأدمن — نهائي موثّق (kitchen.js:294). */
export function deleteVisible(role, row) {
    if (role === 'admin') {return true;}
    return String(row.status) === 'pending' && WAREHOUSE_DECIDE_ROLES.includes(role);
}

/** الاستلام: approved && (canReceive أو رئيس القسم المخوّل صاحب الإذن).
 *  رئيس القسم هنا بأكواد قسمه (مطابقة الخادم canReceiveDispatch) لا
 *  بالمقارنة النصية الحرفية القديمة التي كانت تُسقط الأقسام المتعددة. */
export function receiveVisible(role, row, user) {
    if (String(row.status) !== 'approved') {return false;}
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

/** إنشاء طلب صرف — POST /api/dispatches (server.js:1544-1621). */
export async function createDispatch(body) {
    return apiFetch('/dispatches', { method: 'POST', body: JSON.stringify(body) });
}

/** تعديل قبل اعتماد المخازن — PUT /warehouse/dispatches/:id/edit (:932). */
export async function editDispatch(id, body) {
    return apiFetch(`/warehouse/dispatches/${encodeURIComponent(id)}/edit`, { method: 'PUT', body: JSON.stringify(body) });
}

/** حذف — DELETE /api/dispatches/:id (معلّق للمخازن، وأي حالة للأدمن بموثّق). */
export async function deleteDispatch(id) {
    return apiFetch(`/dispatches/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

/** اعتماد الشيف — POST /warehouse/dispatches/:id/chef-approve (:829). */
export async function chefApproveDispatch(id, body) {
    return apiFetch(`/warehouse/dispatches/${encodeURIComponent(id)}/chef-approve`, { method: 'POST', body: JSON.stringify(body) });
}

/** رفض الشيف — POST /warehouse/dispatches/:id/chef-reject (:886). */
export async function chefRejectDispatch(id, body) {
    return apiFetch(`/warehouse/dispatches/${encodeURIComponent(id)}/chef-reject`, { method: 'POST', body: JSON.stringify(body) });
}

/** اعتماد المخازن — POST /warehouse/dispatches/:id/approve (:621). */
export async function approveDispatch(id, body) {
    return apiFetch(`/warehouse/dispatches/${encodeURIComponent(id)}/approve`, { method: 'POST', body: JSON.stringify(body) });
}

/** رفض المخازن — POST /warehouse/dispatches/:id/reject (:1039). */
export async function rejectDispatch(id, body) {
    return apiFetch(`/warehouse/dispatches/${encodeURIComponent(id)}/reject`, { method: 'POST', body: JSON.stringify(body) });
}

/** استلام القسم — POST /warehouse/dispatches/:id/receive (:1076). */
export async function receiveDispatch(id, body) {
    return apiFetch(`/warehouse/dispatches/${encodeURIComponent(id)}/receive`, { method: 'POST', body: JSON.stringify(body) });
}
