import { z } from 'zod';
import { isWriteRole, writeAck, writeJson } from './write';

/**
 * كتابة الموردين — مطابقة لـ `backend/procurement-routes.js` (لا نسخة V2 قديمة):
 *  • إنشاء     POST   /api/procurement/suppliers
 *  • تعديل     PUT    /api/procurement/suppliers/:id
 *  • إيقاف/تفعيل PUT  /api/procurement/suppliers/:id  بـ `{is_active}`
 *  • حذف       DELETE /api/procurement/suppliers/:id
 *
 * الأدوار من الخادم (procurement-routes.js:25-28): admin|manager|warehouse
 * للكتابة والحذف. دور `warehouse` (أمين المخزن) مسموح له بالكامل هناك؛
 * الواجهة القديمة كانت تعرض أدمن فقط للحذف فكانت تخفي الزر خطأً.
 *
 * أسماء الحقول هي أسماء الخادم نفسها: `is_active` بدل `active`،
 * `vat_number`/`tax_registration_status`/`commercial_register` لا `tax_number`.
 */

export const SUPPLIER_TAX_STATUSES = ['REGISTERED', 'NOT_REGISTERED', 'EXEMPT'] as const;
export type SupplierTaxStatus = (typeof SUPPLIER_TAX_STATUSES)[number];

export const SUPPLIER_WRITE_ROLES = ['admin', 'manager', 'warehouse'] as const;
export const SUPPLIER_DELETE_ROLES = ['admin', 'manager', 'warehouse'] as const;

export function supplierWriteVisible(role: string | null | undefined): boolean {
    return isWriteRole(role, SUPPLIER_WRITE_ROLES);
}

export function supplierDeleteVisible(role: string | null | undefined): boolean {
    return isWriteRole(role, SUPPLIER_DELETE_ROLES);
}

/* ── نصوص الخادم/V2 ───────────────────────────────────────────────────── */

export const SUPPLIER_TEXT = {
    nameRequired: 'اسم المورد مطلوب',
    phoneRequired: 'رقم الهاتف مطلوب',
    createFailed: 'فشل إنشاء المورد في قاعدة البيانات',
    updateFailed: 'فشل تحديث بيانات المورد',
    deactivateFailed: 'فشل إيقاف المورد',
    activateFailed: 'فشل تفعيل المورد',
    deleteFailed: 'فشل حذف المورد من قاعدة البيانات',
    deleteBlocked: 'لا يمكن حذف هذا المورد: مرتبط بفواتير شراء أو مدفوعات',
    createSuccess: 'تم إنشاء المورد بنجاح',
    updateSuccess: 'تم تحديث بيانات المورد',
    deactivateSuccess: 'تم إيقاف المورد',
    activateSuccess: 'تم تفعيل المورد',
    deleteSuccess: 'تم حذف المورد',
    confirmCreate: 'إضافة مورد جديد؟',
    confirmUpdate: 'تعديل بيانات المورد «%s»؟',
    confirmDeactivate: 'إيقاف مورد «%s»؟ لن يظهر في فواتير الشراء.',
    confirmActivate: 'تفعيل مورد «%s»؟ سيعود للقوائم مرة أخرى.',
    confirmDelete: 'حذف المورد «%s» نهائيًا؟ لا يمكن التراجع.',
    cancel: 'إلغاء',
} as const;

/* ── مخططات التحقق ────────────────────────────────────────────────────── */

const textField = (max: number) => z.string().max(max).nullish();

export const supplierCreateSchema = z.object({
    name: z.string().min(2, SUPPLIER_TEXT.nameRequired).max(120),
    phone: z.string().min(1, SUPPLIER_TEXT.phoneRequired),
    name_en: textField(120),
    email: textField(120),
    category: textField(60),
    address: textField(200),
    notes: textField(500),
    commercial_register: textField(20),
    tax_registration_status: z.enum(SUPPLIER_TAX_STATUSES).default('NOT_REGISTERED'),
    vat_number: textField(15),
    openingBalance: z.number().min(0).optional(),
    is_active: z.boolean().optional(),
});

export type SupplierCreateInput = z.infer<typeof supplierCreateSchema>;

export const supplierUpdateSchema = supplierCreateSchema;

export type SupplierUpdateInput = z.infer<typeof supplierUpdateSchema>;

export const supplierActiveSchema = z.object({
    is_active: z.boolean(),
});

export type SupplierActiveInput = z.infer<typeof supplierActiveSchema>;

const supplierResultSchema = z.object({ id: z.union([z.string(), z.number()]) }).passthrough();
export type SupplierResult = z.infer<typeof supplierResultSchema>;

/** الحمولة التي يقرأها الخادم حرفيًا — بلا أسماء قديمة. */
export type SupplierBodyInput = SupplierCreateInput | SupplierUpdateInput;

