const express = require('express');
const crypto = require('crypto');
const { pool } = require('./shared-pool');
const { riyadhToday } = require('./riyadh-date'); // M20
const { jwtAuth, requireRole } = require('./cashier-module/jwt-middleware');
const { logger } = require('./logger');
const { postInventoryLedgerEntry } = require('./inventory-ledger');
const { computeInvoicePaymentStatus } = require('./procurement-routes');
const { computeInvoiceVat, loadStandardRate } = require('./tax-rule-service');
const { emitDomainEvent } = require('./realtime/producers');
const { ensureDispatchCreatorSchema, notifyChainEvent } = require('./dispatch-notifier');
// سياسة تاريخ الصلاحية: اختياري، ويُرفض فقط إن جاء بصيغة فاسدة (2026-10-20)
const { normalizeExpiryDate, readExpiryField, checkExpiryOnLines, latestExpiryFor } = require('./expiry-policy');

const router = express.Router();
const WRITE_ROLES = ['admin', 'manager', 'warehouse'];
// المرتجع يُنشئه المطبخ/القسم فعليًا ويستلمه المخزن — نفس خريطة schema-registry
const RETURN_ROLES = ['admin', 'manager', 'warehouse', 'kitchen', 'sous_chef', 'dept_head'];
const APPROVAL_ROLES = WRITE_ROLES;
const RECEIVE_ROLES = ['admin', 'manager', 'warehouse', 'kitchen', 'sous_chef', 'dept_head'];
// Task 19: الشيف العمومي (دور kitchen) يعتمد طلبات رؤساء الأقسام قبل وصولها للمخازن
const CHEF_APPROVAL_ROLES = ['admin', 'manager', 'kitchen', 'sous_chef'];

// ─── حارس العملية اللحظية على إذن واحد ─────────────────────────────────────
// القياس (لوج الإنتاج 2026-10-13): 88 طلب اعتماد لنفس الإذن خلال دقيقتين لأن
// الواجهة لا تعطي رد فعل أثناء التنفيذ — كل طلب يصطف خلف قفل الصف FOR UPDATE
// حتى 20 ثانية، فتتجمد المعاملات المخزنية كلها. الرفض الفوري يحمي الخصم من
// الازدواج ويظهر للمستخدم سببًا واضحًا بدل التعليق.
const _dispatchOpInFlight = new Set();
function beginDispatchOp(id, kind) {
    const key = `${kind}:${id}`;
    if (_dispatchOpInFlight.has(key)) {return false;}
    _dispatchOpInFlight.add(key);
    return true;
}
function endDispatchOp(id, kind) { _dispatchOpInFlight.delete(`${kind}:${id}`); }

// خريطة الربط المعياري بين أكواد أقسام التشغيل/المخزن وأكواد الموارد البشرية
// لتوحيد الربط ومنع أخطاء عدم تطابق الأقسام عند إنشاء أو استلام طلبات الصرف
const DEPT_CODE_ALIASES = Object.freeze({
    'shop': 'CAF',               // الكوفي شوب (HR) = كافيهshop / الكافيه (مخزن/تشغيل)
    'caf': 'CAF',
    'ca1': 'NAS',                // كافيه ناصر الدور الرابع (HR) = كافيه ناصر (مخزن/تشغيل)
    'nas': 'NAS',
    'juice': 'G',                // العصير (HR) = العصير (مخزن/تشغيل)
    'g': 'G',
    'service': 'hot_hall',        // الصاله (HR) = الصالة (مخزن/تشغيل)
    'hot_hall': 'hot_hall',
    'kitchen': 'kitchen',        // المطبخ
    'storeroom': 'storeroom',    // الاستيورد
    'external_sales': 'external_sales', // البيع الخارجي
    'salads': 'salads',
    'sweets': 'sweets',
    'bakery': 'bakery',
    'hot_kitchen': 'hot_kitchen',
    'butcher': 'butcher',
    'fnb': 'fnb',
    'open_buffet': 'open_buffet',
    'kstore': 'kstore',
});

function canonicalDeptCode(code) {
    if (!code) {return '';}
    const clean = String(code).trim().toLowerCase();
    return DEPT_CODE_ALIASES[clean] || String(code).trim();
}

function deptsMatch(codeA, codeB) {
    if (!codeA || !codeB) {return false;}
    const cleanA = String(codeA).trim().toLowerCase();
    const cleanB = String(codeB).trim().toLowerCase();
    if (cleanA === cleanB) {return true;}
    const canA = canonicalDeptCode(cleanA).toLowerCase();
    const canB = canonicalDeptCode(cleanB).toLowerCase();
    return canA === canB || cleanA === canB || cleanB === canA;
}

