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
    if (!code) return '';
    const clean = String(code).trim().toLowerCase();
    return DEPT_CODE_ALIASES[clean] || String(code).trim();
}

function deptsMatch(codeA, codeB) {
    if (!codeA || !codeB) return false;
    const cleanA = String(codeA).trim().toLowerCase();
    const cleanB = String(codeB).trim().toLowerCase();
    if (cleanA === cleanB) return true;
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
                    await postInventoryLedgerEntry(client, { transactionType:'transfer_in', inventoryId:item.id, locationId:kitchen.id, quantityDelta:qty, unit:item.unit||raw.unit||'وحدة', unitCost:n(item.avgCost), sourceLocationId:main.id, destinationLocationId:kitchen.id, referenceType:'dispatch_receipt', referenceId:String(dispatch.id), idempotencyKey:`${base}:in`, reason:`تسوية استلام إذن صرف سابق #${dispatch.id}`, metadata:{dispatch_id:dispatch.id, legacy_backfill:true, source_already_decreased:true} });
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

router.use(async (req, res, next) => {
    try { await ensureLegacyKitchenReceiptLedger(); } catch (error) { logger.error('[dispatch_kitchen_receipt_backfill]', error); }
    next();
});

/**
 * Task 28: لوحة رئيس القسم — مصروفات القسم حسب المصدر + أذونات الصرف + الأقسام الفرعية.
 * رئيس القسم محبوس في قسمه، والشيف يرى المطبخ وأقسامه، وadmin/manager أي قسم.
 */
router.get('/dept-panel', jwtAuth, async (req, res) => {
    const gate = canAccessDeptPanel(req.user);
    if (!gate.ok) {
        const status = gate.code === 'IDENTITY_REQUIRED' ? 401 : 403;
        return fail(res, status, gate.code, 'لا تملك صلاحية الوصول للوحة القسم');
    }
    const scope = resolvePanelDept(req.user, req.query.dept);
    if (!scope.ok) {
        return fail(res, 403, scope.code, scope.code === 'DEPT_MISMATCH' ? 'لا يمكنك عرض لوحة قسم غير قسمك' : 'حسابك بلا قسم مرتبط');
    }
    const client = await pool.connect();
    try {
        let department = null;
        let subDepartments = [];
        let scopeCodes = [];
        if (scope.deptCode) {
            department = (await client.query('SELECT code, name, icon, color, parent_code FROM departments WHERE code=$1', [scope.deptCode])).rows[0] || null;
            if (!department) {
                // UPGRADE 2026-10-01: fallback لأقسام HR — أقسام الموارد البشرية
                // التي لا توأم تشغيلي لها تعمل في اللوحة تلقائيًا (تكاليفها تبدأ صفرًا)
                department = (await client.query('SELECT code, name FROM "hrDepartments" WHERE code=$1', [scope.deptCode])).rows[0] || null;
                if (department) {department.icon = department.icon || null; department.color = department.color || null; department.parent_code = null;}
            }
            if (!department) {return fail(res, 404, 'DEPARTMENT_NOT_FOUND', 'القسم غير موجود');}
            subDepartments = (await client.query('SELECT code, name FROM departments WHERE parent_code=$1 ORDER BY code', [department.code])).rows;
            scopeCodes = [department.code, ...subDepartments.map(d => d.code)];
        } else {
            // نظرة عامة (admin/manager بلا ?dept=): كل الأقسام
            const all = (await client.query('SELECT code, name FROM departments ORDER BY code')).rows;
            scopeCodes = all.map(d => d.code);
        }

        // ملاحظة: "desc" عمود محجوز في PostgreSQL — يجب اقتباسه صراحة
        const expenses = (await client.query(`SELECT id, "deptId", "desc", amount, date, notes, "autoGenerated", category, "adjustmentType"
            FROM expenses WHERE "deptId" = ANY($1::varchar[]) ORDER BY date DESC, id DESC LIMIT 400`, [scopeCodes])).rows;
        const expenseSummary = aggregatePanelExpenses(expenses);

        const dispatchRows = (await client.query(`SELECT status, COUNT(*)::int AS count FROM dispatches WHERE "deptCode" = ANY($1::varchar[]) GROUP BY status`, [scopeCodes])).rows;
        const byStatus = {};
        let dispatchTotal = 0;
        for (const row of dispatchRows) { byStatus[row.status] = row.count; dispatchTotal += row.count; }

        res.json({
            scope: {
                deptCode: scope.deptCode,
                role: req.user.role,
                view: scope.deptCode ? 'department' : 'overview',
                subDepartmentCodes: subDepartments.map(d => d.code),
            },
            department: department ? { code: department.code, name: department.name, icon: department.icon, color: department.color, parentCode: department.parent_code } : null,
            subDepartments,
            expenses: expenseSummary,
            dispatches: { total: dispatchTotal, byStatus },
            generatedAt: new Date().toISOString(),
        });
    } catch (error) {
        logger.error('[warehouse_dept_panel]', error);
        res.status(500).json({ error: 'DEPT_PANEL_FAILED', message: 'تعذر تحميل لوحة القسم' });
    } finally {
        client.release();
    }
});

router.post('/dispatches/:id/approve', jwtAuth, requireRole(...APPROVAL_ROLES), async (req, res) => {
    const approvalSignature = requireSignature(req, res);
    if (!approvalSignature) {return;}
    if (!beginDispatchOp(req.params.id, 'approve')) {
        return fail(res, 409, 'DISPATCH_APPROVE_IN_PROGRESS', 'اعتماد هذا الإذن قيد التنفيذ الآن — انتظر النتيجة ولا تُكرر الضغط');
    }
    let client = null;
    try {
        client = await pool.connect();
        await client.query('BEGIN');
        // حدّ الانتظار على القفل: تعامل متزامن على نفس الأصناف يظل معقولًا، لكن
        // الاصطفاف الطويل هو ما كان يجمّد الشاشة كلها (كان 20 ثانية في اللوج).
        await client.query("SET LOCAL lock_timeout = '8000'");
        const dispatchResult = await client.query('SELECT * FROM dispatches WHERE id = $1 FOR UPDATE', [req.params.id]);
        const dispatch = dispatchResult.rows[0];
        if (!dispatch) {
            await client.query('ROLLBACK');
            return fail(res, 404, 'DISPATCH_NOT_FOUND', 'طلب الصرف غير موجود');
        }
        // Task 19: بوابة سلسلة الاعتماد — طلب رئيس القسم يجب أن يعتمده الشيف العمومي أولًا،
        // ولا يجوز اعتماد إذن معتمد/مرفوض/مستلم سلفًا (كان يسمح بخصم مزدوج لإذن مستلم)
        const guard = canWarehouseApprove(dispatch);
        if (!guard.ok) {
            await client.query('ROLLBACK');
            const messages = {
                CHEF_APPROVAL_REQUIRED: 'طلب الصرف مقدم من رئيس قسم ويجب اعتماد الشيف العمومي أولًا قبل صرف المخازن',
                DISPATCH_ALREADY_APPROVED: 'تم اعتماد طلب الصرف مسبقاً',
                DISPATCH_REJECTED: 'لا يمكن اعتماد طلب مرفوض',
                DISPATCH_ALREADY_RECEIVED: 'تم استلام هذا الإذن — لا يمكن اعتماده مرة أخرى',
                DISPATCH_INVALID_STATUS: 'حالة طلب الصرف لا تسمح بالاعتماد',
            };
            return fail(res, 409, guard.code, messages[guard.code] || 'حالة طلب الصرف لا تسمح بالاعتماد');
        }

        const requested = normalizeRequestedItems(req.body?.approvedItems?.length ? req.body.approvedItems : dispatch.items);
        if (!requested.length) {
            await client.query('ROLLBACK');
            return fail(res, 422, 'EMPTY_APPROVED_ITEMS', 'يجب تحديد صنف وكمية معتمدة');
        }

        const approvedItems = [];
        const stockChanges = [];
        const transactions = [];
        const expenses = [];
let totalValue = 0;
        const mainLocation = await getWarehouseLocation(client, 'MAIN-WAREHOUSE', 'المخزن الرئيسي', 'warehouse');

        for (const requestedItem of requested) {
            const invResult = await client.query(
                'SELECT * FROM inventory WHERE LOWER(name) = LOWER($1) FOR UPDATE',
                [requestedItem.itemName]);
            const inv = invResult.rows[0];
            if (!inv) {
                await client.query('ROLLBACK');
                return fail(res, 422, 'INVENTORY_ITEM_NOT_FOUND', `الصنف غير موجود في المخزن: ${requestedItem.itemName}`);
            }
            // ─── Catch Weight احترافي: الاستلام بالكيلو، والطلب بالكرتون، والوزن الفعلي من الميزان ───
            // للأصناف ذات الوزن المتغير: عدد الكراتين + الوزن الفعلي إجباري، والخصم والتكلفة بالكيلو الفعلي
            const isCatchWeight = Boolean(inv.catch_weight_enabled);
            const packagingUom = inv.packaging_uom || 'كرتون';
            const catchUom = inv.catch_weight_uom || 'kg';
            const actualWeight = isCatchWeight ? n(requestedItem.actualWeight, 0) : 0;
            const packagingQty = isCatchWeight ? n(requestedItem.packagingQty, 0) : 0;
            if (isCatchWeight && (!(actualWeight > 0) || !(packagingQty > 0))) {
                await client.query('ROLLBACK');
                return fail(res, 422, 'CATCH_WEIGHT_REQUIRED', `الصنف "${inv.name}" وزن متغير: أدخل الوزن الفعلي بالكيلو وعدد الكراتين`, {
                    itemName: inv.name,
                });
            }
            // الكمية المؤثرة مخزنيًا ومحاسبيًا: الوزن الفعلي لأصناف CW، والكمية العادية لغيرها
            const effectiveQty = isCatchWeight ? round(actualWeight, 3) : requestedItem.qty;
            // قرار المالك 2026-10-07: مخزن رئيسي واحد فقط للخصم — الفروع للمطبخ لا تُمس.
            // التحقق من رصيد الرئيسي فقط، وأي عجز = رفض (لا سحب تلقائي من الفروع).
            const mainAvailableResult = await client.query(
                `SELECT COALESCE(GREATEST(0, on_hand - reserved), 0) AS main_available
                 FROM inventory_location_balances
                 WHERE inventory_id = $1 AND location_id = $2`,
                [inv.id, mainLocation.id]);
            const totalAvailable = n(mainAvailableResult.rows[0]?.main_available);
            if (effectiveQty > totalAvailable) {
                await client.query('ROLLBACK');
                return fail(res, 409, 'INSUFFICIENT_STOCK', `الرصيد غير كافٍ من ${inv.name} في المخزن الرئيسي (الفروع لا تُمس)`, {
                    itemName: inv.name, requested: effectiveQty, available: totalAvailable,
                });
            }

            const value = round(effectiveQty * n(inv.avgCost), 2);
            const dispatchRef = `DIS-${dispatch.id}`;

// الخصم من المخزن الرئيسي فقط — مباشرة وبدون توزيع على الفروع
            const unitForLedger = isCatchWeight ? catchUom : (inv.unit || requestedItem.unit || 'وحدة');

            await postInventoryLedgerEntry(client, {
                transactionType: 'transfer_out',
                inventoryId: Number(inv.id),
                locationId: mainLocation.id,
                quantityDelta: -effectiveQty,
                unit: unitForLedger,
                unitCost: n(inv.avgCost),
                sourceLocationId: mainLocation.id,
                referenceType: 'dispatch',
                referenceId: dispatchRef,
                userId: req.user.id,
                idempotencyKey: `dispatch:${dispatch.id}:approve:${inv.id}:${mainLocation.id}`,
                reason: `اعتماد صرف ${inv.name} من المخزن الرئيسي`,
                metadata: { dispatch_id: dispatch.id, location_id: mainLocation.id,
                    ...(isCatchWeight ? { packaging_qty: packagingQty, packaging_uom: packagingUom } : {}) },
                catchWeightQty: isCatchWeight ? packagingQty : null,
                catchWeightUnit: isCatchWeight ? packagingUom : null,
            });

        // للـ inventoryTx: الكمية الأساسية = الوزن الفعلي (kg)، وحقول Catch = عدد الكراتين
            const tx = (await client.query(
                `INSERT INTO "inventoryTx" (id, "itemId", "itemName", qty, type, date, cost, "totalValue", notes, "dispatchId", catch_weight_qty, catch_weight_unit)
                 VALUES ($1,$2,$3,$4,'out',$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
                [id(), inv.id, inv.name, effectiveQty, dateOnly(dispatch.date), n(inv.avgCost), value,
                    req.body?.approveNotes || `اعتماد طلب صرف #${dispatch.id}`, dispatchRef,
                    isCatchWeight ? packagingQty : null, isCatchWeight ? packagingUom : null]
            )).rows[0];
            const expense = (await client.query(
                `INSERT INTO expenses (id, "deptId", "desc", amount, date, notes, "autoGenerated", category, "adjustmentType")
                 VALUES ($1,$2,$3,$4,$5,$6,true,'مواد خام','dispatch') RETURNING *`,
                [id(), dispatch.deptCode, isCatchWeight
                    ? `صرف مخزون - ${inv.name} (${packagingQty} ${packagingUom} = ${effectiveQty} ${catchUom})`
                    : `صرف مخزون - ${inv.name} (${requestedItem.qty} ${inv.unit || requestedItem.unit})`, value,
                    dateOnly(dispatch.date), `من طلب صرف #${dispatch.id} — حركة مخزون ${tx.id}`]
            )).rows[0];

            const approved = {
                name: inv.name,
                itemName: inv.name,
                itemId: Number(inv.id),
                unit: isCatchWeight ? catchUom : (inv.unit || requestedItem.unit || 'وحدة'),
                requestedQty: requestedItem.qty,
                requestedPackagingQty: isCatchWeight ? n(requestedItem.packagingQty, 0) || null : null,
                approvedQty: effectiveQty,
                avgCost: n(inv.avgCost),
                approvedValue: value,
                // Catch weight fields
                catchWeightEnabled: isCatchWeight,
                actualWeight: isCatchWeight ? effectiveQty : null,
                packagingQty: isCatchWeight ? packagingQty : null,
                packagingUom: isCatchWeight ? packagingUom : null,
                catchWeightUom: catchUom,
            };
            approvedItems.push(approved);
            const globalBalance = (await client.query('SELECT qty FROM inventory WHERE id=$1', [inv.id])).rows[0]?.qty;
            stockChanges.push({ ...inv, qty: globalBalance });
            transactions.push(tx);
            expenses.push(expense);
            totalValue += value;
        }

        const approvedDate = new Date().toISOString();
        const updatedDispatch = (await client.query(
            `UPDATE dispatches SET status='approved', "approvedDate"=$1, "approvedBy"=$2,
             "approveNotes"=$3, "approvedItems"=$4, "warehouseApprovedAt"=$5,
             "warehouseApprovedBy"=$6, "warehouseApprovalSignatureData"=$7,
             "warehouseApprovalSignatureHash"=$8 WHERE id=$9 RETURNING *`,
            [approvedDate, req.user.name || req.user.username || String(req.user.id), req.body?.approveNotes || null, json(approvedItems), approvedDate,
                req.user.name || req.user.username || String(req.user.id), approvalSignature, signatureHash(approvalSignature), dispatch.id]
        )).rows[0];
        await appendDispatchEvent(client, dispatch.id, 'warehouse_approved', dispatch.status, 'approved', req, approvalSignature, { approvedItems, notes: req.body?.approveNotes || null });
        // TASK 9: حدثا دومين داخل نفس المعاملة (fail-open): الصرف + المصروف المولد
        await emitDomainEvent(pool, client, 'DISPATCH', {
            eventType: 'DISPATCH_APPROVED', aggregateType: 'dispatch', aggregateId: dispatch.id,
            deptCode: dispatch.deptCode,
            payload: { dispatch_id: dispatch.id, dept: dispatch.deptCode, total: round(totalValue, 2), items: approvedItems.length },
        });
        await emitDomainEvent(pool, client, 'EXPENSE', {
            eventType: 'EXPENSE_CREATED', aggregateType: 'dispatch', aggregateId: dispatch.id,
            deptCode: dispatch.deptCode,
            payload: { dispatch_id: dispatch.id, dept: dispatch.deptCode, total: round(totalValue, 2), kind: 'dispatch_materials' },
        });
        await client.query('COMMIT');

        // ترحيل محاسبي متماثل best-effort: Dr COGS / Cr مخزون (لا يُسقط الاعتماد)
        try {
            await require('./accounting-routes').postDispatchToLedger(dispatch.id, {
                totalValue, date: dateOnly(dispatch.date), deptCode: dispatch.deptCode,
            });
        } catch (ledgerErr) { logger.warn('[dispatch_ledger] best-effort skipped:', ledgerErr.message); }

        emit(req, 'dispatches', 'update', updatedDispatch);
        // Task 20: إشعار فوري — المخازن صرفت: مقدم الطلب والشيف العمومي
        ensureDispatchCreatorSchema().catch(() => {});
        notifyChainEvent(req, dispatch, 'warehouse_approved', { io: req.io });
        for (const item of stockChanges) {emit(req, 'inventory', 'update', item);}
        for (const tx of transactions) {emit(req, 'inventoryTx', 'create', tx);}
        for (const expense of expenses) {emit(req, 'expenses', 'create', expense);}
        res.json({ dispatch: updatedDispatch, stockChanges, transactions, expenses, totalValue: round(totalValue, 2) });
    } catch (error) {
        if (client) {await client.query('ROLLBACK').catch(() => {});}
        logger.error('[warehouse_dispatch_approve]', error);
        if (error.code === '55P03') {
            return fail(res, 409, 'DISPATCH_STOCK_BUSY', 'الصنف مستخدم في عملية صرف أخرى الآن — أعد المحاولة بعد ثانية');
        }
        const status = error.code === 'INSUFFICIENT_STOCK' ? 409 : 500;
        const message = error.code === 'INSUFFICIENT_STOCK' ? 'الرصيد غير كافٍ في المخزن الرئيسي لاعتماد إذن الصرف' : 'تعذر اعتماد طلب الصرف بشكل ذري';
        res.status(status).json({ error: error.code || 'DISPATCH_APPROVE_FAILED', message });
    } finally {
        endDispatchOp(req.params.id, 'approve');
        if (client) {client.release();}
    }
});

// ═══ Task 19: اعتماد الشيف العمومي لطلب رئيس القسم ═══
// pending → chef_approved (بدون أي خصم مخزني — الخصم عند اعتماد المخازن فقط)
router.post('/dispatches/:id/chef-approve', jwtAuth, requireRole(...CHEF_APPROVAL_ROLES), async (req, res) => {
    const chefSignature = requireSignature(req, res);
    if (!chefSignature) {return;}
    if (!beginDispatchOp(req.params.id, 'chef-approve')) {
        return fail(res, 409, 'DISPATCH_CHEF_APPROVE_IN_PROGRESS', 'اعتماد الشيف العمومي لهذا الإذن قيد التنفيذ الآن — انتظر النتيجة');
    }
    let client = null;
    try {
        client = await pool.connect();
        await client.query('BEGIN');
        const dispatch = (await client.query('SELECT * FROM dispatches WHERE id=$1 FOR UPDATE', [req.params.id])).rows[0];
        if (!dispatch) { await client.query('ROLLBACK'); return fail(res, 404, 'DISPATCH_NOT_FOUND', 'طلب الصرف غير موجود'); }
        const guard = canChefDecide(dispatch);
        if (!guard.ok) {
            await client.query('ROLLBACK');
            const messages = {
                CHEF_APPROVAL_NOT_REQUIRED: 'هذا الطلب لا يحتاج اعتماد الشيف العمومي (ليس مقدمًا من رئيس قسم)',
                DISPATCH_NOT_PENDING: 'لا يمكن اعتماد طلب خرج من حالة الانتظار',
            };
            return fail(res, 409, guard.code, messages[guard.code] || 'لا يمكن اعتماد الطلب حاليًا');
        }
        // طلب المالك 2026-10-05: المنع قاطع — لا يُعتمد إذن صرف صنفه بلا رصيد كافٍ
        // (كان مجرد تنبيه في الرد ثم رفض متأخر عند المخازن، فيعلق الإذن في السلسلة)
        const stockGate = await dispatchStockGate(client, dispatch.items);
        if (!stockGate.ok) {
            await client.query('ROLLBACK');
            return fail(res, 409, 'INSUFFICIENT_STOCK',
                'لا يمكن اعتماد إذن الصرف — الرصيد غير كافٍ في المخزن: ' + stockGate.shortages.map(s => s.message).join('، '),
                { shortages: stockGate.shortages });
        }
        const availabilityWarnings = [];
        const chefApprovedAt = new Date().toISOString();
        const chefName = req.user.name || req.user.username || String(req.user.id);
        const updated = (await client.query(`UPDATE dispatches SET status='chef_approved',
          "chefApprovedAt"=$1, "chefApprovedBy"=$2, "chefApprovalSignatureData"=$3, "chefApprovalSignatureHash"=$4
          WHERE id=$5 RETURNING *`,
          [chefApprovedAt, chefName, chefSignature, signatureHash(chefSignature), dispatch.id])).rows[0];
        await appendDispatchEvent(client, dispatch.id, 'chef_approved', dispatch.status, 'chef_approved', req, chefSignature, {
            chefNotes: String(req.body?.notes || '').trim() || null,
            availabilityWarnings,
        });
        await client.query('COMMIT');
        emit(req, 'dispatches', 'update', updated);
        // Task 20: إشعار فوري — الشيف اعتمد: مقدم الطلب + المخازن (بانتظار الصرف)
        ensureDispatchCreatorSchema().catch(() => {});
        notifyChainEvent(req, dispatch, 'chef_approved', { io: req.io });
        res.json({ dispatch: updated, availabilityWarnings });
    } catch (error) {
        if (client) {await client.query('ROLLBACK').catch(() => {});}
        logger.error('[pr_create]', error);
        logger.error('[chef_dispatch_approve]', error);
        res.status(500).json({ error: 'CHEF_APPROVE_FAILED', message: 'تعذر اعتماد الطلب من الشيف العمومي بشكل موثق' });
    } finally { endDispatchOp(req.params.id, 'chef-approve'); if (client) {client.release();} }
});

// ═══ Task 19: رفض الشيف العمومي لطلب رئيس القسم ═══
// pending → rejected مع توثيق سبب الرفض وتوقيع الشيف
router.post('/dispatches/:id/chef-reject', jwtAuth, requireRole(...CHEF_APPROVAL_ROLES), async (req, res) => {
    const chefSignature = requireSignature(req, res);
    if (!chefSignature) {return;}
    const reason = String(req.body?.reason || '').trim();
    if (!reason) {return fail(res, 422, 'REJECTION_REASON_REQUIRED', 'سبب رفض الشيف العمومي مطلوب');}
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const dispatch = (await client.query('SELECT * FROM dispatches WHERE id=$1 FOR UPDATE', [req.params.id])).rows[0];
        if (!dispatch) { await client.query('ROLLBACK'); return fail(res, 404, 'DISPATCH_NOT_FOUND', 'طلب الصرف غير موجود'); }
        const guard = canChefDecide(dispatch);
        if (!guard.ok) {
            await client.query('ROLLBACK');
            const messages = {
                CHEF_APPROVAL_NOT_REQUIRED: 'هذا الطلب لا يحتاج اعتماد الشيف العمومي (ليس مقدمًا من رئيس قسم)',
                DISPATCH_NOT_PENDING: 'لا يمكن رفض طلب خرج من حالة الانتظار',
            };
            return fail(res, 409, guard.code, messages[guard.code] || 'لا يمكن رفض الطلب حاليًا');
        }
        const chefRejectedAt = new Date().toISOString();
        const chefName = req.user.name || req.user.username || String(req.user.id);
        const updated = (await client.query(`UPDATE dispatches SET status='rejected',
          "rejectionReason"=$1, "rejectedBy"=$2, "rejectedDate"=$3,
          "chefRejectedAt"=$4, "chefRejectedBy"=$5, "chefRejectionSignatureData"=$6, "chefRejectionSignatureHash"=$7
          WHERE id=$8 RETURNING *`,
          [reason, chefName, chefRejectedAt, chefRejectedAt, chefName, chefSignature, signatureHash(chefSignature), dispatch.id])).rows[0];
        await appendDispatchEvent(client, dispatch.id, 'chef_rejected', dispatch.status, 'rejected', req, chefSignature, { reason });
        await client.query('COMMIT');
        emit(req, 'dispatches', 'update', updated);
        // Task 20: إشعار فوري — الشيف رفض: مقدم الطلب يرى السبب
        ensureDispatchCreatorSchema().catch(() => {});
        notifyChainEvent(req, dispatch, 'chef_rejected', { io: req.io, reason });
        res.json({ dispatch: updated });
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        logger.error('[pr_create]', error);
        logger.error('[chef_dispatch_reject]', error);
        res.status(500).json({ error: 'CHEF_REJECT_FAILED', message: 'تعذر رفض الطلب من الشيف العمومي بشكل موثق' });
    } finally { client.release(); }
});

