import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchComplianceDashboard, fetchGosiMonth, fetchVatStatus, submitBankMatches } from '../lib/financial-compliance';
import { FinancialCompliance } from './FinancialCompliance';

vi.mock('../lib/financial-compliance', () => ({
    fetchComplianceDashboard: vi.fn(),
    fetchGosiMonth: vi.fn(),
    fetchVatStatus: vi.fn(),
    submitBankMatches: vi.fn(),
}));

function renderScreen() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
        <QueryClientProvider client={client}>
            <FinancialCompliance />
        </QueryClientProvider>,
    );
}

describe('مركز الامتثال المالي', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(fetchComplianceDashboard).mockResolvedValue({
            period: { from: '2026-11-01', to: '2026-11-13' },
            kpis: { totalSales: '1200.00', outputVat: '180.00', inputVat: '30.00', netPayable: '150.00' },
            alerts: [],
        });
    });

    it('يعرض مؤشرات لوحة القيادة من استجابة API', async () => {
        renderScreen();

        expect(await screen.findByText('إجمالي المبيعات')).toBeInTheDocument();
        expect(fetchComplianceDashboard).toHaveBeenCalledTimes(1);
        expect(screen.getByText('ضريبة المخرجات')).toBeInTheDocument();
    });

    it('يعرض مانع VAT الأحمر وتفاصيل الفاتورة الواردة من الخادم', async () => {
        vi.mocked(fetchVatStatus).mockResolvedValue({
            ok: false,
            data: {
                error: 'VAT_PERIOD_BLOCKED',
                message: 'يجب ترحيل الفاتورة قبل اعتماد الفترة.',
                blockingInvoices: [
                    {
                        sourceType: 'pos_order',
                        documentId: '52',
                        invoiceReference: 'INV-52',
                        invoiceDate: '2026-11-10',
                        status: 'draft',
                        blocker: 'draft_invoice',
                    },
                ],
            },
        });
        renderScreen();
        fireEvent.click(screen.getByRole('button', { name: 'ضريبة القيمة المضافة' }));

        expect(await screen.findByRole('alert')).toHaveTextContent('ممنوع اعتماد الفترة الضريبية');
        expect(screen.getByText('INV-52')).toBeInTheDocument();
        expect(fetchVatStatus).toHaveBeenCalledTimes(1);
    });

    it('يعرض الحركات غير المطابقة بخلفية تحذير ويستخدم المعرّفات المُدخلة', async () => {
        vi.mocked(submitBankMatches).mockResolvedValue({
            matched: [{ bankTransactionId: '501', journalEntryId: '8001' }],
            unmatched: [{ bankTransactionId: '502', reason: 'ambiguous_candidates' }],
        });
        renderScreen();
        fireEvent.click(screen.getByRole('button', { name: 'مطابقة البنك' }));
        fireEvent.change(screen.getByLabelText('معرّفات حركات كشف البنك'), { target: { value: '501, 502' } });
        fireEvent.click(screen.getByRole('button', { name: 'مطابقة الحركات' }));

        expect(await screen.findByText('ambiguous_candidates')).toBeInTheDocument();
        expect(submitBankMatches).toHaveBeenCalledWith(['501', '502']);
        expect(screen.getByText('ambiguous_candidates').closest('table')).toHaveClass('fc-table--amber');
    });

    it('يعرض معاينة GOSI مع تنبيه عدم توثيق النسب', async () => {
        vi.mocked(fetchGosiMonth).mockResolvedValue({
            month: '2026-11',
            calculations: [
                {
                    payrollId: '100',
                    employeeId: '200',
                    employeeName: 'موظف',
                    payrollStatus: 'posted',
                    calculation: {
                        employeeId: '200',
                        payrollId: '100',
                        employeeName: 'موظف',
                        insuredCategory: 'saudi',
                        basicSalary: '10000.00',
                        contributionBase: '10000.00',
                        employeeContribution: '975.00',
                        employerContribution: '1175.00',
                        blockers: [{ code: 'GOSI_RATE_SET_UNVERIFIED' }],
                    },
                    payrollApprovalAllowed: false,
                    blockers: [{ code: 'GOSI_RATE_SET_UNVERIFIED' }],
                },
            ],
            totals: { employeeContribution: '975.00', employerContribution: '1175.00', totalContribution: '2150.00' },
            payrollApprovalAllowed: false,
        });
        renderScreen();
        fireEvent.click(screen.getByRole('button', { name: 'الرواتب والتأمينات' }));

        expect(await screen.findByText('اعتماد الرواتب محظور')).toBeInTheDocument();
        expect(screen.getByText('موظف')).toBeInTheDocument();
        expect(fetchGosiMonth).toHaveBeenCalledTimes(1);
    });
});
