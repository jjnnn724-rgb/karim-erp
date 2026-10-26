/**
 * stocktaking.test.js — استوديو جرد المخزون الاحترافي
 * ─────────────────────────────────────────────────────
 * يغطي: حساب الفروقات، التحقق من مدخلات العد، سبب الإلغاء،
 * تطبيع نطاق الجلسة، وهيكل HTML لأوراق الطباعة.
 */

const {
    computeVariance,
    validateCountPayload,
    validateCancelPayload,
    normalizeScopeFilter,
    buildCountSheetHtml,
} = require('../backend/stocktaking-routes');

describe('حساب فروقات الجرد', () => {
    test('نقص فعلي ينتج فرقاً سالباً وقيمة سالبة', () => {
        const { varianceQty, varianceValue } = computeVariance(8, 10, 5.5);
        expect(varianceQty).toBe(-2);
        expect(varianceValue).toBe(-11);
    });

    test('زيادة فعلية تنتج فرقاً موجباً', () => {
        const { varianceQty, varianceValue } = computeVariance(13.5, 10, 4);
        expect(varianceQty).toBe(3.5);
        expect(varianceValue).toBe(14);
    });

    test('العد المطابق ينتج صفراً تماماً', () => {
        const { varianceQty, varianceValue } = computeVariance(7.25, 7.25, 100);
        expect(varianceQty).toBe(0);
        expect(varianceValue).toBe(0);
    });

    test('التقريب إلى 3 منازل للكمية ومنزلتين للقيمة', () => {
        const { varianceQty, varianceValue } = computeVariance(1.00005, 0, 3.14159);
        expect(varianceQty).toBe(1); // round(1.00005، 3) = 1
        expect(varianceValue).toBe(3.14); // 1 × 3.14159 مقربة لمنزلتين
    });

    test('تكلفة مفقودة تعامل كصفر دون انفجار', () => {
        const { varianceQty, varianceValue } = computeVariance(5, 3);
        expect(varianceQty).toBe(2);
        expect(varianceValue).toBe(0);
    });
});

describe('التحقق من مدخلات العد', () => {
    test('كمية صالحة مع ملاحظة تُقبل وتُطبَّع', () => {
        const { errors, countedQty, notes } = validateCountPayload({ countedQty: '12.5', notes: '  علبة ناقصة ' });
        expect(errors).toEqual([]);
        expect(countedQty).toBe(12.5);
        expect(notes).toBe('علبة ناقصة');
    });

    test('الكمية السالبة والنصية الملفوسة تُرفض', () => {
        expect(validateCountPayload({ countedQty: -3 }).errors.length).toBeGreaterThan(0);
        expect(validateCountPayload({ countedQty: 'abc' }).errors.length).toBeGreaterThan(0);
        expect(validateCountPayload({}).errors.length).toBeGreaterThan(0);
    });

    test('الملاحظة الطويلة جداً تُرفض', () => {
        const long = 'x'.repeat(501);
        expect(validateCountPayload({ countedQty: 5, notes: long }).errors.some(e => e.includes('500'))).toBe(true);
    });

    test('ملاحظة فارغة تصبح null لا نصاً فارغاً', () => {
        const { notes } = validateCountPayload({ countedQty: 5, notes: '   ' });
        expect(notes).toBeNull();
    });
});

describe('التحقق من سبب الإلغاء', () => {
    test('سبب صالح يُقبل', () => {
        const { error, reason } = validateCancelPayload({ reason: 'خطأ في تحديد النطاق' });
        expect(error).toBeUndefined();
        expect(reason).toBe('خطأ في تحديد النطاق');
    });

    test('سبب قصير أو فارغ يُرفض', () => {
        expect(validateCancelPayload({ reason: 'اب' }).error).toBeDefined();
        expect(validateCancelPayload({}).error).toBeDefined();
        expect(validateCancelPayload({ reason: 'x'.repeat(501) }).error).toBeDefined();
    });
});

describe('تطبيع نطاق جلسة الجرد', () => {
    test('الأنماط المعروفة تُقبل', () => {
        expect(normalizeScopeFilter({ mode: 'category', category: 'مواد جافة' }).mode).toBe('category');
        expect(normalizeScopeFilter({ mode: 'in_stock' }).mode).toBe('in_stock');
        expect(normalizeScopeFilter({ mode: 'search', search: 'أرز' }).search).toBe('أرز');
    });

    test('حقول غريبة وأنماط غير معروفة تُسقط بأمان', () => {
        const clean = normalizeScopeFilter({ mode: 'HACK', category: 'x', injection: 'DROP TABLE' });
        expect(clean.mode).toBe('all');
        expect(clean.injection).toBeUndefined();
        expect(Object.keys(clean).sort()).toEqual(['category', 'mode', 'search']);
    });

    test('مدخل فارغ ينتج نطاق "كل الأصناف"', () => {
        expect(normalizeScopeFilter(null).mode).toBe('all');
        expect(normalizeScopeFilter(undefined).mode).toBe('all');
    });
});

describe('أوراق الطباعة (count-sheet shell)', () => {
    test('HTML كامل RTL مع حماية من XSS في العنوان', () => {
        const html = buildCountSheetHtml('ورقة <script>alert(1)</script>', '<div>المحتوى</div>');
        expect(html).toContain('<!DOCTYPE html>');
        expect(html).toContain('dir="rtl"');
        expect(html).not.toContain('<script>alert(1)</script>');
        expect(html).toContain('&lt;script&gt;');
        expect(html).toContain('window.print()');
    });
});
