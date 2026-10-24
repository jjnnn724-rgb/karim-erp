/**
 * V2 — Payroll screen · منظومة الرواتب الكاملة (قراءة + كتابة)
 * ═══════════════════════════════════════════════════════════════════════
 * Behavior mirror of features/hr.js:733-987 (read fully): كشف الرواتب +
 * تصدير + مسيرات (آخر 6) + توليد (تأكيدان) + خصومات الالتزام (معاينة ثم
 * تطبيق) + سلف + جزاءات/علاوات + عقود + تقييمات. نفس الأبواب والحمولات
 * والجمل — والكتابة لأدوار admin/manager/hr (:779)، والخادم يعيد الفحص.
 */

import { createDataTable } from '../data-display/data-table.js?v=4.9.151';
import { fetchPayrollRuns, payrollRunToRow } from '../data/hr-registers-repo.js?v=4.9.151';
import { fetchDepartments as fetchHrDepartments } from '../data/employees-repo.js?v=4.9.151';
import { formatMoney, formatInt, fetchCurrency } from '../data/reports-repo.js?v=4.9.151';
import {
    PAYROLL_WRITE_ROLES, fetchPayrollSheet, generatePayrollRun,
    fetchDeductionsPreview, applyDeductions,
    advancesApi, adjustmentsApi, contractsApi, evaluationsApi,
    fetchSuiteLists, validateAdvance, validateAdjustment,
    validateContract, validateEvaluation,
} from '../data/payroll-suite.js?v=4.9.151';
import { canWrite } from '../session.js?v=4.9.151';
import { ensureXlsx } from '../vendor.js?v=4.9.151';
import { prepareReportWorkbook } from '../report-export.js?v=4.9.151';

const esc = (v) => String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

function money(v, c) {
    const m = formatMoney(v, c);
    return '<span class="erp-num" dir="ltr">' + m.amount + '</span>' + (m.hasUnit ? ' <span class="erp-text-sm erp-text-muted">' + esc(m.unit) + '</span>' : '');
}

function curMonth() {
    return new Date().toISOString().slice(0, 7);
}

function template(canPost) {
    return '<div class="erp-v2-payroll-root"><section class="erp-card erp-v2-payroll">'
        + '<div class="erp-card__head"><h3 class="erp-card__title">مسيرات الرواتب <span class="erp-eyebrow" dir="ltr" lang="en">Payroll</span> <span class="erp-text-muted erp-text-sm" data-v2-count></span></h3>'
        + '<span class="erp-grow"></span>'
        + '<button type="button" class="erp-btn erp-btn--sm" data-v2-print><i class="ji" data-i="printer" aria-hidden="true"></i><span>طباعة</span></button>'
        + '<button type="button" class="erp-btn erp-btn--primary erp-btn--sm" data-v2-reload><i class="ji" data-i="refresh" aria-hidden="true"></i><span>عرض</span></button>'
        + '</div>'
        + '<div class="erp-card__body erp-stack">'
        + '<ul class="erp-kpis" data-v2-kpis></ul>'
        + '<p class="erp-text-sm erp-text-muted" data-v2-summary role="status" aria-live="polite"></p>'
        + '<p class="erp-text-sm erp-text-muted">سجل مسيرات الرواتب (معتمد عند التوليد).'
        + (canPost ? ' التوليد والخصومات والسلف والبنود والعقود والتقييمات من الأقسام أدناه.' : ' الكتابة لأدوار الإدارة والموارد.')
        + '</p>'
        + '<div data-v2-table></div></div></section>'
        + '<section class="erp-card"><div class="erp-card__head"><h3 class="erp-card__title">كشف الرواتب</h3><span class="erp-grow"></span>'
        + '<input class="erp-input erp-input--ltr" type="month" data-v2-sheet-month value="' + curMonth() + '" aria-label="شهر الكشف">'
        + '<button type="button" class="erp-btn erp-btn--sm" data-v2-sheet-go>عرض</button>'
        + '<button type="button" class="erp-btn erp-btn--sm" data-v2-sheet-export>تصدير Excel</button>'
        + '</div><div class="erp-card__body erp-stack"><div data-v2-sheet></div></div></section>'
        + (canPost ? '<section class="erp-card"><div class="erp-card__head"><h3 class="erp-card__title">توليد مسير الرواتب</h3><span class="erp-grow"></span>'
        + '<input class="erp-input erp-input--ltr" type="month" data-v2-gen-month value="' + curMonth() + '" aria-label="شهر التوليد">'
        + '<button type="button" class="erp-btn erp-btn--primary erp-btn--sm" data-v2-gen-go>توليد المسير</button>'
        + '</div><div class="erp-card__body erp-stack"><div data-v2-gen-runs></div></div></section>'
        + '<section class="erp-card"><div class="erp-card__head"><h3 class="erp-card__title">خصومات الالتزام بالدوام</h3></div>'
        + '<div class="erp-card__body erp-stack"><div class="erp-dash-controls">'
        + '<input class="erp-input erp-input--ltr" type="month" data-v2-ded-month value="' + curMonth() + '" aria-label="شهر الخصومات">'
        + '<label class="erp-text-sm"><input type="checkbox" data-v2-ded-fri> استثناء الجمعة</label>'
        + '<button type="button" class="erp-btn erp-btn--sm" data-v2-ded-preview>معاينة</button>'
        + '</div><div data-v2-ded-body></div></div></section>'
        + '<section class="erp-card"><div class="erp-card__head"><h3 class="erp-card__title">السلف <span class="erp-text-muted erp-text-sm" data-v2-adv-count></span></h3></div>'
        + '<div class="erp-card__body erp-stack"><div data-v2-adv-form></div><div data-v2-adv-list></div></div></section>'
        + '<section class="erp-card"><div class="erp-card__head"><h3 class="erp-card__title">جزاءات وعلاوات الشهر</h3></div>'
        + '<div class="erp-card__body erp-stack"><div data-v2-adj-form></div><div data-v2-adj-list></div></div></section>'
        + '<section class="erp-card"><div class="erp-card__head"><h3 class="erp-card__title">العقود (الأقرب انتهاءً)</h3></div>'
        + '<div class="erp-card__body erp-stack"><div data-v2-con-form></div><div data-v2-con-list></div></div></section>'
        + '<section class="erp-card"><div class="erp-card__head"><h3 class="erp-card__title">التقييمات</h3></div>'
        + '<div class="erp-card__body erp-stack"><div data-v2-ev-form></div><div data-v2-ev-list></div></div></section>'
        : '') + '</div>';
}

