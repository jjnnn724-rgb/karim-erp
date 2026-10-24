/**
 * V2 — مقارنة الشهور · لوحة تنفيذية للإيراد والكوست والمصروفات
 * ═══════════════════════════════════════════════════════════════════════
 *
 * CONTRACT (backend/finance-routes.js)
 *   GET /finance/monthly-comparison?months=12
 *     صفوف الشهور: revenue (تحصيل معتمد)، cost (كوست دفتر = رقم قائمة الدخل)،
 *     oracle_cost (مرآة فواتير المخزون، عمود مستقل لا يُدمج)، expenses
 *     (تشغيلية + فروق جرد + رواتب)، net_profit، margin_pct، وأعلام التغطية.
 *   GET /finance/monthly-comparison/month?month=YYYY-MM
 *     قائمة الشهر نفسها: statement من buildPnlStatement، إيراد التحصيل،
 *     تكوين الكوست والمصروفات، الفئات، الحركة اليومية، وسطور المصروفات كما
 *     سُجّلت مع rows_total وسقف معلن.
 *   طباعة المقارنة وطباعة الشهر عبر عارض V2 (iframe.src) — لا نافذة خارجية.
 *
 *   الشاشة تعرض ولا تحسب: كل رقم ومجموع وهامش ونسبة يصل من الخادم.
 *   fetch/headers محصورة في data/monthly-comparison-repo.js.
 *   بوابة الشاشة هي بوابة الخادم (admin|manager|accountant).
 */

import { createDataTable } from '../data-display/data-table.js?v=4.9.152';
import { openInAppReport } from '../report-viewer.js?v=4.9.152';
import { barChart, lineChart } from '../charts.js?v=4.9.152';
import {
    fetchMonthlyComparison,
    fetchMonthlyDetail,
    fetchMonthlyComparisonPrintHtml,
    fetchMonthlyDetailPrintHtml,
    normalizeDayKey,
    monthLabel,
    MONTHS_CHOICES,
    MONTHS_DEFAULT,
} from '../data/monthly-comparison-repo.js?v=4.9.152';
import { fetchCurrency, formatMoney, formatInt } from '../data/reports-repo.js?v=4.9.152';

const esc = (v) => String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const num = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
};

const round1 = (v) => Math.round((Number(v) || 0) * 10) / 10;

function money(v, currency) {
    const m = formatMoney(v, currency);
    return `<span class="erp-num" dir="ltr">${m.amount}</span>`
        + (m.hasUnit ? ` <span class="erp-text-sm erp-text-muted">${esc(m.unit)}</span>` : '');
}

function moneyText(v, currency) {
    const m = formatMoney(v, currency);
    return `${m.amount}${m.hasUnit ? ` ${m.unit}` : ''}`;
}

function pct(v) {
    if (v == null || !Number.isFinite(Number(v))) {return '<span class="erp-text-muted">—</span>';}
    return `<span class="erp-num" dir="ltr">${round1(v)}%</span>`;
}

const muted = (text) => `<span class="erp-text-muted">${esc(text)}</span>`;

const badge = (text, tone) => `<span class="erp-badge" data-tone="${tone || 'neutral'}">${esc(text)}</span>`;

const icon = (name) => `<i class="ji" data-i="${esc(name)}" aria-hidden="true"></i>`;

const EXPENSE_TYPE_TONES = {
    dispatch: 'info',
    dispatch_return: 'success',
    count_correction: 'warning',
    operating: 'neutral',
};

/** خلية رقمية تُظهر «—» حين لا يغطّي المصدر الشهر بدل صفر مضلِّل. */
function coveredCell(row, value, covered, missText, currency) {
    if (row && row.no_data) {return muted('لا بيانات');}
    if (!covered) {return muted(missText);}
    return money(value, currency);
}

/** بنية المعيار المصدّق (ul.erp-kpis > li.erp-kpi — لا ديفات). */
function kpiCard(label, valueHtml, footHtml, opts = {}) {
    return `<li class="erp-kpi${opts.tone ? ` erp-monthly__kpi--${opts.tone}` : ''}">
      <div class="erp-kpi__top">
        ${opts.icon ? `<span class="erp-kpi__icon">${icon(opts.icon)}</span>` : ''}
        <span class="erp-kpi__label">${esc(label)}</span>
      </div>
      <div class="erp-kpi__value">${valueHtml}</div>
      ${footHtml ? `<div class="erp-kpi__foot"><span class="erp-text-xs erp-text-muted">${footHtml}</span></div>` : ''}
    </li>`;
}

/** سطر مالي بميزانٍ نسبيّ — العرض نسبة من قاعدة معلنة، لا لون عشوائي. */
function weightLine(label, valueHtml, pctValue, tone) {
    const width = Math.max(0, Math.min(100, num(pctValue)));
    return `<div class="erp-monthly__line">
      <span class="erp-monthly__lineLabel">${label}</span>
      <span class="erp-monthly__bar" aria-hidden="true"><i class="erp-monthly__barFill" data-tone="${tone || 'brand'}" style="width:${width}%"></i></span>
      <span class="erp-monthly__lineValue">${valueHtml}</span>
    </div>`;
}

