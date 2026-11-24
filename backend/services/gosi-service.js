'use strict';

const { NotFoundError, ValidationError } = require('../errors/app-error');

const MAX_WAGE_CENTS = 4500000;

// Explicitly the values supplied for this implementation; they are not a
// statement that GOSI has verified or approved these rates for a given employee.
const CONTRIBUTION_RATES_BP = Object.freeze({
  saudi: Object.freeze({ employee: 975, employer: 1175 }),
  expat: Object.freeze({ employee: 0, employer: 200 }),
});

/** @param {any} value @param {any} field */
function toCents(value, field) {
  const text = String(value ?? '');
  if (!/^\d+(?:\.\d{1,2})?$/.test(text)) {
    throw new ValidationError(field, 'must be a non-negative amount with at most two decimals');
  }
  const [whole, fraction = ''] = text.split('.');
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(cents)) {
    throw new ValidationError(field, 'amount exceeds the supported precision');
  }
  return cents;
}

/** @param {any} cents */
function money(cents) {
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`;
}

/** @param {any} employeeId */
function calculateContributions({ employeeId, payrollId = null, name, salary, nationality }) {
  const country = String(nationality ?? '').trim().toUpperCase();
  const category = country === 'SA' ? 'saudi' : country ? 'expat' : null;
  if (!category) {
    throw new ValidationError('nationality', 'must be recorded before calculating GOSI');
  }

  const salaryCents = toCents(salary, 'basicSalary');
  if (salaryCents <= 0) {
    throw new ValidationError('basicSalary', 'must be greater than zero');
  }

  const contributionBaseCents = Math.min(salaryCents, MAX_WAGE_CENTS);
  const rates = CONTRIBUTION_RATES_BP[category];
  const employeeContributionCents = Math.round((contributionBaseCents * rates.employee) / 10000);
  const employerContributionCents = Math.round((contributionBaseCents * rates.employer) / 10000);

  return {
    employeeId: String(employeeId),
    payrollId: payrollId === null ? null : String(payrollId),
    employeeName: name,
    nationality: country,
    insuredCategory: category,
    basicSalary: money(salaryCents),
    assessableWage: money(salaryCents),
    monthlyWageCap: money(MAX_WAGE_CENTS),
    contributionBase: money(contributionBaseCents),
    employeeRateBp: rates.employee,
    employerRateBp: rates.employer,
    employeeContribution: money(employeeContributionCents),
    employerContribution: money(employerContributionCents),
    totalContribution: money(employeeContributionCents + employerContributionCents),
    rateVerification: 'user_supplied_unverified',
    payrollApprovalAllowed: false,
    blockers: [{ code: 'GOSI_RATE_SET_UNVERIFIED' }],
  };
}

class GosiService {
  constructor(pool = require('../shared-pool').pool) {
    this.pool = pool;
  }

  /** @param {any} employeeId */
  async calculateForEmployee(employeeId) {
    if (!/^\d+$/.test(String(employeeId))) {
      throw new ValidationError('employeeId', 'must be a positive integer');
    }

    const { rows } = await this.pool.query(
      `SELECT id, name, salary::text AS basic_salary, nationality, status
         FROM employees
        WHERE id = $1`,
      [String(employeeId)]
    );
    const employee = rows[0];
    if (!employee || employee.status !== 'active') {
      throw new NotFoundError('Active employee', employeeId);
    }

    return calculateContributions({
      employeeId: employee.id,
      name: employee.name,
      salary: employee.basic_salary,
      nationality: employee.nationality,
    });
  }

  /** @param {any} payrollId */
  async calculateForPayroll(payrollId) {
    if (!/^\d+$/.test(String(payrollId))) {
      throw new ValidationError('payrollId', 'must be a positive integer');
    }

    const { rows } = await this.pool.query(
      `SELECT p.id AS payroll_id, p."employeeId" AS employee_id,
              p."basicSalary"::text AS basic_salary, e.name, e.nationality
         FROM payroll p
         JOIN employees e ON e.id = p."employeeId"
        WHERE p.id = $1`,
      [String(payrollId)]
    );
    const payroll = rows[0];
    if (!payroll) {
      throw new NotFoundError('Payroll row', payrollId);
    }

    return calculateContributions({
      employeeId: payroll.employee_id,
      payrollId: payroll.payroll_id,
      name: payroll.name,
      salary: payroll.basic_salary,
      nationality: payroll.nationality,
    });
  }

  /** @param {any} month */
  async calculateForMonth(month) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(month))) {
      throw new ValidationError('month', 'must be a valid YYYY-MM month');
    }

    const [year, monthNumber] = String(month).split('-');
    const { rows } = await this.pool.query(
      `SELECT p.id AS payroll_id, p."employeeId" AS employee_id,
              p."basicSalary"::text AS basic_salary, p.status AS payroll_status,
              e.name, e.nationality
         FROM payroll p
         JOIN employees e ON e.id = p."employeeId"
        WHERE p.year = $1
          AND (p.month = $2 OR p.month = $3)
          AND p.status <> 'cancelled'
        ORDER BY e.name, p.id`,
      [Number(year), String(Number(monthNumber)), String(month)]
    );

    return rows.map(row => {
      const identity = {
        payrollId: String(row.payroll_id),
        employeeId: String(row.employee_id),
        employeeName: row.name,
        payrollStatus: row.payroll_status,
      };
      if (!row.nationality) {
        return {
          ...identity,
          calculation: null,
          payrollApprovalAllowed: false,
          blockers: [{ code: 'GOSI_NATIONALITY_MISSING' }],
        };
      }

      const calculation = calculateContributions({
        employeeId: row.employee_id,
        payrollId: row.payroll_id,
        name: row.name,
        salary: row.basic_salary,
        nationality: row.nationality,
      });
      return {
        ...identity,
        calculation,
        payrollApprovalAllowed: calculation.payrollApprovalAllowed,
        blockers: calculation.blockers,
      };
    });
  }

  /** @param {any} calculation */
  async assertPayrollApprovalReady(calculation) {
    // Hard block: the amounts can be previewed, but payroll cannot be approved
    // until the applied rates have an evidenced, verified GOSI rate-set record.
    if (!calculation?.payrollId) {
      throw new ValidationError('gosiRateSet', 'must be verified and sourced before payroll approval', {
        blocker: 'GOSI_RATE_SET_UNVERIFIED',
      });
    }

    const { rows } = await this.pool.query(
      `SELECT s.id
         FROM payroll p
         JOIN employees e ON e.id = p."employeeId"
         JOIN gosi_rate_sets s
           ON s.verification_status = 'verified'
          AND s.effective_from <= CASE
                WHEN p.month ~ '^\\d{4}-(0[1-9]|1[0-2])$'
                  THEN make_date(p.year, substring(p.month FROM 6 FOR 2)::integer, 1)
                WHEN p.month ~ '^(0[1-9]|1[0-2])$'
                  THEN make_date(p.year, p.month::integer, 1)
                ELSE NULL
              END
          AND (s.effective_to IS NULL OR s.effective_to >= CASE
                WHEN p.month ~ '^\\d{4}-(0[1-9]|1[0-2])$'
                  THEN make_date(p.year, substring(p.month FROM 6 FOR 2)::integer, 1)
                WHEN p.month ~ '^(0[1-9]|1[0-2])$'
                  THEN make_date(p.year, p.month::integer, 1)
                ELSE NULL
              END)
         JOIN gosi_rate_rules r
           ON r.rate_set_id = s.id
          AND r.insured_category = $2
          AND r.employee_rate_bp = $3
          AND r.employer_rate_bp = $4
        WHERE p.id = $1
          AND s.monthly_wage_cap = $5::numeric
        LIMIT 1`,
      [
        calculation.payrollId,
        calculation.insuredCategory,
        calculation.employeeRateBp,
        calculation.employerRateBp,
        calculation.monthlyWageCap,
      ]
    );
    if (!rows[0]) {
      throw new ValidationError('gosiRateSet', 'a sourced, verified rate set matching this calculation is required before payroll approval', {
        blocker: 'GOSI_RATE_SET_UNVERIFIED',
        payrollId: calculation.payrollId,
      });
    }

    calculation.rateSetId = String(rows[0].id);
    calculation.rateVerification = 'verified';
    calculation.payrollApprovalAllowed = true;
    calculation.blockers = [];
    return true;
  }
}

module.exports = {
  GosiService,
  CONTRIBUTION_RATES_BP,
  MAX_WAGE_CENTS,
  calculateContributions,
};
