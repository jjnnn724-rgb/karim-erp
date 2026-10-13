// ────────────────────────────────────────────────────────────────────────────
// opening-net-mode.test.js — طلب المالك 2026-10-05
// «عايز يتخصم أذونات الصرف من الرصيد الجديد» — الوضع الصافي في شاشة الافتتاحي:
// الصافي المعتمد = كمية بداية الفترة (كما يعلنها المالك) − المنصرف فعليًا (من دفتر الصرف)،
// ثم تُعين الأرصدة مباشرة (تعديل مباشر للأصناف الموجودة، إنشاء للجديدة).
// ────────────────────────────────────────────────────────────────────────────
const fs = require('fs');
const path = require('path');

const RAW = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'app', 'js', 'features', 'warehouse.js'), 'utf8');
const SRC = RAW.replace(/export\s*\{[^}]*\};?/, '');
const BACKEND = fs.readFileSync(path.join(__dirname, '..', 'backend', 'warehouse-routes.js'), 'utf8');

const INVENTORY = [
    { id: 11, name: 'دجاج بلدي', unit: 'كجم', qty: 500, minQty: 0, avgCost: 10 },
    { id: 12, name: 'طماطم', unit: 'كجم', qty: 90, minQty: 0, avgCost: 2 },
    { id: 13, name: 'بيبسي عادي -كرتون', unit: 'كرتون', qty: 12, minQty: 0, avgCost: 56 },
];

function build(issuedMap, apiCalls) {
    const els = { openingTotal: el(), openingRows: el(), openingIssued_0: el(), openingNetQty_0: el() };
    const doc = { getElementById: (id) => els[id] || null, querySelectorAll: () => [] };
    const factory = new Function('STATE', 'window', 'document', 'renderPage', 'esc', 'fN', 'fC', 'fD', 't',
        'apiFetch', 'persistCreate', 'uid', 'toast', 'showLoad', 'hideLoad', 'closeModal', 'addNotification', 'today',
        SRC + '\nreturn { openingNet, openingRows, openingNetEnabled, openingIssuedFor, resolveOpeningNetItems, saveOpeningNet, renderOpeningRows, normalizeOpeningItems };');
    const m = factory(
        { page: 'warehouse', inventory: INVENTORY, shelves: [], purchaseInvoices: [], inventoryTx: [], suppliers: [], currentUser: { role: 'admin' } },
        { whSelected: new Set(), whCatFilter: 'all' },
        doc, () => {}, String, String, String, String, (k) => k,
        async (url, opts) => {
            apiCalls.push({ url: String(url), method: opts?.method || 'GET', body: opts?.body ? JSON.parse(opts.body) : null });
            return { ok: true, item: {}, invoice: {}, inventory: [], transactions: [] };
        },
        (entity, push, payload) => { const saved = { id: 'new-1', ...payload }; push(saved); apiCalls.push({ url: '/api/' + entity + ' (create)', method: 'POST', body: payload }); return Promise.resolve(saved); },
        () => 'uid-1', () => {}, () => {}, () => {}, () => {}, () => {}, () => '2026-10-05');
    m.openingNet.issued = issuedMap;
    return { m, els, apiCalls };
}
function el(props = {}) { return { style: {}, value: '', innerHTML: '', textContent: '', checked: false, className: '', ...props }; }

