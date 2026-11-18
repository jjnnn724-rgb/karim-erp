/**
 * late-notice-logic.test.js — اختبارات منطق إشعارات التأخير الشخصية
 * قرار المالك 2026-11-18: «تأخير» أقل من وردية كاملة (12س/10س)، وإلا فغياب.
 */
'use strict';

const { normalizeSaudiMobile, isLatenessWithinShift, formatLateNotice } = require('../backend/whatsapp-engine/late-notice-logic');

describe('normalizeSaudiMobile', () => {
    test('05xxxxxxxx يتحول لـ 9665xxxxxxxx', () => {
        expect(normalizeSaudiMobile('0551234567')).toBe('966551234567');
        expect(normalizeSaudiMobile('055 123 4567')).toBe('966551234567');
        expect(normalizeSaudiMobile('055-123-4567')).toBe('966551234567');
    });
    test('صيغ دولية تُقبل', () => {
        expect(normalizeSaudiMobile('+966551234567')).toBe('966551234567');
        expect(normalizeSaudiMobile('00966551234567')).toBe('966551234567');
        expect(normalizeSaudiMobile('966551234567')).toBe('966551234567');
        expect(normalizeSaudiMobile('551234567')).toBe('966551234567');
    });
    test('الأرقام غير الصالحة ترجع null', () => {
        expect(normalizeSaudiMobile('12')).toBeNull();         // زي ما هو مخزن فعلاً في employees.phone
        expect(normalizeSaudiMobile('9')).toBeNull();
        expect(normalizeSaudiMobile('—')).toBeNull();
        expect(normalizeSaudiMobile('')).toBeNull();
        expect(normalizeSaudiMobile(null)).toBeNull();
        expect(normalizeSaudiMobile(undefined)).toBeNull();
        expect(normalizeSaudiMobile('055123456')).toBeNull();  // ناقص رقم
    });
});

describe('isLatenessWithinShift', () => {
    test('عجز أقل من الوردية = تأخير يُرسل', () => {
        expect(isLatenessWithinShift(30, 12)).toBe(true);
        expect(isLatenessWithinShift(30, 10)).toBe(true);
        expect(isLatenessWithinShift(599, 10)).toBe(true);     // 9:59 < 10 س
        expect(isLatenessWithinShift(719, 12)).toBe(true);     // 11:59 < 12 س
    });
    test('عجز ≥ وردية كاملة = غياب، لا إشعار', () => {
        expect(isLatenessWithinShift(600, 10)).toBe(false);    // 10 س بالظبط = غياب
        expect(isLatenessWithinShift(720, 12)).toBe(false);    // 12 س بالظبط = غياب
        expect(isLatenessWithinShift(1400, 10)).toBe(false);   // أكثر من وردية
    });
    test('صفر/قيم تافهة = لا تأخير', () => {
        expect(isLatenessWithinShift(0, 12)).toBe(false);
        expect(isLatenessWithinShift(undefined, 12)).toBe(false);
        expect(isLatenessWithinShift(NaN, 12)).toBe(false);
    });
});

describe('formatLateNotice', () => {
    test('رسالة شخصية للموظف عن نفسه', () => {
        const text = formatLateNotice({ shiftStart: '07:00', lateMinutes: 95 });
        expect(text).toContain('أنت تأخرت');
        expect(text).toContain('1 س 35 د');
        expect(text).toContain('07:00');
        // بلا أسماء موظفين تانيين
        expect(text).not.toMatch(/عفيف|عبد|اشيق|شوكت/);
    });
    test('أقل من ساعة يظهر دقايق فقط', () => {
        expect(formatLateNotice({ shiftStart: '09:00', lateMinutes: 25 })).toContain('25 د');
    });
});
