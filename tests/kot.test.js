/**
 * kot.test.js — Kitchen Order Tickets (KOT) unit tests
 * Covering: grouping by production department, service-item skipping,
 * same-product merging, ticket data assembly (no prices anywhere),
 * ESC/POS byte framing, and the RTL HTML view.
 */

const {
    buildKotGroups,
    buildKotData,
    buildEscPosKot,
    kotHtml,
    CMD,
} = require('../backend/cashier-module/kot-printer');
const { validateKotSettings } = require('../backend/cashier-module/kot-routes');

// ─── buildKotGroups ──────────────────────────────────────────────────────────
describe('buildKotGroups — تجميع الأصناف حسب قسم التجهيز', () => {
    const prepMap = new Map([
        [10, { department_id: 81, department_name: 'قسم المطبخ العام الساخن' }],
        [20, { department_id: 78, department_name: 'قسم السلطات' }],
    ]);

    test('يجمع أصناف القسم نفسه في تذكرة واحدة ويقسم بين الأقسام', () => {
        const items = [
            { product_id: 10, product_name: 'ربع كبسه دجاج', quantity: 2 },
            { product_id: 10, product_name: 'ربع كبسه دجاج', quantity: 1 },
            { product_id: 20, product_name: 'سلطة فتوش', quantity: 3 },
        ];
        const groups = buildKotGroups(items, prepMap);
        expect(groups).toHaveLength(2);
        expect(groups[0].department_id).toBe(81);
        expect(groups[0].lines).toHaveLength(1);
        expect(groups[0].lines[0]).toMatchObject({ name: 'ربع كبسه دجاج', quantity: 3 });
        expect(groups[1].department_id).toBe(78);
        expect(groups[1].lines[0].quantity).toBe(3);
    });

    test('يستثني أصناف البوفيه والخدمات بلا قسم تجهيز', () => {
        const items = [
            { product_id: 2, product_name: 'بوفيه كبار', quantity: 4 },
            { product_id: 4, product_name: 'ضيافة', quantity: 1 },
            { product_id: 10, product_name: 'ربع كبسه دجاج', quantity: 1 },
        ];
        const groups = buildKotGroups(items, prepMap);
        expect(groups).toHaveLength(1);
        expect(groups[0].department_id).toBe(81);
    });

    test('سلة بيع كلها خدمات → لا تذاكر إطلاقًا', () => {
        expect(buildKotGroups([{ product_id: 2, quantity: 2 }], prepMap)).toEqual([]);
        expect(buildKotGroups([], prepMap)).toEqual([]);
        expect(buildKotGroups(null, prepMap)).toEqual([]);
    });

    test('يقبل خريطة كائن عادية (وليس Map فقط) ويتجاهل منتجات غير معروفة', () => {
        const groups = buildKotGroups(
            [{ product_id: 999, product_name: 'مجهول', quantity: 1 }, { product_id: 20, product_name: 'سلطة', quantity: 2 }],
            { 20: { department_id: 78, department_name: 'قسم السلطات' } },
        );
        expect(groups).toHaveLength(1);
        expect(groups[0].lines[0].name).toBe('سلطة');
    });
});

// ─── buildKotData ────────────────────────────────────────────────────────────
describe('buildKotData — بيانات التذكرة', () => {
    const order = {
        invoice_counter: 1042,
        invoice_uuid: '123e4567-e89b-12d3-a456-426614174000',
        notes: 'عائلة الشمري — عيد ميلاد',
        created_at: '2026-09-02T12:34:56Z',
    };
    const group = { department_id: 81, department_name: 'قسم المطبخ العام الساخن', lines: [{ product_id: 10, name: 'ربع كبسه دجاج', quantity: 2 }] };

    test('يحمل رقم الطلب والوقت واسم القسم والأصناف', () => {
        const d = buildKotData({ order, group, cashier: { name: 'أحمد' }, timeLabel: '15:34' });
        expect(d.order_no).toBe(1042);
        expect(d.order_uuid).toBe('123E4567');
        expect(d.department_name).toBe('قسم المطبخ العام الساخن');
        expect(d.time).toBe('15:34');
        expect(d.party_name).toBe('عائلة الشمري — عيد ميلاد');
        expect(d.lines).toEqual([{ name: 'ربع كبسه دجاج', quantity: 2 }]);
        expect(d.items_total).toBe(2);
    });

    test('includeNotes=false يخفي اسم الضيف (مفتاح الضبط)', () => {
        const d = buildKotData({ order, group, includeNotes: false, timeLabel: '15:34' });
        expect(d.party_name).toBe('');
    });

    test('يستنتج الوقت من created_at عند غياب timeLabel', () => {
        const d = buildKotData({ order, group, includeNotes: false });
        expect(d.time).toMatch(/^\d{2}:\d{2}$/);
    });
});

