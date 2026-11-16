/**
 * buffet.test.js — اختبارات منطق كوست أصناف بوفيه الشرفة (بدون DB)
 *
 *   يغطّي: parsing عائد الوعاء، تحويل الوحدات داخل العائلات فقط،
 *   حساب التكلفة الحية (حي من أسعار المخزن الدّالة) مع:
 *     • الربط المباشر بوحدات متوافقة
 *     • عبوات الكيلو المعلومة وزنها («ملح ناعم 50 كيلو-كيس») → سعر الكيلو «تقديري»
 *     • سطور بلا ربط / بلا تحويل / بلا سعر → موسومة، لا أرقام مفترضة
 *     • عائد الوعاء لاستخراج حصة الشخص (35–40)
 */
'use strict';

const {
    normalizeName,
    stripPrep,
    parsePackKg,
    parseYieldGuests,
    convertQuantity,
    computeDishCost,
    summarizeDishes,
} = require('../backend/buffet-logic');

describe('تطبيع الأسماء', () => {
    test('يتجاهل التشكيل والهمزات والتاء المربوطة والألف الطويلة', () => {
        expect(normalizeName('بَصلٌ أَحْمَر')).toBe(normalizeName('بصل احمر'));
        expect(normalizeName('كُزبرة نَشْفة')).toBe(normalizeName('كزبره نشفه'));
    });
    test('يستخرج العنصر بعد حذف صفات التحضير', () => {
        expect(stripPrep('بصل شرائح رفيعة')).toBe('بصل');
        expect(stripPrep('جزر مكعبات صغيرة')).toBe('جزر');
        expect(stripPrep('طماطم مفروم')).toContain('طماطم');
    });
});

describe('parsePackKg — كيلوجرامات التعبئة من اسم الصنف', () => {
    test.each([
        ['ملح ناعم 50 كيلو-كيس', 50],
        ['ارز بسمتي20 كيلو بالشدة اليسرة', 20],
        ['دقيق فاخر45 كيلو-كيس', 45],
        ['أرز عنبر-بيشاور 40 كيلو راسخ كلاسيكي-كيس', 40],
        ['دقيق بر 10 كيلو بالكيس', 10],
    ])('«%s» → %i', (name, expected) => {
        expect(parsePackKg(name)).toBe(expected);
    });
    test.each([['أرز صنوايت'], ['بيض كرتون'], ['زبدة شفرات']])('بدون «N كيلو» في «%s» → null', (name) => {
        expect(parsePackKg(name)).toBeNull();
    });
});

describe('parseYieldGuests — عائد الوعاء', () => {
    test.each([
        ['سفنديش 5 سم — تكفي 35–40 شخص', { low: 35, high: 40 }],
        ['سفنديش 5 سم - تكفي 35-40 نفر', { low: 35, high: 40 }],
        ['تكفي 40 شخص', { low: 40, high: 40 }],
        ['تكفي 35—40 شخصًا', { low: 35, high: 40 }],
    ])('«%s»', (text, expected) => {
        expect(parseYieldGuests(text)).toEqual(expected);
    });
});

describe('convertQuantity — داخل العائلات فقط', () => {
    test.each([
        [1000, 'جرام', 'كيلو', 1],
        [2, 'كيلو', 'جرام', 2000],
        [500, 'مل', 'لتر', 0.5],
        [1.5, 'لتر', 'مل', 1500],
        [2, 'ملعقة كبيرة', 'مل', 30],
        [3, 'ملعقة صغيرة', 'مل', 15],
        [1, 'كوب', 'لتر', 0.24],
        [2, 'عدد / حبة', 'حبة', 2],
        [1e6, 'mg', 'كيلو', 1],
    ])('%s %s → %s = %s', (qty, from, to, expected) => {
        expect(convertQuantity(qty, from, to)).toBeCloseTo(expected, 10);
    });
    test.each([[1, 'كيس', 'كيلو'], [1, 'ملعقة كبيرة', 'كيلو'], [5, 'كرتون', 'كيس']])('لا تحويل لعائلة مختلفة: %s %s → %s', (qty, from, to) => {
        expect(convertQuantity(qty, from, to)).toBeNull();
    });
});

