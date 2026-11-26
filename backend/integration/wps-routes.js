'use strict';

/**
 * integration/wps-routes.js — مدد (WPS) والتأمينات وقوى (GATE 06)
 * ────────────────────────────────────────────────────────────────────────────
 *   GET  /wps/requirements          مصفوفة متطلبات مدد وحالتها الفعلية
 *   GET  /wps/readiness?month=      جاهزية الشهر لكل موظف + الموانع
 *   PUT  /wps/employees/:id/bank    إدخال IBAN/الجنسية/رقم التأمينات (مدقّق)
 *   POST /wps/export                كشف أجور للمراجعة البشرية + بصمة SHA-256
 *   GET  /gosi/rates                مجموعات نسب التأمينات (غير موثّقة)
 *   GET  /gosi/preview?month&rate_set  حساب عرض فقط — لا قيد ولا تعديل
 *   GET  /qiwa/readiness            جاهزية بيانات المنشأة لمنصة قوى
 *
 * لا نداء خارجي إلى مدد/GOSI/QIWA في أي مسار، ولا رفع تلقائي. مدد BLOCKED
 * بحكم ADR-008 حتى يوجد دليل واجهة رسمي ورد قبول موثّق.
 */

const express = require('express');
const { pool } = require('../shared-pool');
const { logger } = require('../logger');
const { jwtAuth } = require('../cashier-module/jwt-middleware');
const { requireRoleOrPerm } = require('../permissions');
const { generalLimiter, crudLimiter } = require('../rate-limiter');
const {
    MONTH_RE, normalizeIban, isValidSaudIban, maskIban, isValidIdNumber,
    normalizeNationality, nationalityCategory, isValidGosiNumber,
    resolveRateSet, rateSetList,
    WPS_REQUIREMENTS, requirementStatus, buildWpsCsv,
    evaluateWpsReadiness, buildGosiPreview, GOSI_MIN_CONTRIBUTORY_WAGE,
} = require('./wps');

const router = express.Router();

const VIEW_ROLES = ['admin', 'manager'];
const WRITE_ROLES = ['admin'];

const canView = requireRoleOrPerm(VIEW_ROLES, 'compliance.view');
const canConfigure = requireRoleOrPerm(WRITE_ROLES, 'compliance.configure');
const canSubmit = requireRoleOrPerm(WRITE_ROLES, 'compliance.submit');

function fail(res, status, error, message, extra = {}) {
    return res.status(status).json({ error, message, ...extra });
}

function dbFail(res, error, where) {
    if (error && error.code === '42P01') {
        return fail(res, 503, 'INTEGRATION_NOT_READY',
            'جداول التكامل غير مطبَّقة بعد — طبّق هجرة 147 (وحقول مدد) أولًا.');
    }
    logger.error(`[integration/wps/${where}]`, error);
    return fail(res, 500, 'WPS_FAILED', 'تعذر إكمال الطلب.');
}

function actorOf(req) {
    return Number.isInteger(req.user?.id) ? req.user.id : null;
}

function previousMonth() {
    const d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() - 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function monthOf(req) {
    const raw = req.query?.month ?? req.body?.month;
    const month = raw == null || raw === '' ? previousMonth() : String(raw);
    return MONTH_RE.test(month) ? month : null;
}

router.use(jwtAuth);
router.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
});

// ── حقول 147 (قد تكون غير مطبقة في الإنتاج) ────────────────────────────────
let columnsCache = { at: 0, cols: null };

async function employeeColumns() {
    if (columnsCache.cols && Date.now() - columnsCache.at < 60000) {return columnsCache.cols;}
    const { rows } = await pool.query(
        `SELECT column_name FROM information_schema.columns
          WHERE table_name = 'employees' AND column_name IN ('iban', 'nationality', 'gosi_number')`);
    const cols = new Set(rows.map((r) => r.column_name));
    columnsCache = { at: Date.now(), cols };
    return cols;
}

