/**
 * V2 — Kitchen overview repository (الباب الوحيد إلى /api/kitchen/overview)
 * ═══════════════════════════════════════════════════════════════════════
 *
 * CONTRACT COPIED FROM THE SERVER, NOT INVENTED
 *   GET /kitchen/overview → { locations, batches, exceptions, policies,
 *     distributions } (kitchen-production-routes.js:145-151 · read gate
 *     admin|manager|warehouse|kitchen|sous_chef|auditor|cashier — same
 *     file :11. The first operational door the owner's own sous_chef
 *     account may read.)
 *   batches: full row + product_name (COALESCE joined), product_unit,
 *     location_name; status IN (draft,open,closed); ORDER created_at DESC
 *     LIMIT 100 → the door can never return 'cancelled'.
 *   exceptions: full row + product_name + department_name; status='open'
 *     only; LIMIT 100 newest.
 *   policies: every kitchen_policies row, ORDER department_id — no cap.
 *   distributions: LIMIT 300 newest, JOINed to their batch for the product.
 *   Failure shape: 500 {error:'KITCHEN_OVERVIEW_FAILED', message} (:151).
 *
 * THE WINDOW IS THE CONTRACT, SO IT IS STATED
 *   Every number this screen prints is a count or a sum over what the door
 *   sent — newest 100 orders, newest 100 open exceptions, newest 300
 *   distributions. Nothing here is a lifetime total, and capNote() says so
 *   out loud the moment a window is full (100 rows arrived, so older rows
 *   exist outside it). A KPI that reads "100" and is presented as "كل
 *   الأوامر" would be the invention this family refuses.
 *
 * DISPLAY RULE (no invented persisted values)
 *   Legacy renders draft AND open as one «مفتوح» badge
 *   (features/kitchen.js:168), closed as «مغلق — موزع», cancelled as
 *   «ملغى». The repo keeps the stored key and collapses draft into 'open'
 *   (stateKey); the WORDS and tones come from the shared status registry
 *   (status.js:117-119), which already carries those exact labels. Anything
 *   the registry does not know is shown raw.
 *   Policy mode words are the legacy page's own (features/kitchen.js:154:
 *   flexible:مرن، monitor:مراقب، strict:صارم) — they are not statuses, so
 *   this file is their only home. An unknown mode shows raw.
 *
 * W1-2 (2026-10-15) — THE KITCHEN CYCLE'S DOORS LIVE HERE NOW
 *   Reads added : /kitchen/stock (:154) · /kitchen/production-materials (:160) ·
 *                 /kitchen/production-destinations (:161) · /kitchen/audits
 *                 (:328, LIMIT 50) · /kitchen/documents (:327, LIMIT 100) ·
 *                 /pos/products (optional door, shift-routes.js:238 — أدوار
 *                 المخازن ليست في قائمته فيرد 403، فتحة الأمر تعمل بإدخال يدوي).
 *   Writes added: /kitchen/production (:247) · /kitchen/transfers/receive (:155) ·
 *                 /kitchen/audits (:329) · /audits/:id/count (:330) ·
 *                 /audits/:id/submit (:331) · /audits/:id/approve (:332).
 *   The receive payload DELIBERATELY OMITS `reference`: the server's 10-minute
 *   same-shape duplicate guard runs ONLY when the request has no reference
 *   (:156) and the legacy page sent `KITCHEN-${uid()}` per click
 *   (features/kitchen.js:124), disabling it. V2 lets the server guard work;
 *   the divergence is pinned by test on both sides.
 *   Signatures are drawn by the screen (signature.js) and hashed/decided by
 *   the server (requireSignature, :331-332) — this file only carries them.
 */

import { apiFetch } from '../../core/api.js?v=4.9.131';
import { formatInt } from './reports-repo.js?v=4.9.131';

const num = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
};

/** Server caps, copied from the SQL of the door itself (:147-150). */
export const KITCHEN_WINDOW = { batches: 100, exceptions: 100, distributions: 300 };

