/**
 * supplier-tax.test.js — Supplier tax profile + VAT engine + smart-search contract
 * ─────────────────────────────────────────────────────────────────────────────
 * Pure-function coverage (no DB): VAT validator, TaxRuleService matrix,
 * invoice math incl. the real supplier invoice (§14), supplier payload rules.
 * Target: ≥ 90% on the tax engine (tax-rule-service.js).
 */

const {
  VAT_15_DIGITS,
  FALLBACK_STANDARD_RATE,
  normalizeVatNumber,
  validateVatNumber,
  getApplicableTaxRate,
  computeLineVat,
  computeInvoiceVat,
  loadStandardRate,
} = require('../backend/tax-rule-service');

const { validateSupplierPayload, TAX_STATUS_VALUES } = require('../backend/procurement-routes');

// ─── 1. VAT validator ────────────────────────────────────────────────────────

describe('validateVatNumber — الرقم الضريبي (15 رقمًا)', () => {
  test('الرقم الحقيقي للمورد يقبل: 302212427200003', () => {
    expect(validateVatNumber('302212427200003')).toEqual({
      ok: true,
      normalized: '302212427200003',
      error: null,
    });
  });

  test.each([
    ['14 رقمًا', '30221242720000'],
    ['16 رقمًا', '3022124272000031'],
    ['حروف', '30221242720000A'],
    ['فارغ', ''],
    ['مسافات فقط', '   '],
    ['null', null],
    ['undefined', undefined],
  ])('يُرفض: %s', (_label, value) => {
    expect(validateVatNumber(value).ok).toBe(false);
  });

  test('تطبيع: مسافات وشرطات تُزال', () => {
    expect(validateVatNumber(' 3022-124272-00003 ').normalized).toBe('302212427200003');
  });

  test('تطبيع: أرقام عربية مشرقية → لاتينية', () => {
    expect(normalizeVatNumber('٣٠٢٢١٢٤٢٧٢٠٠٠٠٣')).toBe('302212427200003');
  });

  test('تطبيع: أرقام فارسية/أردية ممتدة → لاتينية', () => {
    expect(normalizeVatNumber('۳۰۲۲۱۲۴۲۷۲۰۰۰۰۳')).toBe('302212427200003');
  });

  test('تطبيع: رقم number خام يقبل', () => {
    expect(normalizeVatNumber(302212427200003)).toBe('302212427200003');
  });

  test('تطبيع: null/فارغ → null', () => {
    expect(normalizeVatNumber(null)).toBeNull();
    expect(normalizeVatNumber('   ')).toBeNull();
  });

  test('الثابت: 15 خانة رقمية فقط', () => {
    expect(VAT_15_DIGITS.test('302212427200003')).toBe(true);
    expect(VAT_15_DIGITS.test('30221242720000')).toBe(false);
  });

  test('المعدل الاحتياطي = 15 (KSA 2026)', () => {
    expect(FALLBACK_STANDARD_RATE).toBe(15);
  });
});

// ─── 2. TaxRuleService matrix ────────────────────────────────────────────────