async function loadEmployees() {
    const cols = await employeeColumns();
    const optionalColumns = [
        cols.has('iban') ? 'iban' : 'NULL::text AS iban',
        cols.has('nationality') ? 'nationality' : 'NULL::text AS nationality',
        cols.has('gosi_number') ? 'gosi_number' : 'NULL::text AS gosi_number',
    ];
    const query = [
        'SELECT id, name, salary, "iqamaNumber" AS iqama,',
        `       ${optionalColumns.join(',\n       ')}`,
        '  FROM employees',
        " WHERE status = 'active'",
        ' ORDER BY id',
    ].join('\n');
    const { rows } = await pool.query(query);
    return rows.map((r) => ({ ...r, id: Number(r.id) }));
}

async function loadPayrollLines(month) {
    const year = Number(month.slice(0, 4));
    const { rows } = await pool.query(
        `SELECT "employeeId", "basicSalary" AS basic, allowances, deductions, "netSalary" AS net
           FROM payroll
          WHERE month = $1 AND year = $2`, [month, year]);
    return new Map(rows.map((r) => [String(r.employeeId), r]));
}

async function payrollRunStatus(month) {
    const { rows } = await pool.query(
        'SELECT status FROM payroll_runs WHERE month = $1', [month]);
    return rows[0]?.status ?? null;
}

async function employerIdentifier() {
    const { rows } = await pool.query('SELECT crn, seller_name FROM zatca_settings WHERE id = 1');
    return { crn: rows[0]?.crn ?? null, name: rows[0]?.seller_name ?? null };
}

async function audit(action, { actorId, metadata }) {
    try {
        await pool.query(
            `INSERT INTO integration_events (provider_code, direction, outcome, actor_user_id, metadata)
             VALUES ('mudad', 'internal', 'success', $1, $2::jsonb)`,
            [actorId, JSON.stringify({ action, ...(metadata || {}) })]);
        return true;
    } catch (error) {
        if (error && error.code === '42P01') {
            logger.warn('[integration/wps] audit table missing — event not persisted');
            return false;
        }
        throw error;
    }
}

function countedRequirement(id, patch) {
    return requirementStatus(id, patch);
}

router.get('/wps/requirements', canView, generalLimiter, async (req, res) => {
    try {
        const month = monthOf(req);
        if (!month) {
            return fail(res, 422, 'INVALID_MONTH', 'صيغة الشهر يجب أن تكون YYYY-MM.');
        }
        const [employees, employer, posted] = await Promise.all([
            loadEmployees(), employerIdentifier(), payrollRunStatus(month),
        ]);
        const validId = employees.filter((e) => isValidIdNumber(e.iqama)).length;
        const validIban = employees.filter((e) => isValidSaudIban(e.iban)).length;
        const knownNat = employees.filter((e) => nationalityCategory(e.nationality) !== 'unknown').length;
        const gosiNums = employees.filter((e) => e.gosi_number).length;

        const requirements = WPS_REQUIREMENTS.map((r) => {
            if (r.id === 'employer_identifier') {
                return countedRequirement(r.id, {
                    status: employer.crn ? 'DONE' : 'TODO',
                    detail: employer.crn ? employer.crn : 'غير موجود في إعدادات الهيئة',
                });
            }
            if (r.id === 'employee_id') {
                return countedRequirement(r.id, {
                    status: validId === employees.length && employees.length > 0 ? 'DONE' : 'TODO',
                    detail: `${validId} من ${employees.length}`,
                });
            }
            if (r.id === 'employee_iban') {
                return countedRequirement(r.id, {
                    status: validIban === employees.length && employees.length > 0 ? 'DONE' : 'TODO',
                    detail: `${validIban} من ${employees.length}`,
                });
            }
            if (r.id === 'posted_payroll') {
                return countedRequirement(r.id, {
                    status: posted === 'posted' ? 'DONE' : 'TODO',
                    detail: posted ? `الحالة: ${posted}` : 'لا مسير لهذا الشهر',
                });
            }
            if (r.id === 'nationality') {
                return countedRequirement(r.id, {
                    status: knownNat === employees.length && employees.length > 0 ? 'DONE' : 'TODO',
                    detail: `${knownNat} من ${employees.length}`,
                });
            }
            if (r.id === 'gosi_number') {
                return countedRequirement(r.id, {
                    status: gosiNums === employees.length && employees.length > 0 ? 'DONE' : 'TODO',
                    detail: `${gosiNums} من ${employees.length}`,
                });
            }
            return r;
        });

        res.json({
            month,
            provider: { code: 'mudad', verification: 'BLOCKED', is_enabled: false, direct_integration: false },
            requirements,
            note: 'هذه متطلبات نظامية للملف؛ الحالة تعبّر عن جاهزية بياناتنا فقط وليست قبولًا من مدد.',
            generated_at: new Date().toISOString(),
        });
    } catch (error) {
        return dbFail(res, error, 'requirements');
    }
});