/** @returns {Promise<{locations:any[],batches:any[],exceptions:any[],policies:any[],distributions:any[]}>} */
export async function fetchKitchenOverview() {
    const res = await apiFetch('/kitchen/overview');
    const o = res && typeof res === 'object' ? res : {};
    const arr = (v) => (Array.isArray(v) ? v : []);
    return {
        locations: arr(o.locations),
        batches: arr(o.batches),
        exceptions: arr(o.exceptions),
        policies: arr(o.policies),
        distributions: arr(o.distributions),
    };
}

/**
 * Database row → table row. Pure and exported so it is testable
 * without a browser.
 */
export function batchToRow(b = {}) {
    const status = b.status ? String(b.status) : '';
    const stateKey = status === 'closed' ? 'closed'
        : status === 'cancelled' ? 'cancelled'
            : (status === 'draft' || status === 'open') ? 'open' : 'other';
    return {
        id: b.id,
        product: b.product_name ? String(b.product_name) : `#${b.id ?? '؟'}`,
        productResolved: !!b.product_name,
        unit: b.product_unit ? String(b.product_unit) : '',
        location: b.location_name ? String(b.location_name) : '—',
        locationResolved: !!b.location_name,
        planned: num(b.planned_qty),
        produced: num(b.produced_qty),
        remaining: num(b.remaining_qty),
        consumed: num(b.consumed_qty),
        distributed: num(b.distributed_qty),
        status,
        stateKey,
        notes: b.notes ? String(b.notes) : '',
        created: b.created_at ? String(b.created_at).slice(0, 10) : '',
        closed: b.closed_at ? String(b.closed_at).slice(0, 10) : '',
    };
}

/* كلمات الحالة وألوانها ليست هنا: السجل المشترك في status.js:117-119 يملكها
   (عناوينه منقولة حرفيًا من features/kitchen.js:168) والشاشة تقرأه. الذي
   يقرّره هذا الملف هو الحالة التي ينتمي إليها كل وضع مخزّن (stateKey). */

/** Legacy page's own words for operation_mode (features/kitchen.js:154). */
export const POLICY_MODE_AR = { flexible: 'مرن', monitor: 'مراقب', strict: 'صارم' };

export function exceptionToRow(e = {}) {
    return {
        id: e.id,
        order: e.order_id ? String(e.order_id) : '—',
        product: e.product_name ? String(e.product_name) : `#${e.product_id ?? '؟'}`,
        productResolved: !!e.product_name,
        qty: num(e.quantity),
        policy: e.operation_mode ? String(e.operation_mode) : '—',
        policyAr: POLICY_MODE_AR[String(e.operation_mode || '')] || String(e.operation_mode || '—'),
        reason: e.reason ? String(e.reason) : '—',
        dept: e.department_name ? String(e.department_name) : '—',
        created: e.created_at ? String(e.created_at).slice(0, 10) : '',
    };
}

/**
 * kitchen_policies row → row. The gate is per department and stored, so the
 * screen shows the three stored flags and labels nothing else.
 */
export function policyToRow(p = {}) {
    const mode = p.operation_mode ? String(p.operation_mode) : '';
    return {
        id: p.id,
        dept: p.department_name ? String(p.department_name) : `#${p.department_id ?? '؟'}`,
        deptResolved: !!p.department_name,
        mode,
        modeAr: POLICY_MODE_AR[mode] || mode || '—',
        modeKnown: !!POLICY_MODE_AR[mode],
        fallback: p.allow_fallback === true,
        requireReason: p.require_reason === true,
        location: p.kitchen_location_name ? String(p.kitchen_location_name) : '—',
    };
}

/**
 * kitchen_production_distributions row → row. destination_name is stored on
 * the row, so it is shown as written; the type key stays available for the
 * muted code line rather than being re-labelled into something new.
 */
export function distributionToRow(d = {}) {
    return {
        id: d.id,
        batch: d.batch_id,
        dest: d.destination_name ? String(d.destination_name) : '—',
        destType: d.destination_type ? String(d.destination_type) : '',
        code: d.destination_code ? String(d.destination_code) : '',
        product: d.product_name ? String(d.product_name) : `#${d.product_id ?? '؟'}`,
        productResolved: !!d.product_name,
        unit: d.product_unit ? String(d.product_unit) : '',
        qty: num(d.allocated_qty),
        created: d.created_at ? String(d.created_at).slice(0, 10) : '',
    };
}

