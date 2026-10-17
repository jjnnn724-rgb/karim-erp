/**
 * V2 — Dept employees screen · شاشة في سجل الترحيل (قراءة + دورة كتابة كاملة)
 * ═══════════════════════════════════════════════════════════════════════
 * Same per-screen contract as 02/05: read register + explicit write cycle
 * (add/edit/deactivate) for dept_head only. The server re-checks the scope
 * and role on every call; the screen mirrors its validation verbatim so a
 * local refusal says the same sentence the server would.
 *
 * SAFE FIELDS ONLY: name / employeeId / position / phone — salary, status,
 * department and accounts belong to hr/admin (legacy header, verbatim).
 */

import { createDataTable } from '../data-display/data-table.js?v=4.9.149';
import { statusBadge } from '../status.js?v=4.9.149';
import { canWrite } from '../session.js?v=4.9.149';
import { formatInt } from '../data/reports-repo.js?v=4.9.149';
import {
    fetchDeptEmployees, deptEmpToRow, deptScopeLabel, validateDeptEmpForm,
    DEPT_EMP_WRITE_ROLES, createDeptEmployee, updateDeptEmployee, deactivateDeptEmployee,
} from '../data/dept-employees-repo.js?v=4.9.149';

const esc = (v) => String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

function kpiStrip(kpis) {
    return `<ul class="erp-kpis" aria-label="مؤشرات موظفي القسم">`
        + kpis.map((k) => `
      <li class="erp-kpi">
        <div class="erp-kpi__top">
          <span class="erp-kpi__icon" aria-hidden="true"><i class="ji" data-i="${esc(k.icon)}"></i></span>
          <span class="erp-kpi__label">${esc(k.label)}<span class="erp-eyebrow" dir="ltr" lang="en">${esc(k.en)}</span></span>
        </div>
        <div class="erp-kpi__value"><span class="erp-num" dir="ltr">${esc(k.value)}</span></div>
        <div class="erp-kpi__foot"><span class="erp-kpi__hint">${esc(k.hint)}</span></div>
      </li>`).join('')
        + `</ul>`;
}

