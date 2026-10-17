/**
 * V2 — Reports screen · شاشة 04 في سجل الترحيل (قراءة فقط)
 * ═══════════════════════════════════════════════════════════════════════
 *
 * SAME CONTRACT AS SCREENS 01-03, SAME VISUAL LANGUAGE
 *   Read-only by construction: no POST/PUT/DELETE path in this file, and its
 *   two doors (v2/data/reports-repo.js) only ever read.
 *
 * WHY THE FILTERS COST A REQUEST
 *   Period and grouping are SQL here, not table cosmetics: the server sums
 *   `total_amount` per department/cashier/product in one query and sorts by
 *   net_sales (shift-routes.js:1055,:1092,:1121). Filtering the returned rows
 *   locally could not recover a period that was never asked for, so changing
 *   either control asks the server again — the same decision screen 03 made
 *   for its search box.
 *
 * MONEY, AND WHERE ITS UNIT COMES FROM
 *   This is the first V2 screen that shows amounts, so it is the first that
 *   reads the stored currency (`/api/settings/main_settings`). Every money
 *   figure carries that unit, and when the read fails the numbers stay bare
 *   with a stated note — no «ر.س» or «ج.م» typed into this file.
 *
 * WHAT THE SCREEN DOES NOT DECIDE
 *   • Which invoices count: `status IN ('issued','reported')` is the server's
 *     rule (:957); returns and voids are simply not in this report.
 *   • Who is scoped: a cashier sees their own lines because the SQL says so
 *     (:968-971), and the server echoes that in `filters.cashier_id` (:1138).
 *     The scope line below shows the echo, never an assumption.
 *   • How many products fit: the item dimension is `LIMIT 200` (:1121) with no
 *     total returned, so the cap is declared when 200 rows arrive.
 */

import { createDataTable } from '../data-display/data-table.js?v=4.9.152';
import { openInAppReport } from '../report-viewer.js?v=4.9.152';
import {
    fetchSalesReport, fetchCurrency, reportToRow, buildReportKpis, paymentBreakdown,
    periodRange, formatInt, formatQty, formatMoney,
    GROUP_BY, PERIODS,
} from '../data/reports-repo.js?v=4.9.152';
import {
    fetchLocalBundle, fetchHrAttendance,
    computeGeneral, computeDepartments, computeKitchen, computeReturns,
    computeWarehouse, computeHr, fetchYaraDepartments, fetchYaraCashierItems,
    fetchYaraInvoiceDetail,
} from '../data/reports-extra.js?v=4.9.152';

const esc = (v) => String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** The five period keys (reports-repo.js PERIODS) in the legacy page's words. */
const PERIOD_AR = {
    today: 'اليوم', week: 'هذا الأسبوع', month: 'هذا الشهر', year: 'هذا العام', custom: 'مخصصة',
};

/** The server's own group_by enum (:947), named. */
const GROUP_AR = {
    department: 'الأقسام', cashier: 'الكاشير', item: 'الأصناف',
};

/** What the first column is called per dimension — the dimension's own word. */
const DIM_LABEL = { department: 'القسم', cashier: 'الكاشير', item: 'الصنف' };

/** The dimension's noun in the accusable plural form the notes need. */
const DIM_COUNT_NOUN = { department: 'قسمًا', cashier: 'كاشيرًا', item: 'صنفًا' };

/** How many portlet rows to show before saying «the rest is in the table». */
const TOP_PORTLET = 6;

/* ── Cells ────────────────────────────────────────────────────────────── */

function moneyCell(v, currency, opts = {}) {
    const m = formatMoney(v, currency);
    const n = `<span class="erp-num" dir="ltr">${m.amount}</span>`;
    const u = m.hasUnit ? ` <span class="erp-text-sm erp-text-muted">${esc(m.unit)}</span>` : '';
    const body = `${n}${u}`;
    return opts.title ? `<span title="${esc(opts.title)}">${body}</span>` : body;
}

function intCell(v, opts = {}) {
    const n = `<span class="erp-num" dir="ltr">${formatInt(v)}</span>`;
    return opts.title ? `<span title="${esc(opts.title)}">${n}</span>` : n;
}

function qtyCell(v, opts = {}) {
    const n = `<span class="erp-num" dir="ltr">${formatQty(v)}</span>`;
    return opts.title ? `<span title="${esc(opts.title)}">${n}</span>` : n;
}

/** Dimension name with its stored code under it — never an invented name. */
function dimCell(row) {
    const label = row.nameResolved ? esc(row.dimensionName)
        : `<span class="erp-text-muted" title="لا اسم مخزّن في الفاتورة — يُعرض رقم السجل">${esc(`#${row.dimensionId ?? '؟'}`)}</span>`;
    return row.dimensionCode
        ? `${label}<span class="erp-mini__sub erp-mono" dir="ltr">${esc(row.dimensionCode)}</span>`
        : label;
}

function kpiStrip(kpis, scopeLabel) {
    return `<ul class="erp-kpis" aria-label="مؤشرات ${esc(scopeLabel)} — كل رقم حسبه الخادم في SQL على الفترة المطلوبة">`
        + kpis.map((k) => `
      <li class="erp-kpi">
        <div class="erp-kpi__top">
          <span class="erp-kpi__icon" aria-hidden="true"><i class="ji" data-i="${esc(k.icon)}"></i></span>
          <span class="erp-kpi__label">${esc(k.label)}<span class="erp-eyebrow" dir="ltr" lang="en">${esc(k.en)}</span></span>
        </div>
        <div class="erp-kpi__value"><span class="erp-num" dir="ltr">${esc(k.value)}</span>${k.unit ? ` <span class="erp-kpi__unit">${esc(k.unit)}</span>` : ''}</div>
        <div class="erp-kpi__foot">
          <span class="erp-delta erp-delta--flat" role="img" aria-label="${esc(k.pill.aria)}">
            <span class="erp-num" dir="ltr">${esc(k.pill.text)}</span>
          </span>
          <span class="erp-kpi__hint">${esc(k.hint)}</span>
        </div>
      </li>`).join('')
        + `</ul>`;
}

/** `.erp-tops` bars for the payment rollup — share of what was actually paid. */
function paymentsBlock(pay, currency) {
    if (!pay.rows.length) {
        return `<div class="erp-state" role="status">
          <span class="erp-state__title">لا مدفوعات مسجّلة</span>
          <span>لا طريقة دفع في مغلّف الخادم لهذه الفترة — الأجماليات من الفواتير، والمدفوعات سجلها منفصل (pos_invoice_payments).</span>
        </div>`;
    }
    const max = Math.max(...pay.rows.map((p) => p.amount), 1);
    const aria = `مبالغ المدفوعات لكل طريقة، أكبرها ${formatMoney(max, currency).amount} — المجموع ${formatMoney(pay.total, currency).amount}`;
    return `<ul class="erp-tops" role="list" aria-label="${esc(aria)}">`
        + pay.rows.slice(0, TOP_PORTLET).map((p) => {
            // The share is of what was PAID, not of net sales — saying which
            // base a percentage uses is the whole honesty of this portlet.
            const pct = pay.total > 0 ? `${((p.amount / pay.total) * 100).toFixed(1)}%` : '—';
            const title = `${p.label}: ${formatMoney(p.amount, currency).amount}${currency ? ` ${currency}` : ''} من المدفوع (${pct})`;
            return `
        <li class="erp-top__row">
          <span class="erp-top__name" title="${esc(title)}">${esc(p.label)}</span>
          <span class="erp-top__track"><span class="erp-top__fill" style="inline-size:${Math.round((p.amount / max) * 100)}%"></span></span>
          <span class="erp-top__val">${moneyCell(p.amount, currency, { title: `نسبة من إجمالي المدفوع: ${pct}` })}</span>
        </li>`;
        }).join('')
        + `</ul>`;
}

