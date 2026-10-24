/**
 * V2 — Purchase-requests repository (الباب الوحيد إلى /api/warehouse/purchase-requests)
 * ═══════════════════════════════════════════════════════════════════════
 *
 * CONTRACT COPIED FROM THE SERVER, NOT INVENTED
 *   GET  /warehouse/purchase-requests        → raw array, raw rows
 *     (warehouse-routes.js:3212; LIMIT 200 ORDER BY created_at DESC :3215;
 *     READ gate admin|manager|warehouse|kitchen|sous_chef|accountant —
 *     PR_READ_ROLES :3004).
 *   GET  /warehouse/purchase-requests/shortages → raw array of
 *     { itemId, itemName, unit, currentQty, minQty, suggestedQty }
 *     (:3193; deficit = minQty - qty only when positive — the SQL of the
 *     door is the cap: LIMIT 200 ordered by biggest deficit :3197).
 *   Status values (CHECK constraint :3162):
 *     pending | chef_approved | approved | partially_fulfilled | fulfilled |
 *     rejected | cancelled — every one has an entry in v2/status.js
 *     purchase_request:* (approved in the read wave from prStatusLabel).
 *
 * W1-3 (2026-10-15) — THE FULL PR CYCLE'S DOORS LIVE HERE NOW
 *   Writes added, one per server route, exact paths and bodies:
 *     POST /warehouse/purchase-requests            (:3224)
 *     POST /warehouse/purchase-requests/:id/chef-approve (:3294)
 *     POST /warehouse/purchase-requests/:id/chef-reject  (:3326)
 *     POST /warehouse/purchase-requests/:id/gm-approve   (:3361)
 *     POST /warehouse/purchase-requests/:id/gm-reject    (:3393)
 *     POST /warehouse/purchase-requests/:id/cancel       (:3636)
 *     DELETE /warehouse/purchase-requests/:id            (:3667)
 *   DELIBERATELY ABSENT: warehouse-receive (:3428) — retired by the owner
 *   2026-10-01 (410 PR_RECEIVE_RETIRED; «دورة طلب الشراء تنتهي باعتماد
 *   المدير العام — سجّل البضاعة بفاتورة مشتريات») and dead in the legacy
 *   page too (features/kitchen.js:609-613). A door here would be a lie.
 *
 *   Chef-created requests are FINAL: POST / with a kitchen|sous_chef role
 *   inserts status='approved' + the chef's own signature in the same row
 *   (:3268-3281, owner upgrade 2026-10-04) — the repository does not decide
 *   that; it only carries the signature the server required (:3229-3232).
 *   GM approval requires a DIFFERENT signer than the request's chef
 *   (canPRGMDecide self-approval block :3072 → PR_SELF_APPROVAL), and the
 *   reason floor (≥3 chars, :3330/:3397) is the screen's validation mirror
 *   (legacy features/kitchen.js:567,:600 says the same words).
 *
 * DISPLAY RULE (no invented persisted values)
 *   The stored row is passed through; signatures/approvals are RAW
 *   read-only facts. `whReceived` reads the stored `wh_received_name`
 *   column (:3137) — the previous copy read `received_by_name`, a column
 *   the schema never had (silent blank column, fixed here). The table
 *   column summary truncates to two names + the rest («+N») — the V2
 *   display choice approved in the read wave; the cell cannot hold a
 *   200-item list.
 *
 * PAIRS WITH: screens/wh-prs.js (screen 21 in js/v2/MIGRATION.md).
 */

import { apiFetch } from '../../core/api.js?v=4.9.156';

const num = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
};

/* ── ثوابت الأدوار — مرايا سطور الخادم :2997-3006 حرفيًا (بمسافاتها) ────── */

export const PR_CREATE_ROLES = ['admin', 'manager', 'warehouse', 'kitchen', 'sous_chef'];
// الإلغاء أوسع عند الخادم عمدًا (:2998: + dept_head لأن أصحاب الطلبات القديمة يلغون ما أنشأوه)
export const PR_CANCEL_ROLES = ['admin', 'manager', 'warehouse', 'kitchen', 'sous_chef', 'dept_head'];
export const PR_CHEF_ROLES = ['admin', 'manager', 'kitchen', 'sous_chef'];
export const PR_GM_ROLES = ['admin', 'manager'];
export const PR_READ_ROLES = ['admin', 'manager', 'warehouse', 'kitchen', 'sous_chef', 'accountant'];
export const PR_CHEF_CREATE_ROLES = ['kitchen', 'sous_chef'];

