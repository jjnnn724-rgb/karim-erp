import { describe, expect, test } from 'vitest';
import { isNumericId, isPositiveIntegerId } from './ids.js';

describe('isNumericId', () => {
    test('يقبل bigint كما يُسلسله pg', () => {
        expect(isNumericId('1794001627414356')).toBe(true);
        expect(isNumericId('9007199254740993')).toBe(true);
        expect(isNumericId('0')).toBe(true);
    });

    test('يرفض ما ليس نص أرقام', () => {
        expect(isNumericId(1794001627414356)).toBe(false);
        expect(isNumericId('12a')).toBe(false);
        expect(isNumericId('-1')).toBe(false);
        expect(isNumericId('')).toBe(false);
        expect(isNumericId('99999999999999999999')).toBe(false);
    });
});

describe('isPositiveIntegerId', () => {
    test('يقبل أعداد صحيحة موجبة آمنة', () => {
        expect(isPositiveIntegerId(1)).toBe(true);
        expect(isPositiveIntegerId(Number.MAX_SAFE_INTEGER)).toBe(true);
    });

    test('يرفض الصفر والسالب والكسر وما ليس رقمًا', () => {
        expect(isPositiveIntegerId(0)).toBe(false);
        expect(isPositiveIntegerId(-1)).toBe(false);
        expect(isPositiveIntegerId(1.5)).toBe(false);
        expect(isPositiveIntegerId('1')).toBe(false);
        expect(isPositiveIntegerId(Number.NaN)).toBe(false);
        expect(isPositiveIntegerId(Number.POSITIVE_INFINITY)).toBe(false);
    });
});