// ═══ بوابة استلام رئيس القسم: يستلم إذن قسمه هو فقط ═══
function canReceiveDispatch(user, dispatch) {
    if (!user || !dispatch) {return { ok: false, code: 'INVALID_INPUT' };}
    if (user.role === 'dept_head') {
        const rawList = String(user.dept_code || '').split(',').map((s) => s.trim()).filter(Boolean);
        const d = String(dispatch.deptCode || '').trim();
        if (!rawList.length) {return { ok: false, code: 'DEPT_HEAD_WITHOUT_DEPARTMENT' };}
        const matches = rawList.some((c) => deptsMatch(c, d));
        if (!matches) {return { ok: false, code: 'DEPT_MISMATCH' };}
    }
    return { ok: true };
}

// ═══ Task 19: سلسلة اعتماد طلبات الصرف ═══
// رئيس القسم (dept_head) ينشئ الطلب (needsChefApproval=true) → الشيف العمومي يعتمده
// (status=chef_approved) → المخازن تعتمد وتخصم (status=approved) → القسم يستلم.
const DEPT_STORES = Object.freeze({
    salads:         { code: 'STORE-SALADS',      name: 'مخزن قسم السلطات' },
    sweets:         { code: 'STORE-SWEETS',      name: 'مخزن الحلواني' },
    bakery:         { code: 'STORE-BAKERY',      name: 'مخزن الخباز' },
    hot_kitchen:    { code: 'STORE-HOT-KITCHEN', name: 'مخزن المطبخ الساخن' },
    external_sales: { code: 'STORE-EXTERNAL',    name: 'مخزن البيع الخارجي' },
});

/**
 * نقية: متجر القسم الخاص بحسب كود القسم (null إن لم يوجد مخزن مخصص).
 * kitchen و open_buffet يكملان إلى KITCHEN-MAIN كما في السلوك القديم.
 */
function resolveDispatchTargetStore(deptCode) {
    const key = String(deptCode || '').trim().toLowerCase();
    return DEPT_STORES[key] || null;
}

/**
 * نقية: هل يمكن للمخازن اعتماد هذا الإذن وخصم المخزون؟
 * يحدد أخطاء السلسلة: طلب رئيس قسم يجب أن يمر بالشيف العمومي أولًا،
 * ولا يجوز الاعتماد المزدوج لإذن معتمد/مرفوض/مستلم سلفًا.
 */
function canWarehouseApprove(dispatch) {
    if (!dispatch) {return { ok: false, code: 'DISPATCH_NOT_FOUND' };}
    if (dispatch.needsChefApproval && dispatch.status === 'pending') {
        return { ok: false, code: 'CHEF_APPROVAL_REQUIRED' };
    }
    const allowed = dispatch.needsChefApproval ? ['chef_approved'] : ['pending'];
    if (!allowed.includes(dispatch.status)) {
        if (dispatch.status === 'approved') {return { ok: false, code: 'DISPATCH_ALREADY_APPROVED' };}
        if (dispatch.status === 'rejected') {return { ok: false, code: 'DISPATCH_REJECTED' };}
        if (['received', 'partially_received'].includes(dispatch.status)) {return { ok: false, code: 'DISPATCH_ALREADY_RECEIVED' };}
        return { ok: false, code: 'DISPATCH_INVALID_STATUS' };
    }
    return { ok: true };
}

/**
 * نقية: هل يستطيع الشيف العمومي تداول هذا الإذن (اعتماد/رفض)؟
 */
function canChefDecide(dispatch) {
    if (!dispatch) {return { ok: false, code: 'DISPATCH_NOT_FOUND' };}
    if (!dispatch.needsChefApproval) {return { ok: false, code: 'CHEF_APPROVAL_NOT_REQUIRED' };}
    if (dispatch.status !== 'pending') {return { ok: false, code: 'DISPATCH_NOT_PENDING' };}
    return { ok: true };
}

/**
 * نقية: صلاحية رئيس قسم إنشاء طلب — يُجبر على قسمه فقط.
 * المقارنة غير حساسة لحالة الأحرف، والكود المعاد هو الكود المخزّن على الحساب (المرجع).
 */
function resolveDeptHeadDispatch(user, requestedDeptCode) {
    const rawList = String(user?.dept_code || '').split(',').map((s) => s.trim()).filter(Boolean);
    if (!rawList.length) {return { ok: false, code: 'DEPT_HEAD_WITHOUT_DEPARTMENT' };}
    const requested = String(requestedDeptCode || '').trim();
    if (requested) {
        const match = rawList.find((c) => deptsMatch(c, requested));
        if (!match) {return { ok: false, code: 'DEPT_MISMATCH' };}
        return { ok: true, deptCode: match };
    }
    return { ok: true, deptCode: rawList[0] };
}

