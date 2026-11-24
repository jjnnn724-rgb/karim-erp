/**
 * veg-requests.test.js — منطق طلبات شراء الخضار (نقي — بلا DB)
 * ────────────────────────────────────────────────────────────────────────────
 * يغطي: كتالوج الخضار، قائمة الوحدات، تنقية النصوص، وتحقق أصناف الطلب
 * (الرفض الواضح بالعربية لكل حالة فاسدة).
 */
'use strict';

const { cleanText, validateItems, applyPrices, mergeAdminItems, UNITS, VEG_CATALOG } = require('../backend/veg-requests-logic');

describe('كتالوج الخضار', () => {
    test('مصنّف بأقسام وكل صنف له اسم ووحدة افتراضية من قائمة السماح', () => {
        expect(VEG_CATALOG.length).toBeGreaterThanOrEqual(4);
        for (const cat of VEG_CATALOG) {
            expect(cat.key).toBeTruthy();
            expect(cat.label).toBeTruthy();
            expect(cat.items.length).toBeGreaterThan(0);
            for (const it of cat.items) {
                expect(it.name).toBeTruthy();
                expect(UNITS).toContain(it.unit);
            }
        }
    });
    test('أصناف أساسية موجودة (طماطم/بطاطس/بصل/ملوخية)', () => {
        const names = VEG_CATALOG.flatMap((c) => c.items.map((i) => i.name));
        for (const must of ['طماطم', 'بطاطس', 'بصل', 'ملوخية']) {
            expect(names).toContain(must);
        }
    });
});

describe('cleanText — تنقية النصوص الحرة', () => {
    test('يزيل <> ويضغط المسافات ويقص الطول', () => {
        expect(cleanText('  <b>طماطم</b>   بلدي  ', 20)).toBe('bطماطم/b بلدي');
        expect(cleanText('x'.repeat(50), 10)).toHaveLength(10);
        expect(cleanText(null)).toBe('');
    });
});

describe('validateItems — تحقق أصناف الطلب', () => {
    test('طلب سليم: يطبع الأسماء، يقرّب الكميات، ويثبت الوحدة', () => {
        const r = validateItems([
            { name: 'طماطم', qty: '12.5', unit: 'كجم' },
            { name: 'بقدونس', qty: 3, unit: 'ربطة', note: 'طازة' },
        ]);
        expect(r.ok).toBe(true);
        expect(r.items).toHaveLength(2);
        expect(r.items[0]).toEqual({ name: 'طماطم', qty: 12.5, unit: 'كجم', note: null });
        expect(r.items[1].note).toBe('طازة');
    });
    test('وحدة غريبة تُستبدل بـ «وحدة» بدل الرفض', () => {
        const r = validateItems([{ name: 'ليمون', qty: 2, unit: '<script>' }]);
        expect(r.ok).toBe(true);
        expect(r.items[0].unit).toBe('وحدة');
    });
    test('يرفض: بلا أصناف / كمية صفر أو سالبة / صنف بلا اسم / تكرار / حد 80', () => {
        expect(validateItems([]).ok).toBe(false);
        expect(validateItems('nope').ok).toBe(false);
        expect(validateItems([{ name: 'بصل', qty: 0 }]).ok).toBe(false);
        expect(validateItems([{ name: 'بصل', qty: -5 }]).ok).toBe(false);
        expect(validateItems([{ name: '', qty: 5 }]).ok).toBe(false);
        const dup = validateItems([{ name: 'بصل', qty: 2 }, { name: 'بصل', qty: 3 }]);
        expect(dup.ok).toBe(false);
        expect(dup.error).toContain('مكرر');
        const many = Array.from({ length: 81 }, (_, i) => ({ name: 'صنف' + i, qty: 1 }));
        expect(validateItems(many).ok).toBe(false);
    });
    test('كمية غير رقمية تُرفض برسالة تحتوي اسم الصنف', () => {
        const r = validateItems([{ name: 'خيار', qty: 'كثير' }]);
        expect(r.ok).toBe(false);
        expect(r.error).toContain('خيار');
    });
    test('اسم صنف فيه HTML يُنقّى قبل الحفظ', () => {
        const r = validateItems([{ name: '<img src=x>طماطم', qty: 5 }]);
        expect(r.ok).toBe(true);
        expect(r.items[0].name).not.toContain('<');
    });
});

describe('applyPrices — تسعير المخزن', () => {
    const items = [
        { name: 'طماطم', qty: 12, unit: 'كجم', note: null },
        { name: 'بصل', qty: 5, unit: 'كيس', note: null },
    ];
    test('تسعير سليم: سعر الوحدة × الكمية ومجموع مقرب لخانتين', () => {
        const r = applyPrices(items, [{ name: 'طماطم', unitPrice: 3.333 }, { name: 'بصل', unitPrice: 20 }]);
        expect(r.ok).toBe(true);
        expect(r.items[0].lineTotal).toBe(39.96);
        expect(r.items[1].lineTotal).toBe(100);
        expect(r.total).toBe(139.96);
    });
    test('صنف ناقص السعر يُرفض بذكر اسمه', () => {
        const r = applyPrices(items, [{ name: 'طماطم', unitPrice: 3 }]);
        expect(r.ok).toBe(false);
        expect(r.error).toContain('بصل');
    });
    test('سعر سالب أو غير رقمي يُرفض', () => {
        expect(applyPrices(items, [{ name: 'طماطم', unitPrice: -1 }, { name: 'بصل', unitPrice: 2 }]).ok).toBe(false);
        expect(applyPrices(items, [{ name: 'طماطم', unitPrice: 'كثير' }, { name: 'بصل', unitPrice: 2 }]).ok).toBe(false);
    });
    test('سعر صفر مسموح (توريد مجاني)', () => {
        const r = applyPrices(items, [{ name: 'طماطم', unitPrice: 0 }, { name: 'بصل', unitPrice: 0 }]);
        expect(r.ok).toBe(true);
        expect(r.total).toBe(0);
    });
    test('بلا أسعار أصلاً يُرفض', () => {
        expect(applyPrices(items, []).ok).toBe(false);
        expect(applyPrices(items, undefined).ok).toBe(false);
    });
});

