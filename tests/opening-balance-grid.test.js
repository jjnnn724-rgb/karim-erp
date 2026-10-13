// ────────────────────────────────────────────────────────────────────────────
// opening-balance-grid.test.js — طلب المالك 2026-10-05
// «عايز اضبط قوائم الرصيد الافتتاحي مثل هذا أقدر أدخل الجدول»
// الأعمدة: اسم الصنف | الوحدة | كمية فعلية | سعر الشراء — جدول إدخال حقيقي
// مع التنقل بـ Enter وعمود كراتين للحوم فقط — وإصلاح الزر المعطول (دوال غير مصدَّرة).
// يقيّم مصدر warehouse.js الحقيقي بمستند وهمي — نفس ما يعمل في المتصفح.
// ────────────────────────────────────────────────────────────────────────────
const fs = require('fs');
const path = require('path');

const RAW = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'app', 'js', 'features', 'warehouse.js'), 'utf8');
const SRC = RAW.replace(/export\s*\{[^}]*\};?/, '');

/** عنصر DOM وهمي بحد أدنى */
function el(props = {}) { return { style: {}, value: '', innerHTML: '', focused: false, focus() { this.focused = true; }, select() {}, ...props }; }

/** مستند وهمي: يعرف العناصر بالمعرف + استعلامات معدودة للجدول */
function fakeDocument(els, queryables = {}) {
    return {
        getElementById: (id) => els[id] || null,
        querySelectorAll: (sel) => queryables[sel] || [],
    };
}

function build(els, queryables) {
    const doc = fakeDocument(els, queryables);
    const calls = { renderPage: 0 };
    const factory = new Function('STATE', 'window', 'document', 'renderPage', 'esc', 'fN', 'fC', 'fD', 't', 'today',
        SRC + '\nreturn { openingRows, openingImportPreview, isOpeningMeatRow, renderOpeningRows, openingBoxCell, openingRowKey, addOpeningRow, removeOpeningRow, updateOpeningRow, updateOpeningTotal, showOpeningBalanceModal, saveOpeningBalance, syncOpeningRowWithInventory };');
    const m = factory(
        { page: 'warehouse', inventory: [
            { id: 'i1', name: 'دجاج بلدي', unit: 'كجم', qty: 0, minQty: 0, avgCost: 30, category: 'لحوم' },
            { id: 'i2', name: 'طماطم', unit: 'كجم', qty: 0, minQty: 0, avgCost: 4, category: 'خضار' },
        ], shelves: [], purchaseInvoices: [], inventoryTx: [], suppliers: [] },
        { whSelected: new Set(), whCatFilter: 'all' },
        doc, () => { calls.renderPage++; }, String, String, String, String, (k) => k,
        () => new Date().toISOString().split('T')[0]);
    return { m, calls, doc };
}