function template(writable) {
    return `
      <div class="erp-v2-deptemp">
        <div class="erp-dash-head">
          <div>
            <h2 class="erp-dash-title">موظفو القسم
              <span class="erp-eyebrow" dir="ltr" lang="en">Department Staff</span>
            </h2>
            <div class="erp-dash-sub" data-v2-scope-line role="status" aria-live="polite"></div>
          </div>
          <div class="erp-dash-controls">
            <button type="button" class="erp-btn erp-btn--sm erp-no-print" data-v2-print aria-label="طباعة">
              <i class="ji" data-i="printer" aria-hidden="true"></i><span>طباعة</span>
            </button>
            ${writable ? `<button type="button" class="erp-btn erp-btn--primary erp-btn--sm erp-no-print" data-v2-add>
              <i class="ji" data-i="plus" aria-hidden="true"></i><span>إضافة موظف</span>
            </button>` : ''}
            <button type="button" class="erp-btn erp-btn--primary erp-btn--sm erp-no-print" data-v2-reload aria-label="تحديث">
              <i class="ji" data-i="refresh" aria-hidden="true"></i><span>تحديث</span>
            </button>
          </div>
        </div>

        <div data-v2-kpis></div>

        <section class="erp-card">
          <div class="erp-card__head">
            <h3 class="erp-card__title">دليل القسم
              <span class="erp-eyebrow" dir="ltr" lang="en">Register</span>
              <span class="erp-text-muted erp-text-sm" data-v2-count></span>
            </h3>
          </div>
          <div class="erp-card__body erp-stack">
            <p class="erp-text-sm erp-text-muted">
              قراءة وكتابة من وجه الخادم الحالي
              (<span class="erp-addr" dir="ltr">/api/hr/dept-employees</span>) —
              نطاقك أقسامك حصرًا بقرار من الخادم. حقولك الآمنة: الاسم والوظيفة
              والهاتف؛ الراتب والحالة والقسم والحسابات صلاحيات الموارد البشرية.
              التعطيل آمن يحفظ التاريخ — الحذف النهائي ليس هنا.
            </p>
            <p class="erp-text-sm erp-text-muted" data-v2-filter-note hidden></p>
            <div data-v2-table></div>
          </div>
        </section>

        <div class="erp-emp-panel" data-v2-panel hidden>
          <div class="erp-emp-panel__head">
            <h3 class="erp-emp-panel__title" data-v2-panel-title></h3>
            <span class="erp-grow"></span>
            <button type="button" class="erp-btn erp-btn--sm erp-btn--ghost erp-no-print" data-v2-panel-close>
              <i class="ji" data-i="x" aria-hidden="true"></i><span>إغلاق</span>
            </button>
          </div>
          <div class="erp-emp-panel__body">
            <form data-v2-form novalidate>
              <div class="erp-emp-field">
                <label for="v2de-name">الاسم <b aria-hidden="true" style="color:var(--erp-danger-text)">*</b></label>
                <input class="erp-input" id="v2de-name" name="name" required maxlength="255" autocomplete="off">
              </div>
              <div class="erp-emp-field">
                <label for="v2de-id">الرقم الوظيفي <b aria-hidden="true" style="color:var(--erp-danger-text)">*</b></label>
                <input class="erp-input erp-input--ltr" id="v2de-id" name="employeeId" required maxlength="50"
                       autocomplete="off" data-v2-empid>
              </div>
              <div class="erp-emp-field">
                <label for="v2de-pos">الوظيفة</label>
                <input class="erp-input" id="v2de-pos" name="position" maxlength="255" autocomplete="off">
              </div>
              <div class="erp-emp-field">
                <label for="v2de-phone">الهاتف</label>
                <input class="erp-input erp-input--ltr" id="v2de-phone" name="phone" maxlength="50" inputmode="tel" autocomplete="off">
              </div>
              <div class="erp-error" data-v2-form-error role="alert" hidden></div>
              <div class="erp-emp-actions erp-no-print">
                <button type="submit" class="erp-btn erp-btn--primary erp-btn--sm" data-v2-save>
                  <i class="ji" data-i="save" aria-hidden="true"></i><span data-v2-save-label>حفظ</span>
                </button>
                <button type="button" class="erp-btn erp-btn--sm" data-v2-panel-close>إلغاء</button>
              </div>
            </form>
          </div>
        </div>
      </div>`;
}

/**
 * @param {ParentNode} host where the screen is inserted
 * @param {{role?: string|null, notify?: (message:string, kind?:string)=>void, confirmFn?: (m:string)=>boolean}} [ctx]
 * @returns {{el: HTMLElement, reload: ()=>Promise<void>, getRows: ()=>any[], destroy: ()=>void}}
 */
