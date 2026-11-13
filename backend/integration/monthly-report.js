/**
 * حساب تقرير الامتثال الشهري — WPS + GOSI + قوى + الرواتب
 * ────────────────────────────────────────────────────────────────────────────
 * `computeMonthlyCompliance` دالة نقية: كل المدخلات تمرّر من كائن، والنتيجة
 * لا تُكتب ولا تُرسل ولا تُرغّل أي شيء — جاهزة للمراجعة فقط.
 *
 * قواعد صارمة (ADR-008):
 *   • مدد يبقى BLOCKED: لا نداء خارجي، لا رفع، لا وسم «مقبول».
 *   • النسب لو لم يُحدّد rate_set فلا تُطبَّق؛ تُعلن «يلزم تثبيت المجموعة».
 *   • أي حقل مفقود يبقى «غير مسجّل» ولا يُعرض صفرًا.
 */
'use strict';

const {
    evaluateWpsReadiness,
    buildGosiPreview,
    rateSetList,
    resolveRateSet,
} = require('./wps');

/* ─── حساب شامل من مدخلات جاهزة ─────────────────────────────────────────── */

/**
 * @param {object} input
 * @param {string} input.month
 * @param {Array<object>} input.employees — صفوف loadEmployees()
 * @param {Map<string, object>} input.payrollById — صفوف loadPayrollLines(month)
 * @param {'posted'|'not_posted'|string|null} input.postedStatus
 * @param {{crn: string|null, name: string|null}} input.employer
 * @param {Array<object>} input.qiwaChecks — ناتج فحص قوى (checks[])
 * @param {string|null} [input.rateSetId] — معرّف مجموعة نسب صريحة أو null
 * @param {string} [input.generatedAt] — ISO؛ افتراضي الآن
 * @returns {object} التقرير الكامل
 */
function computeMonthlyCompliance(input) {
    const month = String(input.month || '').trim();
    const employees = input.employees ?? [];
    const activeEmployees = employees.filter((row) => row && row.status === 'active');
    const posted = input.postedStatus === 'posted';
    const employerId = input.employer?.crn ?? null;
    const payrollById = new Map(input.payrollById);

    // ─── WPS readiness ──────────────────────────────────────────────────
    const readinessInput = {
        employees: employees.map((row) => ({
            id: row.id,
            name: row.name ?? null,
            iqama: row.iqama ?? null,
            salary: row.salary ?? null,
            iban: row.iban ?? null,
            nationality: row.nationality ?? null,
        })),
        payrollById: payrollById,
        month,
        posted,
        employerId,
    };
    const readiness = evaluateWpsReadiness(readinessInput);

    // ─── الرواتب: مجاميع الشهر ─────────────────────────────────────────
    const payrollRows = [];
    for (const employee of activeEmployees) {
        const line = payrollById.get(String(employee.id)) ?? {};
        payrollRows.push({
            id: Number(employee.id),
            name: String(employee.name ?? ''),
            basic: Number(line.basic ?? employee.salary ?? 0) || 0,
            allowances: Number(line.allowances ?? 0) || 0,
            deductions: Number(line.deductions ?? 0) || 0,
            net: Number(line.net ?? employee.salary ?? 0) || 0,
            has_line: payrollById.has(String(employee.id)),
        });
    }
    const payrollTotals = payrollRows.reduce(
        (acc, row) => ({
            basic: acc.basic + row.basic,
            allowances: acc.allowances + row.allowances,
            deductions: acc.deductions + row.deductions,
            net: acc.net + row.net,
        }),
        { basic: 0, allowances: 0, deductions: 0, net: 0 },
    );
    const missingLines = payrollRows.filter((row) => !row.has_line).length;

    // ─── GOSI preview — فقط بمجموعة صريحة من المستخدم ───────────────────
    const rateSet = input.rateSetId ? resolveRateSet(input.rateSetId) : null;
    const gosi = rateSet
        ? {
            rate_set: { id: rateSet.id, label_ar: rateSet.label_ar, verified: rateSet.verified },
            preview: buildGosiPreview({
                employees: activeEmployees.map((row) => ({
                    id: Number(row.id),
                    name: row.name ?? null,
                    nationality: row.nationality ?? null,
                    joining_date: row.join ?? null,
                    salary: row.salary ?? null,
                })),
                payrollById: payrollById,
                rateSet,
            }),
            note: 'نسب غير موثّقة داخل النظام — تحتاج تثبيت المحاسب قبل أي استخدام رسمي.',
        }
        : {
            rate_set_required: true,
            available: rateSetList(),
            note: 'لم تُحدّد مجموعة النسب — اختر واحدة (legacy_before_2024_07 أو new_registrant_2026) بعد تثبيت المحاسب.',
        };

    // ─── قوى (qiwa readiness checks) ────────────────────────────────────
    const qiwaChecks = Array.isArray(input.qiwaChecks) ? input.qiwaChecks : [];

    // ─── موانع عامة يمكن أن تكسر الامتثال ────────────────────────────────
    const globalBlockers = [];
    if (!posted) {
        globalBlockers.push('المسير غير مُرحّل لهذا الشهر (payroll_runs.status).');
    }
    if (!employerId) {
        globalBlockers.push('السجل التجاري للمنشأة غير مضبوط في zatca_settings — يحجب ملف الأجور وتصدير GOSI.');
    }
    if (readiness.blockers.length) {
        globalBlockers.push(...readiness.blockers.map((code) => `WPS: ${code}`));
    }

    return {
        month,
        generated_at: input.generatedAt || new Date().toISOString(),
        employer: {
            crn: employerId,
            name: input.employer?.name ?? null,
        },
        payroll: {
            active_employees: activeEmployees.length,
            employees_with_line: payrollRows.filter((row) => row.has_line).length,
            employees_without_line: missingLines,
            totals: {
                basic: round2(payrollTotals.basic),
                allowances: round2(payrollTotals.allowances),
                deductions: round2(payrollTotals.deductions),
                net: round2(payrollTotals.net),
            },
            posted,
        },
        readiness: {
            ...readiness,
            percent: readiness.summary.employees > 0
                ? Math.round((readiness.summary.ready / readiness.summary.employees) * 100)
                : 0,
        },
        gosi,
        qiwa: {
            checks: qiwaChecks,
            ready: qiwaChecks.length ? qiwaChecks.every((check) => check.ok === true) : null,
        },
        global_blockers: globalBlockers,
        export_ready: readiness.export_ready && posted && Boolean(employerId),
    };
}

