import { formatInt } from './inventory-register';
import {
    type GosiPreviewResponse,
    type GosiRateSet,
    gosiBasisLabel,
    gosiReasonLabel,
    issueLabel,
    moneyText,
    NATIONALITY_CATEGORY_LABELS,
    nationalityCategory,
    ratePercent,
    readinessPercent,
    requirementStatusLabel,
    type WpsReadinessResponse,
    type WpsRequirement,
} from './mudad';

/**
 * ورقة مراجعة الامتثال — WPS / GOSI / Qiwa في ورقة A4 واحدة.
 *
 * كل رقم فيها قادم من `/api/integration/*` كما هو: لا حساب ولا تقدير ولا
 * استنتاج. الورقة «ورقة مراجعة بشرية» — ليست ملف SIF ولا إثبات قبول من
 * مدد (ADR-008: مدد `BLOCKED`).
 */

function escapeHtml(value: unknown): string {
    return String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}

function csvCell(value: string): string {
    return `"${value.replace(/"/g, '""')}"`;
}

export type MudadReviewPrintOptions = {
    month: string;
    byName: string;
    requirements?: WpsRequirement[];
    preview?: GosiPreviewResponse | null;
    rateSet?: GosiRateSet | null;
    qiwaChecks?: { id: string; label_ar: string; ok: boolean; detail: string }[];
    generatedAt?: Date;
};

function figure(label: string, value: string, hint: string): string {
    return (
        `<div class="fig"><div class="fig-l">${escapeHtml(label)}</div>` +
        `<div class="fig-v">${escapeHtml(value)}</div>` +
        `<div class="fig-h">${escapeHtml(hint)}</div></div>`
    );
}

function categoryLabel(code: string | null | undefined): string {
    return NATIONALITY_CATEGORY_LABELS[nationalityCategory(code)];
}