/** مجموعة زر الإلغاء في الواجهة — prCanCreate/prCanCancel في القديم :305,:311
 *  (خمسُ أدوار بلا dept_head، وهو لا يقرأ الشاشة أصلًا). */
export const PR_CANCEL_UI_ROLES = ['admin', 'manager', 'warehouse', 'kitchen', 'sous_chef'];

/* ── أبواب القراءة ────────────────────────────────────────────────────── */

export async function fetchPurchaseRequests() {
    const res = await apiFetch('/warehouse/purchase-requests');
    return Array.isArray(res) ? res : (Array.isArray(res && res.data) ? res.data : []);
}

export async function fetchShortages() {
    try {
        const res = await apiFetch('/warehouse/purchase-requests/shortages');
        return Array.isArray(res) ? res : (Array.isArray(res && res.data) ? res.data : []);
    } catch (_) {
        return [];    // shortages are advisory; never break the load
    }
}

/** أقسام اختيار «القسم الطالب» — المشي نفسه على السجل العام (القديم مصدره
 *  STATE.departments). parent_code يبقى لأن مرشح القديمة :504 يقرأه. */
export async function fetchPRDepartments() {
    const rows = [];
    for (let page = 1; page <= 3; page += 1) {
        const res = await apiFetch(`/departments?page=${page}&limit=1000&sort=id&order=asc`);
        const batch = res && Array.isArray(res.data) ? res.data
            : (Array.isArray(res) ? res : []);
        rows.push(...batch);
        const totalPages = Number(res && res.pagination && res.pagination.totalPages) || 0;
        if (!batch.length || (totalPages > 0 && page >= totalPages) || batch.length < 1000) {break;}
    }
    return rows.map((d) => ({
        code: String(d.code || ''),
        name: String(d.name || d.name_ar || d.code || ''),
        parentCode: String(d.parent_code || ''),
    }));
}

/** أسماء أصناف المخزون لقائمة الإكمال — باب استشاري: فشله لا يعطّل النموذج
 *  (القديم كان يقرأ STATE.inventory وقد تكون فارغة كذلك). */
export async function fetchPRInventoryNames() {
    try {
        const rows = [];
        for (let page = 1; page <= 5; page += 1) {
            const res = await apiFetch(`/inventory?page=${page}&limit=1000&sort=id&order=asc`);
            const batch = res && Array.isArray(res.data) ? res.data
                : (Array.isArray(res) ? res : []);
            rows.push(...batch);
            const totalPages = Number(res && res.pagination && res.pagination.totalPages) || 0;
            if (!batch.length || (totalPages > 0 && page >= totalPages) || batch.length < 1000) {break;}
        }
        return rows.map((r) => String(r.name || '')).filter(Boolean);
    } catch (_) {
        return [];
    }
}

/** صف الإعدادات الواحد (اسم المطبعة/الشعار) — لورقة الطباعة. */
export async function fetchPRSettings() {
    const res = await apiFetch('/settings/main_settings');
    const row = Array.isArray(res) ? res[0] : res;
    return {
        name: row && row.name ? String(row.name) : '',
        logoB64: row && row.logoB64 ? String(row.logoB64) : '',
    };
}

/* ── أبواب الكتابة — المسارات كما هي عند الخادم، والرسائل تصعد كما ترد ── */

/** إنشاء طلب — POST /warehouse/purchase-requests (:3224). توقيع الشيف
 *  إلزامي عند دورَي المطبخ (:3229-3232) ويحسمه الخادم. */
export async function createPR(body) {
    return apiFetch('/warehouse/purchase-requests', { method: 'POST', body: JSON.stringify(body) });
}

/** توقيع الشيف — POST /:id/chef-approve (:3294). */
export async function chefApprovePR(id, body) {
    return apiFetch(`/warehouse/purchase-requests/${encodeURIComponent(id)}/chef-approve`, { method: 'POST', body: JSON.stringify(body) });
}

