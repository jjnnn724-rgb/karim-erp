/**
 * sale-discount-authorization.test.js — تفويض الخصم وتخفيض السعر في مسار البيع
 * ────────────────────────────────────────────────────────────────────────────
 * قبل الإصلاح: أي كاشير (role=cashier) يستطيع تخفيض السعر تحت سعر القائمة
 * أو تطبيق خصم بلا حدّ — تسريب مالي مباشر بلا أثر.
 * بعد الإصلاح: الحد يُفرض على غير المعتمد (403 DISCOUNT_APPROVAL_REQUIRED)،
 * والمعتمد يتجاوزه مع تسجيل التجاوزات في totals.overrides (تُكتب في
 * pos_audit_logs من complete-sale.js بعد نجاح البيع).
 *
 * الاختبار على منطق المجاميع (دالة خالصة) — لا اتصال بقاعدة، ولا استيراد
 * server.js الإنتاجي.
 */
process.env.SALE_DISCOUNT_MAX_PERCENT = '0';
process.env.SALE_PRICE_OVERRIDE_MAX_PERCENT = '0';
process.env.SALE_DISCOUNT_APPROVER_ROLES = 'manager,admin';

const mockPool = { query: jest.fn() };
jest.mock('../backend/cashier-module/db-pool', () => ({ pool: mockPool }));

const { computeTotalsServerSide } = require('../backend/cashier-module/complete-sale');

const productsMap = new Map([
    [10, { id: 10, name_ar: 'شاورما', price: 100, vat_rate: 15 }],
    [11, { id: 11, name_ar: 'ضيافة', price: 0, vat_rate: 0 }],
]);

function catchError(fn) {
    try { fn(); } catch (e) { return e; }
    return null;
}

describe('sale discount / price-override authorization', () => {
    test('كاشير: تخفيض السعر تحت سعر القائمة يُرفض', () => {
        const err = catchError(() => computeTotalsServerSide(
            [{ product_id: 10, quantity: 1, unit_price: 80, discount: 0 }],
            productsMap,
            { role: 'cashier' },
        ));
        expect(err).not.toBeNull();
        expect(err.code).toBe('DISCOUNT_APPROVAL_REQUIRED');
    });

    test('كاشير: خصم على السطر يتجاوز الحد يُرفض', () => {
        const err = catchError(() => computeTotalsServerSide(
            [{ product_id: 10, quantity: 1, unit_price: 100, discount: 10 }],
            productsMap,
            { role: 'cashier' },
        ));
        expect(err).not.toBeNull();
        expect(err.code).toBe('DISCOUNT_APPROVAL_REQUIRED');
    });

    test('كاشير: السعر المخزّن بدون خصم يمرّ بلا تجاوزات', () => {
        const totals = computeTotalsServerSide(
            [{ product_id: 10, quantity: 2, unit_price: 100, discount: 0 }],
            productsMap,
            { role: 'cashier' },
        );
        expect(totals.total_amount).toBe(230);
        expect(totals.overrides).toEqual([]);
    });

    test('معتمد (manager): يتجاوز الحد وتُسجَّل التجاوزات', () => {
        const totals = computeTotalsServerSide(
            [{ product_id: 10, quantity: 1, unit_price: 80, discount: 5 }],
            productsMap,
            { role: 'manager' },
        );
        expect(totals.overrides).toHaveLength(2);
        expect(totals.overrides.map((o) => o.kind).sort()).toEqual(['discount', 'price']);
        expect(totals.overrides.find((o) => o.kind === 'price').percent).toBe(20);
    });

    test('دور ليس ضمن المعتمدين يُرفض كالكاشير', () => {
        const err = catchError(() => computeTotalsServerSide(
            [{ product_id: 10, quantity: 1, unit_price: 80, discount: 0 }],
            productsMap,
            { role: 'accountant' },
        ));
        expect(err).not.toBeNull();
        expect(err.code).toBe('DISCOUNT_APPROVAL_REQUIRED');
    });

    test('صنف بلا سعر (ضيافة) لا يُحسب تجاوزًا', () => {
        const totals = computeTotalsServerSide(
            [{ product_id: 11, quantity: 1, unit_price: 0, discount: 0 }],
            productsMap,
            { role: 'cashier' },
        );
        expect(totals.overrides).toEqual([]);
        expect(totals.total_amount).toBe(0);
    });

    test('رفع السعر فوق المخزن يبقى ممنوعًا (حارس قائم لا يُلغى)', () => {
        const err = catchError(() => computeTotalsServerSide(
            [{ product_id: 10, quantity: 1, unit_price: 120, discount: 0 }],
            productsMap,
            { role: 'admin' },
        ));
        expect(err).not.toBeNull();
        expect(err.code).toBe('PRICE_OVERRIDE_FORBIDDEN');
    });
});
