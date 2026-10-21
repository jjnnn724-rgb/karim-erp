/**
 * v2-board-portrait.test.js — عقد لوحة المنيو V2 (البند ٨)
 * ═══════════════════════════════════════════════════════════════════════════
 * شاشة المنيو الجديدة لا تُلغي القديمة: menu-board.html وjs/menu-board.js
 * لم يُلْمسا (عمل غير محفوظ لغيري). لذلك يُثبَّت هنا أمران:
 *   ١) قواعد البيانات منقولة بأمانة عن اللوحة القديمة — الفترات، إسناد
 *      التصنيفات، التدوير، ولا سعر مُختلَق ولا «نفد» مُختلَق.
 *   ٢) لا كانفس ثابت: التقطيع بالسعة المقاسة، والنطاقات بحسب نسبة الأبعاد.
 * المصادر خالصة (لا DOM ولا شبكة)، فتُحمَّل بـ new Function بعد تجريد export.
 */
const fs = require('fs');
const path = require('path');

const APP = path.join(__dirname, '..', 'frontend', 'app');
const BOARD = path.join(APP, 'js', 'v2', 'board');
const DATA_SRC = fs.readFileSync(path.join(BOARD, 'board-data.js'), 'utf8');
const PORTRAIT_SRC = fs.readFileSync(path.join(BOARD, 'portrait.js'), 'utf8');
const BOOT_SRC = fs.readFileSync(path.join(BOARD, 'boot.js'), 'utf8');
const CSS_SRC = fs.readFileSync(path.join(APP, 'css', 'v2', 'erp-board.css'), 'utf8');
const SCREEN_SRC = fs.readFileSync(path.join(APP, 'js', 'v2', 'screens', 'menu-board.js'), 'utf8');
const LEGACY_SRC = fs.readFileSync(path.join(APP, 'js', 'menu-board.js'), 'utf8');

const NAMES = ['PERIODS', 'DEFAULT_STARTS', 'DWELL_DEFAULT_MS', 'DWELL_CURRENT_MS',
    'BOARD_CACHE_KEY', 'LANGUAGE_KEY', 'MIN_ITEMS_PER_PAGE', 'MAX_ITEMS_PER_PAGE',
    'parseHours', 'startMinutes', 'scheduleStarts', 'periodAtMinute', 'categoryPeriod',
    'catEn', 'catTitleEn', 'bilingual', 'priceOf', 'sanitizeCapacity', 'chunk',
    'buildPages', 'buildWeeklyPages', 'cyclePlan', 'dominantIndex', 'buffetPeriodKey',
    'buffetPage', 'isBuffetEnabled', 'buffetPriceLine', 'tickerText',
    'buffetPriceParts', 'BUFFET_SECTIONS', 'BUFFET_FIXED_LINES', 'BUFFET_MAINS_COLUMNS',
    'MAX_BUFFET_MAINS', 'MAX_BUFFET_SOUPS',
    'isValidPayload', 'fingerprint', 'buffetStamp', 'isCacheFresh', 'normalizeLanguage', 'aspectBand',
    'columnsForBand', 'rowsForBox', 'capacityForBox', 'comfortRowHeight', 'MIN_CARD_CQMIN', 'DEFAULT_FOOTERS'];

const d = new Function(`${DATA_SRC.replace(/^export\s+/gm, '')}\nreturn {${NAMES.join(', ')}};`)();

const SETTINGS = {
    breakfast_start: '05:00', lunch_start: '12:00', dinner_start: '17:00',
    breakfast_hours: '05:00 - 11:30', lunch_hours: '12:00 - 16:30', dinner_hours: '17:00 - 24:00',
};

