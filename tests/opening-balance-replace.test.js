// ────────────────────────────────────────────────────────────────────────────
// opening-balance-replace.test.js — طلب المالك 2026-10-05
// «أعيد الرصيد الافتتاحي مرة أخرى وأحذف القديم بس اخصم من الرصيد طلبات الصرف»
// الاستبدال = إلغاء الرصيد القديم (يعكس استلامه فقط — الصرف يبقى محسوبًا) ثم حفظ الجديد.
// يقيّم مصدر warehouse.js الحقيقي + يفحص نقطة تقرير الخادم في المصدر.
// ────────────────────────────────────────────────────────────────────────────
const fs = require('fs');
const path = require('path');

const RAW = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'app', 'js', 'features', 'warehouse.js'), 'utf8');
const SRC = RAW.replace(/export\s*\{[^}]*\};?/, '');
const BACKEND = fs.readFileSync(path.join(__dirname, '..', 'backend', 'warehouse-routes.js'), 'utf8');

function el(props = {}) { return { style: {}, value: '', innerHTML: '', checked: false, ...props }; }

function build(apiCalls) {
    const els = { openingReplaceTotal: el(), openingReplaceRows: el(), openingReplaceMsg: el(), openingReplaceAck: el({ checked: true }) };
    const doc = {
        getElementById: (id) => els[id] || null,
        querySelectorAll: () => [],
    };
    const apiFetch = async (url, opts) => {
        apiCalls.push({ url: String(url), method: opts?.method || 'GET', body: opts?.body ? JSON.parse(opts.body) : null });
        if (url.includes('/void')) {
            if (apiCalls.voidFailsOnce && !apiCalls.voidFailed) { apiCalls.voidFailed = true; throw new Error('الفاتورة غير موجودة'); }
            return { ok: true };
        }
        if (url.includes('/purchase-invoices')) { return { invoice: { invoiceNumber: 'OPEN-NEW' }, inventory: [], transactions: [], totalAmount: 100 }; }
        return {};
    };
    const factory = new Function('STATE', 'window', 'document', 'renderPage', 'esc', 'fN', 'fC', 'fD', 't',
        'apiFetch', 'upsertStateEntity', 'showLoad', 'hideLoad', 'closeModal', 'toast', 'addNotification', 'today',
        SRC + '\nreturn { openingReplace, buildOpeningReplaceRows, showOpeningBalanceReplaceGrid, renderOpeningReplaceRows, updateOpeningReplaceRow, confirmOpeningReplace, normalizeOpeningItems };');
    const m = factory(
        { page: 'warehouse', inventory: [], shelves: [], purchaseInvoices: [], inventoryTx: [], suppliers: [{ id: 's1', name: 'رصيد افتتاحي - بداية الفترة', category: 'افتتاحي' }] },
        { whSelected: new Set(), whCatFilter: 'all' },
        doc, () => {}, String, String, String, String, (k) => k,
        apiFetch, () => {}, () => {}, () => {}, () => {}, () => {}, () => {}, () => '2026-10-05');
    return { m, els };
}

const REPORT_INVOICE = {
    id: 501, invoiceNumber: 'OPEN-20261001-123', date: '2026-10-01', totalAmount: 800,
    items: [
        { itemId: 1, itemName: 'دجاج بلدي', qty: 100, unit: 'كجم', price: 30, category: 'لحوم', packagingQty: 10, currentQty: 70, issuedSince: 30, itemExists: true },
        { itemId: 2, itemName: 'طماطم', qty: 20, unit: 'كجم', price: 4, category: 'خضار', currentQty: null, issuedSince: 0, itemExists: false },
    ],
};

