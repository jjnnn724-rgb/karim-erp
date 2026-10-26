/**
 * branch-context.js — تصفية البيانات حسب الفرع (migration 102).
 * ─────────────────────────────────────────────────────────────
 * السياسة الآمنة (fail-open للسلوك القديم):
 *  • admin/manager/auditor/dept_head: كل الفروع إلا إذا أرسل العميل
 *    ترويسة x-branch-id أو ?branch= → تصفية على ذاك الفرع.
 *  • باقي الأدوار (cashier/warehouse/kitchen/hr…): مقفلون على
 *    branch_id الخاص بحسابهم إن وُجد؛ يطلب فرعًا آخر = 403.
 *  • فرع المستخدم NULL (ما قبل الترقية) = بلا تصفية، مثل اليوم تمامًا.
 */
const { pool } = require('./shared-pool');

// كيانات الـCRUD الديناميكي التي امتلكت عمود branch_id في 102_branches.sql
const BRANCH_AWARE_ENTITIES = new Set([
    'users', 'employees', 'attendance', 'expenses', 'revenues',
]);

const GLOBAL_ROLES = new Set(['admin', 'manager', 'auditor', 'dept_head']);

// ─── كاش الفروع (5 دقائق) — جدول صغير، قراءة كثيفة ────────────────
// FAILO-OPEN: قبل تطبيق 102_branches يكون جدول branches غائبًا — نتصرف كأن
// فرعًا واحدًا فقط (المسارات تعيد null = بلا تصفية) بدل تفجير كل القوائم.
let _cache = { at: 0, byId: new Map(), byCode: new Map(), missing: false };
async function loadBranches() {
    if (Date.now() - _cache.at < 5 * 60 * 1000 && (_cache.byId.size || _cache.missing)) {return _cache;}
    try {
        const r = await pool.query('SELECT id, code, currency, timezone, is_active FROM branches WHERE is_active = TRUE');
        _cache = { at: Date.now(), byId: new Map(), byCode: new Map(), missing: false };
        for (const b of r.rows) {
            _cache.byId.set(b.id, b);
            _cache.byCode.set(String(b.code).toUpperCase(), b);
        }
    } catch (e) {
        if (e.code === '42P01') { // undefined_table — migration 102 لم تُطبق بعد
            _cache = { at: Date.now(), byId: new Map(), byCode: new Map(), missing: true };
        } else {
            throw e;
        }
    }
    return _cache;
}

function invalidateBranchCache() { _cache = { at: 0, byId: new Map(), byCode: new Map(), missing: false }; }

/**
 * يحوّل القيمة المُرسلة (رقم id أو code مثل MAIN) إلى سطر فرع أو null.
 */
async function resolveBranchRef(raw) {
    if (raw === undefined || raw === null || raw === '') {return null;}
    const cache = await loadBranches();
    const asNum = parseInt(raw, 10);
    if (!isNaN(asNum) && String(asNum) === String(raw).trim() && cache.byId.has(asNum)) {return cache.byId.get(asNum);}
    return cache.byCode.get(String(raw).trim().toUpperCase()) || null;
}

/**
 * @returns {Promise<number|null>} branchId للتصفية، أو null = بلا تصفية.
 * @throws {Error} .statusCode=404 فرع غير موجود/موقوف، 403 طلب فرع خارج النطاق.
 */
async function resolveBranch(req) {
    const user = req.user || {};
    const requested = req.headers['x-branch-id'] || req.query.branch;
    const own = user.branch_id ?? null;

    if (GLOBAL_ROLES.has(user.role)) {
        if (!requested) {return own ?? null;}
        const b = await resolveBranchRef(requested);
        if (!b) {const e = new Error('BRANCH_NOT_FOUND'); e.statusCode = 404; throw e;}
        return b.id;
    }
    // أدوار تشغيلية: مقفلة على فرع المستخدم إن لم يُعيَّن فرع ← سلوك قديم
    if (own == null) {
        if (requested) {const e = new Error('BRANCH_NOT_FOUND'); e.statusCode = 404; throw e;}
        return null;
    }
    if (requested) {
        const b = await resolveBranchRef(requested);
        if (!b) {const e = new Error('BRANCH_NOT_FOUND'); e.statusCode = 404; throw e;}
        if (b.id !== own) {const e = new Error('BRANCH_OUT_OF_SCOPE'); e.statusCode = 403; throw e;}
    }
    return own;
}

/**
 * ختم الفرع عند الإنشاء: admin/manager يختار فرعًا صريحًا (أو فرعَه الافتراضي)،
 * وباقي الأدوار يُختم سجلهم تلقائيًا على فرع صاحبهم — محاولة كتابة لفرع
 * آخر = 403. فرع المستخدم NULL (ما قبل الترقية) = بلا ختم (سلوك قديم).
 */
async function stampForCreate(req, bodyBranchId) {
    const user = req.user || {};
    const own = user.branch_id ?? null;
    const requested = bodyBranchId ?? (req.headers['x-branch-id'] || req.query.branch) ?? null;

    if (GLOBAL_ROLES.has(user.role)) {
        if (requested == null || requested === '') {return own ?? null;}
        const b = await resolveBranchRef(requested);
        if (!b) {const e = new Error('BRANCH_NOT_FOUND'); e.statusCode = 404; throw e;}
        return b.id;
    }
    if (own == null) {return null;}
    if (requested != null && requested !== '') {
        const b = await resolveBranchRef(requested);
        if (!b || b.id !== own) {const e = new Error('BRANCH_OUT_OF_SCOPE'); e.statusCode = 403; throw e;}
    }
    return own;
}

module.exports = { BRANCH_AWARE_ENTITIES, resolveBranch, resolveBranchRef, stampForCreate, invalidateBranchCache, loadBranches };
