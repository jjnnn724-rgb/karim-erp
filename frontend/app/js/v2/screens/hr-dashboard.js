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

import { createDataTable } from '../data-display/data-table.js?v=4.9.180';
import { statusBadge } from '../status.js?v=4.9.180';
import { donutChart, lineChart } from '../charts.js?v=4.9.180';
import { openInAppReport } from '../report-viewer.js?v=4.9.180';
import {
    fetchHrSnapshot, buildHrKpis, pendingLeaveRows,
    departmentDistribution, weeklyAttendance,
} from '../data/hr-dashboard-repo.js?v=4.9.180';
import { employeeMap } from '../data/employees-repo.js?v=4.9.180';
import { kpiStrip } from '../role-dash-parts.js?v=4.9.180';

const esc = (v) => String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/* kpiStrip مشترك الآن في role-dash-parts.js — نسخة واحدة للنظام. */

function template(_day) {
    return `
      <div class="erp-v2-hrdash-root">
      <div class="erp-dash-head">
        <div>
          <h2 class="erp-dash-title">لوحة الموارد البشرية
            <span class="erp-eyebrow" dir="ltr" lang="en">HR Overview</span>
          </h2>
          <div class="erp-dash-sub" data-v2-day role="status" aria-live="polite"></div>
        </div>
        <div class="erp-dash-controls">
          <button type="button" class="erp-btn erp-btn--sm" data-v2-print>
            <i class="ji" data-i="printer" aria-hidden="true"></i><span>طباعة</span>
          </button>
          <button type="button" class="erp-btn erp-btn--primary erp-btn--sm" data-v2-reload>
            <i class="ji" data-i="refresh" aria-hidden="true"></i><span>تحديث</span>
          </button>
        </div>
      </div>
      <section class="erp-card erp-v2-hrdash">
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
            <button type="button" class="erp-btn erp-btn--sm" data-v2-go="payroll">
              <i class="ji" data-i="banknote" aria-hidden="true"></i><span>الرواتب</span>
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
    const notify = typeof ctx.notify === 'function' ? ctx.notify : (m) => console.info('[V2 hr dashboard]', m);

    let pending = [];
    let loading = false;
    let lastSnap = null;                    // آخر لقطة ناجحة — لطباعة التقرير

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
            lastSnap = snap;
            kpisHost.innerHTML = kpiStrip(buildHrKpis(snap), 'مؤشرات الموارد — محسوبة على سجلات اليوم');
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

    /** تقرير مطبوع للّقطة: المؤشرات + توزيع الأقسام + المعلّق — بدل
        window.print() الخام (نفس قاعدة الشاشات المالية). */
    function printSnapshot() {
        if (!lastSnap) {notify('لا لقطة مطبوعة بعد — اضغط تحديث أولًا'); return;}
        const kpis = buildHrKpis(lastSnap);
        const dist = departmentDistribution(lastSnap.employees, lastSnap.departments)
            .filter((d) => (d.value || 0) > 0);
        const w = openInAppReport('لوحة الموارد البشرية');
        w.document.write('<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="UTF-8"><title>لوحة الموارد البشرية</title></head><body style="font-family:\'Cairo\',Tahoma,Arial,sans-serif;padding:24px">جارٍ تجهيز التقرير…</body></html>');
        const kpiCells = kpis.map((k) => `<div><span>${esc(k.label)}</span><b>${esc(String(k.value))}${k.unit ? ' ' + esc(k.unit) : ''}</b></div>`).join('');
        const distRows = dist.map((d, i) => `<tr><td>${i + 1}</td><td style="text-align:right">${esc(d.label || '—')}</td><td>${esc(String(d.value || 0))}</td></tr>`).join('');
        const pendingRows = pending.map((r, i) => `<tr><td>${i + 1}</td><td style="text-align:right">${esc(r.employee || '—')}</td><td dir="ltr">${esc(r.start || '—')} ← ${esc(r.end || '—')}</td></tr>`).join('');
        const dateStr = new Date().toLocaleString('ar-EG');
        w.document.open();
        w.document.write(`<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="UTF-8"><title>لوحة الموارد البشرية</title>`
            + '<style>body{font-family:\'Cairo\',Tahoma,Arial,sans-serif;color:#111;background:#fff;margin:0;padding:28px;direction:rtl}'
            + '.sheet{max-width:900px;margin:auto}.head{text-align:center;border-bottom:3px solid #b45309;padding-bottom:14px;margin-bottom:16px}'
            + '.head h1{margin:0 0 6px;color:#b45309;font-size:22px}.head p{margin:3px 0;color:#555;font-size:13px}'
            + '.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:8px;margin-bottom:16px}'
            + '.kpis div{border:1px solid #ddd;border-radius:8px;padding:9px;text-align:center}.kpis b{display:block;font-size:16px;color:#7c3500}'
            + '.kpis span{font-size:11px;color:#555}'
            + 'h2{font-size:14px;color:#7c3500;border-bottom:2px solid #f7ead8;padding-bottom:5px;margin:16px 0 8px}'
            + 'table{width:100%;border-collapse:collapse;margin-bottom:10px}th,td{border:1px solid #ccc;padding:7px;text-align:right;font-size:12px}'
            + 'th{background:#f7ead8;color:#7c3500}'
            + '.controls{text-align:center;margin-bottom:18px}.controls button{border:0;border-radius:7px;padding:10px 24px;margin:0 5px;font:inherit;cursor:pointer;background:#b45309;color:#fff}'
            + '.controls button.secondary{background:#555}'
            + '@media print{body{padding:0}.controls{display:none!important}@page{size:A4;margin:12mm}}</style></head><body>'
            + '<div class="controls"><button type="button" data-hr-print>طباعة</button><button type="button" class="secondary" data-hr-close>إغلاق</button></div>'
            + `<main class="sheet"><header class="head"><h1>لوحة الموارد البشرية</h1>`
            + `<p>بيانات ${esc(lastSnap.day || '')} — تاريخ التقرير: ${esc(dateStr)}</p></header>`
            + `<section class="kpis">${kpiCells}</section>`
            + '<h2>توزيع الموظفين حسب القسم</h2>'
            + '<table><thead><tr><th>#</th><th>القسم</th><th>الموظفون</th></tr></thead>'
            + `<tbody>${distRows || '<tr><td colspan="3">لا أقسام</td></tr>'}</tbody></table>`
            + '<h2>إجازات بانتظار الاعتماد</h2>'
            + '<table><thead><tr><th>#</th><th>الموظف</th><th>الفترة</th></tr></thead>'
            + `<tbody>${pendingRows || '<tr><td colspan="3">لا طلبات معلقة</td></tr>'}</tbody></table>`
            + '</main></body></html>');
        w.document.close();
        w.document.querySelector('[data-hr-print]')?.addEventListener('click', () => w.print());
        w.document.querySelector('[data-hr-close]')?.addEventListener('click', () => w.close());
        w.focus();
    }

    el.addEventListener('click', (event) => {
        const go = event.target.closest('[data-v2-go]');
        if (go) {navigate(go.dataset.v2Go); return;}
        if (event.target.closest('[data-v2-print]')) {printSnapshot(); return;}
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
