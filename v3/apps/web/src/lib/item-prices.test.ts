import { describe, expect, it } from 'vitest';
import { canonicalMoney, itemToPriceRow, priceTotals, sortPriceRows, stockValueText } from './item-prices';

describe('item-prices money math', () => {
    it('canonicalMoney يعيد MoneyString بمنزلتين ويتحمّل المدخلات التالفة', () => {
        expect(canonicalMoney('80')).toBe('80.00');
        expect(canonicalMoney('650.5')).toBe('650.50');
        expect(canonicalMoney('12.345')).toBe('12.35');
        expect(canonicalMoney('abc')).toBe('0.00');
        expect(canonicalMoney(null)).toBe('0.00');
        expect(canonicalMoney(undefined)).toBe('0.00');
    });

    it('stockValueText يحسب qty × avgCost بـBigInt بلا float', () => {
        expect(stockValueText('10', '80.00')).toBe('800.00');
        expect(stockValueText('5', '650.50')).toBe('3252.50');
        expect(stockValueText('3', '0.01')).toBe('0.03');
        expect(stockValueText('1.5', '10.00')).toBe('15.00');
        expect(stockValueText('0.333', '100.00')).toBe('33.30');
        expect(stockValueText('abc', '80.00')).toBe('0.00');
        expect(stockValueText('2', 'not-a-number')).toBe('0.00');
    });

    it('itemToPriceRow يبني الصف ويكشف التكلفة الصفرية', () => {
        const row = itemToPriceRow({ id: 7, name: 'صنف', qty: '4', avgCost: '25.00', unit: 'حبة' });
        expect(row.valueText).toBe('100.00');
        expect(row.zeroCost).toBe(false);
        const free = itemToPriceRow({ id: 8, name: 'بدون تكلفة', qty: '2', avgCost: '0' });
        expect(free.zeroCost).toBe(true);
        expect(free.valueText).toBe('0.00');
    });

    it('priceTotals يجمع القيم بـcents ويحدد الأعلى تكلفة', () => {
        const rows = [
            itemToPriceRow({ id: 1, name: 'أ', qty: '10', avgCost: '80.00' }),
            itemToPriceRow({ id: 2, name: 'ب', qty: '5', avgCost: '650.50' }),
            itemToPriceRow({ id: 3, name: 'ج', qty: '30', avgCost: '0' }),
        ];
        const totals = priceTotals(rows);
        expect(totals.items).toBe(3);
        expect(totals.zeroCost).toBe(1);
        expect(totals.valueText).toBe('4052.50');
        expect(totals.maxCostText).toBe('650.50');
        expect(totals.maxCostName).toBe('ب');
    });

    it('sortPriceRows يرتب بالتكلفة دون تعديل الأصل', () => {
        const rows = [
            itemToPriceRow({ id: 1, name: 'أ', qty: '1', avgCost: '80.00' }),
            itemToPriceRow({ id: 2, name: 'ب', qty: '1', avgCost: '650.50' }),
            itemToPriceRow({ id: 3, name: 'ج', qty: '1', avgCost: '10.00' }),
        ];
        const desc = sortPriceRows(rows, 'cost-desc');
        expect(desc.map((row) => row.id)).toEqual(['2', '1', '3']);
        expect(rows[0]?.id).toBe('1');
        const asc = sortPriceRows(rows, 'cost-asc');
        expect(asc.map((row) => row.id)).toEqual(['3', '1', '2']);
    });
});
