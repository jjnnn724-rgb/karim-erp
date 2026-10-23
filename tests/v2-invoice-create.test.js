/**
 * v2-invoice-create.test.js — 26c-2: إنشاء/تعديل فاتورة الشراء + البحث الذكي
 * ═══════════════════════════════════════════════════════════════════════
 * ما يُثبَّت هنا هو ما لا يُرى بالعين في المتصفح:
 *   • البوابة مرآة الخادم: POST/PUT requireRole('admin','manager','warehouse')
 *     (warehouse-routes.js:1802/2114) فوق العلم المستقل v2invoicecreate.
 *   • الحمولة نفس حقول نموذج القديم وقواعده (features/warehouse.js:1738-1763):
 *     السطور الناقصة تُسقط، الوزن الفارغ صفر، والمسدد يُحذف ما لم يلمسه
 *     المستخدم (undefined في القديم = غياب المفتاح هنا).
 *   • قفل التعديل حرفيًا: paidAmount > 0 ممنوع، والخادم يبقى الحاكم.
 *   • البحث الذكي منقول عن features/smart-item-search.js: التطبيع العربي،
 *     ترتيب 120/100/80/60، كل الكلمات شرط، والسقف 30.
 *   • الشاشة لا شبكة فيها، والمحرر لا يكتب إلا عبر مستودع الكتابة.
 *   • الصلاحية (سياسة 2026-10-20): حقل اختياري على كل سطر، وبوابته
 *     في المحرر تُصدر رسالة الخادم نفسها عند الفساد قبل القفل والشبكة.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { evalV2Module } = require('./v2-esm-harness');

// الرموز المستوردة في المستودع الحقيقي — محقونة من مصدرها لا من مرآة يدوية.
const EXPIRY = evalV2Module('data/expiry-policy.js');

const ROOT = path.join(__dirname, '..');
const APP = path.join(ROOT, 'frontend', 'app');
const V2 = path.join(APP, 'js', 'v2');
const WRITE_REPO = path.join(V2, 'data', 'purchase-invoices-write-repo.js');
const SEARCH = path.join(V2, 'item-search.js');
const EDITOR = path.join(V2, 'invoice-editor.js');
const SCREEN = path.join(V2, 'screens', 'wh-invoices.js');
const INVOICES = path.join(V2, 'screens', 'invoices.js');
const V2_HTML = path.join(APP, 'v2.html');
const CSS = path.join(APP, 'css', 'v2', 'erp-invoice-editor.css');

const read = (p) => fs.readFileSync(p, 'utf8');

function loadModule(file, exports, injections = {}) {
    const src = read(file)
        .split('\n')
        .filter((line) => !/^\s*import\b/.test(line))
        .join('\n')
        .replace(/^export\s+/gm, '');
    const ctx = {
        console, JSON, String, Number, Boolean, Array, Object, RegExp, Error, Math, Promise,
        Date, isNaN, parseFloat, parseInt,
        normalizeExpiryDate: EXPIRY.normalizeExpiryDate,
        readExpiryField: EXPIRY.readExpiryField,
        ...injections,
    };
    vm.createContext(ctx);
    vm.runInContext(`${src}\n;Object.assign(globalThis, {${exports.join(', ')}});`,
        ctx, { filename: file });
    return ctx;
}

const repo = loadModule(WRITE_REPO, [
    'INVOICE_CREATE_ROLES', 'TAX_CATEGORIES', 'EDIT_LOCKED_MESSAGE',
    'invoiceItemsFromRow', 'invoiceFormFromRow', 'invoiceEditable',
    'purchaseInvoicePayload', 'isDuplicateInvoiceError',
    'createPurchaseInvoice', 'updatePurchaseInvoice',
], { apiFetch: async () => ({}) });

const search = loadModule(SEARCH, [
    'SMART_SEARCH_STORAGE_KEY', 'SMART_SEARCH_MAX',
    'normalizeItemText', 'scoreItemMatch', 'rankItemMatches',
    'smartSearchEnabled', 'setSmartSearchEnabled',
]);

const editorSrc = read(EDITOR);
const screenSrc = read(SCREEN);
const invoicesSrc = read(INVOICES);
const htmlSrc = read(V2_HTML);
const cssSrc = read(CSS);

/* ─── المستودع: مرآة الخادم ─────────────────────────────────────────────── */

