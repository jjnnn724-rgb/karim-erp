/**
 * V2 — Accountant dashboard · لوحة المدير المالي (P2-7، قراءة فقط)
 * ═══════════════════════════════════════════════════════════════════════
 *
 * The live replacement for features/dashboard.js:70 renderAccountantDashboard.
 * Month totals come from the server-built P&L statement (never a client walk),
 * latest movements are one page each, and the two charts read the same
 * daily_series / by_department the P&L screen reads. Read-only by
 * construction: the repository has no write door, and the screen has no forms.
 *
 * Quick links navigate to the migrated finance screens only.
 */

import { lineChart, barChart } from '../charts.js?v=4.9.149';
import { fetchAccountantSnapshot, buildAccountantView } from '../data/dashboard-repo.js?v=4.9.149';
import { money, moneyText, int, kpiStrip, miniList, failureBox } from '../role-dash-parts.js?v=4.9.149';

const pct = (v) => (v == null ? '—' : `${v.toFixed(1)}%`);

function template() {
    return `
      <div class="erp-v2-role-dash">
      <section class="erp-card erp-v2-accountant">
        <div class="erp-card__head">
          <h3 class="erp-card__title">لوحة المدير المالي
            <span class="erp-eyebrow" dir="ltr" lang="en">Accountant Overview</span>
          </h3>
          <span class="erp-grow"></span>
          <span class="erp-text-sm erp-text-muted" data-v2-period></span>
          <button type="button" class="erp-btn erp-btn--primary erp-btn--sm" data-v2-reload>
            <i class="ji" data-i="refresh" aria-hidden="true"></i><span>تحديث</span>
          </button>
        </div>
        <div class="erp-card__body erp-stack">
          <p class="erp-text-sm erp-text-muted" data-v2-note role="status" aria-live="polite">
            الفترة يحددها الخادم — كل رقم من حركة مسجّلة، ولا يجمع المتصفح سجلات الشهر بنفسه.
          </p>
          <div data-v2-kpis></div>
          <div class="erp-row-wrap" data-v2-links>
            <button type="button" class="erp-btn erp-btn--sm" data-v2-go="revenues">
              <i class="ji" data-i="banknote" aria-hidden="true"></i><span>الإيرادات</span>
            </button>
            <button type="button" class="erp-btn erp-btn--sm" data-v2-go="expenses">
              <i class="ji" data-i="wallet" aria-hidden="true"></i><span>المصروفات</span>
            </button>
            <button type="button" class="erp-btn erp-btn--sm" data-v2-go="pnl">
              <i class="ji" data-i="file-text" aria-hidden="true"></i><span>قائمة الدخل</span>
            </button>
            <button type="button" class="erp-btn erp-btn--sm" data-v2-go="cost-analysis">
              <i class="ji" data-i="chart" aria-hidden="true"></i><span>تحليل التكاليف</span>
            </button>
          </div>
          <div class="erp-v2-chart-grid" data-v2-charts></div>
          <div data-v2-failures></div>
        </div>
      </section>
      <section class="erp-card" style="margin-block-start:var(--erp-space-4)">
        <div class="erp-card__head">
          <h3 class="erp-card__title">أحدث الحركات
            <span class="erp-eyebrow" dir="ltr" lang="en">Latest Movements</span>
          </h3>
        </div>
        <div class="erp-card__body">
          <div class="erp-dash-grid">
            <div>
              <h4 class="erp-card__title erp-text-sm">أحدث الإيرادات</h4>
              <div data-v2-latest-revenues></div>
            </div>
            <div>
              <h4 class="erp-card__title erp-text-sm">أحدث المصاريف</h4>
              <div data-v2-latest-expenses></div>
            </div>
          </div>
        </div>
      </section>
      </div>`;
}

/**
 * @param {ParentNode} host where the screen is inserted
 * @param {{role?: string|null, notify?: Function, navigate?: (key:string)=>void}} [ctx]
 * @returns {{el: HTMLElement, reload: ()=>Promise<void>, getData: ()=>object|null, destroy: ()=>void}}
 */
