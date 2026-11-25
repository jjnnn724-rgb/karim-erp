import { z } from 'zod';
import { fetchJson } from './api';
import { getAccessToken } from './auth';
import { moneyOf, num } from './reporting';

/**
 * قائمة المركز المالي — `/api/accounting/balance-sheet` (قراءة فقط).
 *
 * الخادم يولّد القائمة من الأستاذ العام مباشرة (generateBalanceSheet في
 * `financial-statements-engine.js`) — العمود المالي التالي:
 * أصول = `asset`، خصوم = `liability`، حقوق الملكية = `equity` + دخل الفترة.
 * أي فرق `variance` يُعرض كما هو ولا يُخفى.
 */
export const balanceSheetAccountSchema = z
    .object({
        code: z.string(),
        name_ar: z.string(),
        name_en: z.string().optional(),
        type: z.string(),
        parent_code: z.string().nullable().optional(),
        balance: z.number(),
    })
    .passthrough();

export type BalanceSheetAccount = z.infer<typeof balanceSheetAccountSchema>;

export const balanceSheetSchema = z
    .object({
        statement: z.string(),
        as_of_date: z.string(),
        currency: z.string().optional(),
        assets: z
            .object({
                current_assets: z.array(balanceSheetAccountSchema),
                non_current_assets: z.array(balanceSheetAccountSchema),
                total_assets: z.number(),
            })
            .passthrough(),
        liabilities: z
            .object({
                current_liabilities: z.array(balanceSheetAccountSchema),
                non_current_liabilities: z.array(balanceSheetAccountSchema),
                total_liabilities: z.number(),
            })
            .passthrough(),
        equity: z
            .object({
                capital_and_reserves: z.array(balanceSheetAccountSchema),
                current_period_net_income: z.number(),
                total_equity: z.number(),
            })
            .passthrough(),
        reconciliation: z
            .object({
                total_assets: z.number(),
                total_liabilities_and_equity: z.number(),
                variance: z.number(),
                balanced: z.boolean(),
            })
            .passthrough(),
        generated_at: z.string().optional(),
    })
    .passthrough();

export type BalanceSheet = z.infer<typeof balanceSheetSchema>;

/** جلب القائمة مرة واحدة — لا تحقير ولا تحويلات في الواجهة. */
export function fetchBalanceSheet(asOf: string, signal?: AbortSignal): Promise<BalanceSheet> {
    const params = new URLSearchParams({ as_of: asOf });
    return fetchJson(balanceSheetSchema, `/api/accounting/balance-sheet?${params.toString()}`, getAccessToken(), signal ? { signal } : {});
}

/** رصيد صفري يُقرأ صفرًا: «—» فقط لقيم غير رقمية مرّة واحدة. */
export function accountAmount(value: number | null | undefined): string {
    return value === null || value === undefined ? '—' : moneyOf(value);
}

export function sumAccounts(rows: readonly BalanceSheetAccount[]): number {
    return rows.reduce((sum, row) => sum + num(row.balance), 0);
}