// ─── تعديل إذن الصرف قبل وصوله للمخزن (طلب المالك 2026-10-04) ────────────────
// من يعدل: صاحب الإذن، أو الشيف/السو شيف، أو admin/manager.
// متى: فقط وهو 'pending' أو 'chef_approved' (قبل اعتماد المخازن).
// الأثر: لو كان معتمدًا من الشيف يُلغى اعتماده وتُمسح تواقيعه ويرجع «قيد الانتظار»
// ليُعتمد من جديد على الأرقام الجديدة. كل تعديل يُوثَّق في سلسلة أحداث الإذن.
router.put('/dispatches/:id/edit', jwtAuth, async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const dispatch = (await client.query('SELECT * FROM dispatches WHERE id=$1 FOR UPDATE', [req.params.id])).rows[0];
        if (!dispatch) { await client.query('ROLLBACK'); return fail(res, 404, 'DISPATCH_NOT_FOUND', 'طلب الصرف غير موجود'); }
        if (!['pending', 'chef_approved'].includes(dispatch.status)) {
            await client.query('ROLLBACK');
            return fail(res, 409, 'DISPATCH_NOT_EDITABLE', `لا يمكن تعديل الطلب في حالته الحالية (${dispatch.status}) — التعديل متاح قبل اعتماد المخازن فقط`);
        }
        const isCreator = dispatch.creatorUserId != null && Number(dispatch.creatorUserId) === Number(req.user.id);
        const isChef = ['kitchen', 'sous_chef'].includes(req.user.role);
        const isBoss = ['admin', 'manager'].includes(req.user.role);
        // قرار المالك 2026-10-09: رئيس القسم يعدّل أذونات قسمه قبل الاعتماد
        const myDepts = String(req.user?.dept_code || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
        const isDeptHeadOfDept = req.user?.role === 'dept_head' && myDepts.includes(String(dispatch.deptCode || '').trim().toLowerCase());
        if (!isCreator && !isChef && !isBoss && !isDeptHeadOfDept) {
            await client.query('ROLLBACK');
            return fail(res, 403, 'EDIT_FORBIDDEN', 'التعديل متاح لصاحب الطلب أو رئيس القسم أو للشيف أو للإدارة فقط');
        }
        // نفس تحققات بناء الطلب: أصناف صالحة فقط
        const rawItems = Array.isArray(req.body?.items) ? req.body.items : [];
        const items = rawItems
            .map((r) => ({
                itemName: cleanName(r.itemName || r.name).slice(0, 200),
                qty: n(r.qty),
                unit: (cleanName(r.unit) || 'وحدة').slice(0, 50),
            }))
            .filter((i) => i.itemName && i.qty > 0 && i.qty <= 999999999);
        if (!items.length) {
            await client.query('ROLLBACK');
            return fail(res, 422, 'NO_VALID_ITEMS', 'لا توجد أصناف صالحة — كل صنف يحتاج اسمًا وكمية أكبر من صفر');
        }
        if (items.length > 200) {
            await client.query('ROLLBACK');
            return fail(res, 422, 'TOO_MANY_ITEMS', 'الحد الأقصى 200 صنف في الإذن');
        }
        // طلب المالك 2026-10-05: التعديل لا يتجاوز بوابة الرصيد — لا يُقبل إذن بلا رصيد كافٍ
        const editStockGate = await dispatchStockGate(client, items);
        if (!editStockGate.ok) {
            await client.query('ROLLBACK');
            return fail(res, 409, 'INSUFFICIENT_STOCK',
                'لا يمكن تعديل إذن الصرف — الرصيد غير كافٍ في المخزن: ' + editStockGate.shortages.map(s => s.message).join('، '),
                { shortages: editStockGate.shortages });
        }
        const reason = cleanName(req.body?.reason).slice(0, 200) || 'تعديل قبل الاعتماد';
        // تعديل القسم الطالب (طلب المالك 2026-10-04): رئيس القسم مُجبر على قسمه دائمًا،
        // والشيف/الإدارة قد ينقلان الطلب لقسم آخر موجود في دليل الأقسام.
        let deptCode = dispatch.deptCode;
        let deptName = dispatch.deptName;
        let deptChanged = false;
        const newDeptRaw = req.body?.deptCode !== undefined && req.body?.deptCode !== null ? cleanName(req.body.deptCode).slice(0, 50) : '';
        if (newDeptRaw && newDeptRaw.toLowerCase() !== String(dispatch.deptCode || '').toLowerCase()) {
            if (req.user.role === 'dept_head') {
                const forced = resolveDeptHeadDispatch(req.user, newDeptRaw);
                if (!forced.ok) {
                    await client.query('ROLLBACK');
                    return fail(res, 403, forced.code, 'رئيس القسم يعدل في قسمه فقط');
                }
                deptCode = forced.deptCode;
            } else {
                const dep = (await client.query(
                    'SELECT code, name FROM departments WHERE LOWER(code)=LOWER($1) LIMIT 1',
                    [newDeptRaw]
                )).rows[0] || (await client.query(
                    'SELECT code, name AS name FROM "hrDepartments" WHERE LOWER(code)=LOWER($1) LIMIT 1',
                    [newDeptRaw]
                )).rows[0];
                if (!dep) {
                    await client.query('ROLLBACK');
                    return fail(res, 422, 'DEPT_NOT_FOUND', `القسم المختار غير موجود: ${newDeptRaw}`);
                }
                deptCode = dep.code;
                deptName = dep.name;
            }
            deptChanged = String(deptCode).toLowerCase() !== String(dispatch.deptCode || '').toLowerCase();
        }
        const wasChefApproved = dispatch.status === 'chef_approved';
        const updated = (await client.query(
            `UPDATE dispatches SET items=$1, status='pending',
               "deptCode"=$2, "deptName"=$3,
               notes = COALESCE(NULLIF($4,''), notes),
               "chefApprovedAt"=NULL, "chefApprovedBy"=NULL,
               "chefApprovalSignatureData"=NULL, "chefApprovalSignatureHash"=NULL
             WHERE id=$5 RETURNING *`,
            [JSON.stringify(items), deptCode, deptName, wasChefApproved ? `عدّل المحتوى ${req.user.name || req.user.username}: ${reason}` : '', dispatch.id]
        )).rows[0];
        await appendDispatchEvent(client, dispatch.id, 'edited', dispatch.status, 'pending', req, null, {
            reason,
            chefApprovalReset: wasChefApproved,
            deptChanged,
            oldDept: dispatch.deptCode,
            newDept: deptCode,
            oldItems: Array.isArray(dispatch.items) ? dispatch.items : (() => { try { return JSON.parse(dispatch.items || '[]'); } catch (_) { return []; } })(),
            newItems: items,
        });
        await client.query('COMMIT');
        emit(req, 'dispatches', 'update', updated);
        logger.info(`[dispatch_edit] ${req.user?.username} عدّل إذن الصرف ${dispatch.id} (${items.length} صنفًا) — ${reason}${deptChanged ? ` — القسم: ${dispatch.deptCode} → ${deptCode}` : ''}${wasChefApproved ? ' — اعتماد الشيف أُلغي لإعادة المراجعة' : ''}`);
        res.json({ ok: true, dispatch: updated, chefApprovalReset: wasChefApproved, deptChanged });
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        logger.error('[dispatch_edit]', error);
        res.status(500).json({ error: 'DISPATCH_EDIT_FAILED', message: 'تعذر تعديل إذن الصرف' });
    } finally { client.release(); }
});

router.post('/dispatches/:id/reject', jwtAuth, requireRole(...APPROVAL_ROLES), async (req, res) => {
    const rejectionSignature = requireSignature(req, res);
    if (!rejectionSignature) {return;}
    const reason = String(req.body?.reason || '').trim();
    if (!reason) {return fail(res, 422, 'REJECTION_REASON_REQUIRED', 'سبب رفض إذن الصرف مطلوب');}
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const dispatch = (await client.query('SELECT * FROM dispatches WHERE id=$1 FOR UPDATE', [req.params.id])).rows[0];
        if (!dispatch) { await client.query('ROLLBACK'); return fail(res, 404, 'DISPATCH_NOT_FOUND', 'طلب الصرف غير موجود'); }
        if (dispatch.needsChefApproval && dispatch.status === 'pending') {
            await client.query('ROLLBACK');
            return fail(res, 409, 'CHEF_APPROVAL_REQUIRED', 'طلب رئيس القسم في مرحلة اعتماد الشيف العمومي — استخدم مسار رفض الشيف');
        }
        if (dispatch.status !== 'pending') { await client.query('ROLLBACK'); return fail(res, 409, 'DISPATCH_NOT_PENDING', 'لا يمكن رفض طلب خرج من حالة الانتظار'); }
        const rejectedAt = new Date().toISOString();
        const actorName = req.user.name || req.user.username || String(req.user.id);
        const updated = (await client.query(`UPDATE dispatches SET status='rejected', "rejectionReason"=$1,
          "rejectedBy"=$2, "rejectedDate"=$3, "warehouseRejectedAt"=$4,
          "warehouseRejectedBy"=$5, "warehouseRejectionSignatureData"=$6,
          "warehouseRejectionSignatureHash"=$7 WHERE id=$8 RETURNING *`,
          [reason, actorName, rejectedAt, rejectedAt, actorName, rejectionSignature, signatureHash(rejectionSignature), dispatch.id])).rows[0];
        await appendDispatchEvent(client, dispatch.id, 'warehouse_rejected', dispatch.status, 'rejected', req, rejectionSignature, { reason });
        await client.query('COMMIT');
        emit(req, 'dispatches', 'update', updated);
        // Task 20: إشعار فوري — المخازن رفضت: مقدم الطلب يرى السبب
        ensureDispatchCreatorSchema().catch(() => {});
        notifyChainEvent(req, dispatch, 'warehouse_rejected', { io: req.io, reason });
        res.json({ dispatch: updated });
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        logger.error('[pr_create]', error);
        logger.error('[warehouse_dispatch_reject]', error);
        res.status(500).json({ error: 'DISPATCH_REJECT_FAILED', message: 'تعذر رفض طلب الصرف بشكل موثق' });
    } finally { client.release(); }
});

router.post('/dispatches/:id/receive', jwtAuth, requireRole(...RECEIVE_ROLES), async (req, res) => {
    const receiptSignature = requireSignature(req, res);
    if (!receiptSignature) {return;}
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const dispatch = (await client.query('SELECT * FROM dispatches WHERE id=$1 FOR UPDATE', [req.params.id])).rows[0];
        if (!dispatch) { await client.query('ROLLBACK'); return fail(res, 404, 'DISPATCH_NOT_FOUND', 'طلب الصرف غير موجود'); }
        if (!['approved', 'partially_received'].includes(dispatch.status)) {
            await client.query('ROLLBACK');
            return fail(res, 409, 'DISPATCH_NOT_RECEIVABLE', 'لا يمكن استلام إذن غير معتمد أو مستلم مسبقًا');
        }
        if (dispatch.kitchenReceivedAt && dispatch.status !== 'partially_received') {
            await client.query('ROLLBACK');
            return fail(res, 409, 'DISPATCH_RECEIPT_ALREADY_RECORDED', 'تم تسجيل الاستلام لهذا الإذن مسبقًا');
        }
        // رئيس القسم يستلم إذن قسمه هو فقط — عزل الأقسام على مستوى الاستلام
        const receiveGate = canReceiveDispatch(req.user, dispatch);
        if (!receiveGate.ok) {
            await client.query('ROLLBACK');
            return fail(res, receiveGate.code === 'INVALID_INPUT' ? 422 : 403, receiveGate.code,
                receiveGate.code === 'DEPT_MISMATCH' ? 'لا يمكنك استلام إذن صرف لقسم غير قسمك'
                    : receiveGate.code === 'DEPT_HEAD_WITHOUT_DEPARTMENT' ? 'حساب رئيس القسم غير مرتبط بقسم — راجع إدارة المستخدمين'
                        : 'بيانات الاستلام غير مكتملة');
        }
        const approved = normalizeRequestedItems(dispatch.approvedItems || dispatch.items);
        const approvedByName = new Map(approved.map(item => [item.itemName.toLowerCase(), item]));
        const priorReceived = new Map((Array.isArray(dispatch.receivedItems) ? dispatch.receivedItems : [])
            .map(item => [cleanName(item.itemName || item.name).toLowerCase(), item]));
        const requested = Array.isArray(req.body?.items) ? req.body.items : [];
        if (!requested.length) { await client.query('ROLLBACK'); return fail(res, 422, 'RECEIVED_ITEMS_REQUIRED', 'أدخل الكميات المستلمة لكل صنف'); }
        const receivedItems = [];
        let allReceived = true;
        for (const raw of requested) {
            const itemName = cleanName(raw.itemName || raw.name);
            const receivedDeltaQty = n(raw.receivedQty ?? raw.qty, -1);
            const allowed = approvedByName.get(itemName.toLowerCase());
            const prior = priorReceived.get(itemName.toLowerCase());
            const alreadyReceivedQty = n(prior?.receivedQty, 0);
            const receivedQty = alreadyReceivedQty + receivedDeltaQty;
            if (!allowed || receivedDeltaQty < 0 || receivedQty > n(allowed.qty)) {
                await client.query('ROLLBACK');
                return fail(res, 422, 'INVALID_RECEIPT_QTY', `كمية الاستلام غير صحيحة للصنف ${itemName || 'غير المحدد'}`);
            }
            // Catch Weight: استلام الكراتين مع الوزن — لا يتجاوز المعتمد
            const allowedPkg = n(allowed.packagingQty, 0);
            const isCwReceipt = allowedPkg > 0;
            const alreadyReceivedPkg = n(prior?.receivedPackagingQty, 0);
            const receivedPackagingDelta = isCwReceipt ? n(raw.receivedPackagingQty ?? raw.packagingQty, -1) : null;
            const receivedPkg = isCwReceipt ? alreadyReceivedPkg + receivedPackagingDelta : null;
            if (isCwReceipt && (!Number.isFinite(receivedPackagingDelta) || receivedPackagingDelta < 0 || receivedPkg > allowedPkg)) {
                await client.query('ROLLBACK');
                return fail(res, 422, 'INVALID_RECEIPT_PACKAGING_QTY', `عدد الكراتين المستلمة غير صحيح للصنف ${itemName || 'غير المحدد'}`);
            }
            if (receivedQty < n(allowed.qty)) {allReceived = false;}
            receivedItems.push({ itemName: allowed.itemName, itemId: allowed.itemId || null, unit: allowed.unit, approvedQty: round(allowed.qty), receivedQty: round(receivedQty), receivedDeltaQty: round(receivedDeltaQty), varianceQty: round(receivedQty - n(allowed.qty)),
                ...(isCwReceipt ? { approvedPackagingQty: allowedPkg, receivedPackagingQty: receivedPkg, packagingUom: allowed.packagingUom || 'كرتون' } : {}),
                notes: String(raw.notes || '').trim() || null });
        }
        const expectedNames = new Set(approved.map(item => item.itemName.toLowerCase()));
        if (receivedItems.length !== expectedNames.size || receivedItems.some(item => !expectedNames.has(item.itemName.toLowerCase()))) {
            await client.query('ROLLBACK');
            return fail(res, 422, 'RECEIPT_ITEMS_INCOMPLETE', 'يجب تسجيل استلام كل أصناف الإذن لمنع إسقاط أي كمية');
        }
        // Task 19: الاستلام إلى مخزن القسم الخاص (سلطات/حلواني/خباز/مطبخ ساخن/بيع خارجي)
        // والأقسام بلا مخزن مخصص تكمل في مخزن المطبخ كما في السلوك القديم
        const targetLocation = await getDispatchTargetLocation(client, dispatch.deptCode);
        const ledgerMovements = [];
        for (const received of receivedItems) {
            if (received.receivedDeltaQty <= 0) {continue;}
            const item = received.itemId
                ? (await client.query('SELECT id,name,unit,"avgCost" FROM inventory WHERE id=$1 FOR UPDATE', [received.itemId])).rows[0]
                : (await client.query('SELECT id,name,unit,"avgCost" FROM inventory WHERE LOWER(name)=LOWER($1) FOR UPDATE', [received.itemName])).rows[0];
            if (!item) {
                await client.query('ROLLBACK');
                return fail(res, 422, 'INVENTORY_ITEM_NOT_FOUND', `الصنف غير موجود في المخزن: ${received.itemName}`);
            }
            received.itemId = Number(item.id);
            received.itemName = item.name;
            received.unit = item.unit || received.unit || 'وحدة';
            const base = `dispatch:${dispatch.id}:receipt:${item.id}`;
            const receiptKey = signatureHash(receiptSignature);
            const inn = await postInventoryLedgerEntry(client, { transactionType:'transfer_in', inventoryId:item.id, locationId:targetLocation.id, quantityDelta:received.receivedDeltaQty, unit:received.unit, unitCost:n(item.avgCost), destinationLocationId:targetLocation.id, referenceType:'dispatch_receipt', referenceId:String(dispatch.id), userId:req.user.id, idempotencyKey:`${base}:${receiptKey}:in`, reason:`استلام مواد في ${targetLocation.name_ar} من إذن #${dispatch.id}`, metadata:{dispatch_id:dispatch.id, receipt_signature_hash:receiptKey, target_location:targetLocation.code,
                ...(received.receivedPackagingQty != null ? { received_packaging_qty: received.receivedPackagingQty, packaging_uom: received.packagingUom || 'كرتون' } : {}) },
                catchWeightQty: received.receivedPackagingQty != null ? received.receivedPackagingQty : null,
                catchWeightUnit: received.receivedPackagingQty != null ? (received.packagingUom || 'كرتون') : null });
            ledgerMovements.push({inventory_id:item.id,quantity:received.receivedDeltaQty,target_location:targetLocation.code,balance:inn.balanceAfter});
            // FIX C5 (Enterprise 2026-10-03): الاستلام كان يكتب الدفتر فقط —
            // صف "inventoryTx" الناقص جعل الاستلامات غير مرئية في شاشة سجل
            // الحركات. نفس نمط اعتماد الصرف (type='in') بدون أي أثر رصيدي
            // (الجدول تاريخي مجمد).
            await client.query(
                `INSERT INTO "inventoryTx" (id, "itemId", "itemName", qty, type, date, cost, "totalValue", notes, "dispatchId")
                 VALUES ($1,$2,$3,$4,'in',$5,$6,$7,$8,$9)`,
                [id(), item.id, item.name, received.receivedDeltaQty, dateOnly(dispatch.date),
                 n(item.avgCost), n(received.receivedDeltaQty) * n(item.avgCost),
                 `استلام مواد من إذن صرف #${dispatch.id} — ${targetLocation.name_ar || targetLocation.code}`,
                 String(dispatch.id)]);
            // ملاحظة: قيد مصروف القسم يُقيَّد عند الاعتماد (adjustmentType='dispatch') —
            // لا يُقيَّد هنا عند الاستلام تجنّبًا للاحتساب المزدوج؛ الإرجاع يعكسه بمصروف سالب.
        }
        const receivedAt = new Date().toISOString();
        const actorName = req.user.name || req.user.username || String(req.user.id);
        const nextStatus = allReceived ? 'received' : 'partially_received';
        const updated = (await client.query(`UPDATE dispatches SET status=$1, "receivedItems"=$2, "receiptNotes"=$3,
          "kitchenReceivedAt"=$4, "kitchenReceivedBy"=$5, "kitchenReceiptSignatureData"=$6,
          "kitchenReceiptSignatureHash"=$7 WHERE id=$8 RETURNING *`,
          [nextStatus, json(receivedItems), req.body?.notes || null, receivedAt, actorName, receiptSignature, signatureHash(receiptSignature), dispatch.id])).rows[0];
        await appendDispatchEvent(client, dispatch.id, 'kitchen_received', dispatch.status, nextStatus, req, receiptSignature, { receivedItems, notes: req.body?.notes || null });
        await client.query('COMMIT');
        emit(req, 'dispatches', 'update', updated);
        // Task 20: إشعار فوري — القسم استلم: المخازن والشيف يعرفان أن السلسلة أُغلقت
        ensureDispatchCreatorSchema().catch(() => {});
        notifyChainEvent(req, dispatch, 'received', { io: req.io });
        res.json({ dispatch: updated, receivedItems, ledgerMovements });
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        logger.error('[pr_create]', error);
        logger.error('[kitchen_dispatch_receive]', error);
        const status = error.code === 'INSUFFICIENT_STOCK' ? 409 : 500;
        const message = error.code === 'INSUFFICIENT_STOCK' ? 'تعذر إضافة الاستلام؛ تحقق من رصيد المخزن الرئيسي' : 'تعذر تسجيل استلام المطبخ بشكل موثق';
        res.status(status).json({ error: error.code || 'DISPATCH_RECEIVE_FAILED', message });
    } finally { client.release(); }
});

/**
 * إرجاع مباشر من قسم للمخزن الرئيسي (بلا إذن صرف مسبق):
 * فائض إنتاج/تشغيل يُعيده المطبخ أو أي قسم — يُطابق الأصناف بالمخزون،
 * يزيد الرصيد عبر الدفتر، ويسجل حركة + عكس مصروف القسم. لا سقف كميات
 * (لا إذن مرجعي) — الاعتماد على مطابقة الاسم والكمية الموجبة فقط.
 */
async function directReturn(client, req, res) {
    try {
        const deptCode = String(req.body?.deptCode || '').trim();
        if (!deptCode) {
            await client.query('ROLLBACK');
            return fail(res, 422, 'DEPT_REQUIRED', 'اختر القسم المُرجِع');
        }
        const dept = (await client.query(
            'SELECT code, name FROM departments WHERE LOWER(code) = LOWER($1) LIMIT 1', [deptCode])).rows[0];
        if (!dept) {
            await client.query('ROLLBACK');
            return fail(res, 422, 'DEPT_NOT_FOUND', `القسم غير موجود: ${deptCode}`);
        }
        const requested = normalizeRequestedItems(req.body?.items);
        if (!requested.length) {
            await client.query('ROLLBACK');
            return fail(res, 422, 'EMPTY_RETURN_ITEMS', 'يجب تحديد صنف وكمية للإرجاع');
        }
        const returnId = id();
        const mainLocation = await getWarehouseLocation(client, 'MAIN-WAREHOUSE', 'المخزن الرئيسي', 'warehouse');
        const returnItems = [];
        const stockChanges = [];
        const transactions = [];
        const expenses = [];
        let totalValue = 0;
        for (const requestedItem of requested) {
            if (!(requestedItem.qty > 0)) {
                await client.query('ROLLBACK');
                return fail(res, 422, 'INVALID_RETURN_QTY', `كمية غير صحيحة للصنف ${requestedItem.itemName}`);
            }
            const inv = (await client.query(
                'SELECT * FROM inventory WHERE LOWER(name) = LOWER($1) FOR UPDATE', [requestedItem.itemName])).rows[0];
            if (!inv) {
                await client.query('ROLLBACK');
                return fail(res, 422, 'INVENTORY_ITEM_NOT_FOUND', `الصنف غير موجود في المخزن: ${requestedItem.itemName}`);
            }
            const cost = n(inv.avgCost);
            const value = round(requestedItem.qty * cost, 2);
            const drBoxes = requestedItem.packagingQty ? n(requestedItem.packagingQty) : null;
            const drPackUom = requestedItem.packagingUom || inv.packaging_uom || null;
            await ensureLocationBalance(client, inv.id, mainLocation.id, n(inv.qty));
            await postInventoryLedgerEntry(client, {
                transactionType: 'return', inventoryId: Number(inv.id), locationId: mainLocation.id,
                quantityDelta: requestedItem.qty, unit: inv.unit || requestedItem.unit || 'وحدة', unitCost: cost,
                destinationLocationId: mainLocation.id,
                referenceType: 'direct_return', referenceId: String(returnId), userId: req.user.id,
                idempotencyKey: `direct-return:${returnId}:${inv.id}`,
                reason: `إرجاع مباشر من ${dept.name} — ${req.body?.reason || 'فائض'}`,
                metadata: { return_id: returnId, dept_code: dept.code, direct: true },
                catchWeightQty: drBoxes, catchWeightUnit: drBoxes !== null ? drPackUom : null,
            });
            const globalAfter = (await client.query('SELECT qty FROM inventory WHERE id=$1', [inv.id])).rows[0]?.qty;
            // المتوسط المرجح يشمل الكمية المرجعة بسعرها
            const drOldQty = n(inv.qty);
            if (round(drOldQty + requestedItem.qty) > 0) {
                await client.query('UPDATE inventory SET "avgCost"=$2 WHERE id=$1',
                    [inv.id, round(((drOldQty * n(inv.avgCost)) + (requestedItem.qty * cost)) / round(drOldQty + requestedItem.qty), 2)]);
            }
            const tx = (await client.query(
                `INSERT INTO "inventoryTx" (id, "itemId", "itemName", qty, type, date, cost, "totalValue", notes, "dispatchId", catch_weight_qty, catch_weight_unit)
                 VALUES ($1,$2,$3,$4,'return',$5,$6,$7,$8,NULL,$9,$10) RETURNING *`,
                [id(), inv.id, inv.name, requestedItem.qty, dateOnly(new Date()), cost, value,
                    `إرجاع مباشر من ${dept.name} — ${req.body?.reason || 'إرجاع'}`, drBoxes, drBoxes !== null ? drPackUom : null]
            )).rows[0];
            const expense = (await client.query(
                `INSERT INTO expenses (id, "deptId", "desc", amount, date, notes, "autoGenerated", category, "adjustmentType")
                 VALUES ($1,$2,$3,$4,$5,$6,true,'مواد خام','direct_return') RETURNING *`,
                [id(), dept.code, `عكس صرف - ${inv.name} (${requestedItem.qty} ${inv.unit || ''})`, -value,
                    dateOnly(new Date()), `إرجاع مباشر #${returnId} — حركة مخزون ${tx.id}`]
            )).rows[0];
            returnItems.push({ name: inv.name, itemName: inv.name, itemId: Number(inv.id), unit: inv.unit || requestedItem.unit || 'وحدة', qty: requestedItem.qty, avgCost: cost, totalValue: value,
                txId: tx.id, expenseId: expense.id,
                ...(drBoxes !== null ? { packagingQty: drBoxes, packagingUom: drPackUom } : {}) });
            stockChanges.push({ ...inv, qty: globalAfter });
            transactions.push(tx);
            expenses.push(expense);
            totalValue += value;
        }
        const returnRow = (await client.query(
            `INSERT INTO "kitchenReturns" (id, date, items, status, notes, reason, "dispatchId", "deptCode", "deptName", "totalValue", "createdBy")
             VALUES ($1,$2,$3,'approved',$4,$5,NULL,$6,$7,$8,$9) RETURNING *`,
            [returnId, dateOnly(new Date()), json(returnItems), req.body?.notes || null, req.body?.reason || 'إرجاع مباشر',
                dept.code, dept.name, round(totalValue, 2), req.user.username || String(req.user.id)]
        )).rows[0];
        // TASK 9: حدث دومين داخل نفس المعاملة (fail-open)
        await emitDomainEvent(pool, client, 'DISPATCH', {
            eventType: 'DISPATCH_RETURNED', aggregateType: 'kitchen_return', aggregateId: returnId,
            deptCode: dept.code,
            payload: { return_id: returnId, direct: true, dept: dept.code, total: round(totalValue, 2) },
        });
        await client.query('COMMIT');
        // عكس محاسبي متماثل best-effort (المباشر أيضًا يحرّك المخزون)
        try {
            await require('./accounting-routes').postReturnToLedger(returnRow.id, {
                totalValue, date: returnRow.date, deptCode: returnRow.deptCode,
            });
        } catch (ledgerErr) { logger.warn('[return_ledger] best-effort skipped:', ledgerErr.message); }
        emit(req, 'kitchenReturns', 'create', returnRow);
        for (const item of stockChanges) {emit(req, 'inventory', 'update', item);}
        for (const tx of transactions) {emit(req, 'inventoryTx', 'create', tx);}
        for (const expense of expenses) {emit(req, 'expenses', 'create', expense);}
        res.json({ return: returnRow, stockChanges, transactions, expenses, totalValue: round(totalValue, 2), direct: true });
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        logger.error('[pr_create]', error);
        logger.error('[warehouse/direct-return]', error.message);
        res.status(500).json({ error: 'DIRECT_RETURN_FAILED', message: 'تعذر تنفيذ الإرجاع المباشر' });
    }
    // ملاحظة: التحرير على المتصل الخارجي (finally في POST /returns) — تحرير مزدوج يفسد الـ pool
}