describe('الفترات — نفس قواعد اللوحة القديمة', () => {
    test.each([[0, 'dinner'], [299, 'dinner'], [300, 'breakfast'], [719, 'breakfast'],
        [720, 'lunch'], [1019, 'lunch'], [1020, 'dinner'], [1439, 'dinner']])(
        'الدقيقة %i → %s', (minute, expected) => {
            expect(d.periodAtMinute(minute, SETTINGS)).toBe(expected);
        });

    test('بلا إعدادات: 05:00 / 12:00 / 17:00 نفسها', () => {
        expect(d.scheduleStarts({})).toEqual({ breakfast: '05:00', lunch: '12:00', dinner: '17:00' });
        expect(d.periodAtMinute(600, null)).toBe('breakfast');
    });

    test('الوراثة: *_hours وحدها تكفي، والصيغة الفاسدة تُتجاهل', () => {
        expect(d.startMinutes({ lunch_hours: '13:15 - 16:00' }, 'lunch')).toBe(13 * 60 + 15);
        expect(d.startMinutes({ lunch_start: '25:00', lunch_hours: '13:00 - 16:00' }, 'lunch')).toBe(13 * 60);
        expect(d.parseHours('بلا صيغة')).toBeNull();
    });

    test('الإسناد: إعداد التصنيف يغلب اسم التصنيف (قاعدة menu-board.js)', () => {
        expect(d.categoryPeriod('المشاوي')).toBeNull();
        expect(d.categoryPeriod('فطار بلدي')).toBe('breakfast');
        expect(d.categoryPeriod('Dinner Grills')).toBe('dinner');
        const pages = d.buildPages({
            categories: [{ name: 'المشاوي', items: [{ name: 'مندي' }] }],
            settings: { ...SETTINGS, lunch_category: 'المشاوي' },
            capacity: 10,
        });
        expect(pages[0].period).toBe('lunch');
    });

    test('مطابقة اللوحة القديمة على بيانات نموذجية', () => {
        const legacyPeriods = (t) => {
            const s = SETTINGS;
            const readStart = (v, r, f) => { const m = String(v || '').match(/^([01]\d|2[0-3]):([0-5]\d)$/); if (m) {return Number(m[1]) * 60 + Number(m[2]);} const l = d.parseHours(r); return l ? l[0] : f; };
            const breakfast = readStart(s.breakfast_start, s.breakfast_hours, 5 * 60);
            const lunch = readStart(s.lunch_start, s.lunch_hours, 12 * 60);
            const dinner = readStart(s.dinner_start, s.dinner_hours, 17 * 60);
            if (t >= dinner || t < breakfast) { return 'dinner'; }
            return t >= lunch ? 'lunch' : 'breakfast';
        };
        for (let m = 0; m < 1440; m++) {
            expect(d.periodAtMinute(m, SETTINGS)).toBe(legacyPeriods(m));
        }
    });
});

describe('الصفحات — تُقطَّع على السعة المقاسة لا على عشرة ثابتة', () => {
    const cats = [
        { name: 'فطار', items: Array.from({ length: 7 }, (_, i) => ({ id: i, name: `صنف ${i}`, name_en: `Item ${i}`, image: null, sold_out: false })) },
        { name: 'غداء', items: [{ name: 'مندي لحم', name_en: 'Lamb Mandi', sold_out: false }] },
        { name: 'فارغ', items: [] },
    ];

    test('سعة 4 → صفحتان بعناوين (1/2) و(2/2)، والصنف الفارغ لا صفحة له', () => {
        const pages = d.buildPages({ categories: cats, settings: SETTINGS, capacity: 4 });
        expect(pages.map((p) => p.title)).toEqual(['فطار  (1/2)', 'فطار  (2/2)', 'غداء']);
        expect(pages[0].items).toHaveLength(4);
        expect(pages[1].items).toHaveLength(3);
    });

    test('لا سعر مُختلَق: أصناف التصنيفات price=null ولو طلب أحدها 0', () => {
        const pages = d.buildPages({ categories: [{ name: 'غداء', items: [{ name: 'سك', price: 0 }, { name: 'مندي' }] }], settings: {}, capacity: 10 });
        expect(pages[0].items.map((i) => i.price)).toEqual([null, null]);
    });

    test('«نفدت» تُعرض فقط عندما تأتي صحيحة من الخادم', () => {
        const pages = d.buildPages({ categories: [{ name: 'غداء', items: [{ name: 'أ', sold_out: false }, { name: 'ب', sold_out: true }] }], settings: {}, capacity: 10 });
        expect(pages[0].items.map((i) => i.soldOut)).toEqual([false, true]);
    });

    test('الأسبوعي: سعر حقيقي فقط، وملاحظة اليوم البديلة', () => {
        const pages = d.buildWeeklyPages({ weekly: { title: 'منيو اليوم', note: '', items: [{ name: 'كبدة', name_en: 'F Liver', price: '25.5' }, { name: 'شاورما', price: 0 }] }, capacity: 10, period: 'lunch', dayName: 'الاثنين' });
        expect(pages[0].items[0].price).toBe(25.5);
        expect(pages[0].items[1].price).toBeNull();
        expect(pages[0].note).toBe('الاثنين');
        expect(pages[0].period).toBe('lunch');
        expect(d.catTitleEn(pages[0].title)).toBe('TODAY SPECIAL · OPEN BUFFET');
    });

    test('السعة تُصلَّح ولا تنكسر: 0/-3/كسور/kبيرة', () => {
        expect(d.sanitizeCapacity(0)).toBe(d.MIN_ITEMS_PER_PAGE);
        expect(d.sanitizeCapacity(-3)).toBe(d.MIN_ITEMS_PER_PAGE);
        expect(d.sanitizeCapacity(9999)).toBe(d.MAX_ITEMS_PER_PAGE);
        expect(d.sanitizeCapacity(7.9)).toBe(7);
    });

    test('ثنائي دائمًا: الأساسي والمقابل لا يتكرران', () => {
        expect(d.bilingual({ name: 'مندي', name_en: 'Mandi' }, 'ar')).toEqual({ primary: 'مندي', secondary: 'Mandi' });
        expect(d.bilingual({ name: 'مندي', name_en: '' }, 'ar').secondary).toBe('');
        expect(d.bilingual({ name: 'مندي', name_en: 'مندي' }, 'ar').secondary).toBe('');
    });
});

