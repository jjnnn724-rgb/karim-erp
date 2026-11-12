import { describe, expect, test } from 'vitest';
import { dateOnlyFromIso, dateOnlyToLegacyIso, isDateOnly, RIYADH_TIME_ZONE, riyadhToday } from './date-only.js';

describe('isDateOnly', () => {
    test.each(['2026-11-07', '2024-02-29', '2000-01-01', '9999-12-31'])('يقبل %s', (value) => {
        expect(isDateOnly(value)).toBe(true);
    });

    test.each(['2026-02-30', '2026-13-01', '2026-00-10', '2026-1-01', '26-01-01', '2026-01-01T00:00:00Z', ''])('يرفض «%s»', (value) => {
        expect(isDateOnly(value)).toBe(false);
    });

    test('يرفض غير النصوص', () => {
        expect(isDateOnly(20261107)).toBe(false);
        expect(isDateOnly(null)).toBe(false);
    });
});

describe('riyadhToday', () => {
    test('المنطقة الزمنية مثبتة في القرار', () => {
        expect(RIYADH_TIME_ZONE).toBe('Asia/Riyadh');
    });

    test('21:00Z = منتصف ليل الرياض ⇒ اليوم التالي', () => {
        expect(riyadhToday(new Date('2026-11-06T21:00:00.000Z'))).toBe('2026-11-07');
        expect(riyadhToday(new Date('2026-11-06T21:30:00.000Z'))).toBe('2026-11-07');
    });

    test('20:59Z لا يزال اليوم السابق — لا انزلاق UTC', () => {
        expect(riyadhToday(new Date('2026-11-06T20:59:59.999Z'))).toBe('2026-11-06');
    });

    test('بداية الشهر تُحسب بتوقيت الرياض', () => {
        expect(riyadhToday(new Date('2026-10-31T21:00:00.000Z'))).toBe('2026-11-01');
    });
});

describe('dateOnlyToLegacyIso / dateOnlyFromIso', () => {
    test('شكل القديم حرفيًا (21:00Z)', () => {
        expect(dateOnlyToLegacyIso('2026-11-07')).toBe('2026-11-06T21:00:00.000Z');
        expect(dateOnlyToLegacyIso('2026-01-01')).toBe('2025-12-31T21:00:00.000Z');
    });

    test('العكس يعيد نفس التاريخ', () => {
        expect(dateOnlyFromIso('2026-11-06T21:00:00.000Z')).toBe('2026-11-07');
        expect(dateOnlyFromIso('2026-11-06T20:59:59.999Z')).toBe('2026-11-06');
    });

    test('الدورة الكاملة عبر الشهر والسنة', () => {
        for (const day of ['2026-01-01', '2026-02-29', '2026-11-07', '2026-12-31']) {
            if (isDateOnly(day)) {
                expect(dateOnlyFromIso(dateOnlyToLegacyIso(day))).toBe(day);
            }
        }
    });

    test('يرفض تاريخًا غير صالح', () => {
        expect(() => dateOnlyToLegacyIso('2026-02-30')).toThrow(RangeError);
        expect(() => dateOnlyToLegacyIso('2026-11-7')).toThrow(RangeError);
    });

    test('يرفض توقيتًا غير صالح', () => {
        expect(() => dateOnlyFromIso('ليس توقيتًا')).toThrow(RangeError);
    });
});
