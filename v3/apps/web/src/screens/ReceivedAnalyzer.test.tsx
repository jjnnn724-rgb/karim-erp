import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../ui/Toast';
import { ReceivedAnalyzer } from './ReceivedAnalyzer';

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
                <ReceivedAnalyzer />
            </ToastProvider>
        </QueryClientProvider>,
    );
}

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('تحليل المستلَم', () => {
    it('يعرض بنود الاستلام وأذونها بحالة كل إذن', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async (input: RequestInfo | URL) => {
                const url = typeof input === 'string' ? input : input.toString();
                if (url.includes('/api/yara-reports/received-items')) {
                    return json({
                        rows: [{ name: 'طماطم', depts: 'المطبخ', qty: 50, approved_qty: 48, variance_qty: 2 }],
                        count: 1,
                    });
                }
                if (url.includes('/api/yara-reports/received-dispatches')) {
                    return json({
                        rows: [
                            {
                                id: 'D-15',
                                dept_code: 'KITCHEN',
                                dept_name: 'المطبخ',
                                date: '2026-11-06',
                                status: 'received',
                                items_count: 3,
                                total_qty: 20,
                            },
                        ],
                    });
                }
                return json({ error: 'NOT_FOUND', message: 'مسار غير معروف' }, 404);
            }),
        );

        renderScreen();

        expect(await screen.findByText('بنود المستلَم')).toBeTruthy();
        expect(screen.getByText('طماطم')).toBeTruthy();
        expect(screen.getAllByText('المطبخ').length).toBeGreaterThan(0);
        expect(screen.getAllByText('مستلم').length).toBeGreaterThan(0);
    });
});
