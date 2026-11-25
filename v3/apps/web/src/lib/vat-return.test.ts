import { describe, expect, it } from 'vitest';
import {
    isFullMonth,
    type VatReturn,
    vatBalanceReconciliation,
    vatFilingDeadline,
    vatMonthRange,
    vatPeriodMonth,
    vatRateNeedsReview,
    vatRateRows,
    vatRateSummary,
    vatReviewFlags,
    vatWorksheet,
} from './vat-return';

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
    unclassified_vat_movements: { output_debits: 4, input_credits: 1 },
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
        expect(flags.unclassified).toBe(5);
        expect(flags.invoiceDifference).toBe(0);
        expect(flags.blocked).toBe(true);
    });

    it('يمنع الاعتماد عند فرق ضريبة الفواتير عن الأستاذ', () => {
        const flags = vatReviewFlags({
            ...report,
            unclassified_vat_movements: { output_debits: 0, input_credits: 0 },
            purchases_crosscheck: { count: 1, net: 80, vat: 15 },
        });
        expect(flags.invoiceDifference).toBe(3);
        expect(flags.blocked).toBe(true);
    });

    it('يفتح المراجعة حين لا حركات غير مصنّفة ولا فرق', () => {
        const flags = vatReviewFlags({
            ...report,
            unclassified_vat_movements: { output_debits: 0, input_credits: 0 },
        });
        expect(flags.blocked).toBe(false);
    });
});

describe('تصنيف معدلات الضريبة وملخص المراجعة', () => {
    const saleRow = {
        kind: 'sale' as const,
        rate: 15,
        applicable_standard_rate: 15,
        classification: 'standard_rate' as const,
        taxable_base: 100,
        vat: 15,
        document_count: 4,
        unposted_document_count: 1,
    };
    const zeroRow = {
        kind: 'purchase' as const,
        rate: 0,
        applicable_standard_rate: 15,
        classification: 'zero_rate_unclassified' as const,
        taxable_base: 50,
        vat: 0,
        document_count: 2,
        unposted_document_count: 0,
    };

    it('يجمع صفوف المبيعات والمشتريات في قائمة واحدة', () => {
        const rows = vatRateRows({
            ...report,
            sales_breakdown: [saleRow],
            purchases_crosscheck: { count: 2, net: 50, vat: 0, by_rate: [zeroRow] },
        });
        expect(rows).toHaveLength(2);
        expect(rows[1]?.classification).toBe('zero_rate_unclassified');
    });

    it('يحسب الوعاء والضريبة والمستندات التي تحتاج مراجعة', () => {
        const summary = vatRateSummary([saleRow, zeroRow]);
        expect(summary.taxableBase).toBe(150);
        expect(summary.vat).toBe(15);
        expect(summary.documents).toBe(6);
        expect(summary.reviewDocuments).toBe(2);
    });

    it('يعتبر أي معدل غير قياسي بحاجة إلى مراجعة', () => {
        expect(vatRateNeedsReview(saleRow)).toBe(false);
        expect(vatRateNeedsReview(zeroRow)).toBe(true);
    });

    it('يعيد قائمة فارغة عند غياب تفصيل المعدلات', () => {
        expect(vatRateRows(report)).toEqual([]);
        expect(vatRateSummary([])).toEqual({ taxableBase: 0, vat: 0, documents: 0, reviewDocuments: 0 });
    });
});