// ─── buildEscPosKot ──────────────────────────────────────────────────────────
describe('buildEscPosKot — بايتات الطباعة الحرارية', () => {
    const data = buildKotData({
        order: { invoice_counter: 77, invoice_uuid: 'abcdef12-0000', notes: 'طلب سريع', created_at: '2026-09-02T10:00:00Z' },
        group: { department_id: 81, department_name: 'قسم المطبخ العام الساخن', lines: [{ product_id: 10, name: 'ربع كبسه دجاج', quantity: 3 }] },
        cashier: { name: 'سالم' },
        timeLabel: '13:00',
    });
    const bytes = buildEscPosKot(data);
    const text = bytes.toString('utf8');

    test('تبدأ بـ ESC @ (INIT) وتنتهي بقص الورق GS V', () => {
        expect(bytes[0]).toBe(0x1b);
        expect(bytes[1]).toBe(0x40);
        expect(bytes.subarray(bytes.length - 4)).toEqual(Buffer.from([0x1d, 0x56, 0x42, 0x00]));
    });

    test('تحتوي العنوان والقسم والصنف ورقم الطلب بترميز UTF-8 سليم', () => {
        expect(text).toContain('تذكرة تجهيز');
        expect(text).toContain('قسم المطبخ العام الساخن');
        expect(text).toContain('3 × ربع كبسه دجاج');
        expect(text).toContain('Order #77');
        expect(text).toContain('طلب سريع');
    });

    test('لا أسعار إطلاقًا على تذكرة المطبخ (لا SAR ولا مبالغ)', () => {
        expect(text).not.toContain('SAR');
        expect(text).not.toContain('الإجمالي:');
        expect(text).not.toContain('VAT');
        expect(text).not.toMatch(/\d+\.\d{2}\s*(SAR|ر\.س)/);
    });

    test('يستخدم خطًا مزدوج الارتفاع للعنوان (يواجه المطبخ)', () => {
        // DOUBLE_HD = GS ! 0x11 must appear right after INIT + center + bold
        const header = Buffer.concat([CMD.INIT, CMD.ALIGN_CENTER, CMD.BOLD_ON, CMD.DOUBLE_HD]);
        expect(bytes.subarray(0, header.length)).toEqual(header);
    });
});

// ─── kotHtml ─────────────────────────────────────────────────────────────────
describe('kotHtml — صفحة التذاكر RTL', () => {
    const datas = [
        buildKotData({
            order: { invoice_counter: 9, invoice_uuid: 'aaaa1111', notes: '', created_at: '2026-09-02T09:30:00Z' },
            group: { department_id: 78, department_name: 'قسم السلطات', lines: [{ product_id: 20, name: 'سلطة فتوش', quantity: 2 }] },
            timeLabel: '12:30',
        }),
    ];

    test('RTL + بطاقة لكل قسم + الصنف بدون أسعار', () => {
        const html = kotHtml(datas);
        expect(html).toContain('dir="rtl"');
        expect(html).toContain('قسم السلطات');
        expect(html).toContain('سلطة فتوش');
        expect(html).toContain('Order #9');
        expect(html).not.toContain('SAR');
        expect(html).toContain('page-break-inside:avoid');
    });

    test('بدون تذاكر → رسالة واضحة لا صفحة فارغة', () => {
        const html = kotHtml([]);
        expect(html).toContain('لا توجد تذاكر تجهيز');
    });

    test('هروب HTML في أسماء الأصناف الحساسة', () => {
        const evil = [buildKotData({
            order: { invoice_counter: 1, invoice_uuid: 'x', created_at: '2026-09-02T09:30:00Z' },
            group: { department_id: 78, department_name: '<img src=x>', lines: [{ product_id: 1, name: '<script>alert(1)</script>', quantity: 1 }] },
            timeLabel: '12:30',
        })];
        const html = kotHtml(evil);
        expect(html).not.toContain('<script>alert(1)</script>');
        expect(html).toContain('&lt;script&gt;');
    });
});

// ─── validateKotSettings ─────────────────────────────────────────────────────
describe('validateKotSettings — حرس إعدادات الضبط', () => {
    test('يرفض النسخ خارج 1..3 والقيم غير المنطقية', () => {
        expect(validateKotSettings({ kot_copies: 0 }).error).toBe('KOT_COPIES_OUT_OF_RANGE');
        expect(validateKotSettings({ kot_copies: 9 }).error).toBe('KOT_COPIES_OUT_OF_RANGE');
        expect(validateKotSettings({ kot_copies: 1.5 }).error).toBe('KOT_COPIES_OUT_OF_RANGE');
        expect(validateKotSettings({ kot_enabled: 'نعم' }).error).toBe('KOT_ENABLED_MUST_BE_BOOLEAN');
        expect(validateKotSettings({ kot_include_notes: 1 }).error).toBe('KOT_NOTES_MUST_BE_BOOLEAN');
        expect(validateKotSettings({}).error).toBe('NOTHING_TO_UPDATE');
        expect(validateKotSettings(null).error).toBe('BODY_REQUIRED');
    });

    test('يقبل قيمًا صالحة ويعيدها منظفة', () => {
        expect(validateKotSettings({ kot_enabled: false, kot_copies: 2, kot_include_notes: false }))
            .toEqual({ value: { kot_enabled: false, kot_copies: 2, kot_include_notes: false } });
        expect(validateKotSettings({ kot_copies: 3 }).value).toEqual({ kot_copies: 3 });
    });
});
