import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider } from '@tanstack/react-router';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { validateAccountantDashboardSearch } from '../lib/accountant-search';
import { AccountantDashboard } from './AccountantDashboard';

function json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

function renderScreen(initialEntry = '/accountant-dashboard') {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const rootRoute = createRootRoute();
    const dashboardRoute = createRoute({
        getParentRoute: () => rootRoute,
        path: '/accountant-dashboard',
        validateSearch: validateAccountantDashboardSearch,
        component: AccountantDashboard,
    });
    const router = createRouter({
        routeTree: rootRoute.addChildren([dashboardRoute]),
        history: createMemoryHistory({ initialEntries: [initialEntry] }),
    });
    const result = render(
        <QueryClientProvider client={client}>
            <RouterProvider router={router} />
        </QueryClientProvider>,
    );
    return { ...result, router };
}

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('لوحة المحاسب', () => {
    it('تعرض الشهر من قائمة الدخل وأحدث الحركات', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async (input: RequestInfo | URL) => {
                const url = typeof input === 'string' ? input : input.toString();
                if (url.includes('/api/finance/pnl')) {
                    return json({
                        statement: {
                            revenue: { total: 50000, invoice_count: 400 },
                            cogs: { net: 18000 },
                            operating: { total: 6000, count: 9 },
                            net_profit: { amount: 21000, margin_pct: 42 },
                        },
                    });
                }
                if (url.includes('/api/revenues')) {
                    return json({ data: [{ id: 1, amount: 1200, date: '2026-11-07', source: 'مبيعات' }] });
                }
                if (url.includes('/api/expenses')) {
                    return json({ data: [{ id: 2, amount: 300, date: '2026-11-07', desc: 'كهرباء' }] });
                }
                if (url.includes('/api/settings/main_settings')) {
                    return json({ currency: 'SAR' });
                }
                return json({ error: 'NOT_FOUND', message: 'مسار غير معروف' }, 404);
            }),
        );

        renderScreen();

        expect(await screen.findByText('إيراد الشهر')).toBeTruthy();
        expect(screen.getAllByText('50,000.00 SAR').length).toBeGreaterThan(0);
        expect(screen.getByText('42.0%')).toBeTruthy();
        expect(screen.getByText('مبيعات')).toBeTruthy();
        expect(screen.getByText('كهرباء')).toBeTruthy();
    });

    it('تصفية الحركات بنص البحث من الواجهة الأمامية', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async (input: RequestInfo | URL) => {
                const url = typeof input === 'string' ? input : input.toString();
                if (url.includes('/api/finance/pnl')) {
                    return json({
                        statement: {
                            revenue: { total: 50000, invoice_count: 400 },
                            cogs: { net: 18000 },
                            operating: { total: 6000, count: 9 },
                            net_profit: { amount: 21000, margin_pct: 42 },
                        },
                    });
                }
                if (url.includes('/api/revenues')) {
                    return json({
                        data: [
                            { id: 1, amount: 1200, date: '2026-11-07', source: 'مبيعات' },
                            { id: 2, amount: 800, date: '2026-11-06', source: 'تحويل' },
                        ],
                    });
                }
                if (url.includes('/api/expenses')) {
                    return json({
                        data: [
                            { id: 3, amount: 300, date: '2026-11-07', desc: 'كهرباء', category: 'تشغيل' },
                            { id: 4, amount: 200, date: '2026-11-07', desc: 'ماء', category: 'تشغيل' },
                        ],
                    });
                }
                if (url.includes('/api/settings/main_settings')) {
                    return json({ currency: 'SAR' });
                }
                return json({ error: 'NOT_FOUND', message: 'مسار غير معروف' }, 404);
            }),
        );

        const { router } = renderScreen();

        await screen.findByText('كهرباء');
        await screen.findByText('ماء');
        const search = screen.getByTestId('accountant-filter-bar');
        fireEvent.input(search, { target: { value: 'كهرباء' } });

        await screen.findByText('كهرباء');
        expect(screen.queryByText('ماء')).toBeNull();
        expect(router.state.location.search.q).toBe('كهرباء');
    });

    it('تصفية الحركات بنطاق التاريخ من الواجهة الأمامية', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async (input: RequestInfo | URL) => {
                const url = typeof input === 'string' ? input : input.toString();
                if (url.includes('/api/finance/pnl')) {
                    return json({
                        statement: {
                            revenue: { total: 50000, invoice_count: 400 },
                            cogs: { net: 18000 },
                            operating: { total: 6000, count: 9 },
                            net_profit: { amount: 21000, margin_pct: 42 },
                        },
                    });
                }
                if (url.includes('/api/revenues')) {
                    return json({
                        data: [
                            { id: 1, amount: 1200, date: '2026-11-07', source: 'مبيعات' },
                            { id: 2, amount: 800, date: '2026-11-01', source: 'تحويل' },
                        ],
                    });
                }
                if (url.includes('/api/expenses')) {
                    return json({
                        data: [{ id: 3, amount: 300, date: '2026-11-07', desc: 'كهرباء', category: 'تشغيل' }],
                    });
                }
                if (url.includes('/api/settings/main_settings')) {
                    return json({ currency: 'SAR' });
                }
                return json({ error: 'NOT_FOUND', message: 'مسار غير معروف' }, 404);
            }),
        );

        const { router } = renderScreen();

        await screen.findByText('كهرباء');
        await screen.findByText('تحويل');

        const fromInput = screen.getByTestId('range-from');
        fireEvent.input(fromInput, { target: { value: '2026-11-07' } });

        const toInput = screen.getByTestId('range-to');
        fireEvent.input(toInput, { target: { value: '2026-11-07' } });

        const applyBtn = screen.getByTestId('range-apply');
        await applyBtn.click();

        await screen.findByText('كهرباء');
        expect(screen.queryByText('تحويل')).toBeNull();
        expect(router.state.location.search).toMatchObject({ from: '2026-11-07', to: '2026-11-07' });
    });

    it('تستعيد المرشّحات من رابط قابل للمشاركة', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async (input: RequestInfo | URL) => {
                const url = typeof input === 'string' ? input : input.toString();
                if (url.includes('/api/finance/pnl')) {
                    return json({ statement: { revenue: {}, cogs: {}, operating: {}, net_profit: {} } });
                }
                if (url.includes('/api/revenues')) {
                    return json({
                        data: [
                            { id: 1, amount: 1200, date: '2026-11-07', source: 'مبيعات' },
                            { id: 2, amount: 800, date: '2026-11-01', source: 'تحويل' },
                        ],
                    });
                }
                if (url.includes('/api/expenses')) {
                    return json({ data: [] });
                }
                if (url.includes('/api/settings/main_settings')) {
                    return json({ currency: 'SAR' });
                }
                return json({ error: 'NOT_FOUND', message: 'مسار غير معروف' }, 404);
            }),
        );

        renderScreen('/accountant-dashboard?from=2026-11-07&to=2026-11-07&q=%D9%85%D8%A8%D9%8A%D8%B9%D8%A7%D8%AA');

        expect(((await screen.findByTestId('range-from')) as HTMLInputElement).value).toBe('2026-11-07');
        expect((screen.getByTestId('accountant-filter-bar') as HTMLInputElement).value).toBe('مبيعات');
        expect(await screen.findByText('مبيعات')).toBeTruthy();
        expect(screen.queryByText('تحويل')).toBeNull();
    });
});
