'use strict';

const {
  calculateVatMovement,
  classifyVatRate,
  normalizeVatRateRows,
  matchesFilingFrequency,
  buildVatFilingReadiness,
  isValidDateOnly,
} = require('../backend/vat-reporting');

describe('calculateVatMovement', () => {
  const accounts = { payable_account: '2100', recoverable_account: '1150' };

  test('uses posted sales, POS voids and purchase tax while excluding settlement entries', () => {
    const result = calculateVatMovement(
      [
        { account_code: '2100', source_type: 'pos_sale', debit: 0, credit: 30 },
        { account_code: '2100', source_type: 'pos_void', debit: 5, credit: 0 },
        { account_code: '1150', source_type: 'purchase_invoice', debit: 12, credit: 0 },
        { account_code: '1150', source_type: 'purchase_credit_note', debit: 0, credit: 2 },
        { account_code: '2100', source_type: 'vat_settlement', debit: 20, credit: 0 },
        { account_code: '1150', source_type: 'vat_settlement', debit: 0, credit: 20 },
      ],
      accounts
    );

    expect(result).toEqual({
      output_vat: 30,
      output_vat_reversals: 5,
      input_vat: 12,
      input_vat_adjustments: 2,
      net_payable: 15,
      carry_forward_credit: 0,
      unclassified_vat_movements: {
        output_debits: 0,
        output_credits: 0,
        input_debits: 0,
        input_credits: 0,
      },
    });
  });

  test('includes unclassified control-account movements in the net and exposes them', () => {
    const result = calculateVatMovement(
      [
        { account_code: '2100', source_type: 'manual', debit: 4, credit: 2 },
        { account_code: '1150', source_type: 'manual', debit: 3, credit: 1 },
      ],
      accounts
    );

    expect(result.unclassified_vat_movements).toEqual({
      output_debits: 4,
      output_credits: 2,
      input_debits: 3,
      input_credits: 1,
    });
    expect(result.net_payable).toBe(0);
    expect(result.carry_forward_credit).toBe(4);
  });
});

describe('classifyVatRate', () => {
  test('distinguishes standard, unclassified zero, other and invalid rates', () => {
    expect(classifyVatRate(15, 15)).toBe('standard_rate');
    expect(classifyVatRate(5, 5)).toBe('standard_rate');
    expect(classifyVatRate(0, 15)).toBe('zero_rate_unclassified');
    expect(classifyVatRate(10, 15)).toBe('other_rate_review');
    expect(classifyVatRate(null, 15)).toBe('missing_rate');
    expect(classifyVatRate(101, 15)).toBe('invalid_rate');
  });

  test('normalizes rate buckets and money to safe numeric output', () => {
    expect(
      normalizeVatRateRows([
        {
          kind: 'sale',
          rate: '15',
          applicable_standard_rate: '15',
          taxable_base: '100.005',
          vat: '15',
          document_count: '2',
          unposted_document_count: '1',
        },
      ])
    ).toEqual([
      {
        kind: 'sale',
        rate: 15,
        applicable_standard_rate: 15,
        classification: 'standard_rate',
        taxable_base: 100.01,
        vat: 15,
        document_count: 2,
        unposted_document_count: 1,
      },
    ]);
  });
});

describe('buildVatFilingReadiness', () => {
  test('never marks an unsubmitted or legally incomplete return as fileable', () => {
    const readiness = buildVatFilingReadiness({ taxpayer_number_configured: true });

    expect(readiness.can_file).toBe(false);
    expect(readiness.status).toBe('blocked');
    expect(readiness.blockers.map(blocker => blocker.code)).toEqual(
      expect.arrayContaining([
        'return_period_unverified',
        'supply_categories_not_recorded',
        'input_tax_recoverability_unverified',
        'zatca_submission_not_integrated',
      ])
    );
  });

  test('adds a blocker when the selected range does not match the configured frequency', () => {
    const readiness = buildVatFilingReadiness({
      taxpayer_number_configured: true,
      period_matches_frequency: false,
    });

    expect(readiness.blockers.map(blocker => blocker.code)).toContain('return_period_frequency_mismatch');
    expect(readiness.can_file).toBe(false);
  });

  test('adds blockers for source, posting and reconciliation gaps', () => {
    const readiness = buildVatFilingReadiness({
      taxpayer_number_configured: false,
      legacy_revenue_count: 2,
      nonstandard_rate_count: 1,
      unposted_sales: 1,
      unposted_voids: 1,
      unposted_purchases: 1,
      cancelled_without_void_date: 1,
      missing_tax_rate_count: 1,
      missing_supplier_vat_count: 1,
      missing_supplier_tax_status_count: 1,
      missing_tax_rule_count: 1,
      unclassified_ledger_movement: true,
      sales_ledger_difference: 0.02,
      purchase_ledger_difference: 0.02,
    });

    expect(readiness.can_file).toBe(false);
    expect(readiness.blockers.map(blocker => blocker.code)).toEqual(
      expect.arrayContaining([
        'taxpayer_number_missing',
        'taxpayer_registration_unverified',
        'legacy_revenue_unclassified',
        'nonstandard_rates_unclassified',
        'source_documents_unposted',
        'cancelled_invoice_period_unknown',
        'purchase_tax_document_incomplete',
        'unclassified_ledger_movement',
        'subledger_ledger_difference',
      ])
    );
  });
});

describe('matchesFilingFrequency', () => {
  test('matches complete calendar quarters and rejects partial or shifted ranges', () => {
    expect(matchesFilingFrequency('2026-07-01', '2026-09-30', 'quarterly')).toBe(true);
    expect(matchesFilingFrequency('2026-10-01', '2026-12-31', 'quarterly')).toBe(true);
    expect(matchesFilingFrequency('2026-07-01', '2026-09-29', 'quarterly')).toBe(false);
    expect(matchesFilingFrequency('2026-07-02', '2026-09-30', 'quarterly')).toBe(false);
    expect(matchesFilingFrequency('2026-01-01', '2026-03-31', 'monthly')).toBe(false);
  });

  test('matches complete calendar months, including leap February', () => {
    expect(matchesFilingFrequency('2024-02-01', '2024-02-29', 'monthly')).toBe(true);
    expect(matchesFilingFrequency('2023-02-01', '2023-02-28', 'monthly')).toBe(true);
    expect(matchesFilingFrequency('2024-02-01', '2024-02-28', 'monthly')).toBe(false);
  });
});

describe('isValidDateOnly', () => {
  test('accepts real calendar days and rejects normalized or malformed dates', () => {
    expect(isValidDateOnly('2019-01-31')).toBe(true);
    expect(isValidDateOnly('2019-02-29')).toBe(false);
    expect(isValidDateOnly('2019-13-01')).toBe(false);
    expect(isValidDateOnly('2019-1-01')).toBe(false);
  });
});