export function mountPayrollScreen(host, ctx = {}) {
    const notify = typeof ctx.notify === 'function' ? ctx.notify : (m) => console.info('[V2 payroll]', m);
    const confirmFn = typeof ctx.confirmFn === 'function' ? ctx.confirmFn
        : (m) => (typeof window !== 'undefined' && window.confirm ? window.confirm(m) : false);
    const canPost = canWrite(ctx.role, PAYROLL_WRITE_ROLES);

    let rows = [];
    let loading = false;
    let saving = false;
    let currency = '';
    let sheetEmps = [];
    let sheetDays = new Map();
    let sheetDepts = new Map();
    let suite = { advances: [], adjustments: [], contracts: [], evaluations: [] };
    let dedPreview = null;

    host.insertAdjacentHTML('beforeend', template(canPost));
    const el = host.lastElementChild;
    const q = (s) => el.querySelector(s);
    const countEl = q('[data-v2-count]');
    const summaryEl = q('[data-v2-summary]');
    const kpisEl = q('[data-v2-kpis]');

    const say = (m) => notify(m);

    const table = createDataTable({
        caption: 'مسيرات الرواتب - بيانات حية', mode: 'client', pageSize: 50, stickyHeader: true,
        emptyMessage: 'لا توجد مسيرات مرحّلة', rowKey: (r) => r.id,
        columns: [
            { key: 'month', header: 'الشهر', sortable: true, filterable: true, width: '110px', className: 'erp-mono', render: (r) => esc(r.month) },
            { key: 'count', header: 'موظفون', type: 'number', width: '110px', align: 'end', value: (r) => r.count, render: (r) => '<span class="erp-num" dir="ltr">' + formatInt(r.count) + '</span>' },
            { key: 'basic', header: 'أساسي', type: 'number', align: 'end', value: (r) => r.basic, render: (r) => money(r.basic, currency) },
            { key: 'overtime', header: 'أوفرتايم', type: 'number', align: 'end', value: (r) => r.overtime, render: (r) => money(r.overtime, currency) },
            { key: 'bonuses', header: 'علاوات', type: 'number', align: 'end', value: (r) => r.bonuses, render: (r) => money(r.bonuses, currency) },
            { key: 'penalties', header: 'جزاءات', type: 'number', align: 'end', value: (r) => r.penalties, render: (r) => money(r.penalties, currency) },
            { key: 'advances', header: 'سلف', type: 'number', align: 'end', value: (r) => r.advances, render: (r) => money(r.advances, currency) },
            { key: 'net', header: 'الصافي', type: 'number', align: 'end', value: (r) => r.net, render: (r) => money(r.net, currency) },
            { key: 'status', header: 'الحالة', width: '110px', render: (r) => r.status ? '<span class="erp-badge" data-tone="success">' + esc(r.status) + '</span>' : '<span class="erp-text-muted">—</span>' },
        ],
    });
    q('[data-v2-table]').appendChild(table.el);

    const empName = (id) => {
        const e = sheetEmps.find((x) => String(x.id) === String(id));
        return e ? e.name : `#${id}`;
    };
    const empOptions = (sel) => sheetEmps.map((e) => `<option value="${esc(String(e.id))}"${String(sel) === String(e.id) ? ' selected' : ''}>${esc(e.name)} — ${esc(e.employeeId || '')}</option>`).join('');

    function paintRunsExtra() {
        const box = q('[data-v2-gen-runs]');
        if (!box) {return;}
        const runs = rows.slice().sort((a, b) => String(b.month).localeCompare(String(a.month))).slice(0, 6);
        box.innerHTML = `<div class="erp-table__scroll" tabindex="0"><table class="erp-table__grid"><thead><tr><th>الشهر</th><th>الموظفون</th><th>الأساسي</th><th>أوفرتايم</th><th>علاوات</th><th>جزاءات</th><th>سلف</th><th>الصافي</th></tr></thead><tbody>`
            + (runs.map((r) => `<tr><td class="erp-td"><b class="erp-mono" dir="ltr">${esc(r.month)}</b></td><td class="erp-td erp-num" dir="ltr">${formatInt(r.count)}</td><td class="erp-td">${money(r.basic, currency)}</td><td class="erp-td">${money(r.overtime, currency)}</td><td class="erp-td">${money(r.bonuses, currency)}</td><td class="erp-td">${money(r.penalties, currency)}</td><td class="erp-td">${money(r.advances, currency)}</td><td class="erp-td"><b>${money(r.net, currency)}</b></td></tr>`).join('')
                || '<tr><td class="erp-td" colspan="8">لا مسيرات مولدة بعد</td></tr>')
            + `</tbody></table></div>`;
    }

    function paintSheet() {
        const box = q('[data-v2-sheet]');
        if (!box) {return;}
        const total = sheetEmps.reduce((s, e) => s + (Number(e.salary) || 0), 0);
        box.innerHTML = `<div class="erp-table__scroll" tabindex="0"><table class="erp-table__grid"><thead><tr><th>الموظف</th><th>القسم</th><th>المنصب</th><th>الأساسي</th><th>أيام الحضور</th><th>الصافي</th></tr></thead><tbody>`
            + (sheetEmps.map((e) => {
                const d = sheetDepts.get(String(e.department));
                const days = sheetDays.get(String(e.id)) || 0;
                return `<tr><td class="erp-td"><b>${esc(e.name)}</b></td><td class="erp-td">${esc((d && (d.name || d.name_ar)) || '—')}</td><td class="erp-td">${esc(e.position || '—')}</td><td class="erp-td">${money(e.salary || 0, currency)}</td><td class="erp-td erp-num" dir="ltr">${formatInt(days)} يوم</td><td class="erp-td"><b>${money(e.salary || 0, currency)}</b></td></tr>`;
            }).join('') || '<tr><td class="erp-td" colspan="6">لا يوجد موظفون</td></tr>')
            + `</tbody></table></div>`
            + `<p class="erp-text-sm">الإجمالي: <b>${money(total, currency)}</b></p>`;
    }

    function paintSuite() {
        if (!canPost) {return;}
        const adv = suite.advances || [];
        q('[data-v2-adv-count]').textContent = `(${formatInt(adv.length)})`;
        q('[data-v2-adv-form]').innerHTML = `<div class="erp-dash-controls">`
            + `<label class="erp-text-sm erp-text-muted">الموظف</label><select class="erp-select" data-v2-f="advEmp" aria-label="الموظف">${empOptions()}</select>`
            + `<label class="erp-text-sm erp-text-muted">المبلغ</label><input class="erp-input erp-input--ltr" data-v2-f="advAmt" type="number" step="0.01" aria-label="مبلغ السلفة">`
            + `<label class="erp-text-sm erp-text-muted">القسط الشهري (0 = دفعة واحدة)</label><input class="erp-input erp-input--ltr" data-v2-f="advInst" type="number" step="0.01" value="0" aria-label="القسط الشهري">`
            + `<label class="erp-text-sm erp-text-muted">التاريخ</label><input class="erp-input erp-input--ltr" data-v2-f="advDate" type="date" value="${new Date().toISOString().slice(0, 10)}" aria-label="تاريخ السلفة">`
            + `<button type="button" class="erp-btn erp-btn--primary erp-btn--sm" data-v2-adv-save>سلفة</button></div>`
            + `<div class="erp-text-sm" style="color:var(--erp-danger-text)" data-v2-adv-err role="alert"></div>`;
        q('[data-v2-adv-list]').innerHTML = `<div class="erp-table__scroll" tabindex="0"><table class="erp-table__grid"><thead><tr><th>الموظف</th><th>المبلغ</th><th>القسط</th><th>المتبقي</th><th>الحالة</th><th>التاريخ</th><th></th></tr></thead><tbody>`
            + (adv.slice().reverse().slice(0, 30).map((a) => `<tr><td class="erp-td"><b>${esc(empName(a.employeeId))}</b></td><td class="erp-td">${money(a.amount, currency)}</td><td class="erp-td">${money(a.monthly_deduction, currency)}</td><td class="erp-td"><b>${money(a.remaining, currency)}</b></td><td class="erp-td">${a.status === 'active' ? '<span class="erp-badge" data-tone="success">نشطة</span>' : '<span class="erp-badge" data-tone="neutral">مغلقة</span>'}</td><td class="erp-td erp-text-muted">${esc(String(a.date || '').slice(0, 10))}</td><td class="erp-td"><button type="button" class="erp-btn erp-btn--sm erp-btn--danger" data-v2-del="adv:${esc(String(a.id))}" aria-label="حذف السلفة"><i class="ji" data-i="trash" aria-hidden="true"></i></button></td></tr>`).join('')
                || '<tr><td class="erp-td" colspan="7">لا سلف</td></tr>')
            + `</tbody></table></div>`;

        const kinds = [['penalty', 'جزاء'], ['bonus', 'علاوة'], ['deduction', 'خصم'], ['allowance', 'بدل']];
        const adj = suite.adjustments || [];
        q('[data-v2-adj-form]').innerHTML = `<div class="erp-dash-controls">`
            + `<label class="erp-text-sm erp-text-muted">الموظف</label><select class="erp-select" data-v2-f="adjEmp" aria-label="الموظف">${empOptions()}</select>`
            + `<label class="erp-text-sm erp-text-muted">الشهر</label><input class="erp-input erp-input--ltr" data-v2-f="adjMonth" type="month" value="${curMonth()}" aria-label="شهر البند">`
            + `<label class="erp-text-sm erp-text-muted">النوع</label><select class="erp-select" data-v2-f="adjKind" aria-label="نوع البند">${kinds.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select>`
            + `<label class="erp-text-sm erp-text-muted">المبلغ</label><input class="erp-input erp-input--ltr" data-v2-f="adjAmt" type="number" step="0.01" aria-label="مبلغ البند">`
            + `<label class="erp-text-sm erp-text-muted">السبب</label><input class="erp-input" data-v2-f="adjReason" aria-label="سبب البند">`
            + `<button type="button" class="erp-btn erp-btn--primary erp-btn--sm" data-v2-adj-save>بند</button></div>`
            + `<div class="erp-text-sm" style="color:var(--erp-danger-text)" data-v2-adj-err role="alert"></div>`;
        const kindAr = { penalty: 'جزاء', bonus: 'علاوة', deduction: 'خصم', allowance: 'بدل' };
        q('[data-v2-adj-list]').innerHTML = `<div class="erp-table__scroll" tabindex="0"><table class="erp-table__grid"><thead><tr><th>الموظف</th><th>الشهر</th><th>النوع</th><th>المبلغ</th><th>السبب</th><th></th></tr></thead><tbody>`
            + (adj.slice().reverse().slice(0, 30).map((a) => `<tr><td class="erp-td"><b>${esc(empName(a.employeeId))}</b></td><td class="erp-td erp-mono" dir="ltr">${esc(a.month)}</td><td class="erp-td"><span class="erp-badge" data-tone="${a.kind === 'penalty' || a.kind === 'deduction' ? 'danger' : 'success'}">${esc(kindAr[a.kind] || a.kind)}</span></td><td class="erp-td">${money(a.amount, currency)}</td><td class="erp-td erp-text-muted">${esc(a.reason || '—')}</td><td class="erp-td"><button type="button" class="erp-btn erp-btn--sm erp-btn--danger" data-v2-del="adj:${esc(String(a.id))}" aria-label="حذف البند"><i class="ji" data-i="trash" aria-hidden="true"></i></button></td></tr>`).join('')
                || '<tr><td class="erp-td" colspan="6">لا بنود</td></tr>')
            + `</tbody></table></div>`;

        const cons = suite.contracts || [];
        q('[data-v2-con-form]').innerHTML = `<div class="erp-dash-controls">`
            + `<label class="erp-text-sm erp-text-muted">الموظف</label><select class="erp-select" data-v2-f="conEmp" aria-label="الموظف">${empOptions()}</select>`
            + `<label class="erp-text-sm erp-text-muted">من</label><input class="erp-input erp-input--ltr" data-v2-f="conFrom" type="date" value="${new Date().toISOString().slice(0, 10)}" aria-label="بداية العقد">`
            + `<label class="erp-text-sm erp-text-muted">إلى</label><input class="erp-input erp-input--ltr" data-v2-f="conTo" type="date" aria-label="نهاية العقد">`
            + `<label class="erp-text-sm erp-text-muted">الراتب التعاقدي</label><input class="erp-input erp-input--ltr" data-v2-f="conSalary" type="number" step="0.01" aria-label="الراتب التعاقدي">`
            + `<button type="button" class="erp-btn erp-btn--primary erp-btn--sm" data-v2-con-save>عقد</button></div>`
            + `<div class="erp-text-sm" style="color:var(--erp-danger-text)" data-v2-con-err role="alert"></div>`;
        q('[data-v2-con-list]').innerHTML = `<div class="erp-table__scroll" tabindex="0"><table class="erp-table__grid"><thead><tr><th>الموظف</th><th>من</th><th>إلى</th><th>الحالة</th><th></th></tr></thead><tbody>`
            + (cons.slice().sort((a, b) => String(a.end_date).localeCompare(String(b.end_date))).slice(0, 30).map((k) => {
                const left = Math.ceil((new Date(k.end_date) - new Date()) / 86400000);
                const badge = left < 0 ? '<span class="erp-badge" data-tone="danger">منتهٍ</span>'
                    : (left <= 30 ? `<span class="erp-badge" data-tone="warning">متبقٍ ${left} يوم</span>` : '<span class="erp-badge" data-tone="success">سارٍ</span>');
                return `<tr><td class="erp-td"><b>${esc(empName(k.employeeId))}</b></td><td class="erp-td erp-mono" dir="ltr">${esc(String(k.start_date || '').slice(0, 10))}</td><td class="erp-td erp-mono" dir="ltr">${esc(String(k.end_date || '').slice(0, 10))}</td><td class="erp-td">${badge}</td><td class="erp-td"><button type="button" class="erp-btn erp-btn--sm erp-btn--danger" data-v2-del="con:${esc(String(k.id))}" aria-label="حذف العقد"><i class="ji" data-i="trash" aria-hidden="true"></i></button></td></tr>`;
            }).join('') || '<tr><td class="erp-td" colspan="5">لا عقود</td></tr>')
            + `</tbody></table></div>`;

        const evs = suite.evaluations || [];
        q('[data-v2-ev-form]').innerHTML = `<div class="erp-dash-controls">`
            + `<label class="erp-text-sm erp-text-muted">الموظف</label><select class="erp-select" data-v2-f="evEmp" aria-label="الموظف">${empOptions()}</select>`
            + `<label class="erp-text-sm erp-text-muted">الفترة</label><input class="erp-input erp-input--ltr" data-v2-f="evPeriod" type="month" value="${curMonth()}" aria-label="فترة التقييم">`
            + `<label class="erp-text-sm erp-text-muted">التقييم (1-5)</label><select class="erp-select" data-v2-f="evScore" aria-label="درجة التقييم"><option>5</option><option>4</option><option>3</option><option>2</option><option>1</option></select>`
            + `<label class="erp-text-sm erp-text-muted">المقيّم</label><input class="erp-input" data-v2-f="evBy" aria-label="المقيّم">`
            + `<label class="erp-text-sm erp-text-muted">ملاحظات</label><input class="erp-input" data-v2-f="evNotes" aria-label="ملاحظات التقييم">`
            + `<button type="button" class="erp-btn erp-btn--primary erp-btn--sm" data-v2-ev-save>تقييم</button></div>`
            + `<div class="erp-text-sm" style="color:var(--erp-danger-text)" data-v2-ev-err role="alert"></div>`;
        q('[data-v2-ev-list]').innerHTML = `<div class="erp-table__scroll" tabindex="0"><table class="erp-table__grid"><thead><tr><th>الموظف</th><th>الفترة</th><th>التقييم</th><th>ملاحظات</th><th></th></tr></thead><tbody>`
            + (evs.slice().reverse().slice(0, 30).map((v) => `<tr><td class="erp-td"><b>${esc(empName(v.employeeId))}</b></td><td class="erp-td erp-mono" dir="ltr">${esc(v.period)}</td><td class="erp-td" dir="ltr">${'★'.repeat(Number(v.score) || 0)}${'☆'.repeat(5 - (Number(v.score) || 0))}</td><td class="erp-td erp-text-muted">${esc(v.notes || '—')}</td><td class="erp-td"><button type="button" class="erp-btn erp-btn--sm erp-btn--danger" data-v2-del="ev:${esc(String(v.id))}" aria-label="حذف التقييم"><i class="ji" data-i="trash" aria-hidden="true"></i></button></td></tr>`).join('')
                || '<tr><td class="erp-td" colspan="5">لا تقييمات</td></tr>')
            + `</tbody></table></div>`;
    }

    function paintKpis(tot) {
        kpisEl.innerHTML = ''
            + '<li class="erp-kpi"><div class="erp-kpi__top"><span class="erp-kpi__label">عدد المسيرات</span></div>'
            + '<div class="erp-kpi__value"><span class="erp-num" dir="ltr">' + formatInt(rows.length) + '</span></div></li>'
            + '<li class="erp-kpi"><div class="erp-kpi__top"><span class="erp-kpi__label">الصافي (إجمالي)</span></div>'
            + '<div class="erp-kpi__value">' + money(tot.net, currency) + '</div></li>'
            + '<li class="erp-kpi"><div class="erp-kpi__top"><span class="erp-kpi__label">الأساسي</span></div>'
            + '<div class="erp-kpi__value">' + money(tot.basic, currency) + '</div></li>'
            + '<li class="erp-kpi"><div class="erp-kpi__top"><span class="erp-kpi__label">الموظفون (إجمالي)</span></div>'
            + '<div class="erp-kpi__value"><span class="erp-num" dir="ltr">' + formatInt(tot.count) + '</span></div></li>';
    }

    function paint() {
        const tot = rows.reduce((a, r) => ({
            basic: a.basic + (r.basic || 0), net: a.net + (r.net || 0), count: a.count + (r.count || 0),
        }), { basic: 0, net: 0, count: 0 });
        paintKpis(tot);
        summaryEl.textContent = formatInt(rows.length) + ' مسيرة مرحّلة';
        countEl.textContent = rows.length ? '(' + formatInt(rows.length) + ')' : '';
        table.setRows(rows);
        paintRunsExtra();
    }

    async function reload() {
        if (loading) {return;}
        loading = true;
        table.setLoading(true);
        try {
            const [runs, cur] = await Promise.all([fetchPayrollRuns(), fetchCurrency().catch(() => '')]);
            if (!el.isConnected) {return;}
            currency = String(cur ?? '');
            rows = runs.map(payrollRunToRow);
            paint();
            await loadSheet();
            if (canPost) {
                suite = await fetchSuiteLists();
                if (!el.isConnected) {return;}
                paintSuite();
            }
        } catch (e) {
            if (!el.isConnected) {return;}
            rows = [];
            table.setRows([]);
            summaryEl.textContent = '';
            countEl.textContent = '';
            table.setError(e && e.message === 'UNAUTHORIZED'
                ? 'انتهت الجلسة — سجّل الدخول في النظام الحالي ثم أعد فتح الوضع الحيّ.'
                : (e && e.code === 'FORBIDDEN' ? 'لا صلاحية لعرض الرواتب — القرار للخادم وحده.'
                    : 'تعذّر تحميل مسيرات الرواتب: ' + ((e && e.message) || 'خطأ')));
        } finally {loading = false;}
    }

    async function loadSheet() {
        const month = q('[data-v2-sheet-month]')?.value || '';
        try {
            const s = await fetchPayrollSheet(month);
            if (!el.isConnected) {return;}
            sheetEmps = s.employees;
            sheetDays = s.monthDays;
            try {
                const depts = await fetchHrDepartments();
                sheetDepts = new Map((Array.isArray(depts) ? depts : []).map((d) => [String(d.code), d]));
            } catch { /* names optional */ }
            if (!el.isConnected) {return;}
            paintSheet();
            if (canPost) {paintSuite();}
        } catch (e) {
            if (!el.isConnected) {return;}
            say('تعذر تحميل الكشف: ' + ((e && e.message) || 'خطأ'));
        }
    }

    const fv = (n) => el.querySelector(`[data-v2-f="${n}"]`)?.value ?? '';
    const ferr = (n, t) => {
        const box = el.querySelector(`[data-v2-${n}-err]`);
        if (box) {box.textContent = t || '';}
        if (t) {say(t);}
    };

    async function guardSave(fn) {
        if (saving) {return;}
        saving = true;
        try {
            await fn();
            if (!el.isConnected) {return;}
            await reload();
        } catch (e) {
            if (!el.isConnected) {return;}
            say((e && e.message) || 'تعذر الحفظ');
        } finally {
            saving = false;
        }
    }

    el.addEventListener('click', (ev) => {
        if (ev.target.closest('[data-v2-print]')) {window.print(); return;}
        if (ev.target.closest('[data-v2-reload]') || ev.target.closest('[data-erp-retry]')) {reload(); return;}
        if (ev.target.closest('[data-v2-sheet-go]')) {loadSheet(); return;}
        if (ev.target.closest('[data-v2-sheet-export]')) {
            (async () => {
                // xlsx ليس محمَّلًا في v2.html (قرار السرعة في vendor.js) — يُجلب عند أول تصدير.
                const ready = await ensureXlsx();
                if (!ready || typeof window.XLSX === 'undefined') {say('مكتبة Excel غير محمّلة — حدّث الصفحة'); return;}
                const data = [['الموظف', 'القسم', 'المنصب', 'الراتب الأساسي', 'أيام الحضور', 'الصافي']];
                sheetEmps.forEach((e) => {
                    const d = sheetDepts.get(String(e.department));
                    data.push([e.name, (d && (d.name || d.name_ar)) || '', e.position || '', Number(e.salary) || 0, sheetDays.get(String(e.id)) || 0, Number(e.salary) || 0]);
                });
                const ws = window.XLSX.utils.aoa_to_sheet(data);
                const wb = window.XLSX.utils.book_new();
                window.XLSX.utils.book_append_sheet(wb, ws, 'الرواتب');
                prepareReportWorkbook(window.XLSX, wb, 'تقرير الرواتب');
                window.XLSX.writeFile(wb, `payroll_${new Date().toISOString().slice(0, 10)}.xlsx`);
                say(`تم التصدير (${formatInt(sheetEmps.length)} موظف)`);
            })();
            return;
        }
        if (ev.target.closest('[data-v2-gen-go]')) {
            (async () => {
                const m = q('[data-v2-gen-month]')?.value || '';
                if (!/^\d{4}-\d{2}$/.test(m)) {say('اختر الشهر'); return;}
                const incOt = await confirmFn('توليد مسير الرواتب؟\n\nسيُحسب الأساسي فقط (بدون أوفرتايم).\n\nاضغط "موافق" لإضافة الأوفرتايم من البصمات.\nاضغط "إلغاء" للمسير بالأساسي فقط.');
                if (!await confirmFn(`توليد مسير رواتب ${m}؟ سيُحسب الأساسي + الأوفرتايم من البصمات + العلاوات − الجزاءات − أقساط السلف.`)) {return;}
                guardSave(async () => {
                    const r = await generatePayrollRun({ month: m, includeOvertime: !!incOt });
                    say(`مسير ${m}: ${r.count} موظف — الصافي ${formatMoney(r.totals.net, currency).amount}`);
                });
            })();
            return;
        }
        if (ev.target.closest('[data-v2-ded-preview]')) {
            (async () => {
                const m = q('[data-v2-ded-month]')?.value || '';
                const skipFri = q('[data-v2-ded-fri]')?.checked === true;
                if (!/^\d{4}-\d{2}$/.test(m)) {say('اختر الشهر'); return;}
                const box = q('[data-v2-ded-body]');
                box.innerHTML = '<p class="erp-text-sm erp-text-muted">جارٍ الحساب من البصمات...</p>';
                try {
                    dedPreview = await fetchDeductionsPreview({ month: m, skipFridays: skipFri });
                    if (!el.isConnected) {return;}
                    const r = dedPreview;
                    const rowsHtml = (r.employees || []).filter((e) => e.totalDeduction > 0).map((e) => `<tr><td class="erp-td"><b>${esc(e.name)}</b></td><td class="erp-td">${money(e.salary, currency)}</td><td class="erp-td erp-num" dir="ltr">${formatInt(e.daysPresent)}</td><td class="erp-td erp-num" dir="ltr">${formatInt(e.lateMinutes)} د</td><td class="erp-td">${money(e.lateDeduction, currency)}</td><td class="erp-td erp-num" dir="ltr">${formatInt(e.absentDays)}</td><td class="erp-td">${money(e.absentDeduction, currency)}</td><td class="erp-td"><b>${money(e.totalDeduction, currency)}</b></td></tr>`).join('');
                    box.innerHTML = `<p><span class="erp-badge" data-tone="danger">تأخير: ${money(r.totals?.late, currency)}</span> `
                        + `<span class="erp-badge" data-tone="warning">غياب: ${money(r.totals?.absent, currency)}</span> `
                        + `<span class="erp-badge" data-tone="brand">الإجمالي: ${money(r.totals?.total, currency)}</span></p>`
                        + `<div class="erp-table__scroll" tabindex="0" style="max-height:320px"><table class="erp-table__grid"><thead><tr><th>الموظف</th><th>الراتب</th><th>حضور</th><th>تأخير</th><th>خصم التأخير</th><th>غياب</th><th>خصم الغياب</th><th>الإجمالي</th></tr></thead><tbody>${rowsHtml || '<tr><td class="erp-td" colspan="8">لا خصومات — كل الموظفين ملتزمون بدوامهم</td></tr>'}</tbody></table></div>`
                        + `<small class="erp-text-sm erp-text-muted">السياسة: يوم الغياب = الراتب÷30 • دقيقة التأخير = الراتب÷30÷ساعات الوردية • الإجازات المعتمدة مستثناة${r.skipFridays ? ' • الجمعة مستثناة' : ''}</small>`
                        + `<div><button type="button" class="erp-btn erp-btn--primary erp-btn--sm" data-v2-ded-apply>تطبيق الخصومات</button></div>`;
                } catch (e) {
                    if (!el.isConnected) {return;}
                    box.innerHTML = `<p class="erp-text-sm" style="color:var(--erp-danger-text)">${esc((e && e.message) || 'تعذر جلب المعاينة')}</p>`;
                }
            })();
            return;
        }
        if (ev.target.closest('[data-v2-ded-apply]')) {
            (async () => {
                if (!dedPreview?.month) {say('اعمل معاينة أولًا'); return;}
                if (!await confirmFn(`تطبيق خصومات الالتزام لشهر ${dedPreview.month}؟\nالإجمالي: ${formatMoney(dedPreview.totals?.total, currency).amount}\n\nيُستبدل أي تطبيق آلي سابق لنفس الشهر — البنود اليدوية لا تُمس.`)) {return;}
                guardSave(async () => {
                    const skipFri = q('[data-v2-ded-fri]')?.checked === true;
                    const res = await applyDeductions({ month: dedPreview.month, skipFridays: skipFri });
                    say(`تم تطبيق ${res.insertedRows} بند خصم — إجمالي ${formatMoney(res.totalAmount, currency).amount}`);
                    dedPreview = null;
                });
            })();
            return;
        }
        if (ev.target.closest('[data-v2-adv-save]')) {
            const payload = {
                employeeId: Number(fv('advEmp')), amount: parseFloat(fv('advAmt')),
                monthly_deduction: parseFloat(fv('advInst')) || 0, date: fv('advDate'),
            };
            const err = validateAdvance({ ...payload, date: payload.date });
            if (err) {ferr('adv', err); return;}
            ferr('adv', '');
            guardSave(async () => {
                await advancesApi.create({ ...payload, remaining: payload.amount, status: 'active' });
                say('تم تسجيل السلفة');
            });
            return;
        }
        if (ev.target.closest('[data-v2-adj-save]')) {
            const payload = {
                employeeId: Number(fv('adjEmp')), month: fv('adjMonth'), kind: fv('adjKind'),
                amount: parseFloat(fv('adjAmt')), reason: (fv('adjReason') || '').trim(),
            };
            const err = validateAdjustment(payload);
            if (err) {ferr('adj', err); return;}
            ferr('adj', '');
            guardSave(async () => {
                await adjustmentsApi.create(payload);
                say('تم تسجيل البند');
            });
            return;
        }
        if (ev.target.closest('[data-v2-con-save]')) {
            const payload = {
                employeeId: Number(fv('conEmp')), start_date: fv('conFrom'), end_date: fv('conTo'),
                salary: parseFloat(fv('conSalary')) || 0,
            };
            const err = validateContract(payload);
            if (err) {ferr('con', err); return;}
            ferr('con', '');
            guardSave(async () => {
                await contractsApi.create(payload);
                say('تم حفظ العقد');
            });
            return;
        }
        if (ev.target.closest('[data-v2-ev-save]')) {
            const payload = {
                employeeId: Number(fv('evEmp')), period: fv('evPeriod'), score: Number(fv('evScore')),
                notes: (fv('evNotes') || '').trim(), evaluator: (fv('evBy') || '').trim(),
            };
            const err = validateEvaluation(payload);
            if (err) {ferr('ev', err); return;}
            ferr('ev', '');
            guardSave(async () => {
                await evaluationsApi.create(payload);
                say('تم حفظ التقييم');
            });
            return;
        }
        const del = ev.target.closest('[data-v2-del]');
        if (del) {
            (async () => {
                if (!await confirmFn('حذف هذا البند؟')) {return;}
                const [kind, id] = String(del.dataset.v2Del).split(':');
                const api = kind === 'adv' ? advancesApi : (kind === 'adj' ? adjustmentsApi : (kind === 'con' ? contractsApi : evaluationsApi));
                guardSave(async () => {
                    await api.remove(id);
                    say('تم الحذف');
                });
            })();
        }
    });
    reload();
    return { el, reload, getRows: () => rows, destroy() { table.destroy(); el.remove(); } };
}
