import { z } from 'zod';
import { fetchJson } from './api';
import { getAccessToken } from './auth';
import { isWriteRole, writeAck, writeJson } from './write';

/**
 * أدوار الخادم (backend/dept-transfer-routes.js) — مرآة حرفية لا تُخترع:
 *  • WRITE_ROLES   = admin|manager|warehouse|kitchen|sous_chef|dept_head
 *                    (إنشاء/بيع خارجي/إلغاء/جلب المخزون)
 *  • APPROVE_ROLES = admin|manager|kitchen|sous_chef
 *                    (اعتماد/رفض)
 * المصدر (resolveSourceDept): admin/manager/warehouse حرّون بتحديد صريح،
 * kitchen/sous_chef بلا قسم ⇒ المطبخ، dept_head ⇒ قسمه على الأكثر.
 */

export const TRANSFER_WRITE_ROLES = ['admin', 'manager', 'warehouse', 'kitchen', 'sous_chef', 'dept_head'] as const;
export const TRANSFER_APPROVE_ROLES = ['admin', 'manager', 'kitchen', 'sous_chef'] as const;

export function transferCreateVisible(role: string | null | undefined): boolean {
    return isWriteRole(role, TRANSFER_WRITE_ROLES);
}

export function transferApproveVisible(role: string | null | undefined): boolean {
    return isWriteRole(role, TRANSFER_APPROVE_ROLES);
}

export function transferExternalVisible(role: string | null | undefined): boolean {
    return isWriteRole(role, TRANSFER_WRITE_ROLES);
}

/** الأدوار الحرة في اختيار القسم المرسل (resolveSourceDept في الخادم). */
export function canChooseSourceDept(role: string | null | undefined): boolean {
    return isWriteRole(role, ['admin', 'manager', 'warehouse']);
}

/** قسم المرسل الافتراضي — مرآة mySourceDeptCode (V2): أول قسم من dept_code،
 *  وإن لم يوجد (الشيف/السو-شيف بلا قسم) فالمطبخ. */
