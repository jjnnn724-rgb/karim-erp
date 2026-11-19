import { describe, expect, it } from 'vitest';
import { isFullMonth, type VatReturn, vatMonthRange, vatPeriodMonth, vatReviewFlags } from './vat-return';

const report: VatReturn = {
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
    unclassified_vat_movements: { output_debits: 4, output_credits: 2, input_debits: 3, input_credits: 1 },
    purchases_crosscheck: { count: 1, net: 80, vat: 12 },
};

describe('اشتقاقات شهر تصفية ضريبة القيمة المضافة', () => {
    it('يستخرج شهر المراجعة من أول تاريخ', () => {
        expect(vatPeriodMonth('2026-10-01')).toBe('2026-10');
        expect(vatPeriodMonth('2026-10-31')).toBe('2026-10');
    });

    it('يرفض تاريخًا بلا شهر', () => {
        expect(vatPeriodMonth('')).toBe('');
        expect(vatPeriodMonth('31-10-2026')).toBe('');
    });

    it('يحسب حدود الشهر كاملًا', () => {
        expect(vatMonthRange('2026-10')).toEqual({ from: '2026-10-01', to: '2026-10-31' });
        expect(vatMonthRange('2026-02')).toEqual({ from: '2026-02-01', to: '2026-02-28' });
        expect(vatMonthRange('2028-02')).toEqual({ from: '2028-02-01', to: '2028-02-29' });
    });

    it('يرفض شهرًا غير صالح', () => {
        expect(vatMonthRange('')).toBeNull();
        expect(vatMonthRange('2026-13')).toBeNull();
        expect(vatMonthRange('2026-1')).toBeNull();
        expect(vatMonthRange('26-01')).toBeNull();
    });

    it('يقبل الفترة حين تغطي شهرها كاملًا فقط', () => {
        expect(isFullMonth('2026-10', '2026-10-01', '2026-10-31')).toBe(true);
        expect(isFullMonth('2026-10', '2026-10-01', '2026-10-15')).toBe(false);
        expect(isFullMonth('2026-10', '2026-09-01', '2026-09-30')).toBe(false);
        expect(isFullMonth('', '2026-10-01', '2026-10-31')).toBe(false);
    });
});

describe('بنود المراجعة المانعة للاعتماد', () => {
    it('يجمع الحركات غير المصنّفة ويقيس فرق الفواتير', () => {
        const flags = vatReviewFlags(report);
        expect(flags.unclassified).toBe(10);
        expect(flags.invoiceDifference).toBe(0);
        expect(flags.blocked).toBe(true);
    });

    it('يمنع الاعتماد عند فرق ضريبة الفواتير عن الأستاذ', () => {
        const flags = vatReviewFlags({
            ...report,
            unclassified_vat_movements: { output_debits: 0, output_credits: 0, input_debits: 0, input_credits: 0 },
            purchases_crosscheck: { count: 1, net: 80, vat: 15 },
        });
        expect(flags.invoiceDifference).toBe(3);
        expect(flags.blocked).toBe(true);
    });

    it('يفتح المراجعة حين لا حركات غير مصنّفة ولا فرق', () => {
        const flags = vatReviewFlags({
            ...report,
            unclassified_vat_movements: { output_debits: 0, output_credits: 0, input_debits: 0, input_credits: 0 },
        });
        expect(flags.blocked).toBe(false);
    });
});
