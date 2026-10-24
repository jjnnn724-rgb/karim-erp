/**
 * V2 — Department-head dashboard · لوحة رئيس القسم (P2-7، قراءة فقط)
 * ═══════════════════════════════════════════════════════════════════════
 *
 * The live replacement for features/kitchen.js:230 renderDeptHeadDashboard.
 * Two doors, both already read by the legacy panel:
 *   • /warehouse/dept-panel — the server scopes it to the account's own
 *     department (Task 28), returns expenses by source and sub-departments.
 *   • /dispatches — filtered client-side by the account's own dept codes
 *     (rowDeptMatches, the same mirror the dispatch screen uses).
 *
 * The department is never chosen by this screen: the server decides the
 * panel scope, and the row filter only narrows what the server already sent.
 * Read-only: creating a request and every decision stay on the dispatch
 * screen, with its signatures and server gates.
 */

import { donutChart } from '../charts.js?v=4.9.156';
import { statusBadge } from '../status.js?v=4.9.156';
import { fetchDeptHeadSnapshot, buildDeptHeadView } from '../data/dashboard-repo.js?v=4.9.156';
import { esc, money, moneyText, int, kpiStrip, miniList, failureBox } from '../role-dash-parts.js?v=4.9.156';

function template() {
    return `
      <div class="erp-v2-role-dash">
      <section class="erp-card erp-v2-deptdash">
        <div class="erp-card__head">
          <h3 class="erp-card__title">لوحة رئيس القسم
            <span class="erp-eyebrow" dir="ltr" lang="en">Department Overview</span>
            <span class="erp-text-muted erp-text-sm" data-v2-dept></span>
          </h3>
          <span class="erp-grow"></span>
          <span class="erp-text-sm erp-text-muted" data-v2-cost></span>
          <button type="button" class="erp-btn erp-btn--primary erp-btn--sm" data-v2-reload>
            <i class="ji" data-i="refresh" aria-hidden="true"></i><span>تحديث</span>
          </button>
        </div>
        <div class="erp-card__body erp-stack">
          <p class="erp-text-sm erp-text-muted" data-v2-note role="status" aria-live="polite">
            سلسلة الاعتماد: قسمك ينشئ الطلب ← الشيف العمومي يعتمده ← المخازن تصرف ← قسمك يستلم من مخزنه.
          </p>
          <div data-v2-kpis></div>
          <div class="erp-row-wrap" data-v2-links>
            <button type="button" class="erp-btn erp-btn--sm" data-v2-go="dispatch">
              <i class="ji" data-i="clipboard-list" aria-hidden="true"></i><span>أذونات القسم</span>
            </button>
          </div>
          <div class="erp-v2-chart-grid" data-v2-charts></div>
          <div data-v2-failures></div>
        </div>
      </section>
      <div class="erp-dash-grid" style="margin-block-start:var(--erp-space-4)">
        <section class="erp-card">
          <div class="erp-card__head">
            <h3 class="erp-card__title">مصروفات القسم حسب المصدر
              <span class="erp-eyebrow" dir="ltr" lang="en">Expenses by Source</span>
            </h3>
          </div>
          <div class="erp-card__body">
            <div data-v2-sources></div>
            <div data-v2-subs style="margin-block-start:var(--erp-space-4)"></div>
          </div>
        </section>
        <section class="erp-card">
          <div class="erp-card__head">
            <h3 class="erp-card__title">أحدث أذونات القسم
              <span class="erp-eyebrow" dir="ltr" lang="en">Recent Dispatches</span>
            </h3>
          </div>
          <div class="erp-card__body">
            <div data-v2-recent></div>
          </div>
        </section>
      </div>
      </div>`;
}

/**
 * @param {ParentNode} host where the screen is inserted
 * @param {{role?: string|null, deptCode?: string, userName?: string, notify?: Function, navigate?: (key:string)=>void}} [ctx]
 * @returns {{el: HTMLElement, reload: ()=>Promise<void>, getData: ()=>object|null, destroy: ()=>void}}
 */
