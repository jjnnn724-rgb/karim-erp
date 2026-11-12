/**
 * V2 — استعلام المبيعات · Sales Inquiry (قراءة فقط)
 * ═══════════════════════════════════════════════════════════════════════
 * سؤال المالك: «كل المبيعات، وكل صنف بكميته وفواتيره بكامل تفاصيلها،
 * وأقدر أطبع الفواتير» — هذه الشاشة تجيبه من الكاشيرية نفسها:
 *
 *   1) جدول أصناف الفترة (من أول الشهر افتراضيًا): كود، كمية، فواتير،
 *      صافي، ضريبة، متوسط سعر الوحدة.
 *   2) نقر الصنف → جدول فواتيره: كل فاتورة بكمية الصنف وسعره وقبل ضريبته
 *      وضريبته وشامله، وإجمالي الفاتورة وكاشيرها ووقتها، مع ترقيم من
 *      الخادم (LIMIT/OFFSET).
 *   3) نقر الفاتورة → تفاصيلها كاملة (سطور، خصم، ضريبة، مدفوع، دفع مقسّم)،
 *      وأولها بطاقة «الصنف المطلوب في هذه الفاتورة»: كميته وسعر وحدته
 *      وقبل ضريبته وضريبته وشامله وحصته من إجمالي الفاتورة — لأن سؤال
 *      المالك: «أعرف اتباع كام» لا يُجاب بإجمالي فاتورةٍ فيها أصناف أخرى.
 *   4) «طباعة الإيصال» → HTML الإيصال من /pos/orders/ys/:docNo/receipt-html
 *      يُجلب بـ fetch خام برؤوس المصادقة ثم يُكتب في عارض التطبيق
 *      (report-viewer) — لأن فتحه في تبويب جديد يسقط 401 بلا هيدر.
 *   5) «طباعة الاستعلام» → ورقة A4 من /yara-reports/item-sales/print بنفس
 *      فلترة الشاشة (فترة/كاشير/صنف) وبالهوية نفسها.
 *   6) السجل مؤرشفٌ من نظام سابق: تُعرض أرقام المصدر (قبل الضريبة/الضريبة/
 *      المحصَّل) كما وردت، بلا أي بند «تسوية/فرق». اختلافُها يُصنَّف بوسم
 *      «سجل مؤرشف» للقراءة فقط — لا يُصفَّر بالتقريب ولا يُعاد تسويته.
 *
 * الأرقام حقيقية من مرآة yara فقط (ys_mirror_orders عبر jsonb) — لا
 * pos_orders ولا حساب محلي ولا تقدير. الأدوار يقررها الخادم
 * (sous_chef/admin/owner)، والسقف 93 يومًا كما في عائلة /yara-reports.
 * لا كتابة، ولا مساس بالمخزن، ولا معالجات inline، والرموز --erp-* فقط.
 */

import { createDataTable } from '../data-display/data-table.js?v=4.9.313';
import { formatInt, formatMoney, formatQty } from '../data/reports-repo.js?v=4.9.313';
import { openInAppReport } from '../report-viewer.js?v=4.9.313';
import {
    fetchItemSales, fetchItemInvoices, fetchOrderDetail, fetchReceiptHtml,
    fetchItemSalesSheetHtml, rangeError, YARA_MAX_SPAN_DAYS,
} from '../data/yara-reports-repo.js?v=4.9.313';

const esc = (v) => String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const PAGE = 100;

