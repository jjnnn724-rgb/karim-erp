import { z } from 'zod';
import { isWriteRole, writeAck, writeJson } from './write';

/**
 * كتابة مرتجعات المطبخ والحركات المادية — نظير routes المرتجعات في الخادم:
 *  • إنشاء  POST   /api/kitchenReturns       (admin|manager|warehouse|kitchen|sous_chef|dept_head)
 *  • حذف     DELETE /api/kitchenReturns/:id   (نفس القائمة، وحارس السقف في الخادم)
 *
 * الإلغاء عبر القنوات المخصصة (dispatch-routes) يبقى للشاشة القديمة؛ هنا
 * الإرجاع المباشر والحذف المباشر مثل V2.
 */

export const WH_RETURN_WRITE_ROLES = ['admin', 'manager', 'warehouse', 'kitchen', 'sous_chef', 'dept_head'] as const;

export function whReturnWriteVisible(role: string | null | undefined): boolean {
    return isWriteRole(role, WH_RETURN_WRITE_ROLES);
}

export const WH_RETURN_TEXT = {
    itemsRequired: 'أضف صنفًا واحدًا على الأقل',
    nameRequired: 'اسم الصنف مطلوب',
    qtyRequired: 'أدخل كمية صحيحة للصنف',
    createFailed: 'فشل إنشاء المرتجع',
    deleteFailed: 'فشل حذف المرتجع',
    createSuccess: 'تم إنشاء المرتجع',
    deleteSuccess: 'تم حذف المرتجع',
    cancel: 'إلغاء',
} as const;

export interface WhReturnItemInput {
    name: string;
    qty: number;
    unit?: string | undefined;
    price?: number | undefined;
}

export type WhReturnCreateInput = {
    items: WhReturnItemInput[];
    notes?: string | null;
    reason?: string | null;
    deptCode?: string | null;
    deptName?: string | null;
};

const whResultSchema = z.object({ id: z.union([z.string(), z.number()]).optional() }).passthrough();
export type WhResult = z.infer<typeof whResultSchema>;

export async function createKitchenReturn(input: WhReturnCreateInput): Promise<WhResult> {
    return writeJson(whResultSchema, '/api/kitchenReturns', 'POST', {
        items: input.items.map((item) => ({ name: item.name, qty: Number(item.qty), unit: item.unit ?? '' })),
        status: 'pending',
        notes: input.notes?.trim() || null,
        reason: input.reason?.trim() || null,
        date: new Date().toISOString().slice(0, 10),
        deptCode: input.deptCode?.trim() || null,
        deptName: input.deptName?.trim() || null,
    });
}

export async function deleteKitchenReturn(id: string | number): Promise<void> {
    await writeAck(`/api/kitchenReturns/${encodeURIComponent(String(id))}`, 'DELETE');
}
