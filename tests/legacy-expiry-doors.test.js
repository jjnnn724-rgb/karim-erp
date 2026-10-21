// ────────────────────────────────────────────────────────────────────────────
// legacy-expiry-doors.test.js — سياسة 2026-10-20 في الواجهة القديمة
// تاريخ الصلاحية اختياري في كل مداخل المخزون: الغياب مقبول ويُحفظ null،
// والصيغة الفاسدة وحدها تُرفض (INVALID_EXPIRY_DATE) قبل الشبكة.
// تُثبَّت هنا:
//   • أدوات الصلاحية القديمة بنفس نصوص الخادم.
//   • كل بابٍ يرسل expiryDate (أو null)، وبوابته لا تقفل إلا على الفساد.
//   • لا تاريخ يُخترع، والقالبان (الافتتاحي + الاستيراد) بالعمود السابع.
// يُقيَّم مصدر warehouse.js الحقيقي — لا مرآة يدوية.
// ────────────────────────────────────────────────────────────────────────────
const fs = require('fs');
const path = require('path');

const APP = path.join(__dirname, '..', 'frontend', 'app');
const LEGACY = path.join(APP, 'js', 'features', 'warehouse.js');
const V2_REPO = path.join(APP, 'js', 'v2', 'data', 'inventory-repo.js');
const SERVER = path.join(__dirname, '..', 'backend', 'server.js');
const WAREHOUSE_ROUTES = path.join(__dirname, '..', 'backend', 'warehouse-routes.js');

const SRC = fs.readFileSync(LEGACY, 'utf8').replace(/export\s*\{[^}]*\};?/g, '');

function el(props = {}) { return { style: {}, value: '', innerHTML: '', checked: false, ...props }; }

/** @param {Object} over قيم الحقول المحقونة بـ id */
function build({ inventory = [], over = {}, calls = [], toasts = [], creates = [] } = {}) {
    const els = {};
    for (const [id, value] of Object.entries(over)) {
        els[id] = typeof value === 'string' || typeof value === 'number' ? el({ value: String(value) }) : el(value);
    }
    const doc = { getElementById: (id) => els[id] || null, querySelectorAll: () => [] };
    const STATE = {
        page: 'warehouse', inventory, shelves: [], purchaseInvoices: [], inventoryTx: [],
        suppliers: [], currentUser: { role: 'admin', name: 'كريم' }, settings: { currency: 'جنيه' },
    };
    const factory = new Function('STATE', 'window', 'document', 'renderPage', 'esc', 'fN', 'fC', 'fD', 't',
        'apiFetch', 'persistCreate', 'upsertStateEntity', 'uid', 'toast', 'showLoad', 'hideLoad',
        'closeModal', 'addNotification', 'today', 'openScanner', 'showModal', 'XLSX',
        `${SRC}
        return { normExpiryDate, requireExpiryDate, openingExpiryCell, openingExpiryError,
            inventoryImportRowsFromSheet, parseOpeningSheetRows,
            confirmQuickStockIn, addInventoryItem, savePurchaseInvoice,
            updateInvoiceItem, currentInvoiceItems };`);
    const m = factory(
        STATE, { whSelected: new Set(), whCatFilter: 'all' }, doc,
        () => {}, String, (v) => String(v ?? ''), (v) => String(v ?? ''), (v) => String(v ?? ''), (k) => k,
        async (url, opts) => {
            calls.push({ url: String(url), method: opts?.method || 'GET', body: opts?.body ? JSON.parse(opts.body) : null });
            return { ok: true, invoice: {}, inventory: [], transactions: [] };
        },
        (entity, push, payload) => {
            creates.push({ entity, payload });
            calls.push({ url: `/api/${entity} (create)`, method: 'POST', body: payload });
            return Promise.resolve({ id: 'new-1', ...payload });
        },
        () => {}, () => 'uid-1',
        (msg, kind) => toasts.push({ msg: String(msg), kind }),
        () => {}, () => {}, () => {}, () => {}, () => '2026-10-19',
        () => {}, () => {}, {},
    );
    return { m, els, calls, toasts, creates, STATE };
}