describe('getApplicableTaxRate — مصفوفة الحالة × الفئة', () => {
  const tx = { transactionType: 'PURCHASE', transactionDate: '2026-09-27', standardRate: 15 };

  test.each([
    ['REGISTERED', 'STANDARD', 15, 'KSA-PURCHASE-STANDARD-REGISTERED'],
    ['NOT_REGISTERED', 'STANDARD', 0, 'KSA-PURCHASE-SUPPLIER_NOT_REGISTERED'],
    ['EXEMPT', 'STANDARD', 0, 'KSA-PURCHASE-SUPPLIER_EXEMPT'],
    ['REGISTERED', 'ZERO_RATED', 0, 'KSA-PURCHASE-ZERO_RATED'],
    ['REGISTERED', 'EXEMPT', 0, 'KSA-PURCHASE-ITEM_EXEMPT'],
    ['REGISTERED', 'OUT_OF_SCOPE', 0, 'KSA-PURCHASE-OUT_OF_SCOPE'],
    ['NOT_REGISTERED', 'ZERO_RATED', 0, 'KSA-PURCHASE-ZERO_RATED'],
    ['EXEMPT', 'OUT_OF_SCOPE', 0, 'KSA-PURCHASE-OUT_OF_SCOPE'],
  ])('%s × %s → rate %s (%s)', (status, category, rate, ruleCode) => {
    const out = getApplicableTaxRate({
      ...tx,
      supplierTaxProfile: { status, vat_number: '302212427200003', country: 'SA' },
      itemTaxCategory: category,
    });
    expect(out.rate).toBe(rate);
    expect(out.ruleCode).toBe(ruleCode);
    expect(out.legalRef).toMatch(/ZATCA/);
  });

  test('المعدل من الإعداد المركزي (لا hardcode): 15 → مخصص', () => {
    const out = getApplicableTaxRate({
      ...tx,
      standardRate: 5,
      supplierTaxProfile: { status: 'REGISTERED' },
      itemTaxCategory: 'STANDARD',
    });
    expect(out.rate).toBe(5);
  });

  test('معدل غير صالح → fallback آمن', () => {
    const out = getApplicableTaxRate({
      ...tx,
      standardRate: NaN,
      supplierTaxProfile: { status: 'REGISTERED' },
      itemTaxCategory: 'STANDARD',
    });
    expect(out.rate).toBe(15);
  });

  test('بلا ملف مورد → NOT_REGISTERED ضمنيًا (صفر)', () => {
    const out = getApplicableTaxRate({ ...tx, supplierTaxProfile: null, itemTaxCategory: 'STANDARD' });
    expect(out.rate).toBe(0);
    expect(out.ruleCode).toBe('KSA-PURCHASE-SUPPLIER_NOT_REGISTERED');
  });

  test('نوع معاملة غير PURCHASE يُرفض', () => {
    expect(() => getApplicableTaxRate({ ...tx, transactionType: 'SALE' })).toThrow();
  });

  test('حالة/فئة/تاريخ غير صالح يُرفض', () => {
    expect(() => getApplicableTaxRate({ ...tx, supplierTaxProfile: { status: 'X' } })).toThrow();
    expect(() =>
      getApplicableTaxRate({ ...tx, supplierTaxProfile: { status: 'REGISTERED' }, itemTaxCategory: 'X' })
    ).toThrow();
    expect(() =>
      getApplicableTaxRate({ ...tx, transactionDate: 'not-a-date', supplierTaxProfile: { status: 'REGISTERED' } })
    ).toThrow();
  });

  test('حالة صغيرة الأحرف تُقبل (تطبيع)', () => {
    const out = getApplicableTaxRate({
      ...tx,
      supplierTaxProfile: { status: 'registered' },
      itemTaxCategory: 'standard',
    });
    expect(out.rate).toBe(15);
  });
});

// ─── 3. Line + invoice math ──────────────────────────────────────────────────

describe('computeLineVat — ضريبة السطر (تقريب سطري)', () => {
  test('258 × 15% = 38.70', () => {
    expect(computeLineVat(258, 15)).toBe(38.7);
  });

  test('170.15 × 15% = 25.52 (HALF_UP على 25.5225)', () => {
    expect(computeLineVat(170.15, 15)).toBe(25.52);
  });

  test('صفر ضريبة → صفر', () => {
    expect(computeLineVat(1000, 0)).toBe(0);
  });

  test('صافي سالب أو معدل خارج [0,100] يُرفض', () => {
    expect(() => computeLineVat(-5, 15)).toThrow();
    expect(() => computeLineVat(10, 101)).toThrow();
    expect(() => computeLineVat(10, -1)).toThrow();
    expect(() => computeLineVat('abc', 15)).toThrow();
    expect(() => computeLineVat(10, 'abc')).toThrow();
  });
});

