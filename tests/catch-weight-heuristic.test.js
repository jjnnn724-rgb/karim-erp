/**
 * catch-weight-heuristic.test.js — كشف أصناف الوزن المتغير
 * يغطي الحالات الحقيقية من قاعدة البيانات: كتف غنم، عجل مقطع، فوركوارتر،
 * مقادم بقر، كبدة، خرفان، شحم بطن — والإيجابيات الكاذبة الموثقة:
 * بهارات للدجاج، جريش (يحوي "ريش")، والأصناف المخزونة بالكرتون.
 */
const { isWeightUnit, looksLikeMeat, suggestCatchWeight, MEAT_PATTERN } = require('../backend/catch-weight-heuristic');

describe('catch-weight-heuristic', () => {
    describe('isWeightUnit', () => {
        test.each(['كيلو', 'kg', 'كجم', 'كيلوجرام', 'جرام', 'غرام', 'g', 'KG'])('يتعرف على %s كوحدة وزن', (u) => {
            expect(isWeightUnit(u)).toBe(true);
        });
        test.each(['كرتون', 'قطعة', 'علبة', 'شكارة', 'لتر', 'ل', 'ml', 'كيس', ''])('يرفض %s', (u) => {
            expect(isWeightUnit(u)).toBe(false);
        });
        test('يتسامح مع الفراغات', () => {
            expect(isWeightUnit(' كيلو ')).toBe(true);
        });
    });

    describe('looksLikeMeat', () => {
        test.each([
            'كتف غنم ربع حمل امامي -كيلو',
            'عجل مقطع نيوزلاندي-كيلو',
            'فوركوارتر-كيلو',
            'مقادم بقر بالكيلو - كوارع بقر مجمدة',
            'خرفان-كيلو',
            'لحم مفروم',
            'صدور دجاج -كرتون',
            'روبي جامبو مجمد',
            'Beef Steak',
        ])('يتعرف "%s" كلحوم', (name) => {
            expect(looksLikeMeat(name)).toBe(true);
        });

        test.each([
            'شحم بطن',                       // قرار المالك: بالكيلو مباشرة — مش كرتون
            'كبدة باليكلو',                   // قرار المالك: بالكيلو مباشرة — مش كرتون
            'بهارات تكا - للدجاج بالكيلو',   // دجاج في الاسم لكنه بهارات
            'جريش اصفر بالكيلو',              // "جريش" تحوي "ريش"
            'البهارات السبع - كيلو',
            'زنجبيل مطحون -كيلو',
            'فلفل اسود حب -كيلو',
            'مرق دجاج مكعبات',
            'أرز بسمتي بالكيلو',
            'ماء',
            '',
            null,
        ])('يرفض "%s"', (name) => {
            expect(looksLikeMeat(name)).toBe(false);
        });
    });

    describe('suggestCatchWeight', () => {
        test('كتف غنم المخزون بالكيلو ⇒ وزن متغير بوحدة تعبئة كرتون', () => {
            expect(suggestCatchWeight('كتف غنم ربع حمل امامي -كيلو', 'كيلو')).toEqual({
                catch_weight_enabled: true,
                inventory_uom: 'kg',
                packaging_uom: 'كرتون',
                catch_weight_uom: 'kg',
            });
        });

        test('لحوم مخزونة بالكرتون ⇒ بلا تفعيل (الطلب والصرف فيه متطابقان)', () => {
            expect(suggestCatchWeight('صدور دجاج -كرتون', 'كرتون')).toBeNull();
        });

        test('بهارات بالكيلو ⇒ بلا تفعيل رغم ورود "دجاج" في الاسم', () => {
            expect(suggestCatchWeight('بهارات تكا - للدجاج بالكيلو', 'كيلو')).toBeNull();
        });

        test('جريش بالكيلو ⇒ بلا تفعيل رغم ورود "ريش"', () => {
            expect(suggestCatchWeight('جريش اصفر بالكيلو', 'كيلو')).toBeNull();
        });

        test('الشحم والكبدة بالكيلو ⇒ بلا تفعيل (قرار المالك — تُطلب بالكيلو مباشرة)', () => {
            expect(suggestCatchWeight('شحم بطن', 'كيلو')).toBeNull();
            expect(suggestCatchWeight('كبدة باليكلو', 'كيلو')).toBeNull();
        });

        test('صنف عادي بلا وزن متغير', () => {
            expect(suggestCatchWeight('بيبسي عادي -كرتون', 'كرتون')).toBeNull();
            expect(suggestCatchWeight('سكر شفرات', 'كرتون')).toBeNull();
        });
    });

    test('الأنماط تُصدَّر نصًا لاستخدامها في SQL (الميجريشن 085)', () => {
        expect(typeof MEAT_PATTERN).toBe('string');
        expect(MEAT_PATTERN).toContain('كتف');
        expect(MEAT_PATTERN).toContain('غنم');
    });
});