/**
 * تدقيق أمني جولة 2: حرس حذف إذن الصرف — المستندات المالية الموقّعة
 * (معتمد/مرفوض/مستلم/بانتظار الشيف) لا تُمحى عبر CRUD العام؛ حذفها يقطع
 * السلسلة المالية (مصروفات مرحّلة + حركات دفتر + أحداث موقّعة بسلسلة hash).
 * فقط الطلب المعلّق (pending) الذي لم تحسمه أي جهة يجوز إلغاؤه بحذفه.
 */
function canDeleteDispatch(dispatch) {
    if (!dispatch) {return { ok: false, code: 'DISPATCH_NOT_FOUND' };}
    if (dispatch.status === 'pending') {return { ok: true };}
    if (dispatch.status === 'approved') {return { ok: false, code: 'DISPATCH_ALREADY_APPROVED' };}
    if (dispatch.status === 'rejected') {return { ok: false, code: 'DISPATCH_REJECTED' };}
    if (['received', 'partially_received'].includes(dispatch.status)) {return { ok: false, code: 'DISPATCH_ALREADY_RECEIVED' };}
    if (dispatch.status === 'chef_approved') {return { ok: false, code: 'DISPATCH_CHEF_DECIDED' };}
    return { ok: false, code: 'DISPATCH_INVALID_STATUS' };
}

// ═══ Task 28: لوحة رئيس القسم (dept-panel) — بوابات وتجميعات نقية ═══
// المحاسب (accountant) يرى اللوحات للقراءة — تكاليف الأقسام من صميم عمله.
const DEPT_PANEL_ROLES = ['admin', 'manager', 'dept_head', 'kitchen', 'sous_chef', 'accountant'];
const EXPENSE_SOURCE_LABELS = Object.freeze({
    dispatch: 'صرف مخزني',
    dispatch_return: 'عكس صرف (مرتجع)',
    purchase_direct: 'مشتريات مباشرة للقسم',
    stocktaking: 'فروق جرد',
    auto_other: 'تلقائي آخر',
    manual: 'يدوي',
});

/**
 * نقية: بوابة الوصول للوحة القسم — هوية + دور معًا.
 * dept_head بلا dept_code مقيّد لا يرى شيئًا (لا فرض قسم افتراضي).
 */
function canAccessDeptPanel(user) {
    if (!user || user.id === undefined || user.id === null) {return { ok: false, code: 'IDENTITY_REQUIRED' };}
    if (!DEPT_PANEL_ROLES.includes(user.role)) {return { ok: false, code: 'ROLE_NOT_ALLOWED' };}
    if (user.role === 'dept_head' && !String(user.dept_code || '').trim()) {return { ok: false, code: 'DEPT_HEAD_WITHOUT_DEPARTMENT' };}
    return { ok: true };
}

/**
 * نقية: نطاق اللوحة — رئيس القسم محبوس في قسمه حصرًا، والشيف العمومي
 * (kitchen) يرى المطبخ وأقسامه الفرعية ويمكنه التركيز على قسم فرعي،
 * وadmin/manager يرون أي قسم يطلبونه.
 */
function resolvePanelDept(user, requestedDeptCode) {
    const role = String(user?.role || '');
    const requested = String(requestedDeptCode || '').trim();
    if (role === 'dept_head') {
        const ownRaw = String(user?.dept_code || '').split(',').map((x) => x.trim()).filter(Boolean);
        if (!ownRaw.length) {return { ok: false, code: 'DEPT_HEAD_WITHOUT_DEPARTMENT' };}
        const match = requested ? ownRaw.find((c) => deptsMatch(c, requested)) : null;
        if (requested && !match) {return { ok: false, code: 'DEPT_MISMATCH' };}
        return { ok: true, deptCode: match || ownRaw[0] };
    }
    if (role === 'kitchen' || role === 'sous_chef') {return { ok: true, deptCode: requested || 'kitchen' };}
    return { ok: true, deptCode: requested || null };
}

/**
 * نقية: تصنيف مصدر المصروف — من مفردات النظام الفعلية:
 * dispatch (صرف مخزني) / dispatch_return (عكس الصرف) / count_correction (فروق الجرد)
 * / تلقائي آخر / يدوي.
 */
function classifyExpenseSource(expense) {
    if (!expense) {return 'manual';}
    const type = String(expense.adjustmentType || '').trim().toLowerCase();
    const auto = expense.autoGenerated === true || expense.autoGenerated === 'true';
    if (type === 'dispatch') {return 'dispatch';}
    if (type === 'dispatch_return') {return 'dispatch_return';}
    if (type === 'purchase_direct') {return 'purchase_direct';}
    if (type === 'count_correction') {return 'stocktaking';}
    if (auto || (type && type !== 'manual')) {return 'auto_other';}
    return 'manual';
}

