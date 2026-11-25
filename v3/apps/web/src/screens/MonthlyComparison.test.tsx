import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../ui/Toast';
import { MonthlyComparison } from './MonthlyComparison';

function json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

function renderScreen() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
        <QueryClientProvider client={client}>
            <ToastProvider>
                <MonthlyComparison />
            </ToastProvider>
        </QueryClientProvider>,
    );
}

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('المقارنة الشهرية', () => {
    it('تعرض الشهور كما وردت مع صافي وهامش الخادم', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async (input: RequestInfo | URL) => {
                const url = typeof input === 'string' ? input : input.toString();
                if (url.includes('/api/finance/monthly-comparison')) {
                    return json({
                        period: { months: 12 },
                        months: [
                            { month: '2026-10', revenue: 90000, cost: 50000, net_profit: 40000, margin_pct: 44.4 },
                            { month: '2026-11', revenue: 100000, cost: 55000, net_profit: 45000, margin_pct: 45 },
                        ],
                        totals: { revenue: 190000, cost: 105000, net_profit: 85000, margin_pct: 44.7 },
                    });
                }
                return json({ error: 'NOT_FOUND', message: 'مسار غير معروف' }, 404);
            }),
        );

        renderScreen();

        expect((await screen.findAllByText('2026-11')).length).toBeGreaterThan(0);
        expect(screen.getAllByText('100,000.00 SAR').length).toBeGreaterThan(0);
        expect(screen.getAllByText('45.0%').length).toBeGreaterThan(0);
        expect(screen.getAllByText('190,000.00 SAR').length).toBeGreaterThan(0);
    });
});
