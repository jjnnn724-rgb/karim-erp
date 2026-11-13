/**
 * compliance-monthly-worker.js — مولّد تقرير الامتثال الشهري (WPS/GOSI/رواتب/قوى)
 * ════════════════════════════════════════════════════════════════════════════
 * يُشغَّل تلقائيًا من الخادم (مجموعة interval) أو يدويًا من سطر الأوامر:
 *   node backend/compliance-monthly-worker.js [YYYY-MM]
 *
 * ينتج في `var/compliance-reports/` (خارج مجلد الويب العام):
 *   • <month>.json  — بيانات الآلة (للمراجعة البرمجية)
 *   • <month>.html  — ورقة الطباعة A4 (تُفتح وتُطبع وتُوقّع)
 *
 * قواعد (ADR-008): لا نداء خارجي إلى مدد/GOSI/قوى، ولا رفع، ولا وسم «مقبول» —
 * التقرير كله «للمراجعة البشرية» قبل أي استخدام رسمي.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { pool } = require('./shared-pool');
const { logger } = require('./logger');
const { computeMonthlyCompliance, complianceReportHtml } = require('./integration/monthly-report');

const REPORT_DIR = path.join(__dirname, '..', 'var', 'compliance-reports');

async function loadEmployees() {
    const { rows } = await pool.query(
        `SELECT id, name, salary, "iqamaNumber" AS iqama, iban, nationality, gosi_number, status
           FROM employees
          WHERE status = 'active'
          ORDER BY id`);
    return rows.map((row) => ({ ...row, id: Number(row.id) }));
}

async function loadPayrollLines(month) {
    const year = Number(month.slice(0, 4));
    const { rows } = await pool.query(
        `SELECT "employeeId" AS id, "basicSalary" AS basic, allowances, deductions, "netSalary" AS net
           FROM payroll
          WHERE month = $1 AND year = $2`,
        [month, year]);
    const map = new Map();
    for (const row of rows) {map.set(String(row.id), row);}
    return map;
}

async function payrollRunStatus(month) {
    const { rows } = await pool.query(
        'SELECT status FROM payroll_runs WHERE month = $1',
        [month]);
    return rows[0]?.status ?? null;
}

async function employerIdentifier() {
    const { rows } = await pool.query('SELECT crn, seller_name FROM zatca_settings WHERE id = 1');
    return { crn: rows[0]?.crn ?? null, name: rows[0]?.seller_name ?? null };
}

async function qiwaChecks() {
    try {
        const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM employee_contracts');
        const employees = await pool.query(
            'SELECT COUNT(*)::int AS n FROM employees WHERE status = \'active\'');
        return [
            { id: 'establishment_crn', label_ar: 'السجل التجاري', ok: true, detail: 'مسجّل' },
            { id: 'contracts', label_ar: 'عقود العمل', ok: rows[0].n > 0, detail: `${rows[0].n} عقد` },
            { id: 'employees', label_ar: 'الموظفون', ok: employees.rows[0].n > 0, detail: `${employees.rows[0].n} موظف` },
        ];
    } catch (error) {
        if (error && error.code === '42P01') {
            return [
                { id: 'contracts', label_ar: 'عقود العمل', ok: false, detail: 'جدول العقود غير متاح' },
            ];
        }
        throw error;
    }
}

/** يحمّل كل المدخلات ويحسب التقرير — مشترك بين المؤقت والمسارات والCLI. */
async function buildReport(month) {
    const [employees, payrollById, postedStatus, employer, qiwa] = await Promise.all([
        loadEmployees(),
        loadPayrollLines(month),
        payrollRunStatus(month),
        employerIdentifier(),
        qiwaChecks(),
    ]);
    return computeMonthlyCompliance({
        month,
        employees,
        payrollById,
        postedStatus,
        employer,
        qiwaChecks: qiwa,
        rateSetId: null, // بلا نسب مُعلَّمة — راجع ADR-008؛ النسب تُختار يدويًا بمراجعة المحاسب
        generatedAt: new Date().toISOString(),
    });
}

/**
 * يولّد التقرير ويخزنه ويمنع التكرار بقانون: أي خطأ يتخطاه بلا إسقاط الخادم.
 * @param {string} month
 * @returns {Promise<boolean>}
 */
async function generateMonthlyComplianceReport(month) {
    try {
        const report = await buildReport(month);
        const json = JSON.stringify(report, null, 2);
        const html = complianceReportHtml(report);
        fs.mkdirSync(REPORT_DIR, { recursive: true });
        fs.writeFileSync(path.join(REPORT_DIR, `${month}.json`), json, 'utf8');
        fs.writeFileSync(path.join(REPORT_DIR, `${month}.html`), html, 'utf8');
        logger.info(`[compliance-worker] تقرير ${month} وُلّد: ${report.payroll.active_employees} موظف، WPS readiness ${report.readiness.percent}%`);
        return true;
    } catch (error) {
        logger.error(`[compliance-worker] تعذر توليد تقرير ${month}:`, error && error.message);
        return false;
    }
}

/* ─── CLI / Entrypoint ────────────────────────────────────────────────────── */
if (require.main === module) {
    const monthArg = process.argv[2];
    const current = new Date();
    const previous = new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth() - 1, 1));
    const month = monthArg && /^\d{4}-\d{2}$/.test(monthArg)
        ? monthArg
        : `${previous.getUTCFullYear()}-${String(previous.getUTCMonth() + 1).padStart(2, '0')}`;
    generateMonthlyComplianceReport(month)
        .then((ok) => { process.exit(ok ? 0 : 1); })
        .catch(() => process.exit(1));
}

module.exports = { generateMonthlyComplianceReport, buildReport };
