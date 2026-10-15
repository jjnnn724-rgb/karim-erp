/**
 * V2 - HR departments screen (قراءة فقط)
 */

import { createDataTable } from '../data-display/data-table.js?v=4.9.130';
import { fetchHrDepartments, hrDeptToRow, fetchEmployees } from '../data/hr-registers-repo.js?v=4.9.130';
import { formatInt } from '../data/reports-repo.js?v=4.9.130';

const esc = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

function template() {
    return '<section class="erp-card erp-v2-hr-departments">'
        + '<div class="erp-card__head"><h3 class="erp-card__title">أقسام الموظفين <span class="erp-eyebrow" dir="ltr" lang="en">HR Departments</span> <span class="erp-text-muted erp-text-sm" data-v2-count></span></h3>'
        + '<span class="erp-grow"></span>'
        + '<button type="button" class="erp-btn erp-btn--sm" data-v2-print><i class="ji" data-i="printer" aria-hidden="true"></i><span>طباعة</span></button>'
        + '<button type="button" class="erp-btn erp-btn--primary erp-btn--sm" data-v2-reload><i class="ji" data-i="refresh" aria-hidden="true"></i><span>عرض</span></button>'
        + '</div>'
        + '<div class="erp-card__body erp-stack">'
        + '<p class="erp-text-sm erp-text-muted" data-v2-summary role="status" aria-live="polite"></p>'
        + '<p class="erp-text-sm erp-text-muted">قراءة فقط — سجل أقسام الموارد (/api/hrDepartments) + عدّ الموظفين لكل قسم.</p>'
        + '<div data-v2-table></div></div></section>';
}

export function mountHrDepartmentsScreen(host, _ctx = {}) {
    let rows = [], loading = false, counts = new Map();
    host.insertAdjacentHTML('beforeend', template());
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
    el.addEventListener('click', (ev) => {
        if (ev.target.closest('[data-v2-print]')) { window.print(); return; }
        if (ev.target.closest('[data-v2-reload]') || ev.target.closest('[data-erp-retry]')) { reload(); }
    });
    reload();
    return { el, reload, getRows: () => rows, destroy() { table.destroy(); el.remove(); } };
}