/**
 * نقية: تجميع مصروفات اللوحة — المبالغ غير الرقمية تُتخطى بلا حسابها صفرًا
 * (كان تحويلها لصفر يفسد الإجماليات)، والتقريب لثلاث خانات كما في بقية النظام.
 */
function aggregatePanelExpenses(rows) {
    const items = Array.isArray(rows) ? rows : [];
    const bySource = {};
    const monthly = {};
    let total = 0;
    let count = 0;
    let skippedInvalid = 0;
    for (const raw of items) {
        const rawAmount = raw?.amount;
        // null/undefined/سلسلة فارغة ليست مبالغًا — تُتخطى لا تُحسب صفرًا
        if (rawAmount === null || rawAmount === undefined || rawAmount === '' || !Number.isFinite(Number(rawAmount))) { skippedInvalid++; continue; }
        const amount = Number(rawAmount);
        const source = classifyExpenseSource(raw);
        const month = String(raw?.date || '').slice(0, 7) || 'unknown';
        total += amount;
        count++;
        if (!bySource[source]) {bySource[source] = { count: 0, total: 0 };}
        bySource[source].count++;
        bySource[source].total = round(bySource[source].total + amount);
        monthly[month] = round((monthly[month] || 0) + amount);
    }
    return { total: round(total), count, skippedInvalid, bySource, monthly, labels: EXPENSE_SOURCE_LABELS };
}

