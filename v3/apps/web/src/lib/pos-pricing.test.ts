import { describe, expect, it } from 'vitest';
import { buildPosSaleItems, calculatePosTotals, matchPosBarcode, normalizeBarcode, type PosCartLine, parsePosMoney } from './pos-pricing';

/**
 * حاسبة الكاشير — تُطابق `v2/data/pos-pricing.js` حرفيًّا في الأرقام الشائعة
 * (كميات صحيحة، أسعار بمليمين، ضريبة 15%)، وتتفوّق عليها في منع انزلاق العوم.
 */

function line(overrides: Partial<PosCartLine> & Pick<PosCartLine, 'price'>): PosCartLine {
    return {
        id: '1',
        name: 'صنف',
        vatRate: 15,
        quantity: 1,
        ...overrides,
    };
}

describe('calculatePosTotals', () => {
    it('سلة فارغة = أصفار صالحة', () => {
        const totals = calculatePosTotals([]);
        expect(totals).toMatchObject({
            valid: true,
            subtotalBeforeDiscount: 0,
            discount: 0,
            subtotal: 0,
            tax: 0,
            total: 0,
        });
        expect(totals.items).toEqual([]);
    });

    it('بند واحد: 2 × 10.00 + 15% = 23.00', () => {
        const totals = calculatePosTotals([line({ price: 10, quantity: 2 })]);
        expect(totals.subtotalBeforeDiscount).toBe(20);
        expect(totals.discount).toBe(0);
        expect(totals.subtotal).toBe(20);
        expect(totals.tax).toBe(3);
        expect(totals.total).toBe(23);
    });

    it('خصم نسبة 10% يوزّع تناسبيًّا والضريبة بعد الخصم', () => {
        const totals = calculatePosTotals([line({ id: '1', price: 10, quantity: 2 }), line({ id: '2', price: 2.5, quantity: 3 })], {
            type: 'percent',
            value: '10',
        });
        expect(totals.subtotalBeforeDiscount).toBe(27.5);
        expect(totals.discount).toBe(2.75);
        expect(totals.subtotal).toBe(24.75);
        // 18.00 × 15% = 2.70 و6.75 × 15% = 1.0125 → 1.01
        expect(totals.tax).toBe(3.71);
        expect(totals.total).toBe(28.46);
        expect(totals.items.map((row) => row.discount)).toEqual([2, 0.75]);
    });

    it('خصم ثابت أكبر من السلة يُقصّ إلى قيمة السلة', () => {
        const totals = calculatePosTotals([line({ price: 5 })], { type: 'fixed', value: '99' });
        expect(totals.discount).toBe(5);
        expect(totals.subtotal).toBe(0);
        expect(totals.tax).toBe(0);
        expect(totals.total).toBe(0);
    });

    it('خصم ثابت يتوزّع ويُرحّل الباقي إلى آخر بند مؤهّل', () => {
        const totals = calculatePosTotals([line({ id: '1', price: 10 }), line({ id: '2', price: 10 }), line({ id: '3', price: 10 })], {
            type: 'fixed',
            value: '10',
        });
        expect(totals.items.map((row) => row.discount)).toEqual([3.33, 3.33, 3.34]);
        expect(totals.subtotal).toBe(20);
        expect(totals.tax).toBe(3);
        expect(totals.total).toBe(23);
    });

    it('البند صفري القيمة لا يأخذ خصمًا ولا يكون آخر مؤهّل', () => {
        const totals = calculatePosTotals([line({ id: '1', price: 10 }), line({ id: '2', price: 0 })], { type: 'fixed', value: '1' });
        expect(totals.items.map((row) => row.discount)).toEqual([1, 0]);
        expect(totals.items[1]?.tax).toBe(0);
    });

    it('نسبة 101% غير صالحة والخصم صفر', () => {
        const totals = calculatePosTotals([line({ price: 10 })], { type: 'percent', value: '101' });
        expect(totals.valid).toBe(false);
        expect(totals.discount).toBe(0);
        expect(totals.total).toBe(11.5);
    });

    it('نسبة 100% صالحة وتمحو السلة', () => {
        const totals = calculatePosTotals([line({ price: 10 })], { type: 'percent', value: '100' });
        expect(totals.valid).toBe(true);
        expect(totals.discount).toBe(10);
        expect(totals.total).toBe(0);
    });

    it('نوع خصم مجهول غير صالح', () => {
        const totals = calculatePosTotals([line({ price: 10 })], {
            type: 'gift' as unknown as 'fixed',
            value: '5',
        });
        expect(totals.valid).toBe(false);
        expect(totals.discount).toBe(0);
    });

    it('يقبل الأرقام العربية والإيرانية والفواصل العربية في قيمة الخصم', () => {
        const arabic = calculatePosTotals([line({ price: 10 })], { type: 'fixed', value: '٥' });
        expect(arabic.discount).toBe(5);
        const persian = calculatePosTotals([line({ price: 10 })], { type: 'fixed', value: '۵٫٥' });
        expect(persian.discount).toBe(5.5);
    });

    it('ضريبة 15% على 5 قروش = قرشًا لكل بند (تقريب نصف‑لأعلى)', () => {
        const totals = calculatePosTotals([line({ price: 0.05, quantity: 3, vatRate: 15 })]);
        expect(totals.subtotal).toBe(0.15);
        expect(totals.tax).toBe(0.02);
        expect(totals.total).toBe(0.17);
    });

    it('الكمية العشرية تُحسب بالملّي بلا انزلاق', () => {
        const totals = calculatePosTotals([line({ price: 12.5, quantity: 1.2, vatRate: 0 })]);
        expect(totals.subtotalBeforeDiscount).toBe(15);
        expect(totals.total).toBe(15);
    });
});

