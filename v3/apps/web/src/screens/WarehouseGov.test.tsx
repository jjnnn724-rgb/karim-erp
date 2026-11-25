import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FiscalYear, OpeningInvoice } from '../lib/warehouse-gov';
import { WarehouseGov } from './WarehouseGov';

const mocks = vi.hoisted(() => ({
    role: 'accountant',
    fetchFiscalYears: vi.fn(),
    fetchOpeningBalanceReport: vi.fn(),
    fetchSystemHealth: vi.fn(),
    fetchCurrency: vi.fn(),
    createFiscalYear: vi.fn(),
    closeFiscalYear: vi.fn(),
    createNextFiscalYear: vi.fn(),
}));

vi.mock('../lib/auth', () => ({
    getAccessToken: () => 'test-token',
    getAppKey: () => null,
    useAuthState: () => ({
        status: 'authenticated',
        token: 'test-token',
        user: { id: '1', name: 'مستخدم اختبار', username: 'test', role: mocks.role },
    }),
}));

vi.mock('../lib/finance', () => ({
    fetchCurrency: mocks.fetchCurrency,
}));

vi.mock('../lib/warehouse-gov', async (importOriginal) => {
    const original = await importOriginal<typeof import('../lib/warehouse-gov')>();
    return {
        ...original,
        fetchFiscalYears: mocks.fetchFiscalYears,
        fetchOpeningBalanceReport: mocks.fetchOpeningBalanceReport,
        fetchSystemHealth: mocks.fetchSystemHealth,
        createFiscalYear: mocks.createFiscalYear,
        closeFiscalYear: mocks.closeFiscalYear,
        createNextFiscalYear: mocks.createNextFiscalYear,
    };
});

const closedYear: FiscalYear = {
    id: '5',
    yearCode: '2025',
    name: 'السنة المالية 2025',
    startDate: '2025-01-01',
    endDate: '2025-12-31',
    status: 'closed',
    closedAt: '2026-01-01',
    closedBy: '1',
    openingCount: 3,
    snapshot: {
        revenueCount: 2,
        revenueTotal: '125.50',
        expenseCount: 1,
        expenseTotal: '25.00',
        purchaseCount: 2,
        purchaseTotal: '10.00',
        netResult: '100.50',
        inventoryValue: '55.00',
        inventoryCount: 3,
    },
    hasSnapshot: true,
};

const openingInvoice: OpeningInvoice = {
    id: '9',
    number: 'OPEN-1',
    date: '2026-01-01',
    totalAmount: '20.00',
    notes: '',
    items: [
        {
            itemId: '4',
            name: 'أرز',
            qty: 5,
            unit: 'كجم',
            price: '4.00',
            category: 'غلال',
            packagingQty: null,
            currentQty: null,
            issuedSince: 2,
            itemExists: false,
        },
    ],
};

function renderScreen() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
        <QueryClientProvider client={client}>
            <WarehouseGov />
        </QueryClientProvider>,
    );
}

beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    mocks.role = 'accountant';
    mocks.fetchFiscalYears.mockResolvedValue([closedYear]);
    mocks.fetchOpeningBalanceReport.mockResolvedValue([openingInvoice]);
    mocks.fetchSystemHealth.mockResolvedValue({
        ok: false,
        itemsTotal: 10,
        consistent: 8,
        anomaliesCount: 4,
        zeroStock: 1,
        lowStock: 2,
        anomalies: [{ name: 'أرز', issue: 'عدم اتساق' }],
    });
    mocks.fetchCurrency.mockResolvedValue('SAR');
    mocks.createFiscalYear.mockResolvedValue(undefined);
    mocks.closeFiscalYear.mockResolvedValue(undefined);
    mocks.createNextFiscalYear.mockResolvedValue(undefined);
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe('حوكمة المخزن', () => {
    it('يعرض بطاقة السنة للمحاسب فقط بلا إظهار أزرار كتابة افتراضيًا', async () => {
        renderScreen();
        await screen.findByText('السنة المالية 2025');

        expect(screen.getByText(/125\.50/)).toBeTruthy();
        expect(screen.queryByRole('button', { name: 'سنة مالية جديدة' })).toBeNull();
        expect(screen.queryByRole('button', { name: 'السنة التالية' })).toBeNull();
        expect(mocks.fetchOpeningBalanceReport).not.toHaveBeenCalled();
        expect(mocks.fetchSystemHealth).not.toHaveBeenCalled();
    });

    it('يعرض تقرير الافتتاح للمخزن ولا يرسل طلبات بطاقات غير مسموحة', async () => {
        mocks.role = 'warehouse';
        renderScreen();

        expect(await screen.findByText('أرز')).toBeTruthy();
        expect(screen.getByText('20.00 SAR')).toBeTruthy();
        expect(mocks.fetchFiscalYears).not.toHaveBeenCalled();
        expect(mocks.fetchSystemHealth).not.toHaveBeenCalled();
    });

    it('يفتح الكتابة فقط مع الدور والعلم، وينشئ سنة بحمولة مطبّعة', async () => {
        mocks.role = 'admin';
        window.localStorage.setItem('karim_v2_fiscal_write', '1');
        renderScreen();
        await screen.findByText('السنة المالية 2025');

        fireEvent.click(screen.getByRole('button', { name: 'سنة مالية جديدة' }));
        fireEvent.change(screen.getByLabelText('تاريخ البداية'), { target: { value: '2026-01-01' } });
        fireEvent.change(screen.getByLabelText('تاريخ النهاية'), { target: { value: '2026-12-31' } });
        fireEvent.click(screen.getByRole('button', { name: 'حفظ السنة المالية' }));

        await waitFor(() => expect(mocks.createFiscalYear).toHaveBeenCalledOnce());
        expect(mocks.createFiscalYear.mock.calls[0]?.[0]).toMatchObject({
            startDate: '2026-01-01',
            endDate: '2026-12-31',
            yearCode: '2026',
            name: 'السنة المالية 2026',
            notes: null,
        });
    });

    it('يتطلب تأكيدًا قبل إنشاء السنة التالية غير القابل للتراجع', async () => {
        mocks.role = 'admin';
        window.localStorage.setItem('karim_v2_fiscal_write', '1');
        vi.spyOn(window, 'confirm').mockReturnValue(true);
        renderScreen();
        await screen.findByText('السنة المالية 2025');
        fireEvent.click(screen.getByRole('button', { name: 'السنة التالية' }));

        await waitFor(() => expect(mocks.createNextFiscalYear).toHaveBeenCalledWith('5'));
        expect(window.confirm).toHaveBeenCalled();
    });
});