function id() {
    return Date.now() + Math.floor(Math.random() * 9999);
}
// مفتاح مطابقة أسماء الأصناف: بلا مسافات + توحيد الهمزات/التاء المربوطة/الألف المقصورة —
// يمنع فئة كاملة من الأخطاء: تكرار الأصناف أو فشل المطابقة باختلافات شكلية في الاسم
// (بلاغ المالك 2026-10-06: «سستم حديد» — بعد ظهور 12 صنفًا مكررًا بمسافات زايدة)
function normItemName(value) {
    return String(value || '').toLowerCase()
        .replace(/[\s\u00a0\t]/g, '')
        .replace(/[أإآ]/g, 'ا')
        .replace(/ة/g, 'ه')
        .replace(/ى/g, 'ي');
}
function n(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}
function round(value, decimals = 3) {
    const factor = 10 ** decimals;
    return Math.round(n(value) * factor) / factor;
}
function allocatePurchaseDiscount(items, type, value) {
    const subtotal = round(items.reduce((sum, item) => sum + item.qty * item.price, 0), 2);
    if (!['none', 'amount', 'percent'].includes(type) || !Number.isFinite(value) || value < 0 ||
        (type === 'percent' && value > 100) || (type === 'amount' && value > subtotal) ||
        (type === 'none' && value !== 0)) {
        throw Object.assign(new Error('قيمة الخصم غير صحيحة أو أكبر من قيمة الأصناف'), { code: 'INVALID_INVOICE_DISCOUNT' });
    }
    const discountAmount = round(type === 'percent'
        ? subtotal * value / 100
        : type === 'amount' ? value : 0, 2);
    let allocated = 0;
    const discountedItems = items.map((item, index) => {
        const grossTotal = round(item.qty * item.price, 2);
        const lineDiscount = index === items.length - 1
            ? round(discountAmount - allocated, 2)
            : (subtotal > 0 ? round(discountAmount * grossTotal / subtotal, 2) : 0);
        allocated = round(allocated + lineDiscount, 2);
        const total = round(grossTotal - lineDiscount, 2);
        return { ...item, grossTotal, discountAmount: lineDiscount, total,
            effectivePrice: item.qty > 0 ? round(total / item.qty, 4) : item.price };
    });
    return { subtotal, discountAmount, items: discountedItems };
}
function dateOnly(value) {
    if (value instanceof Date) {return value.toISOString().slice(0, 10);}
    const raw = String(value || '').trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(raw)) {return raw.slice(0, 10);}
    const parsed = raw ? new Date(raw) : new Date();
    return Number.isNaN(parsed.getTime()) ? riyadhToday() : parsed.toISOString().slice(0, 10);
}
function cleanName(value) {
    return String(value || '').trim();
}
function json(value) {
    return JSON.stringify(value ?? null);
}
function emit(req, entity, action, data) {
    if (!req.io) {return;}
    req.io.emit('entity_changed', {
        entity,
        entityName: entity,
        action,
        data,
        changedBy: req.headers['x-device-name'] || req.ip,
        changedAt: new Date().toISOString(),
    });
}
function fail(res, status, error, message, extra = {}) {
    return res.status(status).json({ error, message, ...extra });
}
function normalizeSignature(value) {
    const signature = String(value || '').trim();
    if (!signature || signature.length > 250000 || !/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(signature)) {return null;}
    return signature;
}
function signatureHash(signature) {
    return signature ? crypto.createHash('sha256').update(signature).digest('hex') : null;
}
// ═══ توقيع صاحب الحساب فقط: اسم الموقّع يجب أن يطابق اسم الدخول ═══
// يمنع توقيع اسم آخر نيابة عن شخص ثانٍ — الفرونت يرسل signerName والخادم يطابقه
// مع req.user (name ثم username) بعد التطبيع (تقليم + دمج المسافات + غير حساس لحالة الأحرف).
function normalizeSignerName(value) {
    return String(value || '').trim().replace(/\s+/g, ' ');
}
function signerMatchesAccount(provided, user) {
    const p = normalizeSignerName(provided).toLowerCase();
    const candidates = [user?.name, user?.username]
        .map(v => normalizeSignerName(v).toLowerCase())
        .filter(Boolean);
    return candidates.includes(p);
}
function accountDisplayName(user) {
    return normalizeSignerName(user?.name || user?.username || '');
}
async function appendDispatchEvent(client, dispatchId, eventType, fromStatus, toStatus, req, signature, payload = {}) {
    const previous = (await client.query('SELECT event_hash FROM dispatch_workflow_events WHERE dispatch_id=$1 ORDER BY id DESC LIMIT 1', [dispatchId])).rows[0]?.event_hash || null;
    const actorName = req.user?.name || req.user?.username || String(req.user?.id || 'unknown');
    const actorRole = req.user?.role || 'unknown';
    const eventPayload = payload || {};
    const canonical = JSON.stringify({ dispatchId, eventType, fromStatus, toStatus, actorUserId: req.user?.id || null, actorName, actorRole, signatureHash: signatureHash(signature), eventPayload, previous });
    const eventHash = crypto.createHash('sha256').update(canonical).digest('hex');
    const row = (await client.query(`INSERT INTO dispatch_workflow_events(dispatch_id,event_type,from_status,to_status,actor_user_id,actor_name,actor_role,signature_hash,event_payload,previous_event_hash,event_hash)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`, [dispatchId, eventType, fromStatus || null, toStatus, req.user?.id || null, actorName, actorRole, signatureHash(signature), json(eventPayload), previous, eventHash])).rows[0];
    await client.query('UPDATE dispatches SET "lastEventHash"=$1 WHERE id=$2', [eventHash, dispatchId]);
    return row;
}
function requireSignature(req, res) {
    const signature = normalizeSignature(req.body?.signatureData);
    if (!signature) {
        fail(res, 422, 'SIGNATURE_REQUIRED', 'التوقيع الإلكتروني مطلوب قبل اعتماد أو استلام أو رفض المستند');
        return null;
    }
    // صاحب الحساب فقط يوقّع باسمه — لا يجوز توقيع أي اسم آخر
    const signerName = req.body?.signerName ?? req.body?.signatureName ?? req.body?.signer;
    if (!normalizeSignerName(signerName)) {
        fail(res, 422, 'SIGNER_NAME_REQUIRED', 'اسم الموقّع مطلوب ويجب أن يطابق اسم صاحب الحساب المسجل دخوله');
        return null;
    }
    if (!signerMatchesAccount(signerName, req.user)) {
        fail(res, 403, 'SIGNER_MISMATCH', `التوقيع باسم صاحب الحساب فقط — لا يجوز توقيع اسم آخر (الحساب: ${accountDisplayName(req.user) || 'غير معروف'})`);
        return null;
    }
    return signature;
}

