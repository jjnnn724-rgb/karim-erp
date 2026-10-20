/**
 * riyadh-business-date.test.js — تاريخ يوم العمل بتوقيت الرياض
 * ─────────────────────────────────────────────────────────────
 * المشكلة: تواريخ القيود والإيرادات كانت مشتقة من toISOString() (UTC)،
 * فمبيعات الساعة 00:00–02:59 بتوقيت الرياض (UTC+3) كانت تُنسب لليوم
 * السابق — قيد في يوم خاطئ، وإيراد في يوم خاطئ، وتقرير CFO ناقص.
 *
 * الاختبار: وحدة مشتركة (riyadhDateOf) + حارس ساكن على المواضع الحرجة.
 */
const fs = require('fs');
const path = require('path');
const { riyadhDateOf, riyadhToday, riyadhMonth } = require('../backend/riyadh-date');

describe('تاريخ يوم العمل بتوقيت الرياض', () => {
    test('طابع بعد منتصف الليل بالرياض ينتمي ليومه لا لليوم السابق', () => {
        // 2026-10-20 01:00 Asia/Riyadh == 2026-10-19 22:00 UTC
        const ts = '2026-10-19T22:00:00.000Z';
        expect(new Date(ts).toISOString().slice(0, 10)).toBe('2026-10-19'); // UTC: اليوم السابق
        expect(riyadhDateOf(ts)).toBe('2026-10-20');                       // الرياض: اليوم الصحيح
    });

    test('طابع مساءً بالرياض ينتمي لنفسه', () => {
        // 2026-10-20 23:30 Asia/Riyadh == 2026-10-20 20:30 UTC
        expect(riyadhDateOf('2026-10-20T20:30:00.000Z')).toBe('2026-10-20');
    });

    test('حدود الساعة تُحسب بالرياض (00:00 و23:59)', () => {
        // 2026-10-20 00:00:00 الرياض == 2026-10-19 21:00 UTC
        expect(riyadhDateOf('2026-10-19T21:00:00.000Z')).toBe('2026-10-20');
        // 2026-10-20 23:59:59 الرياض == 2026-10-20 20:59:59 UTC
        expect(riyadhDateOf('2026-10-20T20:59:59.000Z')).toBe('2026-10-20');
    });

    test('قيمة غير صالحة ترجع لليوم الحالي بدل NaN', () => {
        expect(riyadhDateOf('not-a-date')).toBe(riyadhToday());
        expect(riyadhDateOf(undefined)).toBe(riyadhToday());
    });

    test('riyadhToday/riyadhMonth بصيغة صالحة', () => {
        expect(riyadhToday()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(riyadhMonth()).toMatch(/^\d{4}-\d{2}$/);
    });

    test('حارس ساكن: لا تاريخ مالي مشتق من UTC في المسارات الحرجة', () => {
        const saleSrc = fs.readFileSync(path.resolve(__dirname, '../backend/cashier-module/complete-sale.js'), 'utf8');
        expect(saleSrc).toContain('riyadhDateOf(orderRow.created_at');
        expect(saleSrc).not.toMatch(/orderRow\.created_at[\s\S]{0,80}toISOString\(\)/);

        const accSrc = fs.readFileSync(path.resolve(__dirname, '../backend/accounting-routes.js'), 'utf8');
        expect(accSrc).toContain('riyadhDateOf(o.created_at');
        expect(accSrc).not.toMatch(/o\.created_at[\s\S]{0,80}toISOString\(\)/);
        // نطاق اليوم في cfo-summary يُفسَّر بتوقيت الرياض لا بتوقيت الخادم
        expect(accSrc).toContain("AT TIME ZONE 'Asia/Riyadh'");
    });
});
