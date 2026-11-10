import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../ui/Toast';
import { CostAnalysis } from './CostAnalysis';

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
                <CostAnalysis />
            </ToastProvider>
        </QueryClientProvider>,
    );
}

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('تحليل التكاليف', () => {
    it('يعرض مجاميع الخادم وتكلفة كل قسم كما وردت', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async (input: RequestInfo | URL) => {
                const url = typeof input === 'string' ? input : input.toString();
                if (url.includes('/api/finance/cost-analysis')) {
                    return json({
                        rows: [
                            {
                                code: 'KITCHEN',
                                name: 'المطبخ',
                                rev: 40000,
                                exp: 12000,
                                profit: 28000,
                                costRatio: 30,
                                materials: 9000,
                                transfers: 1000,
                                countAdj: 500,
                                operating: 1500,
                                channel: false,
                            },
                            {
                                code: 'SALES',
                                name: 'المبيعات',
                                rev: 60000,
                                exp: 0,
                                profit: 60000,
                                costRatio: 0,
                                channel: true,
                            },
                        ],
                        totals: { rev: 100000, mat: 9000, trn: 1000, cnt: 500, ops: 1500, exp: 12000, avgCost: 12 },
                        period: { from: '2026-11-01', to: '2026-11-07' },
                    });
                }
                return json({ error: 'NOT_FOUND', message: 'مسار غير معروف' }, 404);
            }),
        );

        renderScreen();

        expect(await screen.findByText('إجمالي التكلفة')).toBeTruthy();
        expect(screen.getAllByText('12,000.00 SAR').length).toBeGreaterThan(0);
        expect(screen.getByText('12.0%')).toBeTruthy();
        expect(screen.getAllByText('المطبخ').length).toBeGreaterThan(0);
        expect(screen.getAllByText('30.0%').length).toBeGreaterThan(0);
    });
});
