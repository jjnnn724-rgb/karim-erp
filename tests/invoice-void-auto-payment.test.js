/**
 * invoice-void-auto-payment.test.js — منع تكرار «الفاتورة لا تُلغى» (طلب المالك 2026-10-13)
 * ─────────────────────────────────────────────────────────────────────────────
 * السبب الجذري لحادثة INV-1791896153117: الفاتورة تُسجَّل نقديًا فيختم النظام حالتها
 * بـ «دفعة تلقائية مع تسجيل فاتورة الشراء»، ثم يرفض إلغاؤها لأن عليها دفعة — فيُترك
 * المدير بين رفض و«حذف قسري» معطّل في الخادم. الدفعة التوليدية جزء من الفاتورة نفسها،
 * لذا تُعكس معها داخل نفس المعاملة؛ الدفعات اليدية تبقى محميّة.
 */
const fs = require('fs');
const path = require('path');

const BE = fs.readFileSync(path.join(__dirname, '..', 'backend', 'warehouse-routes.js'), 'utf8');
const FE = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'app', 'js', 'features', 'warehouse.js'), 'utf8');

// نفس أخطاء round() المستخدمة في الخلفية — الدالة النقية لا تحتاج قاعدة بيانات
const round = (v, d = 2) => Number(Number(v).toFixed(d));

function loadClassifier() {
    const start = BE.indexOf('const AUTO_PAYMENT_NOTE_RE');
    const end = BE.indexOf('router.post(\'/purchase-invoices/:id/void\'');
    if (start < 0 || end < 0 || end <= start) {throw new Error('مرتكزات دالة تصنيف الدفعات غير موجودة في warehouse-routes.js');}
    const SRC = BE.slice(start, end);
    return new Function('round', `${SRC}; return { classifyInvoicePaymentsForVoid, AUTO_PAYMENT_NOTE_RE };`)(round);
}

describe('تصنيف دفعات الفاتورة لأغراض الإلغاء', () => {
    const { classifyInvoicePaymentsForVoid } = loadClassifier();

    test('الدفعة التوليدية (تسجيل) تُحسب آلية', () => {
        const r = classifyInvoicePaymentsForVoid([{ id: 1, amount: 172, notes: 'دفعة تلقائية مع تسجيل فاتورة الشراء' }]);
        expect(r.auto.length).toBe(1);
        expect(r.manual.length).toBe(0);
        expect(r.autoOnly).toBe(true);
        expect(r.autoTotal).toBe(172);
    });

    test('دفعة التعديل التلقائي آلية كذلك', () => {
        const r = classifyInvoicePaymentsForVoid([{ id: 2, amount: 50, notes: 'دفعة تلقائية مع تعديل فاتورة الشراء' }]);
        expect(r.autoOnly).toBe(true);
    });

    test('الدفعة اليدية (من شاشة الدفعات) تبقى محميّة ولا تُعكس تلقائيًا', () => {
        const r = classifyInvoicePaymentsForVoid([{ id: 3, amount: 100, notes: 'تحويل بنكي من المدير' }]);
        expect(r.autoOnly).toBe(false);
        expect(r.manual.length).toBe(1);
    });

    test('المزيج (آلية + يدية) = رفض — اليدية مال متحرك مستقل', () => {
        const r = classifyInvoicePaymentsForVoid([
            { id: 4, amount: 60, notes: 'دفعة تلقائية مع تسجيل فاتورة الشراء' },
            { id: 5, amount: 40, notes: 'شيك رقم ٩' },
        ]);
        expect(r.autoOnly).toBe(false);
        expect(r.auto.length).toBe(1);
        expect(r.manual.length).toBe(1);
        expect(r.total).toBe(100);
    });

    test('بلا دفعات: autoOnly=false (سلوك الرصيد الافتتاحي بلا دفعة)', () => {
        expect(classifyInvoicePaymentsForVoid([]).autoOnly).toBe(false);
        expect(classifyInvoicePaymentsForVoid(null).autoOnly).toBe(false);
    });

    test('ملاحظات فارغة أو مسافات زائدة لا تُقلب آلية', () => {
        expect(classifyInvoicePaymentsForVoid([{ id: 6, amount: 10, notes: '  ' }]).autoOnly).toBe(false);
        expect(classifyInvoicePaymentsForVoid([{ id: 7, amount: 10, notes: ' دفعة تلقائية مع تسجيل فاتورة الشراء ' }]).autoOnly).toBe(true);
    });
});

describe('عقد مسار الإلغاء في الخلفية', () => {
    const start = BE.indexOf('router.post(\'/purchase-invoices/:id/void\'');
    const block = BE.slice(start, BE.indexOf('});\n', BE.indexOf('[purchase_invoice_void]')));

    test('يقرأ الدفعات بقفل FOR UPDATE (لا سباق مع تسجيل دفعة)', () => {
        expect(block).toMatch(/FROM supplier_payments WHERE "invoiceId" = \$1 FOR UPDATE/);
    });

    test('يصنّف الدفعات قبل التقرير', () => {
        expect(block).toContain('classifyInvoicePaymentsForVoid(payRows)');
    });

    test('يعكس الدفعات التوليدية ويطهّر قيدها من الدفتر داخل نفس المعاملة', () => {
        expect(block).toContain('payClass.autoOnly');
        expect(block).toMatch(/DELETE FROM supplier_payments WHERE id = ANY/);
        expect(block).toMatch(/DELETE FROM journal_lines WHERE entry_id IN/);
        expect(block).toMatch(/source_type='supplier_payment' AND source_id = ANY/);
        expect(block).toMatch(/deletedPayments = payClass.auto.length/);
    });

    test('يرفض الدفعات اليدية برسالة توجّه المستخدم لعكسها، ولا يُلغيها ضمنيًا', () => {
        expect(block).toMatch(/payClass.manual.length > 0/);
        expect(block).toContain('INVOICE_HAS_PAYMENTS');
        expect(block).toContain('يدوية');
    });

    test('الحذف القسري ما زال ممنوعًا (لا مال يُمحى بلا قيد عكسي)', () => {
        expect(block).toContain('FORCE_VOID_FORBIDDEN');
    });

    test('الدفعات التوليدية لا تُفعّل رفض INVOICE_PAID بعد اليوم', () => {
        expect(block).toMatch(/!\(paidOpeningWithoutPayment \|\| payClass.autoOnly\)/);
    });
});

describe('الواجهة: لا «حذف قسري» ميت بعد الآن', () => {
    const start = FE.indexOf('async function voidPurchaseInvoice');
    const block = FE.slice(start, FE.indexOf('\nfunction printPurchaseInvoice', start));

    test('لا تعرض الحذف القسري ولا تستدعي force', () => {
        expect(block).not.toContain('الحذف القسري');
        expect(block).not.toContain('voidPurchaseInvoice(id,true)');
    });

    test('تشرح أن الدفعة التلقائية ستُعكس مع الإلغاء', () => {
        expect(block).toContain('دفعة تلقائية');
        expect(block).toContain('عُكست');
    });

    test('عند الرفض توجّه لعكس الدفعة اليدية من شاشة الدفعات', () => {
        expect(block).toContain('المشتريات › الدفعات');
    });
});
