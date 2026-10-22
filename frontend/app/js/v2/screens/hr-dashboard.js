/**
 * V2 — HR dashboard screen · شاشة 12 في سجل الترحيل (قراءة فقط)
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Same per-screen contract as 01-11: read-only by construction, one
 * composing door (v2/data/hr-dashboard-repo.js — no new endpoint, the
 * same four sources the legacy HR dashboard reads), delegated listeners
 * on a per-mount root, loading guards, isConnected checks, destroy() on
 * nav. Charts (department mix + weekly attendance) are drawn by
 * js/v2/charts.js as SVG — no chart library, no CSP change. The weekly
 * window is the same seven days the repo now fetches; today's KPI still
 * counts only today.
 * Quick links navigate to migrated HR screens only (employees/attendance/leaves).
 */

import { createDataTable } from '../data-display/data-table.js?v=4.9.194';
import { statusBadge } from '../status.js?v=4.9.194';
import { donutChart, lineChart } from '../charts.js?v=4.9.194';
import {
    fetchHrSnapshot, buildHrKpis, pendingLeaveRows,
    departmentDistribution, weeklyAttendance,
} from '../data/hr-dashboard-repo.js?v=4.9.194';
import { employeeMap } from '../data/employees-repo.js?v=4.9.194';

const esc = (v) => String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

function kpiStrip(kpis) {
    return `<ul class="erp-kpis" aria-label="مؤشرات الموارد — محسوبة على سجلات اليوم">`
        + kpis.map((k) => `
      <li class="erp-kpi">
        <div class="erp-kpi__top">
          <span class="erp-kpi__icon" aria-hidden="true"><i class="ji" data-i="${esc(k.icon)}"></i></span>
          <span class="erp-kpi__label">${esc(k.label)}<span class="erp-eyebrow" dir="ltr" lang="en">${esc(k.en)}</span></span>
        </div>
        <div class="erp-kpi__value"><span class="erp-num" dir="ltr">${esc(k.value)}</span>${k.unit ? ` <span class="erp-kpi__unit">${esc(k.unit)}</span>` : ''}</div>
        <div class="erp-kpi__foot"><span class="erp-kpi__hint">${esc(k.hint)}</span></div>
      </li>`).join('')
        + `</ul>`;
}

function template(_day) {
    return `
      <div class="erp-v2-hrdash-root">
      <section class="erp-card erp-v2-hrdash">
        <div class="erp-card__head">
          <h3 class="erp-card__title">لوحة الموارد البشرية
            <span class="erp-eyebrow" dir="ltr" lang="en">HR Overview</span>
          </h3>
          <span class="erp-grow"></span>
          <span class="erp-text-sm erp-text-muted" data-v2-day></span>
          <button type="button" class="erp-btn erp-btn--primary erp-btn--sm" data-v2-reload>
            <i class="ji" data-i="refresh" aria-hidden="true"></i><span>تحديث</span>
          </button>
        </div>
        <div class="erp-card__body erp-stack">
          <div data-v2-kpis></div>
          <div class="erp-row-wrap" data-v2-links>
            <button type="button" class="erp-btn erp-btn--sm" data-v2-go="employees">
              <i class="ji" data-i="users" aria-hidden="true"></i><span>الموظفون</span>
            </button>
            <button type="button" class="erp-btn erp-btn--sm" data-v2-go="attendance">
              <i class="ji" data-i="clock" aria-hidden="true"></i><span>الحضور</span>
            </button>
            <button type="button" class="erp-btn erp-btn--sm" data-v2-go="leaves">
              <i class="ji" data-i="calendar" aria-hidden="true"></i><span>الإجازات</span>
            </button>
          </div>
          <div class="erp-v2-chart-grid" data-v2-charts></div>
          <div class="erp-error" data-v2-failures role="alert" hidden></div>
        </div>
      </section>
      <section class="erp-card" style="margin-block-start:var(--erp-space-4)">
        <div class="erp-card__head">
          <h3 class="erp-card__title">بانتظار الاعتماد
            <span class="erp-eyebrow" dir="ltr" lang="en">Pending Leaves</span>
            <span class="erp-text-muted erp-text-sm" data-v2-count></span>
          </h3>
        </div>
        <div class="erp-card__body">
          <div data-v2-table></div>
        </div>
      </section>
      </div>`;
}

