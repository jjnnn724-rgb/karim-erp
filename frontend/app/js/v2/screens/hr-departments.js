/**
 * V2 - HR departments screen · سجل + CRUD (P1-3)
 * قراءة دائمًا؛ الكتابة خلف علم v2hrdeptwrite OFF افتراضيًا وبحمولات legacy
 * (features/hr.js:695/:717/:725 — الكود يُولَّد لاتينيًا آمنًا إن كان عربيًا).
 */

import { createDataTable } from '../data-display/data-table.js?v=4.9.147';
import { fetchHrDepartments, hrDeptToRow, fetchEmployees } from '../data/hr-registers-repo.js?v=4.9.147';
import { formatInt } from '../data/reports-repo.js?v=4.9.147';
import { canWrite } from '../session.js?v=4.9.147';
import { hrDepartmentWriteEnabled } from '../write-flags.js?v=4.9.147';
import {
    HR_DEPARTMENT_WRITE_ROLES,
    validateHrDepartmentForm, createHrDepartment, updateHrDepartment, deleteHrDepartment,
} from '../data/departments-write-repo.js?v=4.9.147';

const esc = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

function template(canManage) {
    return '<section class="erp-card erp-v2-hr-departments">'
        + '<div class="erp-card__head"><h3 class="erp-card__title">أقسام الموظفين <span class="erp-eyebrow" dir="ltr" lang="en">HR Departments</span> <span class="erp-text-muted erp-text-sm" data-v2-count></span></h3>'
        + '<span class="erp-grow"></span>'
        + (canManage ? '<button type="button" class="erp-btn erp-btn--primary erp-btn--sm" data-v2-hrd-add><i class="ji" data-i="plus" aria-hidden="true"></i><span>إضافة قسم</span></button>' : '')
        + '<button type="button" class="erp-btn erp-btn--sm" data-v2-print><i class="ji" data-i="printer" aria-hidden="true"></i><span>طباعة</span></button>'
        + '<button type="button" class="erp-btn erp-btn--primary erp-btn--sm" data-v2-reload><i class="ji" data-i="refresh" aria-hidden="true"></i><span>عرض</span></button>'
        + '</div>'
        + '<div class="erp-card__body erp-stack">'
        + '<p class="erp-text-sm erp-text-muted" data-v2-summary role="status" aria-live="polite"></p>'
        + (canManage
            ? '<p class="erp-text-sm erp-text-muted">سجل أقسام الموارد (/api/hrDepartments) + عدّ الموظفين لكل قسم. الكتابة مفعّلة لهذه الجلسة بعلم v2hrdeptwrite.</p>'
            : '<p class="erp-text-sm erp-text-muted">قراءة فقط — سجل أقسام الموارد (/api/hrDepartments) + عدّ الموظفين لكل قسم.</p>')
        + '<div data-v2-hrd-form></div>'
        + '<div data-v2-table></div></div></section>';
}