router.get('/wps/readiness', canView, generalLimiter, async (req, res) => {
    const month = monthOf(req);
    if (!month) {
        return fail(res, 422, 'INVALID_MONTH', 'صيغة الشهر يجب أن تكون YYYY-MM.');
    }
    try {
        const [employees, payroll, postedStatus, employer] = await Promise.all([
            loadEmployees(), loadPayrollLines(month), payrollRunStatus(month), employerIdentifier(),
        ]);
        const { summary, rows, blockers, export_ready } = evaluateWpsReadiness({
            employees: employees.map((e) => ({
                id: e.id, name: e.name, iqama: e.iqama, salary: e.salary,
                iban: e.iban, nationality: e.nationality,
            })),
            payrollById: payroll,
            month,
            posted: postedStatus === 'posted',
            employerId: employer.crn,
        });
        res.json({
            month,
            summary,
            blockers,
            export_ready,
            employees: rows,
            truncated: false,
            note: 'عرض جاهزية فقط — لا إرسال ولا رفع إلى مدد.',
            generated_at: new Date().toISOString(),
        });
    } catch (error) {
        return dbFail(res, error, 'readiness');
    }
});

router.put('/wps/employees/:id/bank', canConfigure, crudLimiter, async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
        return fail(res, 422, 'INVALID_ID', 'معرف الموظف غير صحيح.');
    }
    const cols = await employeeColumns().catch(() => null);
    if (!cols) {return fail(res, 503, 'WPS_BANK_COLUMNS_REQUIRED', 'تعذر قراءة حقول الموظفين — طبّق هجرة 147.');}
    if (!cols.has('iban') || !cols.has('nationality') || !cols.has('gosi_number')) {
        return fail(res, 503, 'WPS_BANK_COLUMNS_REQUIRED',
            'حقول IBAN/الجنسية/رقم التأمينات غير مطبَّقة — طبّق هجرة 147 على قاعدة البيانات.');
    }

    const body = req.body ?? {};
    const sets = [];
    const params = [];
    if (body.iban !== undefined) {
        const iban = normalizeIban(body.iban);
        if (!isValidSaudIban(iban)) {
            return fail(res, 422, 'INVALID_IBAN', 'IBAN سعودي غير صحيح — 24 حرفًا يبدأ بـSA ومجموع تحقق صالح.');
        }
        params.push(iban);
        sets.push(`iban = $${params.length}`);
    }
    if (body.nationality !== undefined) {
        const nat = normalizeNationality(body.nationality);
        if (!nat) {
            return fail(res, 422, 'INVALID_NATIONALITY', 'الجنسية رمز ISO من حرفين، مثل SA.');
        }
        params.push(nat);
        sets.push(`nationality = $${params.length}`);
    }
    if (body.gosiNumber !== undefined) {
        const gosi = String(body.gosiNumber ?? '').trim();
        if (gosi !== '' && !isValidGosiNumber(gosi)) {
            return fail(res, 422, 'INVALID_GOSI_NUMBER', 'رقم التأمينات يجب أن يكون من 6 إلى 12 رقمًا.');
        }
        params.push(gosi === '' ? null : gosi);
        sets.push(`gosi_number = $${params.length}`);
    }
    if (!sets.length) {
        return fail(res, 422, 'NOTHING_TO_UPDATE', 'أرسل iban أو nationality أو gosiNumber.');
    }

    try {
        const existing = (await pool.query(
            `SELECT id, name, iban, nationality, gosi_number FROM employees WHERE id = $1`, [id])).rows[0];
        if (!existing) {
            return fail(res, 404, 'EMPLOYEE_NOT_FOUND', 'الموظف غير موجود.');
        }
        params.push(id);
        const idPlaceholder = '$' + params.length;
        const updated = (await pool.query(
            'UPDATE employees SET ' + sets.join(', ') + ' WHERE id = ' + idPlaceholder
            + ' RETURNING id, name, iban, nationality, gosi_number', params)).rows[0];
        const audited = await audit('wps.employee.bank', {
            actorId: actorOf(req),
            metadata: { employee_id: id, fields: sets.map((s) => s.split(' ')[0]) },
        });
        res.json({
            ok: true,
            employee_id: updated.id,
            name: updated.name,
            iban_masked: maskIban(updated.iban),
            nationality: updated.nationality,
            gosi_number_present: Boolean(updated.gosi_number),
            audited,
        });
    } catch (error) {
        return dbFail(res, error, 'employee-bank');
    }
});