describe('الوضع الصافي: «يتخصم أذونات الصرف من الرصيد الجديد»', () => {
    test('resolveOpeningNetItems: الصافي = البداية − المنصرف (باسم الصنف بلا حساسية لحالة الحروف)', () => {
        const { m } = build(new Map([['دجاج بلدي', 30], ['طماطم', 5]]), []);
        m.openingNet.on = true;
        const { resolved, negatives } = m.resolveOpeningNetItems([
            { name: 'دجاج بلدي', qty: 100, unit: 'كجم', price: 30, category: 'لحوم' },
            { name: '  طماطم ', qty: 20, unit: 'كجم', price: 4, category: 'خضار' },
        ]);
        expect(resolved).toHaveLength(2);
        expect(resolved[0].net).toBe(70);       // 100 − 30
        expect(resolved[0].invId).toBe(11);     // مربوط بصنف المخزن
        expect(resolved[1].net).toBe(15);       // 20 − 5
    });

    test('البداية الأقل من المنصرف → تُرفض وتظهر في negatives مع التفاصيل', () => {
        const { m } = build(new Map([['دجاج بلدي', 150]]), []);
        m.openingNet.on = true;
        const { resolved, negatives } = m.resolveOpeningNetItems([{ name: 'دجاج بلدي', qty: 100, unit: 'كجم', price: 30, category: 'لحوم' }]);
        expect(resolved).toHaveLength(0);
        expect(negatives[0]).toMatchObject({ name: 'دجاج بلدي', qty: 100, issued: 150, net: -50 });
    });

    test('resolveOpeningNetItems: المطابقة بمفتاح مطبع — مسافات زايدة/مضاعفة لا تخلق صنفًا جديدًا', () => {
        const { m } = build(new Map(), []);
        m.openingNet.on = true;
        // بالقاعدة «بيبسي عادي -كرتون» وبالشيت «بيبسي عادي  -كرتون» (مسافتان) — يجب أن يتطابقا
        const { resolved } = m.resolveOpeningNetItems([{ name: 'بيبسي عادي  -كرتون', qty: 12, unit: 'كرتون', price: 56, category: 'عام' }]);
        expect(resolved).toHaveLength(1);
        expect(resolved[0].invId).toBe(13);
    });

    test('الصنف غير الموجود في المخزن → ينشأ (invId=null) بصافي الكمية', () => {
        const { m } = build(new Map(), []);
        m.openingNet.on = true;
        const { resolved } = m.resolveOpeningNetItems([{ name: 'صنف جديد', qty: 12, unit: 'علبة', price: 8, category: 'عام' }]);
        expect(resolved[0].invId).toBeNull();
        expect(resolved[0].net).toBe(12);
    });

    test('saveOpeningNet يعين الأرصدة عبر التعديل المباشر للموجود وينشئ للجديد', async () => {
        const calls = [];
        const { m } = build(new Map([['دجاج بلدي', 30]]), calls);
        m.openingNet.on = true;
        m.openingRows.splice(0, m.openingRows.length,
            { name: 'دجاج بلدي', qty: 100, unit: 'كجم', price: 30, boxes: '', category: 'لحوم' },
            { name: 'أرز بسمتي', qty: 20, unit: 'شكارة', price: 90, boxes: '', category: 'بقالة' });
        await m.saveOpeningNet();
        expect(calls).toHaveLength(2);
        expect(calls[0].url).toContain('/inventory/11/direct');
        // mainQty: الصافي يقع على المخزن الرئيسي — رصيد مخازن الأقسام يبقى كما هو
        expect(calls[0].body).toMatchObject({ mainQty: 70, avgCost: 30 });
        expect(calls[0].body.reason).toContain('بداية 100');
        expect(calls[0].body.reason).toContain('منصرف 30');
        expect(calls[1].url).toContain('/inventory'); // إنشاء الصنف الجديد
    });

    test('مفتاح الوضع الصافي للأدمن فقط، وعمودا المنصرف/الصافي يظهران في الجدول عند التفعيل', () => {
        const { m, els } = build(new Map([['دجاج بلدي', 30]]), []);
        m.openingNet.on = true;
        m.openingRows.splice(0, m.openingRows.length, { name: 'دجاج بلدي', qty: 100, unit: 'كجم', price: 30, boxes: '', category: 'لحوم' });
        m.renderOpeningRows();
        const html = els.openingRows.innerHTML;
        expect(html).toContain('المنصرف فعليًا');
        expect(html).toContain('الصافي المعتمد');
        expect(html).toContain('>30<'); // المنصرف للدجاج
        expect(html).toContain('>70<'); // الصافي 100−30
        expect(m.openingNetEnabled()).toBe(true); // currentUser=admin في الستاب
    });

    test('الخادم: نقطة /issued-totals موجودة وتجمع قيود الصرف من الدفتر', () => {
        expect(BACKEND).toContain("'/issued-totals'");
        expect(BACKEND).toContain("reference_type='dispatch'");
        expect(BACKEND).toContain('SUM(-l.quantity_delta)');
    });

    test('الخادم: نقطة التعديل المباشر تدعم mainQty — الصافي على الرئيسي ومخازن الأقسام محفوظة', () => {
        expect(BACKEND).toContain('req.body?.mainQty');
        expect(BACKEND).toContain('main_qty_target');
        expect(BACKEND).toContain("UPDATE inventory SET \"avgCost\"=$2 WHERE id=$1 RETURNING *");
    });
});