export function mountDeptHeadDashboardScreen(host, ctx = {}) {
    const navigate = typeof ctx.navigate === 'function' ? ctx.navigate : () => {};
    const user = { deptCode: String(ctx.deptCode || '') };
    let view = null;
    let loading = false;

    host.insertAdjacentHTML('beforeend', template());
    const el = host.lastElementChild;
    const q = (sel) => el.querySelector(sel);
    const kpisEl = q('[data-v2-kpis]');
    const chartsEl = q('[data-v2-charts]');
    const deptEl = q('[data-v2-dept]');
    const costEl = q('[data-v2-cost]');
    const noteEl = q('[data-v2-note]');
    const failuresEl = q('[data-v2-failures]');
    const sourcesEl = q('[data-v2-sources]');
    const subsEl = q('[data-v2-subs]');
    const recentEl = q('[data-v2-recent]');

    function recentTable(rows) {
        if (!rows.length) {
            return `<div class="erp-state"><span class="erp-state__title">لا أذونات لهذا القسم بعد</span></div>`;
        }
        return `<div class="erp-table__scroll" tabindex="0" style="max-height:420px">
          <table class="erp-table__grid">
          <caption class="erp-sr-only">أحدث أذونات القسم</caption>
          <thead><tr><th>#</th><th>الأصناف</th><th>التاريخ</th><th>المرحلة</th><th>الحالة</th></tr></thead>
          <tbody>${rows.map((r) => `<tr>
            <td class="erp-tnum">${esc(String(r.id ?? '—').slice(-6))}</td>
            <td>${esc(r.itemsText || '—')}</td>
            <td class="erp-tnum">${esc(r.date || '—')}</td>
            <td>${esc(r.stage || '—')}</td>
            <td>${statusBadge('dispatch', r.status)}</td>
          </tr>`).join('')}</tbody>
        </table></div>`;
    }

    function paint(v) {
        const cur = v.currency;
        const costValue = v.cost == null
            ? `<span class="erp-num" dir="ltr">—</span>`
            : `<span class="${v.cost < 0 ? 'erp-text-danger' : ''}">${money(v.cost, cur)}</span>`;
        kpisEl.innerHTML = kpiStrip([
            {
                label: 'بانتظار اعتماد الشيف', en: 'Chef Queue', icon: 'chef-hat',
                value: int(v.counts.chef),
                hint: 'طلبات أنشأها القسم ولم تُعتمد بعد',
            },
            {
                label: 'اعتمدها الشيف', en: 'Chef Approved', icon: 'circle-check',
                value: int(v.counts.warehouse),
                hint: 'بانتظار صرف المخازن',
            },
            {
                label: 'بانتظار استلام القسم', en: 'To Receive', icon: 'inbox',
                value: int(v.counts.receive),
                hint: `استُلم وأُغلق: ${int(v.counts.received)}`,
            },
            {
                label: 'كلفة القسم', en: 'Dept Cost', icon: 'banknote',
                valueHtml: costValue,
                hint: v.costCount == null ? 'تعذر قراءة لوحة القسم' : `حركات المصروف: ${int(v.costCount)}`,
            },
        ]);

        chartsEl.innerHTML = donutChart({
            title: 'دورات الصرف في القسم',
            ariaLabel: 'رسم دائري لعدد أذونات القسم في كل مرحلة',
            slices: v.statusSlices,
            centerLabel: 'إذن',
            formatValue: (x) => int(x),
            emptyText: 'لا أذونات صرف لهذا القسم',
        });

        sourcesEl.innerHTML = miniList(v.sources.map((s) => ({
            main: s.label,
            sub: `حركات: ${int(s.count)}`,
            amountHtml: `<span class="${s.total < 0 ? 'erp-text-success' : ''}">${money(s.total, cur)}</span>`,
        })), 'لا مصروفات مسجلة لهذا القسم', v.panelFailed ? 'لوحة القسم لم تُقرأ — لا أرقام تقديرية.' : '');

        subsEl.innerHTML = v.subDepartments.length
            ? `<h4 class="erp-card__title erp-text-sm">الأقسام التابعة</h4>`
                + miniList(v.subDepartments.map((d) => ({
                    main: String(d.name || d.code || '—'),
                    sub: String(d.code || ''),
                    amountHtml: '',
                })), 'لا أقسام تابعة')
            : '';

        recentEl.innerHTML = recentTable(v.recent);

        deptEl.textContent = v.deptName && v.deptName !== '—' ? `— ${v.deptName}` : '— قسمك';
        costEl.textContent = v.cost == null ? '' : `إجمالي كلفة النطاق ${moneyText(v.cost, cur)}`;
        noteEl.textContent = v.panelFailed
            ? 'تعذر قراءة لوحة القسم — أذونات القسم معروضة من سجلها، والكلفة لا تُقدَّر.'
            : 'سلسلة الاعتماد: قسمك ينشئ الطلب ← الشيف العمومي يعتمده ← المخازن تصرف ← قسمك يستمر من مخزنه.';
        failuresEl.innerHTML = failureBox(v.failures);
    }

    async function reload() {
        if (loading) {return;}
        loading = true;
        try {
            const snap = await fetchDeptHeadSnapshot();
            if (!el.isConnected) {return;}          // destroyed while in flight
            view = buildDeptHeadView(snap, user);
            paint(view);
        } catch (e) {
            if (!el.isConnected) {return;}
            view = null;
            kpisEl.innerHTML = '';
            chartsEl.innerHTML = '';
            sourcesEl.innerHTML = '';
            subsEl.innerHTML = '';
            recentEl.innerHTML = '';
            deptEl.textContent = '';
            costEl.textContent = '';
            noteEl.textContent = e && e.message === 'UNAUTHORIZED'
                ? 'انتهت الجلسة — سجّل الدخول في النظام الحالي ثم أعد فتح الوضع الحيّ.'
                : `تعذّر تحميل اللوحة: ${(e && e.message) || 'خطأ'}`;
            failuresEl.innerHTML = '';
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
        getData: () => view,
        destroy() { el.remove(); },
    };
}
