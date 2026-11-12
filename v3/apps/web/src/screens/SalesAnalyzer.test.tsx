import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../ui/Toast';
import { SalesAnalyzer } from './SalesAnalyzer';

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
                <SalesAnalyzer />
            </ToastProvider>
        </QueryClientProvider>,
    );
}

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('تحليل مبيعات الأصناف', () => {
    it('يجمع الصفوف برمز الصنف ويعرض مجاميع الخادم', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async (input: RequestInfo | URL) => {
                const url = typeof input === 'string' ? input : input.toString();
                if (url.includes('/api/yara-reports/item-sales')) {
                    return json({
                        rows: [
                            {
                                item_code: 'SKU1',
                                item_name: 'برجر',
                                cashier_no: '101',
                                day: '2026-11-05',
                                invoices: 10,
                                qty: 20,
                                net: 1000,
                                vat: 150,
                            },
                            {
                                item_code: 'SKU1',
                                item_name: 'برجر',
                                cashier_no: '102',
                                day: '2026-11-06',
                                invoices: 5,
                                qty: 8,
                                net: 400,
                                vat: 60,
                            },
                        ],
                        totals: { invoices: 15, qty: 28, net: 1400, vat: 210 },
                    });
                }
                return json({ error: 'NOT_FOUND', message: 'مسار غير معروف' }, 404);
            }),
        );

        renderScreen();

        expect(await screen.findByText('صافي المبيعات')).toBeTruthy();
        expect(screen.getAllByText('1,400.00 SAR').length).toBeGreaterThan(0);
        expect(screen.getAllByText('برجر').length).toBeGreaterThan(0);
        expect(screen.getByText('1 صنفًا مختلفًا')).toBeTruthy();
    });
});
