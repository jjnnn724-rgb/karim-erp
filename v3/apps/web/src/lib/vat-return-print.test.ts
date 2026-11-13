import { describe, expect, it } from 'vitest';
import type { VatReturn, VatSettlement } from './vat-return';
import { vatReviewCsv, vatReviewFilename, vatReviewPrintHtml } from './vat-return-print';

const report: VatReturn = {
    from: '2026-10-01',
    to: '2026-10-31',
    output_vat: 300,
    output_vat_reversals: 50,
    input_vat: 120,
    input_vat_adjustments: 20,
    net_payable: 150,
    carry_forward_credit: 0,
    payable_balance: 250,
    recoverable_balance: 100,
    unclassified_vat_movements: { output_debits: 40, input_credits: 10 },
    purchases_crosscheck: { count: 3, net: 800, vat: 120 },
};

const settlement: VatSettlement = {
    month: '2026-10',
    from: '2026-10-01',
    to: '2026-10-31',
    output_vat: 300,
    input_vat: 120,
    net_payable: 150,
    payable_balance: 250,
    recoverable_balance: 100,
    clearing: 100,
    net_payable_after: 150,
    carry_forward_after: 0,
    lines: [
        { account_code: '2100', debit: 100, credit: 0, memo: 'تصفية ضريبة مخرجات مقابل مدخلات' },
        { account_code: '1150', debit: 0, credit: 100, memo: 'تصفية ضريبة مدخلات' },
    ],
    settled: null,
    applied: false,
    preview: true,
};

describe('ورقة مراجعة ضريبة القيمة المضافة', () => {
    it('تجمع أرقام الفترة وخطة التصفية وتوقيعَين', () => {
        const html = vatReviewPrintHtml(report, { byName: 'محاسب', currency: 'SAR', settlement });

        expect(html).toContain('ضريبة المخرجات');
        expect(html).toContain('قيمة التصفية');
        expect(html).toContain('2100');
        expect(html).toContain('1150');
        expect(html).toContain('المحاسب — إعداد');
        expect(html).toContain('المراجع — اعتماد المراجعة الداخلية');
        expect(html).toContain('ليست إقرارًا رسميًا');
        expect(html).toContain('data-vat-print');
        expect(html).toContain('data-vat-close');
    });

    it('تحذّر حين توجد حركات غير مصنّفة', () => {
        const html = vatReviewPrintHtml(report, { byName: 'محاسب', currency: 'SAR' });
        expect(html).toContain('المراجعة موقوفة');
    });

    it('تعلن الجاهزية حين لا فرق ولا حركات غير مصنّفة', () => {
        const clean: VatReturn = {
            ...report,
            unclassified_vat_movements: { output_debits: 0, input_credits: 0 },
        };
        const html = vatReviewPrintHtml(clean, { byName: 'محاسب', currency: 'SAR' });
        expect(html).toContain('الأرقام جاهزة للمراجعة البشرية');
    });

    it('تهرّب HTML في النصوص القادمة من الخادم', () => {
        const hostile: VatReturn = {
            ...report,
            unclassified_vat_movements: { output_debits: 0, input_credits: 0 },
            purchases_crosscheck: { count: 1, net: 0, vat: 0 },
        };
        const html = vatReviewPrintHtml(hostile, { byName: '<script>alert(1)</script>', currency: 'SAR' });
        expect(html).not.toContain('<script>alert(1)</script>');
        expect(html).toContain('&lt;script&gt;');
    });

    it('تضمّن ورقة عمل الإقرار وتعلن غير المسجّل بلا صفر', () => {
        const html = vatReviewPrintHtml(report, { byName: 'محاسب', currency: 'SAR' });
        expect(html).toContain('ورقة عمل الإقرار');
        expect(html).toContain('المبيعات — ضريبة المخرجات');
        expect(html).toContain('المشتريات — ضريبة المدخلات');
        expect(html).toContain('غير مسجّلة');
        expect(html).toContain('الموعد الإرشادي للتقديم');
    });
});

describe('تصدير ملخص المراجعة', () => {
    it('يبني CSV بعلامة BOM وبخلية مقتبسة', () => {
        const csv = vatReviewCsv(report, settlement);
        expect(csv.startsWith('\uFEFF')).toBe(true);
        expect(csv).toContain('"ضريبة المخرجات المرحّلة","300"');
        expect(csv).toContain('"سطر التصفية 2100"');
    });

    it('يسمّي الملف بالفترة', () => {
        expect(vatReviewFilename('2026-10-01', '2026-10-31')).toBe('مراجعة-ضريبة-القيمة-المضافة-2026-10-01_2026-10-31.csv');
    });

    it('يصدر خانات الإقرار ويحفظ غير المسجّل صراحةً', () => {
        const csv = vatReviewCsv(report);
        expect(csv).toContain('"خانة 1 — مبيعات بالمعدل القياسي');
        expect(csv).toContain('غير مسجّلة');
        expect(csv).toContain('"صافي المستندات قبل التسويات","غير متاح"');
    });
});
