import { describe, expect, it } from 'vitest';
import type { BankRec } from './bank-rec';
import { type CommandCenterData, commandKpis, commandRisks, complianceScore } from './command-center';
import type { WpsReadinessResponse } from './mudad';
import type { PayrollSheet, PayrollSheetSummary } from './payroll';
import type { VatReturn } from './vat-return';

const vat: VatReturn = {
    from: '2026-10-01',
    to: '2026-10-31',
    output_vat: 100,
    output_vat_reversals: 0,
    input_vat: 40,
    input_vat_adjustments: 0,
    net_payable: 60,
    carry_forward_credit: 0,
    payable_balance: 100,
    recoverable_balance: 40,
    unclassified_vat_movements: { output_debits: 0, input_credits: 0 },
    purchases_crosscheck: { count: 2, net: 200, vat: 40 },
    filing_period_validation: { frequency: 'monthly', matches_frequency: true },
    taxpayer_profile: { seller_name: 'منشأة', vat_number: '1', number_configured: true, registration_verified: true },
    opening_balances: { as_of: '2026-09-30', payable: 0, recoverable: 0 },
    sales_source_counts: { unposted_sales: 0, unposted_voids: 0 },
    cancelled_without_void_date: 0,
    legacy_revenue_crosscheck: { count: 0, amount: 0 },
    filing_readiness: { status: 'blocked', can_file: false, blockers: [{ code: 'x', message: 'مانع اختبار' }] },
};

const wps: WpsReadinessResponse = {
    month: '2026-10',
    summary: {
        month: '2026-10',
        employees: 10,
        ready: 9,
        missing_id: 0,
        missing_salary: 0,
        missing_iban: 1,
        unknown_nationality: 0,
        missing_payroll_line: 0,
        posted: true,
        employer_identifier: true,
    },
    blockers: ['ناقص: IBAN'],
    export_ready: false,
    employees: [],
};

const bank: BankRec = {
    account: '1010',
    from: '2026-10-01',
    to: '2026-10-31',
    book: 5000,
    statement: 5000,
    diff: 0,
    unmatched: [],
};

const payroll = {
    employees: [
        { id: '1', name: 'أ', department: '', position: '', status: 'active', salary: '1000' },
        { id: '2', name: 'ب', department: '', position: '', status: 'active', salary: '2000' },
    ],
    monthDays: new Map<string, number>(),
} satisfies PayrollSheet;

const payrollSummary: PayrollSheetSummary = { total: '3000', shown: 2, hidden: 0 };

const baseData: CommandCenterData = {
    vat,
    payroll,
    payrollSummary,
    wps,
    bank,
    from: vat.from,
    to: vat.to,
};

describe('مؤشرات مركز القيادة الموحّد', () => {
    it('يجمع الالتزام بأوزان ثابتة ويعيد توزيعها على المتاح', () => {
        const score = complianceScore(baseData);
        expect(score.tax).toBe(80);
        expect(score.payroll).toBe(90);
        expect(score.bank).toBe(100);
        expect(score.overall).toBe(89);
        expect(score.tone).toBe('warn');
    });

    it('يغيب مصدر يُسقطه من المتوسط بدل أن يُقرأ صفرًا', () => {
        const score = complianceScore({ ...baseData, vat: null, wps: null, bank: null });
        expect(score.tax).toBeNull();
        expect(score.payroll).toBeNull();
        expect(score.bank).toBeNull();
        expect(score.overall).toBeNull();
        expect(score.tone).toBe('danger');
    });

    it('يعاقب فرق البنك والكشوف غير المطابقة', () => {
        const score = complianceScore({
            ...baseData,
            bank: {
                ...bank,
                diff: 150,
                unmatched: [{ id: 1, account_code: '1010', stmt_date: '2026-10-03', description: 'd', amount: 150, matched: false }],
            },
        });
        expect(score.bank).toBe(65);
    });

    it('تنبّه بالمخاطر من موانع الخادم لا من افتراضات', () => {
        const risks = commandRisks(baseData);
        expect(risks.some((risk) => risk.text === 'مانع اختبار')).toBe(true);
        expect(risks.some((risk) => risk.text === 'ناقص: IBAN')).toBe(true);
    });

    it('يعلن حركات البنك والفرق ضمن المخاطر', () => {
        const risks = commandRisks({
            ...baseData,
            bank: {
                ...bank,
                diff: 250,
                unmatched: [{ id: 1, account_code: '1010', stmt_date: '2026-10-03', description: 'x', amount: 250, matched: false }],
            },
        });
        expect(risks.some((risk) => risk.text.includes('فرق مطابقة البنك'))).toBe(true);
        expect(risks.some((risk) => risk.text.includes('غير مطابقة'))).toBe(true);
    });

    it('مؤشرات القيادة تعكس البيانات كما هي', () => {
        const kpis = commandKpis(baseData);
        expect(kpis.payrollLiability).toBe('3000');
        expect(kpis.payrollEmployees).toBe(2);
        expect(kpis.taxNet).toBe(60);
        expect(kpis.bankMovement).toBe(5000);
        expect(kpis.bankUnmatched).toBe(0);
    });
});
