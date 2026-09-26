/**
 * procurement.test.js — مركز المشتريات والموردين
 * ─────────────────────────────────────────────────────
 * يغطي: حالة سداد الفاتورة، رصيد المورد، كشف الحساب (ترتيب/رصيد جارٍ/طيّ ما قبل
 * الفترة)، تحقق حمولات المورد والدفعة — كلها دوال نقية بلا قاعدة بيانات.
 */

const {
    computeInvoicePaymentStatus,
    computeSupplierBalance,
    buildStatementRows,
    validateSupplierPayload,
    validatePaymentPayload,
    PAYMENT_METHODS,
} = require('../backend/procurement-routes');

describe('computeInvoicePaymentStatus — حالة سداد الفاتورة', () => {
    test('مسدد كامل → paid', () => {
        expect(computeInvoicePaymentStatus(1000, 1000)).toBe('paid');
    });

    test('مسدد زائد → paid (لا مستحق)', () => {
        expect(computeInvoicePaymentStatus(500, 700)).toBe('paid');
    });

    test('مسدد جزئي → partial', () => {
        expect(computeInvoicePaymentStatus(1000, 400)).toBe('partial');
    });

    test('صفر مسدد → unpaid', () => {
        expect(computeInvoicePaymentStatus(1000, 0)).toBe('unpaid');
        expect(computeInvoicePaymentStatus(1000, null)).toBe('unpaid');
    });

    test('فاتورة صفرية أو سالبة تعد مدفوعة (لا شيء مستحق عليها)', () => {
        expect(computeInvoicePaymentStatus(0, 0)).toBe('paid');
        expect(computeInvoicePaymentStatus(-5, 0)).toBe('paid');
    });

    test('كسور تُقرّب لحساب الحالة (999.995 من 1000 → paid)', () => {
        expect(computeInvoicePaymentStatus(1000, 999.999)).toBe('paid');
    });
});

describe('computeSupplierBalance — رصيد المورد المستحق', () => {
    test('افتتاحي + مشتريات − دفعات', () => {
        expect(computeSupplierBalance(100, 500, 300)).toBe(300);
    });

    test('دفعات زائدة تعطي رصيداً سالباً (دائن)', () => {
        expect(computeSupplierBalance(0, 200, 350)).toBe(-150);
    });

    test('تقريب لخانتين عشريتين (كل مكوّن يُقرّب ثم المجموع)', () => {
        expect(computeSupplierBalance(50.25, 100.105, 25.335)).toBe(125.02);
    });
});

describe('buildStatementRows — كشف الحساب', () => {
    const invoices = [
        { id: 11, invoiceNumber: 'INV-001', date: '2026-08-05', totalAmount: 1000, paidAmount: 0 },
        { id: 12, invoiceNumber: 'INV-002', date: '2026-08-20', totalAmount: 500, paidAmount: 0 },
    ];
    const payments = [
        { id: 21, amount: 400, method: 'cash', date: '2026-08-10' },
        { id: 22, amount: 300, method: 'bank', date: '2026-08-25', invoiceId: 12 },
    ];

    test('الترتيب الزمني الصحيح والرصيد الجارٍ', () => {
        const stmt = buildStatementRows(200, invoices, payments, null, null);
        expect(stmt.openingBalance).toBe(200);
        expect(stmt.rows.map(r => r.id)).toEqual([11, 21, 12, 22]);
        expect(stmt.rows[0].balance).toBe(1200);   // 200 + 1000
        expect(stmt.rows[1].balance).toBe(800);    // 1200 − 400
        expect(stmt.rows[2].balance).toBe(1300);   // 800 + 500
        expect(stmt.rows[3].balance).toBe(1000);   // 1300 − 300
        expect(stmt.totals).toEqual({ debit: 1500, credit: 700, closing: 1000 });
    });

    test('حركات ما قبل الفترة تُطوى في الرصيد الافتتاحي', () => {
        const stmt = buildStatementRows(200, invoices, payments, '2026-08-15', null);
        // opening = 200 + (1000) − (400) = 800
        expect(stmt.openingBalance).toBe(800);
        expect(stmt.rows.map(r => r.id)).toEqual([12, 22]);
        expect(stmt.totals.closing).toBe(1000);
    });

    test('فلتر إلى تاريخ يستبعد الحركات اللاحقة', () => {
        const stmt = buildStatementRows(200, invoices, payments, null, '2026-08-19');
        expect(stmt.rows.map(r => r.id)).toEqual([11, 21]);
        expect(stmt.totals.closing).toBe(800);
    });

    test('لا فواتير ولا دفعات → كشف فارغ بالرصيد الافتتاحي فقط', () => {
        const stmt = buildStatementRows(750, [], [], null, null);
        expect(stmt.rows).toEqual([]);
        expect(stmt.totals.closing).toBe(750);
    });

    test('نفس اليوم: الفاتورة قبل الدفعة في نفس التاريخ', () => {
        const stmt = buildStatementRows(0,
            [{ id: 1, invoiceNumber: 'X', date: '2026-08-05', totalAmount: 100, paidAmount: 0 }],
            [{ id: 2, amount: 30, method: 'cash', date: '2026-08-05' }],
            null, null);
        expect(stmt.rows.map(r => r.id)).toEqual([1, 2]);
        expect(stmt.totals.closing).toBe(70);
    });
});