function normalizeRequestedItems(items) {
    const grouped = new Map();
    for (const raw of Array.isArray(items) ? items : []) {
        const itemName = cleanName(raw.itemName || raw.name);
        const qty = n(raw.approvedQty ?? raw.qty);
        if (!itemName || qty <= 0) {continue;}
        // Catch Weight: الحفاظ على الوزن الفعلي وعدد التعبئة عبر التجميع (كان يُسقطها فيُخصم qty ويضيع الميزان)
        const actualWeight = raw.actualWeight !== undefined && raw.actualWeight !== null && raw.actualWeight !== '' ? n(raw.actualWeight) : null;
        const packagingQty = raw.packagingQty !== undefined && raw.packagingQty !== null && raw.packagingQty !== '' ? n(raw.packagingQty) : null;
        const key = itemName.toLowerCase();
        const current = grouped.get(key) || {
            itemName,
            qty: 0,
            unit: raw.unit || 'وحدة',
            itemId: Number(raw.itemId || raw.item_id) || null,
            avgCost: n(raw.avgCost, 0),
            actualWeight: 0,
            hasActualWeight: false,
            packagingQty: 0,
            hasPackagingQty: false,
            packagingUom: raw.packagingUom || null,
            // وحدة الطلب الأصلية كما كتبها القسم (شكارة/كرتون...) — للعرض فقط،
            // الكمية qty دائمًا بوحدة المخزن الأساسية بعد التحويل
            requestedUom: raw.requestedUom || null,
            requestedQty: (raw.requestedQty !== undefined && raw.requestedQty !== null && raw.requestedQty !== '') ? n(raw.requestedQty) : null,
        };
        current.qty += qty;
        if (actualWeight !== null && Number.isFinite(actualWeight) && actualWeight > 0) { current.actualWeight += actualWeight; current.hasActualWeight = true; }
        if (packagingQty !== null && Number.isFinite(packagingQty) && packagingQty > 0) { current.packagingQty += packagingQty; current.hasPackagingQty = true; }
        if (!current.packagingUom && raw.packagingUom) {current.packagingUom = raw.packagingUom;}
        if (!current.requestedUom && raw.requestedUom) {current.requestedUom = raw.requestedUom;}
        if (current.requestedQty == null && raw.requestedQty != null) {current.requestedQty = n(raw.requestedQty);}
        if (!current.itemId && (raw.itemId || raw.item_id)) {current.itemId = Number(raw.itemId || raw.item_id) || null;}
        if (!current.avgCost && raw.avgCost != null) {current.avgCost = n(raw.avgCost, 0);}
        grouped.set(key, current);
    }
    return [...grouped.values()].map(item => ({
        ...item,
        qty: round(item.qty),
        actualWeight: item.hasActualWeight ? round(item.actualWeight, 3) : null,
        packagingQty: item.hasPackagingQty ? round(item.packagingQty, 3) : null,
    }));
}

// ─── طلب المالك 2026-10-05: «لا يقبل أي إذن صرف ليس له رصيد في المخزن نهائيًا» ───
// بوابة رصيد موحّدة تُفرض في كل نقاط قبول إذن الصرف (الإنشاء + اعتماد الشيف + التعديل)
// — القاعدة (طلب المالك 2026-10-06): المتاح لإذن الصرف = رصيد المخزن الرئيسي فقط،
// لأن الصرف يخصم من الرئيسي؛ ما وصل لمخازن الأقسام ملك لها ولا يُعاد صرفه.
// أصناف الوزن المتغير تُوزن فعليًا على الميزان لحظة الصرف — يكفي أن يكون لها رصيد بالرئيسي.
async function dispatchStockGate(db, items) {
    let normalized = Array.isArray(items) ? items : [];
    if (!Array.isArray(items) && items != null) {
        try { const parsed = JSON.parse(items); if (Array.isArray(parsed)) {normalized = parsed;} } catch (_) {}
    }
    const shortages = [];
    for (const item of normalizeRequestedItems(normalized)) {
        const inv = (await db.query(
            'SELECT id, name, catch_weight_enabled FROM inventory WHERE LOWER(name)=LOWER($1) LIMIT 1',
            [item.itemName])).rows[0];
        if (!inv) {
            shortages.push({ itemName: item.itemName, requested: item.qty, available: 0,
                code: 'INVENTORY_ITEM_NOT_FOUND',
                message: `الصنف غير موجود في المخزن: ${item.itemName}` });
            continue;
        }
        const available = n((await db.query(
            `SELECT COALESCE(SUM(GREATEST(0, b.on_hand - b.reserved)), 0) AS main_available
             FROM inventory_location_balances b
             WHERE b.inventory_id = $1
               AND b.location_id = (SELECT id FROM inventory_locations WHERE code='MAIN-WAREHOUSE' AND active=true LIMIT 1)`,
            [inv.id])).rows[0]?.main_available);
        const isCatchWeight = Boolean(inv.catch_weight_enabled);
        const insufficient = isCatchWeight ? !(available > 0) : available < item.qty;
        if (insufficient) {
            shortages.push({ itemName: inv.name, requested: item.qty, available, code: 'INSUFFICIENT_STOCK',
                message: isCatchWeight
                    ? `${inv.name}: لا يوجد له أي رصيد في المخزن الرئيسي`
                    : `${inv.name}: المتاح بالرئيسي ${available} والمطلوب ${item.qty}` });
        }
    }
    return { ok: shortages.length === 0, shortages };
}

