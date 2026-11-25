import { z } from 'zod';
import { fetchJson } from './api';
import { getAccessToken } from './auth';

/**
 * المقارنة الشهرية — `GET /api/finance/monthly-comparison?months=12`:
 *   {period, months:[{month,revenue,cost,net_profit,margin_pct,...}],
 *    totals, cashier_scope, ...}
 *
 * الشهور كما يرتّبها الخادم؛ لا نعيد ترتيبها ولا نحسب هامشًا.
 */

const text = z.string().nullable().optional();
const numLike = z.union([z.string(), z.number()]).nullable().optional();

const monthRowSchema = z
    .object({
        month: text,
        label: text,
        revenue: numLike,
        cost: numLike,
        net_profit: numLike,
        margin_pct: numLike,
        invoices: numLike,
        orders: numLike,
        cashiers: numLike,
    })
    .passthrough();

export type MonthRow = z.infer<typeof monthRowSchema>;

export const monthlyComparisonSchema = z
    .object({
        period: z.object({ from: text, to: text, months: numLike, label: text }).passthrough().optional(),
        months: z.array(monthRowSchema).optional(),
        totals: z
            .object({
                revenue: numLike,
                cost: numLike,
                net_profit: numLike,
                margin_pct: numLike,
                invoices: numLike,
            })
            .passthrough()
            .optional(),
        cashier_scope: z.unknown().optional(),
    })
    .passthrough();

export type MonthlyComparison = z.infer<typeof monthlyComparisonSchema>;

export const MONTH_OPTIONS = [6, 12, 24] as const;

export async function fetchMonthlyComparison(months: number, signal?: AbortSignal): Promise<MonthlyComparison> {
    return fetchJson(
        monthlyComparisonSchema,
        `/api/finance/monthly-comparison?months=${String(months)}`,
        getAccessToken(),
        signal ? { signal } : {},
    );
}

/** آخر شهر في القائمة كما وصلت — بلا إعادة ترتيب. */
export function latestMonth(comparison: MonthlyComparison | undefined): MonthRow | null {
    const months = comparison?.months ?? [];
    return months.length > 0 ? (months[months.length - 1] ?? null) : null;
}

/** أعلى شهر إيرادًا في النافذة — للعرض فقط. */
export function topMonth(comparison: MonthlyComparison | undefined): MonthRow | null {
    const months = comparison?.months ?? [];
    if (months.length === 0) {
        return null;
    }
    return months.reduce((best, row) => (Number(row.revenue ?? 0) > Number(best.revenue ?? 0) ? row : best));
}

export function monthText(value: unknown): string {
    const raw = String(value ?? '');
    const match = /^(\d{4})-(\d{2})$/.exec(raw);
    return match ? `${match[1]}-${match[2]}` : raw;
}
