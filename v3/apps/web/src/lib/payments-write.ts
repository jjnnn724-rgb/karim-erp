import { z } from 'zod';
import { isWriteRole, writeAck, writeJson } from './write';

/**
 * كتابة الدفعات — مطابقة لـ `backend/procurement-routes.js`:
 *  • إنشاء  POST   /api/procurement/payments       (admin|manager|accountant)
 *  • حذف    DELETE /api/procurement/payments/:id   (admin)
 *
 * الخادم لا يعرض PUT/PATCH للدفعات، لذلك لا توجد عملية تعديل هنا.
 * الحمولة: supplierId / invoiceId / amount / method / date / notes.
 */

export const PAYMENT_WRITE_ROLES = ['admin', 'manager', 'accountant'] as const;
export const PAYMENT_DELETE_ROLES = ['admin'] as const;

export function paymentWriteVisible(role: string | null | undefined): boolean {
    return isWriteRole(role, PAYMENT_WRITE_ROLES);
}

export function paymentDeleteVisible(role: string | null | undefined): boolean {
    return isWriteRole(role, PAYMENT_DELETE_ROLES);
}

/* ── نصوص V2 حرفيًّا ───────────────────────────────────────────────────── */

export const PAYMENT_TEXT = {
    invoiceRequired: 'رقم الفاتورة مطلوب',
    amountRequired: 'المبلغ مطلوب',
    amountInvalid: 'المبلغ يجب أن يكون رقمًا أكبر من صفر',
    dateRequired: 'تاريخ الدفع مطلوب',
    methodRequired: 'اختر طريقة الدفع',
    createFailed: 'فشل إنشاء الدفعة في قاعدة البيانات',
    updateFailed: 'فشل تحديث بيانات الدفعة',
    deleteFailed: 'فشل حذف الدفعة من قاعدة البيانات',
    deleteBlocked: 'لا يمكن حذف هذه الدفعة: مرتبطة بقيد محاسبي أو فاتورة',
    createSuccess: 'تم إنشاء الدفعة بنجاح',
    updateSuccess: 'تم تحديث بيانات الدفعة',
    deleteSuccess: 'تم حذف الدفعة',
    confirmCreate: 'تسجيل دفعة جديدة؟',
    confirmUpdate: 'تعديل بيانات الدفعة «%s»؟',
    confirmDelete: 'حذف الدفعة «%s» نهائيًا؟ لا يمكن التراجع.',
    cancel: 'إلغاء',
} as const;

/* ── مخططات التحقق ────────────────────────────────────────────────────── */

export const paymentCreateSchema = z.object({
    supplierId: z.coerce.number().int().positive('اختر المورد'),
    invoiceId: z.coerce.number().int().positive(PAYMENT_TEXT.invoiceRequired).optional(),
    amount: z.coerce.number().gt(0, PAYMENT_TEXT.amountInvalid),
    date: z.string().min(1, PAYMENT_TEXT.dateRequired),
    method: z.string().min(1, PAYMENT_TEXT.methodRequired),
    notes: z.string().optional().nullable(),
});

export type PaymentCreateInput = z.infer<typeof paymentCreateSchema>;

const paymentResultSchema = z.object({ id: z.union([z.string(), z.number()]) }).passthrough();
export type PaymentResult = z.infer<typeof paymentResultSchema>;

/* ── العمليات ─────────────────────────────────────────────────────────── */

export async function createPayment(input: PaymentCreateInput): Promise<PaymentResult> {
    return writeJson(paymentResultSchema, '/api/procurement/payments', 'POST', {
        supplierId: input.supplierId,
        ...(input.invoiceId !== undefined ? { invoiceId: input.invoiceId } : {}),
        amount: Number(input.amount),
        method: input.method.trim(),
        date: input.date,
        notes: input.notes?.trim() || null,
    });
}

export async function deletePayment(id: string | number): Promise<void> {
    await writeAck(`/api/procurement/payments/${encodeURIComponent(String(id))}`, 'DELETE');
}

/* ── دوال تأكيد ───────────────────────────────────────────────────────── */

export function paymentCreateConfirm(): string {
    return PAYMENT_TEXT.confirmCreate;
}

export function paymentUpdateConfirm(ref: string): string {
    return PAYMENT_TEXT.confirmUpdate.replace('%s', String(ref ?? ''));
}

export function paymentDeleteConfirm(ref: string): string {
    return PAYMENT_TEXT.confirmDelete.replace('%s', String(ref ?? ''));
}

/* ── نصوص نجاح ───────────────────────────────────────────────────────── */

export function paymentCreateSuccess(ref: string): string {
    return `${PAYMENT_TEXT.createSuccess} — «${String(ref ?? '')}»`;
}

export function paymentUpdateSuccess(ref: string): string {
    return `${PAYMENT_TEXT.updateSuccess} — «${String(ref ?? '')}»`;
}

export function paymentDeleteSuccess(ref: string): string {
    return `${PAYMENT_TEXT.deleteSuccess} — «${String(ref ?? '')}»`;
}
