import { z } from 'zod';
import { fetchJson } from './api';
import { getAccessToken } from './auth';

/**
 * تقرير مبيعات نقطة البيع — `GET /api/pos/reports/sales`:
 *   {start_date, end_date, group_by, filters,
 *    summary:{invoice_count,net_sales,subtotal_sales,discount_total,tax_total,
 *             items_qty,unique_items,avg_ticket,payment_methods},
 *    rows:[...]}
 *
 * صفوف التجميع بحسب `group_by`:
 *   department → department_code/department_name
 *   cashier    → cashier_name/cashier_username
 *   item       → product_id/product_name/product_barcode (بسقف 200 صنف)
 *
 * كل الصفوف تحمل invoice_count/subtotal_sales/discount_total/tax_total/
 * net_sales/avg_ticket/items_qty/unique_items، والصنف يزيد quantity_sold.
 */

const text = z.string().nullable().optional();
const numLike = z.union([z.string(), z.number()]).nullable().optional();

export type GroupBy = 'department' | 'cashier' | 'item';

export const GROUP_LABELS: Record<GroupBy, string> = {
    department: 'القسم',
    cashier: 'الكاشير',
    item: 'الصنف',
};

export const GROUP_OPTIONS: { key: GroupBy; label: string }[] = [
    { key: 'department', label: 'حسب القسم' },
    { key: 'cashier', label: 'حسب الكاشير' },
    { key: 'item', label: 'حسب الصنف' },
];

/** سقف أصناف التقرير على الخادم (`LIMIT 200`). */
export const ITEM_ROWS_CAP = 200;

const summarySchema = z
    .object({
        invoice_count: numLike,
        net_sales: numLike,
        subtotal_sales: numLike,
        discount_total: numLike,
        tax_total: numLike,
        items_qty: numLike,
        unique_items: numLike,
        avg_ticket: numLike,
        payment_methods: z.record(z.string(), numLike).optional(),
    })
    .passthrough();

export type ReportSummary = z.infer<typeof summarySchema>;

const rowSchema = z
    .object({
        department_id: numLike,
        department_code: text,
        department_name: text,
        cashier_id: numLike,
        cashier_name: text,
        cashier_username: text,
        product_id: numLike,
        product_name: text,
        product_barcode: text,
        invoice_count: numLike,
        subtotal_sales: numLike,
        discount_total: numLike,
        tax_total: numLike,
        net_sales: numLike,
        avg_ticket: numLike,
        items_qty: numLike,
        unique_items: numLike,
        quantity_sold: numLike,
    })
    .passthrough();

export type ReportRow = z.infer<typeof rowSchema>;

export const salesReportSchema = z
    .object({
        start_date: text,
        end_date: text,
        group_by: text,
        filters: z.object({ department_id: numLike, cashier_id: numLike }).passthrough().optional(),
        summary: summarySchema.optional(),
        rows: z.array(rowSchema).optional(),
    })
    .passthrough();

export type SalesReport = z.infer<typeof salesReportSchema>;

export async function fetchSalesReport(from: string, to: string, groupBy: GroupBy, signal?: AbortSignal): Promise<SalesReport> {
    const params = new URLSearchParams({ start_date: from, end_date: to, group_by: groupBy });
    return fetchJson<SalesReport>(
        salesReportSchema,
        `/api/pos/reports/sales?${params.toString()}`,
        getAccessToken(),
        signal ? { signal } : {},
    );
}

/** تسمية صف التجميع بحسب نوعه — الصف الواحد قد يحمل حقول الأقسام الثلاثة. */
export function reportRowLabel(row: ReportRow, groupBy: GroupBy): string {
    if (groupBy === 'item') {
        return String(row.product_name ?? '') || String(row.product_barcode ?? '') || '—';
    }
    if (groupBy === 'cashier') {
        const name = String(row.cashier_name ?? '') || String(row.cashier_username ?? '');
        return name || '—';
    }
    return String(row.department_name ?? '') || String(row.department_code ?? '') || '—';
}

/** الكمية المعروضة: الصنف يبيع `quantity_sold`، والتجميعان يعرضان `items_qty`. */
export function reportRowQty(row: ReportRow, groupBy: GroupBy): number {
    const value = groupBy === 'item' ? row.quantity_sold : row.items_qty;
    const parsed = Number(value ?? 0);
    return Number.isFinite(parsed) ? parsed : 0;
}

/** طرق الدفع أسماءٌ من الخادم (`jsonb_object_agg(method, amount)`). */
export const PAYMENT_AR: Record<string, string> = {
    cash: 'نقد',
    card: 'شبكة',
    network: 'شبكة',
    mada: 'مدى',
    credit: 'آجل',
    wallet: 'محفظة',
    transfer: 'تحويل',
    mobile: 'جوال',
};
