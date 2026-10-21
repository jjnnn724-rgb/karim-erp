/**
 * v2-expiry-policy.test.js — عقد تاريخ الصلاحية الاختياري في مداخل المخزون
 * ═══════════════════════════════════════════════════════════════════════════
 * سياسة المالك 2026-10-20: تاريخ الصلاحية **اختياري** في الفواتير ومداخل
 * المخزون. يبقى محفوظًا ومُتحقَّقًا منه عند إدخاله، ويُرفض فقط إذا كانت
 * صيغته فاسدة (INVALID_EXPIRY_DATE) — لا يُخترع تاريخ ولا يُمنع الاستلام.
 *
 * القاعدة المُثبَّتة هنا على شقين:
 *   • مدخل بضاعة جديدة بلا تاريخ ⇒ مقبول ويُحفظ null.
 *   • تاريخ حاضر بصيغة فاسدة ⇒ رفض 422 INVALID_EXPIRY_DATE.
 *   • حركة داخلية ⇒ حمل تاريخ الدُفعة المسجل (latestExpiryFor) بلا رفض.
 *
 * الاختبار يعاين وحدة السياسة + أبواب الخادم مصدرياً (لا DOM ولا قاعدة).
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const policy = require('../backend/expiry-policy');
const { normalizeExpiryDate, readExpiryField, checkExpiryOnLines, latestExpiryFor } = policy;
const { validateRow } = require('../backend/cashier-module/excel-import-routes');

const run = (row) => validateRow(row, 1, new Set(), new Set(), new Map(), new Map());
const expiryError = (result) => result.errors.find((e) => e.field === 'expiryDate');

// ─── 1) تطبيع التاريخ ──────────────────────────────────────────────────────────
describe('normalizeExpiryDate', () => {
    test('يقبل ISO المختصر والكامل بالتوقيت وكائن Date', () => {
        expect(normalizeExpiryDate('2026-11-05')).toBe('2026-11-05');
        expect(normalizeExpiryDate('2026-11-05T21:30:00Z')).toBe('2026-11-05');
        expect(normalizeExpiryDate('  2027-01-31  ')).toBe('2027-01-31');
        expect(normalizeExpiryDate(new Date(Date.UTC(2026, 10, 5)))).toBe('2026-11-05');
    });

    test('يرفض الفارغ والمفقود والنص غير التاريخي', () => {
        expect(normalizeExpiryDate(null)).toBeNull();
        expect(normalizeExpiryDate(undefined)).toBeNull();
        expect(normalizeExpiryDate('')).toBeNull();
        expect(normalizeExpiryDate('   ')).toBeNull();
        expect(normalizeExpiryDate('قريباً')).toBeNull();
        expect(normalizeExpiryDate(new Date('فساد'))).toBeNull();
    });

    test('لا يقبل الصيغ المختصرة أو المائلة أو الأرقام العربية', () => {
        expect(normalizeExpiryDate('05/11/2026')).toBeNull();
        expect(normalizeExpiryDate('5-11-2026')).toBeNull();
        expect(normalizeExpiryDate('2026-11-5')).toBeNull();
        expect(normalizeExpiryDate('٢٠٢٦-١١-٠٥')).toBeNull();
    });

    test('يرفض التواريخ غير الموجودة تقويميًا والسنين الخارجة عن المعقول', () => {
        expect(normalizeExpiryDate('2026-02-31')).toBeNull();
        expect(normalizeExpiryDate('2026-13-01')).toBeNull();
        expect(normalizeExpiryDate('2026-00-10')).toBeNull();
        expect(normalizeExpiryDate('1899-12-31')).toBeNull();
        expect(normalizeExpiryDate('2024-02-29')).toBe('2024-02-29');
    });
});

// ─── 2) قراءة الحقل من أي تسمية ────────────────────────────────────────────────
describe('readExpiryField', () => {
    test('يقبل camelCase و snake_case ويتجاوز الفارغ', () => {
        expect(readExpiryField({ expiryDate: '2026-11-05' })).toBe('2026-11-05');
        expect(readExpiryField({ expiry_date: '2026-11-06' })).toBe('2026-11-06');
        expect(readExpiryField({ expiryDate: '', bestBefore: '2026-12-01' })).toBe('2026-12-01');
        expect(readExpiryField({ expiryDate: null, expiry_date: '  ', best_before: '2027-02-01' })).toBe('2027-02-01');
        expect(readExpiryField({})).toBeNull();
        expect(readExpiryField(null)).toBeNull();
    });

    test('احترام ترتيب المفاتيح المخصص (رؤوس الاستيراد العربية)', () => {
        expect(readExpiryField({ 'تاريخ الصلاحية': '2026-11-05' }, ['تاريخ الصلاحية'])).toBe('2026-11-05');
    });
});

// ─── 3) فحص الأسطر برسالة عربية تحمل اسم الصنف ─────────────────────────────────
describe('checkExpiryOnLines', () => {
    test('صفوف سليمة ⇒ ok', () => {
        const r = checkExpiryOnLines([
            { itemName: 'دجاج', expiryDate: '2026-11-05' },
            { itemName: 'أرز', expiry_date: '2027-06-30' },
        ]);
        expect(r).toEqual({ ok: true, missing: [], invalid: [] });
    });

    test('اختياري دائمًا — الناقص مقبول ولا يوجد وضع إلزامي', () => {
        expect(policy.isExpiryRequired).toBeUndefined();
        const r = checkExpiryOnLines([{ itemName: 'دجاج' }, { itemName: 'كبيس', expiryDate: '2026-11-05' }]);
        expect(r.ok).toBe(true);
        expect(r.missing).toEqual([]);
        expect(r.invalid).toEqual([]);
    });

    test('أكثر من خمسة أصناف تالفة ⇒ إحصار الأسماء الخمسة الأولى', () => {
        const r = checkExpiryOnLines(Array.from({ length: 7 }, (_, i) => ({ itemName: `صنف${i + 1}`, expiryDate: 'خطأ' })));
        expect(r.ok).toBe(false);
        expect(r.invalid).toHaveLength(7);
        expect(r.message).toContain('صنف5');
        expect(r.message).not.toContain('صنف6');
    });

    test('تالِف ⇒ INVALID_EXPIRY_DATE وليس ناقص', () => {
        const r = checkExpiryOnLines([{ itemName: 'لحم بقري', expiryDate: '31/12/2026' }]);
        expect(r.ok).toBe(false);
        expect(r.code).toBe('INVALID_EXPIRY_DATE');
        expect(r.invalid).toEqual(['لحم بقري']);
        expect(r.missing).toEqual([]);
        expect(r.message).toContain('YYYY-MM-DD');
    });

    test('ناقص وتالِف معًا: التالف وحده يوقف', () => {
        const r = checkExpiryOnLines([{ name: 'بصل', expiryDate: 'خطأ' }, { name: 'ثوم' }]);
        expect(r.code).toBe('INVALID_EXPIRY_DATE');
        expect(r.missing).toEqual([]);
        expect(r.invalid).toEqual(['بصل']);
    });

    test('nameOf مخصص للاسم في باب مختلف', () => {
        const r = checkExpiryOnLines([{ label: 'زيت', expiryDate: 'خطأ' }], (l) => String(l.label || ''));
        expect(r.message).toContain('زيت');
    });

    test('أسطر فارغة ⇒ ok (الباب يرفض الفاتورة الفارغة بنفسه)', () => {
        expect(checkExpiryOnLines([]).ok).toBe(true);
    });
});

// ─── 4) تاريخ الدُفعة المسجل (للحركات الداخلية) ────────────────────────────────
describe('latestExpiryFor', () => {
    const fakeClient = (rows, spy) => ({
        query: async (sql, params) => { if (spy) {spy.sql = sql; spy.params = params;} return { rows }; },
    });

    test('يُطبّع التاريخ المستخرج من الدفتر', async () => {
        await expect(latestExpiryFor(fakeClient([{ expiry_date: '2026-11-05' }]), 7)).resolves.toBe('2026-11-05');
    });

    test('null عندما لا يوجد سجل صلاحية أو كان المعرف غير رقمي', async () => {
        const spy = {};
        await expect(latestExpiryFor(fakeClient([], spy), 7)).resolves.toBeNull();
        expect(spy.sql).toMatch(/expiry_date IS NOT NULL/);
        expect(spy.sql).toMatch(/ORDER BY id DESC LIMIT 1/);
        expect(spy.params).toEqual([7]);
        await expect(latestExpiryFor(fakeClient([{ expiry_date: 'فساد' }]), 7)).resolves.toBeNull();
        await expect(latestExpiryFor(fakeClient([{}]), 7)).resolves.toBeNull();
        await expect(latestExpiryFor(fakeClient([{ expiry_date: '2026-11-05' }]), 'ليس رقمًا')).resolves.toBeNull();
    });
});

// ─── 5) باب الاستيراد: الصلاحية اختيارية وتُرفض الصيغة الفاسدة فقط ─────────────
describe('validateRow — سياسة الصلاحية في الاستيراد', () => {
    test('كمية > 0 بصلاحية صحيحة ⇒ مقبول والتاريخ في data', () => {
        const r = run({ name: 'دجاج طازج', qty: '50', expiryDate: '2026-11-30' });
        expect(r.isValid).toBe(true);
        expect(r.data.expiryDate).toBe('2026-11-30');
    });

    test('كمية > 0 بلا صلاحية ⇒ مقبول (اختياري) والتاريخ null', () => {
        const r = run({ name: 'دجاج طازج', qty: 50 });
        expect(r.isValid).toBe(true);
        expect(r.data.expiryDate).toBeNull();
        expect(expiryError(r)).toBeUndefined();
    });

    test('صلاحية تالفة ⇒ رفض بصيغة التاريخ لا بالغياب', () => {
        const r = run({ name: 'بصل', qty: '3', expiryDate: '05/11/2026' });
        expect(r.isValid).toBe(false);
        expect(expiryError(r).message).toContain('غير صحيح');
    });

    test('رأس عربي مقبول', () => {
        const r = run({ name: 'لحم', qty: '2', 'تاريخ الصلاحية': '2027-01-31' });
        expect(r.isValid).toBe(true);
        expect(r.data.expiryDate).toBe('2027-01-31');
    });

    test('كمية صفر (تسجيل صنف بلا رصيد) ⇒ لا يُرفض، والصلاحية تُحفظ إن وُجدت', () => {
        expect(run({ name: 'ملح', qty: 0 }).isValid).toBe(true);
        const withExpiry = run({ name: 'ملح', qty: '0', expiryDate: '2030-01-01' });
        expect(withExpiry.isValid).toBe(true);
        expect(withExpiry.data.expiryDate).toBe('2030-01-01');
    });

    test('كمية سالبة تظل مرفوضة كما كان', () => {
        const r = run({ name: 'دجاج', qty: '-5', expiryDate: '2026-11-30' });
        expect(r.isValid).toBe(false);
        expect(r.errors.some((e) => e.field === 'qty')).toBe(true);
    });

    test('قالب التنزيل يبدأ برأس expiryDate', () => {
        expect(read('backend/cashier-module/excel-import-routes.js'))
            .toMatch(/const csv = `name,category,unit,qty,avgCost,minQty,barcode,shelfCode,weight,expiryDate/);
    });
});

// ─── 6) عقود المصادر: كل باب يدخل بضاعة يحرس الصلاحية ──────────────────────────
describe('حرس الخادم على مداخل المخزون', () => {
    const warehouse = read('backend/warehouse-routes.js');
    const server = read('backend/server.js');
    const transfers = read('backend/inventory-transfer-routes.js');
    const registry = read('backend/schema-registry.js');

    test('السياسة مطلوبة في الملفات الحارسة', () => {
        expect(warehouse).toMatch(/require\('\.\/expiry-policy'\)/);
        expect(server).toMatch(/require\('\.\/expiry-policy'\)/);
        expect(transfers).toMatch(/require\('\.\/expiry-policy'\)/);
    });

    test('فاتورة الشراء (إنشاءً وتعديلًا) والجملة: حرس الأسطر ثم 422', () => {
        expect(warehouse.match(/checkExpiryOnLines\(/g)).toHaveLength(3);
        expect(warehouse).toMatch(/const expiryGate = checkExpiryOnLines\(rawItems\.filter\(isInvoiceLine\)\);[\s\S]{0,240}?!expiryGate\.ok[\s\S]{0,160}return fail\(res, 422, expiryGate\.code/);
        expect(warehouse).toMatch(/const expiryGateEdit = checkExpiryOnLines\([\s\S]{0,200}?!expiryGateEdit\.ok[\s\S]{0,180}return fail\(res, 422, expiryGateEdit\.code/);
    });

    test('الإضافة اليدوية: صيغة فاسدة تُرفض، والغياب مقبول', () => {
        expect(warehouse).toMatch(/if \(rawReceiptExpiry && !receiptExpiry\)[\s\S]{0,160}'INVALID_EXPIRY_DATE'/);
        expect(warehouse).not.toMatch(/EXPIRY_DATE_REQUIRED|isExpiryRequired/);
        expect(warehouse).toMatch(/const bulkExpiry = checkExpiryOnLines\([\s\S]{0,240}?!bulkExpiry\.ok[\s\S]{0,140}return fail\(res, 422, bulkExpiry\.code/);
    });

    test('كل قيود purchase_receipt تحمل expiryDate', () => {
        const receipts = warehouse.split('\n').filter((l) => /transactionType:\s*'purchase_receipt'/.test(l));
        expect(receipts.length).toBeGreaterThanOrEqual(4);
        expect((warehouse.match(/expiryDate:/g) || []).length).toBeGreaterThanOrEqual(receipts.length);
        expect(warehouse).toMatch(/expiryDate: receiptExpiry,/);
        expect(warehouse).toMatch(/expiryDate: item\.expiryDate \|\| null,/);
    });

    test('الباب العام: حرس الرصيد الافتتاحي قبل filterBody وفي المسارين', () => {
        expect(server).toMatch(/function checkInventoryOpeningExpiry\(entity, body\)/);
        expect((server.match(/checkInventoryOpeningExpiry\(entity, req\.body\)/g) || [])).toHaveLength(2);
        expect((server.match(/dropExpiryFields\(req\)/g) || []).length).toBeGreaterThanOrEqual(4);
        expect(server).toMatch(/expiryGuardA\.error[\s\S]{0,120}dropExpiryFields\(req\)/);
        expect(server).toMatch(/expiryDate: expiryGuardA\.expiryDate \|\| null,/);
        expect(server).toMatch(/expiryDate: expiryGuardB\.expiryDate \|\| null,/);
    });

    test('المخطط العام لا يعرف حقلاً وهميًا للصلاحية (تُقرأ من الطلب ثم تُحذف)', () => {
        const inventoryBlock = registry.slice(registry.indexOf('    inventory: {'), registry.indexOf('protected: [\'id\'],', registry.indexOf('    inventory: {')));
        expect(inventoryBlock).not.toMatch(/expiry/);
    });

    test('الحركات الداخلية: حمل تاريخ الدُفعة بلا رفض', () => {
        expect(transfers).toMatch(/expiryDate: await latestExpiryFor\(client, item\.inventory_id\)/);
        expect(warehouse).toMatch(/expiryDate: await latestExpiryFor\(client, item\.id\)/);
        expect(warehouse).toMatch(/const carriedExpiry = await latestExpiryFor\(client, inv\.id\);/);
        expect(warehouse).toMatch(/const voidExpiry = await latestExpiryFor\(client, itemId\);/);
        expect(warehouse).toMatch(/expiryDate: normalizeExpiryDate\(readExpiryField\(req\.body \|\| \{\}\)\) \|\| await latestExpiryFor\(client, itemId\),/);
        expect(warehouse).not.toMatch(/INSUFFICIENT_EXPIRY|EXPIRY_DATE_REQUIRED[\s\S]{0,80}transfer_in/);
    });

    test('السياسة موثقة في رأس الوحدة: اختيارية دائمًا بلا مفتاح إلزام', () => {
        const src = read('backend/expiry-policy.js');
        expect(src).toMatch(/اختياري/);
        expect(src).not.toMatch(/EXPIRY_DATE_POLICY=required|isExpiryRequired/);
        expect(src).toMatch(/لا يُخترع تاريخ/);
    });
});