/** Derived counts for the KPI band — never fetched, and only over the window.
 *  Inputs are THIS file's mapped rows (stateKey, mode, qty), not raw columns. */
export function summarizeKitchen(batches = [], exceptions = [], locations = [], policies = [], distributions = []) {
    const sum = (rows, key) => rows.reduce((a, r) => a + num(r[key]), 0);
    // Units are per row (the door COALESCEs each batch's own product_unit).
    // Summing kilograms with units would be arithmetic on two different
    // things, so a total is only lawful when the window shares one unit.
    const units = [...new Set(batches.map((b) => b.unit).filter(Boolean))];
    return {
        total: batches.length,
        open: batches.filter((b) => b.stateKey === 'open').length,
        closed: batches.filter((b) => b.stateKey === 'closed').length,
        cancelled: batches.filter((b) => b.stateKey === 'cancelled').length,
        other: batches.filter((b) => b.stateKey === 'other').length,
        needProduction: batches.filter((b) => b.stateKey === 'open' && num(b.remaining) > 0).length,
        planned: sum(batches, 'planned'),
        produced: sum(batches, 'produced'),
        remaining: sum(batches, 'remaining'),
        uniformUnit: units.length === 1 ? units[0] : '',
        exceptions: exceptions.length,
        locations: locations.length,
        policies: policies.length,
        strictPolicies: policies.filter((p) => p.mode === 'strict').length,
        distributions: distributions.length,
        distributed: sum(distributions, 'qty'),
    };
}

/**
 * The KPI band. Every hint names its own basis, because a bare count over a
 * capped window would otherwise be read as a lifetime figure. The quantity
 * card appears only when the loaded orders share one unit — otherwise the
 * count of orders still needing production takes its place.
 * Six cards, not seven: how many active locations exist describes the door,
 * not the kitchen's day, so the screen prints it in its scope line.
 */
export function buildKitchenKpis(s = {}) {
    const quantity = s.uniformUnit
        ? {
            id: 'produced', icon: 'package', label: 'الكمية المنتَجة', en: 'Produced',
            value: formatInt(s.produced || 0), unit: s.uniformUnit,
            hint: `مجموع النافذة بوحدة واحدة (${s.total ? 'كل الأوامر المحمّلة' : 'لا أوامر'})`,
        }
        : {
            id: 'need', icon: 'package', label: 'أوامر بانتظار الإنتاج', en: 'Awaiting Output',
            value: formatInt(s.needProduction || 0), unit: '',
            hint: 'متبقٍ أكبر من صفر في أمر مفتوح — الوحدات مختلفة فلا مجموع',
        };
    return [
        {
            id: 'open', icon: 'cooking-pot', label: 'أوامر مفتوحة', en: 'Open Batches',
            value: formatInt(s.open || 0), unit: '',
            hint: `من ${formatInt(s.total || 0)} أمرًا في النافذة`,
        },
        {
            id: 'closed', icon: 'circle-check', label: 'مغلقة — موزّعة', en: 'Closed',
            value: formatInt(s.closed || 0), unit: '',
            hint: `من ${formatInt(s.total || 0)} أمرًا في النافذة`,
        },
        {
            id: 'exceptions', icon: 'circle-alert', label: 'استثناءات مفتوحة', en: 'Open Exceptions',
            value: formatInt(s.exceptions || 0), unit: '',
            hint: 'باب الخادم يرسل المفتوح فقط',
        },
        quantity,
        s.uniformUnit
            ? {
                id: 'remaining', icon: 'scale', label: 'باقٍ للإنتاج', en: 'Remaining',
                value: formatInt(s.remaining || 0), unit: s.uniformUnit,
                hint: 'مخطط ناقص منتج داخل النافذة',
            }
            : {
                id: 'dist', icon: 'inbox', label: 'توزيعات النافذة', en: 'Distributions',
                value: formatInt(s.distributions || 0), unit: '',
                hint: `من أحدث ${formatInt(KITCHEN_WINDOW.distributions)} توزيعًا`,
            },
        {
            id: 'policies', icon: 'sliders', label: 'سياسات الأقسام', en: 'Policies',
            value: formatInt(s.policies || 0), unit: '',
            hint: `صارمة ${formatInt(s.strictPolicies || 0)}`,
        },
    ];
}