describe('مستودع الكتابة — الأدوار والحقول', () => {
    test('الأدوار مرآة requireRole على POST/PUT', () => {
        expect(repo.INVOICE_CREATE_ROLES).toEqual(['admin', 'manager', 'warehouse']);
        expect(read(path.join(ROOT, 'backend', 'warehouse-routes.js')))
            .toContain("router.post('/purchase-invoices', jwtAuth, requireRole('admin', 'manager', 'warehouse')");
    });

    test('فئات الضريبة الأربع كما في الخادم', () => {
        expect(repo.TAX_CATEGORIES).toEqual(['STANDARD', 'ZERO_RATED', 'EXEMPT', 'OUT_OF_SCOPE']);
    });

    test('قفل التعديل: paidAmount > 0 ممنوع، والصفر مسموح', () => {
        expect(repo.invoiceEditable({ paidAmount: 0 })).toBe(true);
        expect(repo.invoiceEditable({ paidAmount: '0' })).toBe(true);
        expect(repo.invoiceEditable({ paidAmount: 0.01 })).toBe(false);
        expect(repo.invoiceEditable({ paidAmount: 100 })).toBe(false);
        expect(repo.EDIT_LOCKED_MESSAGE).toBe('لا يمكن تعديل فاتورة عليها دفعة مسجلة؛ اعكس الدفعة رسميًا أولًا');
        expect(read(path.join(ROOT, 'backend', 'warehouse-routes.js')))
            .toContain('لا يمكن تعديل فاتورة عليها دفعة مسجلة؛ اعكس الدفعة رسميًا أولًا');
    });
});

describe('مستودع الكتابة — سطور الفاتورة والنموذج', () => {
    test('items نص JSON يُفكّ، والبدائل snake_case مقبولة', () => {
        const items = repo.invoiceItemsFromRow({
            items: JSON.stringify([{
                item_id: 7, name: 'دجاج', qty: '2', price: '30', tax_category: 'ZERO_RATED',
                packaging_qty: 4, packaging_uom: 'كرتون',
            }]),
        });
        expect(items).toEqual([{
            itemId: 7, itemName: 'دجاج', qty: 2, price: 30, unit: 'وحدة', weight: '',
            taxCategory: 'ZERO_RATED', packagingQty: 4, packagingUom: 'كرتون', expiryDate: '',
        }]);
    });

    test('الصلاحية تُقرأ من camelCase وsnake_case على السطر المُوفَّق', () => {
        expect(repo.invoiceItemsFromRow({ items: [{ name: 'لبن', expiryDate: '2026-11-30T00:00:00.000Z' }] })[0].expiryDate)
            .toBe('2026-11-30');
        expect(repo.invoiceItemsFromRow({ items: [{ name: 'لبن', expiry_date: '2027-01-05' }] })[0].expiryDate)
            .toBe('2027-01-05');
        // تاريخ غير موفَّق يبقى فارغًا — المحرر يعلّمه ناقصًا بدل أن يخترع له بديلًا.
        expect(repo.invoiceItemsFromRow({ items: [{ name: 'لبن', expiry_date: '30/11/2026' }] })[0].expiryDate)
            .toBe('');
    });

    test('items تالفة أو غائبة → مصفوفة فارغة لا انفجار', () => {
        expect(repo.invoiceItemsFromRow({ items: '{oops' })).toEqual([]);
        expect(repo.invoiceItemsFromRow({})).toEqual([]);
    });

    test('نموذج التعديل يقرأ discount_type وdiscount_value كما القديم', () => {
        const form = repo.invoiceFormFromRow({
            id: 5, invoiceNumber: 'INV-5', date: '2026-10-01T00:00:00.000Z',
            supplierId: 3, supplierName: 'مورد', supplierPhone: '010',
            paymentMethod: 'credit', notes: 'ملاحظة',
            discount_type: 'percent', discount_value: '10', paidAmount: '0',
            items: [{ itemName: 'أرز', qty: 1, price: 20 }],
        });
        expect(form.invoiceNumber).toBe('INV-5');
        expect(form.date).toBe('2026-10-01');
        expect(form.supplierId).toBe(3);
        expect(form.discountType).toBe('percent');
        expect(form.discountValue).toBe(10);
        expect(form.paidAmount).toBe(0);
        expect(form.items).toHaveLength(1);
    });
});

