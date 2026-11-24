/**
 * coa-phase3-mapping.test.js — عقد ربط الوحدات بـ account_mapping (Phase 3)
 * ─────────────────────────────────────────────────────────────────────────
 * القاعدة: الجدول يغيّر الحساب فقط عند وجود صف نشط؛ كل غياب/خطأ = الثابت
 * القديم حرفيًا. لذلك الاختبارات تقارن السطور الناتجة بمنتظر ثابت — ليست
 * اختبارات شكلية، بل إثبات «لا تغيير سلوكي» قبل ضبط الجدول.
 */
const fs = require('fs');
const path = require('path');
const { resolveAccounts } = require('../backend/coa-mapping');
const { buildSalePostingLines } = require('../backend/accounting-routes');
const { buildFallbackVoidLines } = require('../backend/cashier-module/pos-void-lines');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const SALE_DEFAULTS = {
  cash_account: '1000',
  bank_account: '1010',
  revenue_account: '4000',
  vat_output_account: '2100',
  cogs_account: '5000',
  inventory_account: '1200',
};

describe('resolveAccounts — استعلام واحد + fallback صارم', () => {
  test('بلا db (null) يرجع نفس الافتراضيات', async () => {
    await expect(resolveAccounts(null, 'sales_pos', 'pos_sale', SALE_DEFAULTS)).resolves.toEqual(SALE_DEFAULTS);
  });

  test('42P01 (134 غير مطبقة) — صمت كامل والافتراضيات كما هي', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const db = { query: jest.fn().mockRejectedValue(Object.assign(new Error('no table'), { code: '42P01' })) };
    await expect(resolveAccounts(db, 'sales_pos', 'pos_sale', SALE_DEFAULTS)).resolves.toEqual(SALE_DEFAULTS);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  test('صفوف الجدول تتغلب على الافتراضي، والدور غير الممرَّر يُتجاهل', async () => {
    const db = {
      query: jest.fn().mockResolvedValue({
        rows: [
          { role: 'revenue_account', account_code: '4010' },
          { role: 'vat_output_account', account_code: '2105' },
          { role: 'not_requested', account_code: '9999' },
        ],
      }),
    };
    const out = await resolveAccounts(db, 'sales_pos', 'pos_sale', SALE_DEFAULTS);
    expect(out.revenue_account).toBe('4010');
    expect(out.vat_output_account).toBe('2105');
    expect(out).not.toHaveProperty('not_requested');
    expect(out.cash_account).toBe('1000');
    expect(db.query).toHaveBeenCalledTimes(1);
    const params = db.query.mock.calls[0][1];
    expect(params[0]).toBe('sales_pos');
    expect(params[1]).toBe('pos_sale');
    expect(params[2].sort()).toEqual(Object.keys(SALE_DEFAULTS).sort());
  });

  test('خطأ غير متوقع — تحذير واحد والافتراضيات تبقى', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const db = { query: jest.fn().mockRejectedValue(Object.assign(new Error('boom'), { code: '08006' })) };
    await expect(resolveAccounts(db, 'purchases', 'purchase_invoice', { payable_account: '2000' }))
      .resolves.toEqual({ payable_account: '2000' });
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});

describe('buildSalePostingLines — عقد نفس السطور', () => {
  test('بيع نقدي مع باقي: الصندوق يستلم الإجمالي فقط ولا يُسجَّل الباقي', () => {
    const lines = buildSalePostingLines({
      orderId: 1201, total: 115, tax: 15, cogs: 40,
      pays: [{ method: 'cash', amount: 115, direction: 'in' }, { method: 'cash', amount: 10, direction: 'out' }],
      accounts: SALE_DEFAULTS,
    });
    expect(lines).toEqual([
      { account_code: '1000', debit: 115, credit: 0, memo: 'تحصيل نقدي' },
      { account_code: '5000', debit: 40, credit: 0, memo: 'تكلفة مكونات فاتورة #1201' },
      { account_code: '1200', debit: 0, credit: 40, memo: 'تخفيض مخزون فاتورة #1201' },
      { account_code: '4000', debit: 0, credit: 100, memo: 'مبيعات فاتورة #1201' },
      { account_code: '2100', debit: 0, credit: 15, memo: 'ضريبة فاتورة #1201' },
    ]);
  });

  test('بيع مختلط: بطاقة/بنك + نقدي بالباقي', () => {
    const lines = buildSalePostingLines({
      orderId: 7, total: 100, tax: 0, cogs: 0,
      pays: [{ method: 'mada', amount: 60, direction: 'in' }, { method: 'cash', amount: 50, direction: 'in' }],
      accounts: SALE_DEFAULTS,
    });
    expect(lines).toEqual([
      { account_code: '1010', debit: 60, credit: 0, memo: 'تحصيل غير نقدي' },
      { account_code: '1000', debit: 40, credit: 0, memo: 'تحصيل نقدي' },
      { account_code: '4000', debit: 0, credit: 100, memo: 'مبيعات فاتورة #7' },
    ]);
  });

  test('بلا صفوف دفع: نقدي بكامل الإجمالي', () => {
    const lines = buildSalePostingLines({ orderId: 8, total: 23, tax: 3, cogs: 0, pays: [], accounts: SALE_DEFAULTS });
    expect(lines).toEqual([
      { account_code: '1000', debit: 23, credit: 0, memo: 'تحصيل نقدي' },
      { account_code: '4000', debit: 0, credit: 20, memo: 'مبيعات فاتورة #8' },
      { account_code: '2100', debit: 0, credit: 3, memo: 'ضريبة فاتورة #8' },
    ]);
  });

  test('خريطة معدّلة: نفس التوليد بحسابات أخرى (دليل أن الربط فعّال)', () => {
    const lines = buildSalePostingLines({
      orderId: 9, total: 115, tax: 15, cogs: 40,
      pays: [{ method: 'cash', amount: 115, direction: 'in' }],
      accounts: {
        cash_account: '1020', bank_account: '1021', revenue_account: '4030',
        vat_output_account: '2110', cogs_account: '5100', inventory_account: '1250',
      },
    });
    expect(lines.map((l) => l.account_code)).toEqual(['1020', '5100', '1250', '4030', '2110']);
  });

  test('متوازن دائمًا (مدين = دائن) على حالات متعددة', () => {
    for (const c of [
      { total: 115, tax: 15, cogs: 40, pays: [{ method: 'cash', amount: 115, direction: 'in' }] },
      { total: 99.99, tax: 13.04, cogs: 33.33, pays: [{ method: 'mada', amount: 99.99, direction: 'in' }] },
      { total: 1, tax: 0, cogs: 0, pays: [] },
    ]) {
      const lines = buildSalePostingLines({ orderId: 1, accounts: SALE_DEFAULTS, ...c });
      const dr = lines.reduce((s, l) => s + l.debit, 0);
      const cr = lines.reduce((s, l) => s + l.credit, 0);
      expect(Math.abs(dr - cr)).toBeLessThan(0.005);
    }
  });
});

describe('buildFallbackVoidLines — عقد نفس السطور', () => {
  test('الافتراضي يحاكي العكس القديم حرفيًا', () => {
    const lines = buildFallbackVoidLines({
      invoiceCounter: 55, total: 115, tax: 15, cogs: 40,
      payments: [{ method: 'cash', amount: 90, direction: 'in' }, { method: 'mada', amount: 25, direction: 'in' }],
      accounts: SALE_DEFAULTS,
    });
    expect(lines).toEqual([
      { account_code: '4000', debit: 100, credit: 0, memo: 'عكس مبيعات فاتورة #55' },
      { account_code: '2100', debit: 15, credit: 0, memo: 'عكس ضريبة الفاتورة' },
      { account_code: '1200', debit: 40, credit: 0, memo: 'إعادة مخزون فاتورة #55' },
      { account_code: '5000', debit: 0, credit: 40, memo: 'عكس تكلفة فاتورة #55' },
      { account_code: '1010', debit: 0, credit: 25, memo: 'رد تحصيل غير نقدي — إلغاء فاتورة' },
      { account_code: '1000', debit: 0, credit: 90, memo: 'رد تحصيل نقدي — إلغاء فاتورة' },
    ]);
  });

  test('خريطة معدّلة تُستخدم في كل الأدوار الستة', () => {
    const lines = buildFallbackVoidLines({
      invoiceCounter: 1, total: 100, tax: 10, cogs: 20,
      payments: [{ method: 'cash', amount: 100, direction: 'in' }],
      accounts: {
        cash_account: '1020', bank_account: '1021', revenue_account: '4030',
        vat_output_account: '2110', cogs_account: '5100', inventory_account: '1250',
      },
    });
    expect(lines.map((l) => l.account_code)).toEqual(['4030', '2110', '1250', '5100', '1020']);
  });
});

describe('الربط الفعلي في الملفات (Phase 3)', () => {
  test('accounting-routes: بيع/شراء/افتتاحي/رواتب تقرأ من الجدول', () => {
    const src = read('backend/accounting-routes.js');
    expect(src).toMatch(/resolveAccounts\(pool, 'sales_pos', 'pos_sale'/);
    expect(src).toMatch(/resolveAccounts\(pool, 'purchases', 'purchase_invoice'/);
    expect(src).toMatch(/resolveAccounts\(pool, 'purchases', 'purchase_opening'/);
    expect(src).toMatch(/resolveAccounts\(pool, 'payroll', 'payroll_run'/);
    expect(src).not.toMatch(/account_code: '4000', debit: 0, credit: revenue/);
  });

  test('الإلغاء ودفعة المورد يقرآن من الجدول', () => {
    expect(read('backend/cashier-module/pos-orders-history.js')).toMatch(/resolveAccounts\(client, 'sales_pos', 'void'/);
    expect(read('backend/procurement-routes.js')).toMatch(/resolveAccounts\(pool, 'procurement', 'supplier_payment'/);
  });

  test('هجرة 139 تبذر الأدوار الناقصة ولا تحذف شيئًا', () => {
    const up = read('database/migrations/139_coa_mapping_phase3.sql');
    expect(up).toMatch(/ON CONFLICT \(module, operation, role\) DO NOTHING/);
    expect(up).toMatch(/'purchases','purchase_opening','equity_account','3000'/);
    expect(up).not.toMatch(/DELETE/i);
    const down = read('database/migrations/139_coa_mapping_phase3_down.sql');
    expect(down).toMatch(/DELETE FROM account_mapping/);
    expect(down).toMatch(/account_code/);
  });
});