/** The dimension portlet: highest net first, exactly as the server ordered it. */
function dimsBlock(rows, groupBy, currency) {
    if (!rows.length) {
        return `<div class="erp-state" role="status">
          <span class="erp-state__title">لا أبعاد في النتيجة</span>
          <span>لا صف ${esc(GROUP_AR[groupBy] || '')} مُجمَّع من فواتير هذه الفترة — لا قيمة تُختلق لصف غائب.</span>
        </div>`;
    }
    const max = Math.max(...rows.map((r) => r.netSales), 0) || 1;
    const top = rows.slice(0, TOP_PORTLET);
    const aria = `${esc(GROUP_AR[groupBy])} الأعلى صافيًا في الفترة، ترتيب الخادم نفسه`;
    return `<ul class="erp-tops" role="list" aria-label="${esc(aria)}">`
        + top.map((r) => {
            const name = r.nameResolved ? r.dimensionName : `#${r.dimensionId ?? '؟'}`;
            const title = `${name}: صافي ${formatMoney(r.netSales, currency).amount}${currency ? ` ${currency}` : ''} من ${formatInt(r.invoiceCount)} فاتورة`;
            return `
        <li class="erp-top__row">
          <span class="erp-top__name${r.nameResolved ? '' : ' erp-text-muted'}" title="${esc(title)}">${esc(name)}</span>
          <span class="erp-top__track"><span class="erp-top__fill" style="inline-size:${Math.round((r.netSales / max) * 100)}%"></span></span>
          <span class="erp-top__val">${moneyCell(r.netSales, currency)}</span>
        </li>`;
        }).join('')
        + `</ul>`;
}

/** Only the segment repaints — the date inputs keep what the operator typed. */
function periodSeg(active) {
    return `<div class="erp-seg" role="group" aria-label="الفترة الزمنية">`
        + `<span class="erp-seg__label">الفترة</span>`
        + PERIODS.map((p) => `<button type="button" data-v2-period="${esc(p)}"${p === active ? ' class="is-active" aria-pressed="true"' : ' aria-pressed="false"'}>${esc(PERIOD_AR[p])}</button>`).join('')
        + `</div>`;
}

function groupSeg(active) {
    return `<div class="erp-seg" role="group" aria-label="بُعد التجميع">`
        + `<span class="erp-seg__label">حسب</span>`
        + GROUP_BY.map((g) => `<button type="button" data-v2-group="${esc(g)}"${g === active ? ' class="is-active" aria-pressed="true"' : ' aria-pressed="false"'}>${esc(GROUP_AR[g])}</button>`).join('')
        + `</div>`;
}

function template(period, groupBy) {
    return `
      <div class="erp-v2-reports" data-v2-reports>
        <div class="erp-dash-head">
          <div>
            <h2 class="erp-dash-title">التقارير
              <span class="erp-eyebrow" dir="ltr" lang="en">Sales Reports</span>
            </h2>
            <div class="erp-dash-sub" data-v2-scope-line role="status" aria-live="polite"></div>
          </div>
          <div class="erp-dash-controls">
            <span data-v2-periodseg>${periodSeg(period)}</span>
            <span data-v2-groupseg>${groupSeg(groupBy)}</span>
            <span class="erp-filterbar erp-no-print">
              <label class="erp-text-sm erp-text-muted" for="v2rp-type">التقرير</label>
              <select class="erp-input" id="v2rp-type" data-v2-type>
                <option value="pos-department">مبيعات POS حسب القسم</option>
                <option value="pos-cashier">مبيعات POS حسب الكاشير</option>
                <option value="pos-item">مبيعات POS حسب الصنف</option>
                <option value="general">التقرير الشامل</option>
                <option value="department">تقرير الأقسام</option>
                <option value="kitchen">تقرير المطبخ</option>
                <option value="returns">تقرير المرتجعات</option>
                <option value="warehouse">تقرير المخازن والمخزون</option>
                <option value="hr">تقرير الموارد البشرية</option>
                <option value="dept-specific">تقرير قسم محدد</option>
                <option value="yara-departments">إيرادات الأقسام من يارا</option>
                <option value="yara-cashiers">مبيعات الكاشيرية من يارا</option>
              </select>
              <span data-v2-deptsel hidden>
                <label class="erp-text-sm erp-text-muted" for="v2rp-dept">القسم</label>
                <select class="erp-input" id="v2rp-dept" data-v2-dept></select>
              </span>
            </span>
            <span class="erp-filterbar erp-no-print">
              <label class="erp-text-sm erp-text-muted" for="v2rp-from">من</label>
              <input class="erp-input" id="v2rp-from" type="date" data-v2-from>
              <label class="erp-text-sm erp-text-muted" for="v2rp-to">إلى</label>
              <input class="erp-input" id="v2rp-to" type="date" data-v2-to>
            </span>
            <button type="button" class="erp-btn erp-btn--sm erp-no-print" data-v2-reload aria-label="تحديث">
              <i class="ji" data-i="refresh" aria-hidden="true"></i><span>تحديث</span>
            </button>
            <button type="button" class="erp-btn erp-btn--sm erp-no-print" data-v2-print aria-label="طباعة">
              <i class="ji" data-i="printer" aria-hidden="true"></i><span>طباعة</span>
            </button>
          </div>
        </div>

        <div data-v2-kpis data-v2-pos></div>

        <section class="erp-card" data-v2-pos>
          <div class="erp-card__head">
            <h3 class="erp-card__title">طرق الدفع
              <span class="erp-eyebrow" dir="ltr" lang="en">Payments</span>
            </h3>
            <span class="erp-grow"></span>
            <span class="erp-text-sm erp-text-muted" data-v2-pay-note></span>
          </div>
          <div class="erp-card__body">
            <div data-v2-payments></div>
          </div>
        </section>

        <section class="erp-card" data-v2-pos>
          <div class="erp-card__head">
            <h3 class="erp-card__title"><span data-v2-dims-word>الأقسام</span> الأعلى صافيًا
              <span class="erp-eyebrow" dir="ltr" lang="en">By Dimension</span>
            </h3>
            <span class="erp-grow"></span>
            <span class="erp-text-sm erp-text-muted" data-v2-dims-note></span>
          </div>
          <div class="erp-card__body">
            <div data-v2-dims></div>
          </div>
        </section>

        <section class="erp-card" data-v2-pos>
          <div class="erp-card__head">
            <h3 class="erp-card__title">سجل الفترة
              <span class="erp-eyebrow" dir="ltr" lang="en">Period Register</span>
              <span class="erp-text-muted erp-text-sm" data-v2-count></span>
            </h3>
          </div>
          <div class="erp-card__body erp-stack">
            <p class="erp-text-sm erp-text-muted">
              قراءة فقط — التقرير من وجه الخادم الحالي
              (<span class="erp-addr" dir="ltr">/api/pos/reports/sales</span>)، والصلاحية
              قررها الخادم وحده. الأرقام مجاميع SQL على الفترة المطلوبة، ولا تُعدّ هنا من
              الجدول المرئي. ما يُعدّ: فواتير بحالة <span class="erp-mono" dir="ltr">issued</span>
              أو <span class="erp-mono" dir="ltr">reported</span> فقط — المرتجعات والملغاة ليست
              في هذا التقرير، وهي قاعدة الخادم لا تصفية من هنا.
              <span class="erp-text-muted">الفترة والتجميع يسألان الخادم من جديد؛ ومربع البحث
              داخل الجدول يضيق ما عاد منه وحده.</span>
              <span data-v2-currency-note hidden>تعذّرت قراءة وحدة المال من الإعدادات — المبالغ تُعرض بلا وحدة.</span>
              <span data-v2-cap-note hidden>بُعد الأصناف مقيد في الخادم بأول 200 صنفًا (LIMIT) — الجدول لا يعرض كله، والمؤشرات من الفترة كاملة.</span>
              <span data-v2-scope-note hidden></span>
            </p>
            <p class="erp-text-sm erp-text-muted" data-v2-filter-note hidden></p>
            <p class="erp-print-note" data-v2-print-note></p>
            <div data-v2-table></div>
          </div>
        </section>

        <section class="erp-card" data-v2-extra-wrap hidden>
          <div class="erp-card__head">
            <h3 class="erp-card__title" data-v2-extra-title>التقرير</h3>
          </div>
          <div class="erp-card__body erp-stack">
            <div data-v2-extra></div>
          </div>
        </section>
      </div>`;
}

