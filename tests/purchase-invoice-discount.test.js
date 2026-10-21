const { allocatePurchaseDiscount } = require('../backend/warehouse-routes');

describe('allocatePurchaseDiscount', () => {
    const items = [
        { itemName: 'Rice', qty: 1.25, price: 4 },
        { itemName: 'Oil', qty: 2, price: 3 },
    ];

    test('allocates percentage discounts across lines without losing cents', () => {
        const result = allocatePurchaseDiscount(items, 'percent', 10);

        expect(result.subtotal).toBe(11);
        expect(result.discountAmount).toBe(1.1);
        expect(result.items.map(item => item.discountAmount)).toEqual([0.5, 0.6]);
        expect(result.items.map(item => item.total)).toEqual([4.5, 5.4]);
        expect(result.items[0].effectivePrice).toBe(3.6);
    });

    test('applies fixed discounts and preserves fractional quantities', () => {
        const result = allocatePurchaseDiscount(items, 'amount', 1);

        expect(result.items.reduce((sum, item) => sum + item.total, 0)).toBe(10);
        expect(result.items.map(item => item.grossTotal)).toEqual([5, 6]);
    });

    test.each([
        ['percent', 100.01],
        ['amount', 11.01],
        ['none', 1],
        ['amount', -0.01],
        ['percent', Number.NaN],
    ])('rejects invalid discount %s %s', (type, value) => {
        expect(() => allocatePurchaseDiscount(items, type, value)).toThrow();
    });
});
