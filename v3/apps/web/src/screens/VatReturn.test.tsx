import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../ui/Toast';
import { VatReturn } from './VatReturn';

const mocks = vi.hoisted(() => ({
    role: 'admin',
    fetchVatReturn: vi.fn(),
    fetchVatSettlementPreview: vi.fn(),
    applyVatSettlement: vi.fn(),
    fetchCurrency: vi.fn(),
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

vi.mock('../lib/finance', async (importOriginal) => {
    const original = await importOriginal<typeof import('../lib/finance')>();
    return { ...original, fetchCurrency: mocks.fetchCurrency };
});

vi.mock('../lib/vat-return', async (importOriginal) => {
    const original = await importOriginal<typeof import('../lib/vat-return')>();
    return {
        ...original,
        fetchVatReturn: mocks.fetchVatReturn,
        fetchVatSettlementPreview: mocks.fetchVatSettlementPreview,
        applyVatSettlement: mocks.applyVatSettlement,
    };
});

vi.mock('../components/PrintActions', () => ({ PrintActions: () => null }));

const report = {
    from: '2026-10-01',
    to: '2026-10-31',
    output_vat: 30,
    output_vat_reversals: 5,
    input_vat: 12,
    input_vat_adjustments: 2,
    net_payable: 15,
    carry_forward_credit: 0,
    payable_balance: 25,
    recoverable_balance: 10,
    unclassified_vat_movements: { output_debits: 4, input_credits: 1 },
    purchases_crosscheck: { count: 1, net: 80, vat: 12 },
};

const settlement = {
    month: '2026-10',
    from: '2026-10-01',
    to: '2026-10-31',
    output_vat: 30,
    input_vat: 12,
    net_payable: 15,
    payable_balance: 25,
    recoverable_balance: 10,
    clearing: 10,
    net_payable_after: 15,
    carry_forward_after: 0,
    lines: [
        { account_code: '2100', debit: 10, credit: 0, memo: 'تصفية ضريبة مخرجات مقابل مدخلات' },
        { account_code: '1150', debit: 0, credit: 10, memo: 'تصفية ضريبة مدخلات' },
    ],
    settled: null,
    applied: false,
    preview: true,
};

function renderScreen() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
        <QueryClientProvider client={client}>
            <ToastProvider>
                <VatReturn />
            </ToastProvider>
        </QueryClientProvider>,
    );
}

/** يختار شهر تصفية منتهٍ — يزامن فترة المراجعة معه ويطلق المعاينة. */
async function pickSettlementMonth(month = '2026-10') {
    const input = screen.getByLabelText('شهر التصفية') as HTMLInputElement;
    fireEvent.change(input, { target: { value: month } });
    await waitFor(() => {
        expect(mocks.fetchVatSettlementPreview).toHaveBeenCalled();
    });
}

describe('مسودة مراجعة ضريبة القيمة المضافة', () => {
    beforeEach(() => {
        mocks.role = 'admin';
        mocks.fetchVatReturn.mockResolvedValue(report);
        mocks.fetchVatSettlementPreview.mockResolvedValue(settlement);
        mocks.applyVatSettlement.mockResolvedValue({ ...settlement, applied: true, preview: false });
        mocks.fetchCurrency.mockResolvedValue('SAR');
    });

    it('تعرض فترة المراجعة وتنبه للحركات الضريبية غير المصنفة', async () => {
        renderScreen();

        expect(
            await screen.findByRole('heading', {
                name: /مسودة مراجعة ضريبة القيمة المضافة/,
            }),
        ).toBeTruthy();
        expect(await screen.findByText('مطابقة فواتير الشراء')).toBeTruthy();
        expect(screen.getByRole('alert').textContent).toContain('غير مصنّفة');
    });

    it('تعرض ورقة الطباعة والتصدير كإجراءات مراجعة', async () => {
        renderScreen();

        expect(await screen.findByRole('button', { name: 'طباعة ورقة المراجعة' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'تصدير CSV' })).toBeTruthy();
    });

    it('تعاين خطة التصفية تلقائيًا عند اختيار شهر كامل', async () => {
        renderScreen();
        await screen.findByText('مطابقة فواتير الشراء');

        await pickSettlementMonth();

        expect(mocks.fetchVatSettlementPreview).toHaveBeenCalledWith('2026-10', expect.anything());
        expect(await screen.findByText('قيمة التصفية')).toBeTruthy();
        expect(screen.getByText('تصفية ضريبة مخرجات مقابل مدخلات')).toBeTruthy();
    });

    it('يطلب تأكيدًا قبل ترحيل التصفية ثم يرحّل الشهر', async () => {
        renderScreen();
        await screen.findByText('مطابقة فواتير الشراء');
        await pickSettlementMonth();

        fireEvent.click(await screen.findByRole('button', { name: 'ترحيل التصفية' }));

        const dialog = await screen.findByRole('dialog');
        expect(dialog.textContent).toContain('2026-10');
        expect(mocks.applyVatSettlement).not.toHaveBeenCalled();

        fireEvent.click(screen.getByRole('button', { name: 'ترحيل القيد' }));

        await waitFor(() => {
            expect(mocks.applyVatSettlement).toHaveBeenCalledWith('2026-10');
        });
    });

    it('لا تعرض معاينة التصفية لدور بلا صلاحية ترحيل', async () => {
        mocks.role = 'auditor';
        renderScreen();
        await screen.findByText('مطابقة فواتير الشراء');

        expect(screen.getByText('الترحيل متاح لأدمن والمحاسب فقط.')).toBeTruthy();
        expect(mocks.fetchVatSettlementPreview).not.toHaveBeenCalled();
    });
});