/**
 * @param {ParentNode} host where the screen is inserted
 * @param {{role?: string|null, notify?: (message:string, kind?:string)=>void}} [ctx]
 * @returns {{el: HTMLElement, reload: ()=>Promise<void>, getRows: ()=>any[], destroy: ()=>void}}
 */
export function mountReportsScreen(host, ctx = {}) {
    const notify = typeof ctx.notify === 'function' ? ctx.notify : (m) => console.info('[V2 reports]', m);

    let period = 'month';
    let groupBy = 'department';
    let currency = '';
    let currencyRead = false;
    let rows = [];
    let summary = {};
    let meta = { startDate: '', endDate: '', capped: false, filters: { departmentId: null, cashierId: null } };
    let loading = false;
    let queued = false;
    let table = null;

    host.insertAdjacentHTML('beforeend', template(period, groupBy));
    const el = host.lastElementChild;
    const q = (sel) => el.querySelector(sel);
    const scopeLine = q('[data-v2-scope-line]');
    const kpisHost = q('[data-v2-kpis]');
    const paymentsHost = q('[data-v2-payments]');
    const payNote = q('[data-v2-pay-note]');
    const dimsHost = q('[data-v2-dims]');
    const dimsWord = q('[data-v2-dims-word]');
    const dimsNote = q('[data-v2-dims-note]');
    const countEl = q('[data-v2-count]');
    const filterNote = q('[data-v2-filter-note]');
    const printNote = q('[data-v2-print-note]');
    const currencyNote = q('[data-v2-currency-note]');
    const capNote = q('[data-v2-cap-note]');
    const scopeNote = q('[data-v2-scope-note]');
    const fromInput = q('[data-v2-from]');
    const toInput = q('[data-v2-to]');

    /* ── Table: one column set per dimension ───────────────────────────── */

    /** Rebuilt when the dimension changes. A header that no longer names its
     *  column would be a lie, and `createDataTable` freezes its columns at
     *  creation — so the honest move is a new table, not a patched header. */
    function mountTable() {
        if (table) {table.destroy();}
        const moneyCols = [
            {
                key: 'subtotalSales', header: 'قبل الضريبة', sortable: true, type: 'number',
                width: '130px', align: 'end', value: (r) => r.subtotalSales,
                render: (r) => moneyCell(r.subtotalSales, currency, { title: 'SUM(subtotal) كما في الفاتورة' }),
            },
            {
                key: 'discountTotal', header: 'الخصم', sortable: true, type: 'number',
                width: '110px', align: 'end', value: (r) => r.discountTotal,
                render: (r) => moneyCell(r.discountTotal, currency, { title: 'SUM(discount_total) — الصفر يعني لا خصم مسجّل' }),
            },
            {
                key: 'taxTotal', header: 'الضريبة', sortable: true, type: 'number',
                width: '110px', align: 'end', value: (r) => r.taxTotal,
                render: (r) => moneyCell(r.taxTotal, currency, { title: 'SUM(tax_total) كما في الفاتورة' }),
            },
            {
                key: 'netSales', header: 'الصافي', sortable: true, type: 'number',
                width: '140px', align: 'end', value: (r) => r.netSales,
                render: (r) => moneyCell(r.netSales, currency, { title: 'SUM(total_amount) — ترتيب الخادم على هذا العمود' }),
            },
        ];
        const isItem = groupBy === 'item';
        const columns = [
            {
                key: 'dimensionName', header: DIM_LABEL[groupBy], sortable: true, filterable: true,
                render: dimCell,
            },
            ...(isItem
                ? [{
                    key: 'departmentName', header: 'القسم', sortable: true, filterable: true, width: '130px',
                    render: (r) => (r.departmentName ? esc(r.departmentName)
                        : `<span class="erp-text-muted" title="عمود department_name فارغ في سطور الطلب">بلا قسم</span>`),
                }]
                : []),
            {
                key: 'invoiceCount', header: 'الفواتير', sortable: true, type: 'number', width: '100px',
                align: 'end', value: (r) => r.invoiceCount,
                render: (r) => intCell(r.invoiceCount, { title: isItem ? 'COUNT(DISTINCT order_id) — عدد الفواتير التي اشتملت على الصنف' : 'COUNT(*) لفواتير الفترة' }),
            },
            ...(isItem
                ? [{
                    key: 'quantitySold', header: 'الكمية', sortable: true, type: 'number', width: '110px',
                    align: 'end', value: (r) => r.quantitySold,
                    render: (r) => qtyCell(r.quantitySold, { title: 'SUM(quantity) من سطور الطلب — كما حسبه الخادم بـ3 منازل' }),
                }]
                : [
                    {
                        key: 'itemsQty', header: 'الكمية', sortable: true, type: 'number', width: '110px',
                        align: 'end', value: (r) => r.itemsQty,
                        render: (r) => qtyCell(r.itemsQty, { title: 'SUM(quantity) لسطور هذا البُعد' }),
                    },
                    {
                        key: 'uniqueItems', header: 'أصناف مختلفة', sortable: true, type: 'number', width: '120px',
                        align: 'end', value: (r) => r.uniqueItems,
                        render: (r) => intCell(r.uniqueItems, { title: 'COUNT(DISTINCT product_id) — عدّ من الخادم' }),
                    },
                    {
                        key: 'avgTicket', header: 'متوسط الفاتورة', sortable: true, type: 'number', width: '140px',
                        align: 'end', value: (r) => r.avgTicket,
                        render: (r) => moneyCell(r.avgTicket, currency, { title: 'AVG(total_amount) لهذا البُعد' }),
                    },
                ]),
            ...moneyCols,
        ];

        table = createDataTable({
            caption: `سجل المبيعات حسب ${GROUP_AR[groupBy]} — بيانات حية`,
            mode: 'client',
            pageSize: 20,
            stickyHeader: true,
            emptyMessage: 'لا صفوف في هذه الفترة',
            emptyHint: 'غيّر الفترة أو البُعد؛ الخادم هو من قرر ماذا يعود.',
            rowKey: (row) => `${groupBy}:${row.dimensionId ?? row.dimensionName}`,
            columns,
        });
        q('[data-v2-table]').appendChild(table.el);
    }

    /* ── Params: what the server is asked for ──────────────────────────── */

    function range() {
        return periodRange(period, { startDate: fromInput.value, endDate: toInput.value });
    }

    /** Is this answer still about what the screen asks for? */
    function stale(asked) {
        const r = range();
        return asked.groupBy !== groupBy || asked.startDate !== r.startDate
            || asked.endDate !== r.endDate;
    }

    /* ── Paint ────────────────────────────────────────────────────────── */

    function paint() {
        const label = range().label;
        scopeLine.textContent = `${label} · ${meta.startDate} ← ${meta.endDate} · حسب ${GROUP_AR[groupBy]} · ${formatInt(rows.length)} صفًا`;

        kpisHost.innerHTML = kpiStrip(buildReportKpis(summary, {
            currency, scopeLabel: label, capped: meta.capped,
        }), label);

        const pay = paymentBreakdown(summary.payment_methods);
        paymentsHost.innerHTML = paymentsBlock(pay, currency);
        payNote.textContent = pay.rows.length
            ? `${formatInt(pay.rows.length)} طريقة · المدفوع ${formatMoney(pay.total, currency).amount}${currency ? ` ${currency}` : ''}`
            : '';

        dimsWord.textContent = GROUP_AR[groupBy];
        dimsHost.innerHTML = dimsBlock(rows, groupBy, currency);
        dimsNote.textContent = rows.length > TOP_PORTLET
            ? `أول ${formatInt(TOP_PORTLET)} من ${formatInt(rows.length)} — ترتيب الخادم، والباقي في الجدول`
            : (rows.length ? `${formatInt(rows.length)} ${DIM_COUNT_NOUN[groupBy]}` : '');

        table.setRows(rows);
        countEl.textContent = `(${formatInt(rows.length)})`;

        // paint() only ever runs after a currency read, so a missing unit here
        // is a failed read, not a pending one — and the note says exactly that.
        currencyNote.hidden = !!currency;
        capNote.hidden = !meta.capped;
        // The server echoes its own scoping (:1138). For a cashier that id is
        // the user's own whether or not one was asked for (:968-971), so the
        // screen reports the echo instead of claiming a filter the operator
        // never set.
        const echo = meta.filters.cashierId ?? meta.filters.departmentId;
        scopeNote.hidden = !echo;
        if (echo) {
            scopeNote.textContent = `الخادم حصر النتيجة على المعرّف ${formatInt(echo)} (${meta.filters.cashierId ? 'كاشير' : 'قسم'}) — هذا قراره، لا فلتر من هذه الشاشة.`;
        }

        printNote.textContent = `تقرير ${label} (${meta.startDate} ← ${meta.endDate}) حسب ${GROUP_AR[groupBy]} — ${formatInt(rows.length)} صفًا. المطبوعة تعرض الصفحة الحالية من الجدول، لا الفترة كاملة.`;
        filterNote.hidden = period === 'month' && groupBy === 'department';
        if (!filterNote.hidden) {
            filterNote.textContent = `التقرير مطلوب بالفترة «${label}» (${meta.startDate} ← ${meta.endDate}) وبُعد ${GROUP_AR[groupBy]} — المجاميع من الخادم على هذا الطلب وحده، والمؤشرات لا تُشتق من الصفوف المرئية.`;
        }
    }

    /* ── Load ─────────────────────────────────────────────────────────── */
    async function reload() {
        if (loading) {queued = true; return;}       // never stack two reports
        loading = true;
        table.setLoading(true);
        // What THIS request asks for. A newer intent can only arrive through
        // reload(), and it sets `queued`, so dropping a late answer here is
        // always safe — the newest one is already on its way.
        const r = range();
        const asked = { groupBy, startDate: r.startDate, endDate: r.endDate };
        try {
            // The two date rules belong to the repository, which rejects a
            // missing or reversed range with the server's own words
            // (shift-routes.js:124-134,:942-944) before any request leaves.
            // A currency read never sinks a report that arrived: it fails to
            // an empty unit, and the register says the unit is unknown.
            const [report, cur] = await Promise.all([
                fetchSalesReport({ startDate: r.startDate, endDate: r.endDate, groupBy }),
                currencyRead ? Promise.resolve(currency) : fetchCurrency().catch(() => ''),
            ]);
            if (!el.isConnected) {return;}          // destroyed while in flight
            // Rows shaped for one dimension cannot be painted under another's
            // headers, and a stale range would be labelled with the current
            // period's name. The screen answers only what it still asks.
            if (stale(asked)) {return;}

            currency = String(cur ?? '');
            currencyRead = true;
            meta = { startDate: report.startDate, endDate: report.endDate, capped: report.capped, filters: report.filters };
            summary = report.summary;
            // Mapped with THIS screen's dimension, because the mounted columns
            // were built for it — the rows and their headers cannot drift.
            rows = report.rows.map((row) => reportToRow(row, groupBy));
            paint();
            if (!rows.length) {
                notify('لا فواتير في هذه الفترة عند الخادم — لا رقم يُختلق لصف غائب.');
            }
        } catch (e) {
            if (!el.isConnected) {return;}
            // A newer intent owns the screen now; its own outcome will speak.
            if (stale(asked)) {return;}
            rows = [];
            summary = {};
            // The header line opened with «القراءة جارية»; after a failure it
            // must not keep claiming a read that already ended. The register
            // below says why, so the line goes silent rather than wrong.
            scopeLine.textContent = '';
            table.setRows([]);
            kpisHost.innerHTML = '';
            paymentsHost.innerHTML = '';
            dimsHost.innerHTML = '';
            countEl.textContent = '';
            payNote.textContent = '';
            dimsNote.textContent = '';
            const message = (e && e.message) || 'خطأ';
            table.setError(message === 'UNAUTHORIZED'
                ? 'انتهت الجلسة — سجّل الدخول في النظام الحالي ثم أعد فتح الوضع الحيّ.'
                : (e && e.code === 'FORBIDDEN'
                    ? 'لا صلاحية لقراءة التقارير بهذا الحساب — القرار للخادم وحده.'
                    : `تعذّر تحميل التقرير: ${message}`));
        } finally {
            table.setLoading(false);
            loading = false;
            if (queued && el.isConnected) {
                queued = false;
                reload();                            // the newest request wins
            }
        }
    }

    /* ── Wiring (delegated; no inline handlers) ───────────────────────── */
    el.addEventListener('click', (event) => {
        if (event.target.closest('[data-v2-reload]')) {reload(); return;}
        if (event.target.closest('[data-v2-print]')) {printActive(); return;}
        const yprev = event.target.closest('[data-v2-y_prev]');
        if (yprev && !yprev.disabled) {yPage = Math.max(1, yPage - 1); loadExtra(); return;}
        const ynext = event.target.closest('[data-v2-y_next]');
        if (ynext && !ynext.disabled) {yPage += 1; loadExtra(); return;}
        const yinv = event.target.closest('[data-v2-yinv]');
        if (yinv) {openYInvoice(yinv.dataset.v2Yinv); return;}
        const seg = event.target.closest('[data-v2-period]');
        if (seg) {
            period = seg.getAttribute('data-v2-period');
            q('[data-v2-periodseg]').innerHTML = periodSeg(period);
            if (period !== 'custom') {
                // The dates the operator is about to see are the dates that
                // will be sent, so they are written before the request.
                const r = periodRange(period, {});
                fromInput.value = r.startDate;
                toInput.value = r.endDate;
            }
            if (extraType) {loadExtra(); return;}
            reload();
            return;
        }
        const grp = event.target.closest('[data-v2-group]');
        if (grp) {
            groupBy = grp.getAttribute('data-v2-group');
            q('[data-v2-groupseg]').innerHTML = groupSeg(groupBy);
            mountTable();                            // new dimension, new columns
            reload();
            return;
        }
        // The table's own retry button clears the error but cannot refetch in
        // client mode — the host owns the data, so the refetch lives here.
        if (event.target.closest('[data-erp-retry]')) {reload();}
    });

    el.addEventListener('change', (event) => {
        if (event.target.matches('[data-v2-type]')) {setType(event.target.value); return;}
        if (event.target.matches('[data-v2-dept]')) {loadExtra(); return;}
        if (event.target.matches('[data-v2-y_view]')) {yView = event.target.value; yPage = 1; loadExtra(); return;}
        if (event.target.matches('[data-v2-y_cashier]')) {yCashier = event.target.value; yPage = 1; loadExtra(); return;}
        if (!event.target.matches('[data-v2-from], [data-v2-to]')) {return;}
        // Typing a date IS choosing the custom period; the segment follows the
        // controls instead of lying about what is being sent.
        period = 'custom';
        q('[data-v2-periodseg]').innerHTML = periodSeg(period);
        if (extraType) {loadExtra(); return;}
        reload();
    });

    /* ── Extra report types (9 beyond POS) ────────────────────────────────
     *  Same doors and same computations as features/reports.js:268-670.
     *  POS blocks hide while an extra type paints; the type selector,
     *  not the dimension segments, owns the screen then. */

    let extraType = '';
    let bundle = null;
    let yView = 'items';
    let yCashier = '';
    let yPage = 1;

    const EXTRA_AR = {
        general: 'التقرير الشامل', department: 'تقرير الأقسام', kitchen: 'تقرير المطبخ',
        returns: 'تقرير المرتجعات', warehouse: 'تقرير المخازن والمخزون',
        hr: 'تقرير الموارد البشرية', 'dept-specific': 'تقرير قسم محدد',
        'yara-departments': 'إيرادات الأقسام من يارا', 'yara-cashiers': 'مبيعات الكاشيرية من يارا',
    };

    function fD2(v) {
        if (!v) {return '—';}
        const d = new Date(String(v).length <= 10 ? `${v}T12:00:00` : v);
        return Number.isNaN(d.getTime()) ? String(v).slice(0, 10)
            : d.toLocaleDateString('ar-EG', { day: '2-digit', month: 'short', year: 'numeric' });
    }

    function xKpi(icon, label, en, value, unit, hint) {
        return { icon, label, en, value, unit, pill: { aria: hint, text: hint }, hint };
    }

    function xTable(heads, rowsHtml, emptyText) {
        return `<div class="erp-table__scroll"><table class="erp-table__grid"><thead><tr>`
            + heads.map((h) => `<th>${esc(h)}</th>`).join('') + `</tr></thead><tbody>`
            + (rowsHtml || `<tr><td class="erp-td" colspan="${heads.length}">${esc(emptyText)}</td></tr>`)
            + `</tbody></table></div>`;
    }

    function xHead(subtitle) {
        const r = range();
        const by = ctx.userName ? ` · بواسطة ${ctx.userName}` : '';
        return `<p class="erp-text-sm erp-text-muted">${esc(subtitle)} — الفترة ${esc(r.startDate)} ← ${esc(r.endDate)} · أُصدر ${esc(new Date().toLocaleString('ar-EG'))}${esc(by)}</p>`;
    }

    function setPosVisible(on) {
        for (const n of el.querySelectorAll('[data-v2-pos]')) {n.hidden = !on;}
        const wrap = q('[data-v2-extra-wrap]');
        if (wrap) {wrap.hidden = on;}
        const ds = q('[data-v2-deptsel]');
        if (ds) {ds.hidden = !(extraType === 'dept-specific');}
    }

    async function ensureBundle() {
        if (!bundle) {bundle = await fetchLocalBundle();}
        if (!currencyRead) {
            try {currency = String(await fetchCurrency().catch(() => '') ?? '');}
            catch {currency = '';}
            currencyRead = true;
        }
        const ds = q('[data-v2-dept]');
        if (ds && !ds.options.length) {
            ds.innerHTML = (bundle.departments || []).map((d) => `<option value="${esc(d.code)}">${esc(d.name)}</option>`).join('');
        }
        return bundle;
    }

    function extraMoney(v) {
        const m = formatMoney(v, currency);
        return `<span class="erp-num" dir="ltr">${esc(m.amount)}</span>${m.hasUnit ? ` <span class="erp-text-sm erp-text-muted">${esc(m.unit)}</span>` : ''}`;
    }

    async function buildExtraHtml() {
        const t = extraType;
        const r = range();
        const b = await ensureBundle();
        if (t === 'general') {
            const g = computeGeneral(b, r.startDate, r.endDate);
            const ratio = g.totalRev > 0 ? ((g.totalExp / g.totalRev) * 100).toFixed(1) : '0.0';
            return xHead(EXTRA_AR.general)
                + kpiStrip([
                    xKpi('banknote', 'إجمالي الإيرادات', 'Revenue', formatMoney(g.totalRev, currency).amount, currency, `${formatInt(g.count)} معاملة`),
                    xKpi('wallet', 'إجمالي المصاريف', 'Expenses', formatMoney(g.totalExp, currency).amount, currency, 'تشغيلية + مخزون + فروق'),
                    xKpi('trending-up', 'صافي الربح', 'Net', formatMoney(g.profit, currency).amount, currency, `نسبة التكلفة ${ratio}%`),
                ], 'الشامل')
                + `<h4>ملخص المعاملات (آخر 30)</h4>`
                + xTable(['التاريخ', 'النوع', 'البيان', 'المبلغ'], g.sample.map((it) => {
                    const kind = it.kind === 'revenue' ? 'إيراد' : (it.kind === 'operating' ? 'مصروف' : 'حركة مخزون');
                    const label = it.kind === 'revenue'
                        ? esc(it.ref.notes || it.ref.source || '—')
                        : esc(it.ref.notes || it.ref.desc || it.ref.source || '—');
                    return `<tr><td class="erp-td">${esc(fD2(it.date))}</td><td class="erp-td">${esc(kind)}</td><td class="erp-td">${label}</td><td class="erp-td">${extraMoney(it.ref.amount)}</td></tr>`;
                }).join(''), 'لا معاملات في الفترة');
        }
        if (t === 'department' || t === 'dept-specific') {
            const rows = computeDepartments(b, r.startDate, r.endDate);
            const list = t === 'dept-specific'
                ? rows.filter((x) => String(x.code) === String(q('[data-v2-dept]')?.value || rows[0]?.code))
                : rows;
            const row = list[0];
            const head = t === 'dept-specific' && row
                ? `<h4>${esc(row.name)} <span class="erp-text-muted erp-mono" dir="ltr">${esc(row.code)}</span></h4>` : '';
            return xHead(EXTRA_AR[t])
                + (t === 'department' ? kpiStrip([xKpi('building', 'الأقسام النشطة', 'Departments', formatInt(rows.length), '', 'حسب دليل الأقسام')], 'الأقسام') : '')
                + head
                + xTable(['القسم', 'الإيرادات', 'المصاريف', 'الصافي', 'التكلفة%'],
                    list.map((x) => `<tr><td class="erp-td"><b>${esc(x.name)}</b></td><td class="erp-td">${extraMoney(x.rev)}</td><td class="erp-td">${extraMoney(x.exp)}</td><td class="erp-td">${extraMoney(x.profit)}</td><td class="erp-td erp-num" dir="ltr">${esc(Number(x.costRatio).toFixed(1))}%</td></tr>`).join(''),
                    t === 'dept-specific' ? 'القسم غير موجود' : 'لا أقسام');
        }
        if (t === 'kitchen') {
            const k = computeKitchen(b, r.startDate, r.endDate);
            return xHead(EXTRA_AR.kitchen)
                + kpiStrip([
                    xKpi('circle-check', 'طلبات معتمدة', 'Approved', formatInt(k.count), '', 'صرف المطبخ المعتمد'),
                    xKpi('wallet', 'قيمة المستهلك', 'Consumed', formatMoney(k.totalValue, currency).amount, currency, 'بقيم الاعتماد'),
                    xKpi('utensils', 'وصفات نشطة', 'Recipes', formatInt(k.recipesCount), '', 'دليل الوصفات'),
                ], 'المطبخ')
                + `<h4>سجل صرف المطبخ المعتمد</h4>`
                + xTable(['التاريخ', 'القسم الطالب', 'الأصناف', 'القيمة'],
                    k.rows.map((x) => `<tr><td class="erp-td">${esc(fD2(x.date))}</td><td class="erp-td">${esc(x.dept)}</td><td class="erp-td"><small>${esc(x.itemsText)}</small></td><td class="erp-td">${extraMoney(x.value)}</td></tr>`).join(''),
                    'لا توجد عمليات صرف معتمدة في هذه الفترة');
        }
        if (t === 'returns') {
            const k = computeReturns(b, r.startDate, r.endDate);
            return xHead(EXTRA_AR.returns)
                + kpiStrip([
                    xKpi('undo', 'عدد المرتجعات', 'Count', formatInt(k.count), '', 'مرتجعات المطبخ'),
                    xKpi('banknote', 'القيمة المعكوسة', 'Reversed', formatMoney(k.total, currency).amount, currency, 'تُخصم من المصروف'),
                ], 'المرتجعات')
                + `<h4>سجل المرتجعات</h4>`
                + xTable(['التاريخ', 'القسم', 'الأصناف', 'السبب', 'القيمة'],
                    k.rows.map((x) => `<tr><td class="erp-td">${esc(fD2(x.date))}</td><td class="erp-td">${esc(x.deptName || '—')}</td><td class="erp-td"><small>${esc((x.items || []).map((i) => `${i.name || i.itemName} (${i.qty})`).join('، '))}</small></td><td class="erp-td">${esc(x.reason || '—')}</td><td class="erp-td">${extraMoney(x.totalValue || 0)}</td></tr>`).join(''),
                    'لا توجد مرتجعات في هذه الفترة');
        }
        if (t === 'warehouse') {
            const k = computeWarehouse(b);
            return xHead(EXTRA_AR.warehouse)
                + kpiStrip([
                    xKpi('banknote', 'قيمة المخزون', 'Value', formatMoney(k.totalValue, currency).amount, currency, 'كمية × متوسط التكلفة'),
                    xKpi('package', 'عدد الأصناف', 'Items', formatInt(k.itemCount), '', 'دليل المخزون'),
                    xKpi('scale', 'إجمالي الوزن', 'Weight', `${formatQty(k.totalWeight)} كجم`, '', 'الأصناف الموزونة'),
                    xKpi('alert-triangle', 'تحت الحد الأدنى', 'Low', formatInt(k.low.length), '', k.low.length ? 'تحتاج طلب شراء' : 'لا نواقص'),
                ], 'المخزون')
                + (k.low.length ? `<h4>تنبيهات المخزون المنخفض</h4>`
                    + xTable(['الصنف', 'الفئة', 'المتوفر', 'الحد الأدنى', 'النقص'],
                        k.low.map((i) => `<tr><td class="erp-td"><b>${esc(i.name)}</b></td><td class="erp-td">${esc(i.category || '—')}</td><td class="erp-td erp-num" dir="ltr">${formatQty(i.qty)} ${esc(i.unit || '')}</td><td class="erp-td erp-num" dir="ltr">${formatQty(i.minQty)} ${esc(i.unit || '')}</td><td class="erp-td erp-num" dir="ltr">${formatQty(Number(i.minQty) - Number(i.qty))} ${esc(i.unit || '')}</td></tr>`).join(''), '') : '')
                + `<p class="erp-text-sm erp-text-muted">توزيع الرفوف غير معروض بقرار المالك (لا أرفف ولا موازين).</p>`;
        }
        if (t === 'hr') {
            const att = await fetchHrAttendance(r.startDate, r.endDate);
            const k = computeHr(b, att, r.startDate, r.endDate);
            return xHead(EXTRA_AR.hr)
                + kpiStrip([
                    xKpi('users', 'إجمالي الموظفين', 'Staff', formatInt(k.total), '', 'سجل الموارد'),
                    xKpi('circle-check', 'نشطون', 'Active', formatInt(k.activeCount), '', 'على رأس العمل'),
                    xKpi('banknote', 'الرواتب الشهرية', 'Payroll', formatMoney(k.salaries, currency).amount, currency, 'مجموع النشطين'),
                    xKpi('calendar', 'إجازات الفترة', 'Leaves', formatInt(k.leavesCount), '', 'طلبات الإجازات'),
                ], 'الموارد')
                + `<h4>قائمة الموظفين</h4>`
                + xTable(['الرقم', 'الاسم', 'القسم', 'المنصب', 'الراتب', 'الحضور'],
                    k.rows.map((x) => `<tr><td class="erp-td erp-mono" dir="ltr">${esc(x.id || '—')}</td><td class="erp-td"><b>${esc(x.name)}</b></td><td class="erp-td">${esc(x.dept || '—')}</td><td class="erp-td">${esc(x.position || '—')}</td><td class="erp-td">${extraMoney(x.salary)}</td><td class="erp-td erp-num" dir="ltr">${formatInt(x.days)} يوم</td></tr>`).join(''),
                    'لا موظفين');
        }
        if (t === 'yara-departments') {
            const group = period === 'month' ? 'month' : (period === 'year' ? 'year' : 'day');
            const d = await fetchYaraDepartments({ from: r.startDate, to: r.endDate, group });
            const tt = d.totals || {};
            const gName = group === 'month' ? 'شهري' : (group === 'year' ? 'سنوي' : 'يومي');
            return xHead(`${EXTRA_AR[t]} (${gName})`)
                + kpiStrip([
                    xKpi('banknote', 'إجمالي الإيراد', 'Gross', formatMoney(tt.gross || 0, currency).amount, currency, ''),
                    xKpi('tag', 'المرتجعات', 'Refunds', formatMoney(tt.refund || 0, currency).amount, currency, ''),
                    xKpi('gem', 'الصافي', 'Net', formatMoney(tt.net || 0, currency).amount, currency, `${formatInt(tt.invoices || 0)} فاتورة`),
                ], 'يارا')
                + xTable(['الفترة', 'القسم', 'الإيراد', 'المرتجعات', 'الصافي', 'الفواتير'],
                    d.rows.map((x) => `<tr><td class="erp-td">${esc(x.period || '—')}</td><td class="erp-td"><b>${esc(x.dept_name || '—')}</b></td><td class="erp-td">${extraMoney(x.gross || 0)}</td><td class="erp-td">${extraMoney(x.refund || 0)}</td><td class="erp-td">${extraMoney(x.net || 0)}</td><td class="erp-td erp-num" dir="ltr">${formatInt(x.invoices || 0)}</td></tr>`).join(''),
                    'لا توجد إغلاقات يومية ضمن الفترة — شغّل التعبئة من صفحة استيراد Yarasoft');
        }
        if (t === 'yara-cashiers') {
            const d = await fetchYaraCashierItems({ from: r.startDate, to: r.endDate, view: yView, cashier: yCashier, limit: 100, page: yPage });
            yPage = d.page;
            const tt = d.totals || {};
            const cashierOpts = `<option value="">كل الكاشيرية</option>` + d.cashiers.map((c) => `<option value="${esc(String(c.no))}"${String(yCashier) === String(c.no) ? ' selected' : ''}>${esc(c.name)}</option>`).join('');
            const isInv = d.view === 'invoices';
            const detailRows = d.rows.map((x) => {
                if (!isInv) {
                    return `<tr><td class="erp-td"><b>${esc(x.cashier_name || '—')}</b></td><td class="erp-td"><b>${esc(x.item_name || '—')}</b></td><td class="erp-td">${esc(x.unit || '—')}</td><td class="erp-td erp-num" dir="ltr">${formatInt(x.invoices || 0)}</td><td class="erp-td erp-num" dir="ltr">${formatQty(x.qty || 0)}</td><td class="erp-td">${extraMoney(x.avg_price || 0)}</td><td class="erp-td">${extraMoney(x.net || 0)}</td><td class="erp-td">${extraMoney(x.discount || 0)}</td><td class="erp-td">${extraMoney(x.vat || 0)}</td></tr>`;
                }
                return `<tr><td class="erp-td"><button type="button" class="erp-btn erp-btn--sm erp-mono" dir="ltr" data-v2-yinv="${esc(String(x.doc_no))}"><b>${esc(String(x.doc_no))}</b></button></td><td class="erp-td">${esc(x.day || '—')}</td><td class="erp-td">${esc(x.cashier_name || '—')}</td><td class="erp-td">${esc(x.shift ?? '—')}</td><td class="erp-td erp-num" dir="ltr">${formatInt(x.lines || 0)}</td><td class="erp-td">${extraMoney(x.total || 0)}</td><td class="erp-td">${extraMoney(x.discount || 0)}</td><td class="erp-td">${extraMoney(x.net || 0)}</td><td class="erp-td">${extraMoney(x.paid || 0)}</td></tr>`;
            }).join('');
            return xHead(EXTRA_AR[t])
                + `<div class="erp-dash-controls erp-no-print">`
                + `<label class="erp-text-sm erp-text-muted">الكاشير</label><select class="erp-input" data-v2-y_cashier>${cashierOpts}</select>`
                + `<label class="erp-text-sm erp-text-muted">العرض</label><select class="erp-input" data-v2-y_view><option value="items"${yView === 'items' ? ' selected' : ''}>الأصناف المباعة</option><option value="invoices"${yView === 'invoices' ? ' selected' : ''}>الفواتير</option></select>`
                + `</div>`
                + kpiStrip([
                    xKpi('banknote', 'صافي المبيعات', 'Net', formatMoney(tt.net || 0, currency).amount, currency, `${formatInt(tt.invoices || 0)} فاتورة`),
                    xKpi('tag', 'الخصومات', 'Discount', formatMoney(tt.discount || 0, currency).amount, currency, ''),
                    xKpi('users', 'الكاشيرية النشطة', 'Cashiers', formatInt(d.cashiers.length), '', 'ضمن الفترة'),
                ], 'الكاشيرية')
                + xTable(['الكاشير', 'الفواتير', 'الصافي', 'الخصم', 'متوسط الفاتورة'],
                    d.cashiers.map((c) => `<tr><td class="erp-td"><b>${esc(c.name)}</b></td><td class="erp-td erp-num" dir="ltr">${formatInt(c.invoices || 0)}</td><td class="erp-td">${extraMoney(c.net || 0)}</td><td class="erp-td">${extraMoney(c.discount || 0)}</td><td class="erp-td">${extraMoney(c.invoices ? c.net / c.invoices : 0)}</td></tr>`).join(''),
                    'لا توجد مبيعات كاشيرية ضمن الفترة')
                + (isInv
                    ? `<h4>فواتير الكاشيرية (الأحدث أولًا — اضغط الرقم للتفصيل)</h4>`
                        + xTable(['الفاتورة', 'اليوم', 'الكاشير', 'الوردية', 'الأصناف', 'الإجمالي', 'الخصم', 'الصافي', 'المدفوع'], detailRows, 'لا توجد فواتير ضمن الفترة')
                        + `<div class="erp-dash-controls erp-no-print"><button type="button" class="erp-btn erp-btn--sm" data-v2-y_prev${d.page <= 1 ? ' disabled' : ''}>السابق</button>`
                        + `<span class="erp-text-sm erp-text-muted">صفحة ${formatInt(d.page)} من ${formatInt(d.pages)} — ${formatInt(d.total)} فاتورة</span>`
                        + `<button type="button" class="erp-btn erp-btn--sm" data-v2-y_next${d.page >= d.pages ? ' disabled' : ''}>التالي</button></div>`
                        + `<div data-v2-y_detail></div>`
                    : `<h4>المباع تفصيلًا: الكاشير × الصنف</h4>`
                        + xTable(['الكاشير', 'الصنف', 'الوحدة', 'الفواتير', 'الكمية', 'متوسط السعر', 'الصافي', 'الخصم', 'الضريبة'], detailRows, 'لا توجد أصناف مباعة ضمن الفترة — وسّع الفترة أو تحقق من سحب يارا'))
                + `<p class="erp-text-sm erp-text-muted">المصدر: قاعدة يارا سوفت Oracle مباشرة — الكاشير 2 الداخلي مستثنى.</p>`;
        }
        return '';
    }

    async function loadExtra() {
        const t = extraType;
        const box = q('[data-v2-extra]');
        const titleEl = q('[data-v2-extra-title]');
        if (titleEl) {titleEl.textContent = EXTRA_AR[t] || 'التقرير';}
        box.innerHTML = '<p class="erp-text-sm erp-text-muted">جارٍ إعداد التقرير…</p>';
        try {
            const html = await buildExtraHtml();
            if (t !== extraType || !el.isConnected) {return;}
            box.innerHTML = html;
        } catch (e) {
            if (t !== extraType || !el.isConnected) {return;}
            box.innerHTML = `<p class="erp-text-sm erp-text-muted">تعذّر إنشاء التقرير: ${esc((e && e.message) || 'خطأ')}</p>`;
        }
    }

    function setType(v) {
        if (v && v.startsWith('pos-')) {
            extraType = '';
            const g = v.slice(4);
            if (groupBy !== g) {
                groupBy = g;
                q('[data-v2-groupseg]').innerHTML = groupSeg(groupBy);
                mountTable();
            }
            setPosVisible(true);
            reload();
            return;
        }
        extraType = v;
        yPage = 1;
        setPosVisible(false);
        loadExtra();
    }

    function printDoc(title, bodyHtml) {
        const w = openInAppReport(title);
        const tmp = document.createElement('div');
        tmp.innerHTML = bodyHtml;
        tmp.querySelectorAll('.erp-no-print,button,select,input').forEach((n) => n.remove());
        w.document.write(`<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="UTF-8"><title>${esc(title)}</title>`
            + `<style>body{font-family:'Cairo','Tajawal',sans-serif;padding:28px;color:#1a1a1a;direction:rtl;font-size:10pt}`
            + `h4{font-size:12pt;color:#92400e;margin:14px 0 8px}table{width:100%;border-collapse:collapse;margin-bottom:10px}th,td{border:1px solid #999;padding:6px;text-align:right}th{background:#f4ead2}`
            + `.erp-kpis{list-style:none;display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px;padding:0}.erp-kpi{border:1px solid #ddd;border-radius:6px;padding:8px;text-align:center}.controls{text-align:center;margin-bottom:16px}.controls button{padding:9px 22px;margin:0 6px;border:none;border-radius:6px;font-weight:700;cursor:pointer}.btn-print{background:#2e9e5b;color:#fff}.btn-close{background:#c0392b;color:#fff}`
            + `@media print{.controls{display:none}body{padding:0}}</style></head><body>`
            + `<div class="controls"><button type="button" class="btn-print" data-pl-print>طباعة</button><button type="button" class="btn-close" data-pl-close>إغلاق</button></div>`
            + `<h2 style="text-align:center">${esc(title)}</h2>${tmp.innerHTML}</body></html>`);
        w.document.close();
        const bp = w.document.querySelector('[data-pl-print]');
        if (bp) {bp.addEventListener('click', () => w.print());}
        const bc = w.document.querySelector('[data-pl-close]');
        if (bc) {bc.addEventListener('click', () => w.close());}
        w.focus();
    }

    function printActive() {
        if (!extraType) {window.print(); return;}
        const box = q('[data-v2-extra]');
        if (!box || !box.innerHTML.trim()) {notify('يرجى إنشاء التقرير أولاً'); return;}
        printDoc(EXTRA_AR[extraType] || 'التقرير', box.innerHTML);
    }

    async function openYInvoice(docNo) {
        const box = q('[data-v2-y_detail]');
        if (!box) {return;}
        box.innerHTML = '<p class="erp-text-sm erp-text-muted">جارٍ جلب تفاصيل الفاتورة…</p>';
        try {
            const d = await fetchYaraInvoiceDetail(docNo);
            if (!el.isConnected || extraType !== 'yara-cashiers') {return;}
            const h = d.header || {};
            box.innerHTML = `<div class="erp-table__scroll"><table class="erp-table__grid"><thead><tr><th>الصنف</th><th>الكمية</th><th>السعر</th><th>الإجمالي</th><th>الضريبة</th></tr></thead><tbody>`
                + (d.lines.map((l) => `<tr><td class="erp-td"><b>${esc(l.name || '—')}</b></td><td class="erp-td erp-num" dir="ltr">${formatQty(l.qty || 0)} ${esc(l.unit || '')}</td><td class="erp-td">${extraMoney(l.price || 0)}</td><td class="erp-td">${extraMoney(l.total || 0)}</td><td class="erp-td">${extraMoney(l.vat || 0)}</td></tr>`).join('')
                    || '<tr><td class="erp-td" colspan="5">بلا أصناف مسجلة</td></tr>')
                + `</tbody></table></div><p class="erp-text-sm erp-text-muted">فاتورة #${esc(String(docNo))} — الكاشير: ${esc(`كاشير ${(h.CSHR || '').trim()}`)} — الصافي: ${extraMoney(h.NET_VAL || 0)} — الخصم: ${extraMoney(h.DSCNT_VL || 0)}</p>`;
            box.scrollIntoView({ block: 'nearest' });
        } catch (e) {
            if (!el.isConnected) {return;}
            box.innerHTML = `<p class="erp-text-sm erp-text-muted">تعذر جلب تفاصيل الفاتورة: ${esc((e && e.message) || 'خطأ')}</p>`;
        }
    }

    /* ── First paint: show the range before anything arrives ──────────── */
    const initial = periodRange(period, {});
    fromInput.value = initial.startDate;
    toInput.value = initial.endDate;
    // The scope line names the period the first request is about to ask for —
    // an empty header while loading would read as an empty report.
    scopeLine.textContent = `${initial.label} · ${initial.startDate} ← ${initial.endDate} · حسب ${GROUP_AR[groupBy]} — القراءة جارية`;
    mountTable();
    reload();

    return {
        el,
        reload,
        getRows: () => rows,
        destroy() {
            queued = false;
            if (table) {table.destroy(); table = null;}
            el.remove();
        },
    };
}