/**
 * Largest allocated quantities first — a ranking computed HERE over the
 * newest-300 window, so the caller must say which window it ranks. Server
 * order (recency) is kept for rows that tie.
 */
export function topDistributions(rows = [], limit = 6) {
    return rows
        .map((r, i) => ({ r, i }))
        .sort((a, b) => (b.r.qty - a.r.qty) || (a.i - b.i))
        .slice(0, limit)
        .map((x) => x.r);
}

/**
 * Honest cap disclosure. The door sends the newest N; when N arrive, older
 * rows exist and were never fetched. Returns '' when the window is not full.
 */
export function capNote(count = 0, cap = 0, what = '') {
    if (!cap || count < cap) {return '';}
    return `${what}: وصلت أقصى ما يرسله الخادم (${formatInt(cap)}) — قد يكون هناك أقدم خارج النافذة.`;
}

/* ═══════════════════════════════════════════════════════════════════════
   W1-2 — دورة المطبخ: أبواب الكتابة والمحوّلات النقية
   كل حمولة تُبنى هنا بدوال نقية مختبَرة (حالة داخلة → جسم خارج)، والنصوص
   منسوخة من features/kitchen.js سطرًا بسطر. الشاشة تجمع الحالة، وهذا الملف
   يبني الحمولة ويرسلها عبر الباب الواحد.
   ═══════════════════════════════════════════════════════════════════════ */

/** WRITE في الخادم حرفيًا (kitchen-production-routes.js:12). */
export const KITCHEN_WRITE_ROLES = ['admin', 'manager', 'warehouse', 'kitchen', 'sous_chef'];
/** اعتماد الجرد لدور الاعتماد وحدهم — requireRole في :332. */
export const KITCHEN_APPROVE_ROLES = ['admin', 'manager', 'auditor'];
/** كلمات الدورية في العنوان — features/kitchen.js:87 حرفيًا. */
export const AUDIT_PERIODS = { daily: 'يومي', weekly: 'أسبوعي', monthly: 'شهري', custom: 'مخصص', annual: 'سنوي' };
/** سقوف قارئي الحوكمة — SQL البابين (:328 LIMIT 50 · :327 LIMIT 100). */
export const GOVERNANCE_LIMITS = { audits: 50, documents: 100 };

/* ── أبواب قراءة إضافية ─────────────────────────────────────────────── */

/** أرصدة التحويل الاستثنائي — GET /kitchen/stock (:154) → {source,destination,items}. */
export async function fetchKitchenStock() {
    const res = await apiFetch('/kitchen/stock');
    const o = res && typeof res === 'object' ? res : {};
    return {
        source: o.source || null,
        destination: o.destination || null,
        items: Array.isArray(o.items) ? o.items : [],
    };
}

/** مكوّنات الإنتاج — GET /kitchen/production-materials (:160) → مصفوفة عارية. */
export async function fetchProductionMaterials() {
    const res = await apiFetch('/kitchen/production-materials');
    return Array.isArray(res) ? res : [];
}

/** جهات التوزيع — GET /kitchen/production-destinations (:161) → مصفوفة عارية. */
export async function fetchProductionDestinations() {
    const res = await apiFetch('/kitchen/production-destinations');
    return Array.isArray(res) ? res : [];
}

/** منتجات الكتالوج — GET /pos/products (shift-routes.js:238). باب اختياري:
 *  أدوار المخازن ليست في قائمته فيرد 403 — اللوحة تعمل بإدخال يدوي. */
export async function fetchProductionProducts() {
    const res = await apiFetch('/pos/products');
    return Array.isArray(res) ? res : [];
}

