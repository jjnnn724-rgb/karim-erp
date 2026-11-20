'use strict';

const express = require('express');
const { pool: sharedPool } = require('../shared-pool');
const { jwtAuth, requireRole } = require('../cashier-module/jwt-middleware');
const { GosiService } = require('../services/gosi-service');
const {
  VatValidationService,
  addMoney,
} = require('../services/vat-validation-service');
const { BankReconciliationService } = require('../services/bank-reconciliation-service');
const { riyadhMonth, riyadhToday } = require('../riyadh-date');

const FINANCE_READ_ROLES = ['admin', 'accountant', 'manager', 'auditor'];
const PAYROLL_READ_ROLES = ['admin', 'accountant', 'hr'];
const BANK_WRITE_ROLES = ['admin', 'accountant'];

/**
 * @param {(req:any, res:any, next:any)=>any} handler
 * @returns {(req:any, res:any, next:any)=>any}
 */
function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

/** @param {any} today */
function currentMonthRange(today) {
  return { from: `${today.slice(0, 7)}-01`, to: today };
}

function createComplianceRouter({
  pool = sharedPool,
  gosiService = new GosiService(pool),
  vatValidationService = new VatValidationService(pool),
  bankReconciliationService = new BankReconciliationService(pool),
} = {}) {
  const router = express.Router();

  router.get('/dashboard', jwtAuth, requireRole(...FINANCE_READ_ROLES), asyncRoute(async (_req, res) => {
    const today = riyadhToday();
    const period = currentMonthRange(today);
    const [kpiResult, expiryResult, vatResult] = await Promise.all([
      pool.query(
        `SELECT
           COALESCE((
             SELECT SUM(o.total_amount)
               FROM pos_orders o
              WHERE o.status IN ('issued', 'reported')
                AND (o.created_at AT TIME ZONE 'Asia/Riyadh')::date BETWEEN $1::date AND $2::date
                AND EXISTS (
                  SELECT 1 FROM journal_entries e
                   WHERE e.source_type = 'pos_sale'
                     AND e.source_id = o.id::text
                     AND e.status = 'posted'
                )
           ), 0)::numeric(14,2)::text AS total_sales,
           COALESCE((
             SELECT SUM(o.tax_total)
               FROM pos_orders o
              WHERE o.status IN ('issued', 'reported')
                AND (o.created_at AT TIME ZONE 'Asia/Riyadh')::date BETWEEN $1::date AND $2::date
                AND EXISTS (
                  SELECT 1 FROM journal_entries e
                   WHERE e.source_type = 'pos_sale'
                     AND e.source_id = o.id::text
                     AND e.status = 'posted'
                )
           ), 0)::numeric(14,2)::text AS output_vat,
           COALESCE((
             SELECT SUM(p.vat_total)
               FROM "purchaseInvoices" p
              WHERE LEFT(COALESCE(p.date, ''), 10) BETWEEN $1 AND $2
                AND COALESCE(p."invoiceNumber", '') NOT LIKE 'OPEN-%'
                AND COALESCE(p.notes, '') NOT LIKE 'رصيد افتتاحي%'
                AND EXISTS (
                  SELECT 1 FROM journal_entries e
                   WHERE e.source_type = 'purchase_invoice'
                     AND e.status = 'posted'
                     AND (e.source_id = p.id::text OR e.source_id LIKE p.id::text || ':revision:%')
                )
           ), 0)::numeric(14,2)::text AS input_vat`,
        [period.from, period.to]
      ),
      pool.query(
        `SELECT id::text AS employee_id, name AS employee_name,
                "iqamaExpiry" AS expiry_date
           FROM employees
           WHERE status = 'active'
             AND "iqamaExpiry" ~ '^\\d{4}-\\d{2}-\\d{2}$'
             AND "iqamaExpiry" BETWEEN to_char($1::date, 'YYYY-MM-DD')
                                   AND to_char(($1::date + INTERVAL '30 days')::date, 'YYYY-MM-DD')
          ORDER BY "iqamaExpiry", name
          LIMIT 100`,
        [today]
      ),
      vatValidationService.validatePeriod(period),
    ]);

    const kpis = kpiResult.rows[0];
    const taxAlerts = (vatResult.blockingInvoices || []).map(blocker => ({
      type: 'draft_invoice',
      severity: 'high',
      title: blocker.sourceType === 'tax_classification' || blocker.sourceType === 'general_ledger'
        ? 'مانع في مراجعة ضريبة القيمة المضافة'
        : 'فاتورة تحتاج إلى ترحيل أو مراجعة',
      reference: blocker.invoiceReference || blocker.documentId || blocker.sourceType,
      date: blocker.invoiceDate,
      sourceType: blocker.sourceType,
      blocker: blocker.blocker,
    }));
    const expiryAlerts = expiryResult.rows.map(employee => ({
      type: 'iqama_expiry',
      severity: 'warning',
      employeeId: String(employee.employee_id),
      title: 'إقامة قاربت على الانتهاء',
      employeeName: employee.employee_name,
      expiryDate: employee.expiry_date,
    }));

    res.json({
      period,
      kpis: {
        totalSales: kpis.total_sales,
        outputVat: kpis.output_vat,
        inputVat: kpis.input_vat,
        netPayable: addMoney(kpis.output_vat, `-${kpis.input_vat}`),
      },
      alerts: [...taxAlerts, ...expiryAlerts],
    });
  }));

  router.get('/vat/status', jwtAuth, requireRole(...FINANCE_READ_ROLES), asyncRoute(async (req, res) => {
    const today = riyadhToday();
    const taxPeriodId = req.query.tax_period_id ?? req.query.taxPeriodId;
    let period;

    if (taxPeriodId === undefined && req.query.from === undefined && req.query.to === undefined) {
      const currentReturn = await pool.query(
        `SELECT id
           FROM vat_returns
          WHERE status IN ('draft', 'reviewed')
            AND period_start <= $1::date
            AND period_end >= $1::date
          ORDER BY period_start DESC, return_version DESC
          LIMIT 1`,
        [today]
      );
      if (!currentReturn.rows[0]) {
        return res.status(422).json({
          error: 'VAT_PERIOD_NOT_FOUND',
          message: 'لا توجد مسودة إقرار ضريبي تغطي التاريخ الحالي. أنشئ فترة الإقرار المعتمدة قبل المراجعة.',
          blockingInvoices: [],
        });
      }
      period = { taxPeriodId: String(currentReturn.rows[0].id) };
    } else {
      period = {
        ...(taxPeriodId !== undefined ? { taxPeriodId } : {}),
        ...(req.query.from !== undefined ? { from: String(req.query.from) } : {}),
        ...(req.query.to !== undefined ? { to: String(req.query.to) } : {}),
      };
    }

    const result = /** @type {any} */ (await vatValidationService.validatePeriod(period));
    if (!result.ok) {
      return res.status(result.error.statusCode || 422).json({
        error: result.error.code,
        message: result.error.message,
        blockingInvoices: result.error.blockingInvoices || [],
        ...(result.period ? { period: result.period } : {}),
        ...(result.summary ? { summary: result.summary } : {}),
      });
    }
    return res.json(result);
  }));

  router.get('/payroll/gosi', jwtAuth, requireRole(...PAYROLL_READ_ROLES), asyncRoute(async (_req, res) => {
    const month = riyadhMonth();
    const calculations = await gosiService.calculateForMonth(month);
    const totals = calculations.reduce((sum, item) => {
      if (!item.calculation) {return sum;}
      sum.employeeContribution = addMoney(sum.employeeContribution, item.calculation.employeeContribution);
      sum.employerContribution = addMoney(sum.employerContribution, item.calculation.employerContribution);
      return sum;
    }, { employeeContribution: '0.00', employerContribution: '0.00' });

    res.json({
      month,
      calculations,
      totals: {
        employeeContribution: totals.employeeContribution,
        employerContribution: totals.employerContribution,
        totalContribution: addMoney(totals.employeeContribution, totals.employerContribution),
      },
      payrollApprovalAllowed: calculations.length > 0
        && calculations.every(item => item.payrollApprovalAllowed),
    });
  }));

  router.post('/bank/match', jwtAuth, requireRole(...BANK_WRITE_ROLES), asyncRoute(async (req, res) => {
    const result = await bankReconciliationService.matchTransactions(req.body?.transactions);
    res.json(result);
  }));

  return router;
}

module.exports = { createComplianceRouter };