describe('مستودع الكتابة — الحمولة الحرفية', () => {
    const base = {
        invoiceNumber: 'INV-9', date: '2026-10-17', supplierId: '', supplierName: ' مورد حر ',
        supplierPhone: ' 010 ', paymentMethod: 'cash', notes: ' ن ',
        discountType: 'amount', discountValue: '5',
        items: [
            { itemName: ' دجاج ', qty: '2', price: '30.5', unit: '', weight: '', taxCategory: 'EXEMPT' },
            { itemName: '', qty: 1, price: 10 },
            { itemName: 'صفر كمية', qty: 0, price: 10 },
        ],
    };

    test('السطور غير الصالحة تُسقط، والافتراضات كما الخادم', () => {
        const p = repo.purchaseInvoicePayload(base);
        expect(p.invoiceNumber).toBe('INV-9');
        expect(p.supplierId).toBeNull();
        expect(p.supplierName).toBe('مورد حر');
        expect(p.supplierPhone).toBe('010');
        expect(p.discountType).toBe('amount');
        expect(p.discountValue).toBe(5);
        expect(p.items).toEqual([{
            itemId: null, itemName: 'دجاج', qty: 2, price: 30.5,
            unit: 'وحدة', weight: 0, taxCategory: 'EXEMPT', expiryDate: null,
        }]);
        // القديم أرسل undefined فيُحذف المفتاح — الخادم يسدد تلقائيًا.
        expect('paidAmount' in p).toBe(false);
    });

    test('الصلاحية تُطوى في السطر كما هي: YYYY-MM-DD أو null، ولا تُخترع', () => {
        const p = repo.purchaseInvoicePayload({
            items: [
                { itemName: 'لبن', qty: 1, price: 10, expiryDate: '2026-11-30' },
                { itemName: 'سمن', qty: 1, price: 10, expiry_date: '2027-02-01' },
                { itemName: 'ملح', qty: 1, price: 10, expiryDate: '30/11/2026' },
                { itemName: 'سكر', qty: 1, price: 10 },
            ],
        });
        expect(p.items.map((l) => l.expiryDate)).toEqual(['2026-11-30', '2027-02-01', null, null]);
    });

    test('المسدد يُرسل فقط عند لمسه ويقبل الصفر', () => {
        expect(repo.purchaseInvoicePayload({ ...base, paidTouched: true, paidAmount: '0' }).paidAmount).toBe(0);
        expect(repo.purchaseInvoicePayload({ ...base, paidTouched: true, paidAmount: '' }))
            .not.toHaveProperty('paidAmount');
        expect(repo.purchaseInvoicePayload({ ...base, paidTouched: true, paidAmount: '12.5' }).paidAmount).toBe(12.5);
    });

    test('التغليف يُرسل فقط عند وجوده، والفئة الغريبة تعود STANDARD', () => {
        const p = repo.purchaseInvoicePayload({
            items: [{ itemName: 'سكر', qty: 1, price: 5, taxCategory: 'WHATEVER', packagingQty: '6', packagingUom: 'كرتون' }],
        });
        expect(p.items[0].taxCategory).toBe('STANDARD');
        expect(p.items[0].packagingQty).toBe(6);
        expect(p.items[0].packagingUom).toBe('كرتون');
        const q = repo.purchaseInvoicePayload({ items: [{ itemName: 'سكر', qty: 1, price: 5 }] });
        expect(q.items[0]).not.toHaveProperty('packagingQty');
    });
});