describe('ورقة عمل الإقرار — خانات النموذج', () => {
    const saleRow = {
        kind: 'sale' as const,
        rate: 15,
        applicable_standard_rate: 15,
        classification: 'standard_rate' as const,
        taxable_base: 1000,
        vat: 150,
        document_count: 5,
        unposted_document_count: 0,
    };
    const voidRow = {
        kind: 'void' as const,
        rate: 15,
        applicable_standard_rate: 15,
        classification: 'standard_rate' as const,
        taxable_base: 200,
        vat: 30,
        document_count: 1,
        unposted_document_count: 0,
    };
    const zeroSaleRow = {
        kind: 'sale' as const,
        rate: 0,
        applicable_standard_rate: 15,
        classification: 'zero_rate_unclassified' as const,
        taxable_base: 300,
        vat: 0,
        document_count: 2,
        unposted_document_count: 0,
    };
    const purchaseRow = {
        kind: 'purchase' as const,
        rate: 15,
        applicable_standard_rate: 15,
        classification: 'standard_rate' as const,
        taxable_base: 400,
        vat: 60,
        document_count: 3,
        unposted_document_count: 0,
    };

    const detail: VatReturn = {
        ...report,
        standard_vat_rate: 15,
        sales_breakdown: [saleRow, voidRow, zeroSaleRow],
        purchases_crosscheck: { count: 3, net: 400, vat: 60, by_rate: [purchaseRow] },
    };

    it('يخصم الإلغاء من نفس تصنيف البيع ولا يخلط المعدلات', () => {
        const sheet = vatWorksheet(detail);
        const standard = sheet.sales.find((row) => row.key === 'standard');
        expect(standard?.box).toBe(1);
        expect(standard?.base).toBe(800);
        expect(standard?.vat).toBe(120);
        expect(standard?.documents).toBe(6);
        expect(sheet.salesTotal).toEqual({ base: 1100, vat: 120, documents: 8 });
        expect(sheet.purchasesTotal).toEqual({ base: 400, vat: 60, documents: 3 });
        expect(sheet.net).toBe(60);
    });

    it('يعدّ المستندات غير القياسية للمراجعة ولا يعلن اكتمال الكشف', () => {
        const sheet = vatWorksheet(detail);
        expect(sheet.reviewDocuments).toBe(2);
        expect(sheet.salesComplete).toBe(false);
        expect(sheet.purchasesComplete).toBe(true);
    });

    it('يجعل الإعفاء والاستيراد والاحتساب العكسي «غير مسجّلة» لا صفرًا', () => {
        const sheet = vatWorksheet(detail);
        const exempt = sheet.sales.find((row) => row.key === 'exempt');
        const imports = sheet.purchases.find((row) => row.key === 'imports');
        const reverse = sheet.purchases.find((row) => row.key === 'reverse');
        expect(exempt?.box).toBe(3);
        expect(imports?.box).toBe(10);
        expect(reverse?.box).toBe(11);
        for (const row of [exempt, imports, reverse]) {
            expect(row?.status).toBe('unavailable');
            expect(row?.base).toBeNull();
            expect(row?.vat).toBeNull();
        }
    });

    it('يعلن غياب الكشف بدل عرض أصفار مضلّلة', () => {
        const sheet = vatWorksheet(report);
        expect(sheet.hasSalesDetail).toBe(false);
        expect(sheet.hasPurchaseDetail).toBe(false);
        expect(sheet.sales.every((row) => row.status === 'unavailable' && row.base === null)).toBe(true);
        expect(sheet.purchases.every((row) => row.status === 'unavailable' && row.vat === null)).toBe(true);
    });
});

describe('مطابقة أرصدة الضريبة', () => {
    const withOpening: VatReturn = {
        ...report,
        opening_balances: { as_of: '2026-09-30', payable: 4, recoverable: 1 },
    };

    it('يطابق الحركة المتوقعة من القيود مع فرق الرصيد', () => {
        const result = vatBalanceReconciliation(withOpening);
        expect(result?.expectedPayableMovement).toBe(21);
        expect(result?.payableMovement).toBe(21);
        expect(result?.payableGap).toBe(0);
        expect(result?.expectedRecoverableMovement).toBe(9);
        expect(result?.recoverableMovement).toBe(9);
        expect(result?.balanced).toBe(true);
    });

    it('يكشف الفرق حين لا يطابق الافتتاحي حركة القيود', () => {
        const result = vatBalanceReconciliation({
            ...withOpening,
            opening_balances: { as_of: '2026-09-30', payable: 10, recoverable: 1 },
        });
        expect(result?.payableMovement).toBe(15);
        expect(result?.payableGap).toBe(-6);
        expect(result?.balanced).toBe(false);
    });

    it('يعيد null بلا أرصدة افتتاحية بدل اختراع مطابقة', () => {
        expect(vatBalanceReconciliation(report)).toBeNull();
    });
});

describe('موعد تقديم الإقرار الإرشادي', () => {
    it('يحسب الشهري في اليوم 15 من الشهر التالي', () => {
        expect(vatFilingDeadline('monthly', '2026-10-31')).toBe('2026-11-15');
        expect(vatFilingDeadline('monthly', '2026-12-31')).toBe('2027-01-15');
    });

    it('يحسب الربع سنوي في آخر يوم من الشهر التالي للربع', () => {
        expect(vatFilingDeadline('quarterly', '2026-09-30')).toBe('2026-10-31');
        expect(vatFilingDeadline('quarterly', '2026-12-31')).toBe('2027-01-31');
    });

    it('لا يخمّن موعدًا لدورية أو تاريخ غير صالح', () => {
        expect(vatFilingDeadline('annual', '2026-10-31')).toBeNull();
        expect(vatFilingDeadline('monthly', '')).toBeNull();
        expect(vatFilingDeadline('monthly', '31-10-2026')).toBeNull();
    });
});
