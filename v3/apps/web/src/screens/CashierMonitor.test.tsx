import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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

    it('تطبع فاتورة الأمر بمستند الخادم 80مم في نافذة الطباعة', async () => {
        const calledUrls: string[] = [];
        const written: string[] = [];
        const win = {
            document: {
                open: () => undefined,
                close: () => undefined,
                write: (chunk: string) => {
                    written.push(chunk);
                },
                title: '',
            },
            focus: () => undefined,
            print: vi.fn(),
            close: vi.fn(),
        };
        vi.spyOn(window, 'open').mockReturnValue(win as unknown as Window);
        vi.stubGlobal(
            'fetch',
            vi.fn(async (input: RequestInfo | URL) => {
                const url = typeof input === 'string' ? input : input.toString();
                calledUrls.push(url);
                if (url.includes('/api/cashier-monitor/summary')) {
                    return json({ date: '2026-11-07', cashiers: [] });
                }
                if (url.includes('/api/cashier-monitor/orders')) {
                    return json({
                        ok: true,
                        date: '2026-11-07',
                        total: 1,
                        orders: [{ doc_no: '9001', doc_time: '14:32', cashier_no: '101', net: 120, vat: 15 }],
                    });
                }
                if (url.includes('/api/cashier-sales/invoice/9001/html')) {
                    return new Response('<html><body>إيصال فاتورة 9001</body></html>', {
                        status: 200,
                        headers: { 'Content-Type': 'text/html' },
                    });
                }
                return json({ error: 'NOT_FOUND', message: 'مسار غير معروف' }, 404);
            }),
        );

        renderScreen();
        const button = await screen.findByRole('button', { name: 'طباعة فاتورة 9001' });
        fireEvent.click(button);

        await waitFor(() => {
            expect(win.print).toHaveBeenCalledTimes(1);
        });
        expect(calledUrls.some((url) => url.includes('/api/cashier-sales/invoice/9001/html'))).toBe(true);
        expect(written.join('')).toContain('إيصال فاتورة 9001');
    });
});