router.post('/returns', jwtAuth, requireRole(...RETURN_ROLES), async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const dispatchId = req.body?.dispatchId;
        // ─── إرجاع مباشر (بلا إذن صرف): قسم + أصناف مطابقة للمخزون ───
        // await إجبارية: الدالة تدير COMMIT/ROLLBACK وتحرر العميل بنفسها — بدونها
        // يُحرَّر العميل من finally الخارجي أثناء تنفيذ المعاملة (تلف بيانات)
        if (dispatchId === undefined || dispatchId === null || String(dispatchId).trim() === '') {
            return await directReturn(client, req, res);
        }
        const dispatchResult = await client.query('SELECT * FROM dispatches WHERE id = $1 FOR UPDATE', [dispatchId]);
        const dispatch = dispatchResult.rows[0];
        if (!dispatch) {
            await client.query('ROLLBACK');
            return fail(res, 404, 'DISPATCH_NOT_FOUND', 'طلب الصرف غير موجود');
        }
        if (!['approved', 'partially_received', 'received'].includes(dispatch.status)) {
            await client.query('ROLLBACK');
            return fail(res, 409, 'DISPATCH_NOT_APPROVED', 'لا يمكن إرجاع طلب غير معتمد');
        }

        // Once the kitchen has received (partially or fully), the returnable amount
        // for each item is capped by what was actually received
        const receivedRows = Array.isArray(dispatch.receivedItems) ? dispatch.receivedItems : [];
        const receivedByName = new Map(receivedRows.map(raw => [cleanName(raw.itemName || raw.name).toLowerCase(), n(raw.receivedQty ?? raw.qty)]));

        const approvedItems = normalizeRequestedItems(dispatch.approvedItems || dispatch.items);
        const alreadyReturned = new Map();
        const oldReturns = await client.query(
            'SELECT items FROM "kitchenReturns" WHERE "dispatchId" = $1 FOR UPDATE', [String(dispatch.id)]);
        for (const oldReturn of oldReturns.rows) {
            for (const raw of (oldReturn.items || [])) {
                const name = cleanName(raw.itemName || raw.name).toLowerCase();
                alreadyReturned.set(name, (alreadyReturned.get(name) || 0) + n(raw.qty));
            }
        }

        const requested = normalizeRequestedItems(req.body?.items);
        if (!requested.length) {
            await client.query('ROLLBACK');
            return fail(res, 422, 'EMPTY_RETURN_ITEMS', 'يجب تحديد صنف وكمية للإرجاع');
        }
        const approvedByName = new Map(approvedItems.map(item => [item.itemName.toLowerCase(), item]));
        const returnItems = [];
        const stockChanges = [];
        const transactions = [];
        const expenses = [];
        let totalValue = 0;
        const returnId = id();
        const mainLocation = await getWarehouseLocation(client, 'MAIN-WAREHOUSE', 'المخزن الرئيسي', 'warehouse');
        // Task 19: الإرجاع من مخزن القسم الذي استلم فعليًا (وليس مخزن المطبخ الثابت)
        const deptLocation = await getDispatchTargetLocation(client, dispatch.deptCode);

        for (const requestedItem of requested) {
            const approved = approvedByName.get(requestedItem.itemName.toLowerCase());
            const previouslyReturned = alreadyReturned.get(requestedItem.itemName.toLowerCase()) || 0;
            const approvedQty = n(approved?.qty);
            const receivedQty = receivedByName.has(requestedItem.itemName.toLowerCase())
                ? receivedByName.get(requestedItem.itemName.toLowerCase())
                : approvedQty;
            const returnableBase = receivedByName.size ? Math.min(approvedQty, receivedQty) : approvedQty;
            const remaining = round(returnableBase - previouslyReturned);
            if (!approved || requestedItem.qty > remaining) {
                await client.query('ROLLBACK');
                return fail(res, 409, 'RETURN_QTY_EXCEEDED', `كمية الإرجاع أكبر من الكمية المتبقية للصنف ${requestedItem.itemName}`, {
                    itemName: requestedItem.itemName, requested: requestedItem.qty, remaining,
                });
            }
            const invResult = await client.query(
                'SELECT * FROM inventory WHERE LOWER(name) = LOWER($1) FOR UPDATE', [requestedItem.itemName]);
            const inv = invResult.rows[0];
            if (!inv) {
                await client.query('ROLLBACK');
                return fail(res, 422, 'INVENTORY_ITEM_NOT_FOUND', `الصنف غير موجود في المخزن: ${requestedItem.itemName}`);
            }
            const cost = n(approved.avgCost, n(inv.avgCost));
            const value = round(requestedItem.qty * cost, 2);
            // Post the return through the inventory ledger so it persists across
            // ledger recomputations (direct qty writes are erased by the next posting)
            await ensureLocationBalance(client, inv.id, mainLocation.id, n(inv.qty));
            // إذا كان القسم قد استلم فعليًا (استلام مسجل) فإن البضاعة تقع في مخزن القسم،
            // فيجب خصمها من مخزن القسم أولاً وإلا بقيت محتسبة هناك ومُضافة للمخزن الرئيسي
            // معًا (ازدواج عالمي في المخزون). إذن لم يُستلم بعد، فالبضاعة لم تغادر المخزن
            // الرئيسي فعليًا — يكفي إرجاعها لرصيده مباشرة.
            const retBoxes = requestedItem.packagingQty ? n(requestedItem.packagingQty) : null;
            const retPackUom = requestedItem.packagingUom || inv.packaging_uom || null;
            if (receivedByName.size) {
                await postInventoryLedgerEntry(client, {
                    transactionType: 'transfer_out', inventoryId: Number(inv.id), locationId: deptLocation.id,
                    quantityDelta: -requestedItem.qty, unit: inv.unit || requestedItem.unit || 'وحدة', unitCost: cost,
                    sourceLocationId: deptLocation.id, destinationLocationId: mainLocation.id,
                    referenceType: 'kitchen_return', referenceId: String(dispatch.id), userId: req.user.id,
                    idempotencyKey: `dispatch-return:${returnId}:${inv.id}:out`,
                    reason: `خروج المرتجع من مخزن القسم ${dispatch.deptName || dispatch.deptCode} — إذن #${dispatch.id}`,
                    metadata: { dispatch_id: dispatch.id, return_id: returnId, note: 'returned_from_department_store' },
                    catchWeightQty: retBoxes, catchWeightUnit: retBoxes !== null ? retPackUom : null,
                });
            }
            await postInventoryLedgerEntry(client, {
                transactionType: 'return', inventoryId: Number(inv.id), locationId: mainLocation.id,
                quantityDelta: requestedItem.qty, unit: inv.unit || requestedItem.unit || 'وحدة', unitCost: cost,
                sourceLocationId: deptLocation.id, destinationLocationId: mainLocation.id,
                referenceType: 'kitchen_return', referenceId: String(dispatch.id), userId: req.user.id,
                idempotencyKey: `dispatch-return:${returnId}:${inv.id}`,
                reason: `إرجاع من القسم ${dispatch.deptName || dispatch.deptCode} — إذن #${dispatch.id}`,
                metadata: { dispatch_id: dispatch.id, return_id: returnId, note: 'returned_to_main_warehouse' },
                catchWeightQty: retBoxes, catchWeightUnit: retBoxes !== null ? retPackUom : null,
            });
            const globalAfter = (await client.query('SELECT qty FROM inventory WHERE id=$1', [inv.id])).rows[0]?.qty;
            // المتوسط المرجح يشمل الكمية المرجعة بسعرها — وإلا انحرف متوسط التكلفة
            const retOldQty = n(inv.qty);
            const retNewQty = round(retOldQty + requestedItem.qty);
            if (retNewQty > 0) {
                const retNewAvg = round(((retOldQty * n(inv.avgCost)) + (requestedItem.qty * cost)) / retNewQty, 2);
                await client.query('UPDATE inventory SET "avgCost"=$2 WHERE id=$1', [inv.id, retNewAvg]);
            }
            const dispatchRef = `DIS-${dispatch.id}`;
            const tx = (await client.query(
                `INSERT INTO "inventoryTx" (id, "itemId", "itemName", qty, type, date, cost, "totalValue", notes, "dispatchId", catch_weight_qty, catch_weight_unit)
                 VALUES ($1,$2,$3,$4,'return',$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
                [id(), inv.id, inv.name, requestedItem.qty, dateOnly(new Date()), cost, value,
                    `إرجاع من القسم ${dispatch.deptName || dispatch.deptCode} — ${req.body?.reason || 'إرجاع'}`, dispatchRef, retBoxes, retBoxes !== null ? retPackUom : null]
            )).rows[0];
            const expense = (await client.query(
                `INSERT INTO expenses (id, "deptId", "desc", amount, date, notes, "autoGenerated", category, "adjustmentType")
                 VALUES ($1,$2,$3,$4,$5,$6,true,'مواد خام','dispatch_return') RETURNING *`,
                [id(), dispatch.deptCode, `عكس صرف - ${inv.name} (${requestedItem.qty} ${inv.unit || requestedItem.unit})`, -value,
                    dateOnly(new Date()), `إرجاع طلب صرف #${dispatch.id} — حركة مخزون ${tx.id}`]
            )).rows[0];
            returnItems.push({ name: inv.name, itemName: inv.name, itemId: Number(inv.id), unit: inv.unit || requestedItem.unit || 'وحدة', qty: requestedItem.qty, avgCost: cost, totalValue: value,
                txId: tx.id, expenseId: expense.id,
                ...(requestedItem.actualWeight ? { actualWeight: requestedItem.actualWeight, packagingQty: requestedItem.packagingQty || null, packagingUom: requestedItem.packagingUom || inv.packaging_uom || null } : {}) });
            stockChanges.push({ ...inv, qty: globalAfter });
            transactions.push(tx);
            expenses.push(expense);
            totalValue += value;
            alreadyReturned.set(requestedItem.itemName.toLowerCase(), previouslyReturned + requestedItem.qty);
        }

        const returnRow = (await client.query(
            `INSERT INTO "kitchenReturns" (id, date, items, status, notes, reason, "dispatchId", "deptCode", "deptName", "totalValue", "createdBy")
             VALUES ($1,$2,$3,'approved',$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
            [returnId, dateOnly(new Date()), json(returnItems), req.body?.notes || null, req.body?.reason || null,
                String(dispatch.id), dispatch.deptCode, dispatch.deptName, round(totalValue, 2), req.user.username || String(req.user.id)]
        )).rows[0];
        // TASK 9: حدث دومين داخل نفس المعاملة (fail-open)
        await emitDomainEvent(pool, client, 'DISPATCH', {
            eventType: 'DISPATCH_RETURNED', aggregateType: 'kitchen_return', aggregateId: returnId,
            deptCode: dispatch.deptCode,
            payload: { return_id: returnId, dispatch_id: dispatch.id, dept: dispatch.deptCode, total: round(totalValue, 2) },
        });
        await client.query('COMMIT');

        // عكس محاسبي متماثل best-effort: Dr مخزون / Cr COGS
        try {
            await require('./accounting-routes').postReturnToLedger(returnRow.id, {
                totalValue, date: returnRow.date, deptCode: returnRow.deptCode,
            });
        } catch (ledgerErr) { logger.warn('[return_ledger] best-effort skipped:', ledgerErr.message); }

        emit(req, 'kitchenReturns', 'create', returnRow);
        // Task 20: إشعار فوري — إرجاع أصناف للقسم: المخازن والشيف يعرفان بالعكس
        ensureDispatchCreatorSchema().catch(() => {});
        notifyChainEvent(req, dispatch, 'returned', { io: req.io });
        for (const item of stockChanges) {emit(req, 'inventory', 'update', item);}
        for (const tx of transactions) {emit(req, 'inventoryTx', 'create', tx);}
        for (const expense of expenses) {emit(req, 'expenses', 'create', expense);}
        res.status(201).json({ return: returnRow, stockChanges, transactions, expenses, totalValue: round(totalValue, 2) });
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        logger.error('[pr_create]', error);
        logger.error('[warehouse_return]', error);
        if (error.code === 'INSUFFICIENT_STOCK') {
            return res.status(409).json({ error: 'INSUFFICIENT_STOCK', message: 'رصيد مخزن القسم لا يكفي لإرجاع هذه الكمية — قد تكون المواد مستهلكة بالفعل', available: error.available, requested: error.requested });
        }
        res.status(500).json({ error: 'KITCHEN_RETURN_FAILED', message: 'تعذر تنفيذ الإرجاع العكسي بشكل ذري' });
    } finally {
        client.release();
    }
});



// ─── DELETE /api/warehouse/returns/:id — حذف سجل مرتجع مع عكس أثره المخزني ───
// الحذف الصامت كان يُبقي المخزون متضخمًا (+qty بلا عكس). الآن: قيدان تعويضيان
// (عكس كل حركة) + حذف حركات Tx والمصاريف المرتبطة + حذف السجل — كله ذريًا.
// السجلات القديمة بلا ربط (txId) تُرفض بـ 409 لحمايتها من العكس الأعمى.
router.delete('/returns/:id', jwtAuth, requireRole('admin', 'manager', 'warehouse'), async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const returnId = req.params.id;
        const existing = (await client.query('SELECT * FROM "kitchenReturns" WHERE id = $1 FOR UPDATE', [returnId])).rows[0];
        if (!existing) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'NOT_FOUND', message: 'سجل المرتجع غير موجود' });
        }
        const items = Array.isArray(existing.items) ? existing.items : [];
        const mainLocation = await getWarehouseLocation(client, 'MAIN-WAREHOUSE', 'المخزن الرئيسي', 'warehouse');
        let deptLocation = mainLocation;
        if (existing.dispatchId) {
            const dispatchRow = (await client.query('SELECT "deptCode" FROM dispatches WHERE id = $1', [existing.dispatchId])).rows[0];
            if (!dispatchRow) {
                await client.query('ROLLBACK');
                return res.status(409).json({ error: 'RETURN_DEPT_UNKNOWN', message: 'إذن الصرف الأصلي محذوف — تعذر تحديد مخزن القسم للعكس، عالجه يدويًا بقيد تسوية' });
            }
            deptLocation = await getDispatchTargetLocation(client, dispatchRow.deptCode);
        }
        for (const raw of items) {
            const itemId = Number(raw.itemId || raw.item_id);
            const qty = n(raw.qty);
            if (!Number.isInteger(itemId) || !(qty > 0)) {
                await client.query('ROLLBACK');
                return res.status(409).json({ error: 'RETURN_NOT_REVERSIBLE', message: `سجل قديم بلا بيانات ربط كافية للصنف ${raw.itemName || raw.name || '؟'} — عالجه يدويًا بقيد تسوية` });
            }
            const hasLinkage = raw.txId != null;
            // عكس أثر المرتجع: سحب ما أُضيف للمخزن الرئيسي، وإعادة ما خُصم من مخزن القسم
            await postInventoryLedgerEntry(client, {
                transactionType: 'reversal', inventoryId: itemId, locationId: mainLocation.id,
                quantityDelta: -qty, unit: raw.unit || 'وحدة', unitCost: n(raw.avgCost),
                referenceType: 'kitchen_return_void', referenceId: String(returnId), userId: req.user.id,
                idempotencyKey: `return-void:${returnId}:${itemId}:main`,
                reason: `إلغاء مرتجع #${returnId} — عكس الإضافة للمخزن الرئيسي`,
                metadata: { return_id: returnId },
                catchWeightQty: raw.packagingQty != null ? n(raw.packagingQty) : null,
                catchWeightUnit: raw.packagingQty != null ? (raw.packagingUom || 'كرتون') : null,
            });
            if (existing.dispatchId) {
                await postInventoryLedgerEntry(client, {
                    transactionType: 'transfer_in', inventoryId: itemId, locationId: deptLocation.id,
                    quantityDelta: qty, unit: raw.unit || 'وحدة', unitCost: n(raw.avgCost),
                    sourceLocationId: mainLocation.id, destinationLocationId: deptLocation.id,
                    referenceType: 'kitchen_return_void', referenceId: String(returnId), userId: req.user.id,
                    idempotencyKey: `return-void:${returnId}:${itemId}:dept`,
                    reason: `إلغاء مرتجع #${returnId} — إعادة الكمية لمخزن القسم`,
                    metadata: { return_id: returnId },
                    catchWeightQty: raw.packagingQty != null ? n(raw.packagingQty) : null,
                    catchWeightUnit: raw.packagingQty != null ? (raw.packagingUom || 'كرتون') : null,
                });
            }
            if (hasLinkage) {
                await client.query('DELETE FROM "inventoryTx" WHERE id = $1', [raw.txId]);
                await client.query('DELETE FROM expenses WHERE id = $1 AND "adjustmentType" IN (\'dispatch_return\', \'direct_return\')', [raw.expenseId]);
            } else {
                await client.query('ROLLBACK');
                return res.status(409).json({ error: 'RETURN_NOT_REVERSIBLE', message: `المرتجع #${returnId} قديم بلا ربط حركات — احذفه يدويًا بقيد تسوية موثق` });
            }
        }
        await client.query('DELETE FROM "kitchenReturns" WHERE id = $1', [returnId]);
        await client.query('COMMIT');
        emit(req, 'kitchenReturns', 'delete', { id: returnId });
        res.json({ ok: true, message: 'تم حذف سجل المرتجع وعكس أثره المخزني بالكامل' });
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        logger.error('[pr_create]', error);
        logger.error('[warehouse_return_delete]', error);
        if (error.code === 'INSUFFICIENT_STOCK') {
            return res.status(409).json({ error: 'INSUFFICIENT_STOCK', message: 'رصيد المخزن الرئيسي لا يكفي لعكس المرتجع — راجع الحركات اللاحقة' });
        }
        res.status(500).json({ error: 'KITCHEN_RETURN_DELETE_FAILED', message: 'تعذر حذف سجل المرتجع' });
    } finally {
        client.release();
    }
});

router.post('/inventory/:id/receipt', jwtAuth, requireRole('admin', 'manager', 'warehouse'), async (req, res) => {
    const client = await pool.connect();
    try {
        const inventoryId = Number(req.params.id);
        const qty = n(req.body?.qty);
        const price = n(req.body?.price);
        if (!Number.isInteger(inventoryId) || inventoryId <= 0 || !(qty > 0) || price < 0) {
            return fail(res, 422, 'INVALID_RECEIPT', 'أدخل صنفًا وكمية وسعرًا صحيحين');
        }
        await client.query('BEGIN');
        const item = (await client.query('SELECT * FROM inventory WHERE id=$1 FOR UPDATE', [inventoryId])).rows[0];
        if (!item) {
            await client.query('ROLLBACK');
            return fail(res, 404, 'INVENTORY_ITEM_NOT_FOUND', 'الصنف غير موجود');
        }
        const requestedUnit = cleanName(req.body?.unit) || item.unit || 'وحدة';
        if (requestedUnit.trim().toLowerCase() !== String(item.unit || 'وحدة').trim().toLowerCase()) {
            await client.query('ROLLBACK');
            return fail(res, 422, 'UNIT_MISMATCH', `وحدة الصنف المسجلة هي «${item.unit || 'وحدة'}» — لا يمكن إضافة كمية بوحدة «${requestedUnit}»`);
        }
        const mainLocation = await getWarehouseLocation(client, 'MAIN-WAREHOUSE', 'المخزن الرئيسي', 'warehouse');
        const oldQty = n(item.qty);
        const oldCost = n(item.avgCost);
        const nextQty = oldQty + qty;
        const nextCost = nextQty > 0 ? round(((oldQty * oldCost) + (qty * price)) / nextQty, 2) : round(price, 2);
        await client.query('UPDATE inventory SET "avgCost"=$2 WHERE id=$1', [inventoryId, nextCost]);
        const referenceId = `MANUAL-${id()}`;
        await ensureLocationBalance(client, inventoryId, mainLocation.id, oldQty);
        await postInventoryLedgerEntry(client, {
            transactionType: 'purchase_receipt', inventoryId, locationId: mainLocation.id,
            quantityDelta: round(qty), unit: item.unit || requestedUnit, unitCost: price,
            referenceType: 'manual_receipt', referenceId, userId: req.user.id,
            idempotencyKey: `manual-receipt:${referenceId}`,
            reason: 'إضافة مخزون يدوية عبر المسح', metadata: { manual_receipt: true },
        });
        const tx = (await client.query(
            `INSERT INTO "inventoryTx" (id, "itemId", "itemName", qty, type, date, cost, "totalValue", notes)
             VALUES ($1,$2,$3,$4,'in',$5,$6,$7,$8) RETURNING *`,
            [id(), inventoryId, item.name, round(qty), dateOnly(new Date()), price, round(qty * price, 2), 'إضافة مخزون يدوية عبر المسح']
        )).rows[0];
        const fresh = (await client.query('SELECT * FROM inventory WHERE id=$1', [inventoryId])).rows[0];
        await client.query('COMMIT');
        emit(req, 'inventory', 'update', fresh);
        emit(req, 'inventoryTx', 'create', tx);
        return res.status(201).json({ inventory: fresh, transaction: tx });
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        logger.error('[warehouse_manual_receipt]', error);
        if (error.code === 'INSUFFICIENT_STOCK') {return fail(res, 409, 'INSUFFICIENT_STOCK', 'رصيد المخزن لا يسمح بإتمام الحركة');}
        return res.status(500).json({ error: 'MANUAL_RECEIPT_FAILED', message: 'تعذر تسجيل حركة الإضافة المخزنية' });
    } finally { client.release(); }
});

router.post('/inventory/bulk-receipt', jwtAuth, requireRole('admin', 'manager', 'warehouse'), async (req, res) => {
    const client = await pool.connect();
    try {
        const rawItems = Array.isArray(req.body?.items) ? req.body.items : [];
        const items = rawItems.map(raw => ({
            name: cleanName(raw.name || raw.itemName), category: cleanName(raw.category) || 'عام',
            unit: cleanName(raw.unit) || 'قطعة', qty: n(raw.qty), price: n(raw.price), minQty: Math.max(0, n(raw.minQty, 5)),
        })).filter(item => item.name && item.qty > 0 && item.price >= 0);
        if (!items.length) {return fail(res, 422, 'EMPTY_BULK_RECEIPT', 'لا توجد أصناف صالحة للاستيراد');}
        await client.query('BEGIN');
        const mainLocation = await getWarehouseLocation(client, 'MAIN-WAREHOUSE', 'المخزن الرئيسي', 'warehouse');
        const inventory = [], transactions = [];
        const batchId = `BULK-${id()}`;
        // إصلاح جذري 2026-10-04 (من اختبار استيراد 329 صنفًا): id() العام = مللي ثانية +
        // عشوائي صغير — الإدخالات المتتالية السريعة تصطدم بمفتاح أساسي → تراجع كامل → 500.
        // مولّد محلي رتيب للدفعة يضمن التفرد داخل الحلقة بلا أي تغيير على باقي النظام.
        let _bulkSeq = 0;
        const bulkId = () => Date.now() * 1000 + (_bulkSeq++);
        // PERF + حديد: جلب واحد لكل الأسماء والمطابقة بالمفتاح المطبع — الأسماء المتشابهة
        // شكلًا (مسافات زايدة/همزات) تطابق الصنف الموجود بدل إنشاء مكرر، والأقفال لكل صف
        // مطابق عند لمسه (نفس دلالات FOR UPDATE الأصلية)
        const allRows = await client.query('SELECT id, name FROM inventory');
        const existingByKey = new Map(allRows.rows.map(r => [normItemName(r.name), Number(r.id)]));
        for (const item of items) {
            const matchKey = normItemName(item.name);
            const matchedId = existingByKey.get(matchKey);
            let inv = matchedId
                ? (await client.query('SELECT * FROM inventory WHERE id=$1 FOR UPDATE', [matchedId])).rows[0]
                : null;
            if (inv && String(inv.unit || 'قطعة').trim().toLowerCase() !== item.unit.trim().toLowerCase()) {
                await client.query('ROLLBACK');
                return fail(res, 422, 'UNIT_MISMATCH', `الصنف «${inv.name}» مسجل بوحدة «${inv.unit || 'قطعة'}» وليس «${item.unit}»`);
            }
            const oldQty = inv ? n(inv.qty) : 0;
            const oldCost = inv ? n(inv.avgCost) : 0;
            const nextQty = oldQty + item.qty;
            const nextCost = nextQty > 0 ? round(((oldQty * oldCost) + (item.qty * item.price)) / nextQty, 2) : round(item.price, 2);
            if (!inv) {
                inv = (await client.query(
                    `INSERT INTO inventory (id,name,category,unit,qty,"avgCost","minQty",weight)
                     VALUES ($1,$2,$3,$4,0,$5,$6,0) RETURNING *`,
                    [bulkId(), item.name, item.category, item.unit, nextCost, item.minQty]
                )).rows[0];
                existingByKey.set(matchKey, Number(inv.id));
            } else {
                inv = (await client.query(
                    `UPDATE inventory SET "avgCost"=$2, category=COALESCE(NULLIF($3,''),category), "minQty"=$4 WHERE id=$1 RETURNING *`,
                    [inv.id, nextCost, item.category, item.minQty]
                )).rows[0];
            }
            await ensureLocationBalance(client, inv.id, mainLocation.id, oldQty);
            await postInventoryLedgerEntry(client, {
                transactionType: 'purchase_receipt', inventoryId: Number(inv.id), locationId: mainLocation.id,
                quantityDelta: round(item.qty), unit: inv.unit || item.unit, unitCost: item.price,
                referenceType: 'bulk_receipt', referenceId: batchId, userId: req.user.id,
                idempotencyKey: `bulk-receipt:${batchId}:${inv.id}`, reason: 'استيراد مخزون دفعي من Excel',
                metadata: { bulk_receipt: true, batch_id: batchId },
            });
            const tx = (await client.query(
                `INSERT INTO "inventoryTx" (id,"itemId","itemName",qty,type,date,cost,"totalValue",notes)
                 VALUES ($1,$2,$3,$4,'in',$5,$6,$7,$8) RETURNING *`,
                [bulkId(), inv.id, inv.name, round(item.qty), dateOnly(new Date()), item.price, round(item.qty * item.price, 2), 'استيراد مخزون دفعي من Excel']
            )).rows[0];
            inventory.push(inv); transactions.push(tx);
        }
        const freshInventory = (await client.query('SELECT * FROM inventory WHERE id=ANY($1::bigint[]) ORDER BY id', [inventory.map(row => row.id)])).rows;
        await client.query('COMMIT');
        for (const row of freshInventory) {emit(req, 'inventory', 'update', row);}
        for (const tx of transactions) {emit(req, 'inventoryTx', 'create', tx);}
        return res.status(201).json({ inventory: freshInventory, transactions, batchId });
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        logger.error('[warehouse_bulk_receipt]', error);
        return res.status(500).json({ error: 'BULK_RECEIPT_FAILED', message: 'تعذر تسجيل استيراد المخزون' });
    } finally { client.release(); }
});

