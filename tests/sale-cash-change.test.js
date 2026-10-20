/**
 * sale-cash-change.test.js — الباقي النقدي الفعلي في البيع
 * ────────────────────────────────────────────────────────────
 * المشكلة: أي فائض في الدفع (حتى بالبطاقة) كان يُسجَّل صفّ 'cash/out'،
 * فينقص النقد المتوقع في إقفال الوردية (expected = opening + in − out)
 * رغم أن النقد لم يخرج من الدرج — فارق وهمي في كل بيع مدفوع زيادة بالبطاقة.
 *
 * القاعدة الآن: cashChange = النقد المُسلَّم − النقد المطبَّق على الفاتورة.
 */
const mockPool = { query: jest.fn() };
jest.mock('../backend/cashier-module/db-pool', () => ({ pool: mockPool }));

const { computeCashChange } = require('../backend/cashier-module/complete-sale');

const cash = (amount) => ({ method: 'cash', amount });
const card = (amount) => ({ method: 'card', amount });

describe('الباقي النقدي الفعلي (computeCashChange)', () => {
    test('دفع نقدي زائد: الباقي نقدي حقيقي', () => {
        const r = computeCashChange([cash(400)], 345);
        expect(r.cashChange).toBe(55);
        expect(r.nonCashOverpayment).toBe(0);
    });

    test('دفع بطاقة زائد: لا نقد يخرج من الدرج', () => {
        const r = computeCashChange([card(400)], 345);
        expect(r.cashChange).toBe(0);          // لا صفّ cash/out
        expect(r.nonCashOverpayment).toBe(55);  // يُبلَّغ ولا يُخصم من النقد
    });

    test('دفع مجزأ: بطاقة 300 + نقد 100 لفاتورة 345', () => {
        const r = computeCashChange([card(300), cash(100)], 345);
        expect(r.cashChange).toBe(55);
        expect(r.nonCashOverpayment).toBe(0);
    });

    test('دفع نقدي مضبوط: لا باقي', () => {
        const r = computeCashChange([cash(345)], 345);
        expect(r.cashChange).toBe(0);
    });

    test('دفع نقدي ناقص: لا باقي (والرفض يأتي من reconcilePayments)', () => {
        const r = computeCashChange([cash(300)], 345);
        expect(r.cashChange).toBe(0);
    });

    test('الباقي النقدي لا يتجاوز النقد المُسلَّم أبدًا', () => {
        const r = computeCashChange([cash(100)], 345);
        expect(r.cashChange).toBe(0);
        expect(r.cashChange).toBeLessThanOrEqual(r.cashIn);
    });

    test('صنف مجاني (إجمالي صفر) مع نقد: لا باقي زائد', () => {
        const r = computeCashChange([cash(0)], 0);
        expect(r.cashChange).toBe(0);
    });

    test('مدفوعات فارغة أو غير صالحة: أرقام صفرية بلا انهيار', () => {
        expect(computeCashChange([], 100).cashChange).toBe(0);
        expect(computeCashChange(null, 100).cashChange).toBe(0);
        expect(computeCashChange(undefined, 100).cashChange).toBe(0);
    });

    test('وسيلة غير نقدية باسم مختلف (wallet) تُعامل كغير نقدية', () => {
        const r = computeCashChange([{ method: 'wallet', amount: 400 }], 345);
        expect(r.cashChange).toBe(0);
        expect(r.nonCashOverpayment).toBe(55);
    });
});
