/**
 * V2 — استعلام المبيعات · Sales Inquiry (قراءة فقط)
 * ═══════════════════════════════════════════════════════════════════════
 * سؤال المالك: «كل المبيعات، وكل صنف بكميته وفواتيره بكامل تفاصيلها،
 * وأقدر أطبع الفواتير» — هذه الشاشة تجيبه من الكاشيرية نفسها:
 *
 *   1) جدول أصناف الفترة (من أول الشهر افتراضيًا): كود، كمية، فواتير،
 *      صافي، ضريبة، متوسط سعر الوحدة.
 *   2) نقر الصنف → جدول فواتيره: كل فاتورة بكمية الصنف وسعره وإجماليه
 *      وإجمالي الفاتورة وكاشيرها ووقتها، مع ترقيم من الخادم (LIMIT/OFFSET).
 *   3) نقر الفاتورة → تفاصيلها كاملة (سطور، خصم، ضريبة، مدفوع، دفع مقسّم).
 *   4) «طباعة الإيصال» → HTML الإيصال من /pos/orders/ys/:docNo/receipt-html
 *      يُجلب بـ fetch خام برؤوس المصادقة ثم يُكتب في عارض التطبيق
 *      (report-viewer) — لأن فتحه في تبويب جديد يسقط 401 بلا هيدر.
 *   5) «طباعة الاستعلام» → ورقة A4 من /yara-reports/item-sales/print بنفس
 *      فلترة الشاشة (فترة/كاشير/صنف) وبالهوية نفسها.
 *   6) الفارق (قبل الضريبة + الضريبة) − المحصَّل يُعرض صراحةً كخصم/تسوية
 *      في الإيصال وبطاقة التفاصيل: المصدر لا يسجّل الخصم في عمود مستقل،
 *      ولا يُصفَّر الفرق بالتقريب.
 *
 * الأرقام حقيقية من مرآة yara فقط (ys_mirror_orders عبر jsonb) — لا
 * pos_orders ولا حساب محلي ولا تقدير. الأدوار يقررها الخادم
 * (sous_chef/admin/owner)، والسقف 93 يومًا كما في عائلة /yara-reports.
 * لا كتابة، ولا مساس بالمخزن، ولا معالجات inline، والرموز --erp-* فقط.
 */

