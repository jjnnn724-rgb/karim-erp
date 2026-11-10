import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../ui/Toast';
import { InventoryInquiryPro } from './InventoryInquiryPro';

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
                <InventoryInquiryPro />
            </ToastProvider>
        </QueryClientProvider>,
    );
}

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('البطاقة الفاخرة', () => {
    it('تختار أول صنف وتفتح بطاقته', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async (input: RequestInfo | URL) => {
                const url = typeof input === 'string' ? input : input.toString();
                if (url.includes('/api/inventory-inquiry/items')) {
                    return json({
                        rows: [
                            { itemId: 11, itemName: 'دجاج', category: 'لحوم' },
                            { itemId: 12, itemName: 'أرز', category: 'مواد جافة' },
                        ],
                    });
                }
                if (url.includes('/api/inventory-inquiry/item/11')) {
                    return json({
                        item: { id: 11, name: 'دجاج', qty: 12, minQty: 5, avgCost: 80, stockValue: 960 },
                        cardex: [],
                        departments: [],
                        purchases: { qty: 0, cost: 0, invoices: [] },
                        batches: [],
                        sales: { pos: 0, net: 0, orders: 0, lines: [] },
                    });
                }
                return json({ error: 'NOT_FOUND', message: 'مسار غير معروف' }, 404);
            }),
        );

        renderScreen();

        expect(await screen.findByText('البطاقة الفاخرة')).toBeTruthy();
        expect(await screen.findByText('2 صنفًا في نتائج البحث')).toBeTruthy();
        expect(await screen.findByText('960.00 SAR')).toBeTruthy();
        expect(screen.getByText('Cardex')).toBeTruthy();
    });

    it('تبلغ عن فشل قائمة الأصناف بدل صمت', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => json({ error: 'DENIED', message: 'لا صلاحية' }, 500)),
        );

        renderScreen();

        expect(await screen.findByText(/لا صلاحية/)).toBeTruthy();
    });
});
