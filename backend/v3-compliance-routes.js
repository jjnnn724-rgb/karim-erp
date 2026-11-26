'use strict';

/**
 * v3-compliance-routes.js — مسارات الامتثال المالي للواجهة V3 تحت `/api/v3`.
 * ────────────────────────────────────────────────────────────────────────────
 * أربعة مسارات فقط: لوحة القيادة، حالة ضريبة القيمة المضافة، معاينة GOSI،
 * ومطابقة كشف البنك. العقود هي ما تتحقق منه حزمة الواجهة في
 * `v3/apps/web/src/lib/financial-compliance.ts` — المبالغ نصوص بمنزلتين،
 * والتواريخ YYYY-MM-DD بتوقيت الرياض، ولا رقم يُخترع إن غابت بياناته.
 *
 * كل الأرقام من جداول فعلية: pos_orders، journal_entries/lines،
 * account_mapping/tax_config، bank_statements، payroll، employees.
 * لا كتابة إلا في مسار المطابقة، وداخل معاملة واحدة مع قفل استشاري.
 */

const express = require('express');
const { jwtAuth, requireRole } = require('./cashier-module/jwt-middleware');
const { pool } = require('./shared-pool');
const { logger } = require('./logger');
const { riyadhToday, riyadhMonth, riyadhDateOf } = require('./riyadh-date');
const { calculateVatMovement, isValidDateOnly, matchesFilingFrequency } = require('./vat-reporting');
const { resolveAccounts } = require('./coa-mapping');
const { resolveRateSet, gosiAmounts, nationalityCategory } = require('./integration/wps');

const READ_ROLES = ['admin', 'owner', 'manager', 'accountant', 'auditor', 'hr'];
const WRITE_ROLES = ['admin', 'owner', 'manager'];

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_RE = /^\d{4}-\d{2}$/;
const ID_RE = /^\d{1,19}$/;

const router = express.Router();
router.use(jwtAuth);

const money = (value) => {
    const n = Number(value || 0);
    const s = Number.isFinite(n) ? n.toFixed(2) : '0.00';
    return s === '-0.00' ? '0.00' : s;
};

const nullableMoney = (value) => {
    if (value === null || value === undefined || value === '') {return null;}
    const n = Number(value);
    return Number.isFinite(n) ? money(n) : null;
};

const str = (value) => (value === null || value === undefined ? '' : String(value));

const fail = (res, status, error, message, extra = {}) =>
    res.status(status).json({ error, message, ...extra });

const logDbError = (tag, error) => {
    logger.error({ err: { message: (error && error.message) || String(error), stack: (error && error.stack) || null } }, tag);
};

/** الفترة من الاستعلام؛ القيم غير الصالحة تُستبدل بشهر الرياض الحالي لا بأرقام مُختلقة. */
function periodOf(query) {
    const today = riyadhToday();
    const monthStart = `${riyadhMonth()}-01`;
    const rawFrom = String(query.from || '');
    const rawTo = String(query.to || '');
    const from = DAY_RE.test(rawFrom) && isValidDateOnly(rawFrom) ? rawFrom : monthStart;
    const to = DAY_RE.test(rawTo) && isValidDateOnly(rawTo) ? rawTo : today;
    return from <= to ? { from, to } : { from: monthStart, to: today };
}

function monthOf(query) {
    const raw = String(query.month || '').trim();
    return MONTH_RE.test(raw) ? raw : riyadhMonth();
}

