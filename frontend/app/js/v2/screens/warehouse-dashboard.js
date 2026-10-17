/**
 * V2 — Warehouse dashboard · لوحة المخزن (P2-7، قراءة فقط)
 * ═══════════════════════════════════════════════════════════════════════
 *
 * The live replacement for features/dashboard.js:108 renderWarehouseDashboard.
 * Stock counts are the server's own filter totals (`stock=low|out|all`), and
 * the three filters are disjoint, so «متوفر» is all − low − out, not a guess.
 * The dispatch and purchase-request counts are derived from the same rows
 * their screens read; the decision itself stays on those screens.
 *
 * Read-only by construction: no forms, no write door, no row buttons.
 */

import { donutChart } from '../charts.js?v=4.9.147';
import { formatQty } from '../data/inventory-repo.js?v=4.9.147';
import { fetchWarehouseSnapshot, buildWarehouseView } from '../data/dashboard-repo.js?v=4.9.147';
import { esc, int, kpiStrip, miniList, failureBox } from '../role-dash-parts.js?v=4.9.147';

function template() {
    return `
      <div class="erp-v2-role-dash">
      <section class="erp-card erp-v2-whdash">
        <div class="erp-card__head">
          <h3 class="erp-card__title">لوحة المخزن
            <span class="erp-eyebrow" dir="ltr" lang="en">Warehouse Overview</span>
          </h3>
          <span class="erp-grow"></span>
          <span class="erp-text-sm erp-text-muted" data-v2-stamp></span>
          <button type="button" class="erp-btn erp-btn--primary erp-btn--sm" data-v2-reload>
            <i class="ji" data-i="refresh" aria-hidden="true"></i><span>تحديث</span>
          </button>
        </div>
        <div class="erp-card__body erp-stack">
          <p class="erp-text-sm erp-text-muted" data-v2-note role="status" aria-live="polite">
            الأعداد من فلاتر الخادم نفسها (نافد / تحت الحد / الكل) — لا تُعاد في المتصفح.
          </p>
          <div data-v2-kpis></div>
          <div class="erp-row-wrap" data-v2-links>
            <button type="button" class="erp-btn erp-btn--sm" data-v2-go="warehouse">
              <i class="ji" data-i="package" aria-hidden="true"></i><span>المخزن</span>
            </button>
            <button type="button" class="erp-btn erp-btn--sm" data-v2-go="dispatch">
              <i class="ji" data-i="clipboard-list" aria-hidden="true"></i><span>أذونات الصرف</span>
            </button>
            <button type="button" class="erp-btn erp-btn--sm" data-v2-go="wh-prs">
              <i class="ji" data-i="shopping-cart" aria-hidden="true"></i><span>طلبات الشراء</span>
            </button>
            <button type="button" class="erp-btn erp-btn--sm" data-v2-go="wh-moves">
              <i class="ji" data-i="arrow-left-right" aria-hidden="true"></i><span>حركات المخزون</span>
            </button>
          </div>
          <div class="erp-v2-chart-grid" data-v2-charts></div>
          <div data-v2-failures></div>
        </div>
      </section>
      <section class="erp-card" style="margin-block-start:var(--erp-space-4)">
        <div class="erp-card__head">
          <h3 class="erp-card__title">أكثر الأصناف نقصًا
            <span class="erp-eyebrow" dir="ltr" lang="en">Stock gaps</span>
          </h3>
        </div>
        <div class="erp-card__body">
          <div data-v2-low></div>
        </div>
      </section>
      </div>`;
}

/**
 * @param {ParentNode} host where the screen is inserted
 * @param {{role?: string|null, notify?: Function, navigate?: (key:string)=>void}} [ctx]
 * @returns {{el: HTMLElement, reload: ()=>Promise<void>, getData: ()=>object|null, destroy: ()=>void}}
 */
