import { z } from 'zod';
import { fetchJson } from './api';
import { getAccessToken } from './auth';

/**
 * مبيعات الكاشير — ملخّص مرآة YaraSoft (`/api/cashier-sales/summary`):
 *   {currency, from, to, totals:{docs,collected,ex_vat,vat,discount,avg_invoice,
 *     avg_day,delta,...}, series:[{day,collected,ex_vat,vat}],
 *     peak, quiet, cashiers:[{...docs,collected,share,avg}],
 *     payments:[{key,label,amount,share}], hours:[{hour,docs,collected}],
 *     top_items:[{...qty,ex_vat,vat,docs,share}], mirror, zatca}
 *
 * الأرقام كلها محسوبة على الخادم: النسب والمتوسطات والتغيّر تُعرض كما وردت.
 * الاستعلام يقبل from/to/cashier/q، والسقف العملي للفترة يومان متساويان أو
 * مدى معلن من الخادم (`buildWhere`).
 */

const text = z.string().nullable().optional();
const numLike = z.union([z.string(), z.number()]).nullable().optional();
const idValue = z.union([z.string(), z.number()]).transform((value) => String(value));

const totalsSchema = z
    .object({
        docs: numLike,
        collected: numLike,
        ex_vat: numLike,
        vat: numLike,
        discount: numLike,
        payed: numLike,
        unaccounted: numLike,
        cashiers: numLike,
        days: numLike,
        lines: numLike,
        codes: numLike,
        avg_invoice: numLike,
        avg_day: numLike,
        avg_items: numLike,
        delta: numLike,
        prev: z.object({ collected: numLike, from: text, to: text, partial: z.unknown().optional() }).passthrough().optional(),
    })
    .passthrough();

const seriesRowSchema = z
    .object({
        day: text,
        docs: numLike,
        collected: numLike,
        ex_vat: numLike,
        vat: numLike,
    })
    .passthrough();

const cashierRowSchema = z
    .object({
        cashier_no: text,
        cashier_name: text,
        name: text,
        docs: numLike,
        collected: numLike,
        ex_vat: numLike,
        share: numLike,
        avg: numLike,
    })
    .passthrough();

const paymentRowSchema = z
    .object({
        key: text,
        label: text,
        amount: numLike,
        share: numLike,
    })
    .passthrough();

const topItemSchema = z
    .object({
        code: text,
        name: text,
        docs: numLike,
        qty: numLike,
        ex_vat: numLike,
        vat: numLike,
        share: numLike,
    })
    .passthrough();

export const cashierSalesSummarySchema = z
    .object({
        ok: z.unknown().optional(),
        currency: text,
        brand: text,
        from: text,
        to: text,
        cashier: text,
        q: text,
        totals: totalsSchema.optional(),
        series: z.array(seriesRowSchema).optional(),
        peak: seriesRowSchema.nullable().optional(),
        quiet: seriesRowSchema.nullable().optional(),
        cashiers: z.array(cashierRowSchema).optional(),
        payments: z.array(paymentRowSchema).optional(),
        hours: z.array(z.object({ hour: numLike, docs: numLike, collected: numLike }).passthrough()).optional(),
        top_items: z.array(topItemSchema).optional(),
        mirror: z.object({ docs: numLike, first_day: text, last_day: text, synced_at: text }).passthrough().optional(),
        zatca: z.unknown().optional(),
    })
    .passthrough();

export type CashierSalesSummary = z.infer<typeof cashierSalesSummarySchema>;

export async function fetchCashierSales(from: string, to: string, signal?: AbortSignal): Promise<CashierSalesSummary> {
    const params = new URLSearchParams({ from, to });
    return fetchJson(
        cashierSalesSummarySchema,
        `/api/cashier-sales/summary?${params.toString()}`,
        getAccessToken(),
        signal ? { signal } : {},
    );
}

export function cashierLabel(row: z.infer<typeof cashierRowSchema>): string {
    const name = String(row.cashier_name ?? row.name ?? '') || String(row.cashier_no ?? '');
    return name || 'كاشير';
}

/** الفرق عن الفترة السابقة نسبةً جاهزة من الخادم؛ `null` حين لا أساس. */
export function deltaText(value: unknown): string | null {
    if (value === null || value === undefined || value === '') {
        return null;
    }
    const parsed = Number(value);
    return Number.isFinite(parsed) ? `${parsed > 0 ? '+' : ''}${parsed.toFixed(1)}%` : null;
}

export { idValue as cashierDocId };
