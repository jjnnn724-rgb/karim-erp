'use strict';

const round2 = value => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round((number + Number.EPSILON) * 100) / 100 : 0;
};

const INPUT_CREDIT_ADJUSTMENT_SOURCES = new Set(['purchase_credit_note', 'purchase_return']);

function calculateVatMovement(rows, accounts) {
  const totals = {
    output_vat: 0,
    output_vat_debits: 0,
    output_vat_reversals: 0,
    input_vat: 0,
    input_vat_credits: 0,
    input_vat_adjustments: 0,
    unclassified_output_debits: 0,
    unclassified_output_credits: 0,
    unclassified_input_debits: 0,
    unclassified_input_credits: 0,
  };

  for (const row of rows) {
    const sourceType = String(row.source_type || '');
    if (sourceType === 'vat_settlement') {
      continue;
    }

    const debit = Number(row.debit) || 0;
    const credit = Number(row.credit) || 0;
    if (row.account_code === accounts.payable_account) {
      totals.output_vat += credit;
      totals.output_vat_debits += debit;
      if (sourceType === 'pos_void') {
        totals.output_vat_reversals += debit;
      } else {
        totals.unclassified_output_debits += debit;
      }
      if (sourceType !== 'pos_sale') {
        totals.unclassified_output_credits += credit;
      }
    }
    if (row.account_code === accounts.recoverable_account) {
      totals.input_vat += debit;
      totals.input_vat_credits += credit;
      if (INPUT_CREDIT_ADJUSTMENT_SOURCES.has(sourceType)) {
        totals.input_vat_adjustments += credit;
      } else {
        totals.unclassified_input_credits += credit;
      }
      if (sourceType !== 'purchase_invoice') {
        totals.unclassified_input_debits += debit;
      }
    }
  }

  const outputVat = round2(totals.output_vat);
  const outputVatReversals = round2(totals.output_vat_reversals);
  const inputVat = round2(totals.input_vat);
  const inputVatAdjustments = round2(totals.input_vat_adjustments);
  const netTax = round2(totals.output_vat - totals.output_vat_debits - totals.input_vat + totals.input_vat_credits);

  return {
    output_vat: outputVat,
    output_vat_reversals: outputVatReversals,
    input_vat: inputVat,
    input_vat_adjustments: inputVatAdjustments,
    net_payable: Math.max(0, netTax),
    carry_forward_credit: Math.max(0, round2(-netTax)),
    unclassified_vat_movements: {
      output_debits: round2(totals.unclassified_output_debits),
      output_credits: round2(totals.unclassified_output_credits),
      input_debits: round2(totals.unclassified_input_debits),
      input_credits: round2(totals.unclassified_input_credits),
    },
  };
}

function classifyVatRate(rate, applicableStandardRate) {
  const numericRate = Number(rate);
  const standardRate = Number(applicableStandardRate);
  if (rate === null || rate === undefined || rate === '' || !Number.isFinite(numericRate)) {
    return 'missing_rate';
  }
  if (numericRate < 0 || numericRate > 100) {
    return 'invalid_rate';
  }
  if (numericRate === 0) {
    return 'zero_rate_unclassified';
  }
  if (Number.isFinite(standardRate) && Math.abs(numericRate - standardRate) < 0.0001) {
    return 'standard_rate';
  }
  return 'other_rate_review';
}

function normalizeVatRateRows(rows) {
  return rows.map(row => ({
    kind: String(row.kind),
    rate: row.rate === null || row.rate === undefined ? null : Number(row.rate),
    applicable_standard_rate: Number(row.applicable_standard_rate),
    classification: classifyVatRate(row.rate, row.applicable_standard_rate),
    taxable_base: round2(row.taxable_base),
    vat: round2(row.vat),
    document_count: Number(row.document_count) || 0,
    unposted_document_count: Number(row.unposted_document_count) || 0,
  }));
}

function matchesFilingFrequency(from, to, frequency) {
  if (!isValidDateOnly(from) || !isValidDateOnly(to) || from > to) {
    return false;
  }
  if (frequency === 'quarterly') {
    const match = /^(\d{4})-(01|04|07|10)-01$/.exec(from);
    if (!match) {
      return false;
    }
    const year = Number(match[1]);
    const firstMonth = Number(match[2]) - 1;
    const quarterEnd = new Date(Date.UTC(year, firstMonth + 3, 0));
    const expectedEnd = [
      String(quarterEnd.getUTCFullYear()),
      String(quarterEnd.getUTCMonth() + 1).padStart(2, '0'),
      String(quarterEnd.getUTCDate()).padStart(2, '0'),
    ].join('-');
    return to === expectedEnd;
  }
  if (frequency === 'monthly') {
    const match = /^(\d{4})-(\d{2})-01$/.exec(from);
    if (!match) {
      return false;
    }
    const monthEnd = new Date(Date.UTC(Number(match[1]), Number(match[2]), 0));
    const expectedEnd = [
      String(monthEnd.getUTCFullYear()),
      String(monthEnd.getUTCMonth() + 1).padStart(2, '0'),
      String(monthEnd.getUTCDate()).padStart(2, '0'),
    ].join('-');
    return to === expectedEnd;
  }
  return false;
}