export function mountWarehouseDashboardScreen(host, ctx = {}) {
    const navigate = typeof ctx.navigate === 'function' ? ctx.navigate : () => {};
    let view = null;
    let loading = false;

    host.insertAdjacentHTML('beforeend', template());
    const el = host.lastElementChild;
    const q = (sel) => el.querySelector(sel);
    const kpisEl = q('[data-v2-kpis]');
    const chartsEl = q('[data-v2-charts]');
    const lowEl = q('[data-v2-low]');
    const stampEl = q('[data-v2-stamp]');
    const noteEl = q('[data-v2-note]');
    const failuresEl = q('[data-v2-failures]');

    const countText = (v) => (v == null ? '—' : int(v));

    function paint(v) {
        const s = v.stock;
        const qta = v.queues;
        kpisEl.innerHTML = kpiStrip([
            {
                label: 'أصناف نافدة', en: 'Out of Stock', icon: 'circle-x',
                value: countText(s.out),
                hint: s.known ? `إجمالي المخزون: ${int(s.total)}` : 'تعذر قراءة إجمالي المخزون',
            },
            {
                label: 'أصناف تحت الحد', en: 'Low Stock', icon: 'alert-triangle',
                value: countText(s.low),
                hint: 'كمية موجبة ولا تتجاوز الحد الأدنى',
            },
            {
                label: 'أذونات تنتظر المخازن', en: 'Dispatch Queue', icon: 'clipboard-list',
                value: int(qta.warehouse),
                hint: `اعتماد الشيف أولًا: ${int(qta.chef)}`,
            },
            {
                label: 'طلبات شراء قيد الدورة', en: 'Purchase Queue', icon: 'shopping-cart',
                value: int(qta.purchase),
                hint: `إجمالي السجل: ${int(qta.purchases)}`,
            },
        ]);

        const slices = s.known
            ? [
                { label: 'نافد', value: s.out, tone: 'danger' },
                { label: 'تحت الحد', value: s.low, tone: 'warning' },
                { label: 'متوفر', value: s.ok, tone: 'success' },
            ]
            : [];
        chartsEl.innerHTML = donutChart({
            title: 'حالة المخزون',
            ariaLabel: 'رسم دائري لعدد الأصناف النافدة وتحت الحد والمتوفرة',
            slices,
            centerLabel: 'صنف',
            formatValue: (x) => int(x),
            emptyText: s.known ? 'لا أصناف مسجلة في المخزن' : 'تعذر قراءة حالة المخزون',
        });

        lowEl.innerHTML = miniList(v.lowRows.map((r) => {
            const tone = r.state.key === 'out' ? 'erp-text-danger' : 'erp-text-warning';
            return {
                main: r.name,
                sub: `الحد ${formatQty(r.minQty)}${r.unit ? ` ${r.unit}` : ''} · ${r.state.label}`,
                amountHtml: `<span class="${tone}"><span class="erp-num" dir="ltr">${formatQty(r.qty)}</span>${r.unit ? ` ${esc(r.unit)}` : ''}</span>`,
            };
        }), 'المخزون في الحدود الآمنة', 'لا صنف نافد أو تحت الحد الآن.');

        stampEl.textContent = s.known ? `${int(s.total)} صنفًا` : '';
        noteEl.textContent = s.known
            ? 'الأعداد من فلاتر الخادم نفسها (نافد / تحت الحد / الكل) — لا تُعاد في المتصفح.'
            : 'تعذر قراءة المخزون من الخادم — لا تُعرض أعداد مخزون تقديرية.';
        failuresEl.innerHTML = failureBox(v.failures);
    }

    async function reload() {
        if (loading) {return;}
        loading = true;
        try {
            const snap = await fetchWarehouseSnapshot();
            if (!el.isConnected) {return;}          // destroyed while in flight
            view = buildWarehouseView(snap);
            paint(view);
        } catch (e) {
            if (!el.isConnected) {return;}
            view = null;
            kpisEl.innerHTML = '';
            chartsEl.innerHTML = '';
            lowEl.innerHTML = '';
            stampEl.textContent = '';
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