describe('computeDishCost — التكلفة الحية', () => {
    const inventory = new Map([
        ['710', { id: 710, name: 'ملح ناعم 50 كيلو-كيس', unit: 'كيس', avgCost: 22.00 }],
        ['720', { id: 720, name: 'ارز بسمتي20 كيلو بالشدة اليسرة', unit: 'شدة', avgCost: 110.05 }],
        ['730', { id: 730, name: 'كمون مطحون -كيلو', unit: 'كيلو', avgCost: 18.00 }],
        ['740', { id: 740, name: 'بيض', unit: 'كرتون', avgCost: 124.84 }],
        ['750', { id: 750, name: 'عدس احمر - كيس', unit: 'كيس', avgCost: 0 }], // بلا سعر معتمد
    ]);

    test('عبوة كيلو معلومة وزنها: سعر الكيس ÷ كجم التعبئة (تقديري موسوم)', () => {
        const out = computeDishCost({
            yields: 'سفنديش 5 سم — تكفي 35–40 شخص',
            ingredients: [{ id: 1, name: 'أرز بسمتي', qty: 3, unit: 'كيلو', inventoryId: 720, packKg: 20 }],
        }, inventory);
        expect(out.pricedLines).toBe(1);
        expect(out.unpricedLines).toBe(0);
        expect(out.batchCost).toBeCloseTo(3 * (110.05 / 20), 2);
        expect(out.lines[0].packUsed).toBe(true);
        expect(out.lines[0].avgCost).toBeCloseTo(5.5, 2);
        expect(out.perPerson).toEqual(expect.objectContaining({ guestsLow: 35, guestsHigh: 40 }));
    });

    test('سطر كيلو↔كيلو مباشر بدون pack_kg', () => {
        const out = computeDishCost({
            yields: '',
            ingredients: [{ id: 1, name: 'كمون', qty: 0.25, unit: 'كيلو', inventoryId: 730 }],
        }, inventory);
        expect(out.batchCost).toBeCloseTo(4.5, 2);
        expect(out.lines[0].packUsed).toBe(false);
    });

    test('سطر بلا ربط → unlinked ولا رقم', () => {
        const out = computeDishCost({ yields: '', ingredients: [{ id: 1, name: 'مرق دجاج', qty: 4.75, unit: 'لتر', inventoryId: null }] }, inventory);
        expect(out.pricedLines).toBe(0);
        expect(out.lines[0].state).toBe('unlinked');
        expect(out.lines[0].cost).toBeNull();
    });

    test('سطر بوحدة غير قابلة للتحويل → unconvertible', () => {
        const out = computeDishCost({
            yields: '',
            ingredients: [{ id: 1, name: 'ملح', qty: 2, unit: 'ملعقة كبيرة', inventoryId: 710, packKg: 50 }],
        }, inventory);
        expect(out.unpricedLines).toBe(1);
        expect(out.lines[0].state).toBe('unconvertible');
    });

    test('سطر بصنف مخزن بلا سعر → no_price', () => {
        const out = computeDishCost({
            yields: '',
            ingredients: [{ id: 1, name: 'عدس', qty: 2, unit: 'كيلو', inventoryId: 750, packKg: 15 }],
        }, inventory);
        expect(out.lines[0].state).toBe('no_price');
    });

    test('كرتون بيض للحبات → unconvertible ولا يُحسب برقم مفترض', () => {
        const out = computeDishCost({
            yields: '',
            ingredients: [{ id: 1, name: 'بيض', qty: 6, unit: 'عدد / حبة', inventoryId: 740 }],
        }, inventory);
        expect(out.lines[0].state).toBe('unconvertible');
    });
});

describe('summarizeDishes — ملخص التغطية', () => {
    test('يجمع المُسعَّر بالكامل/جزئي/بلا تسعير ويعيد عدّ السطور', () => {
        const s = summarizeDishes([
            { batchCost: 10, pricedLines: 2, unpricedLines: 0, totalLines: 2 },
            { batchCost: 20, pricedLines: 1, unpricedLines: 1, totalLines: 2 },
            { batchCost: 0, pricedLines: 0, unpricedLines: 3, totalLines: 3 },
        ]);
        expect(s).toEqual(expect.objectContaining({
            total: 3,
            pricedFull: 1,
            pricedPartial: 1,
            unpriced: 1,
            unpricedLineCount: 4,
            batchCostSum: 30,
        }));
    });
});