function addDays(dateOnly, days) {
    const d = new Date(`${dateOnly}T00:00:00.000Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
}

/** حسابات ضريبة القيمة المضافة من الخريطة المحاسبية (مع ثوابت قديمة كـ fallback). */
async function vatAccounts() {
    return resolveAccounts(pool, 'tax', 'vat_return', {
        payable_account: '2100',
        recoverable_account: '1150',
    });
}

function vatMovement(rows, accounts) {
    const movement = calculateVatMovement(rows, accounts);
    let ledgerNet = 0;
    for (const row of rows) {
        if (row.account_code === accounts.payable_account || row.account_code === accounts.recoverable_account) {
            ledgerNet += Number(row.credit || 0) - Number(row.debit || 0);
        }
    }
    const outputVat = Number(movement.output_vat) || 0;
    const inputVat = Number(movement.input_vat) || 0;
    return {
        outputVat,
        inputVat,
        netVatPayable: Math.round((outputVat - inputVat + Number.EPSILON) * 100) / 100,
        ledgerNetVat: Math.round((ledgerNet + Number.EPSILON) * 100) / 100,
    };
}

async function loadVatLines(from, to, accounts) {
    const codes = [accounts.payable_account, accounts.recoverable_account].filter(Boolean);
    if (!codes.length) {return [];}
    const { rows } = await pool.query(
        `SELECT l.account_code,
                COALESCE(l.debit, 0)::float AS debit,
                COALESCE(l.credit, 0)::float AS credit,
                e.source_type
           FROM journal_lines l
           JOIN journal_entries e ON e.id = l.entry_id AND e.status = 'posted'
          WHERE e.date BETWEEN $1::date AND $2::date
            AND l.account_code = ANY($3::text[])`,
        [from, to, codes]
    );
    return rows;
}

async function taxPeriodIdOf(period) {
    const month = period.from.slice(0, 7);
    const { rows } = await pool.query(
        'SELECT period FROM accounting_periods WHERE period = $1 LIMIT 1', [month]
    );
    return rows[0] ? str(rows[0].period) : null;
}

/** فواتير POS الصادرة بلا قيد مرحّل داخل الفترة (نفس حارس الإغلاق اليومي). */
async function unpostedPosInvoices(period, limit = 100) {
    const { rows } = await pool.query(
        `SELECT o.id::text AS document_id,
                o.status::text AS status,
                o.invoice_counter,
                to_char(o.created_at AT TIME ZONE 'Asia/Riyadh', 'YYYY-MM-DD') AS invoice_date
           FROM pos_orders o
          WHERE NOT EXISTS (
                    SELECT 1 FROM journal_entries je
                     WHERE je.source_type = 'pos_sale' AND je.source_id = o.id::text
                       AND je.status = 'posted'
                       AND je.date BETWEEN $1::date AND $2::date
                )
            AND (o.created_at AT TIME ZONE 'Asia/Riyadh')::date BETWEEN $1::date AND $2::date
          ORDER BY o.created_at DESC LIMIT $3`,
        [period.from, period.to, limit]
    );
    return rows.map((row) => ({
        sourceType: 'pos_order',
        documentId: row.document_id,
        invoiceReference: row.invoice_counter == null ? null : `INV-${row.invoice_counter}`,
        invoiceDate: row.invoice_date || null,
        status: row.status || null,
        blocker: 'draft_invoice',
    }));
}

/** فواتير الشراء بلا قيد مرحّل داخل الفترة. */
async function unpostedPurchaseInvoices(period, limit = 100) {
    const { rows } = await pool.query(
        `SELECT p.id::text AS document_id,
                p."invoiceNumber" AS invoice_reference,
                substring(p.date, 1, 10) AS invoice_date,
                p."paymentStatus" AS payment_status
           FROM "purchaseInvoices" p
          WHERE p.date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}'
            AND p.date::date BETWEEN $1::date AND $2::date
            AND NOT EXISTS (
                    SELECT 1 FROM journal_entries je
                     WHERE je.source_type = 'purchase_invoice' AND je.source_id = p.id::text
                       AND je.status = 'posted'
                )
          ORDER BY p.date DESC LIMIT $3`,
        [period.from, period.to, limit]
    );
    return rows.map((row) => ({
        sourceType: 'purchase_invoice',
        documentId: row.document_id,
        invoiceReference: row.invoice_reference ? str(row.invoice_reference) : null,
        invoiceDate: row.invoice_date || null,
        status: row.payment_status || null,
        blocker: 'unposted_purchase_invoice',
    }));
}

/** إقامات تنتهي خلال 30 يومًا بتوقيت الرياض. */
async function expiringIqamas(limit = 100) {
    const today = riyadhToday();
    const { rows } = await pool.query(
        `SELECT id::text AS employee_id, name, "iqamaExpiry" AS expiry
           FROM employees
          WHERE "iqamaExpiry" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}'
            AND "iqamaExpiry"::date BETWEEN $1::date AND $2::date
          ORDER BY "iqamaExpiry"::date ASC LIMIT $3`,
        [today, addDays(today, 30), limit]
    );
    const soon = addDays(today, 7);
    return rows.map((row) => ({
        type: 'iqama_expiry',
        severity: row.expiry <= soon ? 'high' : 'warning',
        title: 'إقامة موظف تقارب الانتهاء',
        reference: null,
        date: null,
        employeeId: row.employee_id,
        employeeName: str(row.name) || 'غير معروف',
        expiryDate: str(row.expiry).slice(0, 10),
        blocker: 'iqama_expiring',
    }));
}

// ─── 1) لوحة القيادة ──────────────────────────────────────────────────────
router.get('/dashboard', requireRole(...READ_ROLES), async (req, res) => {
    const period = periodOf(req.query);
    try {
        const accounts = await vatAccounts();
        const [salesResult, vatRows, unpostedPos, unpostedPurchases, iqamas] = await Promise.all([
            pool.query(
                `SELECT COALESCE(SUM(o.total_amount), 0)::float AS total
                   FROM pos_orders o
                  WHERE EXISTS (
                        SELECT 1 FROM journal_entries je
                         WHERE je.source_type = 'pos_sale' AND je.source_id = o.id::text
                           AND je.status = 'posted'
                           AND je.date BETWEEN $1::date AND $2::date
                  )`,
                [period.from, period.to]
            ),
            loadVatLines(period.from, period.to, accounts),
            unpostedPosInvoices(period),
            unpostedPurchaseInvoices(period),
            expiringIqamas(),
        ]);

        const vat = vatMovement(vatRows, accounts);
        const alerts = [
            ...unpostedPos.map((row) => ({
                type: 'unposted_invoice',
                severity: 'high',
                title: 'فاتورة مبيعات غير مرحّلة',
                reference: row.invoiceReference || row.documentId,
                date: row.invoiceDate,
                employeeId: null,
                employeeName: null,
                expiryDate: null,
                blocker: row.blocker,
            })),
            ...unpostedPurchases.map((row) => ({
                type: 'unposted_purchase_invoice',
                severity: 'high',
                title: 'فاتورة شراء غير مرحّلة',
                reference: row.invoiceReference || row.documentId,
                date: row.invoiceDate,
                employeeId: null,
                employeeName: null,
                expiryDate: null,
                blocker: row.blocker,
            })),
            ...iqamas,
        ];

        return res.json({
            period,
            kpis: {
                totalSales: money(salesResult.rows[0]?.total),
                outputVat: money(vat.outputVat),
                inputVat: money(vat.inputVat),
                netPayable: money(vat.netVatPayable),
            },
            alerts,
        });
    } catch (error) {
        logDbError('[v3/dashboard]', error);
        return fail(res, 500, 'COMPLIANCE_DASHBOARD_FAILED', 'تعذر تحميل مؤشرات الامتثال من قاعدة البيانات.');
    }
});

// ─── 2) حالة ضريبة القيمة المضافة ─────────────────────────────────────────
router.get('/vat/status', requireRole(...READ_ROLES), async (req, res) => {
    const period = periodOf(req.query);
    try {
        const accounts = await vatAccounts();
        const [vatRows, configResult, unpostedPos, unpostedPurchases] = await Promise.all([
            loadVatLines(period.from, period.to, accounts),
            pool.query('SELECT standard_vat_rate, filing_frequency FROM tax_config LIMIT 1'),
            unpostedPosInvoices(period, 200),
            unpostedPurchaseInvoices(period, 200),
        ]);
        const config = configResult.rows[0] || {};
        const periodOut = {
            taxPeriodId: await taxPeriodIdOf(period),
            from: period.from,
            to: period.to,
        };
        const summary = vatMovement(vatRows, accounts);
        const blockingInvoices = [...unpostedPos, ...unpostedPurchases];

        // قواعد الحظر تُقرأ من الإعدادات لا تُفترض: فترة الإقرار يجب أن تطابق
        // دورية المنشأة، ويجب أن يكون معدل الضريبة المضبوط صالحًا.
        if (config.filing_frequency && !matchesFilingFrequency(period.from, period.to, str(config.filing_frequency))) {
            blockingInvoices.push({
                sourceType: 'tax_config',
                documentId: null,
                invoiceReference: null,
                invoiceDate: null,
                status: str(config.filing_frequency),
                blocker: 'filing_frequency_mismatch',
                count: 1,
            });
        }
        if (!(Number(config.standard_vat_rate) > 0)) {
            blockingInvoices.push({
                sourceType: 'tax_config',
                documentId: null,
                invoiceReference: null,
                invoiceDate: null,
                status: null,
                blocker: 'vat_rate_missing',
                count: 1,
            });
        }

        if (blockingInvoices.length > 0) {
            return res.status(422).json({
                error: 'VAT_PERIOD_BLOCKED',
                message: 'الفترة الضريبية غير جاهزة للاعتماد: مستندات غير مرحّلة أو إعدادات ضريبية غير مطابقة.',
                blockingInvoices: blockingInvoices.slice(0, 200),
                period: periodOut,
            });
        }

        return res.json({
            ok: true,
            valid: true,
            period: periodOut,
            summary: {
                outputVat: money(summary.outputVat),
                inputVat: money(summary.inputVat),
                netVatPayable: money(summary.netVatPayable),
                ledgerNetVat: money(summary.ledgerNetVat),
            },
        });
    } catch (error) {
        logDbError('[v3/vat/status]', error);
        return fail(res, 500, 'VAT_STATUS_FAILED', 'تعذر التحقق من حالة الفترة الضريبية.');
    }
});

// ─── 3) معاينة GOSI لشهر ──────────────────────────────────────────────────
router.get('/payroll/gosi', requireRole(...READ_ROLES), async (req, res) => {
    const month = monthOf(req.query);
    // مجموعة النسب لا تُفترض أبدًا: فقط اختيار صريح عبر rate_set، ومع ذلك
    // تبقى النسب غير موثّقة داخل النظام فلا يُسمح باعتماد الرواتب.
    const rateSet = resolveRateSet(req.query.rate_set);
    const rateVerified = Boolean(rateSet && rateSet.verified === true);
    try {
        const { rows } = await pool.query(
            `SELECT p.id::text AS payroll_id,
                    p."employeeId"::text AS employee_id,
                    p."basicSalary" AS basic_salary,
                    COALESCE(p.status, 'unknown')::text AS payroll_status,
                    e.name AS employee_name,
                    e.nationality
               FROM payroll p
               LEFT JOIN employees e ON e.id = p."employeeId"
              WHERE p.month = $1
              ORDER BY p.id`,
            [month]
        );

        let totalEmployee = 0;
        let totalEmployer = 0;
        const calculations = rows.map((row) => {
            const categoryRaw = nationalityCategory(row.nationality);
            const category = categoryRaw === 'saudi' || categoryRaw === 'expat' ? categoryRaw : null;
            const basic = row.basic_salary;
            const blockers = [];
            if (!rateVerified) {blockers.push({ code: 'GOSI_RATE_SET_UNVERIFIED' });}
            if (!category) {blockers.push({ code: 'EMPLOYEE_NATIONALITY_UNKNOWN' });}
            if (!(Number(basic) > 0)) {blockers.push({ code: 'BASIC_SALARY_MISSING' });}
            if (str(row.payroll_status).toLowerCase() !== 'posted') {blockers.push({ code: 'PAYROLL_NOT_POSTED' });}

            const amounts = rateSet && category && Number(basic) > 0
                ? gosiAmounts(Number(basic), category, rateSet)
                : null;
            const employeeContribution = amounts ? Number(amounts.employee) : 0;
            const employerContribution = amounts ? Number(amounts.employer) : 0;
            totalEmployee += employeeContribution;
            totalEmployer += employerContribution;

            return {
                payrollId: str(row.payroll_id),
                employeeId: str(row.employee_id),
                employeeName: str(row.employee_name) || 'غير معروف',
                payrollStatus: str(row.payroll_status),
                calculation: {
                    employeeId: str(row.employee_id),
                    payrollId: str(row.payroll_id),
                    employeeName: str(row.employee_name) || 'غير معروف',
                    insuredCategory: category,
                    basicSalary: nullableMoney(basic),
                    contributionBase: nullableMoney(basic),
                    employeeContribution: amounts ? money(employeeContribution) : null,
                    employerContribution: amounts ? money(employerContribution) : null,
                    blockers: blockers.map((b) => ({ ...b })),
                },
                payrollApprovalAllowed: rateVerified && blockers.length === 0,
                blockers: blockers.map((b) => ({ ...b })),
            };
        });

        const payrollApprovalAllowed = rateVerified
            && calculations.length > 0
            && calculations.every((entry) => entry.payrollApprovalAllowed);

        return res.json({
            month,
            calculations,
            totals: {
                employeeContribution: money(totalEmployee),
                employerContribution: money(totalEmployer),
                totalContribution: money(totalEmployee + totalEmployer),
            },
            payrollApprovalAllowed,
        });
    } catch (error) {
        logDbError('[v3/payroll/gosi]', error);
        return fail(res, 500, 'GOSI_PREVIEW_FAILED', 'تعذر حساب معاينة التأمينات لهذا الشهر.');
    }
});

// ─── 4) مطابقة حركات كشف البنك (كتابة محمية) ──────────────────────────────
router.post('/bank/match', requireRole(...WRITE_ROLES), async (req, res) => {
    const raw = Array.isArray(req.body?.transactions) ? req.body.transactions.slice(0, 200) : [];
    const ids = [];
    for (const item of raw) {
        const value = item && item.id;
        const id = typeof value === 'number' && Number.isInteger(value) && value > 0
            ? String(value)
            : (typeof value === 'string' && ID_RE.test(value.trim()) ? value.trim() : null);
        if (id && !ids.includes(id)) {ids.push(id);}
    }
    if (!ids.length) {return res.json({ matched: [], unmatched: [] });}

    const matched = [];
    const unmatched = [];
    const client = await pool.connect();
    let committed = false;
    try {
        await client.query('BEGIN');
        // قفل استشاري يمنع تشغيلين متوازيين من مطابقة نفس القيد مرتين.
        await client.query(`SELECT pg_advisory_xact_lock(hashtext('v3-bank-match'))`);

        for (const id of ids) {
            const statementResult = await client.query(
                `SELECT id::text AS id, account_code, stmt_date::text AS stmt_date,
                        COALESCE(amount, 0)::float AS amount, matched,
                        matched_entry::text AS matched_entry
                   FROM bank_statements WHERE id = $1::bigint FOR UPDATE`,
                [id]
            );
            const statement = statementResult.rows[0];
            if (!statement) {
                unmatched.push({ bankTransactionId: id, reason: 'transaction_not_found' });
                continue;
            }
            if (statement.matched) {
                unmatched.push({
                    bankTransactionId: id,
                    reason: 'already_matched',
                    journalEntryId: statement.matched_entry || null,
                });
                continue;
            }

            const account = String(statement.account_code || '1010').slice(0, 20);
            const candidates = (await client.query(
                `SELECT e.id::text AS id
                   FROM journal_entries e
                   JOIN journal_lines l ON l.entry_id = e.id AND l.account_code = $1
                  WHERE e.status = 'posted'
                    AND ABS(e.date - $2::date) <= 3
                    AND ROUND(l.debit - l.credit, 2) = $3::numeric
                    AND NOT EXISTS (
                          SELECT 1 FROM bank_statements b
                           WHERE b.matched_entry = e.id AND b.id <> $4::bigint
                    )
                  ORDER BY e.date, e.id LIMIT 2`,
                [account, statement.stmt_date, Number(statement.amount) || 0, id]
            )).rows;

            if (candidates.length === 0) {
                unmatched.push({ bankTransactionId: id, reason: 'no_candidate_journal_entry' });
                continue;
            }
            if (candidates.length > 1) {
                unmatched.push({ bankTransactionId: id, reason: 'ambiguous_candidates' });
                continue;
            }

            const entryId = str(candidates[0].id);
            const claim = await client.query(
                `UPDATE bank_statements SET matched = TRUE, matched_entry = $1::bigint
                  WHERE id = $2::bigint AND matched = FALSE`,
                [entryId, id]
            );
            if (claim.rowCount > 0) {
                matched.push({ bankTransactionId: id, journalEntryId: entryId });
            } else {
                const current = (await client.query(
                    'SELECT matched_entry::text AS id FROM bank_statements WHERE id = $1::bigint', [id]
                )).rows[0];
                unmatched.push({
                    bankTransactionId: id,
                    reason: 'already_matched',
                    journalEntryId: current?.id || null,
                });
            }
        }

        await client.query('COMMIT');
        committed = true;
        return res.json({ matched, unmatched });
    } catch (error) {
        if (!committed) {await client.query('ROLLBACK').catch(() => {});}
        logDbError('[v3/bank/match]', error);
        return fail(res, 500, 'BANK_MATCH_FAILED', 'تعذر إتمام مطابقة حركات البنك — لم تُحفظ أي مطابقة.');
    } finally {
        client.release();
    }
});

module.exports = { router };