describe('مستودع الكتابة — البابان', () => {
    test('POST يحمل الحمولة نفسها إلى /warehouse/purchase-invoices', async () => {
        const calls = [];
        const ctx = loadModule(WRITE_REPO, ['createPurchaseInvoice'],
            { apiFetch: async (p, opts) => { calls.push({ p, opts }); return { ok: true }; } });
        await ctx.createPurchaseInvoice({
            invoiceNumber: 'INV-1', date: '2026-10-17',
            items: [{ itemName: 'أرز', qty: 1, price: 10 }],
        });
        expect(calls[0].p).toBe('/warehouse/purchase-invoices');
        expect(calls[0].opts.method).toBe('POST');
        const body = JSON.parse(calls[0].opts.body);
        expect(body.items).toHaveLength(1);
        expect(body.items[0].itemName).toBe('أرز');
        expect(body.items[0]).toHaveProperty('expiryDate', null);
        expect(body).not.toHaveProperty('paidAmount');
    });

    test('الباب يرسل الصلاحية كما يملؤها المحرر — ولا شيء يُحذف في الطريق', async () => {
        const calls = [];
        const ctx = loadModule(WRITE_REPO, ['createPurchaseInvoice'],
            { apiFetch: async (p, opts) => { calls.push(JSON.parse(opts.body)); return { ok: true }; } });
        await ctx.createPurchaseInvoice({
            invoiceNumber: 'INV-2', date: '2026-10-17',
            items: [{ itemName: 'لبن', qty: 1, price: 10, expiryDate: '2026-11-30' }],
        });
        expect(calls[0].items[0].expiryDate).toBe('2026-11-30');
    });

    test('PUT يرفض المعرّف غير الصحيح قبل الشبكة', async () => {
        const calls = [];
        const ctx = loadModule(WRITE_REPO, ['updatePurchaseInvoice'],
            { apiFetch: async (p) => { calls.push(p); return {}; } });
        for (const bad of [null, undefined, '', 'x', 0, -1, 1.5]) {
            await expect(ctx.updatePurchaseInvoice(bad, {})).rejects.toThrow('معرف الفاتورة غير صحيح');
        }
        expect(calls).toHaveLength(0);
        await ctx.updatePurchaseInvoice('12', { items: [] });
        expect(calls[0]).toBe('/warehouse/purchase-invoices/12');
    });

    test('تكرار الفاتورة: DUPLICATE_INVOICE وحده «معلومة» — لا رقم مكرر', () => {
        expect(repo.isDuplicateInvoiceError({ code: 'DUPLICATE_INVOICE' })).toBe(true);
        expect(repo.isDuplicateInvoiceError({ message: 'فاتورة مشابهة مسجلة' })).toBe(true);
        expect(repo.isDuplicateInvoiceError({ code: 'DUPLICATE_INVOICE_NUMBER', message: 'رقم الفاتورة مستخدم من قبل' })).toBe(false);
        expect(repo.isDuplicateInvoiceError(null)).toBe(false);
    });
});

/* ─── البحث الذكي ───────────────────────────────────────────────────────── */

describe('البحث الذكي — تطبيع وترتيب', () => {
    test('التطبيع العربي: همزات وتاء مربوطة وياء وتشكيل وتطويل', () => {
        expect(search.normalizeItemText('  أَحْمَر  ')).toBe('احمر');
        expect(search.normalizeItemText('سَلَّة')).toBe('سله');
        expect(search.normalizeItemText('مُسْتَوْدَع')).toBe('مستودع');
        expect(search.normalizeItemText('عليـــاء')).toBe('علياء');
        expect(search.normalizeItemText('مؤن')).toBe('مون');
        expect(search.normalizeItemText('شيئ')).toBe('شيي');
    });

    test('الترتيب: تام 120 ثم بداية الاسم 100 ثم بداية كلمة 80 ثم احتواء 60', () => {
        const items = [
            { name: 'دجاج طازج' },
            { name: 'دجاج' },
            { name: 'صدور دجاج' },
            { name: 'برجر دجاج مجمد' },
        ];
        expect(search.rankItemMatches(items, 'دجاج').map((i) => i.name))
            .toEqual(['دجاج', 'دجاج طازج', 'صدور دجاج', 'برجر دجاج مجمد']);
    });

    test('كل كلمة شرط، والسقف 30', () => {
        const items = [{ name: 'دجاج كرتون' }, { name: 'دجاج شوال' }];
        expect(search.rankItemMatches(items, 'دجاج كرتون').map((i) => i.name)).toEqual(['دجاج كرتون']);
        expect(search.rankItemMatches(items, 'دجاج لحم')).toEqual([]);
        const many = Array.from({ length: 40 }, (_, i) => ({ name: `صنف ${i}` }));
        expect(search.rankItemMatches(many, 'صنف')).toHaveLength(30);
        expect(search.rankItemMatches(many, '')).toEqual([]);
    });

    test('الاستعلام لا يغيّر حالة الاسم ولا يرمي على رمز غريب', () => {
        expect(search.scoreItemMatch({ name: 'دجاج' }, ['دجاج'])).toBe(120);
        expect(search.scoreItemMatch({ name: 'دجاج' }, ['لحم'])).toBe(0);
        expect(search.rankItemMatches([{ name: 'a(b' }], '(')).toHaveLength(1);
    });
});

