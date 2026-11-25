import { describe, expect, it } from 'vitest';
import { applyQuoteToPosTotals, calculatePosTotals, type PosCartLine, type PosQuoteLike } from './pos-pricing';

/**
 * مطابقة المعاينة مع الخادم: رد `/api/sales/quote` يجب أن يُترجم إلى نفس شكل
 * العرض المحلي بلا أي إعادة تسعير، ويرفض أي رد غير قابل للاستخدام.
 */

function line(overrides: Partial<PosCartLine> & Pick<PosCartLine, 'price'>): PosCartLine {
    return { id: '1', name: 'صنف', vatRate: 15, quantity: 1, ...overrides };
}

const cart: PosCartLine[] = [line({ id: '1', name: 'أ', price: 39.13 }), line({ id: '2', name: 'ب', price: 21.74 })];

function quote(overrides: Partial<PosQuoteLike> = {}): PosQuoteLike {
    return {
        subtotal: 60.87,
        discount_total: 0,
        tax_total: 9.13,
        total_amount: 70,
        line_items: [
            {
                product_id: 1,
                quantity: 1,
                unit_price: 39.13,
                discount: 0,
                vat_rate: 15,
                line_total: 39.13,
                vat_amount: 5.87,
                line_total_incl: 45,
            },
            {
                product_id: 2,
                quantity: 1,
                unit_price: 21.74,
                discount: 0,
                vat_rate: 15,
                line_total: 21.74,
                vat_amount: 3.26,
                line_total_incl: 25,
            },
        ],
        ...overrides,
    };
}

describe('applyQuoteToPosTotals', () => {
    it('ينقل أرقام الخادم كما هي (60.87 / 9.13 / 70.00)', () => {
        const totals = applyQuoteToPosTotals(quote(), cart, { type: '', value: '0' });
        expect(totals).not.toBeNull();
        expect(totals!.subtotal).toBe(60.87);
        expect(totals!.tax).toBe(9.13);
        expect(totals!.total).toBe(70);
        expect(totals!.items.map((row) => row.tax)).toEqual([5.87, 3.26]);
        expect(totals!.items.map((row) => row.subtotal)).toEqual([39.13, 21.74]);
    });

    it('يطابق الحساب المحلي عندما يعطي الخادم نفس الأرقام', () => {
        const local = calculatePosTotals(cart, { type: '', value: '0' });
        const server = applyQuoteToPosTotals(quote(), cart, { type: '', value: '0' });
        expect(server!.subtotal).toBe(local.subtotal);
        expect(server!.tax).toBe(local.tax);
        expect(server!.total).toBe(local.total);
    });

    it('يضيف الخصم مرة أخرى للوصول إلى ما قبل الخصم', () => {
        const totals = applyQuoteToPosTotals(quote({ subtotal: 55.87, discount_total: 5, tax_total: 9.13, total_amount: 65 }), cart, {
            type: 'fixed',
            value: '5',
        });
        expect(totals!.subtotalBeforeDiscount).toBe(60.87);
        expect(totals!.discount).toBe(5);
        expect(totals!.total).toBe(65);
    });

    it('يرفض ردًا غير متوازن بدل عرض أرقام لا تُجمع', () => {
        expect(applyQuoteToPosTotals(quote({ tax_total: 9.2 }), cart, { type: '', value: '0' })).toBeNull();
    });

    it('يرفض ردًا بعدد سطور مختلف عن السلة', () => {
        const partial = quote();
        partial.line_items = partial.line_items.slice(0, 1);
        expect(applyQuoteToPosTotals(partial, cart, { type: '', value: '0' })).toBeNull();
    });

    it('يورّث عدم صلاحية نسبة خصم فوق 100%', () => {
        const totals = applyQuoteToPosTotals(quote(), cart, { type: 'percent', value: '150' });
        expect(totals!.valid).toBe(false);
    });
});
