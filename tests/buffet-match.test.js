/**
 * buffet-match.test.js — محرك ربط مكوّنات البوفيه بأصناف المخزن
 *
 *   يتحقق من: تطابق كامل، رفض مصنّع ضد خام، تفكيك التعبئة (N كيلو) إلى
 *   سعر كيلو، تجميع الاقتراحات حسب اسم المكوّن، وترتيب الدرجات.
 *   لا DB — كل المخزون مصطنع هنا (بديل محدود لحظة الاختبار).
 */
'use strict';

const { scoreMatch, proposeLinks, groupProposals, norm } = require('../backend/buffet-match');

const INVENTORY = [
    { id: 1, name: 'ملح ناعم 50 كيلو-كيس', unit: 'كيس', avgCost: 22.00 },
    { id: 2, name: 'فلفل اسود حب -كيلو', unit: 'كيلو', avgCost: 30.28 },
    { id: 3, name: 'ارز بسمتي20 كيلو بالشدة اليسرة', unit: 'شدة', avgCost: 110.05 },
    { id: 4, name: 'زبدة زبده ذبدة نباتي بلوك بالباكت', unit: 'باكت', avgCost: 18.76 },
    { id: 5, name: 'بصل بودر أبيض', unit: 'كيلو', avgCost: 10.44 },
    { id: 6, name: 'سكر سعودي-كيس', unit: 'كيس', avgCost: 116.86 },
    { id: 7, name: 'سمن شوكة وملعقة 15 كيلو', unit: 'تنك', avgCost: 195.00 },
];

const idf = require('../backend/buffet-match').buildIdf(INVENTORY).idf;

describe('norm — تطبيع الأسماء', () => {
    test('يزيل التشكيل والهمزات ويوحد تاء مربوطة', () => {
        expect(norm('بَصلٌ أَحْمَر')).toBe(norm('بصل احمر'));
        expect(norm('أرز بسمتي')).toBe(norm('ارز بسمتي'));
    });
});

describe('scoreMatch — التحكيم بين مرشحين', () => {
    test('تطابق كامل → 1.0 مع السبب', () => {
        const r = scoreMatch('ملح', INVENTORY[0], idf);
        expect(r.score).toBeGreaterThanOrEqual(0.7);
        expect(r.packKg).toBe(50);
        expect(r.reasons.join(' ')).toContain('50 كجم');
    });

    test('ارز بسمتي → pack parse يستنتج 20 كجم («ارز بسمتي20 كيلو»)', () => {
        const r = scoreMatch('ارز بسمتي', INVENTORY[2], idf);
        expect(r.packKg).toBe(20);
        expect(r.score).toBeGreaterThanOrEqual(0.5);
    });

    test('زبدة → زبدة بلوك (توكنز متداخلة)', () => {
        const r = scoreMatch('زبدة', INVENTORY[3], idf);
        expect(r.score).toBeGreaterThanOrEqual(0.5);
    });

    test('مصنّع ضد خام → مرفوض (0.0)', () => {
        const r = scoreMatch('بصل', INVENTORY[4], idf); // بصل بودر ≠ بصل طازج
        expect(r.score).toBe(0.0);
        expect(r.reasons.join(' ')).toContain('مرفوض');
    });

    test('لا تشابه إطلاقًا → 0.0', () => {
        const r = scoreMatch('لحم بقري', INVENTORY[0], idf);
        expect(r.score).toBe(0.0);
    });
});

describe('proposeLinks + groupProposals — تجميع وتوصية', () => {
    test('proposeLinks يرجع أفضل اقتراح وخيارات مرتبة', () => {
        const { proposals } = proposeLinks(
            [
                { id: 101, name: 'ملح', qty: 2, unit: 'ملعقة كبيرة' },
                { id: 102, name: 'زعفران', qty: 1, unit: 'رشة' },
            ],
            INVENTORY,
        );
        const salt = proposals.find((p) => p.lineId === 101);
        expect(salt.best).not.toBe(null);
        expect(salt.best.inventoryId).toBe('1');
        expect(salt.best.packKg).toBe(50);
        expect(salt.all.length).toBeGreaterThanOrEqual(1);
        // «زعفران» غير موجود في المخزن المصطنع — يُرجع بلا اقتراح
        const saffron = proposals.find((p) => p.lineId === 102);
        expect(saffron.best).toBe(null);
    });

    test('groupProposals يجمع السطور المتطابقة ويحسب العدد', () => {
        const { proposals } = proposeLinks(
            [
                { id: 201, name: 'ملح', qty: 1, unit: 'ملعقة كبيرة' },
                { id: 202, name: 'ملح', qty: 2, unit: 'ملعقة كبيرة' },
                { id: 203, name: 'زبدة', qty: 150, unit: 'جرام' },
            ],
            INVENTORY,
        );
        const groups = groupProposals(proposals);
        const salt = groups.find((g) => g.name === 'ملح');
        expect(salt.lines.map((l) => l.id).sort()).toEqual([201, 202]);
        expect(salt.lines).toHaveLength(2);
        const butter = groups.find((g) => g.name === 'زبدة');
        expect(butter.best.inventoryId).toBe('4');
    });
});