export function supplierBody(input: SupplierBodyInput): Record<string, unknown> {
    const status = input.tax_registration_status ?? 'NOT_REGISTERED';
    const vat = String(input.vat_number ?? '').trim();
    return {
        name: String(input.name ?? '').trim(),
        phone: String(input.phone ?? '').trim(),
        name_en: String(input.name_en ?? '').trim() || null,
        email: String(input.email ?? '').trim() || null,
        category: String(input.category ?? '').trim() || null,
        address: String(input.address ?? '').trim() || null,
        notes: String(input.notes ?? '').trim() || null,
        commercial_register: String(input.commercial_register ?? '').trim() || null,
        tax_registration_status: status,
        // غير المسجل لا يقبل رقمًا ضريبيًا — الخادم يرفضه، فنُرسل null.
        vat_number: status === 'NOT_REGISTERED' ? null : vat || null,
        ...(input.openingBalance !== undefined ? { openingBalance: input.openingBalance } : {}),
        ...(input.is_active !== undefined ? { is_active: input.is_active } : {}),
    };
}

/** مرآة تحقق الضريبة في الخادم — تُمنع قبل الإرسال بدل 422 متأخرة. */
export function supplierTaxError(input: { tax_registration_status?: string | null; vat_number?: string | null }): string {
    const status = String(input.tax_registration_status ?? 'NOT_REGISTERED')
        .trim()
        .toUpperCase();
    const vat = String(input.vat_number ?? '').trim();
    const validVat = /^\d{15}$/.test(vat);
    if (status === 'REGISTERED') {
        return validVat ? '' : 'الرقم الضريبي يجب أن يكون 15 رقمًا (مثال: 302212427200003)';
    }
    if (status === 'NOT_REGISTERED') {
        return vat ? 'المورد غير المسجل لا يقبل رقمًا ضريبيًا — اتركه فارغًا' : '';
    }
    if (status === 'EXEMPT') {
        return !vat || validVat ? '' : 'الرقم الضريبي يجب أن يكون 15 رقمًا';
    }
    return 'الحالة الضريبية غير معروفة (REGISTERED | NOT_REGISTERED | EXEMPT)';
}

/* ── العمليات ─────────────────────────────────────────────────────────── */

export async function createSupplier(input: SupplierCreateInput): Promise<SupplierResult> {
    return writeJson(supplierResultSchema, '/api/procurement/suppliers', 'POST', supplierBody(input));
}

export async function updateSupplier(id: string | number, input: SupplierUpdateInput): Promise<SupplierResult> {
    return writeJson(supplierResultSchema, `/api/procurement/suppliers/${encodeURIComponent(String(id))}`, 'PUT', supplierBody(input));
}

export async function setSupplierActive(id: string | number, active: boolean): Promise<SupplierResult> {
    return writeJson(supplierResultSchema, `/api/procurement/suppliers/${encodeURIComponent(String(id))}`, 'PUT', {
        is_active: active,
    });
}

export async function deleteSupplier(id: string | number): Promise<void> {
    await writeAck(`/api/procurement/suppliers/${encodeURIComponent(String(id))}`, 'DELETE');
}

/* ── دوال تأكيد ───────────────────────────────────────────────────────── */

export function supplierCreateConfirm(): string {
    return SUPPLIER_TEXT.confirmCreate;
}

export function supplierUpdateConfirm(name: string): string {
    return SUPPLIER_TEXT.confirmUpdate.replace('%s', String(name ?? ''));
}

export function supplierDeactivateConfirm(name: string): string {
    return SUPPLIER_TEXT.confirmDeactivate.replace('%s', String(name ?? ''));
}

export function supplierActivateConfirm(name: string): string {
    return SUPPLIER_TEXT.confirmActivate.replace('%s', String(name ?? ''));
}

export function supplierDeleteConfirm(name: string): string {
    return SUPPLIER_TEXT.confirmDelete.replace('%s', String(name ?? ''));
}

/* ── نصوص نجاح ───────────────────────────────────────────────────────── */

export function supplierCreateSuccess(name: string): string {
    return `${SUPPLIER_TEXT.createSuccess} — «${String(name ?? '')}»`;
}

export function supplierUpdateSuccess(name: string): string {
    return `${SUPPLIER_TEXT.updateSuccess} — «${String(name ?? '')}»`;
}

export function supplierDeactivateSuccess(name: string): string {
    return `${SUPPLIER_TEXT.deactivateSuccess} — «${String(name ?? '')}»`;
}

export function supplierActivateSuccess(name: string): string {
    return `${SUPPLIER_TEXT.activateSuccess} — «${String(name ?? '')}»`;
}

export function supplierDeleteSuccess(name: string): string {
    return `${SUPPLIER_TEXT.deleteSuccess} — «${String(name ?? '')}»`;
}