describe('validateSupplierPayload — تحقق المورد', () => {
    test('حمولة سليمة تُنظَّف', () => {
        const v = validateSupplierPayload({ name: '  مؤسسة اللحوم  ', phone: '0555 123 456', category: 'لحوم', openingBalance: '250.5' });
        expect(v.ok).toBe(true);
        expect(v.clean.name).toBe('مؤسسة اللحوم');
        expect(v.clean.openingBalance).toBe(250.5);
    });

    test('اسم مفقود أو قصير جداً يُرفض', () => {
        expect(validateSupplierPayload({}).ok).toBe(false);
        expect(validateSupplierPayload({ name: 'أ' }).ok).toBe(false);
    });

    test('رصيد افتتاحي سالب يُرفض', () => {
        const v = validateSupplierPayload({ name: 'مورد', openingBalance: -10 });
        expect(v.ok).toBe(false);
    });

    test('هاتف بأحرف غريبة يُرفض', () => {
        const v = validateSupplierPayload({ name: 'مورد', phone: '<script>alert(1)</script>' });
        expect(v.ok).toBe(false);
    });

    test('التحديث الجزئي لا يفرض الاسم', () => {
        const v = validateSupplierPayload({ phone: '0100' }, { isUpdate: true });
        expect(v.ok).toBe(true);
        expect(v.clean.phone).toBe('0100');
    });
});

describe('validatePaymentPayload — تحقق الدفعة', () => {
    test('دفعة سليمة', () => {
        const v = validatePaymentPayload({ supplierId: 5, amount: '350.25', method: 'bank', date: '2026-08-30' });
        expect(v.ok).toBe(true);
        expect(v.clean).toEqual({ supplierId: 5, amount: 350.25, method: 'bank', date: '2026-08-30' });
    });

    test('مبلغ صفر أو سالب يُرفض', () => {
        expect(validatePaymentPayload({ supplierId: 5, amount: 0, date: '2026-08-30' }).ok).toBe(false);
        expect(validatePaymentPayload({ supplierId: 5, amount: -5, date: '2026-08-30' }).ok).toBe(false);
    });

    test('طريقة دفع غير معروفة تُرفض', () => {
        expect(validatePaymentPayload({ supplierId: 5, amount: 10, method: 'bitcoin', date: '2026-08-30' }).ok).toBe(false);
    });

    test('تاريخ بصيغة خاطئة يُرفض', () => {
        expect(validatePaymentPayload({ supplierId: 5, amount: 10, date: '30/08/2026' }).ok).toBe(false);
        expect(validatePaymentPayload({ supplierId: 5, amount: 10 }).ok).toBe(false);
    });

    test('invoiceId غير صحيح يُرفض، والصحيح يمر', () => {
        expect(validatePaymentPayload({ supplierId: 5, amount: 10, date: '2026-08-30', invoiceId: -1 }).ok).toBe(false);
        const v = validatePaymentPayload({ supplierId: 5, amount: 10, date: '2026-08-30', invoiceId: '99' });
        expect(v.ok).toBe(true);
        expect(v.clean.invoiceId).toBe(99);
    });
});

describe('ثوابت الطرق المعتمدة', () => {
    test('الطرق النقدية الأربع فقط مسموحة في الدفعات', () => {
        expect([...PAYMENT_METHODS].sort()).toEqual(['bank', 'card', 'cash', 'cheque']);
    });
});