async function getWarehouseLocation(client, code, nameAr, type, ownerDeptCode = null) {
    const existing = (await client.query('SELECT id, code, name_ar, dept_code FROM inventory_locations WHERE code=$1 AND active=true LIMIT 1', [code])).rows[0];
    if (existing) {
        // ترقية ذاتية: مخزن قديم بلا ربط قسم يُربط بقسمه عند أول تمرير
        if (ownerDeptCode && !existing.dept_code) {
            await client.query('UPDATE inventory_locations SET dept_code=$1 WHERE id=$2', [ownerDeptCode, existing.id]);
            return { ...existing, dept_code: ownerDeptCode };
        }
        return existing;
    }
    // كل مخزن قسمي يُربط بقسمه منذ الإنشاء حتى تُحمَّل كلفته (صرف/عجز جرد) على القسم تلقائيًا
    const ownerDept = ownerDeptCode || (type === 'kitchen' ? 'kitchen' : null);
    return (await client.query(`INSERT INTO inventory_locations (code,name_ar,location_type,active,negative_stock_policy,costing_policy,count_frequency_days,dept_code)
      VALUES ($1,$2,$3,true,'deny','weighted_average',7,$4)
      ON CONFLICT (code) DO UPDATE SET active=true, dept_code=COALESCE(EXCLUDED.dept_code, inventory_locations.dept_code) RETURNING id,code,name_ar,dept_code`, [code, nameAr, type, ownerDept])).rows[0];
}

/**
 * Task 19: مخزن الاستلام الخاص بإذن الصرف — مخازن الأقسام الجديدة لها مخازنها،
 * وما ليس لها مخزن مخصص يكمل في مخزن المطبخ كما في السلوك القديم.
 */
async function getDispatchTargetLocation(client, deptCode) {
    const store = resolveDispatchTargetStore(deptCode);
    if (store) {return getWarehouseLocation(client, store.code, store.name, 'kitchen', String(deptCode).trim().toLowerCase());}
    return getWarehouseLocation(client, 'KITCHEN-MAIN', 'مخزن المطبخ', 'kitchen');
}

async function ensureLocationBalance(client, inventoryId, locationId, fallbackQty) {
    const existing = (await client.query('SELECT inventory_id,location_id FROM inventory_location_balances WHERE inventory_id=$1 AND location_id=$2 FOR SHARE', [inventoryId, locationId])).rows[0];
    if (existing) {return;}
    const other = (await client.query('SELECT COALESCE(SUM(on_hand),0) AS on_hand FROM inventory_location_balances WHERE inventory_id=$1 AND location_id<>$2', [inventoryId, locationId])).rows[0];
    const opening = Math.max(0, n(fallbackQty) - n(other?.on_hand));
    await client.query(`INSERT INTO inventory_location_balances (inventory_id,location_id,on_hand,reserved,in_transit,quarantined,expired)
      VALUES ($1,$2,$3,0,0,0,0) ON CONFLICT (inventory_id,location_id) DO NOTHING`, [inventoryId, locationId, opening]);
}

let legacyKitchenReceiptPromise;
async function ensureLegacyKitchenReceiptLedger() {
    if (legacyKitchenReceiptPromise) {return legacyKitchenReceiptPromise;}
    legacyKitchenReceiptPromise = (async () => {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            const main = await getWarehouseLocation(client, 'MAIN-WAREHOUSE', 'المخزن الرئيسي', 'warehouse');
            const kitchen = await getWarehouseLocation(client, 'KITCHEN-MAIN', 'مخزن المطبخ', 'kitchen');
            const rows = (await client.query(`SELECT id,"receivedItems" FROM dispatches
              WHERE status IN ('received','partially_received') AND "kitchenReceivedAt" IS NOT NULL
              ORDER BY id`)).rows;
            for (const dispatch of rows) {
                const received = Array.isArray(dispatch.receivedItems) ? dispatch.receivedItems : [];
                for (const raw of received) {
                    const qty = n(raw.receivedQty ?? raw.qty);
                    if (qty <= 0) {continue;}
                    const item = raw.itemId
                        ? (await client.query('SELECT id,name,unit,"avgCost" FROM inventory WHERE id=$1', [raw.itemId])).rows[0]
                        : (await client.query('SELECT id,name,unit,"avgCost" FROM inventory WHERE LOWER(name)=LOWER($1)', [raw.itemName])).rows[0];
                    if (!item) {continue;}
                    // 2026-10-05 (بلاغ المالك: «أذونات الصرف زادت المنتجات مش قلته»): حراسة ضد التكرار —
                    // الاستلام الحي (نقطة /receive) يسجل قيده الخاص بنفس الإذن والصنف؛ لو موجود
                    // التسوية القديمة تتخطى — كانت تضيف الكمية مرة ثانية فتضخم الرصيد +المستلم
                    const liveReceipt = (await client.query(
                        `SELECT 1 FROM inventory_ledger
                          WHERE reference_type='dispatch_receipt' AND reference_id=$1
                            AND inventory_id=$2 AND transaction_type='transfer_in'
                            AND COALESCE(metadata->>'legacy_backfill','false') <> 'true'
                          LIMIT 1`, [String(dispatch.id), item.id])).rows[0];
                    if (liveReceipt) {continue;}
                    await ensureLocationBalance(client, item.id, main.id, n(item.qty));
                    const base = `dispatch:${dispatch.id}:legacy-receipt:${item.id}`;
                    await postInventoryLedgerEntry(client, { transactionType:'transfer_in', inventoryId:item.id, locationId:kitchen.id, quantityDelta:qty, unit:item.unit||raw.unit||'وحدة', unitCost:n(item.avgCost), sourceLocationId:main.id, destinationLocationId:kitchen.id, referenceType:'dispatch_receipt', referenceId:String(dispatch.id), idempotencyKey:`${base}:in`, expiryDate: await latestExpiryFor(client, item.id), reason:`تسوية استلام إذن صرف سابق #${dispatch.id}`, metadata:{dispatch_id:dispatch.id, legacy_backfill:true, source_already_decreased:true} });
                }
            }
            await client.query('COMMIT');
        } catch (error) {
            await client.query('ROLLBACK').catch(() => {});

            throw error;
        } finally { client.release(); }
    })().catch(error => { legacyKitchenReceiptPromise = null; throw error; });
    return legacyKitchenReceiptPromise;
}