/* ─── أدوات الصلاحية: نفس قرار الخادم ونفس نصه ───────────────────────────── */

describe('أدوات الصلاحية القديمة — لا تُخترع تواريخ', () => {
    const { m } = build();

    test('YYYY-MM-DD وحدها مقبولة، والتقويم يُفحص لا الشكل فقط', () => {
        expect(m.normExpiryDate('2026-11-30')).toBe('2026-11-30');
        expect(m.normExpiryDate('2026-11-30T00:00:00.000Z')).toBe('2026-11-30');
        expect(m.normExpiryDate(' 2026-11-30 ')).toBe('2026-11-30');
        expect(m.normExpiryDate(new Date(2026, 10, 30))).toBe('2026-11-30');
        expect(m.normExpiryDate('2024-02-29')).toBe('2024-02-29');   // سنة كبيسة
        for (const bad of ['', '  ', null, undefined, '30/11/2026', '2026-11-5', '٢٠٢٦-١١-٣٠',
            '2026-02-31', '2026-13-01', '1899-01-01', 'ليس تاريخًا', new Date('nope')]) {
            expect(m.normExpiryDate(bad)).toBeNull();
        }
    });

    test('الرقم التسلسلي في Excel يتحول لتاريخ، وما ليس تسلسليًا يُرفض', () => {
        expect(m.openingExpiryCell(46000)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(m.openingExpiryCell('2027-06-30')).toBe('2027-06-30');
        expect(m.openingExpiryCell('30-06-2027')).toBeNull();
        expect(m.openingExpiryCell('')).toBeNull();
        expect(m.openingExpiryCell(null)).toBeNull();
    });

    test('requireExpiryDate: الغياب اختياري، والفساد وحده له رسالة', () => {
        const { m: mm, toasts } = build();
        expect(mm.requireExpiryDate('2026-11-30', 5, 'لبن')).toBe('2026-11-30');
        expect(mm.requireExpiryDate('', 0, 'لبن')).toBe('');
        expect(mm.requireExpiryDate('', 5, 'لبن')).toBe('');
        expect(toasts).toHaveLength(0);
        expect(mm.requireExpiryDate('11/30/2026', 5, 'لبن')).toBeNull();
        expect(toasts.map((x) => x.msg)).toEqual([
            'تاريخ الصلاحية غير صحيح (11/30/2026) — الصيغة المطلوبة YYYY-MM-DD',
        ]);
    });

    test('openingExpiryError: الغياب مقبول، والفساد وحده يمنع', () => {
        const { m: mm } = build();
        const many = Array.from({ length: 7 }, (_, i) => ({ name: `صنف ${i}`, expiry: '' }));
        expect(mm.openingExpiryError(many)).toBeNull();
        expect(mm.openingExpiryError([{ name: 'أ', expiry: '' }, { name: 'ب', expiry: '31/12/2026' }]))
            .toBe('تاريخ الصلاحية غير صحيح للصنف ب — الصيغة المطلوبة YYYY-MM-DD');
        expect(mm.openingExpiryError([{ name: 'ج', expiry: '31/12/2026' }]))
            .toBe('تاريخ الصلاحية غير صحيح للصنف ج — الصيغة المطلوبة YYYY-MM-DD');
        expect(mm.openingExpiryError([{ name: 'د', expiry: '2026-11-30' }])).toBeNull();
        expect(mm.openingExpiryError([])).toBeNull();
    });
});

/* ─── باب الاستلام السريع ─────────────────────────────────────────────────── */

describe('الاستلام السريع (POST /warehouse/inventory/:id/receipt)', () => {
    const item = { id: 7, name: 'لبن', unit: 'لتر', qty: 10, avgCost: 20 };

    test('بلا تاريخ: يُقبل ويُرسل expiryDate = null', async () => {
        const { m, calls, toasts } = build({ inventory: [item], over: { quickStockQty: '2', quickStockPrice: '20', quickStockExpiry: '' } });
        await m.confirmQuickStockIn(7);
        expect(calls).toHaveLength(1);
        expect(calls[0].body).toEqual({ qty: 2, price: 20, unit: 'لتر', expiryDate: null });
        expect(toasts.filter((x) => x.msg.includes('الصلاحية'))).toHaveLength(0);
    });

    test('بتاريخٍ صحيح: الباب يرسل expiryDate مع الكمية والسعر', async () => {
        const { m, calls } = build({
            inventory: [item],
            over: { quickStockQty: '3', quickStockPrice: '22', quickStockExpiry: '2026-12-05' },
        });
        await m.confirmQuickStockIn(7);
        expect(calls).toHaveLength(1);
        expect(calls[0].url).toContain('/warehouse/inventory/7/receipt');
        expect(calls[0].body).toEqual({ qty: 3, price: 22, unit: 'لتر', expiryDate: '2026-12-05' });
    });

    test('تاريخ مفسَّر لا يمر: يُرفض قبل الشبكة بلا أن يُصلح تلقائيًا', async () => {
        const { m, calls, toasts } = build({
            inventory: [item],
            over: { quickStockQty: '1', quickStockPrice: '20', quickStockExpiry: '05/11/2026' },
        });
        await m.confirmQuickStockIn(7);
        expect(calls).toHaveLength(0);
        expect(toasts[0].msg).toBe('تاريخ الصلاحية غير صحيح (05/11/2026) — الصيغة المطلوبة YYYY-MM-DD');
    });

    test('الكمية تُفحص أولًا: صفرُ كمية رسالةُ كميةٍ لا رسالةُ صلاحية', async () => {
        const { m, calls, toasts } = build({ inventory: [item], over: { quickStockQty: '0', quickStockExpiry: '' } });
        await m.confirmQuickStockIn(7);
        expect(calls).toHaveLength(0);
        expect(toasts[0].msg).toBe('أدخل كمية صحيحة');
    });
});

/* ─── باب الصنف الجديد (POST /api/inventory) ─────────────────────────────── */

describe('الصنف الجديد برصيد افتتاحي (الباب العام /inventory)', () => {
    test('رصيدٌ أكبر من صفر بلا صلاحية → يُنشأ والتاريخ null', async () => {
        const { m, calls, toasts } = build({
            over: { itemName: 'سمن', itemQty: '12', itemPrice: '40', itemExpiry: '' },
        });
        await m.addInventoryItem();
        const create = calls.find((c) => c.url.includes('/api/inventory'));
        expect(create).toBeTruthy();
        expect(create.body.expiryDate).toBeNull();
        expect(toasts.filter((x) => x.msg.includes('الصلاحية'))).toHaveLength(0);
    });

    test('الصلاحية تُرسل في جسم الإنشاء ويصل بها القيد في الدفتر', async () => {
        const { m, calls } = build({
            over: { itemName: 'سمن', itemQty: '12', itemPrice: '40', itemExpiry: '2027-08-31', itemUnit: 'كجم' },
        });
        await m.addInventoryItem();
        const create = calls.find((c) => c.url.includes('/api/inventory'));
        expect(create).toBeTruthy();
        expect(create.body.name).toBe('سمن');
        expect(create.body.qty).toBe(12);
        expect(create.body.expiryDate).toBe('2027-08-31');
    });

    test('صفرُ رصيد: لا بوابة ولا انتظار للتاريخ — الصنف يُنشأ كما كان', async () => {
        const { m, calls, toasts } = build({
            over: { itemName: 'معلقة خشب', itemQty: '0', itemPrice: '0', itemExpiry: '' },
        });
        await m.addInventoryItem();
        expect(toasts.filter((x) => x.msg.includes('الصلاحية'))).toHaveLength(0);
        const create = calls.find((c) => c.url.includes('/api/inventory'));
        expect(create).toBeTruthy();
        expect(create.body.qty).toBe(0);
        expect(create.body.expiryDate).toBeNull();
    });
});

/* ─── باب فاتورة الشراء ──────────────────────────────────────────────────── */

describe('فاتورة الشراء (POST /warehouse/purchase-invoices)', () => {
    const fields = {
        invoiceNumber: 'INV-7', invoiceDate: '2026-10-17', supplierName: 'مورد حر',
        supplierPhone: '', paymentMethod: 'cash', invoicePaidAmount: '', invoiceNotes: '',
        invoiceDiscountType: 'none', invoiceDiscountValue: '0', invoiceSupplierSel: '',
    };

    function withRows(rows) {
        const ctx = build({ over: fields });
        ctx.m.currentInvoiceItems.splice(0, ctx.m.currentInvoiceItems.length, ...rows);
        return ctx;
    }

    test('سطرٌ بلا صلاحية يُحفظ والتاريخ null، وبلا رسالة إلزام', async () => {
        const { m, calls, toasts } = withRows([
            { itemName: 'دجاج', qty: 2, price: 30, unit: 'كجم', total: 60 },
            { itemName: 'أرز', qty: 5, price: 12, unit: 'كجم', total: 60, expiryDate: '2027-01-31' },
        ]);
        await m.savePurchaseInvoice();
        expect(calls).toHaveLength(1);
        expect(calls[0].body.items[0].expiryDate).toBeNull();
        expect(calls[0].body.items[1].expiryDate).toBe('2027-01-31');
        expect(toasts.filter((x) => x.msg.includes('الصلاحية'))).toHaveLength(0);
    });

    test('حقل التاريخ في السطر يكتب في الموديل — بلا هذا الفرع لا ينجو سطرٌ أبدًا', () => {
        const { m } = withRows([{ itemName: 'دجاج', qty: 2, price: 30, unit: 'كجم', total: 60, expiryDate: '' }]);
        m.updateInvoiceItem(0, 'expiryDate', '2026-12-05');
        expect(m.currentInvoiceItems[0].expiryDate).toBe('2026-12-05');
        m.updateInvoiceItem(0, 'expiryDate', '');
        expect(m.currentInvoiceItems[0].expiryDate).toBe('');
    });

    test('التاريخ المكتوب من الحقل يصل في بند الفاتورة بعد الحفظ', async () => {
        const { m, calls } = withRows([{ itemName: 'دجاج', qty: 2, price: 30, unit: 'كجم', total: 60, expiryDate: '' }]);
        m.updateInvoiceItem(0, 'expiryDate', '2026-12-05');
        await m.savePurchaseInvoice();
        expect(calls).toHaveLength(1);
        expect(calls[0].body.items[0].expiryDate).toBe('2026-12-05');
    });

    test('كل الأسطر سليمة: expiryDate تصل في بند الفاتورة (JSONB الأدفعات)', async () => {
        const { m, calls } = withRows([
            { itemName: 'دجاج', qty: 2, price: 30, unit: 'كجم', total: 60, expiryDate: '2026-12-31' },
        ]);
        await m.savePurchaseInvoice();
        expect(calls).toHaveLength(1);
        expect(calls[0].url).toBe('/warehouse/purchase-invoices');
        expect(calls[0].body.items[0]).toMatchObject({ itemName: 'دجاج', qty: 2, expiryDate: '2026-12-31' });
    });

    test('الأسطر غير المكتملة تُسقط قبل البوابة: سطرٌ بكمية صفر لا يطلب تاريخًا', async () => {
        const { m, calls } = withRows([
            { itemName: 'دجاج', qty: 2, price: 30, unit: 'كجم', total: 60, expiryDate: '2026-12-31' },
            { itemName: '', qty: 1, price: 5, expiryDate: '' },
            { itemName: 'ملح', qty: 0, price: 1, expiryDate: '' },
        ]);
        await m.savePurchaseInvoice();
        expect(calls).toHaveLength(1);
        expect(calls[0].body.items).toHaveLength(1);
    });

    test('أكثر من خمسة أسطر فاسدة: خمسة أسماء ثم العدّ — والغياب لا يُمنع', async () => {
        const rows = Array.from({ length: 7 }, (_, i) => ({ itemName: `صنف ${i}`, qty: 1, price: 1, total: 1, expiryDate: '31/12/2026' }));
        const { m, toasts } = withRows(rows);
        await m.savePurchaseInvoice();
        expect(toasts[0].msg).toContain('غير صحيح');
        expect(toasts[0].msg).toContain('(+2 صنفًا)');
    });
});

/* ─── باب استيراد Excel ──────────────────────────────────────────────────── */

describe('استيراد المخزون بالـExcel (POST /warehouse/inventory/bulk-receipt)', () => {
    test('العمود السابع (ز) صلاحية: نصٌّ أو رقم Excel أو Date — والغياب null', () => {
        const { m } = build();
        const rows = m.inventoryImportRowsFromSheet([
            ['اسم الصنف', 'الفئة', 'الوحدة', 'الكمية', 'سعر الشراء', 'الحد الأدنى', 'تاريخ الصلاحية'],
            ['دجاج', 'لحوم', 'كجم', 50, 25, 10, '2026-11-30'],
            ['أرز', 'حبوب', 'كيس', 100, 3.5, 20, 46000],
            ['زيت', 'زيوت', 'لتر', 30, 8, 5, new Date(2027, 2, 31)],
            ['ملح', 'بقالة', 'كجم', 5, 2, 1, ''],
            ['فلفل', 'بقالة', 'كجم', 5, 2, 1],
        ]);
        expect(rows.map((r) => r.name)).toEqual(['دجاج', 'أرز', 'زيت', 'ملح', 'فلفل']);
        expect(rows[0].expiryDate).toBe('2026-11-30');
        expect(rows[1].expiryDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);   // رقم Excel التسلسلي
        expect(rows[2].expiryDate).toBe('2027-03-31');               // خلية تاريخ
        expect(rows[3].expiryDate).toBeNull();                       // خلية فارغة
        expect(rows[4].expiryDate).toBeNull();                       // لا عمود سابع أصلًا
    });

    test('قراءة تاريخ سيئ الصيغة لا تُصلحه: null ثم ترفضه البوابة', () => {
        const { m } = build();
        const [row] = m.inventoryImportRowsFromSheet([['خالي', 'فئة', 'كجم', 1, 1, 1, '31-12-2026']]);
        expect(row.expiryDate).toBeNull();
    });

    test('قالب القديم ونموذجها بالعمود السابع وحقل صلاحية الورقة', () => {
        const src = fs.readFileSync(LEGACY, 'utf8');
        expect(src).toContain("['اسم الصنف','الفئة','الوحدة','الكمية','سعر الشراء','الحد الأدنى','تاريخ الصلاحية']");
        expect(src).toContain('الأعمدة: اسم الصنف، الفئة، الوحدة، الكمية، سعر الشراء، الحد الأدنى، تاريخ الصلاحية (YYYY-MM-DD)');
        expect(src).toContain("id=\"bulkSheetExpiry\"");
        expect(src).toContain("['اسم الصنف','الوحدة','كمية فعلية','سعر الشراء','الكراتين','الفئة','تاريخ الصلاحية']");
    });

    test('جدول الافتتاحي وشبكة الاستبدال: عمود صلاحية اختياري في كلٍّ', () => {
        const src = fs.readFileSync(LEGACY, 'utf8');
        expect((src.match(/تاريخ الصلاحية<\/th>/g) || []).length).toBeGreaterThanOrEqual(2);   // الافتتاحي + الاستبدال
        expect(src).toContain('<label>تاريخ الصلاحية</label>');               // الاستلام السريع
        expect(src).toContain('تاريخ الصلاحية</small>');                      // سطر فاتورة الشراء
        expect(src).toContain('openingExpiry_${idx}');
        expect(src).toContain('data-karim-action="updateOpeningReplaceRow"');
        expect(src).toContain('data-karim-args="[&quot;${idx}&quot;,&quot;expiry&quot;]"');
        expect(src).toContain('data-karim-pass="value"');
    });

    test('استيراد الرصيد الافتتاحي: الصف بلا عمود صلاحية يُقبل (اختياري)', () => {
        const { m } = build();
        const parsed = m.parseOpeningSheetRows([['اسم الصنف', 'الكمية', 'سعر الشراء'], ['لبن', 5, 20]]);
        expect(parsed.rows).toHaveLength(1);
        expect(parsed.rows[0].expiry).toBe('');
        expect(parsed.errors).toHaveLength(0);
        expect(m.openingExpiryError(parsed.rows)).toBeNull();
        const withCol = m.parseOpeningSheetRows([['اسم الصنف', 'الكمية', 'سعر الشراء', 'تاريخ الصلاحية'], ['لبن', 5, 20, '2026-12-01']]);
        expect(withCol.rows[0].expiry).toBe('2026-12-01');
        expect(m.openingExpiryError(withCol.rows)).toBeNull();
        const bad = m.parseOpeningSheetRows([['اسم الصنف', 'الكمية', 'سعر الشراء', 'تاريخ الصلاحية'], ['لبن', 5, 20, 'وليل']]);
        expect(bad.errors[0].message).toContain('تاريخ الصلاحية غير صحيح');
        expect(bad.rows).toHaveLength(0);
    });
});

/* ─── العقد مع الخادم: الخادم يبقى الحاكم ────────────────────────────────── */

describe('العقد مع الخادم', () => {
    test('لا رسائل إلزام قديمة في الخادم — الرفض للصيغة الفاسدة فقط', () => {
        const policy = fs.readFileSync(path.join(__dirname, '..', 'backend', 'expiry-policy.js'), 'utf8');
        expect(policy).toContain('تاريخ الصلاحية غير صحيح للصنف');
        expect(policy).not.toContain('تاريخ الصلاحية إلزامي لكل صنف');
        expect(fs.readFileSync(SERVER, 'utf8')).not.toContain('EXPIRY_DATE_REQUIRED');
    });

    test('الباب العام يجرّد حقول الصلاحية ولا عمود phantom في inventory', () => {
        const server = fs.readFileSync(SERVER, 'utf8');
        expect((server.match(/dropExpiryFields\(req\)/g) || []).length).toBeGreaterThanOrEqual(4);
        expect((server.match(/checkInventoryOpeningExpiry\(entity, req\.body\)/g) || []).length).toBe(2);
    });

    test('أبواب المخزون الثلاثة تُغلق بالـ422، والحركات الداخلية تحمل آخر صلاحية', () => {
        const routes = fs.readFileSync(WAREHOUSE_ROUTES, 'utf8');
        expect((routes.match(/checkExpiryOnLines\(/g) || []).length).toBe(3);
        expect(routes).not.toContain('EXPIRY_DATE_REQUIRED');
        expect(routes).toContain('latestExpiryFor(');
    });

    test('المرآة القديمة لا تتعارض مع مستودع V2: نفس العمود السابع ونفس الاحتياط', () => {
        const v2 = fs.readFileSync(V2_REPO, 'utf8');
        expect(v2).toContain('applySheetExpiry');
        expect(v2).toContain('expiryDate: sheetExpiryCell(expiryCell)');
        expect(v2).toContain('value - 25569');          // نفس تحويل الرقم التسلسلي في القديم
    });
});
