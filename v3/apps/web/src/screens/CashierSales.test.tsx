import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, fireEvent } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../ui/Toast';
import { CashierSales } from './CashierSales';

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
                <CashierSales />
            </ToastProvider>
        </QueryClientProvider>,
    );
}

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('مبيعات الكاشير', () => {
    it('تعرض المحصّل والكاشيريات وطرق الدفع وأعلى الأصناف', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async (input: RequestInfo | URL) => {
                const url = typeof input === 'string' ? input : input.toString();
                if (url.includes('/api/cashier-sales/summary')) {
                    return json({
                        currency: 'SAR',
                        totals: {
                            docs: 120,
                            collected: 48000,
                            ex_vat: 41739.13,
                            vat: 6260.87,
                            discount: 500,
                            days: 7,
                            cashiers: 2,
                            avg_invoice: 400,
                            avg_day: 6857.14,
                            delta: 12.5,
                        },
                        series: [{ day: '2026-11-07', docs: 20, collected: 8000, ex_vat: 6956.52 }],
                        cashiers: [
                            { cashier_no: '101', cashier_name: 'سالم', docs: 70, collected: 30000, share: 62.5 },
                        ],
                        payments: [{ key: 'cash', label: 'نقد', amount: 20000, share: 41.67 }],
                        top_items: [{ code: 'SKU1', name: 'برجر', qty: 40, ex_vat: 6000, docs: 30, share: 14.4 }],
                    });
                }
                return json({ error: 'NOT_FOUND', message: 'مسار غير معروف' }, 404);
            }),
        );

        renderScreen();

        expect((await screen.findAllByText('المحصّل')).length).toBeGreaterThan(0);
        expect(screen.getAllByText('48,000.00 SAR').length).toBeGreaterThan(0);
        expect(screen.getByText('مقابل الفترة السابقة +12.5%')).toBeTruthy();
        expect(screen.getByText('سالم')).toBeTruthy();
        expect(screen.getAllByText('نقد').length).toBeGreaterThan(0);
        expect(screen.getByText('برجر')).toBeTruthy();
    });

    it('تصفية الكاشيريات بنص البحث من الواجهة الأمامية', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async (input: RequestInfo | URL) => {
                const url = typeof input === 'string' ? input : input.toString();
                if (url.includes('/api/cashier-sales/summary')) {
                    return json({
                        currency: 'SAR',
                        totals: {
                            docs: 120,
                            collected: 48000,
                            ex_vat: 41739.13,
                            vat: 6260.87,
                            discount: 500,
                            days: 7,
                            cashiers: 2,
                            avg_invoice: 400,
                            avg_day: 6857.14,
                            delta: 12.5,
                        },
                        series: [{ day: '2026-11-07', docs: 20, collected: 8000, ex_vat: 6956.52 }],
                        cashiers: [
                            { cashier_no: '101', cashier_name: 'سالم', docs: 70, collected: 30000, share: 62.5 },
                            { cashier_no: '102', cashier_name: 'علي', docs: 50, collected: 18000, share: 37.5 },
                        ],
                        payments: [{ key: 'cash', label: 'نقد', amount: 20000, share: 41.67 }],
                        top_items: [{ code: 'SKU1', name: 'برجر', qty: 40, ex_vat: 6000, docs: 30, share: 14.4 }],
                    });
                }
                return json({ error: 'NOT_FOUND', message: 'مسار غير معروف' }, 404);
            }),
        );

        renderScreen();

        await screen.findByText('سالم');
        await screen.findByText('علي');

        const search = screen.getByTestId('cashier-filter-bar');
        fireEvent.input(search, { target: { value: 'علي' } });

        await screen.findByText('علي');
        expect(screen.queryByText('سالم')).toBeNull();
    });
});
