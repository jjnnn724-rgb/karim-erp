import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../ui/Toast';
import { Reports } from './Reports';

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
                <Reports />
            </ToastProvider>
        </QueryClientProvider>,
    );
}

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('تقرير مبيعات نقطة البيع', () => {
    it('يعرض بيان الفترة وصفوف الأقسام كما وردت', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async (input: RequestInfo | URL) => {
                const url = typeof input === 'string' ? input : input.toString();
                if (url.includes('/api/pos/reports/sales')) {
                    return json({
                        start_date: '2026-11-01',
                        end_date: '2026-11-07',
                        group_by: url.includes('group_by=cashier') ? 'cashier' : 'department',
                        filters: { department_id: null, cashier_id: null },
                        summary: {
                            invoice_count: 250,
                            net_sales: 57500,
                            subtotal_sales: 50000,
                            discount_total: 1200,
                            tax_total: 7500,
                            items_qty: 610,
                            unique_items: 42,
                            avg_ticket: 230,
                            payment_methods: { cash: 30000, card: 27500 },
                        },
                        rows: [
                            {
                                department_name: 'المشويات',
                                invoice_count: 150,
                                subtotal_sales: 32000,
                                discount_total: 700,
                                tax_total: 4800,
                                net_sales: 36800,
                                items_qty: 400,
                            },
                        ],
                    });
                }
                return json({ error: 'NOT_FOUND', message: 'مسار غير معروف' }, 404);
            }),
        );

        renderScreen();

        expect(await screen.findByText('صافي المبيعات')).toBeTruthy();
        expect(screen.getAllByText('57,500.00 SAR').length).toBeGreaterThan(0);
        expect(screen.getByText('المشويات')).toBeTruthy();
        expect(screen.getAllByText('36,800.00 SAR').length).toBeGreaterThan(0);
        expect(screen.getByText('نقد')).toBeTruthy();
    });
});