function template() {
    return `
      <section class="erp-v2 erp-monthly">
        <header class="erp-monthly__hero">
          <div class="erp-monthly__heroMain">
            <span class="erp-eyebrow">المالية · تقرير تنفيذي</span>
            <h2 class="erp-monthly__title">مقارنة الشهور
              <span class="erp-monthly__en" dir="ltr" lang="en">Monthly Performance</span>
            </h2>
            <p class="erp-monthly__sub" data-v2-note role="status" aria-live="polite">
              الإيراد هو التحصيل المعتمد من تقرير الكاشيريات (شامل الضريبة)، والكوست
              والمصروفات من دفتر ERP. المصدران لا يُدمجان، وما لا يغطيه مصدر يُعلن
              ولا يُقرأ صفرًا.
            </p>
          </div>
          <div class="erp-monthly__heroSide">
            <div class="erp-monthly__period" data-v2-period></div>
            <div class="erp-monthly__actions">
              <span data-v2-months></span>
              <button type="button" class="erp-btn erp-btn--sm" data-v2-print-open>
                ${icon('printer')}<span>طباعة المقارنة</span>
              </button>
              <button type="button" class="erp-btn erp-btn--primary erp-btn--sm" data-v2-reload>
                ${icon('refresh')}<span>تحديث</span>
              </button>
            </div>
          </div>
        </header>

        <section class="erp-monthly__filters" aria-label="فلاتر الفترة والكاشيرات">
          <div class="erp-monthly__filterRow">
            <div class="erp-monthly__filterGroup">
              <span class="erp-monthly__filterLabel">${icon('calendar-days')}<span>فترة مخصصة</span></span>
              <label class="erp-monthly__field">
                <span class="erp-monthly__fieldLabel">من</span>
                <input type="date" class="erp-input erp-monthly__date" data-v2-from aria-label="تاريخ بداية الفترة">
              </label>
              <label class="erp-monthly__field">
                <span class="erp-monthly__fieldLabel">إلى</span>
                <input type="date" class="erp-input erp-monthly__date" data-v2-to aria-label="تاريخ نهاية الفترة">
              </label>
              <button type="button" class="erp-btn erp-btn--sm erp-btn--primary" data-v2-apply>
                ${icon('check')}<span>تطبيق</span>
              </button>
              <button type="button" class="erp-btn erp-btn--ghost erp-btn--sm" data-v2-reset>
                ${icon('undo')}<span>إعادة ضبط</span>
              </button>
            </div>
            <div class="erp-monthly__filterGroup erp-monthly__filterGroup--cashiers">
              <span class="erp-monthly__filterLabel">${icon('users')}<span>الكاشيرات</span></span>
              <div class="erp-monthly__chips" data-v2-cashiers role="group" aria-label="اختيار الكاشيرات المعروضة"></div>
              <button type="button" class="erp-btn erp-btn--ghost erp-btn--sm" data-v2-cashiers-all>
                ${icon('check')}<span>الكل</span>
              </button>
            </div>
          </div>
          <p class="erp-monthly__filterMsg" data-v2-filterMsg role="status" aria-live="polite"></p>
        </section>

        <ul class="erp-kpis erp-monthly__kpis" data-v2-kpis></ul>

        <section class="erp-monthly__section">
          <div class="erp-monthly__sectionHead">
            <h3 class="erp-monthly__sectionTitle">الاتجاه الشهري</h3>
            <span class="erp-monthly__sectionHint">الإيراد مقابل الكوست والمصروفات، وصافي الربح شهرًا بشهر</span>
          </div>
          <div class="erp-v2-chart-grid" data-v2-charts></div>
        </section>

        <section class="erp-card erp-monthly__tableCard">
          <div class="erp-card__head">
            <div class="erp-monthly__sectionHead erp-monthly__sectionHead--inline">
              <h3 class="erp-monthly__sectionTitle">سجل الشهور</h3>
              <span class="erp-monthly__sectionHint">افتح «تفصيل» لعرض إيرادات الشهر ومصروفاته وطباعة قائمته</span>
            </div>
            <span class="erp-monthly__legend" data-v2-tableLegend></span>
          </div>
          <div class="erp-card__body erp-monthly__tableBody" data-v2-table></div>
          <p class="erp-monthly__coverage" data-v2-coverage></p>
        </section>

        <section class="erp-card erp-monthly__cashierCard">
          <div class="erp-card__head">
            <div class="erp-monthly__sectionHead erp-monthly__sectionHead--inline">
              <h3 class="erp-monthly__sectionTitle">إيراد الكاشيرات المختارة</h3>
              <span class="erp-monthly__sectionHint" data-v2-cashierHint></span>
            </div>
            <span class="erp-monthly__legend" data-v2-cashierTotals></span>
          </div>
          <div class="erp-card__body" data-v2-cashierTable></div>
          <p class="erp-monthly__coverage">الإيراد يخص الكاشيرات المختارة فقط، بينما الكوست والمصروفات من دفتر ERP لكامل المنشأة — فهامش كاشيرٍ واحد لا يُقرأ هامش المنشأة.</p>
        </section>

        <div class="erp-monthly__grid2">
          <section class="erp-card" data-v2-dispatch-year>
            <div class="erp-card__head">
              <h3 class="erp-card__title">ملحق أذونات الصرف — السنة الحالية</h3>
              <span class="erp-text-sm erp-text-muted" data-v2-dispatch-period></span>
            </div>
            <div class="erp-card__body erp-stack">
              <ul class="erp-kpis erp-monthly__kpis erp-monthly__kpis--dense" data-v2-dispatch-kpis></ul>
              <div data-v2-dispatch-chart></div>
              <p class="erp-monthly__finePrint">قيود دفتر ERP وحدها؛ المرتجعات سالبة وتُطرح من الصرف. هذا الملحق لا يُضاف مرة أخرى إلى المصروفات أو صافي الربح.</p>
            </div>
          </section>
          <section class="erp-card">
            <div class="erp-card__head">
              <h3 class="erp-card__title">أساس الأرقام والتغطية</h3>
            </div>
            <div class="erp-card__body erp-monthly__basis" data-v2-basis></div>
          </section>
        </div>

        <div class="erp-monthly__scrim" data-v2-scrim hidden></div>
        <aside class="erp-monthly__panel" data-v2-panel role="dialog" aria-modal="true" aria-labelledby="erp-monthly-panel-title" hidden>
          <header class="erp-monthly__panelHead">
            <div class="erp-monthly__panelId">
              <span class="erp-eyebrow">ملف الشهر</span>
              <h3 class="erp-monthly__panelTitle" id="erp-monthly-panel-title" data-v2-panel-title></h3>
              <p class="erp-monthly__panelSub" data-v2-panel-sub></p>
            </div>
            <div class="erp-monthly__panelActions">
              <button type="button" class="erp-btn erp-btn--sm" data-v2-panel-print>
                ${icon('printer')}<span>طباعة الشهر</span>
              </button>
              <button type="button" class="erp-icon-btn" data-v2-close aria-label="إغلاق ملف الشهر">
                ${icon('x')}
              </button>
            </div>
          </header>
          <div class="erp-monthly__panelBody" data-v2-panel-body aria-live="polite"></div>
        </aside>
      </section>`;
}

/**
 * @param {ParentNode} host where the screen is inserted
 * @param {{role?: string|null, notify?: (message:string, kind?:string)=>void}} [ctx]
 * @returns {{el: HTMLElement, reload: ()=>Promise<void>, getData: ()=>object|null, destroy: ()=>void}}
 */
