import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../ui/Toast';
import { WhVsPos } from './WhVsPos';

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
                <WhVsPos />
            </ToastProvider>
        </QueryClientProvider>,
    );
}

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('مقارنة المخزن بنقطة البيع', () => {
    it('تميّز المطابق من صاحب الفرق وتعرض حالة الخادم', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async (input: RequestInfo | URL) => {
                const url = typeof input === 'string' ? input : input.toString();
                if (url.includes('/api/yara-reports/wh-vs-pos')) {
                    return json({
                        liveSynced: true,
                        lastSyncAt: '2026-11-07 14:30',
                        rows: [
                            {
                                name: 'أرز',
                                dept: 'المطبخ',
                                wh_qty: 20,
                                pos_qty: 20,
                                diff: 0,
                                pct: 0,
                                status: 'match',
                                pos_net: 500,
                            },
                            {
                                name: 'زيت',
                                dept: 'المطبخ',
                                wh_qty: 10,
                                pos_qty: 7,
                                diff: 3,
                                pct: 30,
                                status: 'over',
                                pos_net: 300,
                            },
                        ],
                    });
                }
                return json({ error: 'NOT_FOUND', message: 'مسار غير معروف' }, 404);
            }),
        );

        renderScreen();

        expect(await screen.findByText('أصناف مقارنة')).toBeTruthy();
        expect(screen.getByText('أرز')).toBeTruthy();
        expect(screen.getByText('زيت')).toBeTruthy();
        expect(screen.getByText('مطابق')).toBeTruthy();
        expect(screen.getByText('زائد')).toBeTruthy();
        expect(screen.getByText('30.0%')).toBeTruthy();
    });
});
