import { describe, expect, test } from 'vitest';
import { addMoney, fromCents, isMoneyString, MONEY_PATTERN, MoneyFormatError, roundHalfUp, sumMoney, toCents } from './money.js';

describe('isMoneyString', () => {
    test.each(['0', '0.00', '40', '-40', '12345678901234', '12345678901234.99', '0.05', '-0.99'])('يقبل %s', (value) => {
        expect(isMoneyString(value)).toBe(true);
    });

    test.each(['', ' ', '1.', '.5', '1.234', '1,000', '1e5', '−40', '123456789012345', '12.3.4', ' 40 '])('يرفض «%s»', (value) => {
        expect(isMoneyString(value)).toBe(false);
    });

    test('يرفض غير النصوص', () => {
        expect(isMoneyString(40)).toBe(false);
        expect(isMoneyString(null)).toBe(false);
        expect(isMoneyString(undefined)).toBe(false);
    });

    test('النمط نفسه محصَّن ضد الحانتين الزائدتين', () => {
        expect(MONEY_PATTERN.test('1.230')).toBe(false);
    });
});

describe('toCents / fromCents', () => {
    test('يكافئ المليم بدقة', () => {
        expect(toCents('0.01')).toBe(1n);
        expect(toCents('40')).toBe(4000n);
        expect(toCents('-40.50')).toBe(-4050n);
        expect(toCents('0.1')).toBe(10n);
    });

    test('من المليم إلى نص بحانتين دائمًا', () => {
        expect(fromCents(0n)).toBe('0.00');
        expect(fromCents(5n)).toBe('0.05');
        expect(fromCents(-5n)).toBe('-0.05');
        expect(fromCents(4000n)).toBe('40.00');
        expect(fromCents(-123456n)).toBe('-1234.56');
    });

    test('دورة كاملة لا تفقد خانة', () => {
        for (const value of ['0.00', '0.01', '999.99', '-999.99', '12345678901234.99']) {
            expect(fromCents(toCents(value))).toBe(value);
        }
    });

    test('قيمة خارج الصيغة ترمي MoneyFormatError', () => {
        expect(() => toCents('1.234')).toThrow(MoneyFormatError);
        expect(() => toCents('abc')).toThrow(MoneyFormatError);
        let caught: unknown;
        try {
            toCents('1.234');
        } catch (error) {
            caught = error;
        }
        expect(caught).toBeInstanceOf(MoneyFormatError);
        expect(caught instanceof MoneyFormatError ? caught.name : null).toBe('MoneyFormatError');
    });
});

describe('addMoney / sumMoney', () => {
    test('جمع بلا خطأ Float التراكمي', () => {
        expect(addMoney('0.10', '0.20')).toBe('0.30');
        expect(addMoney('0.1', '0.2', '0.3')).toBe('0.60');
    });

    test('يتجاوز حد الدقة المزدوجة بلا فقدان', () => {
        expect(addMoney('12345678901234.99', '0.01')).toBe('12345678901235.00');
    });

    test('الإشارات تتعادل وتُطبَّع', () => {
        expect(addMoney('100.50', '-100.50')).toBe('0.00');
        expect(addMoney('-5.25', '-4.75')).toBe('-10.00');
    });

    test('المجموعة الفارغة صفر', () => {
        expect(sumMoney([])).toBe('0.00');
        expect(addMoney()).toBe('0.00');
    });

    test('sumMoney مطابق لـ addMoney', () => {
        const values = ['1.11', '2.22', '-3.33', '0.01'];
        expect(sumMoney(values)).toBe(addMoney(...values));
    });
});

describe('roundHalfUp', () => {
    test.each([
        ['100.005', '100.01'],
        ['100.004', '100.00'],
        ['13.04', '13.04'],
        ['9.995', '10.00'],
        ['0.005', '0.01'],
        ['-1.005', '-1.01'],
        ['-1.004', '-1.00'],
        ['-0.004', '0.00'],
        ['250.75', '250.75'],
    ])('%s ← %s', (input, expected) => {
        expect(roundHalfUp(input)).toBe(expected);
    });

    test('خانات عشرية مختلفة', () => {
        expect(roundHalfUp('2.5', 0)).toBe('3');
        expect(roundHalfUp('2.4', 0)).toBe('2');
        expect(roundHalfUp('1.23456', 4)).toBe('1.2346');
        expect(roundHalfUp('1.2', 4)).toBe('1.2000');
    });

    test('يرفض عدد الخانات خارج 0..8', () => {
        expect(() => roundHalfUp('1.5', -1)).toThrow(MoneyFormatError);
        expect(() => roundHalfUp('1.5', 9)).toThrow(MoneyFormatError);
        expect(() => roundHalfUp('1.5', 1.5)).toThrow(MoneyFormatError);
    });

    test('يرفض نصًا غير عشري', () => {
        expect(() => roundHalfUp('abc')).toThrow(MoneyFormatError);
        expect(() => roundHalfUp('1e3')).toThrow(MoneyFormatError);
    });
});
