// ────────────────────────────────────────────────────────────────────────────
// warehouse-search-nojump.test.js — طلب المالك 2026-10-05
// «في صفحة المخزن لما بحث على منتج بتطلع الصفحة لفوق»
// السبب: whInvFetch كان يستدعي renderPage() الكاملة مرتين لكل بحث — فيُهدم مربع
// البحث ويفقد التركيز وتقفز الصفحة. الإصلاح: تحديث جزئي (tbody + الترقيم + العداد).
// يقيّم مصدر warehouse.js الحقيقي بمستند وهمي — نفس ما يعمل في المتصفح.
// ────────────────────────────────────────────────────────────────────────────
const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'app', 'js', 'features', 'warehouse.js'), 'utf8')
    .replace(/export\s*\{[^}]*\};?/, '');

const ITEMS = [
    { id: 'i1', name: 'طماطم', unit: 'كجم', qty: 10, minQty: 2, avgCost: 4, category: 'خضار', barcode: '1001' },
    { id: 'i2', name: 'أرز بسمتي', unit: 'شكارة', qty: 0, minQty: 5, avgCost: 90, category: 'بقالة', barcode: '1002' },
];

/** مستند وهمي: عناصر بالمعرفات التي يلمسها التحديث الجزئي + عداد استدعاءات الرسم الكامل */
function fakeDocument(existing) {
    const calls = { renderPage: 0 };
    const els = {
        whInvBody: { id: 'whInvBody', innerHTML: '' },
        whInvPager: { id: 'whInvPager', innerHTML: '' },
        whInvCatSelect: { id: 'whInvCatSelect', options: [{ textContent: 'كل الفئات (99)' }] },
        ...existing,
    };
    return {
        calls,
        document: { getElementById: (id) => els[id] || null },
        els,
    };
}

function build(ctx) {
    const factory = new Function('STATE', 'window', 'document', 'renderPage', 'esc', 'fN', 'fC', 'fD', 't',
        'apiFetch', 'setTimeout', 'checkMenuAccessLocal', 'prCanSee', 'whShortPanel', 'today',
        SRC + '\nreturn { WHINV, whInvPartialRender, whInvRowsHtml, whInvPagerHtml, whInvLocalItems, whInvFetch, whInvClearSearch, renderWarehouse };');
    return factory(ctx.STATE, ctx.window, ctx.document, () => { ctx.calls.renderPage++; }, String, String, String, String, (k) => k,
        () => Promise.resolve({ data: [], pagination: { total: 0, page: 1 } }), () => {}, () => true, () => false, () => '',
        () => new Date().toISOString().split('T')[0]);
}

function makeCtx(opts = {}) {
    const ctx = {
        STATE: { page: 'warehouse', inventory: ITEMS, shelves: [], purchaseInvoices: [], inventoryTx: [] },
        window: { whSelected: new Set(), whCatFilter: 'all' },
        ...opts,
    };
    const fd = fakeDocument(opts.missing);
    ctx.document = fd.document;
    ctx.calls = fd.calls;
    ctx.els = fd.els;
    return ctx;
}