describe('applyPrices — الأصناف المرفوضة (المرفوض لا يُسعَّر)', () => {
    const items = [
        { name: 'طماطم', qty: 10, unit: 'كجم', note: null },
        { name: 'خيار', qty: 4, unit: 'كجم', note: null, rejected: true },
        { name: 'بصل', qty: 5, unit: 'كيس', note: null },
    ];
    test('المرفوض لا يُسعَّر ولا يدخل الإجمالي', () => {
        const r = applyPrices(items, [{ name: 'طماطم', unitPrice: 4.5 }, { name: 'بصل', unitPrice: 2 }]);
        expect(r.ok).toBe(true);
        expect(r.items.find(i => i.name === 'خيار').price).toBe(null);
        expect(r.total).toBe(55);
    });
    test('غياب سعر المرفوض ليس خطأ — المقابل المقبول فقط يُطالب بسعره', () => {
        const r = applyPrices(items, [{ name: 'بصل', unitPrice: 2 }]);
        expect(r.ok).toBe(false); // طماطم مقبول بلا سعر
        const r2 = applyPrices(
            items.map(i => ({ ...i, rejected: i.name !== 'بصل' })),
            [{ name: 'بصل', unitPrice: 2 }]
        );
        expect(r2.ok).toBe(true);
        expect(r2.total).toBe(10);
    });
    test('كل الأصناف مرفوضة → رفض واضح (لا مصروف)', () => {
        const all = items.map(i => ({ ...i, rejected: true }));
        expect(applyPrices(all, []).ok).toBe(false);
    });
});

describe('mergeAdminItems — إضافة/تعديل أصناف الأدمن', () => {
    const existing = [
        { name: 'طماطم', qty: 10, unit: 'كجم', note: null },
        { name: 'خيار', qty: 4, unit: 'كجم', note: null, rejected: true },
    ];

    test('تعديل كمية صنف موجود يُبقي الوحدة ويسجّل الكمية قبل/بعد', () => {
        const r = mergeAdminItems(existing, [{ name: 'طماطم', qty: 15, unit: 'كجم' }]);
        expect(r.ok).toBe(true);
        expect(r.items).toHaveLength(2);
        expect(r.items[0].qty).toBe(15);
        expect(r.items[0].unit).toBe('كجم');
        expect(r.changes).toEqual([{ name: 'طماطم', from: 10, to: 15, action: 'qty' }]);
    });

    test('صنف جديد يُضاف بكميته ووحدته، والأصناف غير المُرسَلة تبقى', () => {
        const r = mergeAdminItems(existing, [
            { name: 'طماطم', qty: 10, unit: 'كجم' },
            { name: 'بصل', qty: 3, unit: 'كيس' },
        ]);
        expect(r.ok).toBe(true);
        expect(r.items.map(i => i.name)).toEqual(['طماطم', 'بصل', 'خيار']);
        expect(r.items.find(i => i.name === 'بصل')).toMatchObject({ qty: 3, unit: 'كيس' });
        expect(r.items.find(i => i.name === 'خيار').rejected).toBe(true);
        expect(r.changes).toContainEqual({ name: 'بصل', from: 0, to: 3, action: 'add' });
    });

    test('وحدة الصنف القائم لا تُستبدل بـ «وحدة» لو الأدمن لم يرسل وحدة', () => {
        const r = mergeAdminItems(existing, [{ name: 'طماطم', qty: 12, unit: '' }]);
        expect(r.items[0].unit).toBe('كجم');
    });

    test('وحدة غير معروفة لصنف جديد تُستبدل بـ «وحدة» بدل الرفض', () => {
        const r = mergeAdminItems(existing, [{ name: 'صنف جديد', qty: 2, unit: '<script>' }]);
        expect(r.ok).toBe(true);
        expect(r.items.find(i => i.name === 'صنف جديد').unit).toBe('وحدة');
    });

    test('كمية فاسدة أو اسم مكرر أو اسم بلا حروف → رفض واضح', () => {
        expect(mergeAdminItems(existing, [{ name: 'طماطم', qty: 0 }]).ok).toBe(false);
        expect(mergeAdminItems(existing, [{ name: '', qty: 2 }]).ok).toBe(false);
        expect(mergeAdminItems(existing, [
            { name: 'بصل', qty: 1 }, { name: 'بصل', qty: 2 },
        ]).ok).toBe(false);
    });

    test('حد 80 صنفًا بعد الدمج', () => {
        const many = Array.from({ length: 80 }, (_, i) => ({ name: 'صنف' + i, qty: 1 }));
        expect(mergeAdminItems(existing, many).ok).toBe(false);
    });

    test('بدون تغييرات →changes فارغ (يُسجَّل «لا تغيير» في سجل الطلب)', () => {
        const r = mergeAdminItems(existing, [{ name: 'طماطم', qty: 10, unit: 'كجم' }]);
        expect(r.ok).toBe(true);
        expect(r.changes).toEqual([]);
    });
});