describe('التدوير — نفس قاعدة اللوحة القديمة: فترة الوجبة الحالية فقط', () => {
    const pages = [
        { period: 'breakfast' }, { period: 'lunch' }, { period: 'lunch' }, { period: null },
    ];

    test('صفحتان للغداء: يدور بينهما فقط بمدة أطول', () => {
        const plan = d.cyclePlan({ pages, period: 'lunch', index: 1 });
        expect(plan.indices).toEqual([1, 2]);
        expect(plan.next).toBe(2);
        expect(plan.dwellMs).toBe(d.DWELL_CURRENT_MS);
    });

    test('صفحة مهيمنة واحدة: تبقى بلا انقلاب', () => {
        const single = [{ period: 'lunch' }, { period: 'dinner' }];
        expect(d.cyclePlan({ pages: single, period: 'lunch', index: 0 }).next).toBeNull();
    });

    test('لا أصناف للفترة الحالية: يدور على الكل بالمدة الافتراضية', () => {
        const plan = d.cyclePlan({ pages: [{ period: 'lunch' }], period: 'dinner', index: 0 });
        expect(plan.scope).toBe('all');
        expect(plan.dwellMs).toBe(d.DWELL_DEFAULT_MS);
        expect(plan.next).toBe(0);
        const two = d.cyclePlan({ pages: [{ period: 'lunch' }, { period: 'breakfast' }], period: 'dinner', index: 0 });
        expect(two.next).toBe(1);
    });

    test('المؤشر خارج مجموعة الفترة يقفز إلى أولها', () => {
        expect(d.cyclePlan({ pages, period: 'lunch', index: 0 }).next).toBe(1);
        expect(d.dominantIndex(pages, 'dinner')).toBe(0);
        expect(d.dominantIndex(pages, 'lunch')).toBe(1);
    });

    test('بلا صفحات: حالة فارغة آمنة', () => {
        expect(d.cyclePlan({ pages: [], period: 'lunch', index: 0 })).toEqual({ indices: [], next: null, dwellMs: d.DWELL_DEFAULT_MS, scope: 'empty' });
    });
});

