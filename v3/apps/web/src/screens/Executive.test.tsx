import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Executive } from './Executive';

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
            <Executive />
        </QueryClientProvider>,
    );
}

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('الموجز التنفيذي', () => {
    it('يعرض المؤشرات والسلسلة والأقسام والنقد والإنذارات', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async (input: RequestInfo | URL) => {
                const url = typeof input === 'string' ? input : input.toString();
                if (url.includes('/api/executive/summary')) {
                    return json({
                        day: '2026-11-07',
                        postedToday: 12,
                        kpi: {
                            revenue: 4500,
                            cogs: 1200,
                            net: 3100,
                            margin: 68.9,
                            cash: 9800.5,
                            openShifts: 2,
                            negativeStock: 3,
                        },
                        series: [
                            { day: '2026-11-06', revenue: 4000, cost: 1100, net: 2900 },
                            { day: '2026-11-07', revenue: 4500, cost: 1200, net: 3100 },
                        ],
                        topDepts: [{ name: 'المطبخ', total: 3000 }],
                        topItems: [{ name: 'شاورما', qty: 42, total: 1260 }],
                        cash: [{ code: '1010', name: 'الصندوق', balance: 9800.5 }],
                        alerts: [
                            {
                                severity: 'high',
                                title: 'إقفال اليوم متأخر',
                                detail: 'آخر إقفال قبل يومين',
                                action: { label: 'فتح', screen: 'cashier-monitor' },
                            },
                        ],
                    });
                }
                return json({ error: 'NOT_FOUND', message: 'مسار غير معروف' }, 404);
            }),
        );

        renderScreen();

        expect(await screen.findByText('إيراد اليوم')).toBeTruthy();
        expect(screen.getAllByText('4,500.00 SAR').length).toBeGreaterThan(0);
        expect(screen.getByText('68.9%')).toBeTruthy();
        expect(screen.getByText('شاورما')).toBeTruthy();
        expect(screen.getByText('المطبخ')).toBeTruthy();
        expect(screen.getByText('الصندوق')).toBeTruthy();
        expect(screen.getByText(/إقفال اليوم متأخر/)).toBeTruthy();
        expect(screen.getByText(/قيود اليوم: 12/)).toBeTruthy();
    });

    it('يعرض خطأ الجلب مع إعادة المحاولة', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => json({ error: 'EXEC_FAILED', message: 'تعذّر بناء الموجز' }, 500)),
        );

        renderScreen();

        expect(await screen.findByText('تعذّر بناء الموجز')).toBeTruthy();
        expect(screen.getByRole('button', { name: 'إعادة المحاولة' })).toBeTruthy();
    });
});
