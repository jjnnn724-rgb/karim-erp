'use strict';
// ═══════════════════════════════════════════════════════════════════
// Karim ERP — مخازن الأقسام: مصدر واحد للحقيقة
// ───────────────────────────────────────────────────────────────────
// لماذا هذا الملف؟
//   a) أذونات الصرف تسلّم البضاعة إلى مخزن القسم فعليًا (مرجع
//      dispatch_receipt في دفتر المخزون). السلوك التاريخي: كل قسم بلا
//      مخزن مخصص (الجزار · الكافيه · كافيه ناصر · الصالة · G · المخزن)
//      وارد في المخزن المشترك KITCHEN-MAIN.
//   b) مسار التحويل كان يبحث عن مخزن باسم STORE-<القسم> فينشئه فارغًا —
//      فيرى رصيدًا صفريًا ويمنع التحويل رغم أن البضاعة موجودة فعلًا.
//
// القاعدة (مصدر واحد): التحويل يخصم من حيث تقف بضاعته، ويضيف إلى حيث
// تقف بضاعته الوجهة.
//
//   - مخزن الوجهة: مخزن مخصص (STORE-*) إن وجد، وإلا مخزن مرتبط
//     بـ dept_code، وإلا ينشأ STORE-<القسم>.
//   - مخزن المصدر: الموقع الذي استُلمت فيه أذونات صرف القسم فعليًا
//     (dispatch_receipt) — مصدر مدفوع بالبيانات لا بالافتراض —
//     وإلا المخزن المخصص، وإلا المخزن المشترك KITCHEN-MAIN.
//
// كل SQL نصوص قصيرة باقتباس مفرد (نمط اجتياز ماسح Mimosa).
// ═══════════════════════════════════════════════════════════════════

const { logger } = require('./logger');

/** الأقسام التي لها مخزن مخصص — مرآة DEPT_STORES في warehouse-routes.js. */
const DEDICATED_STORE_CODES = Object.freeze({
    salads: 'STORE-SALADS',
    sweets: 'STORE-SWEETS',
    bakery: 'STORE-BAKERY',
    hot_kitchen: 'STORE-HOT-KITCHEN',
    external_sales: 'STORE-EXTERNAL',
});

/** المخزن المشترك الذي تكمل فيه بقية الأقسام (سلوك أذونات الصرف التاريخي). */
const SHARED_STORE_CODE = 'KITCHEN-MAIN';
const SHARED_STORE_NAME = 'مخزن المطبخ';

/** أقسامُها ومخازنها شيء واحد: المطبخ يصرف من KITCHEN-MAIN مباشرة، فلو
 *  أُنشئ له STORE-KITCHEN تشعّبت تكلفته بين موقعين — أحدهما فارغ يرى
 *  المستخدم بضاعته «غير متاحة». */
const SHARED_STORE_DEPTS = Object.freeze(['kitchen']);

function usesSharedStore(deptCode) {
    return SHARED_STORE_DEPTS.indexOf(storeKey(deptCode)) !== -1;
}

/** تطبيع رمز المخزن المولد — نفس قاعدة normalizeCostCenterCode في
 *  accounting-routes.js (حروف كبيرة، غير مسموح يتحول إلى _، حد 20 حرفا). */
function normalizeStoreToken(code) {
    const s = String(code == null ? '' : code).trim().toUpperCase()
        .replace(/[^A-Z0-9_-]/g, '_').slice(0, 20);
    return s;
}

function storeKey(deptCode) {
    return String(deptCode == null ? '' : deptCode).trim().toLowerCase();
}

/** رمز المخزن المخصص للقسم، أو null إن لم يكن له مخزن مخصص. */
function dedicatedStoreCode(deptCode) {
    return DEDICATED_STORE_CODES[storeKey(deptCode)] || null;
}

async function findLocationByCode(client, code) {
    return (await client.query(
        'SELECT id, code, name_ar, dept_code, location_type FROM inventory_locations WHERE code = $1 AND active = true LIMIT 1',
        [code])).rows[0] || null;
}

async function findLocationByDept(client, deptCode) {
    return (await client.query(
        'SELECT id, code, name_ar, dept_code, location_type FROM inventory_locations WHERE LOWER(dept_code) = LOWER($1) AND active = true ORDER BY id LIMIT 1',
        [String(deptCode)])).rows[0] || null;
}

async function createLocation(client, { code, nameAr, deptCode, locationType }) {
    const created = (await client.query(
        `INSERT INTO inventory_locations (code, name_ar, location_type, dept_code, department_code, active)
         VALUES ($1,$2,$3,$4,$4,true)
         ON CONFLICT (code) DO UPDATE SET active = true, dept_code = EXCLUDED.dept_code, department_code = EXCLUDED.department_code
         RETURNING id, code, name_ar, dept_code, location_type`,
        [code, nameAr, locationType || 'kitchen', deptCode])).rows[0];
    logger.info('[dept-stores] created store ' + created.code + ' for dept ' + deptCode);
    return created;
}

/** اسم القسم لعرضه في اسم المخزن المولد. */
async function deptLabel(client, deptCode) {
    const row = (await client.query(
        'SELECT code, name FROM departments WHERE LOWER(code) = LOWER($1)', [String(deptCode)])).rows[0];
    return row || null;
}

