import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../ui/Toast';
import { CashFlow } from './CashFlow';

const mocks = vi.hoisted(() => ({
    role: 'admin',
    fetchCashFlow: vi.fn(),
}));

vi.mock('../lib/auth', () => ({
    getAccessToken: () => 'test-token',
    getAppKey: () => null,
    useAuthState: () => ({
        status: 'authenticated',
        token: 'test-token',
        user: { id: '1', name: 'محاسب اختبار', username: 'test', role: mocks.role },
    }),
}));

vi.mock('../lib/cash-flow', async (importOriginal) => {
    const original = await importOriginal<typeof import('../lib/cash-flow')>();
    return { ...original, fetchCashFlow: mocks.fetchCashFlow };
});

vi.mock('../components/PrintActions', () => ({ PrintActions: () => null }));

const report = {
    ok: true,
    from: '2026-10-01',
    to: '2026-10-31',
    opening: 100,
    inflow: 500,
    outflow: 300,
    opening_available: true,
    net: 200,
    closing: 300,
    byCounterparty: [{ account: '2100 موردون', net: -200 }],
};

function renderScreen() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
        <QueryClientProvider client={client}>
            <ToastProvider>
                <CashFlow />
            </ToastProvider>
        </QueryClientProvider>,
    );
}

describe('قائمة التدفقات النقدية', () => {
    beforeEach(() => {
        mocks.role = 'admin';
        mocks.fetchCashFlow.mockResolvedValue(report);
    });

    it('تعرض الافتتاح والمقبوضات/المدفوعات والصافي ورصيد الإقفال', async () => {
        renderScreen();

        expect(await screen.findByRole('heading', { name: /قائمة التدفقات النقدية/ })).toBeTruthy();
        expect(await screen.findByText('100.00 SAR')).toBeTruthy();
        expect(screen.getByText('500.00 SAR')).toBeTruthy();
        expect(screen.getByText('فائض في الفترة')).toBeTruthy();
        expect(screen.getByText(/رصيد النقدية حتى/)).toBeTruthy();
    });

    it('رصيد الافتتاح غير المتاح يُعرض «—» لا صفرًا', async () => {
        mocks.fetchCashFlow.mockResolvedValue({ ...report, opening_available: false });
        renderScreen();

        expect(await screen.findByText('تعذّر احتساب رصيد ما قبل الفترة')).toBeTruthy();
    });
});
