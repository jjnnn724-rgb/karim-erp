'use strict';

const {
  GosiService,
  calculateContributions,
} = require('../backend/services/gosi-service');
const {
  VatValidationService,
  addMoney,
  DRAFT_AND_UNPOSTED_SQL,
  VAT_BREAKDOWN_SQL,
} = require('../backend/services/vat-validation-service');
const { BankReconciliationService } = require('../backend/services/bank-reconciliation-service');

describe('GosiService', () => {
  test('calculates Saudi contributions from payroll basic salary and caps the base at SAR 45,000', async () => {
    const pool = {
      query: jest.fn().mockResolvedValue({
        rows: [{
          payroll_id: '10',
          employee_id: '20',
          basic_salary: '50000.00',
          name: 'Employee',
          nationality: 'SA',
        }],
      }),
    };

    const result = await new GosiService(pool).calculateForPayroll('10');

    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('FROM payroll p'), ['10']);
    expect(result).toMatchObject({
      employeeId: '20',
      payrollId: '10',
      insuredCategory: 'saudi',
      basicSalary: '50000.00',
      contributionBase: '45000.00',
      employeeRateBp: 975,
      employerRateBp: 1175,
      employeeContribution: '4387.50',
      employerContribution: '5287.50',
      totalContribution: '9675.00',
      rateVerification: 'user_supplied_unverified',
    });
  });

  test('calculates employer-only expatriate contributions', () => {
    expect(calculateContributions({
      employeeId: 1,
      salary: '10000.25',
      nationality: 'EG',
    })).toMatchObject({
      insuredCategory: 'expat',
      contributionBase: '10000.25',
      employeeContribution: '0.00',
      employerContribution: '200.01',
    });
  });

  test('returns this month’s persisted payroll rows with per-employee hard blockers', async () => {
    const pool = {
      query: jest.fn().mockResolvedValue({
        rows: [
          {
            payroll_id: '10',
            employee_id: '20',
            basic_salary: '10000.00',
            payroll_status: 'posted',
            name: 'Saudi Employee',
            nationality: 'SA',
          },
          {
            payroll_id: '11',
            employee_id: '21',
            basic_salary: '8000.00',
            payroll_status: 'posted',
            name: 'Unclassified Employee',
            nationality: null,
          },
        ],
      }),
    };

    const result = await new GosiService(pool).calculateForMonth('2026-11');

    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('FROM payroll p'),
      [2026, '11', '2026-11']
    );
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      payrollId: '10',
      payrollApprovalAllowed: false,
      calculation: { contributionBase: '10000.00', insuredCategory: 'saudi' },
      blockers: [{ code: 'GOSI_RATE_SET_UNVERIFIED' }],
    });
    expect(result[1]).toMatchObject({
      payrollId: '11',
      calculation: null,
      blockers: [{ code: 'GOSI_NATIONALITY_MISSING' }],
    });
  });

  test('hard-blocks missing nationality or zero salary', () => {
    expect(() => calculateContributions({
      employeeId: 1, salary: '1000.00', nationality: null,
    })).toThrow(expect.objectContaining({ code: 'VALIDATION_ERROR' }));
    expect(() => calculateContributions({
      employeeId: 1, salary: '0.00', nationality: 'SA',
    })).toThrow(expect.objectContaining({ code: 'VALIDATION_ERROR' }));
  });

  test('does not allow payroll approval until a matching verified rate set is recorded', async () => {
    const pool = { query: jest.fn().mockResolvedValue({ rows: [] }) };
    const service = new GosiService(pool);
    const calculation = calculateContributions({
      employeeId: 20,
      payrollId: 10,
      salary: '10000.00',
      nationality: 'SA',
    });

    await expect(service.assertPayrollApprovalReady(calculation))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('gosi_rate_sets'),
      ['10', 'saudi', 975, 1175, '45000.00']
    );
  });
});