describe('البوفيه — صفحة واحدة ثابتة التكوين بترتيب المالك', () => {
    const sections = {
        enabled: true,
        mains_by_period: { breakfast: [], lunch: [{ name: 'مندي' }, { name: 'كسكة' }], dinner: [{ name: 'مظبي' }] },
        mains: [{ name: 'مندي' }, { name: 'كسكة' }],
        soups: [{ name: 'شوربة دجاج' }],
        appetizers: [{ name: 'سمبوسة' }, { name: 'تمس' }],
        salads: [{ name: 'فتوش' }],
        desserts: [{ name: 'كنافة' }],
        carving: { lunch: { name: 'عظم كباب' }, dinner: null },
    };

    test('ترتيب المالك حرفيًا: شوربة ← كارفن ← الأطباق ← الجملتان ← (السعر في الرسم)', () => {
        const page = d.buffetPage(sections, 'lunch');
        expect(page.top.map((p) => p.key)).toEqual(['soups', 'carving']);
        expect(page.top.map((p) => p.ar)).toEqual(['الشوربات', 'ركن الشواء']);
        expect(page.mains.map((m) => m.name)).toEqual(['مندي', 'كسكة']);
        expect(page.lines.map((l) => l.key)).toEqual(['desserts', 'salads']);
        expect(page.lines.map((l) => l.ar)).toEqual([
            'مجموعة متنوعة من الحلويات الشرقية والغربية',
            'مجموعة متنوعة من السلطات الشرقية والغربية',
        ]);
    });

    test('صفحة واحدة: لا سعة تُمرَّر ولا لوح يُشطر — والأطباق العشرة خمسة صفوفٍ في عمودين', () => {
        expect(d.buffetPage).toHaveLength(2);
        expect(d.BUFFET_MAINS_COLUMNS).toBe(2);
        const ten = { ...sections, mains_by_period: { lunch: Array.from({ length: 10 }, (_, i) => ({ name: `ص${i}` })) } };
        const page = d.buffetPage(ten, 'lunch');
        expect(page.cols).toBe(2);
        expect(page.rows).toBe(5);
        expect(page.mains).toHaveLength(10);
    });

    test('الحلويات والسلطات جملتان ثابتتان لا قائمتا أصناف — وبلا صنفٍ لا جملة', () => {
        expect(d.BUFFET_FIXED_LINES.desserts.en).toContain('desserts');
        expect(d.BUFFET_FIXED_LINES.salads.ar).toContain('السلطات الشرقية والغربية');
        expect(d.buffetPage({ ...sections, desserts: [], salads: [] }, 'lunch').lines).toEqual([]);
        expect(d.buffetPage({ ...sections, salads: [] }, 'lunch').lines.map((l) => l.key)).toEqual(['desserts']);
    });

    test('المقبلات خارج لوحة البوفيه بقرار المالك — والباب ما زال يرسلها', () => {
        expect(JSON.stringify(d.buffetPage(sections, 'lunch'))).not.toContain('سمبوسة');
        expect(sections.appetizers.length).toBe(2);
        /* القديمة أسقطتها بلا قرار (menu-board.js لا يقرأ sections.appetizers) */
        expect(LEGACY_SRC).not.toMatch(/sections\.appetizers/);
    });

    test('سقوف الباب: عشرة أطباق وشوربتان — حرسٌ لا قرار', () => {
        expect(d.MAX_BUFFET_MAINS).toBe(10);
        expect(d.MAX_BUFFET_SOUPS).toBe(2);
        const fat = {
            ...sections,
            mains_by_period: { lunch: Array.from({ length: 14 }, (_, i) => ({ name: `ص${i}` })) },
            soups: [{ name: 'أ' }, { name: 'ب' }, { name: 'ج' }],
        };
        const page = d.buffetPage(fat, 'lunch');
        expect(page.mains).toHaveLength(10);
        expect(page.top.find((p) => p.key === 'soups').items).toHaveLength(2);
    });

    test('الفترات: العشاء بوجهه، والغداء/الفطار بلوح الغداء، والكارفن يغيب إذا غاب', () => {
        expect(d.buffetPeriodKey('breakfast')).toBe('lunch');
        expect(d.buffetPeriodKey('dinner')).toBe('dinner');
        const dinner = d.buffetPage(sections, 'dinner');
        expect(dinner.mains[0].name).toBe('مظبي');
        expect(dinner.top.map((p) => p.key)).toEqual(['soups']);
        expect(dinner.topCols).toBe(1);
    });

    test('بلا شيء يُرسم: لا صفحة فارغة ولا استثناء', () => {
        expect(d.buffetPage({ enabled: true }, 'lunch')).toBeNull();
        expect(d.buffetPage(null, 'lunch')).toBeNull();
    });

    test('سعر البوفيه: من الإعدادات مخزّنًا، وبلا اختراع عند رقمٍ فاسد', () => {
        expect(d.buffetPriceParts({ buffet_price: '95' })).toMatchObject({ value: '95', label: { ar: 'سعر البوفيه' } });
        expect(d.buffetPriceParts({}).value).toBe('75');
        expect(d.buffetPriceParts({ buffet_price: 'ليس رقمًا' }).value).toBe('75');
        expect(d.buffetPriceParts({ buffet_price: 80.5 }).value).toBe('80.5');
        expect(d.buffetPriceParts({ buffet_price: 75 }).currency).toEqual({ ar: 'ريال', en: 'SAR' });
    });

    test('مفعّل فقط عند وجود أطباق فترة واحدة', () => {
        expect(d.isBuffetEnabled(sections)).toBe(true);
        expect(d.isBuffetEnabled({ enabled: true, mains_by_period: { lunch: [], dinner: [] } })).toBe(false);
        expect(d.isBuffetEnabled(null)).toBe(false);
    });
});