function buildVatFilingReadiness(metrics = {}) {
  const blockers = [
    {
      code: 'return_period_unverified',
      message: 'طابق تاريخ الفترة المختارة مع فترة الإقرار المعتمدة للمنشأة في بوابة زاتكا قبل الاعتماد.',
    },
    {
      code: 'prior_return_balance_unverified',
      message:
        'أرصدة الضريبة الافتتاحية في الأستاذ لا تثبت تلقائيًا الرصيد الدائن المرحّل من الإقرار السابق أو المبالغ المسددة؛ لا يوجد سجل إقرارات وسداد مربوط بالمطابقة.',
    },
    {
      code: 'supply_categories_not_recorded',
      message:
        'النظام لا يحفظ تصنيف التوريد القانوني للصادرات والتوريدات الصفرية والمعفاة وخارج النطاق والاحتساب العكسي؛ لا يمكن استنتاجها من معدل 0% وحده.',
    },
    {
      code: 'input_tax_recoverability_unverified',
      message:
        'قابلية خصم ضريبة المدخلات لا تثبتها الفاتورة أو القيد وحدهما؛ يلزم التحقق من المستند والغرض التجاري والقيود النظامية.',
    },
    {
      code: 'zatca_submission_not_integrated',
      message: 'لا يوجد إرسال أو تحقق قبول للإقرار من زاتكا داخل النظام؛ يلزم تقديمه والتحقق منه عبر بوابة الهيئة.',
    },
  ];

  if (!metrics.period_matches_frequency) {
    blockers.push({
      code: 'return_period_frequency_mismatch',
      message: 'الفترة المختارة لا تطابق حدود الإقرار الدورية المضبوطة للمنشأة.',
    });
  }
  if (!metrics.taxpayer_number_configured) {
    blockers.push({
      code: 'taxpayer_number_missing',
      message: 'رقم تسجيل المكلف غير مضبوط أو ما زال رقمًا تجريبيًا.',
    });
  }
  blockers.push({
    code: 'taxpayer_registration_unverified',
    message:
      'النظام لا يتحقق مباشرة من صلاحية التسجيل الضريبي لدى زاتكا؛ صحة تنسيق الرقم المخزن لا تثبت أنه حقيقي أو نشط.',
  });
  if (metrics.legacy_revenue_count > 0) {
    blockers.push({
      code: 'legacy_revenue_unclassified',
      message: `يوجد ${metrics.legacy_revenue_count} سجل إيراد غير مرتبط بفاتورة POS حديثة؛ لا يدخل في ضريبة المخرجات قبل مطابقة مستنده وتصنيفه.`,
    });
  }
  if (metrics.nonstandard_rate_count > 0) {
    blockers.push({
      code: 'nonstandard_rates_unclassified',
      message: `توجد ${metrics.nonstandard_rate_count} مجموعة مبيعات/مشتريات بمعدل غير قياسي أو مفقود؛ لا يمكن إسنادها إلى خانة إقرار نظامية تلقائيًا.`,
    });
  }
  if (metrics.unposted_sales > 0 || metrics.unposted_voids > 0 || metrics.unposted_purchases > 0) {
    blockers.push({
      code: 'source_documents_unposted',
      message: `مستندات غير مرتبطة بقيود مرحّلة: مبيعات ${metrics.unposted_sales || 0}، إلغاءات ${metrics.unposted_voids || 0}، مشتريات ${metrics.unposted_purchases || 0}.`,
    });
  }
  if (metrics.cancelled_without_void_date > 0) {
    blockers.push({
      code: 'cancelled_invoice_period_unknown',
      message: `توجد ${metrics.cancelled_without_void_date} فاتورة ملغاة بلا تاريخ عكس؛ لا يمكن تحديد فترة معالجة أثرها الضريبي.`,
    });
  }
  if (
    metrics.missing_tax_rate_count > 0 ||
    metrics.missing_supplier_vat_count > 0 ||
    metrics.missing_supplier_tax_status_count > 0 ||
    metrics.missing_tax_rule_count > 0
  ) {
    blockers.push({
      code: 'purchase_tax_document_incomplete',
      message: `بيانات فواتير الشراء ناقصة: معدل ضريبة ${metrics.missing_tax_rate_count || 0}، رقم ضريبي للمورد المسجل ${metrics.missing_supplier_vat_count || 0}، حالة تسجيل المورد ${metrics.missing_supplier_tax_status_count || 0}، مرجع القاعدة الضريبية ${metrics.missing_tax_rule_count || 0}.`,
    });
  }
  if (metrics.unclassified_ledger_movement) {
    blockers.push({
      code: 'unclassified_ledger_movement',
      message:
        'توجد حركات غير مصنّفة على حسابات الضريبة؛ تدخل في صافي حركة الأستاذ ولا يمكن نسبتها إلى خانة إقرار دون مستند.',
    });
  }
  if (metrics.sales_ledger_difference > 0.01 || metrics.purchase_ledger_difference > 0.01) {
    blockers.push({
      code: 'subledger_ledger_difference',
      message: 'لم تتطابق قيمة ضريبة مستندات المبيعات أو المشتريات مع حركة الأستاذ المرحّلة ضمن هللة واحدة.',
    });
  }

  return { status: 'blocked', can_file: false, blockers };
}

function isValidDateOnly(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value))) {
    return false;
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

module.exports = {
  calculateVatMovement,
  classifyVatRate,
  normalizeVatRateRows,
  matchesFilingFrequency,
  buildVatFilingReadiness,
  isValidDateOnly,
};