export function mountHrDepartmentsScreen(host, ctx = {}) {
    const notify = typeof ctx.notify === 'function' ? ctx.notify : (m) => console.info('[V2 hr departments]', m);
    const confirmFn = typeof ctx.confirmFn === 'function' ? ctx.confirmFn
        : (m) => (typeof window !== 'undefined' && window.confirm ? window.confirm(m) : false);
    const canManage = canWrite(ctx.role, HR_DEPARTMENT_WRITE_ROLES) && hrDepartmentWriteEnabled();

    let rows = [], loading = false, saving = false, editingDept = null, counts = new Map();
    host.insertAdjacentHTML('beforeend', template(canManage));
    const el = host.lastElementChild; const q = (s) => el.querySelector(s);
    const countEl = q('[data-v2-count]'); const summaryEl = q('[data-v2-summary]');
    const table = createDataTable({
        caption: 'أقسام الموارد البشرية - بيانات حية', mode: 'client', pageSize: 50, stickyHeader: true,
        emptyMessage: 'لا توجد أقسام', rowKey: (r) => r.id,
        columns: [
            { key: 'code', header: 'الرمز', sortable: true, filterable: true, width: '110px', className: 'erp-mono' },
            { key: 'name', header: 'اسم القسم', sortable: true, filterable: true },
            { key: 'manager', header: 'المدير', width: '150px', render: (r) => esc(r.manager) },
            { key: '_count', header: 'عدد الموظفين', type: 'number', width: '120px', align: 'end', value: (r) => r._count, render: (r) => '<span class="erp-num" dir="ltr">' + formatInt(r._count) + '</span>' },
            ...(canManage ? [{
                key: 'actions', header: 'إجراءات', width: '190px', align: 'center', className: 'erp-no-print',
                render: (r) => '<span class="erp-row-wrap">'
                    + `<button type="button" class="erp-btn erp-btn--sm erp-btn--ghost" data-v2-hrd-edit="${esc(String(r.id))}"><i class="ji" data-i="pencil" aria-hidden="true"></i><span>تعديل</span></button>`
                    + `<button type="button" class="erp-btn erp-btn--sm erp-btn--danger" data-v2-hrd-del="${esc(String(r.id))}"><i class="ji" data-i="trash" aria-hidden="true"></i><span>حذف</span></button>`
                    + '</span>',
            }] : []),
        ],
    });
    q('[data-v2-table]').appendChild(table.el);

    function paint() {
        const extRows = rows.map((r) => ({ ...r, _count: counts.get(String(r.code)) || 0 }));
        summaryEl.textContent = formatInt(extRows.length) + ' قسمًا · ' + formatInt(extRows.reduce((s, r) => s + r._count, 0)) + ' موظفًا';
        countEl.textContent = extRows.length ? '(' + formatInt(extRows.length) + ')' : '';
        table.setRows(extRows);
    }
    async function reload() {
        if (loading) { return; }
        loading = true; table.setLoading(true);
        try {
            const [deps, emps] = await Promise.all([fetchHrDepartments(), fetchEmployees().catch(() => [])]);
            if (!el.isConnected) { return; }
            rows = deps.map(hrDeptToRow);
            counts = new Map();
            (emps || []).forEach((e) => {
                if (e && e.department) {
                    const c = String(e.department);
                    counts.set(c, (counts.get(c) || 0) + 1);
                }
            });
            paint();
        } catch (e) {
            if (!el.isConnected) { return; }
            rows = []; table.setRows([]);
            summaryEl.textContent = ''; countEl.textContent = '';
            table.setError(e && e.message === 'UNAUTHORIZED'
                ? 'انتهت الجلسة — سجّل الدخول في النظام الحالي ثم أعد فتح الوضع الحيّ.'
                : (e && e.code === 'FORBIDDEN' ? 'لا صلاحية لعرض أقسام HR — القرار للخادم وحده.'
                    : 'تعذّر تحميل أقسام HR: ' + ((e && e.message) || 'خطأ')));
        } finally { loading = false; }
    }
    /* ── P1-3: كتابة أقسام HR (حمولات legacy) ──────────────────────── */
    function openHrDeptForm(row) {
        editingDept = row || null;
        const holder = q('[data-v2-hrd-form]');
        if (!holder) {return;}
        const manager = row && row.manager !== '—' ? row.manager : '';
        holder.innerHTML = `<section class="erp-card"><div class="erp-card__head">`
            + `<h4 class="erp-card__title">${row ? 'تعديل قسم — ' + esc(row.name) : 'إضافة قسم موارد بشرية'}</h4></div>`
            + `<div class="erp-card__body erp-stack"><div class="erp-dash-controls">`
            + `<label class="erp-text-sm erp-text-muted">اسم القسم<input class="erp-input" data-v2-hrd-name maxlength="150" value="${row ? esc(row.name) : ''}"></label>`
            + (row
                ? `<span class="erp-badge" data-tone="neutral">الكود: <span class="erp-mono" dir="ltr">${esc(row.code)}</span></span>`
                : '<label class="erp-text-sm erp-text-muted">الكود (لاتيني)<input class="erp-input erp-input--ltr" data-v2-hrd-code maxlength="20" value="" placeholder="HRD-…"></label>')
            + `<label class="erp-text-sm erp-text-muted">المدير<input class="erp-input" data-v2-hrd-manager maxlength="255" value="${esc(manager)}"></label>`
            + `<button type="button" class="erp-btn erp-btn--primary erp-btn--sm" data-v2-hrd-go>حفظ</button>`
            + `<button type="button" class="erp-btn erp-btn--sm" data-v2-hrd-x>إلغاء</button>`
            + `</div><div class="erp-text-sm" style="color:var(--erp-danger-text)" data-v2-hrd-err role="alert"></div>`
            + (row ? '' : '<p class="erp-text-sm erp-text-muted">الكود العربي أو الفارغ يُستبدل تلقائيًا بكود لاتيني آمن (كما في القديم) لأنه مفتاح ربط الموظفين بالقسم.</p>')
            + `</div></section>`;
        holder.scrollIntoView({ block: 'nearest' });
    }

    function closeHrDeptForm() {
        editingDept = null;
        const holder = q('[data-v2-hrd-form]');
        if (holder) {holder.innerHTML = '';}
    }

    function saveHrDept() {
        if (saving) {return;}
        const val = (n) => (q(`[data-v2-hrd-${n}]`)?.value ?? '');
        const v = validateHrDepartmentForm({
            name: val('name'), code: val('code'), manager: val('manager'),
        }, editingDept);
        const errBox = q('[data-v2-hrd-err]');
        const fail = (t) => { if (errBox) {errBox.textContent = t;} notify(t); };
        if (!v.ok) {fail(v.message); return;}
        if (!editingDept && rows.some((d) => String(d.code) === String(v.payload.code))) {
            fail('الكود موجود بالفعل');
            return;
        }
        saving = true;
        const call = editingDept ? updateHrDepartment(editingDept.id, v.payload) : createHrDepartment(v.payload);
        call.then(() => {
            if (!el.isConnected) {return;}
            notify(editingDept ? 'تم تحديث القسم' : 'تم إضافة القسم');
            closeHrDeptForm();
            reload();
        }).catch((e) => {
            if (el.isConnected) {fail((e && e.message) || 'فشل حفظ القسم في قاعدة البيانات');}
        }).finally(() => {saving = false;});
    }

    function removeHrDept(id) {
        const row = rows.find((r) => String(r.id) === String(id));
        if (!row || saving) {return;}
        if (!confirmFn(`حذف قسم الموارد «${row.name}» (${row.code})؟`)) {return;}
        saving = true;
        deleteHrDepartment(row.id).then(() => {
            if (!el.isConnected) {return;}
            notify('تم حذف القسم');
            reload();
        }).catch((e) => {
            if (el.isConnected) {notify((e && e.message) || 'فشل حذف القسم من قاعدة البيانات');}
        }).finally(() => {saving = false;});
    }

    el.addEventListener('click', (ev) => {
        if (ev.target.closest('[data-v2-print]')) { window.print(); return; }
        if (ev.target.closest('[data-v2-reload]') || ev.target.closest('[data-erp-retry]')) { reload(); return; }
        if (ev.target.closest('[data-v2-hrd-add]')) { openHrDeptForm(null); return; }
        const editBtn = ev.target.closest('[data-v2-hrd-edit]');
        if (editBtn) {
            const row = rows.find((r) => String(r.id) === String(editBtn.dataset.v2HrdEdit));
            if (row) { openHrDeptForm(row); }
            return;
        }
        const delBtn = ev.target.closest('[data-v2-hrd-del]');
        if (delBtn) { removeHrDept(delBtn.dataset.v2HrdDel); return; }
        if (ev.target.closest('[data-v2-hrd-x]')) { closeHrDeptForm(); return; }
        if (ev.target.closest('[data-v2-hrd-go]')) { saveHrDept(); }
    });
    reload();
    return { el, reload, getRows: () => rows, destroy() { table.destroy(); el.remove(); } };
}
