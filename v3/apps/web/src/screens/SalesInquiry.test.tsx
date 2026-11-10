import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../ui/Toast';
import { SalesInquiry } from './SalesInquiry';

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
                <SalesInquiry />
            </ToastProvider>
        </QueryClientProvider>,
    );
}

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('استعلام المبيعات', () => {
    it('يعرض صفحة الأوردرات مع العدد الكلي من الخادم', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async (input: RequestInfo | URL) => {
                const url = typeof input === 'string' ? input : input.toString();
                if (url.includes('/api/yara-reports/orders')) {
                    return json({
                        ok: true,
                        from: '2026-11-07',
                        to: '2026-11-07',
                        total: 137,
                        limit: 50,
                        offset: 0,
                        orders: [
                            {
                                doc_no: 5150,
                                cashier_no: '101',
                                cashier_name: 'سالم',
                                doc_date: '2026-11-07',
                                doc_time: '13:45',
                                net: 230,
                                vat: 30,
                                discount: 5,
                                payed: 230,
                                table_name: 'A1',
                                zone_name: 'الصالة',
                                lines_count: 4,
                            },
                        ],
                    });
                }
                return json({ error: 'NOT_FOUND', message: 'مسار غير معروف' }, 404);
            }),
        );

        renderScreen();

        expect(await screen.findByText('أوامر مطابقة')).toBeTruthy();
        expect(screen.getByText('137')).toBeTruthy();
        expect(screen.getByText('5150')).toBeTruthy();
        expect(screen.getAllByText('سالم').length).toBeGreaterThan(0);
    });
});
