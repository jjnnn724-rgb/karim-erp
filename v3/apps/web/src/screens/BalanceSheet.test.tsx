import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../ui/Toast';
import { BalanceSheet } from './BalanceSheet';

const mocks = vi.hoisted(() => ({
    role: 'admin',
    fetchBalanceSheet: vi.fn(),
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

vi.mock('../lib/balance-sheet', async (importOriginal) => {
    const original = await importOriginal<typeof import('../lib/balance-sheet')>();
    return { ...original, fetchBalanceSheet: mocks.fetchBalanceSheet };
});

vi.mock('../components/PrintActions', () => ({ PrintActions: () => null }));

const report = {
    statement: 'BALANCE_SHEET',
    as_of_date: '2026-10-31',
    currency: 'SAR',
    assets: {
        current_assets: [{ code: '1101', name_ar: 'النقد', type: 'asset', balance: 1000 }],
        non_current_assets: [],
        total_assets: 1000,
    },
    liabilities: {
        current_liabilities: [{ code: '2101', name_ar: 'موردون', type: 'liability', balance: 400 }],
        non_current_liabilities: [],
        total_liabilities: 400,
    },
    equity: {
        capital_and_reserves: [{ code: '3101', name_ar: 'رأس المال', type: 'equity', balance: 300 }],
        current_period_net_income: 300,
        total_equity: 600,
    },
    reconciliation: { total_assets: 1000, total_liabilities_and_equity: 1000, variance: 0, balanced: true },
};

function renderScreen() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
        <QueryClientProvider client={client}>
            <ToastProvider>
                <BalanceSheet />
            </ToastProvider>
        </QueryClientProvider>,
    );
}

describe('قائمة المركز المالي', () => {
    beforeEach(() => {
        mocks.role = 'admin';
        mocks.fetchBalanceSheet.mockResolvedValue(report);
    });

    it('تعرض الأصول والخصوم وحقوق الملكية مع مطابقة صفرية', async () => {
        renderScreen();

        expect(await screen.findByRole('heading', { name: /قائمة المركز المالي/ })).toBeTruthy();
        expect(await screen.findByText('النقد')).toBeTruthy();
        expect(screen.getAllByText('1,000.00 SAR').length).toBeGreaterThan(1);
        expect(screen.getByText('مطابقة تمامًا')).toBeTruthy();
    });
});