function round2(value) {
    return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

/* ─── بناء التقرير HTML للطباعة ────────────────────────────────────────────── */

function escapeHtml(value) {
    return String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}

const MONEY = (value) => (Number.isFinite(Number(value)) ? String(Number(value).toFixed(2)) : '—');

/**
 * ورقة تقرير الامتثال — A4، للطباعة والتوقيع والإرفاق بملف المراجعة.
 * «—» لغير المسجل (لا صفر). المحتوى كله للمراجعة البشرية — لا يُرفق بمدد.
 */
function complianceReportHtml(report) {
    const esc = escapeHtml;
    const blockers = [
        ...(report.global_blockers || []),
        ...(report.readiness.blockers || []).map((code) => `WPS: ${code}`),
    ];
    const blockerRows = blockers.length
        ? blockers.map((item) => `<li>${esc(item)}</li>`).join('')
        : '<li>لا موانع مسجلة لهذا الشهر.</li>';

    const qiwaRows = (report.qiwa.checks || [])
        .map((check) => `<tr><td>${esc(check.label_ar || check.id)}</td><td>${esc(check.ok ? '✔' : '✘')}</td><td>${esc(check.detail ?? '—')}</td></tr>`)
        .join('');

    const gosiSection = report.gosi.preview
        ? `<div class="figs">
             <div class="fig"><div class="fig-l">GOSI للموظف</div><div class="fig-v">${MONEY(report.gosi.preview.totals?.saudiEmployee ?? 0)}</div></div>
             <div class="fig"><div class="fig-l">GOSI لصاحب العمل</div><div class="fig-v">${MONEY(report.gosi.preview.totals?.saudiEmployer ?? 0)}</div></div>
           </div>
           <p class="muted">مجموعة النسب: ${esc(report.gosi.rate_set.label_ar)} — ${esc(report.gosi.note)}</p>`
        : `<p class="muted">${esc(report.gosi.note || 'لم تُحدّد مجموعة النسب.')}</p>`;

    return `<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="UTF-8">
<title>تقرير الامتثال — ${esc(report.month)}</title>
<style>
body{font-family:'Tajawal','Segoe UI',Tahoma,Arial,sans-serif;color:#172b3b;background:#fff;margin:0;padding:24px;direction:rtl}
.sheet{max-width:860px;margin:auto}
h1{color:#0f766e;font-size:20px;border-bottom:3px solid #0f766e;padding-bottom:8px}
h2{font-size:15px;color:#102a43;border-right:4px solid #0f766e;padding-right:8px;margin:14px 0 7px}
.figs{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}
.fig{background:#f3f6fa;border:1px solid #dce5ec;border-radius:9px;padding:8px 10px}
.fig-l{font-size:11.5px;color:#596e80}
.fig-v{font-size:17px;font-weight:800;margin:2px 0}
table{width:100%;border-collapse:collapse;margin:6px 0}
th,td{border:1px solid #dce5ec;padding:6px 8px;font-size:12.5px;text-align:right}
th{background:#eaf0f5;color:#102a43}
ol{padding-right:18px}
ul{padding-right:18px;line-height:1.9}
.foot{border-top:2px solid #0f766e;margin-top:18px;padding-top:8px;display:flex;justify-content:space-between;color:#596e80;font-size:10.5px}
.controls{text-align:center;margin-bottom:14px}
.controls button{border:0;border-radius:7px;padding:9px 22px;background:#0f766e;color:#fff;font:inherit;cursor:pointer}
@media print{body{padding:0}.controls{display:none!important}@page{size:A4;margin:12mm}}
</style></head><body>
<div class="controls"><button type="button" onclick="window.print()">طباعة</button></div>
<main class="sheet">
<h1>تقرير الامتثال الشهري — ${esc(report.month)}</h1>
<p class="muted">نظام كاريم ERP — للمراجعة الداخلية. لا يُرسل إلى مدد ولا إلى GOSI ولا إلى قوى. مولّد ${esc(report.generated_at)}.</p>

<div class="figs">
  <div class="fig"><div class="fig-l">الموظفون النشطون</div><div class="fig-v">${esc(report.payroll.active_employees)}</div></div>
  <div class="fig"><div class="fig-l">بمسير مُرحّل</div><div class="fig-v">${report.payroll.posted ? 'نعم' : 'لا'}</div></div>
  <div class="fig"><div class="fig-l">WPS جاهزية</div><div class="fig-v">${esc(report.readiness.percent)}%</div></div>
</div>

<h2>المرتبات الشهرية</h2>
<table><thead><tr><th>إجمالي الأساسي</th><th>إجمالي البدلات</th><th>إجمالي الخصومات</th><th>صافي الرواتب</th></tr></thead>
<tbody><tr>
  <td>${MONEY(report.payroll.totals.basic)}</td>
  <td>${MONEY(report.payroll.totals.allowances)}</td>
  <td>${MONEY(report.payroll.totals.deductions)}</td>
  <td>${MONEY(report.payroll.totals.net)}</td>
</tr></tbody></table>
<p class="muted">${esc(report.payroll.employees_without_line)} موظف بلا سطر مسير في هذا الشهر.</p>

<h2>جاهزية مدد (WPS)</h2>
<div class="figs">
  <div class="fig"><div class="fig-l">جاهز</div><div class="fig-v">${esc(report.readiness.summary.ready)}</div></div>
  <div class="fig"><div class="fig-l">جاهزية</div><div class="fig-v">${esc(report.readiness.percent)}%</div></div>
  <div class="fig"><div class="fig-l">كشف أجور</div><div class="fig-v">${report.readiness.export_ready ? 'جاهز' : 'غير جاهز'}</div></div>
</div>
<ul>${blockerRows}</ul>

<h2>التأمينات الاجتماعية (GOSI)</h2>
${gosiSection}

<h2>قوى (Qiwa)</h2>
<table><thead><tr><th>الفحص</th><th>الحالة</th><th>التفاصيل</th></tr></thead><tbody>${qiwaRows}</tbody></table>

<h2>الموانع العامة</h2>
<ul>${blockerRows}</ul>

<div class="foot"><div>طُبع من نظام كاريم ERP — ${esc(report.generated_at)}</div><div>للمراجعة البشرية فقط</div></div>
</main></body></html>`;
}

module.exports = { computeMonthlyCompliance, complianceReportHtml };
