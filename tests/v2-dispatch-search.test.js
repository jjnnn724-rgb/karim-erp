/**
 * v2-dispatch-search.test.js — عقد البحث بالصنف في سجل أذون الصرف (2026-10-25)
 * ═══════════════════════════════════════════════════════════════════════
 * الطلب المعتمد: «سجل الصرف أقدر أبحث فيه عن أي منتج اتسحب من المخزن
 * بأعلى احترافية وطباعته». المثبَّت هنا:
 *   • fetchDispatches(scope): الافتراضي 'month' يرسل v2_period=month (فلتر
 *     الخادم server.js:1680)، و'all' يرسل بلا معلمة الفترة — السجل كله
 *     بلا أي تعديل Backend، بحدّ صفحات أماني 40.
 *   • dispatchToRow يحمل الأصناف الخام (اسم + كمية معتمدة) — البحث يطابق
 *     الخام لا itemsText، فالملخص يعرض أول صنفين فقط (itemsSummary).
 *   • matchDispatchProduct: تطبيع عربي (همزات/تاء مربوطة/تشبيك) عبر
 *     arSearchKey، ومطابقة أصناف بعد الأول والثاني، وبلا مفتاح = الكل.
 *   • summarizeProductWithdrawal: تجميع الكميات المعتمدة باسم الصنف
 *     الحرفي + عدد الأذون المطابقة.
 *   • الشاشة: حقل البحث data-v2-product-search + نطاق data-v2-scope + زر
 *     «اطبع المعروض» + الكشف يطبع طبقتي الفلتر (التاريخ ثم الصنف) بترويسة
 *     معايير + destroy يقطع مؤقت الكتم.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const APP = path.join(__dirname, '..', 'frontend', 'app');
const REPO = path.join(APP, 'js', 'v2', 'data', 'dispatch-repo.js');
const SCREEN = path.join(APP, 'js', 'v2', 'screens', 'dispatch.js');

function loadEsm(file, injections = {}) {
    const stripped = fs.readFileSync(file, 'utf8')
        .split('\n')
        .filter((line) => !/^\s*import\b|^\s*from\s*'[^']*';?\s*$/.test(line))
        .join('\n')
        .replace(/^export\s+/gm, '');
    const context = {
        console, JSON, String, Number, Boolean, Array, Object, RegExp, Error,
        Date, Math, Promise, Set, Map, Intl, URLSearchParams,
        ...injections,
    };
    vm.createContext(context);
    vm.runInContext(stripped, context, { filename: file });
    return context;
}

function callsOf(apiFetch) {
    return apiFetch.mock.calls.map((c) => String(c[0]));
}

describe('البحث بالصنف في سجل أذون الصرف', () => {
    test("fetchDispatches الافتراضي = الشهر الحالي (v2_period=month) وحدّه 5 صفحات", async () => {
        const apiFetch = jest.fn(async () => ({ data: [{ id: 1 }], pagination: { totalPages: 1 } }));
        const ctx = loadEsm(REPO, { apiFetch });
        const rows = await ctx.fetchDispatches();
        const urls = callsOf(apiFetch);
        expect(urls.length).toBe(1);
        expect(urls[0]).toContain('v2_period=month');
        expect(rows.length).toBe(1);
    });

    test("fetchDispatches('all') يطلب السجل كله بلا معلمة الفترة ويمشي الصفحات", async () => {
        const apiFetch = jest.fn(async (url) => {
            const page = Number(new URLSearchParams(String(url).split('?')[1]).get('page'));
            /* دفعات ممتلئة (1000) تنازلية حتى الصفحة الثانية — حدّ «أقل من
               1000» في المستودع هو ما يوقف المشي فالدفعة القصيرة تُنهيه. */
            return page < 3
                ? { data: Array.from({ length: 1000 }, (_, i) => ({ id: (3 - page) * 1000 - i })), pagination: { totalPages: 3 } }
                : { data: [], pagination: { totalPages: 3 } };
        });
        const ctx = loadEsm(REPO, { apiFetch });
        const rows = await ctx.fetchDispatches('all');
        const urls = callsOf(apiFetch);
        expect(urls.every((u) => !u.includes('v2_period'))).toBe(true);
        expect(urls.length).toBe(3);
        expect(rows.length).toBe(2000);
        expect(rows[0].id).toBe(2000);   // desc: الأحدث أولًا
    });

    test("dispatchToRow يحمل الأصناف الخام (الاسم + الكمية المعتمدة أولًا)", () => {
        const ctx = loadEsm(REPO, {});
        const row = ctx.dispatchToRow({
            id: 7, deptName: 'المطبخ', date: '2026-10-01', status: 'approved',
            items: [
                { itemName: 'دجاج طازج', approvedQty: 4.5 },
                { name: 'أرز بسمتي', qty: 10 },
                { itemName: 'زيت' },            // بلا كمية → 0
                { qty: 3 },                      // بلا اسم → يُسقط
            ],
        });
        expect(row.items).toEqual([
            { name: 'دجاج طازج', qty: 4.5 },
            { name: 'أرز بسمتي', qty: 10 },
            { name: 'زيت', qty: 0 },
        ]);
        expect(row.itemsCount).toBe(4);
    });

    test('matchDispatchProduct: تطبيع عربي + مطابقة ما بعد الصنفين الأولين + بلا مفتاح = الكل', () => {
        const ctx = loadEsm(REPO, {});
        const row = ctx.dispatchToRow({
            items: [
                { itemName: 'أرز بسمتي', qty: 1 },
                { itemName: 'مكرونة', qty: 2 },
                { itemName: 'الدجاج المجمد', qty: 6 },   // الثالث — غائب عن itemsText
                { itemName: 'دجاجة طازجة', qty: 3 },     // ة/ه تُطبَّع من الطرفين
            ],
        });
        expect(ctx.matchDispatchProduct(row, 'دجاج')).toBe(true);      // يجد الثالث والرابع
        expect(ctx.matchDispatchProduct(row, 'دجاجه')).toBe(true);     // البحث «دجاجه» يجد «دجاجة طازجة»
        expect(ctx.matchDispatchProduct(row, 'دجاجة')).toBe(true);     // والعكس
        expect(ctx.matchDispatchProduct(row, 'جاج')).toBe(true);       // قطع كلمة داخل «الدجاج»
        expect(ctx.matchDispatchProduct(row, 'ارز')).toBe(true);       // همزة→ألف: «ارز» تجد «أرز»
        expect(ctx.matchDispatchProduct(row, 'بصل')).toBe(false);
        expect(ctx.matchDispatchProduct(row, '')).toBe(true);          // بلا بحث = الكل
        expect(ctx.matchDispatchProduct(null, 'دجاج')).toBe(false);
    });

    test('summarizeProductWithdrawal: تجميع باسم الصنف الحرفي + عدد الأذون', () => {
        const ctx = loadEsm(REPO, {});
        const rows = [
            ctx.dispatchToRow({ items: [{ itemName: 'دجاج طازج', approvedQty: 4 }, { itemName: 'دجاج مجمد', qty: 2 }] }),
            ctx.dispatchToRow({ items: [{ itemName: 'دجاجة طازجة', approvedQty: 3 }] }), // تطابق بعد التطبيع
            ctx.dispatchToRow({ items: [{ itemName: 'بصل', qty: 9 }] }),
        ];
        const { vouchers, byName } = ctx.summarizeProductWithdrawal(rows, 'دجاج');
        expect(vouchers).toBe(2);
        // التجميع بالاسم الحرفي: «دجاجة طازجة» اسمٌ مستقل عن «دجاج طازج»
        expect(byName.get('دجاج طازج')).toBe(4);
        expect(byName.get('دجاجة طازجة')).toBe(3);
        expect(byName.get('دجاج مجمد')).toBe(2);
        expect(byName.has('بصل')).toBe(false);
    });

    test('عقد الشاشة: حقل بحث الصنف + النطاق + زر «اطبع المعروض» + الكشف بطبقتي الفلتر', () => {
        const src = fs.readFileSync(SCREEN, 'utf8');
        expect(src).toContain('data-v2-product-search');
        expect(src).toContain('data-v2-scope');
        expect(src).toContain('اطبع المعروض');
        expect(src).toContain('matchDispatchProduct');
        expect(src).toContain('summarizeProductWithdrawal');
        // الكشف يمرّ بالطبقتين بنفس ترتيب paint: inRange ثم بحث الصنف.
        expect(src).toMatch(/printList[\s\S]{0,900}inRange\(view\)[\s\S]{0,400}matchDispatchProduct/);
        // الرسم نفسه: البحث بعد التاريخ.
        expect(src).toMatch(/paint\(\)[\s\S]{0,700}inRange\(view\)[\s\S]{0,300}matchDispatchProduct/);
        // reload يمرر النطاق للسجل.
        expect(src).toContain('fetchDispatches(dataScope)');
        // destroy يقطع مؤقت الكتم.
        expect(src).toMatch(/destroy\(\)\s*\{\s*clearTimeout\(productTimer\)/);
    });
});