export function mountAccountantDashboardScreen(host, ctx = {}) {
    const navigate = typeof ctx.navigate === 'function' ? ctx.navigate : () => {};
    let view = null;
    let loading = false;

    host.insertAdjacentHTML('beforeend', template());
    const el = host.lastElementChild;
    const q = (sel) => el.querySelector(sel);
    const kpisEl = q('[data-v2-kpis]');
    const chartsEl = q('[data-v2-charts]');
    const periodEl = q('[data-v2-period]');
    const noteEl = q('[data-v2-note]');
    const failuresEl = q('[data-v2-failures]');
    const revEl = q('[data-v2-latest-revenues]');
    const expEl = q('[data-v2-latest-expenses]');

    function paint(v) {
        const t = v.totals;
        const cur = v.currency;
        // A failed statement is not a zero statement: the KPIs say «—» and
        // the failure box names the source instead of painting 0.00.
        const missing = '<span class="erp-num" dir="ltr">—</span>';
        const noPnl = !v.hasPnl;
        kpisEl.innerHTML = kpiStrip([
            {
                label: 'إيرادات الفترة', en: 'Revenue', icon: 'banknote',
                valueHtml: noPnl ? missing : money(t.revenue, cur),
                hint: noPnl ? 'قائمة الدخل لم تُقرأ — لا صفر مكانها'
                    : `${int(t.invoices)} فاتورة كاشير + ${int(t.manual)} إيراد يدوي`,
            },
            {
                label: 'إجمالي التكاليف', en: 'Total Cost', icon: 'wallet',
                valueHtml: noPnl ? missing : money(t.cost, cur),
                hint: noPnl ? 'لا تقدير بلا قائمة دخل'
                    : `تكلفة المواد ${moneyText(v.breakdown.cogs, cur)} + تشغيل ورواتب وجرد`,
            },
            {
                label: 'صافي الربح', en: 'Net Profit', icon: 'gem',
                valueHtml: noPnl ? missing
                    : `<span class="${t.profit < 0 ? 'erp-text-danger' : 'erp-text-success'}">${money(t.profit, cur)}</span>`,
                hint: noPnl ? 'لا تقدير بلا قائمة دخل' : `هامش الربح ${pct(t.margin)}`,
            },
            {
                label: 'نسبة التكلفة', en: 'Cost Ratio', icon: 'gauge',
                value: pct(t.costRatio),
                hint: noPnl ? 'قائمة الدخل لم تُقرأ — لا نسبة'
                    : t.costRatio == null ? 'لا إيراد في الفترة — لا نسبة بلا أساس'
                        : `من الإيراد — هامش ${pct(t.margin)}`,
            },
        ]);

        const moneyFmt = (v2) => moneyText(v2, cur);
        chartsEl.innerHTML = [
            lineChart({
                title: 'اتجاه الإيرادات والتكاليف',
                ariaLabel: 'خط الإيرادات وتكلفة المواد والمصاريف التشغيلية حسب اليوم',
                labels: v.daily.map((d) => d.date.slice(5)),
                series: [
                    { label: 'الإيرادات', tone: 'success', values: v.daily.map((d) => d.revenue), fill: true },
                    { label: 'تكلفة المواد', tone: 'danger', values: v.daily.map((d) => d.cogs) },
                    { label: 'تكاليف أخرى', tone: 'warning', values: v.daily.map((d) => d.opex) },
                ],
                formatValue: moneyFmt,
                emptyText: noPnl ? 'تعذر تحميل قائمة الدخل — لا رسم' : 'لا حركات يومية في هذه الفترة',
            }),
            barChart({
                title: 'الإيرادات مقابل تكلفة المواد — الأقسام',
                ariaLabel: 'أعمدة الإيرادات وتكلفة المواد لكل قسم',
                labels: v.departments.map((d) => d.name),
                series: [
                    { label: 'الإيرادات', tone: 'success', values: v.departments.map((d) => d.revenue) },
                    { label: 'تكلفة المواد', tone: 'danger', values: v.departments.map((d) => d.cogs) },
                ],
                formatValue: moneyFmt,
                emptyText: noPnl ? 'تعذر تحميل قائمة الدخل — لا رسم' : 'لا حركات أقسام في هذه الفترة',
            }),
        ].join('');

        revEl.innerHTML = miniList(
            v.latestRevenues.map((r) => ({ main: r.label, sub: r.date, amountHtml: money(r.amount, cur) })),
            'لا إيرادات مسجلة',
        );
        expEl.innerHTML = miniList(
            v.latestExpenses.map((e) => ({ main: e.label, sub: e.date, amountHtml: money(e.amount, cur) })),
            'لا مصاريف مسجلة',
        );

        const from = v.period.from || '—';
        const to = v.period.to || '—';
        periodEl.textContent = v.hasPnl ? `${from} → ${to}` : '';
        noteEl.textContent = v.pnlFailed
            ? (v.pnlMessage || 'تعذر تحميل قائمة الدخل — التحقق من الصلاحية قرار الخادم.')
            : `الفترة ${from} → ${to} — من قائمة الدخل التي يبنيها الخادم.`;
        failuresEl.innerHTML = failureBox(v.failures);
    }

    async function reload() {
        if (loading) {return;}
        loading = true;
        try {
            const snap = await fetchAccountantSnapshot();
            if (!el.isConnected) {return;}          // destroyed while in flight
            view = buildAccountantView(snap);
            paint(view);
        } catch (e) {
            if (!el.isConnected) {return;}
            view = null;
            kpisEl.innerHTML = '';
            chartsEl.innerHTML = '';
            revEl.innerHTML = '';
            expEl.innerHTML = '';
            periodEl.textContent = '';
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