/** رفض الشيف — POST /:id/chef-reject (:3326). */
export async function chefRejectPR(id, body) {
    return apiFetch(`/warehouse/purchase-requests/${encodeURIComponent(id)}/chef-reject`, { method: 'POST', body: JSON.stringify(body) });
}

/** اعتماد المدير العام النهائي — POST /:id/gm-approve (:3361). */
export async function gmApprovePR(id, body) {
    return apiFetch(`/warehouse/purchase-requests/${encodeURIComponent(id)}/gm-approve`, { method: 'POST', body: JSON.stringify(body) });
}

/** رفض المدير العام — POST /:id/gm-reject (:3393). */
export async function gmRejectPR(id, body) {
    return apiFetch(`/warehouse/purchase-requests/${encodeURIComponent(id)}/gm-reject`, { method: 'POST', body: JSON.stringify(body) });
}

/** إلغاء (معلّق أو موقّع شيف) — POST /:id/cancel (:3636). جسمٌ فارغ كما يرسل القديم :624. */
export async function cancelPR(id) {
    return apiFetch(`/warehouse/purchase-requests/${encodeURIComponent(id)}/cancel`, { method: 'POST', body: JSON.stringify({}) });
}

/** حذف نهائي (الإدارة، وبلا أثر مخزني) — DELETE /:id (:3667). */
export async function deletePR(id) {
    return apiFetch(`/warehouse/purchase-requests/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

/* ── المحوّلات النقية ─────────────────────────────────────────────────── */

/** One-line summary of the items (legacy full list at kitchen.js:495;
 *  V2 display cell keeps first two + count — read-wave choice). */
function itemsSummary(items) {
    if (!Array.isArray(items) || !items.length) {return '—';}
    const names = items.map((i) => {
        const n = i && (i.itemName || i.name) ? String(i.itemName || i.name) : '—';
        const q = num(i && (i.requestedQty ?? i.qty ?? 0));
        return `${n} (${q})`;
    });
    return names.length > 2 ? `${names.slice(0, 2).join('، ')} +${names.length - 2}` : names.join('، ');
}

/**
 * Database row → table row. Pure and exported so it is testable
 * without a browser.
 */
export function purchaseRequestToRow(r = {}) {
    const items = Array.isArray(r.items) ? r.items : [];
    return {
        id: r.id,
        number: r.request_number ? String(r.request_number) : `#${r.id ?? '؟'}`,
        itemsText: itemsSummary(items),
        itemsCount: items.length,
        status: r.status ? String(r.status) : '',
        by: r.creator_name ? String(r.creator_name) : '—',
        chefSigned: r.chef_approved_name ? String(r.chef_approved_name) : '',
        gmSigned: r.gm_approved_name ? String(r.gm_approved_name) : '',
        whReceived: r.wh_received_name ? String(r.wh_received_name) : '',
        created: r.created_at ? String(r.created_at).slice(0, 10) : '',
    };
}

/** عدّاد شريط الملخص — نقية على الصفوف الخام. */
export function summarizePR(rows = []) {
    const of = (s) => rows.filter((r) => r.status === s).length;
    return {
        total: rows.length,
        pending: of('pending'),
        chefApproved: of('chef_approved'),
        approved: of('approved'),
        rejected: of('rejected'),
        cancelled: of('cancelled'),
    };
}

/* ── بوابات الأزرار — شروط القديم :495 حرفيًا (والكلمة النهائية للخادم) ── */

export function isChefCreator(role) {return PR_CHEF_CREATE_ROLES.includes(role);}

/** زرّا الشيف للـ«معلّق» ولمن يملك الدور (:495: prCanChef). */
export function chefActionsVisible(role, status) {return status === 'pending' && PR_CHEF_ROLES.includes(role);}

/** زرّا المدير العام للموقّع من الشيف ولمن يملك الدور (:495: prCanGM). */
export function gmActionsVisible(role, status) {return status === 'chef_approved' && PR_GM_ROLES.includes(role);}

/** شرطا الإلغاء في القديم :495: معلّق (prCanCreate) أو موقّع شيف (prCanCancel). */
export function cancelVisible(role, status) {
    if (status === 'pending') {return PR_CREATE_ROLES.includes(role);}
    if (status === 'chef_approved') {return PR_CANCEL_UI_ROLES.includes(role);}
    return false;
}