describe('الشريط والساعة والكاش', () => {
    test('سطر البوفيه ثابت ولو غيّر المالك التذييل، والتذييل الافتراضي لا يتكرر', () => {
        const plain = d.tickerText({ buffet_price: 75, footer_text: '' });
        expect(plain).toContain('OPEN BUFFET · 75 ريال / SAR per person');
        const custom = d.tickerText({ buffet_price: 80.5, footer_text: 'أهلا بكم' });
        expect(custom).toContain('80.5');
        expect(custom).toContain('أهلا بكم');
        expect(custom.endsWith('✦')).toBe(true);
    });

    test('نفس صيغة السطر لدى اللوحة القديمة (ريال / SAR per person)', () => {
        expect(LEGACY_SRC).toContain('ريال / SAR per person');
        expect(d.buffetPriceLine({ buffet_price: '90' })).toBe('بوفيه مفتوح · OPEN BUFFET · 90 ريال / SAR per person');
    });

    test('بصمة البيانات: تتغير مع الإعدادات لا مع ترتيب الأصناف وحده', () => {
        const a = d.fingerprint({ version: '1', settings: { x: 1 }, categories: [] });
        const b = d.fingerprint({ version: '1', settings: { x: 1 }, categories: [{ name: 'غداء', items: [] }] });
        expect(a).toBe(b);
        expect(d.fingerprint({ version: '2', settings: { x: 1 } })).not.toBe(a);
    });

    test('البوفيه داخل البصمة: تفعيله يُعيد الرسم ولو لم تتغير version', () => {
        // الخادم يبني version من أصناف المنيو/الإعدادات/الأسبوعي فقط — تخطيط البوفيه لا يمسّها
        const base = { version: '1', settings: { x: 1 } };
        const off = d.fingerprint({ ...base, buffet_sections: { enabled: false, mains_by_period: {} } });
        const on = d.fingerprint({ ...base, buffet_sections: { enabled: true, mains_by_period: { lunch: [{ id: 1 }], dinner: [], breakfast: [] } } });
        expect(off).not.toBe(on);
        // عدد أصناف الفترة له وزن، وترتيب الفترات نفسه لا يغيّر الطابع
        expect(d.buffetStamp({ enabled: true, mains_by_period: { breakfast: [1, 2], lunch: [], dinner: [] } }))
            .toBe(d.buffetStamp({ enabled: true, mains_by_period: { lunch: [], breakfast: [1, 2], dinner: [] } }));
        expect(d.buffetStamp({ enabled: true, mains_by_period: { breakfast: [1], lunch: [], dinner: [] } }))
            .not.toBe(d.buffetStamp({ enabled: true, mains_by_period: { breakfast: [1, 2], lunch: [], dinner: [] } }));
        // ركن الشواء: تغيير الصنف يعني تغيير البصمة، وغيابه عن فترة لا يُسقط الأخرى
        const carve = (v) => d.buffetStamp({ enabled: true, carving: { lunch: v, dinner: null } });
        expect(carve({ id: 7, name: 'كباب' })).not.toBe(carve({ id: 8, name: 'مظبي' }));
        expect(carve(null)).not.toBe(carve({ id: 7, name: 'كباب' }));
        // بلا sections إطلاقًا: طابع ثابت لا ينفجر
        expect(d.buffetStamp(undefined)).toBe(d.buffetStamp({}));
    });

    test('الكاش: مفتاح خاص بالـV2 ولا يلمس مفتاح اللوحة القديمة، وسقف ٧ أيام', () => {
        expect(d.BOARD_CACHE_KEY).toBe('karim_v2_board_last_response');
        expect(LEGACY_SRC).toContain("const BOARD_CACHE_KEY = 'menu_board_last_successful_response'");
        expect(d.LANGUAGE_KEY).not.toBe('menu_board_language');
        const now = 1_700_000_000_000;
        expect(d.isCacheFresh({ savedAt: now - 6 * 864e5, data: { settings: {}, categories: [] } }, now)).toBe(true);
        expect(d.isCacheFresh({ savedAt: now - 8 * 864e5, data: { settings: {}, categories: [] } }, now)).toBe(false);
        expect(d.isCacheFresh({ savedAt: now + 10, data: { settings: {}, categories: [] } }, now)).toBe(false);
        expect(d.isCacheFresh({ savedAt: now, data: { settings: {} } }, now)).toBe(false);
        expect(d.isValidPayload({ settings: {}, categories: [] })).toBe(true);
        expect(d.isValidPayload({ settings: {} })).toBe(false);
    });
});