describe('البحث الذكي — مفتاح القديم نفسه', () => {
    const store = (value) => ({
        value,
        getItem() { return this.value; },
        setItem(_k, v) { this.value = v; },
    });

    test('المفتاح karim_smart_search_v1 والافتراضي مغلق', () => {
        expect(search.SMART_SEARCH_STORAGE_KEY).toBe('karim_smart_search_v1');
        expect(search.smartSearchEnabled(store(null))).toBe(false);
        expect(search.smartSearchEnabled(store('0'))).toBe(false);
        expect(search.smartSearchEnabled(undefined)).toBe(false);
    });

    test('التشغيل يُخزَّن ويُقرأ، ورفض التخزين لا يعطّل النموذج', () => {
        const s = store(null);
        search.setSmartSearchEnabled(true, s);
        expect(s.value).toBe('1');
        expect(search.smartSearchEnabled(s)).toBe(true);
        search.setSmartSearchEnabled(false, s);
        expect(s.value).toBe('0');
        expect(search.smartSearchEnabled(s)).toBe(false);
        const boom = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };
        expect(() => search.setSmartSearchEnabled(true, boom)).not.toThrow();
        expect(search.smartSearchEnabled(boom)).toBe(false);
    });
});

/* ─── الشاشة والمحرر ────────────────────────────────────────────────────── */