/** سجل الجرد — GET /kitchen/audits (:328) LIMIT 50. */
export async function fetchKitchenAudits() {
    const res = await apiFetch('/kitchen/audits');
    return Array.isArray(res) ? res : [];
}

/** مستندات المطبخ — GET /kitchen/documents (:327) LIMIT 100. */
export async function fetchKitchenDocuments() {
    const res = await apiFetch('/kitchen/documents');
    return Array.isArray(res) ? res : [];
}

/* ── أبواب الكتابة ───────────────────────────────────────────────────── */

/** أمر إنتاج — POST /kitchen/production (:247). */
export async function createProduction(body) {
    return apiFetch('/kitchen/production', { method: 'POST', body: JSON.stringify(body) });
}

/** استلام مواد (تحويل استثنائي رئيسي→مطبخ) — POST /kitchen/transfers/receive
 *  (:155). بلا reference عمدًا — حارس التكرار الخادمي (:156) يعمل بغيابه فقط. */
export async function receiveKitchenTransfer(body) {
    return apiFetch('/kitchen/transfers/receive', { method: 'POST', body: JSON.stringify(body) });
}

/** إنشاء جلسة جرد — POST /kitchen/audits (:329). */
export async function createKitchenAudit(body) {
    return apiFetch('/kitchen/audits', { method: 'POST', body: JSON.stringify(body) });
}

/** حفظ العدّ — POST /kitchen/audits/:id/count (:330). */
export async function countKitchenAudit(id, body) {
    return apiFetch(`/kitchen/audits/${encodeURIComponent(id)}/count`, { method: 'POST', body: JSON.stringify(body) });
}

/** إرسال الجرد بتوقيع — POST /kitchen/audits/:id/submit (:331). */
export async function submitKitchenAudit(id, body) {
    return apiFetch(`/kitchen/audits/${encodeURIComponent(id)}/submit`, { method: 'POST', body: JSON.stringify(body) });
}

/** اعتماد الجرد بتوقيع — POST /kitchen/audits/:id/approve (:332). */
export async function approveKitchenAudit(id, body) {
    return apiFetch(`/kitchen/audits/${encodeURIComponent(id)}/approve`, { method: 'POST', body: JSON.stringify(body) });
}

/* ── المحوّلات النقية — الحالة الداخلة → حمولة الخادم ─────────────────── */

/** مرآة fN في core/utils.js:24 — رسائل النجاح تُطبع بها كما يطبعها القديم.
 *  (حارس Number.isFinite إضافة V2: القديم كان يطبع «NaN» لو وصلت قيمة فاسدة.) */
export function legacyQty(v) {
    const n = parseFloat(v || 0);
    if (!Number.isFinite(n)) {return '0';}
    return n.toLocaleString('en-US', { minimumFractionDigits: n % 1 !== 0 ? 2 : 0, maximumFractionDigits: 2 });
}

/** صفوف المكونات → حمولة الخادم — مرآة features/kitchen.js:70 حرفيًا.
 *  صف فاسد يُسقط الشرط materials.length === rows.length في التحقق. */
export function materialPayload(rows = []) {
    return (Array.isArray(rows) ? rows : [])
        .map((row) => ({
            inventory_id: Number(row.inventory_id),
            quantity: Number(row.quantity || 0),
            waste_percent: Number(row.waste_percent || 0),
        }))
        .filter((x) => x.inventory_id && x.quantity > 0);
}

/** صفوف التوزيع → حمولة الخادم — مرآة features/kitchen.js:74 حرفيًا.
 *  قيمة قديمة اسمها channel|custom| تمرّ كما وصلت — المحوّل لا يُصلح بيانات. */
export function distributionPayload(rows = []) {
    return (Array.isArray(rows) ? rows : [])
        .map((row) => {
            const p = String(row.destination || '').split('|');
            return {
                destination_type: p[0],
                destination_code: p[1],
                destination_name: p[0] === 'custom' ? (row.customName || '') : p[2],
                department_id: p[0] === 'department' ? Number(p[1]) : null,
                quantity: Number(row.quantity || 0),
            };
        })
        .filter((x) => x.quantity > 0);
}