/** حذف الإدارة — انحراف معلن عن القديم :313: القديم يخفي الزر على
 *  approved/fulfilled فقط ويرسل partially_fulfilled إلى خادم يرفضه (:3674
 *  «لا يجوز حذف طلب معتمد أو مستلم (ولو جزئيًا)»)، فالواجهة تخفي الحالات
 *  الثلاث المحمية بخادمها بدل عرض زر يفشل حتمًا. */
export function deleteVisible(role, status) {
    return PR_GM_ROLES.includes(role) && !['approved', 'partially_fulfilled', 'fulfilled'].includes(status);
}

/** زر الطباعة — قائمة القديم :495 حرفيًا. */
export function printVisible(status) {
    return ['approved', 'chef_approved', 'pending', 'fulfilled'].includes(status);
}

/** مرشح أقسام «القسم الطالب» — شرط القديم :504 حرفيًا. */
export function filterPRDeptOptions(rows = []) {
    return rows.filter((d) => !String(d.code || '').startsWith('ys_')
        && d.code !== 'kitchen' && d.code !== 'external_sales' && d.parentCode !== 'kitchen');
}

/* ── حمولات الكتابة — حقول القديم :520,:526,:537,:554,:571,:586,:604 ──── */

/** صف نقص مختار → صنف الخادم (القديم :520). كمية غير صالحة تُسقط الصف. */
function shortageItemEntry(row = {}) {
    const qty = Number(row.qty);
    if (!Number.isFinite(qty) || qty <= 0) {return null;}
    return {
        itemId: Number(row.itemId) || null,
        itemName: String(row.itemName || ''),
        unit: String(row.unit || '').trim() || 'وحدة',
        requestedQty: qty,
    };
}

/** صف يدوي → صنف الخادم (القديم :526). بلا اسم أو كمية موجبة يُسقط الصف. */
function manualItemEntry(row = {}) {
    const name = String(row.name || '').trim();
    const qty = Number(row.qty);
    if (!name || !Number.isFinite(qty) || qty <= 0) {return null;}
    return {
        itemName: name,
        unit: String(row.unit || '').trim() || 'وحدة',
        requestedQty: qty,
    };
}

/** أصناف الإنشاء: النواقص المختارة ثم اليدوية — ترتيب القديم :517-527. */
export function collectPRItems(shortageRows = [], manualRows = []) {
    const items = [];
    for (const row of Array.isArray(shortageRows) ? shortageRows : []) {
        const e = shortageItemEntry(row);
        if (e) {items.push(e);}
    }
    for (const row of Array.isArray(manualRows) ? manualRows : []) {
        const e = manualItemEntry(row);
        if (e) {items.push(e);}
    }
    return items;
}

/** تحقق الإنشاء — كلمة القديمة :528 (وللخادم :3237 كلمته، تصعد كما ترد). */
export function prCreateError(items = []) {
    return items.length ? '' : 'اختر صنفًا واحدًا على الأقل بكمية موجبة';
}

/** تحقق سبب الرفض — الرسالة نفسها في القديم :567,:600 والخادم :3330,:3397. */
export function prReasonError(reason) {
    const r = String(reason || '').trim();
    return r.length >= 3 ? '' : 'سبب الرفض مطلوب (3 أحرف على الأقل)';
}

/** حمولة الإنشاء — حقول القديمة :537 (بتوقيع الشيف وحده، وإلا null كما ترسل). */
export function prCreatePayload({ items = [], notes = '', deptCode = '', signatureData = null, signerName = null } = {}) {
    return {
        items,
        notes: String(notes || '').trim(),
        deptCode: String(deptCode || ''),
        signatureData: signatureData || null,
        signerName: signerName || null,
    };
}

/** حمولة قرار بملاحظات — chef-approve :554 وgm-approve :586. */
export function prNotesPayload(notes = '', signatureData = null, signerName = null) {
    return { notes: String(notes || '').trim(), signatureData, signerName };
}

/** حمولة قرار برفض — chef-reject :571 وgm-reject :604. */
export function prRejectPayload(reason = '', signatureData = null, signerName = null) {
    return { reason: String(reason || '').trim(), signatureData, signerName };
}
