import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../ui/Toast';
import { BankReconciliation } from './BankReconciliation';

const mocks = vi.hoisted(() => ({ role: 'admin' }));

vi.mock('../lib/auth', () => ({
    getAccessToken: () => 'test-token',
    getAppKey: () => null,
    useAuthState: () => ({
        status: 'authenticated',
        token: 'test-token',
        user: { id: '1', name: 'محاسب اختبار', username: 'test', role: mocks.role },
    }),
}));

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
                <BankReconciliation />
            </ToastProvider>
        </QueryClientProvider>,
    );
}

const bankRec = {
    account: '1010',
    from: '2026-10-01',
    to: '2026-10-31',
    book: 5000,
    statement: 4800,
    diff: -200,
    unmatched: [{ id: 1, account_code: '1010', stmt_date: '2026-10-05', description: 'تحويل وارد', amount: 200, matched: false }],
};

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('مطابقة البنك', () => {
    beforeEach(() => {
        mocks.role = 'admin';
    });

    it('يعرض الفرق والحركات غير المطابقة، والمطابقة الآلية تستدعي المسار الكتابي', async () => {
        const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
            const url = typeof input === 'string' ? input : input.toString();
            if (url.includes('/api/accounting/bank-rec/auto-match')) {
                return json({ ok: true, matched: 1, scanned: 1 });
            }
            if (url.includes('/api/accounting/bank-rec')) {
                return json(bankRec);
            }
            return json({ error: 'NOT_FOUND', message: 'مسار غير معروف' }, 404);
        });
        vi.stubGlobal('fetch', fetchMock);

        renderScreen();

        expect(await screen.findByText('الفرق (كشف − دفتر)')).toBeTruthy();
        expect(await screen.findByText('تحويل وارد')).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: 'مطابقة تلقائية' }));

        await waitFor(() => {
            expect(fetchMock.mock.calls.some((call) => String(call[0]).includes('auto-match'))).toBe(true);
        });
    });

    it('لا تعرض المطابقة الآلية لدور بلا صلاحية كتابة', async () => {
        mocks.role = 'auditor';
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => json(bankRec)),
        );

        renderScreen();

        expect(await screen.findByText('الفرق (كشف − دفتر)')).toBeTruthy();
        expect(screen.queryByRole('button', { name: 'مطابقة تلقائية' })).toBeNull();
    });
});