/** حقول النموذج → حمولة أمر الإنتاج — مرآة features/kitchen.js:77 حرفيًا. */
export function productionPayload(form = {}) {
    const productId = form.productId ? Number(form.productId) : null;
    return {
        product_id: Number.isFinite(productId) ? productId : null,
        product_name: String(form.productName || '').trim(),
        product_unit: String(form.productUnit || '').trim() || 'وحدة',
        produced_qty: Number(form.producedQty || 0),
        notes: String(form.notes || '').trim() || null,
        materials: materialPayload(form.materials),
        distributions: distributionPayload(form.distributions),
    };
}

/** تحقّق أمر الإنتاج — الرسائل والترتيب منسوخان من features/kitchen.js:69-76.
 *  يعيد '' حين يمر، وإلا نص الرسالة نفسه الذي يطبعه القديم.
 *  انحراف مقصود: كمية غير رقمية تُمسك برسالة الحقل الأولى نفسها بدل إرسال NaN. */
export function validateProductionForm(form = {}) {
    const name = String(form.productName || '').trim();
    const productId = form.productId ? Number(form.productId) : null;
    const qty = Number(form.producedQty || 0);
    if (!Number.isFinite(qty)) {return 'اكتب اسم المنتج النهائي والكمية المنتجة';}
    if ((!productId && !name) || qty <= 0) {return 'اكتب اسم المنتج النهائي والكمية المنتجة';}
    const rows = Array.isArray(form.materials) ? form.materials : [];
    const materials = materialPayload(rows);
    if (!materials.length || materials.length !== rows.length) {return 'أضف كل مكونات أمر الإنتاج وحدد كمياتها';}
    if (new Set(materials.map((x) => x.inventory_id)).size !== materials.length) {return 'لا تكرر نفس المكون؛ اجمع كميته في سطر واحد';}
    if (materials.some((x) => x.waste_percent < 0 || x.waste_percent > 100)) {return 'نسبة الهالك يجب أن تكون بين 0 و100%';}
    const distributions = distributionPayload(form.distributions);
    const allocated = distributions.reduce((s, x) => s + x.quantity, 0);
    if (!distributions.length || Math.abs(allocated - qty) > 0.0001) {
        return `يجب أن يساوي مجموع التوزيع ${legacyQty(allocated)} إجمالي الإنتاج ${legacyQty(qty)}`;
    }
    if (distributions.some((x) => x.destination_type === 'custom' && !x.destination_name)) {return 'اكتب اسم الجهة المخصصة';}
    return '';
}

/** حمولة استلام المواد — مرآة features/kitchen.js:122-124 خلا `reference`:
 *  نفس قيد الترشيح (رقم صحيح موجب وكمية موجبة)، والمواقع من رصيد اللوحة.
 *  بلا صف صالح يعيد null — الشاشة تطبع 'اختر صنفًا وأدخل كمية صحيحة'. */
export function transferPayload(stock = {}, rows = [], notes = '') {
    const items = (Array.isArray(rows) ? rows : [])
        .map((row) => ({ inventory_id: Number(row.inventory_id), qty: Number(row.qty) }))
        .filter((row) => Number.isInteger(row.inventory_id) && row.inventory_id > 0 && row.qty > 0);
    if (!items.length) {return null;}
    return {
        source_location_id: stock.source ? stock.source.id : null,
        destination_location_id: stock.destination ? stock.destination.id : null,
        notes: String(notes || '').trim(),
        items,
    };
}

/** تحقّق فترة الجرد — نفس قاعدة الخادم (:329) حرفيًا: صيغة YYYY-MM-DD
 *  للتاريخين والنهاية لا تسبق البداية، ورسالة الخادم نفسها. */
export function validateAuditPeriod(periodStart, periodEnd) {
    const s = String(periodStart || '').slice(0, 10);
    const e = String(periodEnd || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || !/^\d{4}-\d{2}-\d{2}$/.test(e) || e < s) {return 'فترة الجرد غير صحيحة';}
    return '';
}

/** حقول نموذج الجرد → حمولة الإنشاء — مرآة features/kitchen.js:83، وقائمة
 *  الدورية تُفرض بقاعدة الخادم نفسها (:329): قيمة غريبة تصبح weekly. */