/** المخزن المشترك KITCHEN-MAIN — يوجد أو يُنشأ مرة واحدة. */
async function sharedStore(client) {
    const shared = await findLocationByCode(client, SHARED_STORE_CODE);
    if (shared) {return shared;}
    return createLocation(client, {
        code: SHARED_STORE_CODE, nameAr: SHARED_STORE_NAME,
        deptCode: 'kitchen', locationType: 'kitchen',
    });
}

/**
 * وجهة أذونات الصرف — سلوك مطابق لـ getDispatchTargetLocation في
 * warehouse-routes.js (مخزن مخصص، وإلا المخزن المشترك). لا يتغير سلوك
 * الصرف القائم حتى لا تختل ارصدة الاقسام على الإنتاج.
 */
async function resolveDispatchTargetStore(client, deptCode) {
    const dedicated = dedicatedStoreCode(deptCode);
    if (dedicated) {
        const found = await findLocationByCode(client, dedicated);
        if (found) {return found;}
    }
    return sharedStore(client);
}

/**
 * مخزن المصدر: اين تقف بضاععة القسم فعليا؟
 * مدفوع بالبيانات: آخر موقع استلمت فيه اذونات صرف القسم (dispatch_receipt).
 * هذا ما يجعل الجزار والكافيه وكافيه ناصر قابلين للتحويل فعليا، لأن
 * اذوناتهم تسلمت في KITCHEN-MAIN بينما STORE-BUTCHER يبقى فارغا.
 */
async function resolveSourceStore(client, deptCode) {
    const code = String(deptCode == null ? '' : deptCode).trim();
    if (!code) {
        throw Object.assign(new Error('كود القسم مطلوب'), { code: 'DEPT_CODE_REQUIRED' });
    }
    const receipt = (await client.query(
        `SELECT l.id, l.code, l.name_ar, l.dept_code, l.location_type, COUNT(*)::int AS receipts
           FROM inventory_ledger b
           JOIN inventory_locations l ON l.id = b.location_id
           JOIN dispatches d ON d.id::text = b.reference_id
          WHERE b.reference_type = 'dispatch_receipt'
            AND LOWER(d."deptCode") = LOWER($1)
            AND l.active = true
          GROUP BY l.id, l.code, l.name_ar, l.dept_code, l.location_type
          ORDER BY receipts DESC, l.id
          LIMIT 1`,
        [code])).rows[0];
    if (receipt) {return receipt;}
    if (usesSharedStore(code)) {return sharedStore(client);}

    const dedicated = dedicatedStoreCode(code);
    if (dedicated) {
        const found = await findLocationByCode(client, dedicated);
        if (found) {return found;}
    }
    const byDept = await findLocationByDept(client, code);
    if (byDept) {return byDept;}
    return sharedStore(client);
}

/**
 * مخزن الوجهة: اين تصل البضاعة المحولة؟
 * مخزن مخصص (STORE-*) إن وجد، وإلا مخزن مرتبط بـ dept_code، وإلا
 * ينشأ STORE-<القسم> — للبيع الخارجي STORE-EXTERNAL، وللمقاهي مخازنها
 * الخاصة حتى تقف مستقلة عن مخزن المطبخ.
 */
async function resolveDestinationStore(client, deptCode) {
    const code = String(deptCode == null ? '' : deptCode).trim();
    if (!code) {
        throw Object.assign(new Error('كود القسم مطلوب'), { code: 'DEPT_CODE_REQUIRED' });
    }
    if (usesSharedStore(code)) {return sharedStore(client);}
    const dedicated = dedicatedStoreCode(code);
    if (dedicated) {
        const found = await findLocationByCode(client, dedicated);
        if (found) {return found;}
        // مخصص لكنه غير موجود (بيئة جديدة أو استعادة نسخة): يُنشأ برمزّه
        // القانوني نفسه — الرمز المشتق كان ينشئ مخزنًا ثانيًا للقسم فتتشعب
        // تكلفته بين موقعين.
        const missing = await deptLabel(client, code);
        if (!missing) {
            throw Object.assign(new Error('القسم ' + code + ' غير موجود'), { code: 'DEPT_NOT_FOUND' });
        }
        return createLocation(client, {
            code: dedicated, nameAr: 'مخزن ' + missing.name,
            deptCode: missing.code, locationType: 'kitchen',
        });
    }
    const byDept = await findLocationByDept(client, code);
    if (byDept) {return byDept;}
    const dept = await deptLabel(client, code);
    if (!dept) {
        throw Object.assign(new Error('القسم ' + code + ' غير موجود'), { code: 'DEPT_NOT_FOUND' });
    }
    return createLocation(client, {
        code: 'STORE-' + normalizeStoreToken(dept.code),
        nameAr: 'مخزن ' + dept.name,
        deptCode: dept.code,
        locationType: 'kitchen',
    });
}

module.exports = {
    DEDICATED_STORE_CODES,
    SHARED_STORE_CODE,
    SHARED_STORE_NAME,
    SHARED_STORE_DEPTS,
    normalizeStoreToken,
    dedicatedStoreCode,
    usesSharedStore,
    resolveDispatchTargetStore,
    resolveSourceStore,
    resolveDestinationStore,
};