describe('البورتريه — نِطاقات ونِسب، لا كانفس واحد', () => {
    test('النطاقات على نسبة الأبعاد (طول/عرض)', () => {
        expect(d.aspectBand(768, 1024)).toBe('wide');
        expect(d.aspectBand(1080, 1920)).toBe('classic');
        expect(d.aspectBand(1080, 2160)).toBe('tall');
        expect(d.aspectBand(1080, 2400)).toBe('super');
        expect(d.aspectBand(0, 0)).toBe('classic');
    });

    test('الأعمدة: شاشة عريضة فعليًا فقط تستحق ثلاثة', () => {
        expect(d.columnsForBand('wide', 768)).toBe(2);
        expect(d.columnsForBand('wide', 1600)).toBe(3);
        expect(d.columnsForBand('tall', 1080)).toBe(2);
    });

    test('الصفوف من الصناديق المقاسة — لا قصّ ولا صفر', () => {
        expect(d.rowsForBox({ height: 600, itemHeight: 120, gap: 20 })).toBe(4);
        expect(d.rowsForBox({ height: 599, itemHeight: 120, gap: 20 })).toBe(4);
        expect(d.rowsForBox({ height: 100, itemHeight: 120, gap: 20 })).toBe(1);
        expect(d.rowsForBox({ height: 0, itemHeight: 120, gap: 20 })).toBe(1);
        expect(d.capacityForBox({ height: 600, itemHeight: 120, gap: 20 }, 2)).toBe(8);
    });

    test('أرضية الراحة: لا بطاقة شرريطًا، والكثافة المعتمدة للمالك على 1080 محفوظة', () => {
        // 16% من أصغر بُعد: 1080 → 172.8px · 2160 → 345.6px · بلا قياس → صفر
        expect(d.MIN_CARD_CQMIN).toBe(16);
        expect(Math.round(d.comfortRowHeight(1080))).toBe(173);
        expect(Math.round(d.comfortRowHeight(2160))).toBe(346);
        expect(d.comfortRowHeight(0)).toBe(0);
        expect(d.comfortRowHeight(-5)).toBe(0);
        expect(d.comfortRowHeight(NaN)).toBe(0);
        // بطاقة مقاسة أقصر من الأرضية تُرفع إليها: 1080×1920 → ٥ صفوف × ٢ = ١٠ (قرار المالك)
        const floor = d.comfortRowHeight(1080);
        const free = { height: 993, itemHeight: Math.max(120, floor), gap: 16 };
        expect(d.rowsForBox(free)).toBe(5);
        expect(d.capacityForBox(free, 2)).toBe(10);
        // الشاشة الأطول تأخذ أصنافًا أكثر بنفس الأرضية، لا بطاقات أصغر
        expect(d.rowsForBox({ height: 993, itemHeight: 120, gap: 16 })).toBe(7);
        expect(d.rowsForBox({ height: 1400, itemHeight: floor, gap: 16 })).toBe(7);
    });

    test('الصفحة الجديدة لا كانفس ثابت فيها ولا مقياسَ تُصغَّر به الشاشة', () => {
        expect(CSS_SRC).not.toMatch(/1080px|1920px|#stage/);
        expect(PORTRAIT_SRC).not.toMatch(/Math\.min\(window\.innerWidth|innerWidth\s*\//);
        expect(LEGACY_SRC).toMatch(/Math\.min\(window\.innerWidth \/ STAGE_W/);
        expect(CSS_SRC).toMatch(/container-type:\s*size/);
        expect(CSS_SRC).toMatch(/@media \(prefers-reduced-motion: reduce\)/);
    });
});

describe('الملفات — الفصل والعقود', () => {
    test('الشبكة في boot.js وحدها، والرسم لا DOM فيه للاختبار', () => {
        expect(BOOT_SRC).toMatch(/await fetch\(/);
        expect(PORTRAIT_SRC).not.toMatch(/[^a-zA-Z]fetch\(/);
        expect(DATA_SRC).not.toMatch(/document\.|window\.|localStorage|fetch\(/);
    });

    test('الشاشة تبقى مضيفةً للإدارة القديمة وصفحة العرض القديمة', () => {
        expect(SCREEN_SRC).toContain('/app/menu-admin.html');
        expect(SCREEN_SRC).toContain('/app/menu-board.html');
        /* صفحة المنيو V2 حُذفت بقرار المالك — لا زرّ ولا رابط يشير إليها */
        expect(SCREEN_SRC).not.toContain('menu-board-v2.html');
        expect(SCREEN_SRC).not.toContain('v2board');
    });

    test('البوفيه صفحة واحدة: مقياسٌ محلي لا تقطيع، والملحَقة هي المقروءة لا المبتورة', () => {
        expect(PORTRAIT_SRC).toMatch(/function fitBuffetScale/);
        expect(PORTRAIT_SRC).toMatch(/buffetPage\(board\.buffet_sections, period\)/);
        expect(PORTRAIT_SRC).toMatch(/bfProbe\.appendChild\(node\)/);
        expect(PORTRAIT_SRC).toMatch(/getBoundingClientRect\(\)\.height/);
        expect(PORTRAIT_SRC).toMatch(/bfScale \* 0\.9/);
        expect(PORTRAIT_SRC).toMatch(/node\.appendChild\(priceStripNode/);
        /* لا رجعة للتقطيع: الدوال القديمة مطرودة كي لا يعود قصٌّ خفيّ */
        expect(PORTRAIT_SRC).not.toMatch(/measureBuffet|packPanels|buffetPanels/);
        expect(DATA_SRC).not.toMatch(/packPanels|buffetPanels/);
        /* البوفيه داخل التحقق دائمًا: كان يستثني نفسه فيسيل التكوين خارج الحافة */
        expect(PORTRAIT_SRC).not.toMatch(/destroyed \|\| isBuffet/);
        expect(CSS_SRC).toMatch(/\.kb-bf\s*\{[^}]*--kb-u:\s*calc\(1cqmin \* var\(--bf-scale, 1\)\)/);
        expect(CSS_SRC).toMatch(/\.kb-bf-probe\s*\{[^}]*align-items:\s*flex-start/);
        expect(CSS_SRC).toMatch(/#board\[data-bf="1"\] \.kb-periods[^}]*display: none/);
        expect(CSS_SRC).toMatch(/\.kb-price-strip\s*\{[^}]*flex:\s*none/);
    });

    test('نقاط الربط في portrait.js صحيحة ومطابقة لـ board-data', () => {
        for (const name of ['buildPages', 'buildWeeklyPages', 'buffetPage', 'cyclePlan', 'BUFFET_SECTIONS', 'measureCapacity']) {
            expect(PORTRAIT_SRC).toContain(name);
        }
        expect(PORTRAIT_SRC).toMatch(/refs\.board\.dataset\.ar = band/);
    });
});
