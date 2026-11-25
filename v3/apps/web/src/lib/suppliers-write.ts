import { z } from 'zod';
import { isWriteRole, writeAck, writeJson } from './write';

/**
 * كتابة الموردين — منقولة من V2 بوابات الصلاحية نفسها:
 *  • إنشاء     POST   /api/procurement/suppliers  (admin|manager|accountant)
 *  • تعديل     PATCH  /api/procurement/suppliers/:id (admin|manager|accountant)
 *  • إيقاف/تفعيل PATCH /api/procurement/suppliers/:id/active (admin|manager|accountant)
 *  • حذف نهائي DELETE /api/procurement/suppliers/:id (admin)
 *
 * حتى تُفعَّل هذه المسارات في الباكendien، تُعدّ الدوال جاهزة للاستدعاء.
 */

export const SUPPLIER_WRITE_ROLES = ['admin', 'manager', 'accountant'] as const;
export const SUPPLIER_DELETE_ROLES = ['admin'] as const;

export function supplierWriteVisible(role: string | null | undefined): boolean {
    return isWriteRole(role, SUPPLIER_WRITE_ROLES);
}

export function supplierDeleteVisible(role: string | null | undefined): boolean {
    return isWriteRole(role, SUPPLIER_DELETE_ROLES);
}

/* ── نصوص V2 حرفيًّا ───────────────────────────────────────────────────── */

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

/**
 * الحالة الضريبية — نفس قيم `backend/procurement-routes.js` وV2
 * (`procurement-repo.js`). كانت الواجهة ترسل `tax_number` قديمًا كان الخادم
 * يتجاهله، فكان كل مورد يُنشأ «غير مسجل» حتى لو أدخل المشغّل رقمًا ضريبيًا —
 * ومن ثمّ صفر ضريبة في فواتيره. الاسم الصحيح هو `vat_number` مع الحالة.
 */
export const TAX_STATUS_VALUES = ['REGISTERED', 'NOT_REGISTERED', 'EXEMPT'] as const;
export type TaxStatus = (typeof TAX_STATUS_VALUES)[number];

const taxFields = {
    tax_registration_status: z.enum(TAX_STATUS_VALUES).default('NOT_REGISTERED'),
    vat_number: z.string().nullable().optional(),
    commercial_register: z.string().nullable().optional(),
};

export const supplierCreateSchema = z.object({
    name: z.string().min(1, SUPPLIER_TEXT.nameRequired),
    phone: z.string().min(1, SUPPLIER_TEXT.phoneRequired),
    address: z.string().optional().nullable(),
    name_en: z.string().optional().nullable(),
    category: z.string().optional().nullable(),
    ...taxFields,
    is_active: z.boolean().default(true),
});

export type SupplierCreateInput = z.infer<typeof supplierCreateSchema>;

export const supplierUpdateSchema = z.object({
    name: z.string().min(1, SUPPLIER_TEXT.nameRequired),
    phone: z.string().min(1, SUPPLIER_TEXT.phoneRequired),
    address: z.string().optional().nullable(),
    name_en: z.string().optional().nullable(),
    category: z.string().optional().nullable(),
    ...taxFields,
    is_active: z.boolean().optional(),
});

export type SupplierUpdateInput = z.infer<typeof supplierUpdateSchema>;

export const supplierActiveSchema = z.object({
    is_active: z.boolean(),
});

export type SupplierActiveInput = z.infer<typeof supplierActiveSchema>;

const supplierResultSchema = z.object({ id: z.union([z.string(), z.number()]) }).passthrough();
export type SupplierResult = z.infer<typeof supplierResultSchema>;

/** تحقق محلي مطابق للخادم — يمنع إرسال زوج (حالة، رقم) مرفوض فيُسكت الخطأ. */
export function supplierTaxError(input: {
    tax_registration_status?: string | null;
    vat_number?: string | null;
}): string {
    const status = String(input.tax_registration_status || 'NOT_REGISTERED').toUpperCase();
    const vat = String(input.vat_number ?? '').trim();
    const digits = vat.replace(/\D/g, '');
    if (status === 'REGISTERED' && !/^\d{15}$/.test(digits)) {
        return 'المورد المسجل ضريبيًا يحتاج رقمًا ضريبيًا (15 رقمًا)';
    }
    if (status === 'NOT_REGISTERED' && vat) {
        return 'المورد غير المسجل لا يقبل رقمًا ضريبيًا — اتركه فارغًا';
    }
    if (vat && !/^\d{15}$/.test(digits)) {
        return 'الرقم الضريبي يجب أن يكون 15 رقمًا';
    }
    return '';
}

/* ── العمليات ─────────────────────────────────────────────────────────── */

export function supplierBody(input: SupplierCreateInput | SupplierUpdateInput): Record<string, unknown> {
    const body: Record<string, unknown> = {
        name: input.name.trim(),
        phone: input.phone.trim(),
        address: input.address?.trim() || null,
        name_en: input.name_en?.trim() || null,
        category: input.category?.trim() || null,
        tax_registration_status: input.tax_registration_status || 'NOT_REGISTERED',
        vat_number: input.vat_number?.trim() || null,
        commercial_register: input.commercial_register?.trim() || null,
    };
    if ('is_active' in input && input.is_active !== undefined) {
        // الخادم يقرأ `is_active` لا `active` — الاسم القديم كان يُتجاهل.
        body.is_active = input.is_active;
    }
    return body;
}

export async function createSupplier(input: SupplierCreateInput): Promise<SupplierResult> {
    return writeJson(supplierResultSchema, '/api/procurement/suppliers', 'POST', supplierBody(input));
}

export async function updateSupplier(id: string | number, input: SupplierUpdateInput): Promise<SupplierResult> {
    return writeJson(
        supplierResultSchema,
        `/api/procurement/suppliers/${encodeURIComponent(String(id))}`,
        'PUT',
        supplierBody(input),
    );
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