export function mySourceDeptCode(user: { role?: string | null; deptCode?: string | null } | null | undefined): string {
    const own = String(user?.deptCode ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    if (own.length) {
        return own[0] ?? '';
    }
    const role = String(user?.role ?? '').toLowerCase();
    return role === 'kitchen' || role === 'sous_chef' ? 'kitchen' : '';
}

/* ── نصوص ─────────────────────────────────────────────────────────────── */

export const TRANSFER_TEXT = {
    destRequired: 'حدد القسم المستلم',
    sourceRequired: 'حدد القسم المرسل',
    itemsRequired: 'أضف صنفًا واحدًا على الأقل',
    qtyInvalid: 'أدخل كمية صحيحة للصنف',
    reasonRequired: 'اكتب سبب الرفض (3 أحرف على الأقل)',
    createFailed: 'فشلت العملية: تعذّر إنشاء التحويل',
    actionFailed: 'فشلت العملية',
    createSuccess: 'أُرسل الطلب — وصل إشعار للشيف والسو-شيف للاعتماد',
    externalSuccess: 'تم التنفيذ — خُصمت من قسمك',
    approveSuccess: 'اعتُمد ونُفِّذ التحويل',
    rejectSuccess: 'رُفض التحويل وشُعر مقدم الطلب',
    cancelSuccess: 'أُلغي الطلب',
    cancel: 'إلغاء',
} as const;

/* ── مخزون أذونات الصرف (مصدر التحويل) ─────────────────────────────────── */

const stockSourceSchema = z
    .object({
        ref: z.union([z.string(), z.number()]).nullable().optional(),
        dispatch_id: z.union([z.string(), z.number()]).nullable().optional(),
        issued_at: z.string().nullable().optional(),
        date: z.string().nullable().optional(),
        status: z.string().nullable().optional(),
        qty: z.union([z.string(), z.number()]).nullable().optional(),
        unit: z.string().nullable().optional(),
        in_transit: z.union([z.string(), z.number()]).nullable().optional(),
        unit_cost: z.union([z.string(), z.number()]).nullable().optional(),
    })
    .passthrough();

const stockItemSchema = z
    .object({
        inventory_id: z.union([z.string(), z.number()]),
        item_name: z.string().nullable().optional(),
        unit: z.string().nullable().optional(),
        voucher_unit: z.string().nullable().optional(),
        item_unit: z.string().nullable().optional(),
        avg_cost: z.union([z.string(), z.number()]).nullable().optional(),
        month_qty: z.union([z.string(), z.number()]).nullable().optional(),
        transferred_qty: z.union([z.string(), z.number()]).nullable().optional(),
        on_hand: z.union([z.string(), z.number()]).nullable().optional(),
        in_transit: z.union([z.string(), z.number()]).nullable().optional(),
        transferable_headroom: z.union([z.string(), z.number()]).nullable().optional(),
        available: z.union([z.string(), z.number()]).nullable().optional(),
        voucher_value: z.union([z.string(), z.number()]).nullable().optional(),
        vouchers: z.union([z.string(), z.number()]).nullable().optional(),
        sources: z.array(stockSourceSchema).nullable().optional(),
        menu_price: z
            .object({
                inventory_id: z.union([z.string(), z.number()]).nullable().optional(),
                menu_product_id: z.union([z.string(), z.number()]).nullable().optional(),
                menu_name: z.string().nullable().optional(),
                price: z.union([z.string(), z.number()]).nullable().optional(),
            })
            .passthrough()
            .nullable()
            .optional(),
    })
    .passthrough();

export const deptStockSchema = z
    .object({
        location: z
            .object({ id: z.union([z.string(), z.number()]).nullable().optional(), code: z.string().nullable().optional() })
            .passthrough()
            .nullable()
            .optional(),
        scope: z.string().nullable().optional(),
        factory: z.boolean().nullable().optional(),
        month_start: z.string().nullable().optional(),
        voucher_start_at: z.string().nullable().optional(),
        basis: z.string().nullable().optional(),
        availability: z.string().nullable().optional(),
        items: z.array(stockItemSchema).nullable().optional(),
    })
    .passthrough();

export type DeptStock = z.infer<typeof deptStockSchema>;
export type DeptStockItem = z.infer<typeof stockItemSchema>;
export type DeptStockSource = z.infer<typeof stockSourceSchema>;

export async function fetchDeptStock(deptCode: string, scope = 'month', signal?: AbortSignal): Promise<DeptStock> {
    const params = new URLSearchParams({ dept: deptCode });
    if (scope) {
        params.set('scope', scope);
    }
    return fetchJson(deptStockSchema, `/api/warehouse/dept-transfers/stock?${params.toString()}`, getAccessToken(), signal ? { signal } : {});
}

export type TransferItemInput = { inventory_id: string | number; qty: number };

export type TransferCreateInput = {
    sourceDeptCode: string;
    destDeptCode: string;
    items: TransferItemInput[];
    notes?: string | null;
};

const transferResultSchema = z.object({ id: z.union([z.string(), z.number()]).optional() }).passthrough();
export type TransferResult = z.infer<typeof transferResultSchema>;

export async function createDeptTransfer(input: TransferCreateInput): Promise<TransferResult> {
    return writeJson(transferResultSchema, '/api/warehouse/dept-transfers', 'POST', {
        sourceDeptCode: input.sourceDeptCode,
        destDeptCode: input.destDeptCode,
        items: input.items.map((item) => ({ inventory_id: Number(item.inventory_id), qty: Number(item.qty) })),
        notes: input.notes?.trim() || undefined,
    });
}

export async function createExternalSaleTransfer(input: TransferCreateInput): Promise<TransferResult> {
    return writeJson(transferResultSchema, '/api/warehouse/dept-transfers/external', 'POST', {
        sourceDeptCode: input.sourceDeptCode,
        destDeptCode: input.destDeptCode,
        items: input.items.map((item) => ({ inventory_id: Number(item.inventory_id), qty: Number(item.qty) })),
        notes: input.notes?.trim() || undefined,
    });
}

export async function approveTransfer(id: string | number): Promise<TransferResult> {
    return writeJson(transferResultSchema, `/api/warehouse/dept-transfers/${encodeURIComponent(String(id))}/approve`, 'POST', {});
}

export async function rejectTransfer(id: string | number, reason: string): Promise<TransferResult> {
    return writeJson(transferResultSchema, `/api/warehouse/dept-transfers/${encodeURIComponent(String(id))}/reject`, 'POST', {
        reason: reason.trim(),
    });
}

export async function cancelTransfer(id: string | number): Promise<void> {
    await writeAck(`/api/warehouse/dept-transfers/${encodeURIComponent(String(id))}/cancel`, 'POST', {});
}

/* ── منافذ البيع الخارجية ──────────────────────────────────────────────── */

export const EXTERNAL_SALE_DEPT = 'external_sales';

export const EXTERNAL_DESTINATIONS = [
    { code: 'external_sales', name: 'البيع الخارجي' },
    { code: 'CAF', name: 'كافيهshop' },
    { code: 'NAS', name: 'كافيه ناصر' },
] as const;

export function isExternalDestination(code: string | null | undefined): boolean {
    const want = String(code ?? '').trim().toLowerCase();
    return EXTERNAL_DESTINATIONS.some((d) => d.code.toLowerCase() === want);
}