export function mudadReviewPrintHtml(readiness: WpsReadinessResponse, options: MudadReviewPrintOptions): string {
    const summary = readiness.summary;
    const percent = readinessPercent(summary);
    const requirements = options.requirements ?? [];
    const preview = options.preview ?? null;
    const qiwaChecks = options.qiwaChecks ?? [];
    const generated = (options.generatedAt ?? new Date()).toLocaleString('ar-EG', {
        dateStyle: 'medium',
        timeStyle: 'short',
    });

    const blockerItems = readiness.blockers.length
        ? readiness.blockers.map((code) => `<li>${escapeHtml(code)}</li>`).join('')
        : '<li class="ok">لا موانع لهذا الشهر — الملف مكتمل الجاهزية.</li>';

    const employeeRows = readiness.employees
        .map((employee) => {
            const issues = employee.issues.length ? employee.issues.map((code) => escapeHtml(issueLabel(code))).join('، ') : '—';
            return (
                `<tr><td>${escapeHtml(employee.name ?? '—')}</td>` +
                `<td class="c">${escapeHtml(employee.employee_id)}</td>` +
                `<td class="c">${escapeHtml(employee.id_number ?? '—')}</td>` +
                `<td class="c">${escapeHtml(employee.iban_masked ?? '—')}</td>` +
                `<td class="c">${escapeHtml(categoryLabel(employee.nationality))}</td>` +
                `<td class="n">${escapeHtml(moneyText(employee.salary))}</td>` +
                `<td>${issues}</td>` +
                `<td class="c">${employee.ready ? 'جاهز' : 'غير جاهز'}</td></tr>`
            );
        })
        .join('');

    const requirementRows = requirements
        .map((requirement) => {
            const status = requirementStatusLabel(requirement.status);
            return (
                `<tr><td>${escapeHtml(requirement.title_ar)}</td>` +
                `<td>${escapeHtml(status.label)}</td>` +
                `<td>${escapeHtml(requirement.requirement)}</td>` +
                `<td>${escapeHtml(requirement.detail ?? '—')}</td>` +
                `<td>${escapeHtml(requirement.source ?? '—')}</td></tr>`
            );
        })
        .join('');

    const qiwaRows = qiwaChecks
        .map(
            (check) =>
                `<tr><td>${escapeHtml(check.label_ar)}</td><td class="c">${check.ok ? 'مستوفى' : 'ناقص'}</td>` +
                `<td>${escapeHtml(check.detail)}</td></tr>`,
        )
        .join('');

    const previewBlock = preview
        ? `<div class="sec"><h2>معاينة اشتراكات التأمينات</h2>
             <p class="muted">مجموعة النسب: <b>${escapeHtml(preview.rate_set.label_ar)}</b> — ${
                 preview.rate_set.verified ? 'موثّقة' : 'غير موثّقة'
             } · الأساس: ${escapeHtml(gosiBasisLabel(preview.basis))} · ${
                 preview.estimate ? 'تقديري (المسير غير مُقفل)' : 'من وعاء المسير'
             }</p>
             <div class="figs">
               ${figure('حصة الموظف', moneyText(preview.totals.employee), 'عرض فقط — لا خصم ولا قيد')}
               ${figure('حصة صاحب العمل', moneyText(preview.totals.employer), 'عرض فقط — لا قيد')}
               ${figure('الإجمالي', moneyText(preview.totals.total), `${formatInt(preview.lines.length)} صفًا محسوبًا`)}
             </div>
             ${
                 preview.lines.length
                     ? `<table><thead><tr><th>الموظف</th><th class="c">التصنيف</th><th class="n">الأجر</th><th class="n">الموظف</th><th class="n">صاحب العمل</th><th class="n">الإجمالي</th></tr></thead><tbody>${preview.lines
                           .map(
                               (line) =>
                                   `<tr><td>${escapeHtml(line.name ?? '—')}</td>` +
                                   `<td class="c">${escapeHtml(
                                       line.category === 'saudi' ? 'سعودي' : line.category === 'expat' ? 'وافد' : 'غير معروف',
                                   )}</td>` +
                                   `<td class="n">${escapeHtml(moneyText(line.wage))}</td>` +
                                   `<td class="n">${escapeHtml(moneyText(line.employee))}</td>` +
                                   `<td class="n">${escapeHtml(moneyText(line.employer))}</td>` +
                                   `<td class="n">${escapeHtml(moneyText(line.total))}</td></tr>`,
                           )
                           .join('')}</tbody></table>`
                     : '<p class="muted">لا صفوف محسوبة.</p>'
             }
             ${
                 preview.unclassified.length
                     ? `<p class="warn-line">لم يُصنَّف تأمينيًا: ${escapeHtml(
                           preview.unclassified
                               .map((entry) => `${entry.name ?? `#${entry.employee_id}`} — ${gosiReasonLabel(entry.reason)}`)
                               .join('، '),
                       )}</p>`
                     : ''
             }
             ${
                 preview.warnings.length
                     ? `<ul class="notes">${preview.warnings.map((warning) => `<li>${escapeHtml(warning)}</li>`).join('')}</ul>`
                     : ''
             }
           </div>`
        : '';

    const rateSetBlock = options.rateSet
        ? `<div class="sec"><h2>مجموعة النسب المختارة</h2><div class="figs">
             ${figure('سعودي — موظف', ratePercent(options.rateSet.saudi.employee_bp), 'نقاط الأساس')}
             ${figure('سعودي — صاحب العمل', ratePercent(options.rateSet.saudi.employer_bp), 'نقاط الأساس')}
             ${figure('وافد — موظف', ratePercent(options.rateSet.expat.employee_bp), 'نقاط الأساس')}
             ${figure('وافد — صاحب العمل', ratePercent(options.rateSet.expat.employer_bp), 'نقاط الأساس')}
           </div><p class="${options.rateSet.verified ? 'ok' : 'warn-line'}">${
               options.rateSet.verified ? 'نسب موثّقة.' : 'نسب غير موثّقة داخل النظام — لا تُطبَّق على أي قيد.'
           }</p></div>`
        : '';

    const qiwaBlock = qiwaChecks.length
        ? `<div class="sec"><h2>فحص جاهزية قوى — بيانات محلية فقط</h2>
             <table><thead><tr><th>الفحص</th><th class="c">النتيجة</th><th>التفصيل</th></tr></thead><tbody>${qiwaRows}</tbody></table>
           </div>`
        : '';

    return `<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>ورقة مراجعة الامتثال — ${escapeHtml(options.month)}</title>
<style>
body{font-family:'Tajawal','Segoe UI',Tahoma,Arial,sans-serif;color:#172b3b;background:#fff;margin:0;padding:28px;direction:rtl}
.sheet{max-width:860px;margin:auto}
.head{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #0f766e;padding-bottom:12px}
.brand h1{margin:0;color:#0f766e;font-size:21px}.brand p{margin:4px 0 0;color:#596e80;font-size:12px}
.docno{text-align:left}.docno .no{display:inline-block;border:2px solid #0f766e;border-radius:10px;padding:6px 14px;font-size:15px;font-weight:800;direction:ltr}
.docno .dt{margin-top:6px;color:#596e80;font-size:12px}
.title{background:#102a43;color:#f0f6fa;text-align:center;font-size:17px;font-weight:800;padding:9px;border-radius:10px;margin:14px 0}
.banner{border-radius:10px;padding:9px 12px;font-size:13px;margin-bottom:12px}
.banner.warn{background:#fce8e6;border:1px solid #b3261e;color:#8e1f16;font-weight:700}
.banner.ok{background:#e8f6ee;border:1px solid #16834a;color:#12633a;font-weight:700}
.sec{margin-top:14px}.sec h2{font-size:14px;color:#102a43;margin:0 0 7px;border-right:4px solid #0f766e;padding-right:8px}
.figs{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}
.fig{background:#f3f6fa;border:1px solid #dce5ec;border-radius:9px;padding:8px 10px}
.fig-l{font-size:11.5px;color:#596e80}.fig-v{font-size:15px;font-weight:800;margin:2px 0}
.fig-h{font-size:10.5px;color:#8496a5}
table{width:100%;border-collapse:collapse;margin-top:6px}
th{background:#eaf0f5;color:#102a43;padding:7px 6px;font-size:12px;border:1px solid #dce5ec}
td{border:1px solid #dce5ec;padding:6px 8px;font-size:12px}
td.c{text-align:center}td.n{direction:ltr;unicode-bidi:embed;text-align:right}
.muted{color:#596e80;font-size:12.5px}.ok{color:#12633a;font-size:12.5px;font-weight:700}
.warn-line{color:#8e1f16;font-size:12.5px;font-weight:700}
.notes{margin:6px 0 0;padding-inline-start:18px;color:#596e80;font-size:12px}
.blockers{margin:6px 0 0;padding-inline-start:18px;font-size:12.5px}
.signs{display:flex;gap:24px;margin-top:34px}
.sign{flex:1;text-align:center}.sign .line{border-top:2px dotted #8496a5;margin-top:44px;padding-top:6px;font-weight:700;font-size:12.5px}
.sign .who{color:#596e80;font-size:11.5px}
.foot{border-top:2px solid #0f766e;margin-top:24px;padding-top:8px;display:flex;justify-content:space-between;color:#596e80;font-size:10.5px}
.controls{text-align:center;margin-bottom:18px}.controls button{border:0;border-radius:7px;padding:10px 24px;margin:0 5px;font:inherit;cursor:pointer;background:#0f766e;color:#fff}
.controls button.secondary{background:#555}
@media print{body{padding:0}.controls{display:none!important}@page{size:A4;margin:12mm}}
</style></head><body>
<div class="controls"><button type="button" data-mudad-print>طباعة</button><button type="button" class="secondary" data-mudad-close>إغلاق</button></div>
<main class="sheet">
<header class="head">
<div class="brand"><h1>ورقة مراجعة الامتثال — ملف الأجور</h1><p>نظام Karim ERP — مراجعة داخلية قبل أي رفع يدوي</p></div>
<div class="docno"><div class="no">${escapeHtml(options.month)}</div><div class="dt">${escapeHtml(generated)}</div></div>
</header>
<div class="title">مدد والتأمينات وقوى — ${escapeHtml(options.month)}</div>
<div class="banner warn">مدد يبقى <b>BLOCKED</b> — لا اتصال حكومي ولا رفع تلقائي. هذه الورقة «مراجعة بشرية» وليست ملف SIF ولا إثبات قبول.</div>
<div class="sec"><h2>ملخص جاهزية الملف</h2><div class="figs">
${figure('الموظفون النشطون', formatInt(summary.employees), 'من يشمله ملف الشهر')}
${figure('الجاهزون', formatInt(summary.ready), `${formatInt(percent)}% جاهزية`)}
${figure('الموانع', formatInt(readiness.blockers.length), 'كل مانع يمنع توليد الكشف')}
${figure('حالة المسير', summary.posted ? 'posted' : 'غير مُقفل', summary.employer_identifier ? 'السجل التجاري مضبوط' : 'السجل التجاري غير مضبوط')}
${figure('هوية/إقامة ناقصة', formatInt(summary.missing_id), 'موظفون بلا هوية صحيحة')}
${figure('راتب ناقص', formatInt(summary.missing_salary), 'بلا راتب أساسي موجب')}
${figure('IBAN ناقص', formatInt(summary.missing_iban), 'بلا IBAN سعودي صالح')}
${figure('جنسية غير معروفة', formatInt(summary.unknown_nationality), 'بلا رمز ISO صالح')}
</div></div>
<div class="sec"><h2>الموانع</h2><ul class="blockers">${blockerItems}</ul></div>
${
    employeeRows
        ? `<div class="sec"><h2>جاهزية بيانات الصرف لكل موظف</h2><table><thead><tr><th>الموظف</th><th class="c">الرقم</th><th class="c">الهوية/الإقامة</th><th class="c">IBAN (مقنّع)</th><th class="c">الجنسية</th><th class="n">الراتب</th><th>النواقص</th><th class="c">الجاهزية</th></tr></thead><tbody>${employeeRows}</tbody></table></div>`
        : '<div class="sec"><h2>جاهزية بيانات الصرف</h2><p class="muted">لا صفوف موظفين في هذا الملف.</p></div>'
}
${
    requirementRows
        ? `<div class="sec"><h2>متطلبات الملف</h2><table><thead><tr><th>المتطلب</th><th class="c">الحالة</th><th>الشرط</th><th>التفصيل</th><th>المصدر</th></tr></thead><tbody>${requirementRows}</tbody></table></div>`
        : ''
}
${rateSetBlock}
${previewBlock}
${qiwaBlock}
<div class="signs">
<div class="sign"><div class="line"></div><div class="who">المحاسب — إعداد</div></div>
<div class="sign"><div class="line"></div><div class="who">مدير الموارد البشرية — اعتماد الجاهزية</div></div>
<div class="sign"><div class="line"></div><div class="who">المراجع — اعتماد المراجعة الداخلية</div></div>
</div>
<div class="foot">
<div>طُبعت من نظام Karim ERP بواسطة ${escapeHtml(options.byName)} — ${escapeHtml(generated)}</div>
<div>ورقة مراجعة داخلية — ليست إقرارًا رسميًا ولا تُرفع تلقائيًا</div>
</div>
</main></body></html>`;
}

/** ملخّص CSV لنفس الأرقام — للمراجعة والمشاركة خارج الطباعة. */
export function mudadReviewCsv(readiness: WpsReadinessResponse, options: MudadReviewPrintOptions): string {
    const summary = readiness.summary;
    const rows: string[][] = [
        ['البند', 'القيمة'],
        ['الشهر', options.month],
        ['الموظفون النشطون', String(summary.employees)],
        ['الجاهزون', String(summary.ready)],
        ['نسبة الجاهزية %', String(readinessPercent(summary))],
        ['هوية/إقامة ناقصة', String(summary.missing_id)],
        ['راتب ناقص', String(summary.missing_salary)],
        ['IBAN ناقص', String(summary.missing_iban)],
        ['جنسية غير معروفة', String(summary.unknown_nationality)],
        ['بند مسير ناقص', String(summary.missing_payroll_line)],
        ['المسير مُقفل', summary.posted ? 'نعم' : 'لا'],
        ['السجل التجاري مضبوط', summary.employer_identifier ? 'نعم' : 'لا'],
        ['الكشف جاهز للتوليد', readiness.export_ready ? 'نعم' : 'لا'],
        ['عدد الموانع', String(readiness.blockers.length)],
    ];
    for (const code of readiness.blockers) {
        rows.push([`مانع — ${code}`, code]);
    }
    for (const requirement of options.requirements ?? []) {
        rows.push([`متطلب — ${requirement.title_ar}`, requirementStatusLabel(requirement.status).label]);
    }
    for (const employee of readiness.employees) {
        rows.push([
            `موظف — ${employee.name ?? `#${employee.employee_id}`}`,
            `الجاهزية: ${employee.ready ? 'جاهز' : 'غير جاهز'} · الجنسية: ${categoryLabel(employee.nationality)} · الراتب: ${moneyText(employee.salary)} · النواقص: ${
                employee.issues.length ? employee.issues.map((code) => issueLabel(code)).join('، ') : '—'
            }`,
        ]);
    }
    const preview = options.preview ?? null;
    if (preview) {
        rows.push(
            ['مجموعة النسب', preview.rate_set.label_ar],
            ['نسب موثّقة', preview.rate_set.verified ? 'نعم' : 'لا'],
            ['الأساس', gosiBasisLabel(preview.basis)],
            ['حصة الموظف', String(preview.totals.employee)],
            ['حصة صاحب العمل', String(preview.totals.employer)],
            ['إجمالي التأمينات', String(preview.totals.total)],
        );
        for (const line of preview.lines) {
            rows.push([
                `اشتراك — ${line.name ?? `#${line.employee_id}`}`,
                `الأجر ${moneyText(line.wage)} · الموظف ${moneyText(line.employee)} · صاحب العمل ${moneyText(line.employer)} · الإجمالي ${moneyText(line.total)}`,
            ]);
        }
    }
    for (const check of options.qiwaChecks ?? []) {
        rows.push([`فحص قوى — ${check.label_ar}`, check.ok ? 'مستوفى' : 'ناقص']);
    }
    return `\uFEFF${rows.map((row) => row.map(csvCell).join(',')).join('\r\n')}`;
}

/** اسم ملف موحّد — الشهر محلّ الملف. */
export function mudadReviewFilename(month: string): string {
    return `ورقة-امتثال-ملف-الأجور-${month}.csv`;
}
