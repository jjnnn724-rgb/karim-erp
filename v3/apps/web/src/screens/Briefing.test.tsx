import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../ui/Toast';
import { Briefing } from './Briefing';

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
                <Briefing />
            </ToastProvider>
        </QueryClientProvider>,
    );
}

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('الموجز التنفيذي', () => {
    it('يعرض مؤشرات المبيعات والمصروفات والأقسام وطرق الدفع', async () => {
        const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
            const url = typeof input === 'string' ? input : input.toString();
            if (url.includes('/api/manager/briefing')) {
                return json({
                    day: '2026-11-07',
                    cashiers: [
                        { department_id: '1', department_name: 'المطبخ', total: 4500, count: 45 },
                        { department_id: '2', department_name: 'المشروبات', total: 1500, count: 30 },
                    ],
                    cashiersTotal: { total: 6000, count: 75 },
                    pos: { total: 6000, count: 75 },
                    expenses: { total: 1200 },
                    stockOut: [{ id: 101, name: 'طماطم' }],
                    stockLow: [],
                    payments: [
                        { method: 'نقدي', total: 3000 },
                        { method: 'شبكة مدى', total: 3000 },
                    ],
                });
            }
            if (url.includes('/api/pos/orders/stats/today')) {
                return json({
                    ok: true,
                    orders_count: 75,
                    total_sales: 6000,
                    avg_ticket: 80,
                });
            }
            return json({ error: 'NOT_FOUND' }, 404);
        });
        vi.stubGlobal('fetch', fetchMock);

        renderScreen();

        expect(await screen.findByText('المطبخ')).toBeTruthy();
        expect(screen.getByText('المشروبات')).toBeTruthy();
        expect(screen.getByText('شبكة مدى')).toBeTruthy();
        expect(screen.getByText(/يوجد 1 صنفًا نفد رصيدها بالكامل/)).toBeTruthy();
    });
});