// ─── API العام — كما كان، عدا الأسماء المُستخرجة إلى purchase-void-routes ───
// تُسجَّل هنا **قبل** تحميل وحدات المسارات: كل وحدة تستورد من هذا الملف،
// وبذلك يكون الاتصال الدائري آمنًا (module.exports مكتمل قبل دوران الوحدة).
module.exports = {
    router,
    ensureLegacyKitchenReceiptLedger,
    beginDispatchOp,
    endDispatchOp,
    // Task 19: دوال نقية لاختبارات سلسلة اعتماد طلبات الصرف
    DEPT_STORES,
    resolveDispatchTargetStore,
    canWarehouseApprove,
    canChefDecide,
    resolveDeptHeadDispatch,
    canReceiveDispatch,
    canDeleteDispatch,
    dispatchStockGate,
    normalizeSignerName,
    signerMatchesAccount,
    accountDisplayName,
    allocatePurchaseDiscount,
    // طلبات شراء النواقص — دوال نقية للاختبارات
    // ربط الأقسام المشترك
    DEPT_CODE_ALIASES,
    canonicalDeptCode,
    deptsMatch,
    // Task 28: دوال نقية لوحة رئيس القسم (dept-panel)
    canAccessDeptPanel,
    resolvePanelDept,
    classifyExpenseSource,
    aggregatePanelExpenses,
    DEPT_PANEL_ROLES,
    EXPENSE_SOURCE_LABELS,
};

// scope داخلي للوحدات المُستخرجة — كل أسماء النطاق A (pool/jwtAuth/logger/…).
// ليس جزءًا من API العام الموثّق، بل جسر تحميل بين الوحدات.
module.exports.__scope = Object.freeze({
    express, crypto, router, WRITE_ROLES, RETURN_ROLES, APPROVAL_ROLES, RECEIVE_ROLES, CHEF_APPROVAL_ROLES, _dispatchOpInFlight, DEPT_CODE_ALIASES, DEPT_STORES, DEPT_PANEL_ROLES, EXPENSE_SOURCE_LABELS, pool, riyadhToday, jwtAuth, requireRole, logger, postInventoryLedgerEntry, computeInvoicePaymentStatus, computeInvoiceVat, loadStandardRate, emitDomainEvent, ensureDispatchCreatorSchema, notifyChainEvent, normalizeExpiryDate, readExpiryField, checkExpiryOnLines, latestExpiryFor, beginDispatchOp, endDispatchOp, canonicalDeptCode, deptsMatch, canReceiveDispatch, resolveDispatchTargetStore, canWarehouseApprove, canChefDecide, resolveDeptHeadDispatch, canDeleteDispatch, canAccessDeptPanel, resolvePanelDept, classifyExpenseSource, aggregatePanelExpenses, id, normItemName, n, round, allocatePurchaseDiscount, dateOnly, cleanName, json, emit, fail, normalizeSignature, signatureHash, normalizeSignerName, signerMatchesAccount, accountDisplayName, appendDispatchEvent, requireSignature, normalizeRequestedItems, dispatchStockGate, getWarehouseLocation, getDispatchTargetLocation, ensureLocationBalance, ensureLegacyKitchenReceiptLedger
});

// تحميل المسارات **بالترتيب الأصلي** — Express يطابق بالترتيب، وتغييره يغيّر معنى المسارات.
require('./warehouse/dispatch-routes');
require('./warehouse/returns-routes');
require('./warehouse/inventory-routes');
Object.assign(module.exports, require('./warehouse/purchase-void-routes'));
require('./warehouse/pr-routes');
