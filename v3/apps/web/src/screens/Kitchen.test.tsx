import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../ui/Toast';
import { Kitchen } from './Kitchen';

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
                <Kitchen />
            </ToastProvider>
        </QueryClientProvider>,
    );
}

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('المطبخ', () => {
    it('يعرض الأوامر والاستثناءات والتوزيعات وملاحظة النافذة', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async (input: RequestInfo | URL) => {
                const url = typeof input === 'string' ? input : input.toString();
                if (url.includes('/api/kitchen/overview')) {
                    return json({
                        locations: [{ id: 'KITCHEN-MAIN' }],
                        batches: [
                            {
                                id: 1,
                                product_name: 'شوربة',
                                product_unit: 'لتر',
                                location_name: 'المطبخ الرئيسي',
                                planned_qty: 50,
                                produced_qty: 40,
                                remaining_qty: 10,
                                status: 'open',
                            },
                            {
                                id: 2,
                                product_name: 'سلطة',
                                product_unit: 'كجم',
                                planned_qty: 20,
                                produced_qty: 20,
                                remaining_qty: 0,
                                status: 'closed',
                            },
                        ],
                        exceptions: [
                            {
                                id: 11,
                                product_name: 'شوربة',
                                quantity: 3,
                                operation_mode: 'strict',
                                reason: 'صرف زائد',
                                department_name: 'المطبخ',
                            },
                        ],
                        policies: [{ department_id: 1, operation_mode: 'flexible' }],
                        distributions: [
                            { id: 21, product_name: 'شوربة', department_name: 'الصالة', quantity: 25 },
                            { id: 22, product_name: 'شوربة', department_name: 'المشويات', quantity: 5 },
                        ],
                    });
                }
                return json({ error: 'NOT_FOUND', message: 'مسار غير معروف' }, 404);
            }),
        );

        renderScreen();

        expect(await screen.findByText('أوامر مفتوحة')).toBeTruthy();
        expect(screen.getAllByText('شوربة').length).toBeGreaterThan(0);
        expect(screen.getAllByText('50 / 40').length).toBeGreaterThan(0);
        expect(screen.getByText(/صرف زائد/)).toBeTruthy();
        expect(screen.getByText('صارم')).toBeTruthy();
        expect(screen.queryByText(/نافذة مقصوصة/)).toBeNull();
    });
});