export function auditPayload(form = {}) {
    const period = ['daily', 'weekly', 'monthly', 'custom', 'annual'].includes(String(form.period)) ? String(form.period) : 'weekly';
    const periodStart = String(form.periodStart || '').slice(0, 10);
    return {
        period,
        period_start: periodStart,
        period_end: String(form.periodEnd || periodStart).slice(0, 10),
        notes: String(form.notes || ''),
    };
}

/** حمولة العدّ — مرآة features/kitchen.js:93/:94: كل صنف بـ id رقمي وقيمة
 *  خانته الحية، وNumber(value||0) حرفيًا: خانة مُفرغة تعني صفرًا كما عند
 *  القديم، فالغائب والفراغ يساويان 0. */
export function countPayload(items = [], values = {}) {
    return (Array.isArray(items) ? items : []).map((x) => ({
        id: Number(x.id),
        counted_qty: Number(values[x.id] || 0),
    }));
}

/** حركة التوزيع داخل الفترة — مرآة مرشّح features/kitchen.js:89:
 *  اليوم يُقارن بالبداية والنهاية معًا، وغياب أحدهما لا يرشّح شيئًا.
 *  المدخل صفوف هذه الوحدة (حقل created). */
export function distributionsInRange(rows = [], start = '', end = '') {
    const s = String(start || '').slice(0, 10);
    const e = String(end || '').slice(0, 10);
    return (Array.isArray(rows) ? rows : []).filter((x) => {
        const day = String(x.created || '').slice(0, 10);
        return (!s || day >= s) && (!e || day <= e);
    });
}

/** صف سجل الجرد → صف الجدول. الحالة تُمرَّر كما وردت (الشاشة تعرضها من
 *  السجل المشترك kitchen_audit). */
export function auditToRow(a = {}) {
    const start = a.period_start ? String(a.period_start).slice(0, 10) : '';
    const end = a.period_end ? String(a.period_end).slice(0, 10) : '';
    return {
        id: a.id,
        number: a.audit_number ? String(a.audit_number) : `#${a.id ?? '؟'}`,
        period: a.period ? String(a.period) : '',
        periodAr: AUDIT_PERIODS[String(a.period || '')] || String(a.period || '—'),
        periodKnown: !!AUDIT_PERIODS[String(a.period || '')],
        start,
        end,
        range: start ? `${start} → ${end || start}` : '',
        totalItems: num(a.total_items),
        status: a.status ? String(a.status) : '',
        totalVarianceValue: num(a.total_variance_value),
        by: a.created_by_name ? String(a.created_by_name) : '',
        items: (Array.isArray(a.items) ? a.items : []).map(auditItemToRow),
    };
}

/** صنف جرد → صف. الفرق محسوب هنا (counted − system) لأن الخادم يخزنه
 *  فقط بعد حفظ العدّ. */
export function auditItemToRow(x = {}) {
    const system = num(x.system_qty);
    const counted = num(x.counted_qty);
    return {
        id: x.id,
        inventoryId: x.inventory_id,
        name: x.item_name ? String(x.item_name) : `#${x.inventory_id ?? '؟'}`,
        nameResolved: !!x.item_name,
        unit: x.unit ? String(x.unit) : '',
        system,
        counted,
        variance: counted - system,
        avgCost: num(x.avg_cost),
    };
}

/** صف مستند المطبخ → صف الجدول. الأصناف تُدمج بصيغة القديم (:97) حرفيًا:
 *  «name (legacyQty(received_qty || requested_qty))» يفصلها «، ». */
export function documentToRow(d = {}) {
    return {
        id: d.id,
        from: d.source_name ? String(d.source_name) : '—',
        to: d.destination_name ? String(d.destination_name) : '—',
        date: d.created_at ? String(d.created_at).slice(0, 10) : '',
        itemsText: Array.isArray(d.items)
            ? d.items.map((i) => `${String(i.item_name || '—')} (${legacyQty(i.received_qty || i.requested_qty)})`).join('، ')
            : '—',
    };
}
