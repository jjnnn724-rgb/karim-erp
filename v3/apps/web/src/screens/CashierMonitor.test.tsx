import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../ui/Toast';
import { CashierMonitor } from './CashierMonitor';

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
                <CashierMonitor />
            </ToastProvider>
        </QueryClientProvider>,
    );
}

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('متابعة الكاشير', () => {
    it('تعرض صندوق كل كاشير وأوردرات اليوم', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async (input: RequestInfo | URL) => {
                const url = typeof input === 'string' ? input : input.toString();
                if (url.includes('/api/cashier-monitor/summary')) {
                    return json({
                        date: '2026-11-07',
                        cashiers: [
                            {
                                cashier_no: '101',
                                cashier_name: 'سالم',
                                invoices: 12,
                                revenue: 4200,
                                pay_cash: 2000,
                                pay_network: 2200,
                                pay_credit: 0,
                                pay_mobile: 0,
                                open: 1,
                                avg: 350,
                                last_time: '14:32',
                            },
                        ],
                    });
                }
                if (url.includes('/api/cashier-monitor/orders')) {
                    return json({
                        ok: true,
                        date: '2026-11-07',
                        total: 1,
                        orders: [
                            {
                                doc_no: '9001',
                                doc_time: '14:32',
                                cashier_no: '101',
                                cashier_name: 'سالم',
                                net: 120,
                                vat: 15,
                                table_name: 'A3',
                                zone_name: 'الصالة',
                            },
                        ],
                    });
                }
                return json({ error: 'NOT_FOUND', message: 'مسار غير معروف' }, 404);
            }),
        );

        renderScreen();

        expect(await screen.findByText('كاشيريات اليوم')).toBeTruthy();
        expect(screen.getAllByText('سالم').length).toBeGreaterThan(0);
        expect(screen.getByText('9001')).toBeTruthy();
        expect(screen.getByText(/A3/)).toBeTruthy();
    });
});
