import { z } from 'zod';
import { isWriteRole, writeAck, writeJson } from './write';

/**
 * كتابة مرتجعات المطبخ عبر مسار العملية المخصص:
 *  • إنشاء POST  /api/warehouse/returns
 *  • إبطال POST  /api/warehouse/returns/:id/void
 *
 * الإبطال يعكس المخزون والمحاسبة ويحفظ السجل؛ لذلك لا يوجد حذف مباشر.
 */

export const WH_RETURN_WRITE_ROLES = ['admin', 'manager', 'warehouse', 'kitchen', 'sous_chef', 'dept_head'] as const;
export const WH_RETURN_VOID_ROLES = ['admin', 'manager', 'warehouse'] as const;

export function whReturnWriteVisible(role: string | null | undefined): boolean {
    return isWriteRole(role, WH_RETURN_WRITE_ROLES);
}

export function whReturnVoidVisible(role: string | null | undefined): boolean {
    return isWriteRole(role, WH_RETURN_VOID_ROLES);
}

export const WH_RETURN_TEXT = {
    itemsRequired: 'أضف صنفًا واحدًا على الأقل',
    nameRequired: 'اسم الصنف مطلوب',
    qtyRequired: 'أدخل كمية صحيحة للصنف',
    createFailed: 'فشل إنشاء المرتجع',
    deleteFailed: 'فشل إبطال المرتجع',
    createSuccess: 'تم إنشاء المرتجع وعكس أثره المخزني والمحاسبي',
    deleteSuccess: 'تم إبطال المرتجع وعكس أثره مع حفظ السجل',
    cancel: 'إلغاء',
} as const;

export interface WhReturnItemInput {
    name: string;
    qty: number;
    unit?: string | undefined;
    actualWeight?: number | null | undefined;
    packagingQty?: number | null | undefined;
    packagingUom?: string | undefined;
}

export type WhReturnCreateInput = {
    items: WhReturnItemInput[];
    deptCode: string;
    deptName?: string | null;
    notes?: string | null;
    reason?: string | null;
    dispatchId?: number | string | null;
};

const whResultSchema = z.object({ id: z.union([z.string(), z.number()]).optional() }).passthrough();
const whReturnResponseSchema = z.object({ return: whResultSchema }).passthrough();
export type WhResult = z.infer<typeof whResultSchema>;

function operationKey(action: string, scope: string): Record<string, string> {
    return {
        'X-Idempotency-Key': `${action}:${scope}:${crypto.randomUUID()}`,
    };
}

export async function createKitchenReturn(input: WhReturnCreateInput): Promise<WhResult> {
    const response = await writeJson(
        whReturnResponseSchema,
        '/api/warehouse/returns',
        'POST',
        {
            items: input.items.map((item) => ({
                name: item.name,
                qty: Number(item.qty),
                unit: item.unit ?? '',
                ...(item.packagingQty != null
                    ? {
                          actualWeight: item.actualWeight ?? null,
                          packagingQty: Number(item.packagingQty),
                          packagingUom: item.packagingUom?.trim() || 'كرتون',
                      }
                    : {}),
            })),
            notes: input.notes?.trim() || null,
            reason: input.reason?.trim() || null,
            date: new Date().toISOString().slice(0, 10),
            deptCode: input.deptCode.trim(),
            deptName: input.deptName?.trim() || null,
            ...(input.dispatchId ? { dispatchId: Number(input.dispatchId) } : {}),
        },
        operationKey('return-create', input.dispatchId ? String(input.dispatchId) : 'direct'),
    );
    return response.return;
}

export async function voidKitchenReturn(id: string | number, reason: string): Promise<void> {
    const cleanReason = reason.trim();
    if (!cleanReason) {
        throw new Error('سبب الإبطال مطلوب');
    }
    await writeAck(
        `/api/warehouse/returns/${encodeURIComponent(String(id))}/void`,
        'POST',
        { reason: cleanReason },
        operationKey('return-void', String(id)),
    );
}