describe('شاشة 08 — البوابة والتركيب', () => {
    test('البوابة: الدور + العلم المستقل، والعلم OFF افتراضيًا', () => {
        expect(screenSrc).toMatch(/import \{ invoiceCreateWriteEnabled \} from '\.\.\/write-flags\.js\?v=/);
        expect(screenSrc).toMatch(/canWrite\(ctx\.role, INVOICE_CREATE_ROLES\) && invoiceCreateWriteEnabled\(\)/);
        expect(read(path.join(V2, 'write-flags.js'))).toContain('INVOICE_CREATE_WRITE_FLAG');
    });

    test('لا شبكة في الشاشة: المخزون والمحرر عبر المستودعات', () => {
        expect(screenSrc).not.toMatch(/\bapiFetch\s*\(/);
        expect(screenSrc).not.toMatch(/\bfetch\s*\(/);
        expect(screenSrc).toMatch(/import \{ fetchInventory \} from '\.\.\/data\/inventory-repo\.js\?v=/);
        expect(screenSrc).toMatch(/import \{ mountPurchaseInvoiceEditor \} from '\.\.\/invoice-editor\.js\?v=/);
    });

    test('زر «فاتورة شراء جديدة» لا يُرسم إلا مع canCreate', () => {
        expect(screenSrc).toMatch(/\$\{canCreate \? `<button[^`]*data-v2-new/);
        expect(screenSrc).toMatch(/data-v2-editor-host/);
        expect(screenSrc).toMatch(/if \(event\.target\.closest\('\[data-v2-new\]'\)\) \{openEditor\(null\); return;\}/);
    });

    test('التعديل يُعرض لصف غير مسدد فقط، وحارس paidAmount > 0', () => {
        expect(screenSrc).toMatch(/canCreate && row\.paid <= 0/);
        expect(screenSrc).toMatch(/data-v2-act="edit"/);
        expect(screenSrc).toMatch(/if \(!invoiceEditable\(raw\)\) \{\s*notify\(EDIT_LOCKED_MESSAGE, 'error'\);/);
        expect(screenSrc).toContain("notify('الفاتورة غير موجودة', 'error')");
    });

    test('النجاح يغلق المحرر ويطلق رسائل القديم حرفيًا ويعيد القراءة', () => {
        expect(screenSrc).toContain("'تم تحديث الفاتورة والمخزون والحسابات'");
        expect(screenSrc).toContain("'تم حفظ الفاتورة'");
        expect(screenSrc).toMatch(/inventoryCache = null;/);
        expect(screenSrc).toMatch(/rawById = new Map\(invoices\.map/);
    });

    test('destroy يغلق المحرر قبل إزالة الشاشة', () => {
        expect(screenSrc).toMatch(/destroy\(\) \{\s*closeEditor\(\);\s*table\.destroy\(\);/);
    });
});

describe('المحرر — أمين على القديم', () => {
    test('الكتابة من مستودع الكتابة وحده، والكتابة في الشاشة ممنوعة', () => {
        expect(editorSrc).toMatch(/from '\.\/data\/purchase-invoices-write-repo\.js\?v=/);
        expect(editorSrc).toMatch(/createPurchaseInvoice, updatePurchaseInvoice/);
        expect(editorSrc).not.toMatch(/\bapiFetch\s*\(/);
        expect(editorSrc).not.toMatch(/\bfetch\s*\(/);
        expect(editorSrc).not.toMatch(/\sonclick=/i);
    });

    test('العنوان والحقول والرسائل كما القديم', () => {
        expect(editorSrc).toContain('فاتورة مشتريات جديدة');
        for (const label of ['رقم الفاتورة', 'تاريخ الفاتورة', 'المورد', 'اسم المورد', 'رقم الهاتف',
            'الأصناف', 'إضافة صنف', 'خصم الفاتورة', 'طريقة الدفع', 'المسدد الآن', 'ملاحظات']) {
            expect(editorSrc).toContain(label);
        }
        for (const msg of ['أضف صنفًا واحدًا على الأقل', 'تحقق من إدخال كمية وسعر صحيحين لكل صنف',
            'أدخل مبلغ سداد صحيحًا أو اتركه فارغًا', 'قيمة الخصم غير صحيحة',
            'الفاتورة مسجلة بالفعل — لم تتكرر', 'تعذر الحفظ: ']) {
            expect(editorSrc).toContain(msg);
        }
        expect(editorSrc).toContain('جارٍ حفظ الفاتورة... انتظر');
    });

    test('المسدد التلقائي وحالة السداد وضريبة المسجل — نفس قواعد القديم', () => {
        expect(editorSrc).toMatch(/paidTouched/);
        expect(editorSrc).toMatch(/field\('paymentMethod'\) === 'credit' \? '0' : est\.grand\.toFixed\(2\)/);
        expect(editorSrc).toContain('مدفوعة');
        expect(editorSrc).toContain('غير مسددة');
        expect(editorSrc).toContain('مسددة جزئياً — متبقٍ');
        expect(editorSrc).toContain('شامل الضريبة تلقائيًا: صافي');
        expect(editorSrc).toContain('المورد مسجل — لا ضريبة على هذه الأصناف (معفاة/صفرية)');
        expect(editorSrc).toContain('اربط لتطبيق الضريبة');
    });

    test('البحث الذكي: مفتاح القديم، ↑↓/Enter/Esc، وملء الوحدة والسعر', () => {
        expect(editorSrc).toMatch(/from '\.\/item-search\.js\?v=/);
        expect(editorSrc).toContain('rankItemMatches');
        expect(editorSrc).toContain("'ArrowDown'");
        expect(editorSrc).toContain("'ArrowUp'");
        expect(editorSrc).toContain("'Enter'");
        expect(editorSrc).toContain("'Escape'");
        expect(editorSrc).toMatch(/row\.unit = item\.unit \? String\(item\.unit\) : 'وحدة'/);
        expect(editorSrc).toMatch(/row\.price = num\(item\.avgCost\)/);
        expect(editorSrc).toContain('أصناف المخزون المطابقة');
        expect(editorSrc).toContain('لا يوجد صنف يطابق');
    });

    test('مدخلات الأصناف كلها موجودة، وحارس النقر المزدوج', () => {
        for (const field of ['name', 'qty', 'unit', 'weight', 'expiryDate', 'price', 'taxCategory']) {
            expect(editorSrc).toContain(`data-vi-item="${field}"`);
        }
        expect(editorSrc).toMatch(/if \(saving\) \{\s*notify\('جارٍ حفظ الفاتورة\.\.\. انتظر', 'info'\);/);
        expect(editorSrc).toMatch(/if \(saveBtn\) \{saveBtn\.disabled = true;\}/);
    });

    test('الصلاحية حقلٌ اختياري على كل سطر: لا وسم إلزام، وعلامته لا تسبق محاولة الحفظ', () => {
        expect(editorSrc).toMatch(/import \{ checkExpiryOnLines, normalizeExpiryDate \} from '\.\/data\/expiry-policy\.js\?v=/);
        expect(editorSrc).toContain('data-vi-expiry="${idx}"');
        expect(editorSrc).toContain('aria-required="false"');
        expect(editorSrc).toContain('تاريخ الصلاحية اختياري');
        expect(editorSrc).toMatch(/let expiryChecked = false;/);
        // العلامة لا تُرسم إلا بعد فشلٍ واحد، وعلى الصيغة الفاسدة فقط.
        expect(editorSrc).toMatch(/const bad = expiryChecked && raw !== '' && !normalizeExpiryDate\(item\.expiryDate\);/);
        expect(editorSrc).toMatch(/else if \(key === 'expiryDate'\) \{row\.expiryDate = node\.value;\}/);
        expect(editorSrc).toContain('paintExpiryMarks();');
    });

    test('بوابة الصلاحية قبل saving = true — رسالة الخادم بلا دورة شبكة', () => {
        const at = editorSrc.indexOf('const expiryGate = checkExpiryOnLines(valid);');
        expect(at).toBeGreaterThan(-1);
        const gate = editorSrc.slice(at, at + 520);
        expect(gate).toMatch(/expiryChecked = true;\s*paintExpiryMarks\(\);\s*notify\(expiryGate\.message, 'error'\);/);
        expect(gate).toMatch(/q\('\[data-vi-expiry\]\.is-missing \[data-vi-item="expiryDate"\]'\)/);
        expect(gate).toMatch(/return;/);
        expect(gate).toMatch(/saving = true;/);                     // البوابة تسبق القفل
        expect(gate.indexOf('return;')).toBeLessThan(gate.indexOf('saving = true;'));
        // بعد نجاح المحاولة تُرفع العلامات حتى لا تبقى صفراء على سطرٍ مكتمل.
        expect(editorSrc).toMatch(/if \(expiryChecked\) \{expiryChecked = false; paintExpiryMarks\(\);\}/);
    });
});

/* ─── CSS المحرر — الصلاحية ضمن الشبكة ──────────────────────────────────── */

describe('تنسيق المحرر — عمود الصلاحية', () => {
    test('السطر صار تسعة مسارات، وعلامة النقص بألوان الخطر من الرموز', () => {
        const row = (cssSrc.match(/\.erp-v2 \.erp-vi-row \{[\s\S]*?\}/) || [''])[0];
        expect(row).toBeTruthy();
        expect((row.match(/minmax\(/g) || []).length).toBe(8);      // + auto للإزالة
        expect(row).toContain('minmax(8.5rem, 1.1fr)');             // عمود التاريخ
        expect(cssSrc).toMatch(/\.erp-vi-expiry \.erp-label|\.erp-vi-expiry input\[type="date"\]/);
        expect(cssSrc).toMatch(/\.erp-vi-expiry\.is-missing \.erp-label \{ color: var\(--erp-danger-text\); \}/);
        expect(cssSrc).toMatch(/\.is-missing input\[type="date"\] \{\s*border-color: var\(--erp-danger\);\s*background: var\(--erp-danger-soft\);/);
        expect(cssSrc).toContain('.erp-vi-expiry-hint');
    });
});

/* ─── الشاشتان والتنسيق والوسم ──────────────────────────────────────────── */

describe('الشاشتان 06/08 — لا ادعاء قديم', () => {
    test('06 لا تدّعي أن الإنشاء باقٍ في القديم — و08 هي شاشة الإنشاء', () => {
        expect(invoicesSrc).toContain('v2invoicecreate');
        // 2026-10-23: الإحالة المكتوبة أُزيلت؛ يُقاس موضع الإنشاء الفعلي:
        // محرر 08 موجود، و06 لا تعِد بشيء في الشاشة القديمة.
        expect(screenSrc).toMatch(/data-v2-editor-host/);
        expect(invoicesSrc).not.toContain('الإنشاء باقٍ في صفحته القديمة');
    });
});

describe('الطبقة والوسم', () => {
    test('الملف مربوط بوسم مراجعة، ولا لون خام', () => {
        const rev = (htmlSrc.match(/js\/v2\/preview\.js\?v=([0-9.]+)/) || [])[1];
        expect(htmlSrc).toContain(`css/v2/erp-invoice-editor.css?v=${rev}`);
        expect(cssSrc).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
        expect(cssSrc).not.toMatch(/rgba?\(/);
        expect(cssSrc).not.toMatch(/\b(?:padding|margin|gap):\s*\d+px/);
    });

    test('حصر الطبقة في .erp-vi ووسائط 640 وطباعة وإخفاء hidden', () => {
        expect(cssSrc).toContain('.erp-v2 .erp-vi [hidden] { display: none !important; }');
        expect(cssSrc).toMatch(/@media \(max-width: 640px\)/);
        expect(cssSrc).toMatch(/@media print[\s\S]*?\.erp-v2 \.erp-vi \{ display: none; \}/);
        expect(cssSrc).not.toMatch(/\.erp-v2-(?:attendance|employees|warehouse|reports|leaves|roster)/);
    });
});