describe('buildPosSaleItems', () => {
    it('يرسل بندًا لكل سطر بخصمه المحسوب', () => {
        const items = buildPosSaleItems([line({ id: '7', price: 10, quantity: 2 }), line({ id: '9', price: 5 })], {
            type: 'fixed',
            value: '5',
        });
        expect(items).toEqual([
            { product_id: 7, quantity: 2, unit_price: 10, discount: 4 },
            { product_id: 9, quantity: 1, unit_price: 5, discount: 1 },
        ]);
    });

    it('يرفض خصمًا غير صالح قبل أي نداء', () => {
        expect(() => buildPosSaleItems([line({ price: 10 })], { type: 'percent', value: '-1' })).toThrow('قيمة الخصم غير صالحة');
    });
});

describe('parsePosMoney', () => {
    it.each([
        ['12.50', 12.5],
        ['١٢٫٥', 12.5],
        ['۱٬٢٣٤', 1234],
        [' 7 ', 7],
        ['0', 0],
    ])('%s → %s', (input, expected) => {
        expect(parsePosMoney(input)).toBe(expected);
    });

    it.each(['', '  ', 'abc', '-1'])('يرفض %s', (input) => {
        expect(Number.isNaN(parsePosMoney(input))).toBe(true);
    });
});

describe('matchPosBarcode', () => {
    const products = [
        { id: '1', name_ar: 'قهوة', barcode: '6281000123456' },
        { id: '2', name_ar: 'شاي', barcode: '6281000999999' },
        { id: '3', name_ar: 'مكرر', barcode: '6281000000000' },
        { id: '4', name_ar: 'مكرر أيضًا', barcode: '6281000000000' },
    ];

    it('تطابق حرفي كامل', () => {
        expect(matchPosBarcode(products, '6281000123456')).toEqual({
            status: 'matched',
            product: products[0],
        });
    });

    it('يقبل الأرقام العربية والفراغات', () => {
        expect(matchPosBarcode(products, ' ٦٢٨١٠٠٠١٢٣٤٥٦ ').status).toBe('matched');
    });

    it('يرفض الباركود المرتبط بأكثر من صنف', () => {
        expect(matchPosBarcode(products, '6281000000000').status).toBe('ambiguous');
    });

    it('لا يطابق جزئيًّا', () => {
        expect(matchPosBarcode(products, '628100012').status).toBe('not-found');
    });

    it('الفارغ يُعلن empty', () => {
        expect(matchPosBarcode(products, '   ').status).toBe('empty');
    });

    it('normalizeBarcode يوحّد الأرقام', () => {
        expect(normalizeBarcode(' ٦٢٨ ١٠٠')).toBe('628100');
    });
});
