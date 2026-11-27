import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MenuCost } from './MenuCost';

function json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

afterEach(() => vi.unstubAllGlobals());

describe('محرك تسعير المنيو', () => {
    it('يعرض تكلفة اليوم وكل أصناف المنيو بحالة التسعير', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async (url: string) => {
                if (url.includes('/api/pos/menu-cost/today')) {
                    return json({
                        ok: true,
                        date: '2026-11-28',
                        totals: {
                            items: 2,
                            priced_count: 1,
                            unpriced_count: 1,
                            total_daily_cost: '3.50',
                            total_net_sales: '20.00',
                            cost_ratio: '17.5',
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
                                pricing_status: 'priced',
                            },
                            {
                                product_id: 8,
                                name: 'بدون وصفة',
                                price: '5',
                                unit_cost: null,
                                quantity_sold_today: 0,
                                daily_cost: null,
                                net_sales: '0',
                                cost_ratio: null,
                                ingredient_count: 0,
                                pricing_status: 'unpriced',
                            },
                        ],
                    });
                }
                return json({ error: 'NOT_FOUND' }, 404);
            }),
        );

        const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        render(
            <QueryClientProvider client={client}>
                <MenuCost />
            </QueryClientProvider>,
        );

        expect(await screen.findByText('تكلفة اليوم')).toBeTruthy();
        expect(await screen.findByText('ساندوتش لحم')).toBeTruthy();
        expect(screen.getByText('بدون وصفة')).toBeTruthy();
        expect(screen.getAllByText('مسعّر').length).toBeGreaterThan(0);
        expect(screen.getAllByText('بلا تسعير').length).toBeGreaterThan(0);
    });
});