/** تاريخ اليوم بتوقيت الجهاز (الرياض) بصيغة YYYY-MM-DD. */
function isoDay(d) {
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** أول الشهر الحالي — المدى الافتراضي الذي طلبه المالك. */
function monthStart() {
    const d = new Date();
    return isoDay(new Date(d.getFullYear(), d.getMonth(), 1));
}

function money(v) {
    const m = formatMoney(v, 'ر.س');
    return `<span class="erp-num" dir="ltr">${m.amount}</span>`
        + (m.hasUnit ? ` <span class="erp-text-sm erp-text-muted">${esc(m.unit)}</span>` : '');
}

/** اليوم والوقت من أعمدة المرآة كما هي (doc_date تاريخ وdoc_time نص). */
function dayTime(r) {
    const day = String(r.doc_date || '').slice(0, 10);
    const time = String(r.doc_time || '').slice(0, 5);
    return `<span class="erp-tnum" dir="ltr">${esc(day || '—')}</span>`
        + (time ? `<span class="erp-mini__sub erp-tnum" dir="ltr">${esc(time)}</span>` : '');
}

function template() {
    return `
      <div class="salesinq">
        <div class="erp-dash-head erp-screen-in" style="--erp-dash-eyebrow:'SALES INQUIRY'">
          <div>
            <h2 class="erp-dash-title">استعلام المبيعات</h2>
            <p class="erp-dash-sub"><span data-v2-scope-line></span></p>
          </div>
          <div class="erp-dash-controls erp-no-print salesinq__presets" role="group" aria-label="فترات سريعة">
            <button type="button" class="erp-btn erp-btn--ghost erp-btn--xs" data-v2-preset="today">اليوم</button>
            <button type="button" class="erp-btn erp-btn--ghost erp-btn--xs" data-v2-preset="week">آخر 7 أيام</button>
            <button type="button" class="erp-btn erp-btn--ghost erp-btn--xs is-active" data-v2-preset="month">من أول الشهر</button>
            <button type="button" class="erp-btn erp-btn--ghost erp-btn--xs" data-v2-preset="yesterday">أمس</button>
          </div>
        </div>

        <div class="salesinq__filters erp-no-print">
          <label class="erp-text-sm erp-text-muted" for="v2sq-from">من</label>
          <input class="erp-input erp-input--ltr" id="v2sq-from" type="date" value="${esc(monthStart())}">
          <label class="erp-text-sm erp-text-muted" for="v2sq-to">إلى</label>
          <input class="erp-input erp-input--ltr" id="v2sq-to" type="date" value="${esc(isoDay(new Date()))}">
          <label class="erp-text-sm erp-text-muted" for="v2sq-cashier">الكاشير</label>
          <select class="erp-select" id="v2sq-cashier"><option value="">الكل</option></select>
          <label class="erp-text-sm erp-text-muted" for="v2sq-item">صنف</label>
          <div class="salesinq__search">
            <input class="erp-input" id="v2sq-item" type="search" autocomplete="off"
              placeholder="اسم الصنف أو كوده…">
            <div class="salesinq__suggest" data-v2-suggest hidden role="listbox" aria-label="اقتراحات الأصناف"></div>
          </div>
          <button type="button" class="erp-btn erp-btn--primary erp-btn--sm" data-v2-run>
            <i class="ji" data-i="search" aria-hidden="true"></i><span>استعلام</span>
          </button>
          <button type="button" class="erp-btn erp-btn--ghost erp-btn--sm" data-v2-clear>مسح</button>
          <button type="button" class="erp-btn erp-btn--subtle erp-btn--sm" data-v2-print-sheet>
            <i class="ji" data-i="printer" aria-hidden="true"></i><span>طباعة الاستعلام</span>
          </button>
          <span class="erp-text-sm erp-text-muted" id="v2sq-hint">أقصى فترة ${YARA_MAX_SPAN_DAYS} يومًا</span>
        </div>

        <div data-v2-kpis></div>

        <section class="erp-card">
          <div class="erp-card__head">
            <h3 class="erp-card__title">الأصناف المباعة
              <span class="erp-eyebrow" dir="ltr" lang="en">Sold items</span>
              <span class="erp-text-sm erp-text-muted" data-v2-count></span>
            </h3>
          </div>
          <div class="erp-card__body">
            <div data-v2-items></div>
          </div>
        </section>

        <section class="erp-card salesinq__panel" data-v2-panel hidden>
          <div class="erp-card__head">
            <h3 class="erp-card__title">
              <i class="ji" data-i="receipt" aria-hidden="true"></i>
              فواتير الصنف: <span data-v2-item-name>—</span>
              <span class="erp-text-sm erp-text-muted" data-v2-inv-count></span>
            </h3>
            <span class="erp-grow"></span>
            <button type="button" class="erp-btn erp-btn--ghost erp-btn--sm erp-no-print" data-v2-panel-close>
              <i class="ji" data-i="x" aria-hidden="true"></i><span>إغلاق</span>
            </button>
          </div>
          <div class="erp-card__body salesinq__stack">
            <p class="erp-text-sm erp-text-muted" data-v2-inv-scope>المؤشرات وأعمدة «كمية الصنف / سعر الوحدة / قبل الضريبة للصنف / ضريبة الصنف / شامل الضريبة للصنف» أرقامُ هذا الصنف وحده — مطابقةٌ بالكود والاسم لا بعائلة «شاورما»، فلا تدخل أصنافٌ أخرى في العدّ. وعمود «المحصَّل للفاتورة» هو إجمالي الفاتورة كاملة للمعلومة فقط.</p>
            <div data-v2-inv-kpis></div>
            <div data-v2-invoices></div>
            <div class="salesinq__more erp-no-print" data-v2-more hidden>
              <button type="button" class="erp-btn erp-btn--subtle erp-btn--sm" data-v2-more-btn>تحميل المزيد</button>
            </div>
            <div data-v2-detail-host></div>
          </div>
        </section>
      </div>`;
}

export function mountSalesInquiryScreen(host, ctx = {}) {
    const notify = typeof ctx.notify === 'function' ? ctx.notify : (m) => console.info('[V2 sales-inquiry]', m);
    let alive = true;
    let seqItems = 0;
    let seqInv = 0;

    const state = {
        from: monthStart(), to: isoDay(new Date()), cashier: '', item: '',
        rows: [], totals: { invoices: 0, qty: 0, net: 0, vat: 0 },
        selected: '', selectedCode: '',
        invoices: [], invTotals: { invoices: 0, qty: 0, net: 0, vat: 0 },
        offset: 0, invLoading: false, loading: false, detailDoc: '',
    };

    host.insertAdjacentHTML('beforeend', template());
    const el = host.lastElementChild;
    const q = (sel) => el.querySelector(sel);

    const itemsTable = createDataTable({
        caption: 'الأصناف المباعة', mode: 'client', pageSize: 25, stickyHeader: true,
        emptyMessage: 'لا مبيعات في هذا المدى', emptyHint: 'وسّع المدى أو امسح فلتر الصنف.',
        rowKey: (r, i) => `${r.item_code || ''}|${r.item_name || ''}|${i}`,
        columns: [
            { key: 'item_name', header: 'الصنف', sortable: true, filterable: true,
                render: (r) => `<button type="button" class="erp-link-btn salesinq__name" data-v2-item-open="${esc(r.item_name || '')}" data-v2-item-code="${esc(r.item_code || '')}">${esc(r.item_name || '—')}</button>`
                    + (r.item_code ? `<span class="erp-mini__sub erp-mono" dir="ltr">${esc(r.item_code)}</span>` : '') },
            { key: 'qty', header: 'الكمية', type: 'number', width: '110px', align: 'end', value: (r) => Number(r.qty || 0),
                render: (r) => `<span class="erp-num" dir="ltr">${formatQty(r.qty)}</span>` },
            { key: 'invoices', header: 'فواتير', type: 'number', width: '110px', align: 'end', value: (r) => Number(r.invoices || 0),
                render: (r) => `<span class="erp-num" dir="ltr">${formatInt(r.invoices)}</span>` },
            { key: 'net', header: 'قبل الضريبة', type: 'number', width: '140px', align: 'end', value: (r) => Number(r.net || 0), render: (r) => money(r.net) },
            { key: 'vat', header: 'الضريبة', type: 'number', width: '130px', align: 'end', value: (r) => Number(r.vat || 0), render: (r) => money(r.vat) },
            { key: 'avg', header: 'متوسط سعر الوحدة', type: 'number', width: '160px', align: 'end',
                value: (r) => (Number(r.qty) ? Number(r.net) / Number(r.qty) : 0),
                render: (r) => (Number(r.qty) ? money(Number(r.net) / Number(r.qty)) : '—') },
        ],
    });
    q('[data-v2-items]').appendChild(itemsTable.el);

    const invTable = createDataTable({
        caption: 'فواتير الصنف', mode: 'client', pageSize: 25, stickyHeader: true,
        emptyMessage: 'لا فواتير لهذا الصنف في المدى', rowKey: (r) => r.doc_no,
        columns: [
            { key: 'doc_no', header: 'الفاتورة', sortable: true, width: '130px',
                render: (r) => `<button type="button" class="erp-link-btn" data-v2-detail="${esc(r.doc_no)}"><span class="erp-num" dir="ltr">${esc(r.doc_no)}</span></button>` },
            { key: 'doc_date', header: 'التاريخ والوقت', sortable: true, width: '140px', align: 'center',
                value: (r) => `${String(r.doc_date || '').slice(0, 10)} ${String(r.doc_time || '').slice(0, 5)}`, render: dayTime },
            { key: 'cashier_name', header: 'الكاشير', sortable: true, filterable: true },
            { key: 'item_qty', header: 'كمية الصنف', type: 'number', width: '120px', align: 'end', value: (r) => Number(r.item_qty || 0),
                render: (r) => `<span class="erp-num" dir="ltr">${formatQty(r.item_qty)}</span>` },
            { key: 'item_price', header: 'سعر الوحدة', type: 'number', width: '130px', align: 'end', value: (r) => Number(r.item_price || 0), render: (r) => money(r.item_price) },
            { key: 'item_net', header: 'قبل الضريبة للصنف', type: 'number', width: '150px', align: 'end', value: (r) => Number(r.item_net || 0), render: (r) => money(r.item_net) },
            { key: 'item_vat', header: 'ضريبة الصنف', type: 'number', width: '130px', align: 'end', value: (r) => Number(r.item_vat || 0), render: (r) => money(r.item_vat) },
            { key: 'item_gross', header: 'شامل الضريبة للصنف', type: 'number', width: '160px', align: 'end',
                value: (r) => Number(r.item_net || 0) + Number(r.item_vat || 0),
                render: (r) => money(Number(r.item_net || 0) + Number(r.item_vat || 0)) },
            { key: 'net', header: 'المحصَّل للفاتورة', type: 'number', width: '150px', align: 'end', value: (r) => Number(r.net || 0), render: (r) => money(r.net) },
            { key: 'actions', header: 'إجراءات', width: '130px', align: 'center', className: 'erp-no-print',
                render: (r) => `<span class="erp-row-wrap">`
                    + `<button type="button" class="erp-btn erp-btn--subtle erp-btn--xs" data-v2-detail="${esc(r.doc_no)}" title="تفاصيل الفاتورة"><i class="ji" data-i="eye" aria-hidden="true"></i></button>`
                    + `<button type="button" class="erp-btn erp-btn--subtle erp-btn--xs" data-v2-print="${esc(r.doc_no)}" title="طباعة الإيصال"><i class="ji" data-i="printer" aria-hidden="true"></i></button>`
                    + `</span>` },
        ],
    });
    q('[data-v2-invoices]').appendChild(invTable.el);

    /* ── المؤشرات ───────────────────────────────────────────────────── */
    function paintKpis(target, t, label) {
        target.innerHTML = `<ul class="erp-kpis" aria-label="${esc(label)}">`
            + [
                { icon: 'receipt', label: 'فواتير', en: 'Invoices', value: `<span class="erp-num" dir="ltr">${formatInt(t.invoices)}</span>` },
                { icon: 'package', label: 'الكمية', en: 'Qty', value: `<span class="erp-num" dir="ltr">${formatQty(t.qty)}</span>` },
                { icon: 'banknote', label: 'قبل الضريبة', en: 'Net ex VAT', value: money(t.net) },
                { icon: 'percent', label: 'الضريبة', en: 'VAT', value: money(t.vat) },
                { icon: 'receipt', label: 'شامل الضريبة', en: 'Gross', value: money(Number(t.net || 0) + Number(t.vat || 0)) },
            ].map((k) => `<li class="erp-kpi">
                <div class="erp-kpi__top"><span class="erp-kpi__icon" aria-hidden="true"><i class="ji" data-i="${k.icon}"></i></span>
                <span class="erp-kpi__label">${esc(k.label)}<span class="erp-eyebrow" dir="ltr" lang="en">${esc(k.en)}</span></span></div>
                <div class="erp-kpi__value">${k.value}</div>
              </li>`).join('') + '</ul>';
    }

    function scopeLine() {
        const parts = [`${state.from} — ${state.to}`];
        if (state.cashier) {parts.push(`كاشير ${state.cashier}`);}
        if (state.selected) {parts.push(state.selected);}
        q('[data-v2-scope-line]').textContent = parts.join(' · ');
    }

    /* ── جدول الأصناف ───────────────────────────────────────────────── */
    /** نطاق العرض: بعد اختيار صنف تُفلتر القائمة والمؤشرات العليا عليه
     *  وحده — طلب المالك 2026-11-02: «استعلام عن الصنف يفلتر الصنف فقط
     *  بشكل دقيق جدًا». الهوية = (الكود + الاسم) معًا: الكود 010102 يسمّي
     *  صنفين («صحن شاورما قطع» و«صحن شاورما»)، والاسم «صحن شاورما عربي»
     *  يغطّي كودين — فالزوج وحده يميّز المنتج. */
    function scopedRows() {
        if (!state.selected) { return state.rows; }
        const code = String(state.selectedCode || '').trim();
        const name = String(state.selected || '').trim();
        return state.rows.filter((r) => {
            const rc = String(r.item_code || '').trim();
            const rn = String(r.item_name || '').trim();
            if (code && name) { return rc === code && rn === name; }
            if (code) { return rc === code; }
            return rn === name;
        });
    }

    /** رسم القائمة + مؤشراتها على النطاق الحالي (المحدد أو الكل). */
    function paintItemsScope() {
        const rows = scopedRows();
        itemsTable.setRows(rows);
        const t = rows.reduce((s, r) => ({
            invoices: s.invoices + Number(r.invoices || 0),
            qty: s.qty + Number(r.qty || 0),
            net: s.net + Number(r.net || 0),
            vat: s.vat + Number(r.vat || 0),
        }), { invoices: 0, qty: 0, net: 0, vat: 0 });
        t.net = Math.round(t.net * 100) / 100;
        t.vat = Math.round(t.vat * 100) / 100;
        paintKpis(q('[data-v2-kpis]'), t, state.selected ? 'مؤشرات الصنف المحدد' : 'مؤشرات الأصناف المعروضة');
        q('[data-v2-count]').textContent = !rows.length ? ''
            : state.selected ? '(صنف واحد)'
                : `(${formatInt(rows.length)} صنفًا)`;
    }

    async function loadItems() {
        const guard = rangeError(state.from, state.to);
        if (guard && guard.ok === false) { itemsTable.setError(guard.message); return; }
        const mySeq = ++seqItems;
        state.loading = true;
        itemsTable.setLoading(true);
        try {
            const data = await fetchItemSales({
                from: state.from, to: state.to, group: 'item',
                cashier: state.cashier, item: state.item,
            });
            if (!alive || mySeq !== seqItems) { return; }
            state.rows = Array.isArray(data.rows) ? data.rows : [];
            state.totals = data.totals || { invoices: 0, qty: 0, net: 0, vat: 0 };
            paintItemsScope();
            scopeLine();
            paintCashierOptions();
        } catch (e) {
            if (!alive || mySeq !== seqItems) { return; }
            itemsTable.setError(e && e.message === 'UNAUTHORIZED'
                ? 'انتهت الجلسة — سجّل الدخول ثم أعد المحاولة.'
                : `تعذّر التحميل: ${(e && e.message) || 'خطأ'}`);
        } finally {
            if (mySeq === seqItems) { state.loading = false; }
        }
    }

    function paintCashierOptions() {
        const map = new Map();
        for (const r of state.rows) {
            if (r.cashier_no != null) { map.set(String(r.cashier_no), r.cashier_name || r.cashier_no); }
        }
        for (const r of state.invoices) {
            if (r.cashier_no != null) { map.set(String(r.cashier_no), r.cashier_name || r.cashier_no); }
        }
        const sel = q('#v2sq-cashier');
        const keep = state.cashier;
        sel.innerHTML = '<option value="">الكل</option>'
            + [...map.entries()].sort((a, b) => Number(a[0]) - Number(b[0]))
                .map(([no, name]) => `<option value="${esc(no)}"${no === keep ? ' selected' : ''}>${esc(name)}</option>`).join('');
    }

    /* ── فواتير صنف ─────────────────────────────────────────────────── */
    async function loadInvoices({ append = false } = {}) {
        if (!state.selected) { return; }
        const guard = rangeError(state.from, state.to);
        if (guard && guard.ok === false) { invTable.setError(guard.message); return; }
        const mySeq = ++seqInv;
        const offset = append ? state.invoices.length : 0;
        state.invLoading = true;
        invTable.setLoading(true);
        q('[data-v2-more]').hidden = true;
        try {
            const data = await fetchItemInvoices({
                from: state.from, to: state.to,
                item: state.selected, code: state.selectedCode, exact: 1,
                cashier: state.cashier, limit: PAGE, offset,
            });
            if (!alive || mySeq !== seqInv) { return; }
            const batch = Array.isArray(data.invoices) ? data.invoices : [];
            state.invoices = append ? state.invoices.concat(batch) : batch;
            state.invTotals = data.totals || { invoices: 0, qty: 0, net: 0, vat: 0 };
            invTable.setRows(state.invoices);
            paintKpis(q('[data-v2-inv-kpis]'), state.invTotals, 'مؤشرات فواتير الصنف');
            q('[data-v2-inv-count]').textContent = state.invTotals.invoices
                ? `(${formatInt(state.invTotals.invoices)} فاتورة — معروض ${formatInt(state.invoices.length)})` : '';
            q('[data-v2-more]').hidden = batch.length < PAGE;
            q('[data-v2-panel]').hidden = false;
            if (!append) {
                q('[data-v2-detail-host]').innerHTML = '';
                state.detailDoc = '';
            }
            paintCashierOptions();
            scopeLine();
        } catch (e) {
            if (!alive || mySeq !== seqInv) { return; }
            invTable.setError(`تعذّر جلب فواتير الصنف: ${(e && e.message) || 'خطأ'}`);
        } finally {
            if (mySeq === seqInv) { state.invLoading = false; }
        }
    }

    function openItem(name, code = '') {
        state.selected = String(name || '').trim();
        state.selectedCode = String(code || '').trim();
        if (!state.selected) { return; }
        q('[data-v2-item-name]').textContent = state.selected
            + (state.selectedCode ? ` · ${state.selectedCode}` : '');
        q('#v2sq-item').value = state.selected;
        q('[data-v2-suggest]').hidden = true;
        q('[data-v2-panel]').hidden = false;
        q('[data-v2-inv-kpis]').innerHTML = '';
        invTable.setRows([]);
        state.invoices = [];
        paintItemsScope();
        loadInvoices();
        q('[data-v2-panel]').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }

    /* ── تفاصيل فاتورة ──────────────────────────────────────────────── */
    /** سطور الفاتورة التابعة للصنف المفتوح — بالزوج (كود + اسم) نفسه الذي
     *  فلتر به الخادم، فلا يُنسب سطرُ صنفٍ آخر إلى المطلوب. */
    function hitLines(lines) {
        const code = String(state.selectedCode || '').trim();
        const name = String(state.selected || '').trim();
        if (!code && !name) { return []; }
        return (Array.isArray(lines) ? lines : []).filter((l) => {
            const lc = String((l && l.code) || '').trim();
            const ln = String((l && l.name) || '').trim();
            if (code && name) { return lc === code && ln === name; }
            if (code) { return lc === code; }
            return ln === name;
        });
    }

    async function openDetail(docNo) {
        const detailHost = q('[data-v2-detail-host]');
        state.detailDoc = docNo;
        detailHost.innerHTML = '<div class="erp-card erp-card--subtle"><div class="erp-card__body erp-text-center">'
            + '<span class="erp-spinner" aria-hidden="true"></span> جارٍ جلب تفاصيل الفاتورة…</div></div>';
        try {
            const data = await fetchOrderDetail(docNo);
            if (!alive || state.detailDoc !== docNo) { return; }
            const o = (data && data.order) || {};
            const lines = Array.isArray(o.lines) ? o.lines : [];
            /* السجل مؤرشفٌ من نظام سابق: تُعرض أرقام المصدر كما وردت، ولا
               يُضاف بند «تسوية/فرق». اختلافُها عن بعضها يُصنَّف بوسم
               «سجل مؤرشف» للقراءة فقط، لا كرقم يُسوَّى أو يُخفى. */
            const gross = Math.round(((Number(o.total) || 0) + (Number(o.vat) || 0)) * 100) / 100;
            const legacyArchive = o.legacy_adjustment === true
                || Math.abs(gross - (Number(o.net) || 0)) >= 0.005;
            const legacyNote = legacyArchive
                ? '<p class="erp-text-sm erp-text-muted" data-v2-legacy>سجل مؤرشف من النظام السابق — الأرقام كما وردت في مصدرها، ولا تُعاد تسويتها هنا.</p>'
                : '';
            const hits = hitLines(lines);
            const sumBy = (arr, k) => Math.round(arr.reduce((s, l) => s + (Number(l && l[k]) || 0), 0) * 100) / 100;
            const hitQty = Math.round(hits.reduce((s, l) => s + (Number(l && l.qty) || 0), 0) * 1000) / 1000;
            const hitNet = sumBy(hits, 'total');
            const hitVat = sumBy(hits, 'vat');
            const hitGross = Math.round((hitNet + hitVat) * 100) / 100;
            const hitUnit = hitQty > 0 ? Math.round((hitNet / hitQty) * 100) / 100 : 0;
            const hitShare = gross > 0 ? Math.round((hitGross / gross) * 1000) / 10 : 0;
            /* بطاقة الصنف تسبق بطاقة الفاتورة: جواب «أتباع كام» يُقرأ أولًا،
               وإجمالي الفاتورة يبقى للمقارنة لا للخلط. */
            const itemScope = state.selected
                ? `<div class="erp-card erp-card--subtle salesinq__itemscope" data-v2-itemscope>
                    <div class="erp-card__head">
                      <h5 class="erp-card__title">
                        <i class="ji" data-i="package" aria-hidden="true"></i>
                        الصنف المطلوب في هذه الفاتورة: ${esc(state.selected)}
                        ${state.selectedCode ? `<span class="erp-mini__sub erp-mono" dir="ltr">${esc(state.selectedCode)}</span>` : ''}
                      </h5>
                    </div>
                    <div class="erp-card__body salesinq__stack">
                      ${hits.length ? `<div class="erp-emp-stats">
                        <div class="erp-emp-stat"><span class="erp-emp-stat__l">الكمية</span><span class="erp-emp-stat__v"><span class="erp-num" dir="ltr">${formatQty(hitQty)}</span></span></div>
                        <div class="erp-emp-stat"><span class="erp-emp-stat__l">سعر الوحدة</span><span class="erp-emp-stat__v">${money(hitUnit)}</span></div>
                        <div class="erp-emp-stat"><span class="erp-emp-stat__l">قبل الضريبة</span><span class="erp-emp-stat__v">${money(hitNet)}</span></div>
                        <div class="erp-emp-stat"><span class="erp-emp-stat__l">الضريبة</span><span class="erp-emp-stat__v">${money(hitVat)}</span></div>
                        <div class="erp-emp-stat"><span class="erp-emp-stat__l">شامل الضريبة</span><span class="erp-emp-stat__v">${money(hitGross)}</span></div>
                        <div class="erp-emp-stat"><span class="erp-emp-stat__l">حصة الصنف من إجمالي الفاتورة</span><span class="erp-emp-stat__v"><span class="erp-num" dir="ltr">${formatQty(hitShare)}%</span></span></div>
                      </div>
                      <p class="erp-text-sm erp-text-muted">سطورٌ مطابقة بالكود والاسم: <span class="erp-num" dir="ltr">${formatInt(hits.length)}</span> من <span class="erp-num" dir="ltr">${formatInt(lines.length)}</span> سطرًا في الفاتورة؛ وباقي أصناف الفاتورة ${money(Math.round((gross - hitGross) * 100) / 100)}.</p>`
                      : `<p class="erp-text-sm erp-text-danger">لا سطر في هذه الفاتورة يطابق (${esc(state.selected)}${state.selectedCode ? ` · ${esc(state.selectedCode)}` : ''}) بالكود والاسم — راجع هوية الصنف قبل الاعتماد على الرقم.</p>`}
                    </div>
                  </div>`
                : '';
            const rowsHtml = lines.map((l, i) => {
                const hit = hits.includes(l);
                const lineGross = Math.round(((Number(l && l.total) || 0) + (Number(l && l.vat) || 0)) * 100) / 100;
                return `<tr${hit ? ' class="salesinq__line--hit"' : ''}>
                <td>${i + 1}</td>
                <td class="salesinq__start">${esc(l.name || '—')}${l.code ? ` <span class="erp-mini__sub erp-mono" dir="ltr">${esc(l.code)}</span>` : ''}${hit ? ' <span class="erp-badge" data-tone="brand">الصنف المطلوب</span>' : ''}</td>
                <td><span class="erp-num" dir="ltr">${formatQty(l.qty)}</span></td>
                <td>${money(l.price)}</td>
                <td>${money(l.total)}</td>
                <td>${money(l.vat)}</td>
                <td>${money(lineGross)}</td>
              </tr>`;
            }).join('');
            detailHost.innerHTML = `
              <div class="erp-card erp-card--subtle salesinq__detail">
                <div class="erp-card__head">
                  <h4 class="erp-card__title">
                    <i class="ji" data-i="receipt" aria-hidden="true"></i>
                    فاتورة رقم <span class="erp-mono" dir="ltr">${esc(o.doc_no || docNo)}</span>
                    — <span class="erp-badge" data-tone="brand">${esc(o.cashier_no ? 'كاشير ' + o.cashier_no : '—')}</span>
                    — <span class="erp-tnum" dir="ltr">${esc(String(o.doc_date || '').slice(0, 10))} ${esc(String(o.doc_time || '').slice(0, 5))}</span>
                  </h4>
                  <span class="erp-grow"></span>
                  <button type="button" class="erp-btn erp-btn--sm erp-no-print" data-v2-print="${esc(o.doc_no || docNo)}">
                    <i class="ji" data-i="printer" aria-hidden="true"></i><span>طباعة الإيصال</span>
                  </button>
                  <button type="button" class="erp-btn erp-btn--sm erp-btn--ghost erp-no-print" data-v2-detail-close>
                    <i class="ji" data-i="x" aria-hidden="true"></i><span>إغلاق</span>
                  </button>
                </div>
                <div class="erp-card__body salesinq__stack">
                  ${itemScope}
                  <h5 class="salesinq__group-title">الفاتورة كاملة</h5>
                  <div class="erp-emp-stats">
                    <div class="erp-emp-stat"><span class="erp-emp-stat__l">الوردية</span><span class="erp-emp-stat__v">${esc(o.shift_no || '—')}</span></div>
                    <div class="erp-emp-stat"><span class="erp-emp-stat__l">المنطقة / الطاولة</span><span class="erp-emp-stat__v">${esc(o.zone_name || o.table_name || '—')}</span></div>
                    <div class="erp-emp-stat"><span class="erp-emp-stat__l">قبل الضريبة</span><span class="erp-emp-stat__v">${money(o.total)}</span></div>
                    <div class="erp-emp-stat"><span class="erp-emp-stat__l">الضريبة</span><span class="erp-emp-stat__v">${money(o.vat)}</span></div>
                    ${Number(o.discount) > 0.005 ? `<div class="erp-emp-stat"><span class="erp-emp-stat__l">الخصم المسجَّل</span><span class="erp-emp-stat__v">${money(o.discount)}</span></div>` : ''}
                    <div class="erp-emp-stat"><span class="erp-emp-stat__l">الإجمالي المحصَّل</span><span class="erp-emp-stat__v">${money(o.net)}</span></div>
                    <div class="erp-emp-stat"><span class="erp-emp-stat__l">المدفوع</span><span class="erp-emp-stat__v">${money(o.payed)}</span></div>
                    <div class="erp-emp-stat"><span class="erp-emp-stat__l">نقدًا</span><span class="erp-emp-stat__v">${money(o.pay_cash)}</span></div>
                    <div class="erp-emp-stat"><span class="erp-emp-stat__l">شبكة</span><span class="erp-emp-stat__v">${money(o.pay_network)}</span></div>
                    <div class="erp-emp-stat"><span class="erp-emp-stat__l">آجل / محفظة</span><span class="erp-emp-stat__v">${money(Number(o.pay_credit || 0) + Number(o.pay_mobile || 0))}</span></div>
                  </div>
                  ${legacyNote}
                  <div class="erp-tbl-wrap salesinq__scroll">
                    <table class="erp-tbl">
                      <thead><tr><th>#</th><th>الصنف</th><th>الكمية</th><th>السعر</th><th>قبل الضريبة</th><th>الضريبة</th><th>شامل الضريبة</th></tr></thead>
                      <tbody>${rowsHtml || '<tr><td colspan="7" class="erp-text-muted erp-text-center">لا سطور مفصلة لهذه الفاتورة</td></tr>'}</tbody>
                    </table>
                  </div>
                </div>
              </div>`;
        } catch (e) {
            if (!alive || state.detailDoc !== docNo) { return; }
            detailHost.innerHTML = `<div class="erp-card erp-card--subtle"><div class="erp-card__body erp-text-danger">تعذّر جلب تفاصيل الفاتورة: ${esc((e && e.message) || 'خطأ')}</div></div>`;
        }
    }

    /* ── طباعة الإيصال عبر عارض التطبيق ─────────────────────────────── */
    async function printReceipt(docNo) {
        try {
            const html = await fetchReceiptHtml(docNo);
            if (!alive) { return; }
            const w = openInAppReport(`إيصال ${esc(docNo)}`);
            if (!w) { notify('تعذّر فتح عارض الطباعة'); return; }
            w.document.open();
            w.document.write(html);
            w.document.close();
            w.focus();
        } catch (e) {
            notify('تعذّر طباعة الإيصال: ' + ((e && e.message) || 'خطأ'));
        }
    }

    /* ── طباعة الاستعلام كاملًا (ورقة A4 من الخادم) ─────────────────── */
    async function printSheet() {
        const guard = rangeError(state.from, state.to);
        if (guard && guard.ok === false) { notify(guard.message); return; }
        try {
            const html = await fetchItemSalesSheetHtml({
                from: state.from, to: state.to,
                cashier: state.cashier,
                item: state.selected || state.item,
                code: state.selectedCode,
                exact: state.selected ? 1 : 0,
            });
            if (!alive) { return; }
            const w = openInAppReport('طباعة استعلام المبيعات');
            if (!w) { notify('تعذّر فتح عارض الطباعة'); return; }
            w.document.open();
            w.document.write(html);
            w.document.close();
            w.focus();
        } catch (e) {
            notify('تعذّر طباعة الاستعلام: ' + ((e && e.message) || 'خطأ'));
        }
    }

    /* ── اقتراحات الصنف (من المبيعات نفسها) ─────────────────────────── */
    let suggestTimer = 0;

    /** مفتاح مطابقة عربي متسامح — «البيبسي» = «بيبسي»، «شاورما» ≠ «شاورم». */
    function arKey(s) {
        return String(s || '').toLowerCase()
            .replace(/[\u064B-\u065F\u0640]/g, '')
            .replace(/[أإآٱ]/g, 'ا').replace(/ة/g, 'ه')
            .replace(/[ىئی]/g, 'ي').replace(/ؤ/g, 'و')
            .replace(/[ذز]/g, 'ز').replace(/[ضص]/g, 'ص')
            .replace(/[ظط]/g, 'ط').replace(/[شس]/g, 'س')
            .replace(/[ثت]/g, 'ت').replace(/[خج]/g, 'ح')
            .replace(/[قف]/g, 'ف').replace(/[غع]/g, 'ع')
            .replace(/\s+/g, ' ').trim();
    }

    /**
     * ترتيب المرشّحين بدقّة: التطابق التام أولًا، ثم البادئة، ثم الاحتواء.
     * بلا هذا الترتيب كانت «شاورما» تتقدّم على «شاورما عربي» فتُفتح لوحةُ
     * منتجٍ خطأ — وهذا عين ما اشتكى منه المالك (2026-11-02).
     */
    function rankCandidates(rows, term) {
        const t = arKey(term);
        const scored = (Array.isArray(rows) ? rows : []).map((r) => {
            const name = arKey(r && r.item_name);
            const code = arKey(r && r.item_code);
            let rank = 3;
            if (t && (name === t || code === t)) { rank = 0; }
            else if (t && (name.startsWith(t) || code.startsWith(t))) { rank = 1; }
            else if (t && (name.includes(t) || code.includes(t))) { rank = 2; }
            return { r, rank };
        });
        scored.sort((a, b) => a.rank - b.rank
            || Number(b.r && b.r.invoices || 0) - Number(a.r && a.r.invoices || 0));
        return scored.map((s) => s.r);
    }

    /** رسم قائمة الاقتراحات — بابٌ واحد تمرّ عبره من البحث الآلي ومن Enter. */
    function renderSuggest(rows) {
        const box = q('[data-v2-suggest]');
        box.innerHTML = rows.length
            ? rows.map((r) => `<button type="button" class="salesinq__suggest-row" role="option"
                data-v2-pick="${esc(r.item_name || '')}" data-v2-suggest-code="${esc(r.item_code || '')}">
                <span class="salesinq__suggest-name">${esc(r.item_name || '—')}${r.item_code ? ` <span class="erp-mini__sub erp-mono" dir="ltr">${esc(r.item_code)}</span>` : ''}</span>
                <span class="salesinq__suggest-meta"><span class="erp-num" dir="ltr">${formatQty(r.qty)}</span> وحدة ·
                <span class="erp-num" dir="ltr">${formatInt(r.invoices)}</span> فاتورة</span>
              </button>`).join('')
            : '<div class="salesinq__suggest-empty">لا أصناف مطابقة في هذا المدى</div>';
        box.hidden = false;
    }

    /* Enter لا يفتح لوحةً تجمع أصنافًا متعددة: كلمةٌ واحدة مثل «شاورما»
       تطابق ٧ أصناف (عربی/دبل/ديناميت/مع الأرز/قطع...)، فتُجمع أرقامها
       في مؤشراتٍ واحدة وهي النتيجة المضلِّلة في البلاغ (2026-11-02):
       «لما ابحث عن مبيعات منتج يظهر المنتج فقط». */
    async function openFromSearch() {
        const term = String(state.item || '').trim();
        if (!term) { await loadItems(); return; }
        try {
            const data = await fetchItemSales({
                from: state.from, to: state.to, group: 'item',
                cashier: state.cashier, item: term,
            });
            if (!alive) { return; }
            const t = arKey(term);
            const ranked = rankCandidates(data.rows, term);
            /* الدقة أولًا: التطابق التام للاسم أو الكود يُقدَّم على التطابق
               الجزئي — «صحن شاورما عربي» لا يفتح لوحةً تضم «…دبل». */
            const exact = ranked.filter((r) => t && (arKey(r.item_code) === t || arKey(r.item_name) === t));
            const pick = exact.length ? exact : ranked;
            if (pick.length === 1) {
                openItem(pick[0].item_name || term, pick[0].item_code || '');
                return;
            }
            if (pick.length > 1) {
                renderSuggest(pick.slice(0, 8));
                notify(`${formatInt(pick.length)} أصناف مطابقة لـ «${term}» — اختر صنفًا واحدًا من القائمة حتى تخرج الأرقام لمنتجٍ واحد`);
                return;
            }
        } catch (_) { /* فشل الجلب ⇒ نعود لسلوك آمن: قائمة الأصناف */ }
        q('[data-v2-suggest]').hidden = true;
        notify(`لا يوجد صنف مطابق لـ «${term}» في هذا المدى`);
        await loadItems();
    }

    function suggest(term) {
        clearTimeout(suggestTimer);
        const box = q('[data-v2-suggest]');
        if (String(term || '').trim().length < 2) { box.hidden = true; box.innerHTML = ''; return; }
        suggestTimer = setTimeout(async () => {
            try {
                const data = await fetchItemSales({
                    from: state.from, to: state.to, group: 'item',
                    cashier: state.cashier, item: String(term).trim(),
                });
                if (!alive || q('#v2sq-item').value.trim() !== String(term).trim()) { return; }
                renderSuggest(rankCandidates(data.rows, term).slice(0, 8));
            } catch (_) {
                box.hidden = true;
            }
        }, 250);
    }

    /* ── الأحداث ───────────────────────────────────────────────────── */
    function readFilters() {
        state.from = q('#v2sq-from').value || monthStart();
        state.to = q('#v2sq-to').value || isoDay(new Date());
        state.cashier = q('#v2sq-cashier').value || '';
        state.item = q('#v2sq-item').value.trim();
    }

    function setPreset(kind) {
        const today = new Date();
        const from = new Date(today);
        if (kind === 'today') {
            state.from = isoDay(today); state.to = isoDay(today);
        } else if (kind === 'yesterday') {
            from.setDate(today.getDate() - 1);
            state.from = isoDay(from); state.to = isoDay(from);
        } else if (kind === 'week') {
            from.setDate(today.getDate() - 6);
            state.from = isoDay(from); state.to = isoDay(today);
        } else {
            state.from = monthStart(); state.to = isoDay(today);
        }
        q('#v2sq-from').value = state.from;
        q('#v2sq-to').value = state.to;
        for (const b of el.querySelectorAll('[data-v2-preset]')) {
            b.classList.toggle('is-active', b.dataset.v2Preset === kind);
        }
        refresh();
    }

    /** تحديث متسلسل: الأصناف أولًا ثم فواتير الصنف المفتوح — لا سباق seq. */
    async function refresh() {
        /* القراءتان مستقلّتان: فواتير الصنف تُطلب بمعرّفٍ اختاره الموظف
           بالفعل، لا بما يجيبه جدولُ الأصناف. بالتتابع كان الهاتف ينتظر
           رحلةً كاملة ثم يبدأ الأخرى — وكل رحلةٍ على النفق ثانيةٌ صاعدة. */
        const jobs = [loadItems()];
        if (state.selected) {jobs.push(loadInvoices());}
        await Promise.all(jobs);
    }

    el.addEventListener('click', (event) => {
        const preset = event.target.closest('[data-v2-preset]');
        if (preset) { setPreset(preset.dataset.v2Preset); return; }

        if (event.target.closest('[data-v2-run]')) { readFilters(); refresh(); return; }

        if (event.target.closest('[data-v2-print-sheet]')) { readFilters(); printSheet(); return; }

        if (event.target.closest('[data-v2-clear]')) {
            q('#v2sq-item').value = '';
            q('[data-v2-suggest]').hidden = true;
            state.item = ''; state.selected = ''; state.selectedCode = '';
            q('[data-v2-panel]').hidden = true;
            q('[data-v2-detail-host]').innerHTML = '';
            loadItems();
            return;
        }

        const sug = event.target.closest('[data-v2-pick]');
        if (sug) { openItem(sug.dataset.v2Pick, sug.dataset.v2SuggestCode); return; }

        const itemBtn = event.target.closest('[data-v2-item-open]');
        if (itemBtn) { openItem(itemBtn.dataset.v2ItemOpen, itemBtn.dataset.v2ItemCode || ''); return; }

        const detailBtn = event.target.closest('[data-v2-detail]');
        if (detailBtn) { openDetail(detailBtn.dataset.v2Detail); return; }

        const printBtn = event.target.closest('[data-v2-print]');
        if (printBtn) { printReceipt(printBtn.dataset.v2Print); return; }

        if (event.target.closest('[data-v2-detail-close]')) {
            q('[data-v2-detail-host]').innerHTML = '';
            state.detailDoc = '';
            return;
        }

        if (event.target.closest('[data-v2-panel-close]')) {
            q('[data-v2-panel]').hidden = true;
            q('[data-v2-detail-host]').innerHTML = '';
            state.selected = ''; state.selectedCode = ''; state.detailDoc = '';
            paintItemsScope();
            scopeLine();
            return;
        }

        if (event.target.closest('[data-v2-more-btn]')) { loadInvoices({ append: true }); }
    });

    el.addEventListener('input', (event) => {
        if (event.target.id === 'v2sq-item') { suggest(event.target.value); }
    });

    el.addEventListener('keydown', (event) => {
        if (event.target.id === 'v2sq-item' && event.key === 'Enter') {
            event.preventDefault();
            readFilters();
            q('[data-v2-suggest]').hidden = true;
            openFromSearch();
        }
        if (event.key === 'Escape') { q('[data-v2-suggest]').hidden = true; }
    });

    loadItems();

    return {
        destroy() {
            alive = false;
            clearTimeout(suggestTimer);
            el.remove();
        },
    };
}
