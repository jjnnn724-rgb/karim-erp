/**
 * V2 — أعلام كتابة P1 (OFF افتراضيًا)
 * ═══════════════════════════════════════════════════════════════════════
 * عقد الإكمال (2026-10-17): «كل كيان علمه المستقل، ولا يُفعَّل علم كتابة
 * قبل عيّنة rollback مجرَّبة». الحارس هنا يخصّ الرسم فقط؛ الخادم يعيد فحص
 * الدور والحمولة في كل نداء، فلا يصبح العلم سلطة.
 *
 * القراءة من الـURL تسبق المخزّن (نفس نمط v2toast/v2overlay):
 *   ?v2financewrite=1 | 0   → كتابات 15/16
 *   ?v2recipewrite=1 | 0    → دورة الوصفات (بما فيها المكوّنات)
 *   ?v2deptwrite=1 | 0      → CRUD الأقسام التشغيلية (P1-3)
 *   ?v2hrdeptwrite=1 | 0    → CRUD أقسام الموارد البشرية (P1-3)
 *   ?v2shelfwrite=1 | 0     → CRUD الرفوف (P2-5)
 *   ?v2weightwrite=1 | 0    → قراءات الميزان وإضافتها لصنف (P2-5)
 *   ?v2zkwrite=1 | 0        → أجهزة البصمة وربطها واستيرادها (P2-2)
 *   ?v2portalwrite=1 | 0    → البصمة الذاتية للموظف وتوثيق رفضها (P2-3)
 *   ?v2facewrite=1 | 0      → تسجيل قوالب الوجه وإزالتها (P2-3)
 *   ?v2fiscalwrite=1 | 0    → السنوات المالية: إنشاء/إقفال/السنة التالية (P2-4)
 *   ?v2invoicevoid=1 | 0    → إلغاء فاتورة شراء فردي وحذف جماعي (ذيل P1-4)
 *   ?v2invoicecreate=1 | 0  → إنشاء/تعديل فاتورة شراء (26c-2)
 *   ?v2bulkimport=1 | 0     → استيراد الموظفين/المستخدمين الجماعي (26د)
 *   ?v2chat=1 | 0           → الشات الداخلي (إرسال رسالة = كتابة، 2026-10-17)
 * وغياب الاثنين = OFF. المخزّن يبقى للـstaging كما في الأعلام الأخرى،
 * ولا يُكتب من هنا إطلاقًا؛ و`=0` في الـURL يغلب المخزّن دائمًا.
 */

function readFlag(name, storageKey, search, storage) {
    const query = search !== undefined
        ? search
        : (typeof location !== 'undefined' ? location.search : '');
    const match = String(query || '').match(new RegExp(`(?:^|[?&])${name}=([^&]*)`));
    if (match) {return match[1] !== '0';}
    try {
        const store = storage !== undefined
            ? storage
            : (typeof localStorage !== 'undefined' ? localStorage : null);
        return !!store && store.getItem(storageKey) === '1';
    } catch {
        return false;
    }
}

export const FINANCE_WRITE_FLAG = 'v2financewrite';
export const RECIPE_WRITE_FLAG = 'v2recipewrite';
export const DEPARTMENT_WRITE_FLAG = 'v2deptwrite';
export const HR_DEPARTMENT_WRITE_FLAG = 'v2hrdeptwrite';
export const SHELF_WRITE_FLAG = 'v2shelfwrite';
export const WEIGHT_WRITE_FLAG = 'v2weightwrite';
export const ZK_WRITE_FLAG = 'v2zkwrite';
export const PORTAL_WRITE_FLAG = 'v2portalwrite';
export const FACE_WRITE_FLAG = 'v2facewrite';
export const FISCAL_WRITE_FLAG = 'v2fiscalwrite';
export const INVOICE_VOID_WRITE_FLAG = 'v2invoicevoid';
export const INVOICE_CREATE_WRITE_FLAG = 'v2invoicecreate';
export const BULK_IMPORT_WRITE_FLAG = 'v2bulkimport';
export const CHAT_WRITE_FLAG = 'v2chat';

export function financeWriteEnabled(search, storage) {
    return readFlag(FINANCE_WRITE_FLAG, 'karim_v2_finance_write', search, storage);
}

export function recipeWriteEnabled(search, storage) {
    return readFlag(RECIPE_WRITE_FLAG, 'karim_v2_recipe_write', search, storage);
}

export function departmentWriteEnabled(search, storage) {
    return readFlag(DEPARTMENT_WRITE_FLAG, 'karim_v2_department_write', search, storage);
}

export function hrDepartmentWriteEnabled(search, storage) {
    return readFlag(HR_DEPARTMENT_WRITE_FLAG, 'karim_v2_hr_department_write', search, storage);
}

export function shelfWriteEnabled(search, storage) {
    return readFlag(SHELF_WRITE_FLAG, 'karim_v2_shelf_write', search, storage);
}

export function weightWriteEnabled(search, storage) {
    return readFlag(WEIGHT_WRITE_FLAG, 'karim_v2_weight_write', search, storage);
}

export function zkWriteEnabled(search, storage) {
    return readFlag(ZK_WRITE_FLAG, 'karim_v2_zk_write', search, storage);
}

export function portalWriteEnabled(search, storage) {
    return readFlag(PORTAL_WRITE_FLAG, 'karim_v2_portal_write', search, storage);
}

export function faceWriteEnabled(search, storage) {
    return readFlag(FACE_WRITE_FLAG, 'karim_v2_face_write', search, storage);
}

export function fiscalWriteEnabled(search, storage) {
    return readFlag(FISCAL_WRITE_FLAG, 'karim_v2_fiscal_write', search, storage);
}

export function invoiceVoidWriteEnabled(search, storage) {
    return readFlag(INVOICE_VOID_WRITE_FLAG, 'karim_v2_invoice_void_write', search, storage);
}

export function invoiceCreateWriteEnabled(search, storage) {
    return readFlag(INVOICE_CREATE_WRITE_FLAG, 'karim_v2_invoice_create_write', search, storage);
}

export function bulkImportWriteEnabled(search, storage) {
    return readFlag(BULK_IMPORT_WRITE_FLAG, 'karim_v2_bulk_import_write', search, storage);
}

export function chatWriteEnabled(search, storage) {
    return readFlag(CHAT_WRITE_FLAG, 'karim_v2_chat', search, storage);
}
