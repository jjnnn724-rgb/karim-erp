import { z } from 'zod';
import { fetchJson } from './api';
import { getAccessToken } from './auth';

/**
 * البيع الخارجي — المسحوبات من المخزن مقابل المبيعات (مرآة Oracle).
 * المصدر الحقيقي للأرقام: خادم `/api/external-sales/summary` — لا حساب هنا.
 */

const issueRowSchema = z
    .object({
        date: z.string(),
        doc: z.string(),
        item: z.string(),
        qty: z.number(),
        unit: z.string().optional(),
        cost: z.number(),
        value: z.number(),
        status: z.string().optional(),
    })
    .passthrough();

const byItemSchema = z
    .object({
        item: z.string(),
        lines: z.number().optional(),
        qty: z.number(),
        value: z.number().optional(),
    })
    .passthrough();

const invoiceRowSchema = z
    .object({
        id: z.string(),
        date: z.string(),
        ref: z.string(),
        customer: z.string().nullable().optional(),
        amount: z.number(),
        items: z.number(),
        qty: z.number(),
    })
    .passthrough();

export const externalSalesSummarySchema = z
    .object({
        ok: z.boolean().optional(),
        from: z.string(),
        to: z.string(),
        issued: z
            .object({
                totals: z
                    .object({
                        lines: z.number(),
                        docs: z.number(),
                        qty: z.number(),
                        value: z.number(),
                    })
                    .passthrough(),
                rows: z.array(issueRowSchema),
                capped: z.boolean().optional(),
                byItem: z.array(byItemSchema),
            })
            .passthrough(),
        sold: z
            .object({
                totals: z
                    .object({
                        invoices: z.number(),
                        amount: z.number(),
                        qty: z.number(),
                        lines: z.number(),
                        unparsedLines: z.number().optional(),
                    })
                    .passthrough(),
                rows: z.array(invoiceRowSchema),
                byItem: z.array(byItemSchema),
            })
            .passthrough(),
    })
    .passthrough();

export type ExternalSalesSummary = z.infer<typeof externalSalesSummarySchema>;

export async function fetchExternalSales(from: string, to: string, signal?: AbortSignal): Promise<ExternalSalesSummary> {
    const params = new URLSearchParams({ from, to });
    return fetchJson(
        externalSalesSummarySchema,
        `/api/external-sales/summary?${params.toString()}`,
        getAccessToken(),
        signal ? { signal } : {},
    );
}

/* ─── مساعدو العرض ─────────────────────────────────────────────────── */

export type ExternalSort = 'qty' | 'value' | 'name';

export function sortByItem<T extends { item: string }>(rows: T[], key: ExternalSort, dir: 'asc' | 'desc' = 'desc'): T[] {
    const sign = dir === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
        if (key === 'name') {
            return sign * String(a.item).localeCompare(String(b.item), 'ar');
        }
        const va = Number((a as { qty?: number; value?: number }).qty ?? 0);
        const vb = Number((b as { qty?: number; value?: number }).qty ?? 0);
        const waa = Number((a as { value?: number }).value ?? 0);
        const wbb = Number((b as { value?: number }).value ?? 0);
        if (key === 'value') {
            return sign * (waa - wbb);
        }
        return sign * (va - vb);
    });
}

export function sumQty<T extends { qty: number }>(rows: readonly T[]): number {
    return rows.reduce((sum, row) => sum + Number(row.qty ?? 0), 0);
}

export function share(part: number, total: number): number {
    return total > 0 ? (part / total) * 100 : 0;
}