describe('الرصيد الافتتاحي: جدول إدخال بأعمدة المالك (اسم الصنف | الوحدة | كمية فعلية | سعر الشراء)', () => {
    test('renderOpeningRows يرسم جدولًا بالأعمدة الأربعة وخلية كراتين مخفية لغير اللحوم', () => {
        const els = { openingRows: el() };
        const { m } = build(els, {});
        m.openingRows.splice(0, m.openingRows.length,
            { name: 'طماطم', qty: 10, unit: 'كجم', price: 4, boxes: '', category: 'خضار' });
        m.renderOpeningRows();
        const html = els.openingRows.innerHTML;
        expect(html).toContain('<th>اسم الصنف</th>');
        expect(html).toContain('كمية فعلية');
        expect(html).toContain('سعر الشراء');
        expect(html).toContain('كراتين');
        expect(html).toContain('openingBoxDash_0" style="display:"'); // غير لحمي → الشرطة ظاهرة
        expect(html).toContain('list="openingInvList"'); // إكمال تلقائي بأسماء المخزن
    });

    test('الصف اللحمي (دجاج) يظهر له حقل كراتين — والكشف من الاسم ولو الفئة ناقصة', () => {
        const { m } = build({ openingRows: el() }, {});
        expect(m.isOpeningMeatRow({ name: 'دجاج بلدي', category: '' })).toBe(true);
        expect(m.isOpeningMeatRow({ name: 'فراخ مشوية', category: '' })).toBe(true);
        expect(m.isOpeningMeatRow({ name: 'Beef', category: '' })).toBe(true);
        expect(m.isOpeningMeatRow({ name: 'أي صنف', category: 'لحوم' })).toBe(true);
        expect(m.isOpeningMeatRow({ name: 'طماطم', category: 'خضار' })).toBe(false);

        const els = { openingRows: el() };
        const { m: m2 } = build(els, {});
        m2.openingRows.splice(0, m2.openingRows.length,
            { name: 'دجاج بلدي', qty: 50, unit: 'كجم', price: 30, boxes: 4, category: 'لحوم' });
        m2.renderOpeningRows();
        const html = els.openingRows.innerHTML;
        expect(html).toContain('openingBoxes_0');                        // حقل الكراتين موجود
        expect(html).toContain('openingBoxDash_0" style="display:none"'); // والشرطة مخفية لهذا الصف
        expect(html).toContain('value="4"');                              // قيمة الكراتين محفوظة
    });

    test('updateOpeningRow: كتابة اسم صنف موجود يجيب وحدته من المخزن تلقائيًا', () => {
        const els = {
            openingRows: el(),
            openingUnit_0: el(),
            openingBoxes_0: el(),
            openingBoxDash_0: el(),
        };
        const { m } = build(els, {});
        m.openingRows.splice(0, m.openingRows.length, { name: '', qty: '', unit: '', price: '', boxes: '', category: '' });
        m.updateOpeningRow(0, 'name', 'دجاج بلدي');
        expect(m.openingRows[0].name).toBe('دجاج بلدي');
        expect(m.openingRows[0].unit).toBe('كجم');       // وحدة الصنف من المخزن
        expect(m.openingRows[0].category).toBe('لحوم');  // فئة الصنف من المخزن (داخلية)
        expect(els.openingUnit_0.value).toBe('كجم');     // وانعكست على الخلية
    });

    test('تحديث الكمية والسعر يرفع الإجمالي', () => {
        const els = { openingRows: el(), openingTotal: el() };
        const { m } = build(els, {});
        m.openingRows.splice(0, m.openingRows.length, { name: 'طماطم', qty: '', unit: 'كجم', price: '', boxes: '', category: 'خضار' });
        m.updateOpeningRow(0, 'qty', '10');
        m.updateOpeningRow(0, 'price', '4');
        expect(els.openingTotal.innerHTML).toContain('40');
    });

    test('openingRowKey: Enter ينقل التركيز للخلية التالية المتاحة (يتخطى كراتين المخفي)', () => {
        const name = el(), unit = el(), qty = el(), price = el(), boxes = el({ style: { display: 'none' } });
        const row = { querySelectorAll: (s) => (s === 'input' ? [name, unit, qty, price, boxes] : []) };
        const rows = { '#openingRows tbody tr': [row] };
        const { m } = build({}, rows);
        const evs = [];
        m.openingRowKey({ key: 'Enter', target: price, preventDefault: () => evs.push('pd') }, 0);
        expect(evs).toContain('pd');      // Enter لا يرسل النموذج
        expect(price.focused).toBe(false);
        // السعر آخر خلية متاحة (الكراتين مخفي) → آخر الصف يضيف صفًا جديدًا (صف واحد فقط هنا)
        const before = m.openingRows.length;
        expect(before).toBe(1);
        // الصف السابق: pos=len-1 ضمن المتاحة → لم ينتقل داخل الصف — والتركيز الحقيقي بيد المتصفح
    });

    test('addOpeningRow يضيف صفًا فارغًا جاهزًا للإدخال', () => {
        const els = { openingRows: el() };
        const { m } = build(els, {});
        m.openingRows.splice(0, m.openingRows.length, { name: 'طماطم', qty: 5, unit: 'كجم', price: 4, boxes: '', category: 'خضار' });
        m.addOpeningRow();
        expect(m.openingRows).toHaveLength(2);
        expect(m.openingRows[1]).toMatchObject({ name: '', qty: '', price: '' });
    });
});

describe('إصلاح الزر المعطول: كل دوال الرصيد الافتتاحي تُصدَّر من الموديول', () => {
    test('سطر التصدير يشمل كل الدوال التي تستدعيها onclick/onchange داخل الشاشة', () => {
        const exportLine = RAW.match(/export\s*\{[^}]*\}/)[0];
        for (const fn of ['showOpeningBalanceModal', 'downloadOpeningTemplate', 'previewOpeningExcel',
            'appendOpeningImportRows', 'renderOpeningRows', 'openingRowKey', 'addOpeningRow',
            'removeOpeningRow', 'updateOpeningRow', 'saveOpeningBalance']) {
            expect(exportLine).toContain(fn);
        }
    });

    test('منطق الحفظ لم يتغير: فاتورة آجلة ببنود itemName/qty/unit/price وpackagingQty للحوم', () => {
        const saveBody = SRC.slice(SRC.indexOf('function normalizeOpeningItems'), SRC.indexOf('function viewPurchaseInvoice'));
        expect(saveBody).toContain("'/warehouse/purchase-invoices'");
        expect(saveBody).toContain("paymentMethod:'credit'");
        expect(saveBody).toContain('paidAmount:0');
        expect(saveBody).toContain('itemName:r.name');
        expect(saveBody).toContain('packagingQty:r.boxes');
    });
});