export function mountDeptEmployeesScreen(host, ctx = {}) {
    const notify = typeof ctx.notify === 'function' ? ctx.notify : (m) => console.info('[V2 dept-employees]', m);
    const confirmFn = typeof ctx.confirmFn === 'function' ? ctx.confirmFn
        : (m) => (typeof window !== 'undefined' && window.confirm ? window.confirm(m) : false);
    const writable = canWrite(ctx.role, DEPT_EMP_WRITE_ROLES);

    let allRows = [];
    let depts = [];
    let loading = false;
    let saving = false;
    let panelRow = null;   // null = إضافة، صف = تعديل

    host.insertAdjacentHTML('beforeend', template(writable));
    const el = host.lastElementChild;
    const q = (sel) => el.querySelector(sel);
    const scopeLine = q('[data-v2-scope-line]');
    const kpisHost = q('[data-v2-kpis]');
    const countEl = q('[data-v2-count]');
    const filterNote = q('[data-v2-filter-note]');
    const panelEl = q('[data-v2-panel]');
    const formEl = q('[data-v2-form]');
    const formError = q('[data-v2-form-error]');

    const table = createDataTable({
        caption: 'موظفو القسم — بيانات حية',
        mode: 'client',
        pageSize: 50,
        stickyHeader: true,
        emptyMessage: 'لا يوجد موظفون في قسمك بعد',
        emptyHint: writable ? 'أضف أول موظف من الزر الأعلى.' : 'راجع الإدارة لربط حسابك بقسم.',
        rowKey: (row) => row.id,
        columns: [
            {
                key: 'name', header: 'الموظف', sortable: true, filterable: true,
                render: (row) => `${esc(row.name)}<span class="erp-mini__sub erp-mono" dir="ltr">${esc(row.employeeId)}</span>`,
            },
            { key: 'position', header: 'الوظيفة', sortable: true, filterable: true,
                render: (row) => (row.position !== '—' ? esc(row.position) : `<span class="erp-text-muted">—</span>`) },
            {
                key: 'phone', header: 'الهاتف', width: '170px', className: 'erp-mono',
                render: (row) => (row.phone !== '—'
                    ? `<span class="erp-num" dir="ltr">${esc(row.phone)}</span>`
                    : `<span class="erp-text-muted">—</span>`),
            },
            {
                key: 'status', header: 'الحالة', sortable: true, width: '130px',
                render: (row) => statusBadge('employees', row.status || 'active'),
            },
            ...(writable ? [{
                key: 'actions', header: 'إجراءات', width: '190px', align: 'end',
                value: () => '',
                render: (row) => `<span class="erp-row-wrap">
                    <button type="button" class="erp-btn erp-btn--sm" data-v2-edit="${esc(row.id)}" aria-label="تعديل ${esc(row.name)}">
                      <i class="ji" data-i="pencil" aria-hidden="true"></i><span>تعديل</span>
                    </button>
                    <button type="button" class="erp-btn erp-btn--sm erp-btn--danger" data-v2-deactivate="${esc(row.id)}" aria-label="تعطيل ${esc(row.name)}">
                      <i class="ji" data-i="x-circle" aria-hidden="true"></i><span>تعطيل</span>
                    </button>
                  </span>`,
            }] : []),
        ],
    });

    q('[data-v2-table]').appendChild(table.el);

    function paint() {
        scopeLine.textContent = depts.length ? `قسمك: ${deptScopeLabel(depts)}` : '';
        kpisHost.innerHTML = kpiStrip([
            { icon: 'users', label: 'موظفو القسم', en: 'Staff', value: formatInt(allRows.length), hint: 'نطاق أقسامك حصرًا — قرار الخادم' },
            {
                icon: 'user-check', label: 'بعدهم وظيفة', en: 'Positioned',
                value: formatInt(allRows.filter((r) => r.position !== '—').length),
                hint: 'الوظيفة حقولك الآمنة',
            },
            {
                icon: 'phone', label: 'بهاتف مسجل', en: 'With Phone',
                value: formatInt(allRows.filter((r) => r.phone !== '—').length),
                hint: 'للتواصل التشغيلي',
            },
        ]);
        table.setRows(allRows);
        countEl.textContent = allRows.length ? `(${formatInt(allRows.length)})` : '';
        filterNote.hidden = true;
    }

    /* ── اللوحة (نفس نمط 02): إضافة أو تعديل ──────────────────────────── */
    function openPanel(row) {
        panelRow = row || null;
        q('[data-v2-panel-title]').textContent = row ? `تعديل: ${row.name}` : 'إضافة موظف جديد للقسم';
        formEl.elements.name.value = row ? row.name : '';
        const idInput = formEl.elements.employeeId;
        idInput.value = row ? row.employeeId : '';
        idInput.readOnly = !!row;   // الخادم يقفل الرقم الوظيفي عند التعديل
        formEl.elements.position.value = row && row.position !== '—' ? row.position : '';
        formEl.elements.phone.value = row && row.phone !== '—' ? row.phone : '';
        formError.hidden = true;
        formError.textContent = '';
        panelEl.hidden = false;
        formEl.elements.name.focus();
    }

    function closePanel() {
        panelEl.hidden = true;
        panelRow = null;
    }

    async function savePanel() {
        if (saving) {return;}
        const f = {
            name: formEl.elements.name.value,
            employeeId: formEl.elements.employeeId.value,
            position: formEl.elements.position.value,
            phone: formEl.elements.phone.value,
        };
        const v = validateDeptEmpForm(f);
        if (!v.ok) {
            formError.hidden = false;
            formError.textContent = v.errors.join(' · ');
            return;
        }
        saving = true;
        const btn = q('[data-v2-save]');
        if (btn) {btn.disabled = true;}
        try {
            if (panelRow) {await updateDeptEmployee(panelRow.id, f);}
            else {await createDeptEmployee(f);}
            if (!el.isConnected) {return;}
            notify(panelRow ? 'تم تعديل بيانات الموظف' : 'تمت إضافة الموظف للقسم', 'success');
            closePanel();
            await reload();
        } catch (e) {
            if (!el.isConnected) {return;}
            formError.hidden = false;
            formError.textContent = (e && e.message) || 'فشل الحفظ';
        } finally {
            saving = false;
            if (btn) {btn.disabled = false;}
        }
    }

    async function deactivate(row) {
        if (!confirmFn(`تعطيل الموظف «${row.name}»؟ سيختفي من القسم (سجلاته التاريخية تبقى محفوظة).`)) {return;}
        saving = true;
        try {
            await deactivateDeptEmployee(row.id);
            if (!el.isConnected) {return;}
            notify('تم تعطيل الموظف', 'success');
            await reload();
        } catch (e) {
            if (!el.isConnected) {return;}
            notify(`فشل التعطيل: ${(e && e.message) || 'خطأ'}`, 'error');
        } finally {
            saving = false;
        }
    }

    async function reload() {
        if (loading) {return;}
        loading = true;
        table.setLoading(true);
        try {
            const d = await fetchDeptEmployees();
            if (!el.isConnected) {return;}          // destroyed while in flight
            depts = d.depts;
            allRows = d.employees.map(deptEmpToRow);
            paint();
        } catch (e) {
            if (!el.isConnected) {return;}
            allRows = [];
            depts = [];
            table.setRows([]);
            kpisHost.innerHTML = '';
            countEl.textContent = '';
            table.setError(e && e.message === 'UNAUTHORIZED'
                ? 'انتهت الجلسة — سجّل الدخول في النظام الحالي ثم أعد فتح الوضع الحيّ.'
                : (e && e.code === 'FORBIDDEN'
                    ? 'لا صلاحية لعرض موظفي القسم بهذا الحساب — القرار للخادم وحده.'
                    : `تعذّر تحميل موظفي القسم: ${(e && e.message) || 'خطأ'}`));
        } finally {
            loading = false;
        }
    }

    el.addEventListener('click', (event) => {
        const editBtn = event.target.closest('[data-v2-edit]');
        if (editBtn) {
            const row = allRows.find((r) => String(r.id) === String(editBtn.dataset.v2Edit));
            if (row) {openPanel(row);}
            return;
        }
        const deactBtn = event.target.closest('[data-v2-deactivate]');
        if (deactBtn) {
            const row = allRows.find((r) => String(r.id) === String(deactBtn.dataset.v2Deactivate));
            if (row) {deactivate(row);}
            return;
        }
        if (event.target.closest('[data-v2-add]')) {openPanel(null); return;}
        if (event.target.closest('[data-v2-panel-close]')) {closePanel(); return;}
        if (event.target.closest('[data-v2-reload]')) {reload(); return;}
        if (event.target.closest('[data-v2-print]')) {window.print(); return;}
        if (event.target.closest('[data-erp-retry]')) {reload();}
    });
    formEl.addEventListener('submit', (event) => {
        event.preventDefault();
        savePanel();
    });

    reload();

    return {
        el,
        reload,
        getRows: () => allRows,
        destroy() {
            table.destroy();
            el.remove();
        },
    };
}