import { createDataTable } from '../data-display/data-table.js?v=4.9.152';
import { formatInt, formatMoney, formatQty } from '../data/reports-repo.js?v=4.9.152';
import { openInAppReport } from '../report-viewer.js?v=4.9.152';
import {
    fetchItemSales, fetchItemInvoices, fetchOrderDetail, fetchReceiptHtml,
    fetchItemSalesSheetHtml, rangeError, YARA_MAX_SPAN_DAYS,
} from '../data/yara-reports-repo.js?v=4.9.152';

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
        <div class="salesinq__head">
          <div>
            <h2 class="salesinq__title">استعلام المبيعات
              <span class="erp-eyebrow" dir="ltr" lang="en">Sales Inquiry</span>
            </h2>
            <p class="salesinq__sub"><span data-v2-scope-line></span></p>
          </div>
          <div class="salesinq__presets erp-no-print" role="group" aria-label="فترات سريعة">
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
            <div data-v2-inv-kpis></div>
            <div data-v2-invoices></div>
            <div class="salesinq__more erp-no-print" data-v2-more hidden>
              <button type="button" class="erp-btn erp-btn--subtle erp-btn--sm" data-v2-more-btn>تحميل المزيد</button>
            </div>
            <div data-v2-detail></div>
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
        selected: '', selectedCode: '', selectedKey: '',
        invoices: [], invTotals: { invoices: 0, qty: 0, net: 0, vat: 0 },
        offset: 0, invLoading: false, loading: false, detailDoc: '',
    };

    host.insertAdjacentHTML('beforeend', template());
    const el = host.lastElementChild;
    const q = (sel) => el.querySelector(sel);

    const itemsTable = createDataTable({
        caption: 'الأصناف المباعة', mode: 'client', pageSize: 25, stickyHeader: true,
        emptyMessage: 'لا مبيعات في هذا المدى', emptyHint: 'وسّع المدى أو امسح فلتر الصنف.',
        rowKey: (r, i) => `${r.item_code || r.item_name || i}`,
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
            itemsTable.setRows(state.rows);
            paintKpis(q('[data-v2-kpis]'), state.totals, 'مؤشرات المبيعات');
            q('[data-v2-count]').textContent = state.rows.length ? `(${formatInt(state.rows.length)} صنفًا)` : '';
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
                from: state.from, to: state.to, item: state.selectedKey || state.selected,
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
                q('[data-v2-detail]').innerHTML = '';
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
        // الكود أدقّ من الاسم: صنفان قد يحملان الاسم نفسه بسعرين مختلفين،
        // فالفواتير تُجلب بالكود حين يتوفر (وإلا بالاسم كما كتبه المستخدم).
        state.selectedKey = state.selectedCode || state.selected;
        if (!state.selected) { return; }
        q('[data-v2-item-name]').textContent = state.selected
            + (state.selectedCode ? ` · ${state.selectedCode}` : '');
        q('#v2sq-item').value = state.selected;
        q('[data-v2-suggest]').hidden = true;
        q('[data-v2-panel]').hidden = false;
        q('[data-v2-inv-kpis]').innerHTML = '';
        invTable.setRows([]);
        state.invoices = [];
        loadInvoices();
        q('[data-v2-panel]').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }

    /* ── تفاصيل فاتورة ──────────────────────────────────────────────── */
    async function openDetail(docNo) {
        const detailHost = q('[data-v2-detail]');
        state.detailDoc = docNo;
        detailHost.innerHTML = '<div class="erp-card erp-card--subtle"><div class="erp-card__body erp-text-center">'
            + '<span class="erp-spinner" aria-hidden="true"></span> جارٍ جلب تفاصيل الفاتورة…</div></div>';
        try {
            const data = await fetchOrderDetail(docNo);
            if (!alive || state.detailDoc !== docNo) { return; }
            const o = (data && data.order) || {};
            const lines = Array.isArray(o.lines) ? o.lines : [];
            /* المرآة تسجّل المحصَّل في net وصافي ما قبل الضريبة في total،
               والخصم الجُملي لا يُسجَّل في عمود مستقل (discount صفر دائمًا)
               ⇒ الفرق (قبل الضريبة + الضريبة) − المحصَّل يُعرض صراحةً
               بدل كتمانه بالتقريب: المحصَّل + التسوية = صافٍ + ضريبة. */
            const adj = Math.round(((Number(o.total) || 0) + (Number(o.vat) || 0) - (Number(o.net) || 0)) * 100) / 100;
            const gross = Math.round(((Number(o.total) || 0) + (Number(o.vat) || 0)) * 100) / 100;
            const recon = Math.abs(adj) > 0.005
                ? `<p class="erp-text-sm erp-text-muted">قبل الضريبة + الضريبة = ${money(gross)}، والمحصَّل ${money(o.net)}؛
                    الفرق ${money(adj)} ${adj > 0
                        ? 'خصمٌ أو تسويةُ كسورٍ لم يسجّلها المصدر في عمود مستقل — وبه تنطبق المعادلة: المحصَّل + التسوية = قبل الضريبة + الضريبة.'
                        : 'زيادةٌ في المحصَّل عن المسعَّر — تُراجع مع سجل الكاشير.'}</p>`
                : '';
            const rowsHtml = lines.map((l, i) => `<tr>
                <td>${i + 1}</td>
                <td class="salesinq__start">${esc(l.name || '—')}${l.code ? ` <span class="erp-mini__sub erp-mono" dir="ltr">${esc(l.code)}</span>` : ''}</td>
                <td><span class="erp-num" dir="ltr">${formatQty(l.qty)}</span></td>
                <td>${money(l.price)}</td>
                <td>${money(l.total)}</td>
              </tr>`).join('');
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
                  <div class="erp-emp-stats">
                    <div class="erp-emp-stat"><span class="erp-emp-stat__l">الوردية</span><span class="erp-emp-stat__v">${esc(o.shift_no || '—')}</span></div>
                    <div class="erp-emp-stat"><span class="erp-emp-stat__l">المنطقة / الطاولة</span><span class="erp-emp-stat__v">${esc(o.zone_name || o.table_name || '—')}</span></div>
                    <div class="erp-emp-stat"><span class="erp-emp-stat__l">قبل الضريبة</span><span class="erp-emp-stat__v">${money(o.total)}</span></div>
                    <div class="erp-emp-stat"><span class="erp-emp-stat__l">الضريبة</span><span class="erp-emp-stat__v">${money(o.vat)}</span></div>
                    ${Number(o.discount) > 0.005 ? `<div class="erp-emp-stat"><span class="erp-emp-stat__l">الخصم المسجَّل</span><span class="erp-emp-stat__v">${money(o.discount)}</span></div>` : ''}
                    ${Math.abs(adj) > 0.005 ? `<div class="erp-emp-stat"><span class="erp-emp-stat__l">خصم / تسوية كسور</span><span class="erp-emp-stat__v">${money(adj)}</span></div>` : ''}
                    <div class="erp-emp-stat"><span class="erp-emp-stat__l">الإجمالي المحصَّل</span><span class="erp-emp-stat__v">${money(o.net)}</span></div>
                    <div class="erp-emp-stat"><span class="erp-emp-stat__l">المدفوع</span><span class="erp-emp-stat__v">${money(o.payed)}</span></div>
                    <div class="erp-emp-stat"><span class="erp-emp-stat__l">نقدًا</span><span class="erp-emp-stat__v">${money(o.pay_cash)}</span></div>
                    <div class="erp-emp-stat"><span class="erp-emp-stat__l">شبكة</span><span class="erp-emp-stat__v">${money(o.pay_network)}</span></div>
                    <div class="erp-emp-stat"><span class="erp-emp-stat__l">آجل / محفظة</span><span class="erp-emp-stat__v">${money(Number(o.pay_credit || 0) + Number(o.pay_mobile || 0))}</span></div>
                  </div>
                  ${recon}
                  <div class="erp-tbl-wrap salesinq__scroll">
                    <table class="erp-tbl">
                      <thead><tr><th>#</th><th>الصنف</th><th>الكمية</th><th>السعر</th><th>قبل الضريبة</th></tr></thead>
                      <tbody>${rowsHtml || '<tr><td colspan="5" class="erp-text-muted erp-text-center">لا سطور مفصلة لهذه الفاتورة</td></tr>'}</tbody>
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
                cashier: state.cashier, item: state.item,
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
                const rows = (Array.isArray(data.rows) ? data.rows : []).slice(0, 8);
                box.innerHTML = rows.length
                    ? rows.map((r) => `<button type="button" class="salesinq__suggest-row" role="option"
                        data-v2-pick="${esc(r.item_name || '')}" data-v2-suggest-code="${esc(r.item_code || '')}">
                        <span class="salesinq__suggest-name">${esc(r.item_name || '—')}</span>
                        <span class="salesinq__suggest-meta"><span class="erp-num" dir="ltr">${formatQty(r.qty)}</span> وحدة ·
                        <span class="erp-num" dir="ltr">${formatInt(r.invoices)}</span> فاتورة</span>
                      </button>`).join('')
                    : '<div class="salesinq__suggest-empty">لا أصناف مطابقة في هذا المدى</div>';
                box.hidden = false;
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
        await loadItems();
        if (state.selected) { await loadInvoices(); }
    }

    el.addEventListener('click', (event) => {
        const preset = event.target.closest('[data-v2-preset]');
        if (preset) { setPreset(preset.dataset.v2Preset); return; }

        if (event.target.closest('[data-v2-run]')) { readFilters(); refresh(); return; }

        if (event.target.closest('[data-v2-print-sheet]')) { readFilters(); printSheet(); return; }

        if (event.target.closest('[data-v2-clear]')) {
            q('#v2sq-item').value = ''; q('[data-v2-suggest]').hidden = true;
            state.item = ''; state.selected = ''; state.selectedCode = ''; state.selectedKey = '';
            q('[data-v2-panel]').hidden = true;
            q('[data-v2-detail]').innerHTML = '';
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
            q('[data-v2-detail]').innerHTML = '';
            state.detailDoc = '';
            return;
        }

        if (event.target.closest('[data-v2-panel-close]')) {
            q('[data-v2-panel]').hidden = true;
            q('[data-v2-detail]').innerHTML = '';
            state.selected = ''; state.selectedKey = ''; state.detailDoc = '';
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
            if (state.item) { openItem(state.item); } else { loadItems(); }
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
