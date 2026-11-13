import { z } from 'zod';
import { fetchJson } from './api';
import { getAccessToken } from './auth';

/**
 * قائمة التدفقات النقدية — `/api/accounting/cash-flow` (انخفاض أو يعيد حسابه
 * من الأستاذ: مقبوضات ومدفوعات على حسابَي النقد/البنك مقسمة حسب الطرف المقابل).
 *
 * `opening_available=false` تعني رصيد الافتتاح تعذّر احتسابه — يُعرض «—» لا صفرًا.
 */
export const byCounterpartySchema = z
    .object({
        account: z.string(),
        net: z.number(),
    })
    .passthrough();

export type ByCounterparty = z.infer<typeof byCounterpartySchema>;

export const cashFlowSchema = z
    .object({
        ok: z.boolean().optional(),
        from: z.string(),
        to: z.string(),
        opening: z.number(),
        inflow: z.number(),
        outflow: z.number(),
        opening_available: z.boolean(),
        net: z.number(),
        closing: z.number(),
        byCounterparty: z.array(byCounterpartySchema),
    })
    .passthrough();

export type CashFlow = z.infer<typeof cashFlowSchema>;

export function fetchCashFlow(from: string, to: string, signal?: AbortSignal): Promise<CashFlow> {
    const params = new URLSearchParams({ from, to });
    return fetchJson(cashFlowSchema, `/api/accounting/cash-flow?${params.toString()}`, getAccessToken(), signal ? { signal } : {});
}