// ─── Smart inventory search: GET /warehouse/inventory/search ────────────────
// ─── ذكاء البحث العربي (طلب المالك 2026-10-06: «بكتب بازنجان مش جايبها اكتب باذنجان يجيبها») ───
// كل حرف من استعلام المستخدم يتوسع لعائلة الحروف المتشابهة بالنقاط — فتجد الصنف رغم الخطأ المطبعي
// (المنطق في ar-search.js — مشترك بين كل مسارات البحث بالخادم)
const { arFuzzyPattern } = require('./ar-search');

// q → name (partial, trgm) OR barcode OR category · category exact · stock
// filter (all|low|out|ok) server-side · always paginated · parameterized.
router.get('/inventory/search', jwtAuth, requireRole('admin', 'manager', 'warehouse', 'accountant'), async (req, res) => {
    try {
        const q = String(req.query.q ?? '').trim().slice(0, 100);
        const category = String(req.query.category ?? 'all').trim().slice(0, 100);
        const stock = String(req.query.stock ?? 'all').trim().toLowerCase();
        if (!['all', 'low', 'out', 'ok'].includes(stock)) {
            return fail(res, 422, 'INVALID_STOCK_FILTER', 'فلتر المخزون غير معروف');
        }
        let page = Number.parseInt(req.query.page, 10);
        if (!Number.isInteger(page) || page < 1) {page = 1;}
        let limit = Number.parseInt(req.query.limit, 10);
        if (!Number.isInteger(limit) || limit < 1) {limit = 50;}
        limit = Math.min(limit, 200);
        const offset = (page - 1) * limit;

        const buildClauses = (term) => {
            const cl = []; const ps = [];
            if (term) {
                ps.push(term);
                const i = ps.length;
                cl.push(`(i.name ILIKE '%' || $${i} || '%' OR COALESCE(i.barcode,'') ILIKE '%' || $${i} || '%' OR COALESCE(i.category,'') ILIKE '%' || $${i} || '%')`);
            }
            if (category && category !== 'all') {
                ps.push(category);
                cl.push(`i.category = $${ps.length}`);
            }
            if (stock === 'out') {cl.push(`COALESCE(i.qty,0) <= 0`);}
            else if (stock === 'low') {cl.push(`COALESCE(i.qty,0) > 0 AND COALESCE(i.qty,0) <= COALESCE(i."minQty",0)`);}
            else if (stock === 'ok') {cl.push(`COALESCE(i.qty,0) > COALESCE(i."minQty",0)`);}
            return { cl, ps };
        };

        let { cl: clauses, ps: params } = buildClauses(q || '');
        let where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
        let total = Number((await pool.query(
            `SELECT COUNT(*)::int AS c FROM inventory i ${where}`, params)).rows[0].c);

        // طبقة التسامح: لا نتائج بالبحث الحرفي → البحث بعائلات الحروف (بازنجان تجد باذنجان)
        let fuzzyUsed = false;
        if (q && total === 0) {
            const pattern = arFuzzyPattern(q);
            if (pattern) {
                const f = buildClauses('');
                f.ps.push(pattern);
                f.cl.unshift(`i.name ~* $1`);
                const fWhere = f.cl.length ? `WHERE ${f.cl.join(' AND ')}` : '';
                total = Number((await pool.query(
                    `SELECT COUNT(*)::int AS c FROM inventory i ${fWhere}`, f.ps)).rows[0].c);
                if (total > 0) {
                    fuzzyUsed = true;
                    clauses = f.cl; params = f.ps; where = fWhere;
                }
            }
        }

        // 2026-10-05 (طلب المالك): «إذن صرف 4 يعني الباقي 4» — العمود الأساسي يعرض
        // رصيد المخزن الرئيسي، وما ذهب لمخازن الأقسام في عمود مستقل، والإجمالي كما هو
        const rows = (await pool.query(
            `SELECT i.id, i.name, i.category, i.unit, i.qty, i."avgCost", i."minQty",
                    i.weight, i.barcode, i."shelfId",
                    COALESCE(mb.on_hand, 0) AS "mainQty"
             FROM inventory i
             LEFT JOIN inventory_location_balances mb
                    ON mb.inventory_id = i.id
                   AND mb.location_id = (SELECT id FROM inventory_locations WHERE code='MAIN-WAREHOUSE' AND active=true LIMIT 1)
             ${where}
             ORDER BY i.category NULLS LAST, i.name ASC
             LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
            [...params, limit, offset])).rows;
        const categories = (await pool.query(
            `SELECT DISTINCT category FROM inventory WHERE category IS NOT NULL AND category <> '' ORDER BY category`)).rows
            .map(r => r.category);
        const pages = total === 0 ? 0 : Math.ceil(total / limit);
        res.json({ data: rows, pagination: { page, limit, total, pages }, categories, fuzzy: fuzzyUsed });
    } catch (error) {
        logger.error('[warehouse_inventory_search]', error);
        fail(res, 500, 'INVENTORY_SEARCH_FAILED', 'تعذر البحث في الأصناف');
    }
});

router.post('/purchase-invoices', jwtAuth, requireRole('admin', 'manager', 'warehouse'), async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const requestedInvoiceNumber = cleanName(req.body?.invoiceNumber);
        const requestedDate = req.body?.date;
        const paymentMethod = cleanName(req.body?.paymentMethod || 'cash').toLowerCase();
        const allowedPaymentMethods = new Set(['cash', 'bank', 'card', 'cheque', 'credit']);
        if (requestedDate && (!/^\d{4}-\d{2}-\d{2}$/.test(String(requestedDate)) || Number.isNaN(new Date(`${requestedDate}T00:00:00Z`).getTime()))) {
            await client.query('ROLLBACK');
            return fail(res, 422, 'INVALID_INVOICE_DATE', 'تاريخ الفاتورة غير صحيح');
        }
        if (!allowedPaymentMethods.has(paymentMethod)) {
            await client.query('ROLLBACK');
            return fail(res, 422, 'INVALID_PAYMENT_METHOD', 'طريقة الدفع غير معتمدة');
        }
        if (requestedInvoiceNumber) {
            const duplicateNumber = await client.query('SELECT id FROM "purchaseInvoices" WHERE "invoiceNumber"=$1 LIMIT 1', [requestedInvoiceNumber]);
            if (duplicateNumber.rows.length) {
                await client.query('ROLLBACK');
                return fail(res, 409, 'DUPLICATE_INVOICE_NUMBER', 'رقم الفاتورة مستخدم من قبل');
            }
        }

        const rawItems = Array.isArray(req.body?.items) ? req.body.items : [];
        const validItems = rawItems.map(raw => {
            const pkg = raw.packagingQty ?? raw.packaging_qty ?? raw.catch_weight_qty ?? null;
            const pkgQty = pkg === null || pkg === undefined || pkg === '' ? null : n(pkg);
            return {
                itemName: cleanName(raw.itemName || raw.name),
                itemId: raw.itemId || raw.item_id || null,
                category: cleanName(raw.category) || 'عام',
                unit: cleanName(raw.unit) || 'وحدة',
                unitProvided: raw.unit !== undefined && raw.unit !== null && cleanName(raw.unit) !== '',
                qty: round(n(raw.qty), 3),
                price: round(n(raw.price), 2),
                taxCategory: String(raw.tax_category ?? raw.taxCategory ?? 'STANDARD').trim().toUpperCase(),
                weight: Math.max(0, n(raw.weight)),
                packagingQty: pkgQty !== null && Number.isFinite(pkgQty) && pkgQty >= 0 ? pkgQty : null,
                packagingUom: cleanName(raw.packagingUom || raw.packaging_uom || raw.catch_weight_unit) || null,
            };
        }).filter(item => item.itemName && item.qty > 0 && item.price >= 0);
        if (!validItems.length) {
            await client.query('ROLLBACK');
            return fail(res, 422, 'EMPTY_INVOICE_ITEMS', 'أضف صنفاً واحداً على الأقل بكمية صحيحة');
        }
        if (validItems.some(item => !Number.isFinite(item.qty) || !Number.isFinite(item.price) ||
            item.qty <= 0 || item.price < 0 || !['STANDARD', 'ZERO_RATED', 'EXEMPT', 'OUT_OF_SCOPE'].includes(item.taxCategory))) {
            await client.query('ROLLBACK');
            return fail(res, 422, 'INVALID_INVOICE_ITEM', 'تحقق من الكمية والسعر والفئة الضريبية لكل صنف');
        }
        const discountType = String(req.body?.discountType || 'none').toLowerCase();
        const discountValue = Number(req.body?.discountValue || 0);
        let discount;
        try {
            discount = allocatePurchaseDiscount(validItems, discountType, discountValue);
        } catch (error) {
            await client.query('ROLLBACK');
            return fail(res, 422, error.code || 'INVALID_INVOICE_DISCOUNT', error.message);
        }
        const discountAmount = discount.discountAmount;
        validItems.splice(0, validItems.length, ...discount.items);

        const inventoryRows = [];
        const transactions = [];
        const invoiceItems = [];
        let totalAmount = 0;
        const createdNames = [];
        const invoiceId = id();
        const mainLocation = await getWarehouseLocation(client, 'MAIN-WAREHOUSE', 'المخزن الرئيسي', 'warehouse');
        // PERF: جلب مجمع واحد لكل الأسماء بأقفالها — نفس إصلاح bulk-receipt:
        // LOWER(name) بلا فهرس كان = مسح كامل للجدول لكل صنف (349 صنفًا = انقطاع مهلة 30 ثانية).
        // PERF + حديد: مطابقة بالمفتاح المطبع — الأسماء المتشابهة شكلًا تطابق الموجود بدل إنشاء مكرر
        const allRows = await client.query('SELECT id, name FROM inventory');
        const existingByKey = new Map(allRows.rows.map(r => [normItemName(r.name), Number(r.id)]));
        for (const item of validItems) {
            const matchKey = normItemName(item.itemName);
            const matchedId = existingByKey.get(matchKey);
            let inv = matchedId
                ? (await client.query('SELECT * FROM inventory WHERE id=$1 FOR UPDATE', [matchedId])).rows[0]
                : null;
            if (inv && item.unitProvided && String(item.unit).trim().toLowerCase() !== String(inv.unit || 'وحدة').trim().toLowerCase()) {
                await client.query('ROLLBACK');
                return fail(res, 422, 'UNIT_MISMATCH', `الصنف «${inv.name}» مسجل بوحدة «${inv.unit || 'وحدة'}» وليس «${item.unit}»`);
            }
            if (!inv) {
                // The quantity is added by the ledger posting below — create at 0 to avoid double counting
                inv = (await client.query(
                    `INSERT INTO inventory (id, name, category, unit, qty, "avgCost", "minQty", weight)
                     VALUES ($1,$2,$3,$4,0,$5,0,$6) RETURNING *`,
                    [id(), item.itemName, item.category, item.unit, item.effectivePrice, round(item.weight)]
                )).rows[0];
                createdNames.push(inv.name);
                existingByKey.set(matchKey, Number(inv.id));
            } else {
                const oldQty = n(inv.qty);
                const nextQty = round(oldQty + item.qty);
                const nextCost = nextQty > 0 ? round(((oldQty * n(inv.avgCost)) + (item.qty * item.effectivePrice)) / nextQty, 2) : round(item.effectivePrice, 2);
                // qty itself is maintained by the inventory ledger (recomputed from location balances)
                inv = (await client.query(
                    `UPDATE inventory SET "avgCost"=$2, weight=COALESCE(weight,0)+$3 WHERE id=$1 RETURNING *`,
                    [inv.id, nextCost, round(item.weight)]
                )).rows[0];
            }
            // Post the receipt through the inventory ledger so the purchase is never
            // silently erased by the next ledger recomputation
            await ensureLocationBalance(client, inv.id, mainLocation.id, n(inv.qty));
            await postInventoryLedgerEntry(client, {
                transactionType: 'purchase_receipt', inventoryId: Number(inv.id), locationId: mainLocation.id,
                quantityDelta: round(item.qty), unit: inv.unit || item.unit || 'وحدة', unitCost: item.effectivePrice,
                referenceType: 'purchase_invoice', referenceId: String(invoiceId), userId: req.user.id,
                idempotencyKey: `purchase:${invoiceId}:${inv.id}`,
                reason: `استلام فاتورة شراء ${req.body?.invoiceNumber || invoiceId}`.trim(),
                metadata: { invoice_id: invoiceId, invoice_number: req.body?.invoiceNumber || null, supplier_name: req.body?.supplierName || null,
                    ...(item.packagingQty !== null ? { packaging_qty: item.packagingQty, packaging_uom: item.packagingUom || inv.packaging_uom || 'كرتون' } : {}) },
                catchWeightQty: item.packagingQty, catchWeightUnit: item.packagingQty !== null ? (item.packagingUom || inv.packaging_uom || 'كرتون') : null,
            });
            const lineTotal = item.total;
            totalAmount += lineTotal;
            const tx = (await client.query(
                `INSERT INTO "inventoryTx" (id, "itemId", "itemName", qty, type, date, cost, "totalValue", notes, "invoiceNumber", "supplierName", weight, catch_weight_qty, catch_weight_unit)
                 VALUES ($1,$2,$3,$4,'in',$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
                [id(), inv.id, inv.name, round(item.qty), dateOnly(req.body?.date), item.effectivePrice, lineTotal,
                    `استلام فاتورة شراء ${req.body?.invoiceNumber || ''}`.trim(), req.body?.invoiceNumber || null,
                    req.body?.supplierName || null, round(item.weight), item.packagingQty, item.packagingQty !== null ? (item.packagingUom || inv.packaging_uom || 'كرتون') : null]
            )).rows[0];
            inventoryRows.push(inv);
            transactions.push(tx);
            invoiceItems.push({ ...item, itemId: Number(inv.id), itemName: inv.name, total: lineTotal });
        }

        // ─── قراءة نهائية للكميات بعد ترحيل الدفتر ───
        // كميات الصفوف أعلاه تُلتقط قبل ترحيل الاستلام (الكمية تُعاد حسابها
        // من أرصدة المواقع داخل الدفتر) — إرسالها كما هي كان يجعل الواجهة
        // والبث المباشر يعرضان رصيدًا قديمًا حتى تحديث يدوي للصفحة.
        const freshInventory = inventoryRows.length
            ? (await client.query(
                'SELECT * FROM inventory WHERE id = ANY($1::bigint[]) ORDER BY id',
                [inventoryRows.map(r => r.id)]
            )).rows
            : [];
        inventoryRows.length = 0;
        inventoryRows.push(...freshInventory);

        // ─── الربط المالي: مورد الدفعة + المسدد + حالة السداد ───
        let supplierId = req.body?.supplierId !== undefined && req.body?.supplierId !== null && req.body?.supplierId !== ''
            ? Number(req.body.supplierId) : null;
        let supplierRow = null;
        const requestedSupplierName = cleanName(req.body?.supplierName);
        // ذكاء الربط: اسم حر يطابق موردًا مسجلًا (تطابق تام بعد التطبيع) → يُربط تلقائيًا
        // حتى لا تُنشأ فاتورة «بدون ربط» لنفس المورد الموجود أصلًا في دليل الموردين.
        if (supplierId === null && requestedSupplierName) {
            const byName = (await client.query(
                `SELECT id, name, is_active FROM suppliers WHERE LOWER(name) = LOWER($1) LIMIT 1`,
                [requestedSupplierName])).rows[0];
            if (byName) { supplierId = Number(byName.id); supplierRow = byName; }
        }
        if (supplierId === null && /افتتاحي/.test(requestedSupplierName)) {
            supplierRow = (await client.query(
                `SELECT id, name, is_active FROM suppliers
                 WHERE category = 'افتتاحي' OR name ILIKE '%افتتاحي%'
                 ORDER BY id LIMIT 1`
            )).rows[0] || null;
            if (!supplierRow) {
                supplierRow = (await client.query(
                    `INSERT INTO suppliers (id, name, category, "openingBalance", is_active)
                     VALUES ($1,$2,'افتتاحي',0,true) RETURNING id, name, is_active`,
                    [id(), requestedSupplierName || 'رصيد افتتاحي - بداية الفترة']
                )).rows[0];
            }
            supplierId = Number(supplierRow.id);
        }
        if (supplierId !== null) {
            if (!Number.isInteger(supplierId)) {
                await client.query('ROLLBACK');
                return fail(res, 422, 'INVALID_SUPPLIER', 'معرف المورد غير صحيح');
            }
            supplierRow = (await client.query(
                `SELECT id, name, is_active, tax_registration_status, vat_number, commercial_register
                  FROM suppliers WHERE id=$1`, [supplierId])).rows[0];
            if (!supplierRow) {
                await client.query('ROLLBACK');
                return fail(res, 422, 'SUPPLIER_NOT_FOUND', 'المورد المحدد غير موجود');
            }
            if (!supplierRow.is_active) {
                await client.query('ROLLBACK');
                return fail(res, 409, 'SUPPLIER_INACTIVE', `المورد «${supplierRow.name}» موقوف — فعّله قبل إنشاء الفواتير`);
            }
        }
        // ─── VAT engine: Supplier → Tax Profile → Rule → Line VAT ──────────
        // بدون مورد مربوط: لا ملف ضريبي → ضريبة صفر (لا يُدَّعى input VAT).
        // بمورد NOT_REGISTERED/EXEMPT أو أصناف معفاة: القاعدة تقرر (غالبًا صفر).
        // totalAmount = الإجمالي الشامل (صافي + ضريبة) — الدفعات والحالة عليه.
        const standardRate = await loadStandardRate(pool);
        const supplierProfile = supplierRow
            ? {
                status: supplierRow.tax_registration_status || 'NOT_REGISTERED',
                vat_number: supplierRow.vat_number || null,
                country: 'SA',
            }
            : { status: 'NOT_REGISTERED', vat_number: null, country: 'SA' };
        let vatCalc;
        try {
            vatCalc = computeInvoiceVat(
                invoiceItems.map((it) => ({ net: it.total, taxCategory: it.taxCategory || 'STANDARD' })),
                supplierProfile,
                { transactionDate: dateOnly(requestedDate) || riyadhToday(), standardRate }
            );
        } catch (taxErr) {
            await client.query('ROLLBACK');
            return fail(res, 422, 'INVALID_TAX_CATEGORY', String(taxErr.message).slice(0, 200));
        }
        const invoiceNet = vatCalc.subtotalNet;
        const invoiceVat = vatCalc.vatTotal;
        const invoiceTotal = vatCalc.grandTotal;
        // ─── منع الإضافة المكررة (نفس المستخدم + مورد + مبلغ خلال 10 دقائق) ───
        // FIX: كانت هذه الكتلة داخل منطق المورد أعلاه وتقرأ invoiceTotal قبل
        // تعريفه → ReferenceError 500 لأي فاتورة بمورد. مكانها الصحيح هنا.
        // HARDENED 2026-10-07: النافذة كانت 10 ثوانٍ فقط فتسرّبت 5 نسخ متطابقة
        // بفارق 20-60 ثانية (ضغطات مكررة على حفظ). الآن 10 دقائق + مطابقة باسم
        // المورد أيضًا عند غياب supplierId (اسم حر غير مربوط).
        if (invoiceTotal > 0 && req.user?.id) {
            const dupName = cleanName(supplierRow ? supplierRow.name : req.body?.supplierName);
            const dupWho = [String(req.user.id), req.user.username ? String(req.user.username) : null].filter(Boolean);
            const dupCheck = await client.query(
                `SELECT id, "invoiceNumber" FROM "purchaseInvoices"
                 WHERE "totalAmount" = $1
                   AND "createdAt"::timestamptz >= NOW() - INTERVAL '10 minutes'
                   AND "createdBy" = ANY($2)
                   AND (($3::bigint IS NOT NULL AND "supplierId" = $3)
                        OR ($3::bigint IS NULL AND $4 <> '' AND LOWER(COALESCE("supplierName",'')) = LOWER($4)))
                 ORDER BY "createdAt" DESC LIMIT 1`,
                [invoiceTotal, dupWho, supplierId, dupName || '']);
            if (dupCheck.rows.length > 0) {
                await client.query('ROLLBACK');
                return res.status(409).json({ ok: false, code: 'DUPLICATE_INVOICE', message: 'فاتورة مشابهة تم إنشاؤها قبل أقل من 10 دقائق — تم تجاهل الطلب المكرر', duplicateOf: dupCheck.rows[0] });
            }
        }
        const headerRate = vatCalc.lines.reduce((m, l) => Math.max(m, l.rate), 0);
        let paidAmount;
        if (req.body?.paidAmount !== undefined && req.body?.paidAmount !== null && req.body?.paidAmount !== '') {
            const rawPaidAmount = Number(req.body.paidAmount);
            if (!Number.isFinite(rawPaidAmount) || rawPaidAmount < 0 || rawPaidAmount > invoiceTotal) {
                await client.query('ROLLBACK');
                return fail(res, 422, 'INVALID_PAID_AMOUNT', 'المبلغ المسدد يجب أن يكون بين صفر وإجمالي الفاتورة');
            }
            paidAmount = round(rawPaidAmount, 2);
        } else {
            paidAmount = paymentMethod === 'credit' ? 0 : invoiceTotal;
        }
        const paymentStatus = computeInvoicePaymentStatus(invoiceTotal, paidAmount);
        const invoiceSupplierName = supplierRow ? supplierRow.name : req.body?.supplierName || null;

        const invoice = (await client.query(
            `INSERT INTO "purchaseInvoices" (id, "invoiceNumber", date, "supplierName", "supplierPhone", items, "totalAmount", "paymentMethod", notes, "createdAt", "createdBy", "supplierId", "paidAmount", "paymentStatus",
                subtotal_net, vat_total, tax_rate_snapshot, tax_rule_code_snapshot,
                supplier_name_snapshot, supplier_vat_number_snapshot, supplier_cr_snapshot,
                supplier_tax_status_snapshot, zatca_uuid, discount_type, discount_value, discount_amount)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26) RETURNING *`,
            [invoiceId, requestedInvoiceNumber || `INV-${id()}`, dateOnly(requestedDate), invoiceSupplierName,
                req.body?.supplierPhone || null, json(invoiceItems), invoiceTotal, paymentMethod,
                req.body?.notes || null, new Date().toISOString(), req.user.username || String(req.user.id),
                supplierId, paidAmount, paymentStatus,
                invoiceNet, invoiceVat, headerRate, vatCalc.ruleCode,
                supplierRow ? supplierRow.name : (req.body?.supplierName || null),
                supplierRow ? (supplierRow.vat_number || null) : null,
                supplierRow ? (supplierRow.commercial_register || null) : null,
                supplierRow ? (supplierRow.tax_registration_status || 'NOT_REGISTERED') : 'NOT_REGISTERED',
                crypto.randomUUID(), discountType, discountValue, discountAmount]
        )).rows[0];
        if (supplierId !== null && paidAmount > 0) {
            await client.query(
                `INSERT INTO supplier_payments (id, "supplierId", amount, method, date, "invoiceId", notes, "createdBy")
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
                [id(), supplierId, paidAmount, paymentMethod === 'credit' ? 'cash' : paymentMethod,
                    dateOnly(requestedDate), invoiceId, 'دفعة تلقائية مع تسجيل فاتورة الشراء', req.user.username || String(req.user.id)]
            );
        }
        // TASK 9: حدث دومين داخل نفس المعاملة (fail-open)
        await emitDomainEvent(pool, client, 'PURCHASE', {
            eventType: 'PURCHASE_CREATED', aggregateType: 'purchase_invoice', aggregateId: invoiceId,
            payload: { invoice_id: invoiceId, number: invoice.invoiceNumber, total: invoiceTotal, vat: invoiceVat, supplier_id: supplierId },
        });
        await client.query('COMMIT');

        // ترحيل محاسبي best-effort (لا يُسقط الشراء عند غياب شجرة الحسابات).
        // الرصيد الافتتاحي (OPEN-) ليس مشتريات: Dr 1200 مخزون ← Cr 3000 رأس المال
        // — لا مورد دائن ولا ضريبة مدخلات وهمية في ميزان المراجعة.
        try {
            const _acct = require('./accounting-routes');
            const _isOpen = String(invoice.invoiceNumber || '').startsWith('OPEN-');
            await (_isOpen ? _acct.postOpeningToLedger : _acct.postPurchaseToLedger)(invoiceId);
        }
        catch (ledgerErr) { logger.warn('[purchase_ledger] best-effort skipped:', ledgerErr.message); }

        emit(req, 'purchaseInvoices', 'create', invoice);
        for (const item of inventoryRows) {emit(req, 'inventory', 'update', item);}
        for (const tx of transactions) {emit(req, 'inventoryTx', 'create', tx);}
        res.status(201).json({
            invoice, inventory: inventoryRows, transactions, createdNames,
            totalAmount: invoiceTotal, subtotalNet: invoiceNet, vatTotal: invoiceVat,
            taxRule: vatCalc.ruleCode,
        });
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        logger.error('[pr_create]', error);
        logger.error('[warehouse_purchase_invoice]', error);
        res.status(500).json({ error: 'PURCHASE_INVOICE_FAILED', message: 'تعذر حفظ فاتورة الشراء وتحديث المخزن', detail: error?.message || String(error) });
    } finally {
        client.release();
    }
});

router.put('/purchase-invoices/:id', jwtAuth, requireRole('admin', 'manager', 'warehouse'), async (req, res) => {
    const client = await pool.connect();
    try {
        const invoiceId = Number(req.params.id);
        if (!Number.isSafeInteger(invoiceId) || invoiceId <= 0) {return fail(res, 422, 'INVALID_ID', 'معرف الفاتورة غير صحيح');}
        await client.query('BEGIN');
        const oldInvoice = (await client.query('SELECT * FROM "purchaseInvoices" WHERE id=$1 FOR UPDATE', [invoiceId])).rows[0];
        if (!oldInvoice) {
            await client.query('ROLLBACK');
            return fail(res, 404, 'INVOICE_NOT_FOUND', 'الفاتورة غير موجودة');
        }
        const payments = (await client.query(
            'SELECT COUNT(*)::int AS count FROM supplier_payments WHERE "invoiceId"=$1', [invoiceId]
        )).rows[0];
        if (Number(oldInvoice.paidAmount || 0) > 0 || Number(payments?.count || 0) > 0) {
            await client.query('ROLLBACK');
            return fail(res, 409, 'INVOICE_HAS_PAYMENTS', 'لا يمكن تعديل فاتورة عليها دفعة مسجلة؛ اعكس الدفعة رسميًا أولًا');
        }

        const requestedDate = req.body?.date || oldInvoice.date;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(String(requestedDate || '')) ||
            Number.isNaN(new Date(`${requestedDate}T00:00:00Z`).getTime())) {
            await client.query('ROLLBACK');
            return fail(res, 422, 'INVALID_INVOICE_DATE', 'تاريخ الفاتورة غير صحيح');
        }
        const paymentMethod = cleanName(req.body?.paymentMethod || oldInvoice.paymentMethod || 'cash').toLowerCase();
        const allowedPaymentMethods = new Set(['cash', 'bank', 'card', 'cheque', 'credit']);
        if (!allowedPaymentMethods.has(paymentMethod)) {
            await client.query('ROLLBACK');
            return fail(res, 422, 'INVALID_PAYMENT_METHOD', 'طريقة الدفع غير معتمدة');
        }
        const requestedInvoiceNumber = cleanName(req.body?.invoiceNumber || oldInvoice.invoiceNumber);
        if (requestedInvoiceNumber) {
            const duplicate = await client.query(
                'SELECT id FROM "purchaseInvoices" WHERE "invoiceNumber"=$1 AND id<>$2 LIMIT 1',
                [requestedInvoiceNumber, invoiceId]);
            if (duplicate.rows.length) {
                await client.query('ROLLBACK');
                return fail(res, 409, 'DUPLICATE_INVOICE_NUMBER', 'رقم الفاتورة مستخدم من قبل');
            }
        }

        const rawItems = Array.isArray(req.body?.items) ? req.body.items : [];
        const items = rawItems.map(raw => {
            const pkg = raw.packagingQty ?? raw.packaging_qty ?? raw.catch_weight_qty ?? null;
            const pkgQty = pkg === null || pkg === undefined || pkg === '' ? null : n(pkg);
            return {
                itemName: cleanName(raw.itemName || raw.name),
                category: cleanName(raw.category) || 'عام',
                unit: cleanName(raw.unit) || 'وحدة',
                unitProvided: raw.unit !== undefined && raw.unit !== null && cleanName(raw.unit) !== '',
                qty: round(n(raw.qty), 3),
                price: round(n(raw.price), 2),
                taxCategory: String(raw.tax_category ?? raw.taxCategory ?? 'STANDARD').trim().toUpperCase(),
                weight: Math.max(0, n(raw.weight)),
                packagingQty: pkgQty !== null && Number.isFinite(pkgQty) && pkgQty >= 0 ? pkgQty : null,
                packagingUom: cleanName(raw.packagingUom || raw.packaging_uom || raw.catch_weight_unit) || null,
            };
        }).filter(item => item.itemName && item.qty > 0 && item.price >= 0);
        if (!items.length || items.some(item => !Number.isFinite(item.qty) || !Number.isFinite(item.price) ||
            item.qty <= 0 || item.price < 0 || !['STANDARD', 'ZERO_RATED', 'EXEMPT', 'OUT_OF_SCOPE'].includes(item.taxCategory))) {
            await client.query('ROLLBACK');
            return fail(res, 422, 'INVALID_INVOICE_ITEM', 'تحقق من وجود صنف واحد على الأقل وصحة الكمية والسعر والفئة الضريبية');
        }
        const discountType = String(req.body?.discountType || 'none').toLowerCase();
        const discountValue = Number(req.body?.discountValue ?? 0);
        let discount;
        try {
            discount = allocatePurchaseDiscount(items, discountType, discountValue);
        } catch (error) {
            await client.query('ROLLBACK');
            return fail(res, 422, error.code || 'INVALID_INVOICE_DISCOUNT', error.message);
        }
        const discountAmount = discount.discountAmount;
        items.splice(0, items.length, ...discount.items);

        let supplierId = req.body?.supplierId !== undefined && req.body?.supplierId !== null && req.body?.supplierId !== ''
            ? Number(req.body.supplierId) : null;
        let supplierRow = null;
        const supplierName = cleanName(req.body?.supplierName);
        if (supplierId === null && supplierName) {
            const matched = (await client.query(
                'SELECT id FROM suppliers WHERE LOWER(name)=LOWER($1) LIMIT 1', [supplierName])).rows[0];
            if (matched) {supplierId = Number(matched.id);}
        }
        if (supplierId !== null) {
            if (!Number.isSafeInteger(supplierId)) {
                await client.query('ROLLBACK');
                return fail(res, 422, 'INVALID_SUPPLIER', 'معرف المورد غير صحيح');
            }
            supplierRow = (await client.query(
                `SELECT id, name, is_active, tax_registration_status, vat_number, commercial_register
                   FROM suppliers WHERE id=$1`, [supplierId])).rows[0];
            if (!supplierRow) {
                await client.query('ROLLBACK');
                return fail(res, 422, 'SUPPLIER_NOT_FOUND', 'المورد المحدد غير موجود');
            }
            if (!supplierRow.is_active && Number(oldInvoice.supplierId) !== supplierId) {
                await client.query('ROLLBACK');
                return fail(res, 409, 'SUPPLIER_INACTIVE', `المورد «${supplierRow.name}» موقوف — فعّله قبل ربط الفاتورة`);
            }
        }
        const standardRate = await loadStandardRate(pool);
        const supplierProfile = supplierRow
            ? { status: supplierRow.tax_registration_status || 'NOT_REGISTERED', vat_number: supplierRow.vat_number || null, country: 'SA' }
            : { status: 'NOT_REGISTERED', vat_number: null, country: 'SA' };
        let vatCalc;
        try {
            vatCalc = computeInvoiceVat(
                items.map(item => ({ net: item.total, taxCategory: item.taxCategory })),
                supplierProfile, { transactionDate: dateOnly(requestedDate) || riyadhToday(), standardRate });
        } catch (taxError) {
            await client.query('ROLLBACK');
            return fail(res, 422, 'INVALID_TAX_CATEGORY', String(taxError.message).slice(0, 200));
        }
        const invoiceNet = vatCalc.subtotalNet;
        const invoiceVat = vatCalc.vatTotal;
        const invoiceTotal = vatCalc.grandTotal;
        let paidAmount = 0;
        if (req.body?.paidAmount !== undefined && req.body?.paidAmount !== null && req.body?.paidAmount !== '') {
            const rawPaid = Number(req.body.paidAmount);
            if (!Number.isFinite(rawPaid) || rawPaid < 0 || rawPaid > invoiceTotal) {
                await client.query('ROLLBACK');
                return fail(res, 422, 'INVALID_PAID_AMOUNT', 'المبلغ المسدد يجب أن يكون بين صفر وإجمالي الفاتورة');
            }
            paidAmount = round(rawPaid, 2);
        } else if (paymentMethod !== 'credit') {
            paidAmount = invoiceTotal;
        }
        const paymentStatus = computeInvoicePaymentStatus(invoiceTotal, paidAmount);
        const mainLocation = await getWarehouseLocation(client, 'MAIN-WAREHOUSE', 'المخزن الرئيسي', 'warehouse');
        let oldItems = oldInvoice.items;
        if (typeof oldItems === 'string') {try {oldItems = JSON.parse(oldItems);} catch (_) {oldItems = [];} }
        if (!Array.isArray(oldItems)) {oldItems = [];}
        const revision = id();
        const inventoryRows = [];
        const transactions = [];
        for (let index = 0; index < oldItems.length; index++) {
            const old = oldItems[index];
            const inventoryId = Number(old.itemId || old.item_id);
            const qty = round(n(old.qty), 3);
            if (!Number.isSafeInteger(inventoryId) || qty <= 0) {
                await client.query('ROLLBACK');
                return fail(res, 409, 'EDIT_ITEM_INVALID', 'تعذر عكس بند قديم غير صالح؛ راجع بيانات الفاتورة قبل تعديلها');
            }
            const row = (await client.query(
                'SELECT id,name,unit,qty,"avgCost",COALESCE(weight,0) AS weight FROM inventory WHERE id=$1 FOR UPDATE', [inventoryId]
            )).rows[0];
            if (!row) {
                await client.query('ROLLBACK');
                return fail(res, 409, 'EDIT_ITEM_MISSING', `الصنف «${old.itemName || old.name || inventoryId}» غير موجود بالمخزون`);
            }
            const oldUnitCost = n(old.effectivePrice ?? old.price);
            const oldWeight = Math.max(0, n(old.weight));
            const boxes = old.packagingQty ?? old.packaging_qty ?? old.catch_weight_qty ?? null;
            const boxesUnit = old.packagingUom || old.packaging_uom || old.catch_weight_unit || null;
            const reversal = await postInventoryLedgerEntry(client, {
                transactionType: 'reversal', inventoryId, locationId: mainLocation.id, quantityDelta: -qty,
                unit: row.unit || old.unit || 'وحدة', unitCost: oldUnitCost,
                referenceType: 'purchase_invoice_edit_reversal', referenceId: String(invoiceId), userId: req.user.id,
                idempotencyKey: `purchase-edit-reversal:${invoiceId}:${revision}:${index}`,
                reason: `عكس بند فاتورة شراء ${oldInvoice.invoiceNumber || invoiceId} قبل التعديل`,
                metadata: { invoice_id: invoiceId, revision },
                catchWeightQty: boxes === null ? null : n(boxes), catchWeightUnit: boxes === null ? null : boxesUnit,
            });
            if (reversal.replay) {
                await client.query('ROLLBACK');
                return fail(res, 409, 'EDIT_REVERSAL_EXISTS', 'وجد قيد عكس سابق لهذا التعديل؛ راجع دفتر المخزون');
            }
            const tx = (await client.query(
                `INSERT INTO "inventoryTx" (id,"itemId","itemName",qty,type,date,cost,"totalValue",notes,"invoiceNumber","supplierName",weight,catch_weight_qty,catch_weight_unit)
                 VALUES ($1,$2,$3,$4,'out',$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
                [id(), inventoryId, row.name, qty, dateOnly(new Date()), oldUnitCost, round(qty * oldUnitCost, 2),
                    `عكس فاتورة شراء ${oldInvoice.invoiceNumber || invoiceId} قبل التعديل`, oldInvoice.invoiceNumber,
                    oldInvoice.supplierName, -oldWeight, boxes, boxes === null ? null : boxesUnit]
            )).rows[0];
            transactions.push(tx);
            const remaining = n((await client.query(
                'SELECT COALESCE(SUM(on_hand),0) AS q FROM inventory_location_balances WHERE inventory_id=$1', [inventoryId]
            )).rows[0]?.q);
            if (remaining > 0) {
                const nextAvg = Math.max(0, round(((n(row.avgCost) * (remaining + qty)) - (oldUnitCost * qty)) / remaining, 2));
                await client.query(
                    'UPDATE inventory SET "avgCost"=$2,weight=GREATEST(0,COALESCE(weight,0)-$3) WHERE id=$1',
                    [inventoryId, nextAvg, oldWeight]);
            } else {
                await client.query('UPDATE inventory SET weight=GREATEST(0,COALESCE(weight,0)-$2) WHERE id=$1', [inventoryId, oldWeight]);
            }
        }

        const existingRows = await client.query('SELECT id,name FROM inventory');
        const existingByKey = new Map(existingRows.rows.map(row => [normItemName(row.name), Number(row.id)]));
        const updatedItems = [];
        for (const item of items) {
            const matchedId = existingByKey.get(normItemName(item.itemName));
            let inv = matchedId
                ? (await client.query('SELECT * FROM inventory WHERE id=$1 FOR UPDATE', [matchedId])).rows[0]
                : null;
            if (inv && item.unitProvided && String(item.unit).trim().toLowerCase() !== String(inv.unit || 'وحدة').trim().toLowerCase()) {
                await client.query('ROLLBACK');
                return fail(res, 422, 'UNIT_MISMATCH', `الصنف «${inv.name}» مسجل بوحدة «${inv.unit || 'وحدة'}» وليس «${item.unit}»`);
            }
            if (!inv) {
                inv = (await client.query(
                    `INSERT INTO inventory (id,name,category,unit,qty,"avgCost","minQty",weight)
                     VALUES ($1,$2,$3,$4,0,$5,0,0) RETURNING *`,
                    [id(), item.itemName, item.category, item.unit, item.effectivePrice]
                )).rows[0];
                existingByKey.set(normItemName(item.itemName), Number(inv.id));
            } else {
                const oldQty = n(inv.qty);
                const nextQty = round(oldQty + item.qty, 3);
                const nextCost = nextQty > 0
                    ? round(((oldQty * n(inv.avgCost)) + (item.qty * item.effectivePrice)) / nextQty, 2)
                    : round(item.effectivePrice, 2);
                inv = (await client.query(
                    'UPDATE inventory SET "avgCost"=$2,weight=COALESCE(weight,0)+$3 WHERE id=$1 RETURNING *',
                    [inv.id, nextCost, round(item.weight, 3)]
                )).rows[0];
            }
            await ensureLocationBalance(client, inv.id, mainLocation.id, n(inv.qty));
            const receipt = await postInventoryLedgerEntry(client, {
                transactionType: 'purchase_receipt', inventoryId: Number(inv.id), locationId: mainLocation.id,
                quantityDelta: item.qty, unit: inv.unit || item.unit || 'وحدة', unitCost: item.effectivePrice,
                referenceType: 'purchase_invoice_edit', referenceId: String(invoiceId), userId: req.user.id,
                idempotencyKey: `purchase-edit:${invoiceId}:${revision}:${inv.id}`,
                reason: `تعديل استلام فاتورة شراء ${requestedInvoiceNumber || invoiceId}`,
                metadata: { invoice_id: invoiceId, invoice_number: requestedInvoiceNumber, revision },
                catchWeightQty: item.packagingQty,
                catchWeightUnit: item.packagingQty !== null ? (item.packagingUom || inv.packaging_uom || 'كرتون') : null,
            });
            if (receipt.replay) {
                await client.query('ROLLBACK');
                return fail(res, 409, 'EDIT_RECEIPT_EXISTS', 'وجد قيد استلام سابق لهذا التعديل؛ راجع دفتر المخزون');
            }
            const tx = (await client.query(
                `INSERT INTO "inventoryTx" (id,"itemId","itemName",qty,type,date,cost,"totalValue",notes,"invoiceNumber","supplierName",weight,catch_weight_qty,catch_weight_unit)
                 VALUES ($1,$2,$3,$4,'in',$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
                [id(), inv.id, inv.name, item.qty, dateOnly(requestedDate), item.effectivePrice, item.total,
                    `استلام فاتورة شراء معدلة ${requestedInvoiceNumber || ''}`.trim(), requestedInvoiceNumber,
                    supplierRow?.name || supplierName || null, round(item.weight, 3), item.packagingQty,
                    item.packagingQty !== null ? (item.packagingUom || inv.packaging_uom || 'كرتون') : null]
            )).rows[0];
            inventoryRows.push(Number(inv.id));
            transactions.push(tx);
            updatedItems.push({ ...item, itemId: Number(inv.id), itemName: inv.name });
        }
        const headerRate = vatCalc.lines.reduce((max, line) => Math.max(max, line.rate), 0);
        const updated = (await client.query(
            `UPDATE "purchaseInvoices" SET "invoiceNumber"=$2,date=$3,"supplierName"=$4,"supplierPhone"=$5,
             items=$6,"totalAmount"=$7,"paymentMethod"=$8,notes=$9,"supplierId"=$10,"paidAmount"=$11,"paymentStatus"=$12,
             subtotal_net=$13,vat_total=$14,tax_rate_snapshot=$15,tax_rule_code_snapshot=$16,
             supplier_name_snapshot=$17,supplier_vat_number_snapshot=$18,supplier_cr_snapshot=$19,
             supplier_tax_status_snapshot=$20,zatca_uuid=$21,zatca_qr=NULL,discount_type=$22,discount_value=$23,discount_amount=$24
             WHERE id=$1 RETURNING *`,
            [invoiceId, requestedInvoiceNumber, dateOnly(requestedDate), supplierRow?.name || supplierName || null,
                req.body?.supplierPhone || null, json(updatedItems), invoiceTotal, paymentMethod, req.body?.notes || null,
                supplierId, paidAmount, paymentStatus, invoiceNet, invoiceVat, headerRate, vatCalc.ruleCode,
                supplierRow?.name || supplierName || null, supplierRow?.vat_number || null,
                supplierRow?.commercial_register || null, supplierRow?.tax_registration_status || 'NOT_REGISTERED',
                crypto.randomUUID(), discountType, discountValue, discountAmount]
        )).rows[0];
        if (supplierId !== null && paidAmount > 0) {
            await client.query(
                `INSERT INTO supplier_payments (id,"supplierId",amount,method,date,"invoiceId",notes,"createdBy")
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
                [id(), supplierId, paidAmount, paymentMethod === 'credit' ? 'cash' : paymentMethod,
                    dateOnly(requestedDate), invoiceId, 'دفعة تلقائية مع تعديل فاتورة الشراء',
                    req.user.username || String(req.user.id)]);
        }
        await client.query(
            `UPDATE journal_entries SET status='void',source_type='purchase_invoice_edit_void',source_id=$2
              WHERE source_type='purchase_invoice' AND source_id=$1 AND status='posted'`,
            [String(invoiceId), `${invoiceId}:revision:${revision}`]);
        await emitDomainEvent(pool, client, 'PURCHASE', {
            eventType: 'PURCHASE_UPDATED', aggregateType: 'purchase_invoice', aggregateId: invoiceId,
            payload: { invoice_id: invoiceId, number: updated.invoiceNumber, total: invoiceTotal, revision },
        });
        await client.query('COMMIT');

        try {
            await require('./accounting-routes').postPurchaseToLedger(invoiceId);
        } catch (ledgerError) {
            logger.warn('[purchase_edit_ledger] best-effort posting skipped:', ledgerError.message);
        }
        const freshInventory = inventoryRows.length
            ? (await pool.query('SELECT * FROM inventory WHERE id=ANY($1::bigint[]) ORDER BY id', [inventoryRows])).rows
            : [];
        emit(req, 'purchaseInvoices', 'update', updated);
        for (const row of freshInventory) {emit(req, 'inventory', 'update', row);}
        for (const tx of transactions) {emit(req, 'inventoryTx', 'create', tx);}
        res.json({ invoice: updated, inventory: freshInventory, transactions });
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        logger.error('[warehouse_purchase_invoice_edit]', error);
        if (error.code === 'INSUFFICIENT_STOCK') {
            return fail(res, 409, 'EDIT_INSUFFICIENT_STOCK', 'لا يمكن تعديل الفاتورة لأن بعض كمياتها صُرفت بالفعل؛ راجع رصيد المخزون قبل التعديل');
        }
        res.status(500).json({ error: 'PURCHASE_INVOICE_EDIT_FAILED', message: 'تعذر تعديل فاتورة الشراء وتحديث المخزون', detail: error?.message || String(error) });
    } finally {
        client.release();
    }
});

// ─── حذف نهائي لصنف مخزون مع كل حركاته (قرار المالك — مدير فقط) ───
// يمحو السجل المرتبط (دفتر/أرصدة/تحويلات/جرد/وصفات/ربط) في معاملة واحدة.
// يُستخدم فقط بعد رفض الحذف العادي (409) — بتأكيد صريح من الواجهة.
router.delete('/inventory/:id/force', jwtAuth, requireRole('admin', 'warehouse'), async (req, res) => {
    const client = await pool.connect();
    try {
        const itemId = Number(req.params.id);
        if (!Number.isFinite(itemId)) {return fail(res, 422, 'INVALID_ID', 'معرف الصنف غير صحيح');}
        await client.query('BEGIN');
        const item = (await client.query('SELECT id, name FROM inventory WHERE id = $1 FOR UPDATE', [itemId])).rows[0];
        if (!item) { await client.query('ROLLBACK'); return fail(res, 404, 'ITEM_NOT_FOUND', 'الصنف غير موجود'); }
        // فحص الاستخدام أولًا: مراجع JSONB وأعمدة مالية لا تُمسح تلقائيًا — الحذف معها يتيم بيانات
        const usage = [];
        const usedIn = async (label, sql, params) => {
            const r = await client.query(sql, params);
            const c = Number(r.rows[0]?.c || 0);
            if (c > 0) {usage.push({ where: label, count: c });}
        };
        await usedIn('purchaseInvoices', `SELECT COUNT(*)::int AS c FROM "purchaseInvoices" WHERE items::text LIKE $1`, [`%${item.name}%`]);
        await usedIn('kitchenReturns', `SELECT COUNT(*)::int AS c FROM "kitchenReturns" WHERE items::text LIKE $1`, [`%${item.name}%`]);
        await usedIn('dispatches', `SELECT COUNT(*)::int AS c FROM dispatches WHERE items::text LIKE $1 OR "approvedItems"::text LIKE $1`, [`%${item.name}%`]);
        await usedIn('expenses', `SELECT COUNT(*)::int AS c FROM expenses WHERE notes LIKE $1 OR "desc" LIKE $1`, [`%${item.name}%`]);
        await usedIn('purchase_requests', `SELECT COUNT(*)::int AS c FROM purchase_requests WHERE items::text LIKE $1 OR received_items::text LIKE $1`, [`%${item.name}%`]);
        await usedIn('supplier_payments', `SELECT COUNT(*)::int AS c FROM supplier_payments WHERE notes LIKE $1`, [`%${item.name}%`]);
        if (usage.length) {
            await client.query('ROLLBACK');
            return fail(res, 409, 'ITEM_REFERENCED', `الصنف "${item.name}" مستخدم في مستندات — ألغِ/سوِّ المستندات أولًا ثم احذف`, { usage });
        }
        const counts = {};
        const del = async (table, col) => {
            const r = await client.query(`DELETE FROM ${table} WHERE ${col} = $1`, [itemId]);
            counts[table] = r.rowCount;
        };
        await del('inventory_ledger', 'inventory_id');
        await del('inventory_location_balances', 'inventory_id');
        await del('inventory_transfer_items', 'inventory_id');
        await del('inventory_audit_items', 'item_id');
        await del('pos_recipe_version_ingredients', 'inventory_id');
        await del('pos_product_ingredients', 'inventory_id');
        await del('"inventoryTx"', '"itemId"');
        await del('yarasoft_product_mapping', 'internal_product_id');
        await client.query('DELETE FROM inventory WHERE id = $1', [itemId]);
        await client.query('COMMIT');
        emit(req, 'inventory', 'delete', { id: itemId, name: item.name, force: true });
        logger.warn(`[inventory_force_delete] ${req.user?.username} حذف نهائيًا الصنف ${item.name} (${itemId}) مع ${JSON.stringify(counts)}`);
        res.json({ ok: true, item: { id: itemId, name: item.name }, removed: counts });
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        logger.error('[pr_create]', error);
        logger.error('[inventory_force_delete]', error);
        res.status(500).json({ error: 'FORCE_DELETE_FAILED', message: 'تعذر الحذف النهائي: ' + String(error.message).slice(0, 160) });
    } finally { client.release(); }
});

// ─── إلغاء فاتورة شراء مع عكس أثرها المخزني (قرار المالك) ───
// الشروط: بلا مدفوعات (paidAmount=0 وبلا supplier_payments مرتبطة) — المال المتحرك لا يُمحى.
// يعكس الاستلام في الدفتر (حركة عكسية موثقة) ويحذف حركات الـ in ثم الفاتورة — كله في معاملة واحدة.
// ─── صلاحية الأدمن المطلقة: تعديل مباشر للكمية/متوسط التكلفة بقيد تسوية موثق ──
// (طلب المالك 2026-10-04) — أدمن فقط. الفرق يُقيَّد count_correction في الدفتر
// ويُسجَّل في inventoryTx مع السبب — لا تعديل صامت أبدًا.
router.put('/inventory/:id/direct', jwtAuth, requireRole('admin'), async (req, res) => {
    const client = await pool.connect();
    try {
        const itemId = Number(req.params.id);
        const newCost = Number(req.body?.avgCost);
        const reason = cleanName(req.body?.reason).slice(0, 200) || 'تعديل مباشر بواسطة الأدمن';
        // طلب المالك 2026-10-06: «الرصيد ناقص أذونات الصرف يظهر قدامي الرقم الفعلي في المخزن» —
        // mainQty يجعل الصافي يقع على المخزن الرئيسي تحديدًا ورصيد مخازن الأقسام يبقى كما هو،
        // بدل إجبار الإجمالي = الصافي الذي كان يبعثر أرصدة الرئيسي عند وجود مخزون بأقسام أخرى.
        const hasMainQty = req.body?.mainQty !== undefined && req.body?.mainQty !== null && String(req.body.mainQty).trim() !== '';
        const newMainQty = hasMainQty ? Number(req.body.mainQty) : null;
        const newQty = hasMainQty ? null : Number(req.body?.qty);
        if (!Number.isInteger(itemId) || itemId <= 0) {return fail(res, 422, 'INVALID_ID', 'معرف الصنف غير صحيح');}
        if (hasMainQty) {
            if (!Number.isFinite(newMainQty) || newMainQty < 0) {return fail(res, 422, 'INVALID_QTY', 'رصيد المخزن الرئيسي يجب أن يكون رقمًا ≥ صفر');}
        } else if (!Number.isFinite(newQty) || newQty < 0) {return fail(res, 422, 'INVALID_QTY', 'الكمية يجب أن تكون رقمًا ≥ صفر');}
        if (!Number.isFinite(newCost) || newCost < 0) {return fail(res, 422, 'INVALID_COST', 'التكلفة يجب أن تكون رقمًا ≥ صفر');}
        await client.query('BEGIN');
        const item = (await client.query('SELECT * FROM inventory WHERE id = $1 FOR UPDATE', [itemId])).rows[0];
        if (!item) { await client.query('ROLLBACK'); return fail(res, 404, 'ITEM_NOT_FOUND', 'الصنف غير موجود'); }
        const oldQty = n(item.qty);
        const oldCost = n(item.avgCost);
        const location = await getWarehouseLocation(client, 'MAIN-WAREHOUSE', 'المخزن الرئيسي', 'warehouse');
        await ensureLocationBalance(client, itemId, location.id, oldQty);
        let delta;
        if (hasMainQty) {
            const curMain = n((await client.query(
                'SELECT on_hand FROM inventory_location_balances WHERE inventory_id=$1 AND location_id=$2 FOR UPDATE',
                [itemId, location.id])).rows[0]?.on_hand);
            delta = round(newMainQty - curMain, 3);
        } else {
            delta = round(newQty - oldQty, 4);
        }
        if (delta !== 0) {
            await postInventoryLedgerEntry(client, {
                transactionType: 'count_correction', inventoryId: itemId, locationId: location.id,
                quantityDelta: delta, unit: item.unit || 'وحدة',
                unitCost: newCost, referenceType: 'admin_direct_edit', referenceId: String(itemId),
                userId: req.user.id, idempotencyKey: `admin-direct:${itemId}:${Date.now()}`,
                reason, metadata: { admin_direct: true, old_qty: oldQty, new_qty: hasMainQty ? null : newQty, old_cost: oldCost, new_cost: newCost, ...(hasMainQty ? { main_qty_target: newMainQty } : {}) },
            });
            await client.query(
                `INSERT INTO "inventoryTx" (id,"itemId","itemName",qty,type,date,cost,"totalValue",notes)
                 VALUES ($1,$2,$3,$4,'adjust',$5,$6,$7,$8)`,
                [id(), itemId, item.name, round(Math.abs(delta)), dateOnly(new Date()), newCost,
                 round(Math.abs(delta) * newCost, 2), reason]
            );
        }
        const upd = hasMainQty
            ? (await client.query('UPDATE inventory SET "avgCost"=$2 WHERE id=$1 RETURNING *', [itemId, newCost])).rows[0]
            : (await client.query('UPDATE inventory SET qty=$2, "avgCost"=$3 WHERE id=$1 RETURNING *', [itemId, newQty, newCost])).rows[0];
        await client.query('COMMIT');
        emit(req, 'inventory', 'update', upd);
        logger.warn(`[inventory_direct_edit] ${req.user?.username} عدّل مباشرة «${item.name}»: qty ${oldQty}→${newQty}, avgCost ${oldCost}→${newCost} — ${reason}`);
        res.json({ ok: true, item: upd, delta });
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        logger.error('[inventory_direct_edit]', error);
        return fail(res, 500, 'DIRECT_EDIT_FAILED', 'تعذر التعديل المباشر: ' + String(error.message).slice(0, 160));
    } finally { client.release(); }
});

// ─── طلب المالك 2026-10-05: «في اصناف مثل كده عايز احذف المكرر» — دمج أصناف مكررة في صنف واحد ───
// ينقل رصيد المكرر (كل المواقع) للمُبقي، يعيد توجيه كل المراجع (دفتر المخزون/سجل الحركات/أي جدول مرجعي)،
// يوازن متوسط التكلفة، يورّث الحد الأدنى/الباركود/الفئة/الرف، ثم يحذف الصنف المكرر — معاملة واحدة موثقة.
router.post('/inventory/merge', jwtAuth, requireRole('admin'), async (req, res) => {
    const client = await pool.connect();
    try {
        const keepId = Number(req.body?.keepId);
        const dupIds = [...new Set((Array.isArray(req.body?.dupIds) ? req.body.dupIds : []).map(Number).filter(Number.isInteger))];
        if (!Number.isInteger(keepId) || keepId <= 0) {return fail(res, 422, 'INVALID_KEEP_ID', 'الصنف المُبقي غير محدد');}
        if (!dupIds.length) {return fail(res, 422, 'NO_DUPLICATES', 'لا توجد أصناف مكررة محددة للدمج');}
        if (dupIds.includes(keepId)) {return fail(res, 422, 'SAME_ITEM', 'لا يمكن دمج الصنف مع نفسه');}
        await client.query('BEGIN');
        const keeper = (await client.query('SELECT * FROM inventory WHERE id=$1 FOR UPDATE', [keepId])).rows[0];
        if (!keeper) {await client.query('ROLLBACK'); return fail(res, 404, 'KEEPER_NOT_FOUND', 'الصنف المُبقي غير موجود');}
        const dups = [];
        for (const dupId of dupIds) {
            const d = (await client.query('SELECT * FROM inventory WHERE id=$1 FOR UPDATE', [dupId])).rows[0];
            if (!d) {await client.query('ROLLBACK'); return fail(res, 404, 'DUPLICATE_NOT_FOUND', `الصنف المكرر غير موجود: ${dupId}`);}
            dups.push(d);
        }
        // 1) نقل الأرصدة من كل مخزن المكرر إلى المُبقي (نفس المواقع)
        let movedQty = 0;
        let keeperLoc; // موقع الصنف المُبقي — لالتقاط أي رصيد «شبح» في عمود qty بلا صفوف مواقع
        for (const dup of dups) {
            const dupBalances = (await client.query('SELECT location_id, COALESCE(on_hand,0) AS on_hand FROM inventory_location_balances WHERE inventory_id=$1', [dup.id])).rows;
            let dupBalSum = 0;
            for (const b of dupBalances) {
                dupBalSum += Number(b.on_hand) || 0;
                if (!(Number(b.on_hand) !== 0)) {continue;}
                await ensureLocationBalance(client, keepId, b.location_id, 0);
                await client.query(
                    'UPDATE inventory_location_balances SET on_hand = COALESCE(on_hand,0) + $2, updated_at=CURRENT_TIMESTAMP WHERE inventory_id=$1 AND location_id=$3',
                    [keepId, Number(b.on_hand), b.location_id]);
                movedQty += Number(b.on_hand);
            }
            await client.query('DELETE FROM inventory_location_balances WHERE inventory_id=$1', [dup.id]);
            // رصيد موجود في عمود qty دون صف مواقع: يُنقل لموقع المُبقي حتى لا يضيع عند مزامنة qty من الأرصدة
            const phantom = round(n(dup.qty) - dupBalSum, 3);
            if (phantom > 0) {
                if (keeperLoc == null) {
                    keeperLoc = (await client.query('SELECT location_id FROM inventory_location_balances WHERE inventory_id=$1 ORDER BY on_hand DESC LIMIT 1', [keepId])).rows[0]?.location_id
                        ?? (await getWarehouseLocation(client, 'MAIN-WAREHOUSE', 'المخزن الرئيسي', 'warehouse')).id;
                }
                await ensureLocationBalance(client, keepId, keeperLoc, 0);
                await client.query(
                    'UPDATE inventory_location_balances SET on_hand = COALESCE(on_hand,0) + $2, updated_at=CURRENT_TIMESTAMP WHERE inventory_id=$1 AND location_id=$3',
                    [keepId, phantom, keeperLoc]);
                movedQty += phantom;
            }
        }
        // 2) إعادة توجيه كل الجداول المرجعية للصنف المكرر → الصنف المُبقي
        const refCols = (await client.query(`
            SELECT c.table_name, c.column_name, c.data_type
            FROM information_schema.columns c
            WHERE c.table_schema='public' AND c.column_name IN ('itemId','inventory_id','item_id')
              AND c.table_name <> 'inventory_location_balances'
              AND c.table_name <> 'inventory'`)).rows;
        const sweptTables = [];
        for (const dup of dups) {
            for (const c of refCols) {
                const tbl = `"${c.table_name}"`, col = `"${c.column_name}"`;
                await client.query('SAVEPOINT merge_sweep');
                try {
                    const r = await client.query(`UPDATE ${tbl} SET ${col}=$1 WHERE ${col}=$2`, [String(keepId), String(dup.id)]);
                    if (r.rowCount > 0) {sweptTables.push(`${c.table_name}.${c.column_name}(${r.rowCount})`);}
                    await client.query('RELEASE SAVEPOINT merge_sweep');
                } catch (e) {
                    await client.query('ROLLBACK TO SAVEPOINT merge_sweep');
                    logger.warn(`[inventory_merge] تخطي ${c.table_name}.${c.column_name}: ${e.message}`);
                }
            }
        }
        // 3) وراثة الإعدادات + موازنة متوسط التكلفة الموزون + إعادة حساب الإجمالي
        // المقام هو الرصيد الفعلي بعد الدمج (finalQty) — كمية المكرر داخل فيه أصلًا، وجمعها مجددًا يحسبها مرتين
        const kQty = n(keeper.qty);
        let totalCost = kQty * n(keeper.avgCost);
        for (const dup of dups) {
            const dQty = n(dup.qty);
            if (dQty > 0) { totalCost += dQty * n(dup.avgCost); }
        }
        const finalQty = n((await client.query(
            'SELECT COALESCE(SUM(on_hand),0) AS q FROM inventory_location_balances WHERE inventory_id=$1', [keepId])).rows[0].q);
        const newCost = finalQty > 0
            ? Math.max(0, round(totalCost / finalQty, 2))
            : n(keeper.avgCost);
        const primary = dups[0];
        const updated = (await client.query(
            `UPDATE inventory SET
                "minQty" = CASE WHEN COALESCE("minQty",0) > 0 THEN "minQty" ELSE COALESCE($2,0) END,
                barcode = COALESCE(NULLIF(barcode,''), NULLIF($3,'')),
                category = CASE WHEN COALESCE(category,'') IN ('','عام') THEN COALESCE(NULLIF($4,''), category) ELSE category END,
                "shelfId" = COALESCE("shelfId", $5),
                "avgCost" = $6,
                qty = $7
             WHERE id=$1 RETURNING *`,
            [keepId, n(primary.minQty) || 0, keeper.barcode || primary.barcode || '',
             (keeper.category && keeper.category !== 'عام') ? keeper.category : (primary.category || 'عام'),
             keeper.shelfId || primary.shelfId || null, newCost, finalQty])).rows[0];
        // 4) توثيق الحركة في سجل الحركات لكل مكرر مدموج
        for (const dup of dups) {
            const dQty = n(dup.qty);
            await client.query(
                `INSERT INTO "inventoryTx" (id, "itemId", "itemName", qty, type, date, cost, "totalValue", notes)
                 VALUES ($1,$2,$3,$4,'adjust',$5,$6,$7,$8)`,
                [id(), keepId, keeper.name, round(dQty, 3), dateOnly(new Date()), n(dup.avgCost),
                 round(dQty * n(dup.avgCost), 2), `دمج صنف مكرر «${dup.name}» (#${dup.id}) — نقل الرصيد والسجل إلى «${keeper.name}»`]);
        }
        // 5) حذف المكرر (كل مراجعه أعيد توجيهها)
        await client.query('DELETE FROM inventory WHERE id = ANY($1::bigint[])', [dupIds]);
        await emitDomainEvent(pool, client, 'INVENTORY', {
            eventType: 'INVENTORY_MERGED', aggregateType: 'inventory', aggregateId: keepId,
            payload: { keeper_id: keepId, merged_ids: dupIds, moved_qty: round(movedQty, 3) },
        });
        await client.query('COMMIT');
        emit(req, 'inventory', 'update', updated);
        for (const dup of dups) { emit(req, 'inventory', 'delete', { id: dup.id, mergedInto: keepId }); }
        logger.warn(`[inventory_merge] ${req.user?.username} دمج ${dups.length} صنفًا مكررًا في «${keeper.name}» (${keepId}) — رصيد منقول ${round(movedQty, 3)}، جداول أعيد توجيهها: ${sweptTables.length}`);
        res.json({ ok: true, keeper: updated, movedQty: round(movedQty, 3), sweptTables, mergedCount: dups.length });
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        logger.error('[inventory_merge]', error);
        return fail(res, 500, 'INVENTORY_MERGE_FAILED', 'تعذر دمج الأصناف: ' + String(error.message).slice(0, 160));
    } finally { client.release(); }
});

// الدفعة التي يولّدها النظام تلقائيًا لحظة تسجيل/تعديل الفاتورة (نفس المعاملة، نفس
// السطر) ليست «مالًا متحركًا» مستقلًا — هي حالة سداد الفاتورة نفسها. لذا تُعكس معها
// عند الإلغاء. أما الدفعة اليدية (من شاشة الدفعات) فتُرفض: لها قصة أخرى ومالك النظام
// هو من يُلغيها. (طلب المالك 2026-10-13 بعد فاتورة INV-1791896153117)
const AUTO_PAYMENT_NOTE_RE = /^دفعة تلقائية مع (تسجيل|تعديل) فاتورة الشراء/;
function classifyInvoicePaymentsForVoid(payRows) {
    const list = Array.isArray(payRows) ? payRows : [];
    const auto = list.filter(p => AUTO_PAYMENT_NOTE_RE.test(String(p.notes || '').trim()));
    const manual = list.filter(p => !AUTO_PAYMENT_NOTE_RE.test(String(p.notes || '').trim()));
    return {
        auto, manual,
        total: round(list.reduce((s, p) => s + Number(p.amount || 0), 0), 2),
        autoTotal: round(auto.reduce((s, p) => s + Number(p.amount || 0), 0), 2),
        autoOnly: list.length > 0 && manual.length === 0,
    };
}

router.post('/purchase-invoices/:id/void', jwtAuth, requireRole('admin'), async (req, res) => {    const client = await pool.connect();
    try {
        const invoiceId = Number(req.params.id);
        if (!Number.isFinite(invoiceId)) {return fail(res, 422, 'INVALID_ID', 'معرف الفاتورة غير صحيح');}
        await client.query('BEGIN');
        const inv = (await client.query('SELECT * FROM "purchaseInvoices" WHERE id = $1 FOR UPDATE', [invoiceId])).rows[0];
        if (!inv) { await client.query('ROLLBACK'); return fail(res, 404, 'INVOICE_NOT_FOUND', 'الفاتورة غير موجودة'); }
        const force = req.body?.force === true;
        if (force) {
            await client.query('ROLLBACK');
            return fail(res, 409, 'FORCE_VOID_FORBIDDEN', 'لا يجوز حذف دفعات أو مستند مالي قسريًا — استخدم قيد عكسي موثق');
        }
        const payRows = (await client.query('SELECT id, amount, notes FROM supplier_payments WHERE "invoiceId" = $1 FOR UPDATE', [invoiceId])).rows;
        const payClass = classifyInvoicePaymentsForVoid(payRows);
        const payRef = { c: payRows.length, t: payClass.total };
        const isOpeningBalance = /^OPEN-/i.test(String(inv.invoiceNumber || ''))
            || /^رصيد افتتاحي(?:\s|$)/.test(String(inv.supplierName || ''))
            || /^رصيد افتتاحي(?:\s|$)/.test(String(inv.notes || ''));
        const paidOpeningWithoutPayment = isOpeningBalance
            && Number(inv.paidAmount || 0) > 0
            && payRows.length === 0;
        if (Number(inv.paidAmount || 0) > 0 && !(paidOpeningWithoutPayment || payClass.autoOnly)) {
            await client.query('ROLLBACK');
            return fail(res, 409, 'INVOICE_PAID', 'الفاتورة مسدد منها بدفعة يدوية — اعكس الدفعة من شاشة الدفعات أولًا', { paidAmount: Number(inv.paidAmount) });
        }
        if (payClass.manual.length > 0) {
            await client.query('ROLLBACK');
            return fail(res, 409, 'INVOICE_HAS_PAYMENTS', 'الفاتورة مرتبطة بدفعات موردين يدوية — لا يمكن إلغاؤها قبل عكس الدفعة محاسبيًا', { payments: payClass.manual.length, total: round(payClass.manual.reduce((s, p) => s + Number(p.amount || 0), 0), 2) });
        }
        // دفعات آلية حصرًا: تُعكس مع الفاتورة داخل نفس المعاملة (سطر الدفعة + قيدها في الدفتر).
        let deletedPayments = 0;
        if (payClass.autoOnly) {
            const payIds = payClass.auto.map(p => String(p.id));
            await client.query('DELETE FROM supplier_payments WHERE id = ANY($1::bigint[])', [payClass.auto.map(p => Number(p.id))]);
            await client.query(
                `DELETE FROM journal_lines WHERE entry_id IN (
                    SELECT id FROM journal_entries WHERE source_type='supplier_payment' AND source_id = ANY($1::text[]))`,
                [payIds]);
            await client.query(
                `DELETE FROM journal_entries WHERE source_type='supplier_payment' AND source_id = ANY($1::text[])`,
                [payIds]);
            deletedPayments = payClass.auto.length;
        }
        const mainLocation = await getWarehouseLocation(client, 'MAIN-WAREHOUSE', 'المخزن الرئيسي', 'warehouse');
        let items = inv.items;
        if (typeof items === 'string') { try { items = JSON.parse(items); } catch (_) { items = []; } }
        if (!Array.isArray(items)) {items = [];}
        let reversed = 0;
        for (const it of items) {
            const invId = Number(it.itemId || it.item_id);
            const qty = Number(it.qty) || 0;
            // كان الكود يتجاوز البنود التالفة silently ثم يحذف الفاتورة — تضخم مخزني صامت.
            // الآن: أي بند غير قابل للعكس يُجهض العملية كلها بدل حذف جزئي.
            if (!Number.isInteger(invId) || !(qty > 0)) {
                await client.query('ROLLBACK');
                return fail(res, 422, 'VOID_ITEM_INVALID', `بند غير صالح في الفاتورة (${it.itemName || it.name || invId}) — تعذر العكس الكامل، راجع البيانات`);
            }
            const row = (await client.query('SELECT id, name, unit, qty, COALESCE("avgCost",0) AS avg_cost, COALESCE(weight,0) AS weight FROM inventory WHERE id = $1 FOR UPDATE', [invId])).rows[0];
            if (!row) {
                await client.query('ROLLBACK');
                return fail(res, 409, 'VOID_ITEM_DELETED', `الصنف محذوف من المخزن: ${it.itemName || it.name || invId} — عالجه يدويًا بقيد تسوية`);
            }
            const voidPrice = Number(it.price) || 0;
            const voidBoxes = it.packagingQty != null ? n(it.packagingQty) : (it.catch_weight_qty != null ? n(it.catch_weight_qty) : null);
            const voidPackUom = it.packagingUom || it.catch_weight_unit || null;
            const posted = await postInventoryLedgerEntry(client, {
                transactionType: 'reversal', inventoryId: invId, locationId: mainLocation.id,
                quantityDelta: -qty, unit: row.unit || it.unit || 'وحدة', unitCost: voidPrice,
                referenceType: 'purchase_invoice_void', referenceId: String(invoiceId), userId: req.user.id,
                idempotencyKey: `purchase-void:${invoiceId}:${invId}`,
                reason: `إلغاء فاتورة شراء ${inv.invoiceNumber || invoiceId} — عكس استلام ${row.name}`,
                metadata: { invoice_id: invoiceId, invoice_number: inv.invoiceNumber || null },
                catchWeightQty: voidBoxes, catchWeightUnit: voidBoxes !== null ? voidPackUom : null,
            });
            if (posted.replay) {
                await client.query('ROLLBACK');
                return fail(res, 409, 'VOID_ALREADY_APPLIED', `عكس الصنف ${row.name} مسجل مسبقًا — الفاتورة ملغاة جزئيًا؟ راجع الدفتر`);
            }
            // قيد تعويضي في سجل الحركات (لا مسح للتاريخ): يعكس الـ in الأصلية
            await client.query(
                `INSERT INTO "inventoryTx" (id, "itemId", "itemName", qty, type, date, cost, "totalValue", notes, "invoiceNumber", "supplierName", weight, catch_weight_qty, catch_weight_unit)
                 VALUES ($1,$2,$3,$4,'out',$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
                [id(), invId, row.name, qty, dateOnly(new Date()), voidPrice, round(qty * voidPrice, 2),
                    `إلغاء فاتورة شراء ${inv.invoiceNumber || invoiceId} — عكس استلام`, inv.invoiceNumber, inv.supplierName,
                    -(Number(it.weight) || 0), voidBoxes, voidBoxes !== null ? voidPackUom : null]
            );
            // إعادة حساب المتوسط المرجح بإخراج الكمية الملغاة + إنقاص الوزن المتراكم
            const freshQty = n((await client.query('SELECT COALESCE(SUM(on_hand),0) AS q FROM inventory_location_balances WHERE inventory_id=$1', [invId])).rows[0]?.q);
            if (freshQty > 0) {
                const newAvg = Math.max(0, round(((n(row.avg_cost) * (freshQty + qty)) - (voidPrice * qty)) / freshQty, 2));
                await client.query('UPDATE inventory SET "avgCost"=$2, weight=GREATEST(0, COALESCE(weight,0) - $3) WHERE id=$1',
                    [invId, newAvg, Math.max(0, Number(it.weight) || 0)]);
            } else {
                await client.query('UPDATE inventory SET weight=GREATEST(0, COALESCE(weight,0) - $2) WHERE id=$1',
                    [invId, Math.max(0, Number(it.weight) || 0)]);
            }
            reversed++;
        }
        // عكس القيد المحاسبي المرتبط (إن وُجد) — إبطال موثق بدل الحذف الصامت
        await client.query(
            `UPDATE journal_entries SET status='void'
              WHERE source_type='purchase_invoice' AND source_id=$1 AND status='posted'`,
            [String(invoiceId)]);
        await client.query('DELETE FROM "purchaseInvoices" WHERE id = $1', [invoiceId]);
        // TASK 9: حدث دومين داخل نفس المعاملة (fail-open)
        await emitDomainEvent(pool, client, 'PURCHASE', {
            eventType: 'PURCHASE_VOIDED', aggregateType: 'purchase_invoice', aggregateId: invoiceId,
            payload: {
                invoice_id: invoiceId, number: inv.invoiceNumber, reversed_items: reversed,
                paid_flag_without_payment: paidOpeningWithoutPayment,
            },
        });
        await client.query('COMMIT');
        emit(req, 'purchaseInvoices', 'delete', { id: invoiceId, invoiceNumber: inv.invoiceNumber, void: true, force: !!force });
        logger.warn(`[purchase_invoice_void] ${req.user?.username} ألغى الفاتورة ${inv.invoiceNumber} (${invoiceId})${paidOpeningWithoutPayment ? ' — حالة السداد كانت بالخطأ دون دفعة مسجلة' : ''}${force ? ' قسريًا' : ''} مع عكس ${reversed} صنفًا وحذف ${deletedPayments} دفعة`);
        res.json({ ok: true, invoiceNumber: inv.invoiceNumber, reversedItems: reversed, deletedPayments, force: !!force });
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        logger.error('[pr_create]', error);
        logger.error('[purchase_invoice_void]', error);
        res.status(500).json({ error: 'INVOICE_VOID_FAILED', message: 'تعذر إلغاء الفاتورة: ' + String(error.message).slice(0, 160) });
    } finally { client.release(); }
});

// ═══ طلب المالك 2026-10-05: «أعيد الرصيد الافتتاحي مرة أخرى وأحذف القديم — بس اخصم من الرصيد طلبات الصرف» ═══
// تقرير الأرصدة الافتتاحية المسجلة (فواتير OPEN-*): كل فاتورة وبنودها:
// المدخل قديمًا • المنصرف منذذك (مجموع قيود الصرف من دفتر المخزون) • الرصيد الحالي.
// إلغاء الرصيد القديم (PUT void) يعكس استلامه فقط — حركات الصرف تبقى محسوبة —
// ثم يُدخل الرصيد الجديد من شاشة الرصيد الافتتاحي فيعود الرصيد = الجديد − المنصرف.
function parseInvoiceItems(inv) {
    let items = inv?.items;
    if (typeof items === 'string') { try { items = JSON.parse(items); } catch (_) { items = []; } }
    return Array.isArray(items) ? items : [];
}
router.get('/opening-balance/report', jwtAuth, requireRole('admin', 'manager', 'warehouse'), async (req, res) => {
    try {
        const invoices = (await pool.query(
            `SELECT id, "invoiceNumber", date, "totalAmount", notes, items
             FROM "purchaseInvoices"
             WHERE "invoiceNumber" LIKE 'OPEN-%' OR notes LIKE 'رصيد افتتاحي%'
             ORDER BY date DESC, id DESC`)).rows;
        const out = [];
        for (const inv of invoices) {
            const detailed = [];
            for (const it of parseInvoiceItems(inv)) {
                const invId = Number(it.itemId || it.item_id) || null;
                let currentQty = null, issuedSince = 0, itemExists = false;
                if (invId) {
                    const row = (await pool.query('SELECT qty FROM inventory WHERE id=$1', [invId])).rows[0];
                    if (row) { itemExists = true; currentQty = n(row.qty); }
                    issuedSince = round(n((await pool.query(
                        `SELECT COALESCE(SUM(-quantity_delta),0)::float AS q
                         FROM inventory_ledger
                         WHERE inventory_id=$1 AND reference_type='dispatch' AND business_date >= $2`,
                        [invId, String(inv.date || '').slice(0, 10)])).rows[0]?.q), 3);
                }
                detailed.push({ itemId: invId, itemName: it.itemName || it.name || '', qty: n(it.qty),
                    unit: it.unit || '', price: n(it.price), category: it.category || '',
                    packagingQty: it.packagingQty != null ? n(it.packagingQty) : null,
                    currentQty, issuedSince, itemExists });
            }
            out.push({ id: inv.id, invoiceNumber: inv.invoiceNumber, date: inv.date,
                totalAmount: n(inv.totalAmount), notes: inv.notes || '', items: detailed });
        }
        res.json({ invoices: out });
    } catch (error) {
        logger.error('[opening_balance_report]', error);
        return fail(res, 500, 'OPENING_REPORT_FAILED', 'تعذر تقرير الأرصدة الافتتاحية');
    }
});

// الرصيد الفعلي بالمخزن الرئيسي لكل صنف — أساس عرض «المتاح» في طلبات الصرف
// (طلب المالك 2026-10-06: المتاح لإذن الصرف = رصيد الرئيسي، وما في مخازن الأقسام لا يُعاد صرفه)
router.get('/main-availability', jwtAuth, async (req, res) => {
    try {
        const rows = (await pool.query(
            `SELECT b.inventory_id AS id, COALESCE(b.on_hand,0)::float AS on_hand
             FROM inventory_location_balances b
             JOIN inventory_locations l ON l.id = b.location_id
             WHERE l.code='MAIN-WAREHOUSE' AND l.active=true`)).rows;
        res.json({ items: rows.map(r => ({ id: Number(r.id), on_hand: n(r.on_hand) })) });
    } catch (error) {
        logger.error('[main_availability]', error);
        return fail(res, 500, 'MAIN_AVAILABILITY_FAILED', 'تعذر حساب أرصدة المخزن الرئيسي');
    }
});

// ─── فحص النظام الشامل (طلب المالك 2026-10-06: «سهل جدا وزكي جدا وقوي جدا») ───
// تشخيص فوري بضغطة زر: كل صنف — الرصيد = مجموع المخازن = صافي الدفتر —
// وأي خلل يظهر بالاسم ليقرره المالك فورًا بدل البحث اليدوي.
router.get('/system-health', jwtAuth, requireRole('admin'), async (req, res) => {
    try {
        const anomalies = [];
        const items = (await pool.query('SELECT id, name, qty, unit FROM inventory ORDER BY id')).rows;
        const balRows = (await pool.query('SELECT inventory_id, SUM(on_hand) AS s FROM inventory_location_balances GROUP BY inventory_id')).rows;
        const balMap = new Map(balRows.map(b => [Number(b.inventory_id), Number(b.s)]));
        const ledRows = (await pool.query('SELECT inventory_id, SUM(quantity_delta) AS net, COUNT(*)::int AS c FROM inventory_ledger GROUP BY inventory_id')).rows;
        const ledMap = new Map(ledRows.map(l => [Number(l.inventory_id), l]));
        let consistent = 0;
        for (const it of items) {
            const id = Number(it.id);
            const qty = n(it.qty);
            const bal = balMap.get(id) ?? 0;
            if (Math.abs(qty - bal) > 0.001) {
                anomalies.push({ name: it.name, issue: `الرصيد ${round(qty, 3)} ≠ مجموع المخازن ${round(bal, 3)}` });
                continue;
            }
            const led = ledMap.get(id);
            if (led && Number(led.c) > 0 && Math.abs(Number(led.net) - qty) > 0.001) {
                anomalies.push({ name: it.name, issue: `صافي الدفتر ${round(led.net, 3)} ≠ الرصيد ${round(qty, 3)}` });
                continue;
            }
            consistent++;
        }
        const zeroStock = items.filter(i => n(i.qty) <= 0).length;
        const lowStock = Number((await pool.query(
            'SELECT COUNT(*)::int AS c FROM inventory WHERE qty > 0 AND qty <= COALESCE("minQty",0)')).rows[0].c);
        res.json({
            ok: anomalies.length === 0,
            itemsTotal: items.length,
            consistent,
            anomaliesCount: anomalies.length,
            anomalies: anomalies.slice(0, 30),
            zeroStock,
            lowStock,
        });
    } catch (error) {
        logger.error('[system_health]', error);
        return fail(res, 500, 'SYSTEM_HEALTH_FAILED', 'تعذر فحص النظام: ' + String(error.message).slice(0, 120));
    }
});

// إجمالي المنصرف لكل صنف (قيود أذون الصرف من الدفتر) — لوضع «الرصيد الصافي» في شاشة الافتتاحي
router.get('/issued-totals', jwtAuth, requireRole('admin', 'manager', 'warehouse'), async (req, res) => {
    try {
        const rows = (await pool.query(
            `SELECT l.inventory_id AS "itemId", COALESCE(i.name,'(محذوف)') AS "itemName", COALESCE(i.unit,'') AS unit,
                    COALESCE(SUM(-l.quantity_delta),0)::float AS issued
             FROM inventory_ledger l
             LEFT JOIN inventory i ON i.id = l.inventory_id
             WHERE l.reference_type='dispatch'
             GROUP BY l.inventory_id, i.name, i.unit
             HAVING COALESCE(SUM(-l.quantity_delta),0) > 0
             ORDER BY issued DESC`)).rows;
        res.json({ items: rows });
    } catch (error) {
        logger.error('[issued_totals]', error);
        return fail(res, 500, 'ISSUED_TOTALS_FAILED', 'تعذر حساب إجمالي المنصرف');
    }
});

// ═══ حذف كل فواتير الشراء (أدمن فقط) — يعكس أثرها على كميات المخزون ═══
// يشمل عكس قيود الاستلام (purchase_invoice) وقيود الإلغاء (purchase_invoice_void)
// حتى تعود أرصدة المواقع لما قبل الفواتير، ثم يعيد حساب كميات الأصناف من الأرصدة.
router.post('/purchase-invoices/clear-all', jwtAuth, requireRole('admin'), async (req, res) => {
    const client = await pool.connect();
    try {
        const confirm = cleanName(req.body?.confirm);
        if (confirm !== 'حذف كل الفواتير') {
            return fail(res, 422, 'CONFIRM_REQUIRED', 'عبارة التأكيد غير صحيحة — فعّل مربع التأكيد');
        }
        await client.query('BEGIN');
        const all = await client.query('SELECT id, "invoiceNumber" FROM "purchaseInvoices"');
        const ids = all.rows.map(r => String(r.id));
        const numbers = all.rows.map(r => r.invoiceNumber).filter(Boolean);
        const led = ids.length ? await client.query(
            `DELETE FROM inventory_ledger
              WHERE reference_type IN ('purchase_invoice','purchase_invoice_void')
                AND reference_id = ANY($1::text[])
             RETURNING inventory_id, location_id, quantity_delta`, [ids]) : { rows: [], rowCount: 0 };
        const balDelta = new Map();
        for (const r of led.rows) {
            const k = `${r.inventory_id}|${r.location_id}`;
            balDelta.set(k, (balDelta.get(k) || 0) - Number(r.quantity_delta));
        }
        for (const [k, d] of balDelta.entries()) {
            const [iid, lid] = k.split('|');
            await client.query(
                `UPDATE inventory_location_balances SET on_hand = on_hand + $1, updated_at = CURRENT_TIMESTAMP
                  WHERE inventory_id = $2::bigint AND location_id = $3::bigint`, [d, iid, lid]);
        }
        await client.query(
            `UPDATE inventory SET qty = COALESCE((SELECT SUM(on_hand) FROM inventory_location_balances WHERE inventory_id = inventory.id), 0)`);
        let txDeleted = 0;
        if (numbers.length) {
            const tx = await client.query(`DELETE FROM "inventoryTx" WHERE "invoiceNumber" = ANY($1::text[])`, [numbers]);
            txDeleted = tx.rowCount;
        }
        const del = ids.length ? await client.query(`DELETE FROM "purchaseInvoices" WHERE id = ANY($1::bigint[]) RETURNING id`, [ids]) : { rowCount: 0 };
        // ROOT FIX 2026-10-02: الحذف الشامل كان يترك قيود المشتريات يتيمة في
        // ميزان المراجعة (فواتيرها محذوفة) — تُبطَّل موثقًا بنفس نمط إلغاء
        // الفاتورة المفردة (status='void'، لا حذف صامت).
        let voidedJournals = 0;
        if (ids.length) {
            const vj = await client.query(
                `UPDATE journal_entries SET status='void'
                  WHERE source_type='purchase_invoice' AND source_id = ANY($1::text[]) AND status='posted'`, [ids]);
            voidedJournals = vj.rowCount;
        }
        await client.query('COMMIT');
        try { emit(req, 'purchaseInvoices', 'reset', {}); emit(req, 'inventory', 'reset', {}); emit(req, 'inventoryTx', 'reset', {}); } catch (_) {}
        logger.warn(`[PURCHASE_INVOICES] admin ${req.user?.id} حذف كل الفواتير (${del.rowCount}) وعكس ${led.rowCount} قيد مخزون وأبطأ ${voidedJournals} قيد محاسبي`);
        res.json({ ok: true, deletedInvoices: del.rowCount, reversedLedgerRows: led.rowCount, deletedTransactions: txDeleted, voidedJournals });
    } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        logger.error('[purchase_invoices_clear_all]', e);
        res.status(500).json({ error: 'CLEAR_INVOICES_FAILED', message: 'تعذر حذف الفواتير — راجع سجل الخادم' });
    } finally { client.release(); }
});

// ═══ طلبات شراء النواقص: بيتها المخزن — أمين المخزن ينشئ (تلقائي من الحد الأدنى + يدوي) → الشيف يوقّع → المدير العام يعتمد نهائيًا → المخزن يستلم ═══
// طلب فقط (لا يولّد فاتورة ولا يحرك مخزونًا) — التوثيق بتوقيع صاحب الحساب عبر requireSignature.
// (2026-10-01 بطلب المالك: الإنشاء من المخزن حصرًا — kitchen/dept_head كانا ينشئان سابقًا)
const PR_CREATE_ROLES = ['admin', 'manager', 'warehouse', 'kitchen', 'sous_chef'];
// الإلغاء أوسع عمدًا: أصحاب الطلبات القديمة (مطبخ/رئيس قسم) يلغون ما أنشأوه — الفحص الحقيقي ملكية داخل المسار
const PR_CANCEL_ROLES = ['admin', 'manager', 'warehouse', 'kitchen', 'sous_chef', 'dept_head'];
const PR_CHEF_ROLES = ['admin', 'manager', 'kitchen', 'sous_chef'];
const PR_GM_ROLES = ['admin', 'manager'];
// استلام المخزن للبضاعة بعد الاعتماد النهائي (توقيع أمين المخزن + دخول مخزني)
const PR_WH_ROLES = ['admin', 'manager', 'warehouse'];
const PR_READ_ROLES = ['admin', 'manager', 'warehouse', 'kitchen', 'sous_chef', 'accountant'];
// UPGRADE 2026-10-04 (طلب المالك): المطبخ ينشئ طلب شراء موقّع من الشيف يروح للمخزن مباشرة
const PR_CHEF_CREATE_ROLES = ['kitchen', 'sous_chef'];

/**
 * نقية: تطبيع أصناف طلب الشراء ودمج المكرر بالاسم (التلقائي + اليدوي معًا).
 * يقبل itemName/name و requestedQty/qty — الكمية المطلوبة موجبة فقط.
 */
function normalizePRItems(items) {
    const grouped = new Map();
    for (const raw of Array.isArray(items) ? items : []) {
        const itemName = cleanName(raw.itemName || raw.name);
        const requestedQty = round(n(raw.requestedQty ?? raw.qty, NaN));
        if (!itemName || !Number.isFinite(requestedQty) || requestedQty <= 0) {continue;}
        const key = itemName.toLowerCase();
        const cur = grouped.get(key) || {
            itemName,
            itemId: Number(raw.itemId || raw.item_id) || null,
            unit: cleanName(raw.unit) || 'وحدة',
            currentQty: null,
            minQty: null,
            requestedQty: 0,
            notes: null,
        };
        cur.requestedQty = round(cur.requestedQty + requestedQty);
        if (!cur.itemId && (raw.itemId || raw.item_id)) {cur.itemId = Number(raw.itemId || raw.item_id) || null;}
        if ((!cur.unit || cur.unit === 'وحدة') && raw.unit) {cur.unit = cleanName(raw.unit);}
        const note = cleanName(raw.notes);
        if (note) {cur.notes = cur.notes ? `${cur.notes}؛ ${note}` : note;}
        grouped.set(key, cur);
    }
    return [...grouped.values()];
}

/**
 * نقية: الكمية المقترحة للنواقص = العجز عن الحد الأدنى (minQty - qty إن كان موجبًا).
 */
function prShortageSuggestion(currentQty, minQty) {
    const deficit = round(n(minQty) - n(currentQty));
    return deficit > 0 ? deficit : 0;
}

/**
 * نقية: هل يجوز للشيف البت في هذا الطلب؟ (pending فقط)
 */
function canPRChefDecide(pr) {
    if (!pr) {return { ok: false, code: 'PR_NOT_FOUND' };}
    if (pr.status === 'pending') {return { ok: true };}
    if (pr.status === 'chef_approved') {return { ok: false, code: 'PR_CHEF_DECIDED' };}
    if (pr.status === 'approved') {return { ok: false, code: 'PR_ALREADY_APPROVED' };}
    if (pr.status === 'rejected') {return { ok: false, code: 'PR_REJECTED' };}
    if (pr.status === 'cancelled') {return { ok: false, code: 'PR_CANCELLED' };}
    return { ok: false, code: 'PR_INVALID_STATUS' };
}

/**
 * نقية: هل يجوز للمدير العام البت؟ — بعد توقيع الشيف حصرًا، وبتوقيع مستخدم
 * مختلف عن شيف الطلب (يلزم توقيعان مختلفان: شيف ثم مدير عام).
 */
function canPRGMDecide(pr, user) {
    if (!pr) {return { ok: false, code: 'PR_NOT_FOUND' };}
    if (pr.status !== 'chef_approved') {
        if (pr.status === 'pending') {return { ok: false, code: 'PR_CHEF_APPROVAL_REQUIRED' };}
        if (pr.status === 'approved') {return { ok: false, code: 'PR_ALREADY_APPROVED' };}
        if (pr.status === 'rejected') {return { ok: false, code: 'PR_REJECTED' };}
        if (pr.status === 'cancelled') {return { ok: false, code: 'PR_CANCELLED' };}
        return { ok: false, code: 'PR_INVALID_STATUS' };
    }
    if (user && pr.chef_approved_by != null && Number(pr.chef_approved_by) === Number(user.id)) {
        return { ok: false, code: 'PR_SELF_APPROVAL' };
    }
    return { ok: true };
}

function prRequestNumber() {
    const day = riyadhToday().replace(/-/g, '');
    return `PR-${day}-${String(Date.now()).slice(-6)}${Math.floor(Math.random() * 90 + 10)}`;
}

async function ensurePurchaseRequestSchema() {
    await pool.query(`CREATE TABLE IF NOT EXISTS purchase_requests (
        id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        request_number TEXT UNIQUE NOT NULL,
        items JSONB NOT NULL DEFAULT '[]',
        notes TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        created_by BIGINT, creator_name TEXT, creator_role TEXT,
        chef_approved_by BIGINT, chef_approved_name TEXT, chef_approved_at TIMESTAMPTZ,
        chef_signature_data TEXT, chef_signature_hash TEXT, chef_notes TEXT,
        gm_approved_by BIGINT, gm_approved_name TEXT, gm_approved_at TIMESTAMPTZ,
        gm_signature_data TEXT, gm_signature_hash TEXT, gm_notes TEXT,
        rejected_by BIGINT, rejected_name TEXT, rejected_at TIMESTAMPTZ, rejection_reason TEXT,
        rejection_signature_data TEXT, rejection_signature_hash TEXT,
        last_event_hash TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );`);
    await pool.query(`CREATE TABLE IF NOT EXISTS purchase_request_events (
        id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        request_id BIGINT NOT NULL REFERENCES purchase_requests(id) ON DELETE CASCADE,
        event_type TEXT NOT NULL,
        from_status TEXT, to_status TEXT NOT NULL,
        actor_user_id BIGINT, actor_name TEXT, actor_role TEXT,
        signature_hash TEXT,
        event_payload JSONB NOT NULL DEFAULT '{}',
        previous_event_hash TEXT,
        event_hash TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );`);
    await pool.query(`CREATE INDEX IF NOT EXISTS purchase_requests_status_idx ON purchase_requests(status);`);
    await pool.query(`CREATE INDEX IF NOT EXISTS purchase_request_events_request_idx ON purchase_request_events(request_id);`);
    // ترحيل آمن: نسخة أقدم من جدول طلبات الشراء قد توجد بأعمدة مختلفة —
    // نضيف أعمدة السلسلة الجديدة دون المساس بالبيانات القائمة.
    for (const ddl of [
        'ALTER TABLE purchase_requests ADD COLUMN IF NOT EXISTS creator_name TEXT',
        'ALTER TABLE purchase_requests ADD COLUMN IF NOT EXISTS creator_role TEXT',
        'ALTER TABLE purchase_requests ADD COLUMN IF NOT EXISTS chef_approved_by BIGINT',
        'ALTER TABLE purchase_requests ADD COLUMN IF NOT EXISTS chef_approved_name TEXT',
        'ALTER TABLE purchase_requests ADD COLUMN IF NOT EXISTS chef_approved_at TIMESTAMPTZ',
        'ALTER TABLE purchase_requests ADD COLUMN IF NOT EXISTS gm_approved_by BIGINT',
        'ALTER TABLE purchase_requests ADD COLUMN IF NOT EXISTS gm_approved_name TEXT',
        'ALTER TABLE purchase_requests ADD COLUMN IF NOT EXISTS gm_approved_at TIMESTAMPTZ',
        'ALTER TABLE purchase_requests ADD COLUMN IF NOT EXISTS gm_signature_data TEXT',
        'ALTER TABLE purchase_requests ADD COLUMN IF NOT EXISTS gm_signature_hash TEXT',
        'ALTER TABLE purchase_requests ADD COLUMN IF NOT EXISTS gm_notes TEXT',
        'ALTER TABLE purchase_requests ADD COLUMN IF NOT EXISTS rejected_by BIGINT',
        'ALTER TABLE purchase_requests ADD COLUMN IF NOT EXISTS rejected_name TEXT',
        'ALTER TABLE purchase_requests ADD COLUMN IF NOT EXISTS rejected_at TIMESTAMPTZ',
        'ALTER TABLE purchase_requests ADD COLUMN IF NOT EXISTS rejection_reason TEXT',
        'ALTER TABLE purchase_requests ADD COLUMN IF NOT EXISTS rejection_signature_data TEXT',
        'ALTER TABLE purchase_requests ADD COLUMN IF NOT EXISTS rejection_signature_hash TEXT',
        'ALTER TABLE purchase_requests ADD COLUMN IF NOT EXISTS last_event_hash TEXT',
        'ALTER TABLE purchase_requests ADD COLUMN IF NOT EXISTS wh_received_by BIGINT',
        'ALTER TABLE purchase_requests ADD COLUMN IF NOT EXISTS wh_received_name TEXT',
        'ALTER TABLE purchase_requests ADD COLUMN IF NOT EXISTS wh_received_at TIMESTAMPTZ',
        'ALTER TABLE purchase_requests ADD COLUMN IF NOT EXISTS wh_signature_data TEXT',
        'ALTER TABLE purchase_requests ADD COLUMN IF NOT EXISTS wh_signature_hash TEXT',
        'ALTER TABLE purchase_requests ADD COLUMN IF NOT EXISTS wh_notes TEXT',
        'ALTER TABLE purchase_requests ADD COLUMN IF NOT EXISTS received_items JSONB',
        'ALTER TABLE purchase_requests ADD COLUMN IF NOT EXISTS dept_code TEXT',
        'ALTER TABLE purchase_requests ADD COLUMN IF NOT EXISTS dept_name TEXT',
        'ALTER TABLE purchase_requests ADD COLUMN IF NOT EXISTS deliver_mode TEXT',
    ]) { await pool.query(ddl); }
    // ترحيل مفتاح الجدول القديم: نسخة سابقة بلا توليد تلقائي للـ id —
    // نضيف الهوية إن غابت ونزامن التسلسل بعد أقصى id محفوظ.
    await pool.query(`DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                        WHERE table_name='purchase_requests' AND column_name='id'
                          AND (column_default IS NOT NULL OR is_identity='YES')) THEN
            ALTER TABLE purchase_requests ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY;
        END IF;
    END $$;`);
    await pool.query(`SELECT setval(pg_get_serial_sequence('purchase_requests','id'), GREATEST(COALESCE((SELECT MAX(id) FROM purchase_requests), 1), 1));`);
    // ترحيل قيد الحالة: نسخة سابقة تسمح فقط (pending_chef/approved/rejected/converted) —
    // نستبدله بحالات السلسلة الجديدة (pending/chef_approved/approved/partially_fulfilled/fulfilled/rejected/cancelled).
    await pool.query(`DO $$ BEGIN
        ALTER TABLE purchase_requests DROP CONSTRAINT IF EXISTS purchase_requests_status_check;
        ALTER TABLE purchase_requests ADD CONSTRAINT purchase_requests_status_check
            CHECK (status IN ('pending','chef_approved','approved','partially_fulfilled','fulfilled','rejected','cancelled'));
    END $$;`);
}

async function appendPREvent(client, requestId, eventType, fromStatus, toStatus, req, signature, payload = {}) {
    const previous = (await client.query('SELECT event_hash FROM purchase_request_events WHERE request_id=$1 ORDER BY id DESC LIMIT 1', [requestId])).rows[0]?.event_hash || null;
    const actorName = req.user?.name || req.user?.username || String(req.user?.id || 'unknown');
    const actorRole = req.user?.role || 'unknown';
    const canonical = JSON.stringify({ requestId, eventType, fromStatus, toStatus, actorUserId: req.user?.id || null, actorName, actorRole, signatureHash: signatureHash(signature), eventPayload: payload || {}, previous });
    const eventHash = crypto.createHash('sha256').update(canonical).digest('hex');
    const row = (await client.query(`INSERT INTO purchase_request_events(request_id,event_type,from_status,to_status,actor_user_id,actor_name,actor_role,signature_hash,event_payload,previous_event_hash,event_hash)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [requestId, eventType, fromStatus || null, toStatus, req.user?.id || null, actorName, actorRole, signatureHash(signature), json(payload || {}), previous, eventHash])).rows[0];
    await client.query('UPDATE purchase_requests SET last_event_hash=$1, updated_at=CURRENT_TIMESTAMP WHERE id=$2', [eventHash, requestId]);
    return row;
}

function prStatusCode(code) {
    return {
        PR_NOT_FOUND: [404, 'طلب الشراء غير موجود'],
        PR_CHEF_APPROVAL_REQUIRED: [409, 'طلب الشراء بانتظار توقيع الشيف أولًا'],
        PR_CHEF_DECIDED: [409, 'الشيف بتّ في هذا الطلب مسبقًا'],
        PR_ALREADY_APPROVED: [409, 'طلب الشراء معتمد نهائيًا مسبقًا'],
        PR_REJECTED: [409, 'طلب الشراء مرفوض'],
        PR_CANCELLED: [409, 'طلب الشراء ملغي'],
        PR_SELF_APPROVAL: [409, 'لا يجوز أن يعتمد المدير العام طلبًا وقّعه هو كشيف — يلزم توقيعان مختلفان'],
        PR_INVALID_STATUS: [409, 'حالة طلب الشراء لا تسمح بهذا الإجراء'],
    }[code] || [409, 'تعذر تنفيذ الإجراء على طلب الشراء'];
}

// نواقص المخزن: الأصناف التي بلغت الحد الأدنى أو تحته + الكمية المقترحة للشراء
router.get('/purchase-requests/shortages', jwtAuth, requireRole(...PR_READ_ROLES), async (req, res) => {
    try {
        const r = await pool.query(`SELECT id, name, unit, COALESCE(qty,0) AS qty, COALESCE("minQty",0) AS "minQty" 
            FROM inventory WHERE COALESCE(qty,0) < COALESCE("minQty",0)
            ORDER BY (COALESCE("minQty",0) - COALESCE(qty,0)) DESC NULLS LAST, name LIMIT 200`);
        res.json(r.rows.map(row => ({
            itemId: Number(row.id),
            itemName: row.name,
            unit: row.unit || 'وحدة',
            currentQty: Number(row.qty),
            minQty: Number(row.minQty),
            suggestedQty: prShortageSuggestion(row.qty, row.minQty),
        })));
    } catch (error) {
        logger.error('[pr_shortages]', error);
        res.status(500).json({ error: 'PR_SHORTAGES_FAILED', message: 'تعذر جلب نواقص المخزن' });
    }
});

router.get('/purchase-requests', jwtAuth, requireRole(...PR_READ_ROLES), async (req, res) => {
    try {
        await ensurePurchaseRequestSchema();
        const r = await pool.query('SELECT * FROM purchase_requests ORDER BY created_at DESC LIMIT 200');
        res.json(r.rows);
    } catch (error) {
        logger.error('[pr_list]', error);
        res.status(500).json({ error: 'PR_LIST_FAILED', message: 'تعذر جلب طلبات الشراء' });
    }
});

// إنشاء أمين المخزن: أصناف تلقائية + يدوية مدمجة — يبدأ pending بانتظار الشيف
router.post('/purchase-requests', jwtAuth, requireRole(...PR_CREATE_ROLES), async (req, res) => {
    // الشيف (kitchen/sous_chef) ينشئ الطلب موقّعًا من نفسه — يدخل للمخزن مباشرة
    // بحالة chef_approved بدل انتظار توقيع شيف آخر. بقية الأدوار كما كانت (pending).
    const isChefCreator = PR_CHEF_CREATE_ROLES.includes(req.user.role);
    let chefSignature = null;
    if (isChefCreator) {
        chefSignature = requireSignature(req, res);
        if (!chefSignature) {return;}
    }
    const client = await pool.connect();
    try {
        await ensurePurchaseRequestSchema();
        const items = normalizePRItems(req.body?.items);
        if (!items.length) {return fail(res, 422, 'PR_ITEMS_REQUIRED', 'أضف صنفًا واحدًا على الأقل بكمية موجبة (من النواقص أو يدويًا)');}
        if (items.length > 200) {return fail(res, 422, 'PR_TOO_MANY_ITEMS', 'عدد الأصناف كبير — قسم الطلب على دفعات');}
        await client.query('BEGIN');
        // إثراء تلقائي: الرصيد والحد الأدنى والوحدة من بطاقة الصنف عند توفرها
        for (const it of items) {
            const row = it.itemId
                ? (await client.query('SELECT id,name,unit,qty,"minQty" FROM inventory WHERE id=$1', [it.itemId])).rows[0]
                : (await client.query('SELECT id,name,unit,qty,"minQty" FROM inventory WHERE LOWER(name)=LOWER($1) LIMIT 1', [it.itemName])).rows[0];
            if (row) {
                it.itemId = Number(row.id);
                it.itemName = row.name;
                it.unit = row.unit || it.unit || 'وحدة';
                it.currentQty = Number(row.qty);
                it.minQty = Number(row.minQty);
            }
        }
        const actorName = req.user.name || req.user.username || String(req.user.id);
        // القسم الطالب: يُحفظ مع الطلب (يُستخدم للتسليم المباشر والتكلفة) — إصلاح 2026-10-01:
        // كان يُرسَل من الواجهة ويُرمى هنا (null دائمًا) فيفشل التسليم المباشر لاحقًا
        let deptCode = null, deptName = null;
        const dcRaw = cleanName(req.body?.deptCode || req.body?.dept_code);
        if (dcRaw) {
            const dep = (await client.query(
                'SELECT code, name FROM departments WHERE LOWER(code)=LOWER($1) LIMIT 1', [dcRaw])).rows[0];
            if (!dep) {
                await client.query('ROLLBACK');
                return fail(res, 422, 'PR_DEPT_UNKNOWN', 'القسم الطالب غير مسجل في دليل الأقسام');
            }
            deptCode = dep.code; deptName = dep.name;
        }
        const chefAt = new Date().toISOString();
        // UPGRADE 2026-10-04 (أمر المالك): طلب المطبخ الموقّع من الشيف = نهائي
        // (status='approved') — يروح المخزن مباشرة بدون مرحلة المدير العام.
        const inserted = (await client.query(`INSERT INTO purchase_requests(request_number,items,notes,status,created_by,creator_name,creator_role,dept_code,dept_name,
          chef_approved_by, chef_approved_name, chef_approved_at, chef_signature_data, chef_signature_hash, chef_notes)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
          [prRequestNumber(), json(items), cleanName(req.body?.notes) || null,
           isChefCreator ? 'approved' : 'pending',
           req.user.id, actorName, req.user.role, deptCode, deptName,
           isChefCreator ? req.user.id : null,
           isChefCreator ? actorName : null,
           isChefCreator ? chefAt : null,
           isChefCreator ? chefSignature : null,
           isChefCreator ? signatureHash(chefSignature) : null,
           isChefCreator ? (cleanName(req.body?.notes) || null) : null])).rows[0];
        await appendPREvent(client, inserted.id, isChefCreator ? 'chef_approved' : 'created', null, inserted.status, req, isChefCreator ? chefSignature : null, { items, notes: req.body?.notes || null, chefCreated: isChefCreator, chefFinal: isChefCreator });
        await client.query('COMMIT');
        emit(req, 'purchaseRequests', 'create', inserted);
        res.status(201).json(inserted);
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        logger.error('[pr_create]', error);
        res.status(500).json({ error: 'PR_CREATE_FAILED', message: 'تعذر إنشاء طلب الشراء' });
    } finally { client.release(); }
});

// توقيع الشيف (الخطوة الأولى) — بتوقيع صاحب الحساب حصرًا عبر requireSignature
router.post('/purchase-requests/:id/chef-approve', jwtAuth, requireRole(...PR_CHEF_ROLES), async (req, res) => {
    const signature = requireSignature(req, res);
    if (!signature) {return;}
    const client = await pool.connect();
    try {
        await ensurePurchaseRequestSchema();
        await client.query('BEGIN');
        const pr = (await client.query('SELECT * FROM purchase_requests WHERE id=$1 FOR UPDATE', [req.params.id])).rows[0];
        const gate = canPRChefDecide(pr);
        if (!gate.ok) {
            await client.query('ROLLBACK');
            const [status, message] = prStatusCode(gate.code);
            return fail(res, status, gate.code, message);
        }
        const at = new Date().toISOString();
        const actorName = req.user.name || req.user.username || String(req.user.id);
        const updated = (await client.query(`UPDATE purchase_requests SET status='chef_approved',
          chef_approved_by=$1, chef_approved_name=$2, chef_approved_at=$3,
          chef_signature_data=$4, chef_signature_hash=$5, chef_notes=$6, updated_at=CURRENT_TIMESTAMP WHERE id=$7 RETURNING *`,
          [req.user.id, actorName, at, signature, signatureHash(signature), cleanName(req.body?.notes) || null, pr.id])).rows[0];
        await appendPREvent(client, pr.id, 'chef_approved', pr.status, 'chef_approved', req, signature, { notes: req.body?.notes || null });
        await client.query('COMMIT');
        emit(req, 'purchaseRequests', 'update', updated);
        res.json(updated);
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        logger.error('[pr_create]', error);
        logger.error('[pr_chef_approve]', error);
        res.status(500).json({ error: 'PR_CHEF_APPROVE_FAILED', message: 'تعذر توقيع الشيف على طلب الشراء' });
    } finally { client.release(); }
});

router.post('/purchase-requests/:id/chef-reject', jwtAuth, requireRole(...PR_CHEF_ROLES), async (req, res) => {
    const signature = requireSignature(req, res);
    if (!signature) {return;}
    const reason = cleanName(req.body?.reason);
    if (!reason || reason.length < 3) {return fail(res, 422, 'PR_REASON_REQUIRED', 'سبب الرفض مطلوب (3 أحرف على الأقل)');}
    const client = await pool.connect();
    try {
        await ensurePurchaseRequestSchema();
        await client.query('BEGIN');
        const pr = (await client.query('SELECT * FROM purchase_requests WHERE id=$1 FOR UPDATE', [req.params.id])).rows[0];
        const gate = canPRChefDecide(pr);
        if (!gate.ok) {
            await client.query('ROLLBACK');
            const [status, message] = prStatusCode(gate.code);
            return fail(res, status, gate.code, message);
        }
        const at = new Date().toISOString();
        const actorName = req.user.name || req.user.username || String(req.user.id);
        const updated = (await client.query(`UPDATE purchase_requests SET status='rejected',
          rejected_by=$1, rejected_name=$2, rejected_at=$3, rejection_reason=$4,
          rejection_signature_data=$5, rejection_signature_hash=$6, updated_at=CURRENT_TIMESTAMP WHERE id=$7 RETURNING *`,
          [req.user.id, actorName, at, reason, signature, signatureHash(signature), pr.id])).rows[0];
        await appendPREvent(client, pr.id, 'chef_rejected', pr.status, 'rejected', req, signature, { reason });
        await client.query('COMMIT');
        emit(req, 'purchaseRequests', 'update', updated);
        res.json(updated);
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        logger.error('[pr_create]', error);
        logger.error('[pr_chef_reject]', error);
        res.status(500).json({ error: 'PR_CHEF_REJECT_FAILED', message: 'تعذر رفض طلب الشراء' });
    } finally { client.release(); }
});

// اعتماد المدير العام (نهائي) — بعد توقيع الشيف، وبتوقيع مختلف عنه
router.post('/purchase-requests/:id/gm-approve', jwtAuth, requireRole(...PR_GM_ROLES), async (req, res) => {
    const signature = requireSignature(req, res);
    if (!signature) {return;}
    const client = await pool.connect();
    try {
        await ensurePurchaseRequestSchema();
        await client.query('BEGIN');
        const pr = (await client.query('SELECT * FROM purchase_requests WHERE id=$1 FOR UPDATE', [req.params.id])).rows[0];
        const gate = canPRGMDecide(pr, req.user);
        if (!gate.ok) {
            await client.query('ROLLBACK');
            const [status, message] = prStatusCode(gate.code);
            return fail(res, status, gate.code, message);
        }
        const at = new Date().toISOString();
        const actorName = req.user.name || req.user.username || String(req.user.id);
        const updated = (await client.query(`UPDATE purchase_requests SET status='approved',
          gm_approved_by=$1, gm_approved_name=$2, gm_approved_at=$3,
          gm_signature_data=$4, gm_signature_hash=$5, gm_notes=$6, updated_at=CURRENT_TIMESTAMP WHERE id=$7 RETURNING *`,
          [req.user.id, actorName, at, signature, signatureHash(signature), cleanName(req.body?.notes) || null, pr.id])).rows[0];
        await appendPREvent(client, pr.id, 'gm_approved', pr.status, 'approved', req, signature, { notes: req.body?.notes || null });
        await client.query('COMMIT');
        emit(req, 'purchaseRequests', 'update', updated);
        res.json(updated);
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        logger.error('[pr_create]', error);
        logger.error('[pr_gm_approve]', error);
        res.status(500).json({ error: 'PR_GM_APPROVE_FAILED', message: 'تعذر اعتماد المدير العام لطلب الشراء' });
    } finally { client.release(); }
});

router.post('/purchase-requests/:id/gm-reject', jwtAuth, requireRole(...PR_GM_ROLES), async (req, res) => {
    const signature = requireSignature(req, res);
    if (!signature) {return;}
    const reason = cleanName(req.body?.reason);
    if (!reason || reason.length < 3) {return fail(res, 422, 'PR_REASON_REQUIRED', 'سبب الرفض مطلوب (3 أحرف على الأقل)');}
    const client = await pool.connect();
    try {
        await ensurePurchaseRequestSchema();
        await client.query('BEGIN');
        const pr = (await client.query('SELECT * FROM purchase_requests WHERE id=$1 FOR UPDATE', [req.params.id])).rows[0];
        if (!pr) { await client.query('ROLLBACK'); return fail(res, 404, 'PR_NOT_FOUND', 'طلب الشراء غير موجود'); }
        if (pr.status !== 'chef_approved') {
            await client.query('ROLLBACK');
            const [status, message] = prStatusCode(pr.status === 'approved' ? 'PR_ALREADY_APPROVED' : pr.status === 'rejected' ? 'PR_REJECTED' : pr.status === 'cancelled' ? 'PR_CANCELLED' : 'PR_INVALID_STATUS');
            return fail(res, status, 'PR_NOT_REJECTABLE', message);
        }
        const at = new Date().toISOString();
        const actorName = req.user.name || req.user.username || String(req.user.id);
        const updated = (await client.query(`UPDATE purchase_requests SET status='rejected',
          rejected_by=$1, rejected_name=$2, rejected_at=$3, rejection_reason=$4,
          rejection_signature_data=$5, rejection_signature_hash=$6, updated_at=CURRENT_TIMESTAMP WHERE id=$7 RETURNING *`,
          [req.user.id, actorName, at, reason, signature, signatureHash(signature), pr.id])).rows[0];
        await appendPREvent(client, pr.id, 'gm_rejected', pr.status, 'rejected', req, signature, { reason });
        await client.query('COMMIT');
        emit(req, 'purchaseRequests', 'update', updated);
        res.json(updated);
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        logger.error('[pr_create]', error);
        logger.error('[pr_gm_reject]', error);
        res.status(500).json({ error: 'PR_GM_REJECT_FAILED', message: 'تعذر رفض طلب الشراء' });
    } finally { client.release(); }
});

// استلام المخزن (الخطوة الأخيرة): توقيع أمين المخزن + دخول البضاعة للمخزون
router.post('/purchase-requests/:id/warehouse-receive', jwtAuth, requireRole(...PR_WH_ROLES), async (req, res) => {
    // مغلق بأمر المالك (2026-10-01): الطلب ينتهي باعتماد المدير العام نهائيًا —
    // البضاعة تدخل المخزون عبر فواتير المشتريات (استلام هنا كان ازدواجًا)
    return fail(res, 410, 'PR_RECEIVE_RETIRED', 'دورة طلب الشراء تنتهي باعتماد المدير العام — سجّل البضاعة بفاتورة مشتريات');
});

// ─── محفوظ ومعطل بأمر المالك (2026-10-01): منطق استلام المخزن القديم ─────────
// أُوقف لمنع ازدواج دخول البضاعة (استلام + فاتورة). يُعاد التفعيل بمناداة هذه
// الدالة من المسار أعلاه فقط — لا تُستدعى من أي مكان حاليًا.
// eslint-disable-next-line no-unused-vars
async function _retiredPRReceive(req, res) {
    const signature = requireSignature(req, res);
    if (!signature) {return;}
    const client = await pool.connect();
    try {
        await ensurePurchaseRequestSchema();
        await client.query('BEGIN');
        const pr = (await client.query('SELECT * FROM purchase_requests WHERE id=$1 FOR UPDATE', [req.params.id])).rows[0];
        if (!pr) { await client.query('ROLLBACK'); return fail(res, 404, 'PR_NOT_FOUND', 'طلب الشراء غير موجود'); }
        // الاستلام الجزئي مسموح: approved أو partially_fulfilled — الباقي يُستلم لاحقًا
        if (!['approved', 'partially_fulfilled'].includes(pr.status)) {
            await client.query('ROLLBACK');
            return fail(res, 409, 'PR_NOT_RECEIVABLE', 'الاستلام بعد الاعتماد النهائي للمدير العام فقط');
        }
        // جولة الاستلام الحالية (لمفتاح عدم التكرار) + المستلم سابقًا تراكميًا
        const priorRounds = (await client.query(
            `SELECT COUNT(*)::int AS c FROM purchase_request_events WHERE request_id=$1 AND event_type='warehouse_received'`, [pr.id])).rows[0]?.c || 0;
        const roundNo = priorRounds + 1;
        const priorReceived = new Map();
        for (const r of (Array.isArray(pr.received_items) ? pr.received_items : [])) {
            const k = cleanName(r.itemName || r.name).toLowerCase();
            if (k) {priorReceived.set(k, { qty: n(r.receivedQty), packagingQty: r.receivedPackagingQty != null ? n(r.receivedPackagingQty) : null });}
        }
        const reqItems = Array.isArray(pr.items) ? pr.items : [];
        const got = new Map();
        for (const raw of (Array.isArray(req.body?.items) ? req.body.items : [])) {
            const name = cleanName(raw.itemName || raw.name);
            const qty = n(raw.receivedQty ?? raw.qty, NaN);
            if (!name || !Number.isFinite(qty) || qty < 0) {
                await client.query('ROLLBACK');
                return fail(res, 422, 'PR_RECEIVE_QTY_INVALID', `كمية استلام غير صحيحة للصنف ${name || '؟'}`);
            }
            const pkgRaw = raw.receivedPackagingQty ?? raw.packagingQty ?? null;
            const pkg = pkgRaw === null || pkgRaw === undefined || pkgRaw === '' ? null : n(pkgRaw, NaN);
            if (pkg !== null && (!Number.isFinite(pkg) || pkg < 0)) {
                await client.query('ROLLBACK');
                return fail(res, 422, 'PR_RECEIVE_PACKAGING_INVALID', `عدد كراتين الاستلام غير صحيح للصنف ${name}`);
            }
            got.set(name.toLowerCase(), {
                name, qty: round(qty), unitCost: n(raw.unitCost, 0),
                direct: raw.direct === true ? true : (raw.direct === false ? false : null),
                packagingQty: pkg,
                packagingUom: cleanName(raw.packagingUom || raw.packaging_uom) || null,
            });
        }
        if (!got.size) {
            await client.query('ROLLBACK');
            return fail(res, 422, 'PR_RECEIVE_EMPTY', 'حدد الكميات المستلمة لكل صنف');
        }
        // وضع التسليم: مخزن (دخول مخزني) أو مباشر للقسم (مصروف فوري بلا مخزون)
        const deliverMode = String(req.body?.deliverMode || 'stock').trim().toLowerCase() === 'direct' ? 'direct' : 'stock';
        let recvDept = pr.dept_code ? { code: pr.dept_code, name: pr.dept_name || pr.dept_code } : null;
        if (deliverMode === 'direct' && !recvDept) {
            const dc = String(req.body?.deptCode || '').trim();
            const row = dc ? (await client.query(
                'SELECT code, name FROM departments WHERE LOWER(code)=LOWER($1) LIMIT 1', [dc])).rows[0] : null;
            if (!row) {
                await client.query('ROLLBACK');
                return fail(res, 422, 'PR_DEPT_REQUIRED', 'التسليم المباشر يحتاج قسمًا مستلمًا مسجلًا في الطلب');
            }
            recvDept = { code: row.code, name: row.name };
        }
        const mainLocation = await getWarehouseLocation(client, 'MAIN-WAREHOUSE', 'المخزن الرئيسي', 'warehouse');
        const receivedItems = [];
        const stockChanges = [];
        const transactions = [];
        const expenses = [];
        let anyPositive = false;
        for (const it of reqItems) {
            const key = cleanName(it.itemName || it.name || '').toLowerCase();
            const g = got.get(key);
            if (!g) {
                await client.query('ROLLBACK');
                return fail(res, 422, 'PR_RECEIVE_INCOMPLETE', `سجّل المستلم لكل صنف (حتى لو صفر): ${it.itemName || it.name}`);
            }
            const want = n(it.requestedQty ?? it.qty);
            const alreadyIn = priorReceived.get(key)?.qty || 0;
            // السقف تراكمي عبر الجولات: المستلم الآن + السابق ≤ المطلوب
            if (round(g.qty + alreadyIn) > want) {
                await client.query('ROLLBACK');
                return fail(res, 409, 'PR_RECEIVE_EXCEEDED', `المستلم من ${g.name} أكبر من المتبقي (${round(want - alreadyIn)})`);
            }
            const alreadyPkg = priorReceived.get(key)?.packagingQty;
            if (g.qty <= 0) {
                receivedItems.push({ itemName: it.itemName || it.name, requestedQty: want, receivedQty: alreadyIn,
                    ...(alreadyPkg != null ? { receivedPackagingQty: alreadyPkg } : {}) });
                continue;
            }
            anyPositive = true;
            const unitCost = n(g.unitCost, n(it.unitCost, 0));
            if (unitCost < 0) {
                await client.query('ROLLBACK');
                return fail(res, 422, 'PR_COST_INVALID', `سعر الشراء لا يمكن أن يكون سالبًا للصنف ${g.name}`);
            }
            // مباشر per صنف يتجاوز وضع الطلب العام (خضار/دجاج طازج مباشر + جاف مخزن)
            const isDirect = g.direct === null || g.direct === undefined ? deliverMode === 'direct' : g.direct;
            // تسليم مباشر للقسم: مصروف فوري على القسم ولا حركة مخزنية إطلاقًا
            if (isDirect) {
                if (!(unitCost > 0)) {
                    await client.query('ROLLBACK');
                    return fail(res, 422, 'PR_DIRECT_COST_REQUIRED', `سعر الشراء مطلوب للصنف ${g.name} في التسليم المباشر`);
                }
                const value = round(g.qty * unitCost, 2);
                const expense = (await client.query(
                    `INSERT INTO expenses (id, "deptId", "desc", amount, date, notes, "autoGenerated", category, "adjustmentType")
                     VALUES ($1,$2,$3,$4,$5,$6,true,'مشتريات مباشرة','purchase_direct') RETURNING *`,
                    [id(), recvDept.code, `شراء مباشر - ${g.name} (${g.qty} ${it.unit || 'وحدة'})`, value,
                        dateOnly(new Date()), `طلب الشراء ${pr.request_number} — تسليم مباشر للقسم`]
                )).rows[0];
                receivedItems.push({ itemName: g.name, unit: it.unit || 'وحدة', requestedQty: want, receivedQty: round(alreadyIn + g.qty), receivedThisRound: g.qty, unitCost, totalValue: value, delivered: 'direct' });
                expenses.push(expense);
                continue;
            }
            let inv = it.itemId
                ? (await client.query('SELECT * FROM inventory WHERE id=$1 FOR UPDATE', [it.itemId])).rows[0]
                : (await client.query('SELECT * FROM inventory WHERE LOWER(name)=LOWER($1) FOR UPDATE', [g.name])).rows[0];
            if (!inv) {
                inv = (await client.query(
                    `INSERT INTO inventory (id, name, category, unit, qty, "avgCost", "minQty")
                     VALUES ($1,$2,$3,$4,0,$5,0) RETURNING *`,
                    [id(), g.name, 'مشتريات', it.unit || 'وحدة', unitCost]
                )).rows[0];
            }
            await ensureLocationBalance(client, inv.id, mainLocation.id, n(inv.qty));
            const prPkgUom = g.packagingQty !== null && g.packagingQty !== undefined ? (g.packagingUom || inv.packaging_uom || 'كرتون') : null;
            const posted = await postInventoryLedgerEntry(client, {
                transactionType: 'transfer_in', inventoryId: Number(inv.id), locationId: mainLocation.id,
                quantityDelta: g.qty, unit: inv.unit || it.unit || 'وحدة', unitCost,
                destinationLocationId: mainLocation.id,
                referenceType: 'purchase_request', referenceId: String(pr.id), userId: req.user.id,
                idempotencyKey: `pr-receive:${pr.id}:${inv.id}:r${roundNo}`,
                reason: `استلام مشتريات ${pr.request_number} — ${g.name}`,
                metadata: { pr_id: pr.id, request_number: pr.request_number, receive_round: roundNo,
                    ...(g.packagingQty !== null && g.packagingQty !== undefined ? { packaging_qty: g.packagingQty, packaging_uom: prPkgUom } : {}) },
                catchWeightQty: g.packagingQty ?? null, catchWeightUnit: prPkgUom,
            });
            if (posted.replay) {
                await client.query('ROLLBACK');
                return fail(res, 409, 'PR_ALREADY_RECEIVED', `استلام ${g.name} مسجل مسبقًا — حدّث الصفحة قبل إعادة المحاولة`);
            }
            // المتوسط المرجح يشمل الكمية المستلمة بسعرها
            const prOldQty = n(inv.qty);
            if (round(prOldQty + g.qty) > 0) {
                await client.query('UPDATE inventory SET "avgCost"=$2 WHERE id=$1',
                    [inv.id, round(((prOldQty * n(inv.avgCost)) + (g.qty * unitCost)) / round(prOldQty + g.qty), 2)]);
            }
            const globalAfter = (await client.query('SELECT qty FROM inventory WHERE id=$1', [inv.id])).rows[0]?.qty;
            const tx = (await client.query(
                `INSERT INTO "inventoryTx" (id, "itemId", "itemName", qty, type, date, cost, "totalValue", notes, "invoiceNumber", catch_weight_qty, catch_weight_unit)
                 VALUES ($1,$2,$3,$4,'in',$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
                [id(), inv.id, inv.name, g.qty, dateOnly(new Date()), unitCost, round(g.qty * unitCost, 2),
                    `استلام طلب الشراء ${pr.request_number}`, pr.request_number, g.packagingQty ?? null, prPkgUom]
            )).rows[0];
            const cumPkg = (alreadyPkg ?? 0) + (g.packagingQty ?? 0);
            receivedItems.push({ itemName: inv.name, itemId: Number(inv.id), unit: inv.unit, requestedQty: want,
                receivedQty: round(alreadyIn + g.qty), receivedThisRound: g.qty, unitCost, delivered: 'stock',
                ...(cumPkg > 0 || alreadyPkg != null ? { receivedPackagingQty: round(cumPkg, 3), packagingUom: prPkgUom } : {}) });
            stockChanges.push({ ...inv, qty: globalAfter });
            transactions.push(tx);
        }
        if (!anyPositive) {
            await client.query('ROLLBACK');
            return fail(res, 422, 'PR_RECEIVE_ALL_ZERO', 'استلم صنفًا واحدًا على الأقل بكمية موجبة');
        }
        const at = new Date().toISOString();
        const actorName = req.user.name || req.user.username || String(req.user.id);
        const modes = new Set(receivedItems.map(x => x.delivered || 'stock'));
        const finalMode = modes.size > 1 ? 'mixed' : (modes.has('direct') ? 'direct' : 'stock');
        // مكتمل فقط إذا استُلمت كل الأصناف كاملة تراكميًا — وإلا يبقى قابلًا للاستلام
        const fullyReceived = reqItems.every(it => {
            const k = cleanName(it.itemName || it.name || '').toLowerCase();
            const want = n(it.requestedQty ?? it.qty);
            const gotRow = receivedItems.find(r => cleanName(r.itemName).toLowerCase() === k);
            return gotRow && Number(gotRow.receivedQty) >= want;
        });
        const nextStatus = fullyReceived ? 'fulfilled' : 'partially_fulfilled';
        const updated = (await client.query(`UPDATE purchase_requests SET status=$1,
          wh_received_by=$2, wh_received_name=$3, wh_received_at=$4,
          wh_signature_data=$5, wh_signature_hash=$6, wh_notes=$7, received_items=$8, deliver_mode=$9,
          updated_at=CURRENT_TIMESTAMP WHERE id=$10 RETURNING *`,
          [nextStatus, req.user.id, actorName, at, signature, signatureHash(signature),
              cleanName(req.body?.notes) || null, json(receivedItems), finalMode, pr.id])).rows[0];
        await appendPREvent(client, pr.id, 'warehouse_received', pr.status, nextStatus, req, signature, { receivedItems, deliverMode: finalMode, receiveRound: roundNo });
        await client.query('COMMIT');
        emit(req, 'purchaseRequests', 'update', updated);
        for (const item of stockChanges) {emit(req, 'inventory', 'update', item);}
        for (const tx of transactions) {emit(req, 'inventoryTx', 'create', tx);}
        for (const expense of expenses) {emit(req, 'expenses', 'create', expense);}
        res.json({ ...updated, stockChanges, transactions, expenses, deliverMode: finalMode });
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        logger.error('[pr_create]', error);
        logger.error({ err: error.message, stack: String(error.stack || '').slice(0, 500) }, '[pr_wh_receive]');
        res.status(500).json({ error: 'PR_RECEIVE_FAILED', message: 'تعذر تسجيل استلام المخزن' });
    } finally { client.release(); }
}

// إلغاء طلب معلّق (صاحبه أو الإدارة) — قبل أي توقيع
router.post('/purchase-requests/:id/cancel', jwtAuth, requireRole(...PR_CANCEL_ROLES), async (req, res) => {
    const client = await pool.connect();
    try {
        await ensurePurchaseRequestSchema();
        await client.query('BEGIN');
        const pr = (await client.query('SELECT * FROM purchase_requests WHERE id=$1 FOR UPDATE', [req.params.id])).rows[0];
        if (!pr) { await client.query('ROLLBACK'); return fail(res, 404, 'PR_NOT_FOUND', 'طلب الشراء غير موجود'); }
        if (!['pending','chef_approved'].includes(pr.status)) {
            await client.query('ROLLBACK');
            return fail(res, 409, 'PR_NOT_CANCELLABLE', 'لا يمكن إلغاء طلب تمّ اعتماده من المدير العام');
        }
        if (!['admin', 'manager'].includes(req.user.role) && Number(pr.created_by) !== Number(req.user.id)) {
            await client.query('ROLLBACK');
            return fail(res, 403, 'PR_CANCEL_FORBIDDEN', 'لا يجوز إلغاء طلب أنشأه مستخدم آخر');
        }
        const updated = (await client.query(`UPDATE purchase_requests SET status='cancelled', updated_at=CURRENT_TIMESTAMP WHERE id=$1 RETURNING *`, [pr.id])).rows[0];
        await appendPREvent(client, pr.id, 'cancelled', pr.status, 'cancelled', req, null, {});
        await client.query('COMMIT');
        emit(req, 'purchaseRequests', 'update', updated);
        res.json(updated);
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        logger.error('[pr_create]', error);
        logger.error('[pr_cancel]', error);
        res.status(500).json({ error: 'PR_CANCEL_FAILED', message: 'تعذر إلغاء طلب الشراء' });
    } finally { client.release(); }
});

// حذف نهائي لطلب شراء (تنظيف) — الإدارة فقط، وللطلبات التي لم تصل للمخزون.
// المعتمدة نهائيًا/المستلمة محمية (لها أثر مخزني ومالي) — تُعالج بالاستلام/الارتجاع لا بالحذف.
// يُسجل حدث 'deleted' أولًا فيبقى أثر المراجعة بعد زوال الصف.
router.delete('/purchase-requests/:id', jwtAuth, requireRole(...PR_GM_ROLES), async (req, res) => {
    const client = await pool.connect();
    try {
        await ensurePurchaseRequestSchema();
        await client.query('BEGIN');
        const pr = (await client.query('SELECT * FROM purchase_requests WHERE id=$1 FOR UPDATE', [req.params.id])).rows[0];
        if (!pr) { await client.query('ROLLBACK'); return fail(res, 404, 'PR_NOT_FOUND', 'طلب الشراء غير موجود'); }
        if (['approved', 'partially_fulfilled', 'fulfilled'].includes(pr.status)) {
            await client.query('ROLLBACK');
            return fail(res, 409, 'PR_NOT_DELETABLE', 'لا يجوز حذف طلب معتمد أو مستلم (ولو جزئيًا) — له أثر مخزني');
        }
        await appendPREvent(client, pr.id, 'deleted', pr.status, 'deleted', req, null, { request_number: pr.request_number });
        await client.query('DELETE FROM purchase_requests WHERE id=$1', [pr.id]);
        await client.query('COMMIT');
        emit(req, 'purchaseRequests', 'delete', { id: pr.id, request_number: pr.request_number });
        res.json({ ok: true, id: pr.id });
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        logger.error('[pr_delete]', error);
        res.status(500).json({ error: 'PR_DELETE_FAILED', message: 'تعذر حذف طلب الشراء' });
    } finally { client.release(); }
});

module.exports = {
    router,
    ensureLegacyKitchenReceiptLedger,
    AUTO_PAYMENT_NOTE_RE,
    classifyInvoicePaymentsForVoid,
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
    normalizePRItems,
    prShortageSuggestion,
    canPRChefDecide,
    canPRGMDecide,
    PR_CREATE_ROLES,
    PR_CANCEL_ROLES,
    PR_CHEF_ROLES,
    PR_GM_ROLES,
    PR_WH_ROLES,
    PR_READ_ROLES,
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