describe('computeInvoiceVat — الفاتورة الحقيقية (7 بنود، §14)', () => {
  // البنود كما وردت: net لكل سطر من (qty × rate)
  const LINES = [
    { net: 258 }, // 2 × 129.00
    { net: 2260 }, // 20 × 113.00
    { net: 175 }, // 1 × 175.00
    { net: 170.15 }, // 5 × 34.03
    { net: 228 }, // 4 × 57.00
    { net: 356 }, // 4 × 89.00
    { net: 88 }, // 2 × 44.00
  ];
  const PROFILE = { status: 'REGISTERED', vat_number: '302212427200003', country: 'SA' };

  test('المجاميع المعاد حسابها: صافي 3535.15 + ضريبة 530.27 = شامل 4065.42', () => {
    const out = computeInvoiceVat(LINES, PROFILE, { transactionDate: '2026-09-27', standardRate: 15 });
    expect(out.subtotalNet).toBe(3535.15);
    expect(out.vatTotal).toBe(530.27);
    expect(out.grandTotal).toBe(4065.42);
    expect(out.ruleCode).toBe('KSA-PURCHASE-STANDARD-REGISTERED');
    expect(out.lines).toHaveLength(7);
    expect(out.lines[0]).toEqual({ net: 258, rate: 15, vat: 38.7, ruleCode: 'KSA-PURCHASE-STANDARD-REGISTERED' });
    expect(out.lines[3].vat).toBe(25.52);
  });

  test('ملاحظة تحقق: مطبوعة الفاتورة كتبت «الإجمالي 3535.15» وهو يساوي الصافي المحسوب — المحرك لا يفرض مطابقة المطبوع بل يعيد الحساب من البنود', () => {
    const out = computeInvoiceVat(LINES, PROFILE, { transactionDate: '2026-09-27', standardRate: 15 });
    // المطبوع: Total 3535.15 == subtotalNet (أي المطبوع لم يجمع الضريبة على الإجمالي)
    expect(out.subtotalNet).toBe(3535.15);
    expect(out.grandTotal).not.toBe(3535.15);
  });

  test('مورد غير مسجل → ضريبة صفر والإجمالي = الصافي (لا regression)', () => {
    const out = computeInvoiceVat(LINES, { status: 'NOT_REGISTERED' }, { standardRate: 15 });
    expect(out.vatTotal).toBe(0);
    expect(out.grandTotal).toBe(3535.15);
  });

  test('بنود مختلطة: معفى يُستثنى سطريًا', () => {
    const out = computeInvoiceVat(
      [
        { net: 100, taxCategory: 'STANDARD' },
        { net: 200, taxCategory: 'EXEMPT' },
      ],
      PROFILE,
      { standardRate: 15 }
    );
    expect(out.subtotalNet).toBe(300);
    expect(out.vatTotal).toBe(15);
    expect(out.grandTotal).toBe(315);
  });

  test('فاتورة فارغة تُرفض', () => {
    expect(() => computeInvoiceVat([], PROFILE, {})).toThrow();
  });

  test('اللقطة التاريخية ثابتة: تغيير الملف لاحقًا لا يغيّر ناتجًا محسوبًا', () => {
    const snapshot = computeInvoiceVat(LINES, PROFILE, { standardRate: 15 });
    const frozen = JSON.parse(JSON.stringify(snapshot));
    const later = computeInvoiceVat(LINES, { status: 'NOT_REGISTERED' }, { standardRate: 15 });
    expect(snapshot).toEqual(frozen); // اللقطة القديمة محفوظة كما هي
    expect(later.vatTotal).toBe(0); // الحساب الجديد بقاعدة جديدة
  });
});

describe('loadStandardRate — المعدل المركزي مع fallback', () => {
  test('يقرأ من tax_config', async () => {
    const db = { query: async () => ({ rows: [{ standard_vat_rate: '15.00' }] }) };
    await expect(loadStandardRate(db)).resolves.toBe(15);
  });

  test('جدول مفقود/قيمة فاسدة → 15', async () => {
    const failing = {
      query: async () => {
        throw new Error('no table');
      },
    };
    await expect(loadStandardRate(failing)).resolves.toBe(15);
    const bad = { query: async () => ({ rows: [{ standard_vat_rate: 'zzz' }] }) };
    await expect(loadStandardRate(bad)).resolves.toBe(15);
  });
});

// ─── 4. Supplier payload tax rules ───────────────────────────────────────────