describe('صفحة المخزن: البحث لا يقفز بالصفحة لأعلى (تحديث جزئي بلا رسم كامل)', () => {
    test('whInvFetch لم يعد يستدعي renderPage — يستدعي whInvPartialRender بدلًا منها', () => {
        const fetchBody = SRC.slice(SRC.indexOf('async function whInvFetch'), SRC.indexOf('function whInvClearSearch'));
        expect(fetchBody).toContain('whInvPartialRender()');
        expect(fetchBody).not.toContain('renderPage()');
    });

    test('التحديث الجزئي يملأ tbody وshريط الترقيم وعداد الفئات — دون أي renderPage', () => {
        const ctx = makeCtx();
        const m = build(ctx);
        m.WHINV.results = ITEMS;
        m.WHINV.total = 2;
        m.WHINV.loading = false;
        m.WHINV.error = '';
        ctx.calls.renderPage = 0;
        m.whInvPartialRender();
        expect(ctx.calls.renderPage).toBe(0); // ← جوهر الإصلاح
        expect(ctx.els.whInvBody.innerHTML).toContain('طماطم');
        expect(ctx.els.whInvBody.innerHTML).toContain('أرز بسمتي');
        expect(ctx.els.whInvPager.innerHTML).toContain('صفحة 1 من 1');
        expect(ctx.els.whInvCatSelect.options[0].textContent).toContain('2');
    });

    test('لو tbody غير موجود (الصفحة لم تُبنَ) → يرجع للرسم الكامل كالسابق', () => {
        const ctx = makeCtx({ missing: { whInvBody: null } });
        const m = build(ctx);
        ctx.calls.renderPage = 0;
        m.whInvPartialRender();
        expect(ctx.calls.renderPage).toBe(1);
    });

    test('حالة التحميل: صف جارٍ التحميل فقط، وحالة الخطأ: رسالة مع إعادة المحاولة', () => {
        const ctx = makeCtx();
        const m = build(ctx);
        m.WHINV.loading = true; m.WHINV.results = null; m.WHINV.error = '';
        expect(m.whInvRowsHtml(ITEMS)).toContain('جارٍ تحميل الأصناف');
        m.WHINV.loading = false; m.WHINV.error = 'انقطاع';
        expect(m.whInvRowsHtml(ITEMS)).toContain('تعذر البحث');
        expect(m.whInvRowsHtml(ITEMS)).toContain('إعادة المحاولة');
    });

    test('صفوف الأصناف مكتملة: الأزرار والشارات وصف النواقص', () => {
        const ctx = makeCtx();
        const m = build(ctx);
        m.WHINV.loading = false; m.WHINV.results = null; m.WHINV.error = '';
        const rows = m.whInvRowsHtml(ITEMS);
        expect(rows).toContain('editItem');
        expect(rows).toContain('deleteItem');
        expect(rows).toContain('bdg-red'); // أرز رصيده 0 → منخفض
        expect(m.whInvRowsHtml([])).toContain('wh.noItems');
    });

    test('شريط الترقيم: يعطل «السابق» في أول صفحة ويحسب عدد الصفحات', () => {
        const ctx = makeCtx();
        const m = build(ctx);
        m.WHINV.loading = false; m.WHINV.error = '';
        m.WHINV.results = []; m.WHINV.total = 120; m.WHINV.page = 1; m.WHINV.limit = 50;
        const pager = m.whInvPagerHtml(true);
        expect(pager).toContain('صفحة 1 من 3');
        expect(pager).toContain('disabled');
        m.WHINV.page = 2;
        expect(m.whInvPagerHtml(true)).not.toContain('disabled');
        expect(m.whInvPagerHtml(false)).toBe(''); // بلا وضع خادم لا شريط ترقيم
    });

    test('عرض مزدوج: رصيد المخزن الرئيسي منفصل عن ما انتقل لمخازن الأقسام (طلب المالك)', () => {
        const ctx = makeCtx();
        const m = build(ctx);
        m.WHINV.loading = false; m.WHINV.results = null; m.WHINV.error = '';
        const rows = m.whInvRowsHtml([
            { id: 'r1', name: 'ارز مصري', unit: 'كيس', qty: 8, mainQty: 4, minQty: 0, avgCost: 35, category: 'بقالة' },
        ]);
        expect(rows).toContain('>4<'); // الرئيسي 4
        const html = m.renderWarehouse();
        expect(html).toContain('رصيد المخزن');  // عمود الرئيسي
        expect(html).toContain('في الأقسام');   // عمود ما في مخازن الأقسام
    });

    test('الوضع الصافي وعمودا المنصرف/الصافي: العمود الأساسي = رصيد المخزن', () => {
        const ctx = makeCtx();
        const m = build(ctx);
        m.WHINV.loading = false; m.WHINV.results = null; m.WHINV.error = '';
        const rows = m.whInvRowsHtml([{ id: 'r2', name: 'سكر', unit: 'كيس', qty: 10, mainQty: 10, minQty: 12, avgCost: 50, category: 'بقالة' }]);
        expect(rows).toContain('bdg-red'); // الرئيسي 10 < الحد 12 → منخفض
    });
});

describe('طلب المالك 2026-10-05: «اجعل البحث في أول صفحة المخزن» — شريط بحث لاصق في أول الصفحة', () => {
    test('مربع البحث أول شيء في الصفحة — قبل بطاقات الإحصائيات والجدول', () => {
        const ctx = makeCtx();
        const m = build(ctx);
        m.WHINV.results = ITEMS; m.WHINV.total = 2; m.WHINV.loading = false; m.WHINV.error = ''; m.WHINV.q = 'أرز';
        const html = m.renderWarehouse();
        const searchPos = html.indexOf('بحث فوري: اسم / باركود / فئة');
        const metricsPos = html.indexOf('wh.items');   // أول بطاقة إحصائيات (t = identity)
        const tablePos = html.indexOf('wh.invTitle');  // عنوان جدول الأصناف
        expect(searchPos).toBeGreaterThanOrEqual(0);
        expect(searchPos).toBeLessThan(metricsPos);
        expect(searchPos).toBeLessThan(tablePos);
    });

    test('مربع بحث واحد فقط في الصفحة (لا مكرر في شريط الجدول) + لاصق sticky', () => {
        const ctx = makeCtx();
        const m = build(ctx);
        m.WHINV.results = ITEMS; m.WHINV.loading = false; m.WHINV.error = ''; m.WHINV.q = '';
        const html = m.renderWarehouse();
        expect(html.split('data-karim-action="whInvSearchInput"').length - 1).toBe(1);
        expect(html).toContain('position:sticky');
        expect(html).toContain('id="whTopSearch"');
    });

    test('زر المسح يظهر مع نص البحث ويفرّغه ويعيد الجلب — ولا يظهر والبحث فارغ', () => {
        const ctx = makeCtx();
        const m = build(ctx);
        m.WHINV.results = ITEMS; m.WHINV.loading = false; m.WHINV.error = '';
        m.WHINV.q = 'أرز';
        expect(m.renderWarehouse()).toContain('data-karim-action="whInvClearSearch"');
        ctx.calls.renderPage = 0;
        m.whInvClearSearch();
        expect(m.WHINV.q).toBe('');
        expect(m.WHINV.page).toBe(1);
        expect(ctx.calls.renderPage).toBe(1);
        m.WHINV.q = '';
        expect(m.renderWarehouse()).not.toContain('data-karim-action="whInvClearSearch"');
    });
});
