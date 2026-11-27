import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchMenuCostToday } from './menu-cost';

function json(body: unknown): Response {
    return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

afterEach(() => vi.unstubAllGlobals());

describe('محرك تسعير المنيو', () => {
    it('يقرأ المسار اليومي ويمرّر التاريخ ويحتفظ بالحقول الحقيقية', async () => {
        const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
            json({
                ok: true,
                date: '2026-11-28',
                basis: 'inventory.avgCost live · Riyadh day',
                totals: {
                    items: 2,
                    priced_count: 1,
                    unpriced_count: 1,
                    total_daily_cost: '3.50',
                    total_net_sales: '20.00',
                    cost_ratio: '17.50',
                },
                rows: [
                    {
                        product_id: 7,
                        name: 'ساندوتش لحم',
                        price: '10',
                        unit_cost: '3.50',
                        quantity_sold_today: 1,
                        daily_cost: '3.50',
                        net_sales: '10',
                        cost_ratio: '35',
                        ingredient_count: 3,
                        priced_lines: 3,
                        pricing_status: 'priced',
                    },
                    {
                        product_id: 8,
                        name: 'بدون BOM',
                        price: '5',
                        unit_cost: null,
                        quantity_sold_today: 2,
                        daily_cost: null,
                        net_sales: '10',
                        cost_ratio: null,
                        ingredient_count: 0,
                        pricing_status: 'unpriced',
                        reason: 'لا وصفة',
                    },
                ],
            }),
        );
        vi.stubGlobal('fetch', fetchMock);

        const result = await fetchMenuCostToday('2026-11-28');
        expect(String(fetchMock.mock.calls[0]?.[0])).toBe('/api/pos/menu-cost/today?date=2026-11-28');
        expect(result.totals?.total_daily_cost).toBe('3.50');
        expect(result.rows?.[0]?.pricing_status).toBe('priced');
        expect(result.rows?.[1]?.daily_cost).toBeNull();
    });
});