describe('validateSupplierPayload — قواعد الملف الضريبي', () => {
  test('REGISTERED + رقم صالح → ok مع تطبيع', () => {
    const v = validateSupplierPayload({
      name: 'شركة نجم خير الشرق',
      tax_registration_status: 'REGISTERED',
      vat_number: ' 302212427200003 ',
      commercial_register: '754',
    });
    expect(v.ok).toBe(true);
    expect(v.clean.vat_number).toBe('302212427200003');
    expect(v.clean.commercial_register).toBe('754');
    expect(v.clean.tax_registration_status).toBe('REGISTERED');
  });

  test('REGISTERED بلا رقم → مرفوض', () => {
    expect(validateSupplierPayload({ name: 'مورد', tax_registration_status: 'REGISTERED' }).ok).toBe(false);
  });

  test.each([['12345678901234'], ['1234567890123456'], ['ABCDEFGHIJKLMNO']])(
    'REGISTERED برقم فاسد (%s) → مرفوض',
    vat => {
      expect(validateSupplierPayload({ name: 'مورد', tax_registration_status: 'REGISTERED', vat_number: vat }).ok).toBe(
        false
      );
    }
  );

  test('NOT_REGISTERED مع رقم → مرفوض (يجب NULL)', () => {
    const v = validateSupplierPayload({
      name: 'مورد',
      tax_registration_status: 'NOT_REGISTERED',
      vat_number: '302212427200003',
    });
    expect(v.ok).toBe(false);
  });

  test('NOT_REGISTERED بلا رقم → ok و vat_number=null', () => {
    const v = validateSupplierPayload({ name: 'مورد', tax_registration_status: 'NOT_REGISTERED' });
    expect(v.ok).toBe(true);
    expect(v.clean.vat_number).toBeNull();
  });

  test('EXEMPT: فارغ أو صالح → ok (لا افتراضات)', () => {
    expect(validateSupplierPayload({ name: 'مورد', tax_registration_status: 'EXEMPT' }).ok).toBe(true);
    const v = validateSupplierPayload({
      name: 'مورد',
      tax_registration_status: 'EXEMPT',
      vat_number: '302212427200003',
    });
    expect(v.ok).toBe(true);
    expect(v.clean.vat_number).toBe('302212427200003');
  });

  test('حالة غير معروفة → مرفوضة', () => {
    expect(validateSupplierPayload({ name: 'مورد', tax_registration_status: 'MAYBE' }).ok).toBe(false);
  });

  test('إنشاء برقم دون حالة → مرفوض (لا تخمين)', () => {
    expect(validateSupplierPayload({ name: 'مورد', vat_number: '302212427200003' }).ok).toBe(false);
  });

  test('حقول ثنائية اللغة والتواصل', () => {
    const v = validateSupplierPayload({
      name: 'مورد',
      name_en: 'Supplier Co',
      email: 'a@b.co',
      commercial_register: '1010-X',
    });
    expect(v.ok).toBe(true);
    expect(v.clean.name_en).toBe('Supplier Co');
    expect(v.clean.email).toBe('a@b.co');
    expect(v.clean.commercial_register).toBe('1010-X');
    expect(validateSupplierPayload({ name: 'مورد', email: 'not-an-email' }).ok).toBe(false);
  });

  test('التحديث الجزئي لا يفرض الحالة', () => {
    const v = validateSupplierPayload({ phone: '0555' }, { isUpdate: true });
    expect(v.ok).toBe(true);
    expect(v.clean.tax_registration_status).toBeUndefined();
  });

  test('ثوابت الحالات', () => {
    expect([...TAX_STATUS_VALUES].sort()).toEqual(['EXEMPT', 'NOT_REGISTERED', 'REGISTERED']);
  });
});

describe('تغطية الفروع الحدّية', () => {
  const { asciiDigits, round2 } = require('../backend/tax-rule-service');

  test('asciiDigits: undefined/null → سلسلة فارغة', () => {
    expect(asciiDigits(undefined)).toBe('');
    expect(asciiDigits(null)).toBe('');
    expect(asciiDigits(123)).toBe('123');
  });

  test('round2: غير رقمي → 0', () => {
    expect(round2(NaN)).toBe(0);
    expect(round2('abc')).toBe(0);
    expect(round2(10.005)).toBe(10.01);
  });

  test('computeInvoiceVat: غير مصفوفة → مرفوضة', () => {
    const { computeInvoiceVat: civ } = require('../backend/tax-rule-service');
    expect(() => civ(null, { status: 'REGISTERED' })).toThrow();
    expect(() => civ('x', { status: 'REGISTERED' })).toThrow();
  });

  test('getApplicableTaxRate: قيم افتراضية بلا وسائط', () => {
    expect(() => getApplicableTaxRate()).toThrow(); // بلا نوع معاملة
    const out = getApplicableTaxRate({
      transactionType: 'PURCHASE',
      supplierTaxProfile: { status: 'REGISTERED' },
    });
    expect(out.rate).toBe(15); // standardRate/fallback + STANDARD/category/date defaults
  });

  test('loadStandardRate: صف فارغ → 15', async () => {
    const empty = { query: async () => ({ rows: [] }) };
    await expect(loadStandardRate(empty)).resolves.toBe(15);
    const outOfRange = { query: async () => ({ rows: [{ standard_vat_rate: '150' }] }) };
    await expect(loadStandardRate(outOfRange)).resolves.toBe(15);
  });
});
