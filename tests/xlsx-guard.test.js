/**
 * xlsx-guard.test.js — حراسة قراءة Excel (حدود الحجم والصفوف)
 * ──────────────────────────────────────────────────────────────
 * ملف Excel ضخم يستهلك ذاكرة جهاز الكاشير ويُجمّد المتصفح. الحراسة
 * ترفض قبل القراءة لا بعدها.
 */
const { assertFileSize, readWorkbook, ExcelGuardError, MAX_BYTES, MAX_ROWS } = require('../frontend/app/js/core/xlsx-guard.js');

function fakeXlsx(rowCount) {
    return {
        read: () => ({
            SheetNames: ['Sheet1'],
            Sheets: { Sheet1: { '!ref': `A1:A${rowCount}` } },
        }),
    };
}

describe('حراسة قراءة Excel', () => {
    test('حدود معقولة (لا تُسكِّر ملفًا مشروعًا)', () => {
        expect(MAX_BYTES).toBeGreaterThanOrEqual(5 * 1024 * 1024);
        expect(MAX_BYTES).toBeLessThanOrEqual(50 * 1024 * 1024);
        expect(MAX_ROWS).toBeGreaterThanOrEqual(5000);
    });

    test('يرفض الملف الضخم قبل القراءة', () => {
        expect(() => assertFileSize({ size: MAX_BYTES + 1, name: 'big.xlsx' }))
            .toThrow(/يتجاوز الحد/);
        expect(assertFileSize({ size: 1024, name: 'ok.xlsx' })).toBe(true);
        expect(assertFileSize(null)).toBe(true);
        expect(assertFileSize({})).toBe(true);
    });

    test('يرفض المصنَّف بعدد صفوف أكبر من الحد', () => {
        const xlsx = fakeXlsx(MAX_ROWS + 10);
        expect(() => readWorkbook(new ArrayBuffer(8), { type: 'array' }, xlsx))
            .toThrow(new RegExp(`الحد ${MAX_ROWS}`));
    });

    test('يقبل المصنَّف ضمن الحدود', () => {
        const xlsx = fakeXlsx(10);
        const wb = readWorkbook(new ArrayBuffer(8), { type: 'array' }, xlsx);
        expect(wb.SheetNames[0]).toBe('Sheet1');
    });

    test('يرفض البيانات التي تتجاوز حد الحجم', () => {
        const xlsx = fakeXlsx(1);
        expect(() => readWorkbook('x'.repeat(MAX_BYTES + 10), { type: 'string' }, xlsx))
            .toThrow(/يتجاوز الحد/);
    });

    test('رسالة الخطأ عربية صريحة (لا صمت)', () => {
        try {
            assertFileSize({ size: MAX_BYTES + 1 });
            throw new Error('كان يجب أن يفشل');
        } catch (e) {
            expect(e).toBeInstanceOf(ExcelGuardError);
            expect(e.message).toMatch(/MB/);
        }
    });

    test('بدون مكتبة Excel: خطأ واضح لا TypeError غامض', () => {
        expect(() => readWorkbook(new ArrayBuffer(8), {}, null)).toThrow(/مكتبة Excel غير محمّلة/);
    });
});