describe('VatValidationService', () => {
  test('returns a 422 blocker listing draft/unposted invoices without calculating VAT', async () => {
    const pool = {
      query: jest.fn().mockResolvedValue({
        rows: [{
          source_type: 'pos_order',
          document_id: 'abc',
          invoice_reference: '1001',
          invoice_date: '2026-11-01',
          status: 'draft',
          blocker: 'draft_invoice',
        }],
      }),
    };

    const result = await new VatValidationService(pool).validatePeriod({
      from: '2026-11-01',
      to: '2026-11-30',
    });

    expect(pool.query).toHaveBeenCalledTimes(1);
    expect(pool.query).toHaveBeenCalledWith(DRAFT_AND_UNPOSTED_SQL, ['2026-11-01', '2026-11-30']);
    expect(result).toMatchObject({
      ok: false,
      valid: false,
      error: {
        code: 'VAT_PERIOD_BLOCKED',
        statusCode: 422,
        blockingInvoices: [{ documentId: 'abc', blocker: 'draft_invoice' }],
      },
    });
  });

  test('aggregates standard, zero-rated and exempt activity and reconciles to the GL', async () => {
    const pool = {
      query: jest.fn(async sql => {
        if (sql === DRAFT_AND_UNPOSTED_SQL) {
          return { rows: [] };
        }
        if (sql.includes('FROM vat_returns')) {
          return {
            rows: [{
              id: '5',
              period_start: '2026-11-01',
              period_end: '2026-11-30',
              status: 'draft',
            }],
          };
        }
        if (sql.includes('standard_vat_rate::text')) {
          return { rows: [{ standard_vat_rate: '15.00' }] };
        }
        if (sql === VAT_BREAKDOWN_SQL) {
          return {
            rows: [
              { direction: 'output', tax_category: 'STANDARD', taxable_amount: '100.00', vat_amount: '15.00', invalid_tax_groups: 0 },
              { direction: 'output', tax_category: 'ZERO_RATED', taxable_amount: '25.00', vat_amount: '0.00', invalid_tax_groups: 0 },
              { direction: 'input', tax_category: 'EXEMPT', taxable_amount: '40.00', vat_amount: '0.00', invalid_tax_groups: 0 },
            ],
          };
        }
        if (sql.includes('AS net_vat')) {
          return { rows: [{ net_vat: '15.00' }] };
        }
        throw new Error(`Unexpected SQL in test: ${sql}`);
      }),
    };
    const resolveAccounts = jest.fn().mockResolvedValue({
      payable_account: '2100',
      recoverable_account: '1150',
    });

    const result = await new VatValidationService(pool, resolveAccounts).validatePeriod({
      tax_period_id: '5',
      from: '2026-11-01',
      to: '2026-11-30',
    });

    expect(resolveAccounts).toHaveBeenCalled();
    expect(result).toMatchObject({
      ok: true,
      valid: true,
      summary: {
        standardRate: 15,
        output: {
          STANDARD: { taxableAmount: '100.00', vatAmount: '15.00' },
          ZERO_RATED: { taxableAmount: '25.00', vatAmount: '0.00' },
        },
        input: {
          EXEMPT: { taxableAmount: '40.00', vatAmount: '0.00' },
        },
        outputVat: '15.00',
        inputVat: '0.00',
        netVatPayable: '15.00',
        ledgerNetVat: '15.00',
      },
    });
  });

  test('money addition preserves negative values exactly to cents', () => {
    expect(addMoney('0.00', '-0.50')).toBe('-0.50');
    expect(addMoney('12.10', '-12.60')).toBe('-0.50');
  });
});

describe('BankReconciliationService', () => {
  test('claims an exact amount match within two days in a database transaction', async () => {
    const client = {
      query: jest.fn(async (sql) => {
        if (sql === 'BEGIN' || sql === 'COMMIT') {
          return { rows: [] };
        }
        if (sql.includes('pg_advisory_xact_lock')) {
          return { rows: [] };
        }
        if (sql.includes('FROM bank_statements') && sql.includes('FOR UPDATE')) {
          return {
            rows: [{
              id: '7',
              account_code: '1010',
              stmt_date: '2026-11-10',
              amount: '100.00',
              matched: false,
              matched_entry: null,
            }],
          };
        }
        if (sql.includes('FROM journal_entries e')) {
          return { rows: [{ id: '99' }] };
        }
        if (sql.includes('UPDATE bank_statements')) {
          return { rowCount: 1, rows: [{ id: '7' }] };
        }
        throw new Error(`Unexpected SQL in test: ${sql}`);
      }),
      release: jest.fn(),
    };
    const pool = { connect: jest.fn().mockResolvedValue(client) };

    const result = await new BankReconciliationService(pool).matchTransactions([{ id: '7' }]);

    expect(result).toEqual({
      matched: [{ bankTransactionId: '7', journalEntryId: '99' }],
      unmatched: [],
    });
    expect(client.query.mock.calls.find(([sql]) => sql.includes('FROM journal_entries e'))[0])
      .toContain('$2::date - 2 AND $2::date + 2');
    expect(client.query).toHaveBeenCalledWith('COMMIT');
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  test('does not claim ambiguous matches', async () => {
    const client = {
      query: jest.fn(async sql => {
        if (sql === 'BEGIN' || sql.includes('pg_advisory_xact_lock')) {
          return { rows: [] };
        }
        if (sql.includes('FROM bank_statements') && sql.includes('FOR UPDATE')) {
          return {
            rows: [{
              id: '8',
              account_code: '1010',
              stmt_date: '2026-11-10',
              amount: '50.00',
              matched: false,
              matched_entry: null,
            }],
          };
        }
        if (sql.includes('FROM journal_entries e')) {
          return { rows: [{ id: '91' }, { id: '92' }] };
        }
        if (sql === 'COMMIT') {
          return { rows: [] };
        }
        throw new Error(`Unexpected SQL in test: ${sql}`);
      }),
      release: jest.fn(),
    };
    const pool = { connect: jest.fn().mockResolvedValue(client) };

    const result = await new BankReconciliationService(pool).matchTransactions([{ id: '8' }]);

    expect(result.unmatched).toEqual([{ bankTransactionId: '8', reason: 'ambiguous_candidates' }]);
    expect(client.query.mock.calls.some(([sql]) => sql.includes('UPDATE bank_statements'))).toBe(false);
    expect(client.query).toHaveBeenCalledWith('COMMIT');
  });
});