/**
 * @param {ParentNode} host where the screen is inserted
 * @param {{role?: string|null, notify?: Function, navigate?: (key:string)=>void}} [ctx]
 * @returns {{el: HTMLElement, reload: ()=>Promise<void>, getRows: ()=>any[], destroy: ()=>void}}
 */
export function mountHrDashboardScreen(host, ctx = {}) {
    const navigate = typeof ctx.navigate === 'function' ? ctx.navigate : () => {};

    let pending = [];
    let loading = false;

    host.insertAdjacentHTML('beforeend', template());
    const el = host.lastElementChild;
    const q = (sel) => el.querySelector(sel);
    const kpisHost = q('[data-v2-kpis]');
    const chartsEl = q('[data-v2-charts]');
    const countEl = q('[data-v2-count]');
    const failuresBox = q('[data-v2-failures]');

    const table = createDataTable({
        caption: 'إجازات بانتظار الاعتماد — بيانات حية',
        mode: 'client',
        pageSize: 6,
        stickyHeader: true,
        emptyMessage: 'لا طلبات معلقة',
        emptyHint: 'كل الطلبات محسومة.',
        rowKey: (row) => row.id,
        columns: [
            { key: 'employee', header: 'الموظف', sortable: true, filterable: true },
            {
                key: 'start', header: 'الفترة', width: '220px',
                render: (row) => `<span class="erp-num" dir="ltr">${esc(row.start)}</span> ← <span class="erp-num" dir="ltr">${esc(row.end)}</span>`,
            },
            {
                key: 'status', header: 'الحالة', width: '150px',
                render: () => statusBadge('leave', 'pending'),
            },
        ],
    });

    q('[data-v2-table]').appendChild(table.el);

    async function reload() {
        if (loading) {return;}
        loading = true;
        table.setLoading(true);
        try {
            const snap = await fetchHrSnapshot();
            if (!el.isConnected) {return;}          // destroyed while in flight
            kpisHost.innerHTML = kpiStrip(buildHrKpis(snap));
            const week = weeklyAttendance(snap.attendance, snap.day);
            chartsEl.innerHTML = [
                donutChart({
                    title: 'توزيع الموظفين حسب القسم',
                    ariaLabel: 'رسم دائري لعدد الموظفين في كل قسم',
                    slices: departmentDistribution(snap.employees, snap.departments),
                    centerLabel: 'موظف',
                    emptyText: 'لا موظفين مسجلين',
                }),
                lineChart({
                    title: 'الحضور آخر 7 أيام',
                    ariaLabel: 'خط عدد الحاضرين في كل يوم من آخر سبعة أيام',
                    labels: week.map((d) => d.date.slice(5)),
                    series: [{ label: 'الحاضرون', tone: 'brand', values: week.map((d) => d.present), fill: true }],
                    emptyText: 'لا حضور مسجل في آخر 7 أيام',
                }),
            ].join('');
            q('[data-v2-day]').textContent = snap.day || '';
            pending = pendingLeaveRows(snap.leaves, employeeMap(snap.employees));
            table.setRows(pending);
            countEl.textContent = pending.length ? `(${pending.length})` : '';
            if (snap.failures.length) {
                failuresBox.hidden = false;
                failuresBox.textContent = `مصادر لم تستجب: ${snap.failures.join(' · ')}`;
            } else {
                failuresBox.hidden = true;
                failuresBox.textContent = '';
            }
        } catch (e) {
            if (!el.isConnected) {return;}
            pending = [];
            table.setRows([]);
            kpisHost.innerHTML = '';
            chartsEl.innerHTML = '';
            countEl.textContent = '';
            table.setError(e && e.message === 'UNAUTHORIZED'
                ? 'انتهت الجلسة — سجّل الدخول في النظام الحالي ثم أعد فتح الوضع الحيّ.'
                : (e && e.code === 'FORBIDDEN'
                    ? 'لا صلاحية للوحة الموارد بهذا الحساب — القرار للخادم وحده.'
                    : `تعذّر تحميل اللوحة: ${(e && e.message) || 'خطأ'}`));
        } finally {
            loading = false;
        }
    }

    el.addEventListener('click', (event) => {
        const go = event.target.closest('[data-v2-go]');
        if (go) {navigate(go.dataset.v2Go); return;}
        if (event.target.closest('[data-v2-reload]')) {reload(); return;}
        if (event.target.closest('[data-erp-retry]')) {reload();}
    });

    reload();

    return {
        el,
        reload,
        getRows: () => pending,
        destroy() {
            table.destroy();
            el.remove();
        },
    };
}