export function mountMonthlyComparisonScreen(host, ctx = {}) {
    let data = null;
    let currency = '';
    let loading = false;
    let months = MONTHS_DEFAULT;
    /** فترة مخصصة مطبَّقة {from,to}؛ null = نافذة الشهور المتجددة. */
    let range = null;
    /** أرقام كاشيرات مختارة؛ null = كل من ظهرت له فواتير معتمدة في الفترة. */
    let cashiers = null;
    let openMonthKey = null;
    let openWindow = null;
    let retryAll = false;
    let pendingReload = false;
    let detailSeq = 0;
    let detailTable = null;
    let lastFocus = null;
    const detailCache = new Map();

    host.insertAdjacentHTML('beforeend', template());
    const el = host.lastElementChild;
    const q = (sel) => el.querySelector(sel);
    const kpisEl = q('[data-v2-kpis]');
    const chartsEl = q('[data-v2-charts]');
    const tableHost = q('[data-v2-table]');
    const noteEl = q('[data-v2-note]');
    const coverageEl = q('[data-v2-coverage]');
    const periodEl = q('[data-v2-period]');
    const tableLegendEl = q('[data-v2-tableLegend]');
    const basisEl = q('[data-v2-basis]');
    const fromInput = q('[data-v2-from]');
    const toInput = q('[data-v2-to]');
    const filterMsgEl = q('[data-v2-filterMsg]');
    const cashiersEl = q('[data-v2-cashiers]');
    const cashierHintEl = q('[data-v2-cashierHint]');
    const cashierTotalsEl = q('[data-v2-cashierTotals]');
    const cashierTableEl = q('[data-v2-cashierTable]');
    const dispatchPeriodEl = q('[data-v2-dispatch-period]');
    const dispatchKpisEl = q('[data-v2-dispatch-kpis]');
    const dispatchChartEl = q('[data-v2-dispatch-chart]');
    const scrim = q('[data-v2-scrim]');
    const panel = q('[data-v2-panel]');
    const panelTitle = q('[data-v2-panel-title]');
    const panelSub = q('[data-v2-panel-sub]');
    const panelBody = q('[data-v2-panel-body]');

    const monthTable = createDataTable({
        caption: 'المقارنة الشهرية — بيانات حية',
        mode: 'client',
        pageSize: 24,
        stickyHeader: true,
        emptyMessage: 'لا شهور في هذه النافذة',
        rowKey: (row) => row.month,
        onRowActivate: (row) => openMonth(row),
        columns: [
            {
                key: 'month', header: 'الشهر', sortable: true,
                value: (r) => String(r.month || ''),
                render: (r) => `<span class="erp-monthly__month">${esc(monthLabel(r.month))}</span>`
                    + (r.in_progress ? ` ${badge('جارٍ', 'warning')}` : (r.partial ? ` ${badge('جزئي', 'warning')}` : ''))
                    + (r.no_data ? ` ${badge('لا بيانات', 'neutral')}` : '')
                    + (r.partial && r.from && r.to
                        ? `<span class="erp-monthly__monthRange" dir="ltr">${esc(r.from)} → ${esc(r.to)}</span>`
                        : ''),
            },
            {
                key: 'revenue', header: 'إيراد التحصيل', type: 'number', sortable: true, align: 'end',
                value: (r) => num(r.revenue),
                render: (r) => (r.revenue_covered ? money(r.revenue, currency) : muted('غير متاح')),
            },
            {
                key: 'cost_dispatch', header: 'أذونات الصرف', type: 'number', sortable: true, align: 'end',
                value: (r) => num(r.cost_dispatch),
                render: (r) => (r.no_data ? muted('لا بيانات') : money(r.cost_dispatch, currency)),
            },
            {
                key: 'cost_returns', header: 'مرتجعات الصرف', type: 'number', sortable: true, align: 'end',
                value: (r) => num(r.cost_returns),
                render: (r) => (r.no_data ? muted('لا بيانات') : money(r.cost_returns, currency)),
            },
            {
                key: 'cost', header: 'صافي كوست الدفتر', type: 'number', sortable: true, align: 'end',
                value: (r) => num(r.cost),
                render: (r) => coveredCell(r, r.cost, r.ledger_covered, 'لا قيود', currency),
            },
            {
                key: 'oracle_cost', header: 'فواتير المخزون (مرآة)', type: 'number', sortable: true, align: 'end',
                value: (r) => num(r.oracle_cost),
                render: (r) => coveredCell(r, r.oracle_cost, r.oracle_covered, 'لا مرآة', currency),
            },
            {
                key: 'expenses', header: 'المصروفات الأخرى', type: 'number', sortable: true, align: 'end',
                value: (r) => num(r.expenses),
                render: (r) => (r.no_data
                    ? muted('لا بيانات')
                    : (!r.ledger_covered && num(r.expenses) === 0 ? muted('لا قيود') : money(r.expenses, currency))),
            },
            {
                key: 'net_profit', header: 'صافي الربح', type: 'number', sortable: true, align: 'end',
                value: (r) => num(r.net_profit),
                render: (r) => (r.no_data ? muted('لا بيانات') : (num(r.net_profit) >= 0
                    ? `<span class="erp-text-success">${money(r.net_profit, currency)}</span>`
                    : `<span class="erp-text-danger">${money(r.net_profit, currency)}</span>`)),
            },
            {
                key: 'margin_pct', header: 'الهامش', type: 'number', sortable: true, width: '9ch', align: 'end',
                value: (r) => num(r.margin_pct),
                render: (r) => (r.no_data ? muted('—') : pct(r.margin_pct)),
            },
            {
                key: 'open', header: '', sortable: false, width: '11ch', align: 'end',
                render: (r) => `<button type="button" class="erp-btn erp-btn--ghost erp-btn--sm" data-v2-open-month="${esc(r.month)}">`
                    + `${icon('arrow-left')}<span>تفصيل</span></button>`,
            },
        ],
    });
    tableHost.appendChild(monthTable.el);

    function paintWindow() {
        q('[data-v2-months]').innerHTML = `<span class="erp-seg" role="group" aria-label="نافذة الشهور">`
            + MONTHS_CHOICES.map((m) => `<button type="button" data-v2-monthswin="${m}"`
                + `${!range && m === months ? ' class="is-active" aria-pressed="true"' : ' aria-pressed="false"'}>`
                + `آخر ${formatInt(m)} شهرًا</button>`).join('')
            + `</span>`
            + (range ? ` <span class="erp-badge" data-tone="info">فترة مخصصة</span>` : '');
    }

    /** فلاتر الطلب الحالية — الفترة المخصصة تغلب نافذة الشهور، والكاشيرات مشتركة. */
    function currentFilters() {
        const filters = range ? { from: range.from, to: range.to } : { months };
        if (cashiers && cashiers.length) {filters.cashiers = cashiers;}
        return filters;
    }

    function detailFilters() {
        const filters = {};
        if (openWindow && openWindow.from && openWindow.to) {
            filters.from = openWindow.from;
            filters.to = openWindow.to;
        }
        if (cashiers && cashiers.length) {filters.cashiers = cashiers;}
        return filters;
    }

    function detailCacheKey(month) {
        const win = openWindow || {};
        return `${month}|${win.from || ''}|${win.to || ''}|${(cashiers && cashiers.length ? cashiers.join(',') : 'all')}`;
    }

    function setFilterMsg(message, tone) {
        filterMsgEl.textContent = message;
        if (tone) {filterMsgEl.setAttribute('data-tone', tone);} else {filterMsgEl.removeAttribute('data-tone');}
    }

    /** شرائح الكاشيرات: كل من ظهرت له فواتير في الفترة، ومنهم 2 وأي رقمٍ جديد. */
    function paintCashierChips(scope) {
        if (!scope.length) {
            cashiersEl.innerHTML = `<span class="erp-monthly__filterEmpty">لا فواتير معتمدة لأي كاشير في هذه الفترة.</span>`;
            return;
        }
        cashiersEl.innerHTML = scope.map((cashier) => {
            const on = Boolean(cashier.selected);
            const title = cashier.linked
                ? `مرتبط بدفتر ERP — كاشير ${cashier.no}`
                : `ظهر في فواتير الكاشيرية ولم يُربط بعد — كاشير ${cashier.no}`;
            return `<button type="button" class="erp-monthly__chip" data-v2-cashier="${esc(cashier.no)}"`
                + ` aria-pressed="${on ? 'true' : 'false'}"${on ? ' data-active="true"' : ''} title="${esc(title)}">`
                + `<span class="erp-monthly__chipName">${esc(cashier.name)}</span>`
                + `<span class="erp-monthly__chipNo erp-num" dir="ltr">${esc(cashier.no)}</span>`
                + (cashier.linked ? '' : `<span class="erp-monthly__chipTag">جديد</span>`)
                + `</button>`;
        }).join('');
    }

    /** جدول إيراد الكاشيرات — كل قيمةٍ ونسبةٍ من الخادم، ولا جمع هنا. */
    function cashierTableHtml(rows, totals, withTotals) {
        if (!rows.length) {return `<p class="erp-monthly__emptyLine">لا إيراد كاشيرات في هذه الفترة.</p>`;}
        const body = rows.map((row) => `<tr>
            <td><span class="erp-monthly__cashierName">${esc(row.name)}</span>
              <span class="erp-text-xs erp-text-muted" dir="ltr">#${esc(row.no)}</span>
              ${row.linked ? '' : ` ${badge('جديد', 'info')}`}</td>
            <td class="erp-num" dir="ltr">${formatInt(row.invoices)}</td>
            <td class="erp-num" dir="ltr">${moneyText(row.net, currency)}</td>
            <td class="erp-num" dir="ltr">${round1(row.share_pct)}%</td>
          </tr>`).join('');
        const foot = withTotals && totals ? `<tfoot><tr>
            <td>إجمالي المختار</td>
            <td class="erp-num" dir="ltr">${formatInt(totals.invoices)}</td>
            <td class="erp-num" dir="ltr">${moneyText(totals.net, currency)}</td>
            <td class="erp-num" dir="ltr">100%</td>
          </tr></tfoot>` : '';
        return `<div class="erp-table__scroll"><table class="erp-table erp-monthly__miniTable">
          <thead><tr><th>الكاشير</th><th class="erp-num">الفواتير</th><th class="erp-num">إيراد التحصيل</th><th class="erp-num">الحصة</th></tr></thead>
          <tbody>${body}</tbody>${foot}</table></div>`;
    }

    function coverageChips(totals, monthCount) {
        const chips = [];
        chips.push(badge(`دفتر النظام ${formatInt(totals.ledger_months || 0)}/${formatInt(monthCount)}`, totals.ledger_months ? 'success' : 'neutral'));
        chips.push(badge(`مرآة الفواتير ${formatInt(totals.oracle_months || 0)}/${formatInt(monthCount)}`, totals.oracle_months ? 'info' : 'neutral'));
        return chips.join(' ');
    }

    function paint() {
        const rows = Array.isArray(data.months) ? data.months : [];
        const totals = data.totals || {};
        const oracleAvailable = data.oracle_available !== false;
        const period = data.period || {};
        const dispatchYear = data.dispatch_year || {};
        const dispatchTotals = dispatchYear.totals || {};
        const dispatchMonths = Array.isArray(dispatchYear.monthly) ? dispatchYear.monthly : [];
        const cashierScope = Array.isArray(data.cashier_scope) ? data.cashier_scope : [];
        const cashierRevenue = data.cashier_revenue || {};
        const cashierRows = Array.isArray(cashierRevenue.rows) ? cashierRevenue.rows : [];
        const selectedScope = cashierScope.filter((cashier) => cashier.selected);
        const cashierLabels = selectedScope.map((cashier) => `${cashier.name} (${cashier.no})`).join('، ');

        if (period.today) {
            fromInput.max = period.today;
            toInput.max = period.today;
        }
        fromInput.value = period.from || '';
        toInput.value = period.to || '';
        paintCashierChips(cashierScope);
        cashierHintEl.textContent = cashierScope.length
            ? `${formatInt(selectedScope.length)} من ${formatInt(cashierScope.length)} كاشير · ${formatInt(cashierRevenue.totals?.invoices)} فاتورة معتمدة`
            : 'لا كاشيرات بفواتير معتمدة في هذه الفترة';
        cashierTotalsEl.innerHTML = cashierRows.length
            ? badge(`${formatInt(cashierRows.length)} كاشير`, 'info') + ' ' + badge(moneyText(cashierRevenue.totals?.net, currency), 'success')
            : '';
        cashierTableEl.innerHTML = cashierTableHtml(cashierRows, cashierRevenue.totals || {}, true);

        periodEl.innerHTML = `<span class="erp-monthly__periodChip">${icon('calendar-days')}`
            + `<span dir="ltr">${esc(period.from || '—')} → ${esc(period.to || '—')}</span></span>`
            + `<span class="erp-monthly__periodChip erp-monthly__periodChip--muted">${esc(String(rows.length))} شهرًا في النافذة</span>`
            + (period.mode === 'custom'
                ? `<span class="erp-monthly__periodChip">${icon('filter')}<span>فترة مخصصة</span></span>`
                : '');

        kpisEl.innerHTML = [
            kpiCard('إيراد التحصيل المعتمد', money(totals.revenue, currency),
                `${formatInt(totals.invoice_count)} فاتورة معتمدة`, { icon: 'wallet', tone: 'brand' }),
            kpiCard('صافي كوست الدفتر', money(totals.cost, currency),
                `صرف ${money(totals.cost_dispatch, currency)} · مرتجعات ${money(totals.cost_returns, currency)}`, { icon: 'layers' }),
            kpiCard('كوست فواتير المخزون', oracleAvailable ? money(totals.oracle_cost, currency) : muted('المرآة غير متاحة'),
                `${formatInt(totals.oracle_docs)} فاتورة · عمود مقارنة لا يُدمج`, { icon: 'receipt', tone: 'info' }),
            kpiCard('المصروفات الأخرى', money(totals.expenses, currency),
                `تشغيلية ${money(totals.operating, currency)} · جرد ${money(totals.shrinkage, currency)} · رواتب ${money(totals.payroll, currency)}`, { icon: 'scale' }),
            kpiCard('صافي الربح', money(totals.net_profit, currency),
                `الهامش ${pct(totals.margin_pct)} · مجمل ${money(totals.gross_profit, currency)}`,
                { icon: 'trending-up', tone: num(totals.net_profit) >= 0 ? 'success' : 'danger' }),
            kpiCard('هامش الربح', pct(totals.margin_pct),
                `من إيراد ${money(totals.revenue, currency)}`, { icon: 'chart', tone: 'success' }),
        ].join('');

        const labels = rows.map((r) => monthLabel(r.month));
        const moneyFmt = (v) => moneyText(v, currency);
        chartsEl.innerHTML = [
            barChart({
                title: 'الإيراد مقابل الكوست والمصروفات',
                ariaLabel: 'أعمدة إيراد التحصيل وصافي كوست الدفتر وكوست فواتير المخزون للمقارنة والمصروفات الأخرى لكل شهر',
                labels,
                series: [
                    { label: 'إيراد التحصيل', tone: 'success', values: rows.map((r) => r.revenue) },
                    { label: 'صافي كوست الدفتر', tone: 'danger', values: rows.map((r) => r.cost) },
                    { label: 'فواتير المخزون (مرآة)', tone: 'warning', values: rows.map((r) => r.oracle_cost) },
                    { label: 'المصروفات الأخرى', tone: 'brand', values: rows.map((r) => r.expenses) },
                ],
                formatValue: moneyFmt,
                emptyText: 'لا حركات في هذه النافذة',
            }),
            lineChart({
                title: 'صافي الربح شهريًا',
                ariaLabel: 'خط صافي الربح لكل شهر',
                labels,
                series: [
                    { label: 'صافي الربح', tone: 'brand', values: rows.map((r) => r.net_profit), fill: true },
                ],
                formatValue: moneyFmt,
                emptyText: 'لا شهور لعرض الاتجاه',
            }),
        ].join('');

        monthTable.setRows(rows);
        tableLegendEl.innerHTML = coverageChips(totals, rows.length);

        dispatchPeriodEl.textContent = `${dispatchYear.from || '—'} → ${dispatchYear.to || '—'}`;
        dispatchKpisEl.innerHTML = [
            kpiCard('إجمالي الصرف', money(dispatchTotals.dispatch, currency),
                `${formatInt(dispatchTotals.rows)} قيد صرف أو مرتجع`, { icon: 'upload' }),
            kpiCard('مرتجعات الأذونات', money(dispatchTotals.returns, currency),
                'قيمة سالبة كما في الدفتر', { icon: 'undo' }),
            kpiCard('صافي الصرف', money(dispatchTotals.net, currency),
                'مستقل عن المصروفات أدناه', { icon: 'sliders' }),
        ].join('');
        dispatchChartEl.innerHTML = barChart({
            title: `الصرف من الأذونات شهريًا — ${dispatchYear.year || ''}`,
            ariaLabel: 'إجمالي مصروفات أذونات الصرف لكل شهر من بداية السنة الحالية',
            labels: dispatchMonths.map((r) => monthLabel(r.month)),
            series: [{ label: 'إجمالي الصرف', tone: 'brand', values: dispatchMonths.map((r) => r.dispatch) }],
            notes: dispatchMonths.map((r) => r.rows
                ? `${formatInt(r.rows)} قيد · مرتجعات ${moneyText(Math.abs(num(r.returns)), currency)} · الصافي ${moneyText(r.net, currency)}`
                : 'لا قيود صرف مسجلة'),
            formatValue: moneyFmt,
            emptyText: 'لا أذونات صرف مسجلة في هذه السنة',
        });

        basisEl.innerHTML = [
            `<dl class="erp-monthly__facts">`,
            `<div><dt>نافذة التقرير</dt><dd dir="ltr">${esc(period.from || '—')} → ${esc(period.to || '—')}</dd></div>`,
            `<div><dt>الكاشيرات المشمولة</dt><dd>${esc(cashierLabels || '—')}</dd></div>`,
            `<div><dt>الإيراد</dt><dd>${esc(data.sources?.revenue || 'تحصيل تقرير الكاشيريات')}</dd></div>`,
            `<div><dt>دفتر النظام</dt><dd>${esc(data.sources?.ledger || 'صرف المخزون ومرتجعاته — رقم قائمة الدخل')}</dd></div>`,
            `<div><dt>مرآة الفواتير</dt><dd>${esc(data.sources?.oracle || 'فواتير المخزون — للمقارنة فقط')}</dd></div>`,
            `<div><dt>التغطية</dt><dd>${coverageChips(totals, rows.length)}</dd></div>`,
            `</dl>`,
        ].join('');

        coverageEl.innerHTML = [
            `النافذة ${esc(period.from || '—')} → ${esc(period.to || '—')}`,
            `دفتر النظام: ${totals.ledger_months
                ? `${formatInt(totals.ledger_months)} شهرًا (${esc(monthLabel(totals.ledger_first))} → ${esc(monthLabel(totals.ledger_last))})`
                : 'لا قيود في هذه النافذة'}`,
            oracleAvailable
                ? (totals.oracle_months
                    ? `مرآة الفواتير: ${formatInt(totals.oracle_months)} شهرًا (${esc(monthLabel(totals.oracle_first))} → ${esc(monthLabel(totals.oracle_last))})`
                    : 'مرآة الفواتير: لا فواتير في هذه النافذة')
                : 'مرآة الفواتير: غير متاحة الآن',
            '«لا قيود» و«لا مرآة» تعنيان غياب البيانات من ذلك المصدر — تُذكر كما هي ولا تُقرأ صفرًا.',
        ].join(' · ');

        noteEl.textContent = `النافذة ${period.from || '—'} → ${period.to || '—'}`
            + `${period.mode === 'custom' ? ' (فترة مخصصة)' : ''} — إيراد ${cashierLabels || 'الكاشيرات'} من الفواتير المعتمدة، `
            + `والكوست والمصروفات من دفتر ERP؛ العرض للقراءة فقط.`;
    }

    function clearPaint() {
        kpisEl.innerHTML = '';
        chartsEl.innerHTML = '';
        dispatchPeriodEl.textContent = '';
        dispatchKpisEl.innerHTML = '';
        dispatchChartEl.innerHTML = '';
        basisEl.innerHTML = '';
        tableLegendEl.innerHTML = '';
        periodEl.innerHTML = '';
        cashiersEl.innerHTML = '';
        cashierHintEl.textContent = '';
        cashierTotalsEl.innerHTML = '';
        cashierTableEl.innerHTML = '';
        monthTable.setRows([]);
        coverageEl.innerHTML = '';
    }

    /* ── درج الشهر: ملف كامل يُقرأ ثم يُطبع ─────────────────────────────── */

    function panelState(html) {
        panelBody.innerHTML = `<div class="erp-monthly__panelState">${html}</div>`;
    }

    function panelLoading() {
        panelBody.setAttribute('aria-busy', 'true');
        panelState(`${icon('hourglass')}<p>جارٍ تجهيز ملف الشهر من الدفتر…</p>
            <span class="erp-monthly__shimmer" aria-hidden="true"></span>`);
    }

    function panelError(message, month) {
        panelBody.removeAttribute('aria-busy');
        panelState(`${icon('circle-alert')}<p>${esc(message)}</p>
            <button type="button" class="erp-btn erp-btn--sm" data-v2-detail-retry="${esc(month)}">${icon('refresh')}<span>إعادة المحاولة</span></button>`);
    }

    function disposeDetailTable() {
        if (detailTable) {detailTable.destroy(); detailTable = null;}
    }

    function facts(rows) {
        return `<dl class="erp-monthly__facts">${rows.map((r) => `<div><dt>${r[0]}</dt><dd>${r[1]}</dd></div>`).join('')}</dl>`;
    }

    function costRowsHtml(detail) {
        const st = detail.statement || {};
        const cogs = st.cogs || {};
        const sh = st.shrinkage || {};
        const op = st.operating || {};
        const pr = st.payroll || {};
        const base = num(detail.revenue?.total) || num(detail.derived?.expenses) || 0;
        const rows = [
            weightLine('صرف مخزون مواد للأقسام', money(cogs.dispatch, currency), base ? (num(cogs.dispatch) / base) * 100 : 0, 'info'),
            weightLine('مرتجعات الأقسام للمخزن', money(cogs.returns, currency), base ? (Math.abs(num(cogs.returns)) / base) * 100 : 0, 'success'),
            weightLine('صافي كوست الدفتر', money(cogs.net, currency), base ? (num(cogs.net) / base) * 100 : 0, 'danger'),
        ];
        if (num(sh.amount) !== 0) {
            rows.push(weightLine('فروق الجرد', money(sh.amount, currency), base ? (Math.abs(num(sh.amount)) / base) * 100 : 0, 'warning'));
        }
        if (num(pr.total) !== 0) {
            rows.push(weightLine('الرواتب والأجور', money(pr.total, currency), base ? (num(pr.total) / base) * 100 : 0, 'brand'));
        }
        for (const it of (op.items || [])) {
            rows.push(weightLine(`${esc(it.category)} (${formatInt(it.count)})`, money(it.amount, currency), base ? (Math.abs(num(it.amount)) / base) * 100 : 0, 'neutral'));
        }
        return rows.join('');
    }

    function expenseCategoryRows(detail) {
        const st = detail.statement || {};
        const op = st.operating || {};
        const total = num(op.total);
        const rows = (op.items || []).map((it) => weightLine(
            esc(it.category),
            money(it.amount, currency),
            total ? (Math.abs(num(it.amount)) / total) * 100 : 0,
            'brand',
        ));
        return rows.length ? rows.join('') : `<p class="erp-monthly__emptyLine">لا فئات تشغيلية مسجلة في هذا الشهر.</p>`;
    }

    function manualRowsHtml(detail) {
        const manual = detail.manual_revenues || {};
        const rows = Array.isArray(manual.rows) ? manual.rows : [];
        if (!rows.length) {return `<p class="erp-monthly__emptyLine">لا قيود إيراد أخرى في دفتر ERP لهذا الشهر.</p>`;}
        return `<div class="erp-table__scroll"><table class="erp-table erp-monthly__miniTable">
          <thead><tr><th>التاريخ</th><th>المصدر</th><th>القسم</th><th class="erp-num">المبلغ</th></tr></thead>
          <tbody>${rows.map((r) => `<tr>
            <td class="erp-mono" dir="ltr">${esc(r.date)}</td>
            <td>${esc(r.source || '—')}</td>
            <td>${esc(r.department || '—')}</td>
            <td class="erp-num" dir="ltr">${moneyText(r.amount, currency)}</td>
          </tr>`).join('')}</tbody>
        </table></div>${manual.rows_truncated ? `<p class="erp-monthly__finePrint">تُعرض ${formatInt(rows.length)} حركة من ${formatInt(manual.rows_total)} — الباقي في الدفتر.</p>` : ''}`;
    }

    function dossierTemplate(detail) {
        const der = detail.derived || {};
        const rev = detail.revenue || {};
        const oracle = detail.oracle;
        const expenses = detail.expenses || {};
        const revenueValue = rev.total;
        const daily = Array.isArray(der.daily) ? der.daily : [];
        const cashierRows = Array.isArray(detail.cashier_scope?.rows) ? detail.cashier_scope.rows : [];
        const moneyFmt = (v) => moneyText(v, currency);
        const kpis = [
            kpiCard('إيراد التحصيل', detail.revenue_available === false ? muted('لا فواتير') : money(revenueValue, currency),
                `${formatInt(rev.invoice_count)} فاتورة`, { icon: 'wallet', tone: 'brand' }),
            kpiCard('صافي الكوست', money(der.cost, currency), `${pct(der.cost_pct)} من الإيراد`, { icon: 'layers' }),
            kpiCard('إجمالي المصروفات', money(der.expenses, currency), `${pct(der.expenses_pct)} من الإيراد`, { icon: 'scale' }),
            kpiCard('صافي الربح', money(der.net_profit, currency), `الهامش ${pct(der.net_margin_pct)}`,
                { icon: 'trending-up', tone: num(der.net_profit) >= 0 ? 'success' : 'danger' }),
            kpiCard('الفرق عن المرآة', oracle ? money(der.oracle_gap, currency) : muted('لا مرآة'),
                oracle ? `كوست فواتير المخزون ${money(oracle.cost, currency)}` : 'لا فواتير مخزون لهذا الشهر',
                { icon: 'receipt', tone: 'info' }),
        ].join('');

        return `<div class="erp-monthly__dossier">
          <ul class="erp-kpis erp-monthly__kpis erp-monthly__kpis--dense">${kpis}</ul>

          <div class="erp-monthly__dossierGrid">
            <section class="erp-card">
              <div class="erp-card__head"><h4 class="erp-card__title">من الإيراد إلى الربح</h4></div>
              <div class="erp-card__body erp-stack">
                ${weightLine('إيراد التحصيل المعتمد', money(revenueValue, currency), 100, 'success')}
                ${weightLine('صافي كوست الدفتر', money(der.cost, currency), der.cost_pct, 'danger')}
                ${weightLine('مجمل الربح', money(der.gross_profit, currency), der.gross_margin_pct, 'info')}
                ${weightLine('إجمالي المصروفات', money(der.expenses, currency), der.expenses_pct, 'warning')}
                ${weightLine('صافي الربح', money(der.net_profit, currency), der.net_margin_pct, num(der.net_profit) >= 0 ? 'success' : 'danger')}
              </div>
            </section>
            <section class="erp-card">
              <div class="erp-card__head"><h4 class="erp-card__title">تفصيل الإيراد</h4></div>
              <div class="erp-card__body">
                ${facts([
                    ['نافذة القراءة', `<span dir="ltr">${esc(detail.period?.from || '—')} → ${esc(detail.period?.to || '—')}</span>`],
                    ['إيراد التحصيل المعتمد', money(revenueValue, currency)],
                    ['عدد الفواتير', formatInt(rev.invoice_count)],
                    ['إجمالي الفواتير قبل الخصم', money(rev.gross, currency)],
                    ['خصومات الفواتير', money(rev.discount, currency)],
                    ['إيراد دفتر النظام (مطابقة)', money(rev.ledger_total, currency)],
                    ['منه ضريبة قيمة مضافة', money(rev.vat_collected, currency)],
                    ['قيود إيراد الدفتر (لا تُجمع)', money(rev.manual_total, currency)],
                ])}
              </div>
            </section>
          </div>

          <section class="erp-card">
            <div class="erp-card__head">
              <h4 class="erp-card__title">إيراد الكاشيرات المشمولة</h4>
              <span class="erp-text-sm erp-text-muted">من فواتير الكاشيرية المعتمدة داخل نافذة الشهر</span>
            </div>
            <div class="erp-card__body">${cashierTableHtml(cashierRows, null, false)}</div>
          </section>

          <section class="erp-card">
            <div class="erp-card__head">
              <h4 class="erp-card__title">تكوين الكوست والمصروفات</h4>
              <span class="erp-text-sm erp-text-muted">الوزن نسبة من إجمالي الإيراد</span>
            </div>
            <div class="erp-card__body erp-stack">${costRowsHtml(detail)}</div>
          </section>

          <div class="erp-monthly__dossierGrid">
            <section class="erp-card">
              <div class="erp-card__head"><h4 class="erp-card__title">المصروفات التشغيلية حسب الفئة</h4></div>
              <div class="erp-card__body erp-stack">${expenseCategoryRows(detail)}</div>
            </section>
            <section class="erp-card">
              <div class="erp-card__head"><h4 class="erp-card__title">الحركة اليومية للكوست والمصروفات</h4></div>
              <div class="erp-card__body">${daily.length
                    ? barChart({
                        title: 'الكوست والمصروفات يومًا بيوم',
                        ariaLabel: 'أعمدة الكوست والمصروفات الأخرى لكل يوم في الشهر',
                        labels: daily.map((d) => d.date.slice(8, 10)),
                        series: [
                            { label: 'الكوست', tone: 'danger', values: daily.map((d) => d.cost) },
                            { label: 'مصروفات أخرى', tone: 'brand', values: daily.map((d) => d.other) },
                        ],
                        formatValue: moneyFmt,
                        emptyText: 'لا حركة مصروفات في هذا الشهر',
                    })
                    : `<p class="erp-monthly__emptyLine">لا حركة مصروفات في هذا الشهر.</p>`}
              </div>
            </section>
          </div>

          <section class="erp-card">
            <div class="erp-card__head">
              <h4 class="erp-card__title">قيود الإيراد في دفتر ERP</h4>
              <span class="erp-text-sm erp-text-muted">مرآة فواتير وأي إدخال يدوي — لا تدخل في إيراد التحصيل</span>
            </div>
            <div class="erp-card__body">${manualRowsHtml(detail)}</div>
          </section>

          <section class="erp-card">
            <div class="erp-card__head">
              <h4 class="erp-card__title">بيانات المصروفات</h4>
              <span class="erp-text-sm erp-text-muted" data-v2-expenses-meta></span>
            </div>
            <div class="erp-card__body">
              <div data-v2-expenses-table></div>
              ${expenses.rows_truncated
                    ? `<p class="erp-monthly__finePrint">يُعرض ${formatInt((expenses.rows || []).length)} سطرًا من ${formatInt(expenses.rows_total)} — الباقي في دفتر ERP، والإجماليات أعلاه كاملة.</p>`
                    : ''}
            </div>
          </section>

          <p class="erp-monthly__finePrint">الكوست = صرف المخزون − مرتجعاته. المصروفات = التشغيلية + فروق الجرد + الرواتب. صافي الربح = الإيراد − الكوست − المصروفات؛ والضريبة المحصلة التزام لا إيراد.${oracle
                ? ` كوست فواتير المخزون (${moneyText(oracle.cost, currency)} من ${formatInt(oracle.docs)} فاتورة) مرآة مستقلة للمقارنة ولا يُدمج.`
                : ' لا فواتير مخزون مسجلة لهذا الشهر.'}</p>
        </div>`;
    }

    function buildExpenseTable(detail) {
        disposeDetailTable();
        const hostEl = panelBody.querySelector('[data-v2-expenses-table]');
        if (!hostEl) {return;}
        const rows = Array.isArray(detail.expenses?.rows) ? detail.expenses.rows : [];
        const meta = panelBody.querySelector('[data-v2-expenses-meta]');
        if (meta) {
            meta.textContent = `${formatInt(detail.expenses?.rows_total || 0)} حركة · الإجمالي ${moneyText(detail.expenses?.total, currency)}`;
        }
        detailTable = createDataTable({
            caption: 'سطور المصروفات كما سُجّلت في الدفتر',
            mode: 'client',
            pageSize: 10,
            stickyHeader: false,
            emptyMessage: 'لا مصروفات مسجلة في هذا الشهر',
            rowKey: (row, i) => `${row.date}-${i}`,
            columns: [
                { key: 'date', header: 'التاريخ', sortable: true, width: '10ch', value: (r) => String(r.date || ''), render: (r) => `<span class="erp-mono" dir="ltr">${esc(r.date)}</span>` },
                { key: 'type_label', header: 'النوع', sortable: true, value: (r) => String(r.type_label || ''), render: (r) => badge(r.type_label || '—', EXPENSE_TYPE_TONES[r.type] || 'neutral') },
                { key: 'category', header: 'الفئة', sortable: true, value: (r) => String(r.category || '') },
                { key: 'description', header: 'البيان', value: (r) => String(r.description || ''), render: (r) => `<span class="erp-monthly__desc">${esc(r.description || '—')}</span>` },
                { key: 'department', header: 'القسم', sortable: true, value: (r) => String(r.department || '') },
                {
                    key: 'amount', header: 'المبلغ', type: 'number', sortable: true, align: 'end', width: '14ch',
                    value: (r) => num(r.amount),
                    render: (r) => (num(r.amount) < 0
                        ? `<span class="erp-text-danger">${money(r.amount, currency)}</span>`
                        : money(r.amount, currency)),
                },
            ],
        });
        hostEl.appendChild(detailTable.el);
        detailTable.setRows(rows);
    }

    function paintDetail(detail) {
        panelBody.removeAttribute('aria-busy');
        panelBody.innerHTML = dossierTemplate(detail);
        buildExpenseTable(detail);
    }

    async function loadDetail(month, options = {}) {
        const seq = ++detailSeq;
        const cacheKey = detailCacheKey(month);
        if (!options.silent) {panelLoading();}
        try {
            let detail = detailCache.get(cacheKey);
            if (!detail || options.force) {
                detail = await fetchMonthlyDetail(month, detailFilters());
                if (seq === detailSeq) {detailCache.set(cacheKey, detail);}
            }
            if (seq !== detailSeq || openMonthKey !== month || !el.isConnected) {return;}
            paintDetail(detail);
        } catch (e) {
            if (seq !== detailSeq || openMonthKey !== month || !el.isConnected) {return;}
            const message = (e && e.message === 'UNAUTHORIZED')
                ? 'انتهت الجلسة — سجّل الدخول ثم أعد فتح ملف الشهر.'
                : (e && (e.code === 'FORBIDDEN' || e.status === 403))
                    ? 'لا صلاحية لعرض تفصيل هذا الشهر بهذا الحساب.'
                    : `تعذّر تحميل ملف الشهر: ${(e && e.message) || 'خطأ غير معروف'}`;
            panelError(message, month);
        }
    }

    function openMonth(row) {
        const month = typeof row === 'string' ? row : row && row.month;
        if (!month) {return;}
        openMonthKey = month;
        openWindow = (typeof row === 'object' && row && row.from && row.to)
            ? { from: row.from, to: row.to }
            : null;
        lastFocus = document.activeElement;
        panelTitle.textContent = monthLabel(month);
        const scopeLabel = cashiers && cashiers.length ? `${formatInt(cashiers.length)} كاشير مختار` : 'كل الكاشيرات';
        panelSub.textContent = openWindow
            ? `${openWindow.from} → ${openWindow.to} · ${scopeLabel} — يُطبع بنفس الأرقام`
            : `الشهر كاملًا · ${scopeLabel} — يُطبع بنفس الأرقام`;
        panel.hidden = false;
        scrim.hidden = false;
        document.body.classList.add('erp-monthly-open');
        const focusTarget = q('[data-v2-close]');
        if (focusTarget) {focusTarget.focus();}
        const cached = detailCache.get(detailCacheKey(month));
        if (cached) {paintDetail(cached);} else {loadDetail(month);}
    }

    function closePanel() {
        detailSeq += 1;
        openMonthKey = null;
        openWindow = null;
        panel.hidden = true;
        scrim.hidden = true;
        panelBody.innerHTML = '';
        panelBody.removeAttribute('aria-busy');
        disposeDetailTable();
        document.body.classList.remove('erp-monthly-open');
        if (lastFocus && lastFocus.isConnected) {lastFocus.focus();}
        lastFocus = null;
    }

    function changeFilters(message) {
        setFilterMsg(message || 'جارٍ قراءة الفترة والكاشيرات المختارة…');
        if (openMonthKey) {closePanel();}
        reload();
    }

    async function reload() {
        if (loading) {pendingReload = true; return;}
        loading = true;
        monthTable.setLoading(true);
        try {
            const [res, cur] = await Promise.all([
                fetchMonthlyComparison(currentFilters()),
                fetchCurrency().catch(() => ''),
            ]);
            if (!el.isConnected) {return;}
            currency = String(cur ?? '');
            data = res;
            detailCache.clear();
            paint();
            setFilterMsg('الفترة والكاشيرات تُطبَّق على الجدول والمخططات والتفصيل والطباعة معًا.');
            if (openMonthKey) {loadDetail(openMonthKey, {force: true, silent: true});}
        } catch (e) {
            if (!el.isConnected) {return;}
            if (cashiers && e && e.code === 'INVALID_CASHIERS') {
                cashiers = null;
                setFilterMsg(`${e.message} — عُرضت كل الكاشيرات.`, 'danger');
                retryAll = true;
                return;
            }
            data = null;
            clearPaint();
            if (e && e.code === 'INVALID_PERIOD') {
                setFilterMsg(e.message || 'الفترة المختارة غير صالحة.', 'danger');
                noteEl.textContent = 'الفترة المختارة غير صالحة — عدّل التاريخين ثم أعد التطبيق.';
            } else if (e && e.code === 'PERIOD_TOO_LONG') {
                setFilterMsg(e.message || 'الفترة أطول من المسموح.', 'danger');
                noteEl.textContent = 'أقصى فترة 24 شهرًا — اختَر فترة أقصر.';
            } else if (e && e.message === 'UNAUTHORIZED') {
                noteEl.textContent = 'انتهت الجلسة — سجّل الدخول في النظام الحالي ثم أعد فتح الوضع الحي.';
            } else if (e && (e.code === 'FORBIDDEN' || e.status === 403)) {
                noteEl.textContent = 'لا صلاحية لعرض مقارنة الشهور بهذا الحساب — القرار للنظام وحده.';
            } else if (e && (String(e.code || '').endsWith('REVENUE_UNAVAILABLE')
                || ['NO_LINKED_CASHIERS', 'INVALID_LINKED_CASHIER', 'LINKED_CASHIER_MAP_UNAVAILABLE'].includes(e.code)
                || /خريطة الكاشيرات المرتبطة/.test(String(e.message || '')))) {
                noteEl.textContent = `تعذّر تأكيد إيراد التحصيل المعتمد؛ لم تُعرض أرقام محلية بديلة. ${e.message || ''}`;
            } else {
                noteEl.textContent = `تعذّر تحميل مقارنة الشهور: ${(e && e.message) || 'خطأ'}`;
            }
        } finally {
            loading = false;
            if (retryAll) {retryAll = false; reload();}
            else if (pendingReload) {pendingReload = false; reload();}
        }
    }

    /** الفترة المخصصة: تاريخان داخل الحدود فقط، ثم يُعاد تحميل كل شيء. */
    function applyRange() {
        const from = normalizeDayKey(fromInput.value);
        const to = normalizeDayKey(toInput.value);
        const today = data && data.period ? String(data.period.today || '') : '';
        if (!from || !to) {
            setFilterMsg('حدّد تاريخ البداية والنهاية أولًا.', 'danger');
            fromInput.focus();
            return;
        }
        if (from > to) {
            setFilterMsg('تاريخ البداية بعد تاريخ النهاية — صحّح الفترة.', 'danger');
            return;
        }
        if (today && to > today) {
            setFilterMsg('تاريخ النهاية بعد اليوم — اعرض حتى اليوم فقط.', 'danger');
            return;
        }
        range = { from, to };
        paintWindow();
        changeFilters();
    }

    function resetFilters() {
        range = null;
        months = MONTHS_DEFAULT;
        cashiers = null;
        paintWindow();
        changeFilters('أُعيد الضبط إلى آخر 12 شهرًا وكل الكاشيرات.');
    }

    /**
     * نقرة الشريحة: من «الكل» تعزل الكاشير وحده، وبعدها تنقر لتضيف أو تُزيل.
     * الإلغاء الكامل ممنوع — «الكل» هو طريق العودة.
     */
    function toggleCashier(no) {
        const scope = Array.isArray(data && data.cashier_scope) ? data.cashier_scope : [];
        if (!no || !scope.length || !scope.some((cashier) => cashier.no === no)) {return;}
        let next;
        let message;
        if (!cashiers) {
            next = [no];
            message = `عرض كاشير ${no} وحده — أضف غيره بالنقر.`;
        } else {
            next = cashiers.includes(no)
                ? cashiers.filter((item) => item !== no)
                : [...cashiers, no];
            if (!next.length) {
                setFilterMsg('لا يمكن إلغاء كل الكاشيرات — «الكل» يعيد عرض الجميع.', 'danger');
                return;
            }
            message = next.length === 1 ? `عرض كاشير ${next[0]} وحده.` : undefined;
        }
        cashiers = next.length >= scope.length ? null : next;
        changeFilters(message);
    }

    function selectAllCashiers() {
        if (!cashiers) {
            setFilterMsg('كل الكاشيرات معروضة بالفعل.');
            return;
        }
        cashiers = null;
        changeFilters('عُرضت كل الكاشيرات.');
    }

    const viewerOpen = () => document.documentElement.classList.contains('erp-report-viewer-open');

    const onKey = (event) => {
        if (panel.hidden) {return;}
        if (event.key === 'Escape') {
            if (viewerOpen()) {return;}
            event.preventDefault();
            closePanel();
            return;
        }
        if (event.key !== 'Tab') {return;}
        const focusables = [...panel.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')]
            .filter((node) => !node.disabled && node.offsetParent !== null);
        if (!focusables.length) {return;}
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
        }
    };
    document.addEventListener('keydown', onKey, true);

    /* The sheet is fetched with credentials and handed to the viewer as text:
       an iframe src jump carries no Authorization header and would 401. */
    async function openPrintSheet(fetchHtml, title) {
        try {
            const html = await fetchHtml();
            const viewer = openInAppReport(title);
            viewer.document.write(html);
            viewer.document.close();
        } catch (e) {
            ctx.notify?.((e && e.message) || 'تعذر تجهيز المستند للطباعة', 'error');
        }
    }

    el.addEventListener('click', (event) => {
        const w = event.target.closest('[data-v2-monthswin]');
        if (w) {
            const next = Number.parseInt(w.getAttribute('data-v2-monthswin'), 10);
            if (Number.isInteger(next) && (next !== months || range)) {
                range = null;
                months = next;
                paintWindow();
                changeFilters();
            }
            return;
        }
        if (event.target.closest('[data-v2-apply]')) {applyRange(); return;}
        if (event.target.closest('[data-v2-reset]')) {resetFilters(); return;}
        const chip = event.target.closest('[data-v2-cashier]');
        if (chip) {toggleCashier(chip.getAttribute('data-v2-cashier')); return;}
        if (event.target.closest('[data-v2-cashiers-all]')) {selectAllCashiers(); return;}
        const openBtn = event.target.closest('[data-v2-open-month]');
        if (openBtn) {
            const key = openBtn.getAttribute('data-v2-open-month');
            const row = (Array.isArray(data && data.months) ? data.months : []).find((item) => item.month === key);
            openMonth(row || key);
            return;
        }
        const retry = event.target.closest('[data-v2-detail-retry]');
        if (retry) {
            const month = retry.getAttribute('data-v2-detail-retry');
            detailCache.delete(detailCacheKey(month));
            loadDetail(month);
            return;
        }
        if (event.target.closest('[data-v2-panel-print]')) {
            if (openMonthKey) {
                openPrintSheet(
                    () => fetchMonthlyDetailPrintHtml(openMonthKey, detailFilters()),
                    `قائمة ${monthLabel(openMonthKey)}`,
                );
            }
            return;
        }
        if (event.target.closest('[data-v2-close]')) {closePanel(); return;}
        if (event.target.closest('[data-v2-scrim]')) {closePanel(); return;}
        if (event.target.closest('[data-v2-print-open]')) {
            openPrintSheet(
                () => fetchMonthlyComparisonPrintHtml(currentFilters()),
                'مقارنة الشهور',
            );
            return;
        }
        if (event.target.closest('[data-v2-reload]')) {reload(); return;}
        if (event.target.closest('[data-erp-retry]')) {reload();}
    });

    el.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' && event.target.matches('[data-v2-from], [data-v2-to]')) {
            event.preventDefault();
            applyRange();
        }
    });

    paintWindow();
    reload();

    return {
        el,
        reload,
        getData: () => data,
        destroy() {
            detailSeq += 1;
            document.removeEventListener('keydown', onKey, true);
            disposeDetailTable();
            monthTable.destroy();
            document.body.classList.remove('erp-monthly-open');
            el.remove();
        },
    };
}