router.post('/wps/export', canSubmit, crudLimiter, async (req, res) => {
    const month = monthOf(req);
    if (!month) {
        return fail(res, 422, 'INVALID_MONTH', 'صيغة الشهر يجب أن تكون YYYY-MM.');
    }
    try {
        const [employees, payroll, postedStatus, employer] = await Promise.all([
            loadEmployees(), loadPayrollLines(month), payrollRunStatus(month), employerIdentifier(),
        ]);
        const readiness = evaluateWpsReadiness({
            employees: employees.map((e) => ({
                id: e.id, name: e.name, iqama: e.iqama, salary: e.salary,
                iban: e.iban, nationality: e.nationality,
            })),
            payrollById: payroll,
            month,
            posted: postedStatus === 'posted',
            employerId: employer.crn,
        });
        if (!readiness.export_ready) {
            return fail(res, 409, 'WPS_NOT_READY',
                'لا يمكن توليد الكشف قبل إغلاق المسير واستكمال بيانات الموظفين.', {
                    blockers: readiness.blockers,
                    summary: readiness.summary,
                });
        }
        const lines = employees.map((e) => {
            const line = payroll.get(String(e.id));
            return {
                id_number: String(e.iqama).trim(),
                name: e.name,
                nationality: normalizeNationality(e.nationality),
                iban: normalizeIban(e.iban),
                basic: line.basic,
                allowances: line.allowances,
                deductions: line.deductions,
                net: line.net,
            };
        });
        const { csv, sha256 } = buildWpsCsv({ month, employerId: employer.crn, rows: lines });
        const audited = await audit('wps.export.review_sheet', {
            actorId: actorOf(req),
            metadata: { month, rows: lines.length, sha256 },
        });
        res.json({
            ok: true,
            month,
            rows: lines.length,
            sha256,
            filename: `wps-review-${month}.csv`,
            audited,
            note: 'كشف أجور للمراجعة البشرية — ليس ملف SIF ولم يُرفع إلى مدد.',
            csv,
        });
    } catch (error) {
        return dbFail(res, error, 'export');
    }
});

router.get('/gosi/rates', canView, generalLimiter, (req, res) => {
    res.json({
        rates: rateSetList(),
        verified: false,
        note: 'النسب غير موثّقة داخل النظام وتتطلب تثبيت المحاسب قبل أي استخدام رسمي.',
        minimum_contributory_wage_note: `حد الأجر الأدنى ${GOSI_MIN_CONTRIBUTORY_WAGE} ر.س لا يُطبَّق تلقائيًا في هذا العرض.`,
    });
});

