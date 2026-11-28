import { z } from 'zod';
import { fetchJson } from './api';
import { getAccessToken } from './auth';

/**
 * محرك تسعير المنيو — مصدر واحد: `/api/pos/menu-cost/today`.
 * الخادم يحسب تكلفة الوحدة من `inventory.avgCost` الحي وتكلفة اليوم من
 * كميات المباعات داخل يوم الرياض. الواجهة تعرض ولا تحسب.
 */

const num = z.union([z.string(), z.number()]).nullable().optional();
const text = z.string().nullable().optional();

export const menuCostRowSchema = z
    .object({
        product_id: z.union([z.string(), z.number()]),
        name: z.string(),
        name_en: text,
        department_id: z.union([z.string(), z.number()]).nullable().optional(),
        price: num,
        unit_cost: num,
        quantity_sold_today: num,
        daily_cost: num,
        net_sales: num,
        cost_ratio: num,
        ingredient_count: z.number().optional(),
        priced_lines: z.number().optional(),
        pricing_status: z.enum(['priced', 'estimated', 'partial', 'unpriced']).optional(),
        reason: text,
    })
    .passthrough();

export const menuCostSchema = z
    .object({
        ok: z.boolean().optional(),
        date: z.string(),
        basis: z.string().optional(),
        totals: z
            .object({
                items: z.number().optional(),
                priced_count: z.number().optional(),
                unpriced_count: z.number().optional(),
                total_daily_cost: num,
                total_net_sales: num,
                cost_ratio: num,
            })
            .passthrough()
            .optional(),
        rows: z.array(menuCostRowSchema).optional().default([]),
    })
    .passthrough();

export type MenuCostRow = z.infer<typeof menuCostRowSchema>;
export type MenuCost = z.infer<typeof menuCostSchema>;

export async function fetchMenuCostToday(date?: string, signal?: AbortSignal): Promise<MenuCost> {
    const query = date ? `?date=${encodeURIComponent(date)}` : '';
    return fetchJson(menuCostSchema, `/api/pos/menu-cost/today${query}`, getAccessToken(), signal ? { signal } : {});
}

export const MENU_COST_STATUS_AR: Record<string, string> = {
    priced: 'مسعّر',
    estimated: 'تقديري',
    partial: 'جزئي',
    unpriced: 'بلا تسعير',
};
