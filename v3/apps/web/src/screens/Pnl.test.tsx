import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../ui/Toast';
import { Pnl } from './Pnl';

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
                <Pnl />
            </ToastProvider>
        </QueryClientProvider>,
    );
}

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('الأرباح والخسائر', () => {
    it('يعرض سطور البيان والأقسام والحركة اليومية من ردّ الخادم', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async (input: RequestInfo | URL) => {
                const url = typeof input === 'string' ? input : input.toString();
                if (url.includes('/api/finance/pnl')) {
                    return json({
                        period: { from: '2026-11-01', to: '2026-11-07' },
                        statement: {
                            revenue: { total: 10000, invoice_count: 120, manual_count: 3 },
                            cogs: { net: 4000, dispatch: 4100, returns: 100 },
                            gross_profit: { amount: 6000, margin_pct: 60 },
                            operating: { total: 1000, count: 4 },
                            payroll: { total: 2000, count: 1, months: ['2026-10'] },
                            shrinkage: { amount: 100, count: 2 },
                            net_profit: { amount: 2900, margin_pct: 29 },
                            by_department: [
                                {
                                    code: 'KITCHEN',
                                    name: 'المطبخ',
                                    revenue: 6000,
                                    net: 2000,
                                    margin_pct: 33.3,
                                    subDepartments: [{ code: 'SWEETS', name: 'الحلواني', revenue: 0, operating: 0, net: -500 }],
                                },
                                {
                                    code: 'SWEETS',
                                    name: 'الحلواني',
                                    revenue: 0,
                                    net: -500,
                                    margin_pct: null,
                                    rolledUp: true,
                                },
                            ],
                            daily_series: [{ date: '2026-11-07', revenue: 1500, cogs: 600, opex: 200 }],
                            checks: { balanced: true },
                        },
                    });
                }
                return json({ error: 'NOT_FOUND', message: 'مسار غير معروف' }, 404);
            }),
        );

        renderScreen();

        expect(await screen.findByText(/هامش صافي الربح: 29.0%/)).toBeTruthy();
        expect(screen.getAllByText('صافي الربح').length).toBeGreaterThan(0);
        expect(screen.getAllByText('2,900.00 SAR').length).toBeGreaterThan(0);
        expect(screen.getByText(/المطبخ/)).toBeTruthy();
        // الصف المرحّل إلى أبيه لا يُعرض مرتين
        expect(screen.queryByText('الحلواني')).toBeNull();
        expect(screen.getByText(/مع فروعه/)).toBeTruthy();
        expect(screen.getByText('2026-11-07')).toBeTruthy();
        expect(screen.getByText(/هامش صافي الربح: 29.0%/)).toBeTruthy();
        expect(screen.getByText(/متوازن/)).toBeTruthy();
    });

    it('يعرض خطأ الجلب مع إعادة المحاولة', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => json({ error: 'PNL_FAILED', message: 'تعذّر بناء القائمة' }, 500)),
        );

        renderScreen();

        expect(await screen.findByText('تعذّر بناء القائمة')).toBeTruthy();
        expect(screen.getByRole('button', { name: 'إعادة المحاولة' })).toBeTruthy();
    });
});