router.get('/gosi/preview', canView, generalLimiter, async (req, res) => {
    const month = monthOf(req);
    if (!month) {
        return fail(res, 422, 'INVALID_MONTH', 'صيغة الشهر يجب أن تكون YYYY-MM.');
    }
    const rateSet = resolveRateSet(req.query.rate_set);
    if (!rateSet) {
        return fail(res, 422, 'RATE_SET_REQUIRED',
            'اختر مجموعة نسب صريحة — لا افتراض تلقائي للنسب.', {
                available: rateSetList().map((r) => r.id),
            });
    }
    try {
        const [employees, payroll, postedStatus] = await Promise.all([
            loadEmployees(), loadPayrollLines(month), payrollRunStatus(month),
        ]);
        const preview = buildGosiPreview({
            employees, payrollById: payroll, rateSet,
        });
        const basis = postedStatus === 'posted' ? 'payroll' : 'employee_salary_estimate';
        res.json({
            month,
            rate_set: { id: rateSet.id, label_ar: rateSet.label_ar, verified: rateSet.verified },
            basis,
            estimate: basis !== 'payroll',
            lines: preview.lines,
            unclassified: preview.unknowns,
            totals: preview.totals,
            warnings: [
                'حساب عرض فقط — لم يُكتب أي قيد ولم تتغير أي معادلة رواتب.',
                'النسب غير موثّقة رسميًا داخل النظام؛ اعتمادها مسؤولية المحاسب.',
                'حدود الأجر الأدنى/الأعلى لا تُطبَّق تلقائيًا.',
            ],
            generated_at: new Date().toISOString(),
        });
    } catch (error) {
        return dbFail(res, error, 'gosi-preview');
    }
});

router.get('/qiwa/readiness', canView, generalLimiter, async (req, res) => {
    try {
        const [employer, employees] = await Promise.all([employerIdentifier(), loadEmployees()]);
        let contracts = null;
        try {
            contracts = (await pool.query('SELECT count(*)::int AS n FROM employee_contracts')).rows[0].n;
        } catch (error) {
            if (!error || error.code !== '42P01') {throw error;}
        }
        const validId = employees.filter((e) => isValidIdNumber(e.iqama)).length;
        const knownNat = employees.filter((e) => nationalityCategory(e.nationality) !== 'unknown').length;
        const checks = [
            { id: 'establishment_crn', label_ar: 'السجل التجاري للمنشأة', ok: Boolean(employer.crn), detail: employer.crn || 'غير موجود' },
            { id: 'establishment_name', label_ar: 'اسم المنشأة', ok: Boolean(employer.name), detail: employer.name || 'غير موجود' },
            { id: 'employee_ids', label_ar: 'هويات الموظفين', ok: employees.length > 0 && validId === employees.length, detail: `${validId} من ${employees.length}` },
            { id: 'nationality', label_ar: 'جنسية الموظفين', ok: employees.length > 0 && knownNat === employees.length, detail: `${knownNat} من ${employees.length}` },
            { id: 'contracts', label_ar: 'عقود العمل المسجّلة', ok: contracts === null ? false : contracts > 0, detail: contracts === null ? 'جدول العقود غير متاح' : `${contracts} عقد` },
        ];
        res.json({
            provider: { code: 'qiwa', verification: 'UNVERIFIED', direct_integration: false },
            checks,
            ready: checks.every((c) => c.ok),
            note: 'جاهزية بيانات محلية فقط — لا ربط API مع قوى.',
            generated_at: new Date().toISOString(),
        });
    } catch (error) {
        return dbFail(res, error, 'qiwa-readiness');
    }
});

// التقرير الشهري الكامل (WPS + GOSI + قوى) — قراءة فقط، لا حفظ ولا إرسال.
router.get('/monthly-report', jwtAuth, canSubmit, async (req, res, next) => {
    const month = monthOf(req);
    if (!month) {
        return fail(res, 422, 'INVALID_MONTH', 'صيغة الشهر يجب أن تكون YYYY-MM.');
    }
    try {
        const { buildReport } = require('../compliance-monthly-worker');
        const report = await buildReport(month);
        return res.json({ ok: true, report });
    } catch (error) {
        logger.error('[integration/wps/monthly-report]', error && error.message);
        return fail(res, 500, 'MONTHLY_REPORT_FAILED', 'تعذر تجميع تقرير الامتثال الشهري.');
    }
});

module.exports = router;