describe('استبدال الرصيد الافتتاحي — إلغاء القديم (عكس الاستلام فقط) ثم حفظ الجديد', () => {
    test('بناء صفوف التعديل من تقرير الخادم: القديم + المنصرف + الحالي مسبقة التعبئة', () => {
        const { m } = build([]);
        const rows = m.buildOpeningReplaceRows(REPORT_INVOICE);
        expect(rows).toHaveLength(2);
        expect(rows[0]).toMatchObject({ name: 'دجاج بلدي', qty: 100, price: 30, oldQty: 100, issuedSince: 30, currentQty: 70, itemExists: true, boxes: 10 });
        expect(rows[1].itemExists).toBe(false); // صنف محذوف من المخزن — يظهر بتنبيه
    });

    test('updateOpeningReplaceRow يحسب إجمالي الرصيد الجديد', () => {
        const { m, els } = build([]);
        m.openingReplace.rows = m.buildOpeningReplaceRows(REPORT_INVOICE);
        m.updateOpeningReplaceRow(0, 'qty', '80');
        m.updateOpeningReplaceRow(0, 'price', '30');
        expect(els.openingReplaceTotal.innerHTML).toBe(String(80 * 30 + 20 * 4));
    });

    test('التنفيذ: الإلغاء أولًا ثم الحفظ — وبنود الحفظ بالكميات الجديدة', async () => {
        const calls = [];
        const { m } = build(calls);
        m.openingReplace.invoiceId = 501;
        m.openingReplace.invoiceNumber = 'OPEN-20261001-123';
        m.openingReplace.rows = m.buildOpeningReplaceRows(REPORT_INVOICE);
        m.updateOpeningReplaceRow(0, 'qty', '90');
        await m.confirmOpeningReplace();
        expect(calls.length).toBe(2);
        expect(calls[0].url).toContain('/purchase-invoices/501/void');
        expect(calls[1].url).toContain('/purchase-invoices');
        expect(calls[1].body.items[0].qty).toBe(90);
        expect(calls[1].body.paidAmount).toBe(0);
        expect(calls[1].body.items[0].packagingQty).toBe(10); // كراتين اللحوم تُحفظ
    });

    test('لو الإلغاء فشل لأن القديم أُلغي سلفًا → يكمل الحفظ عادي (إعادة محاولة آمنة)', async () => {
        const calls = [];
        calls.voidFailsOnce = false;
        calls.voidFailed = true; // نحاكي: الإلغاء تم في محاولة سابقة → الخادم يقول غير موجودة
        const { m } = build(calls);
        m.openingReplace.invoiceId = 501;
        m.openingReplace.rows = m.buildOpeningReplaceRows(REPORT_INVOICE);
        await m.confirmOpeningReplace();
        expect(calls.length).toBe(2); // تجاوز فشل الإلغاء ووصل للحفظ
        expect(calls[1].url).toContain('/purchase-invoices');
    });

    test('normalizeOpeningItems: يرفض الصفوف الناقصة ويصحح الافتراضيات', () => {
        const { m } = build([]);
        const items = m.normalizeOpeningItems([
            { name: 'أرز', qty: '5', unit: '', price: '20', boxes: '', category: '' },
            { name: '', qty: 5, price: 1 },
            { name: 'سكر', qty: 0, price: 10 },
        ]);
        expect(items).toHaveLength(1);
        expect(items[0]).toMatchObject({ name: 'أرز', unit: 'كجم', category: 'عام', qty: 5, price: 20 });
    });
});

describe('الخادم: نقطة تقرير الأرصدة الافتتاحية موجودة في المصدر', () => {
    test('GET /opening-balance/report محمية بالأدوار وتحسب المنصرف من دفتر الصرف', () => {
        expect(BACKEND).toContain("'/opening-balance/report'");
        expect(BACKEND).toContain("reference_type='dispatch' AND business_date >= $2");
        expect(BACKEND).toContain("WHERE \"invoiceNumber\" LIKE 'OPEN-%'");
    });

    test('الإلغاء يسمح برصيد افتتاحي معلّم كمدفوع بالخطأ عند غياب الدفعة، وبالدفعات التوليدية حصرًا', () => {
        const voidRoute = BACKEND.slice(BACKEND.indexOf("'/purchase-invoices/:id/void'"), BACKEND.indexOf("'/opening-balance/report'"));
        expect(voidRoute).toContain('const paidOpeningWithoutPayment = isOpeningBalance');
        // 2026-10-13: الدفعة التوليدية جزء من الفاتورة — تُعكس معها بدل رفض الإلغاء
        expect(voidRoute).toContain('payRows.length === 0');
        expect(voidRoute).toContain('if (Number(inv.paidAmount || 0) > 0 && !(paidOpeningWithoutPayment || payClass.autoOnly))');
        expect(voidRoute).toContain('if (payClass.manual.length > 0)');
        expect(voidRoute).toContain("requireRole('admin')");
    });
});
