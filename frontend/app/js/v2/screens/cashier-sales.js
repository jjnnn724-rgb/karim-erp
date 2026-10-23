/**
 * screens/cashier-sales.js — مبيعات الكاشير: كل الفواتير وكل أصنافها
 * ══════════════════════════════════════════════════════════════════════
 * ثلاث لوحاتٍ في شاشةٍ واحدة من مصدرٍ واحد:
 *   · «اللوحة»   — ما حُصِّل فعلًا في الفترة، يومًا بيوم، ساعةً بساعة،
 *                  وكاشيريةً بكاشيرية، وطريقًا بطريق دفع.
 *   · «الفواتير» — كل سندٍ صدر من الكاشيريات؛ فتح أي سطر يُنزل فاتورةً
 *                  بسطورها ودفعها وحالة اعتمادها، والطباعة منها.
 *   · «الأصناف»  — كل صنفٍ بِرمزِه: كميّته وقيمته وعدد فواتيره؛ فتح أي سطر
 *                  يُنزل ملف الصنف — أسماءُه المرصودة وأسعارُه ومنحنى أيامه
 *                  وكل فواتيره، ومن كل فاتورةٍ تُطبع الفاتورة.
 *
 * المصدر ys_mirror_orders (مرآة CC_BILLS3 + CC_BILL_ENTER3) — أي الفواتير
 * الفعلية الصادرة من الكاشيريات، لا جدول نقاط البيع المحلي.
 *
 * الباب الواحد للشبكة: js/v2/data/cashier-sales-repo.js — هذه الشاشة لا تعرف
 * العنوان ولا الرؤوس ولا طريقة المصادقة. الورقتان HTML تُعرضان في عارض V2
 * وشريطه هو مَن يطبع (قفزة المتصفح إلى نقطةٍ محمية برؤوس مصادقة ترجع 401).
 *
 * المبادئ: قراءةٌ فقط · لا مكتبة رسوم · رموز --erp-* فقط · لا معالجات inline
 * · كل رقمٍ ومنةٍ ونسبةٍ من الخادم · RTL عربي · الترقيم صادق · والانحراف
 * يُعلَن: سندٌ بلا سطور، أو إجماليٌ لا يساوي صافيًا + ضريبة، أو دفعٌ لم
 * يغطِّ الإجمالي — كلها تُعرض كما هي لأن إخفاءها يجعل الرقم أجمل وأكذب.
 */
import { createDataTable } from '../data-display/data-table.js?v=4.9.131';
import { barChart, donutChart, lineChart } from '../charts.js?v=4.9.131';
import { openInAppReport } from '../report-viewer.js?v=4.9.131';
import {
    fetchSummary, fetchOrders, fetchItems, fetchItem, fetchInvoice,
    fetchInvoiceHtml, fetchSheetHtml, money, count, qty, periodPresets, isoDay,
} from '../data/cashier-sales-repo.js?v=4.9.131';

const esc = (v) => String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const PRESETS = periodPresets();
const PAGE_SIZE = 25;
const VIEWS = [
    { key: 'board', label: 'اللوحة', en: 'Board', icon: 'layout-dashboard' },
    { key: 'orders', label: 'الفواتير', en: 'Invoices', icon: 'receipt' },
    { key: 'items', label: 'الأصناف', en: 'Items', icon: 'package' },
];

/** تاريخ ISO مختصر للجدول: «22 أكتوبر» مع بقاء الكامل في title. */
function shortDay(v) {
    const s = String(v || '').slice(0, 10);
    if (!s) {return '—';}
    const d = new Date(`${s}T00:00:00`);
    if (Number.isNaN(d.getTime())) {return s;}
    return d.toLocaleDateString('ar-EG', { day: '2-digit', month: 'short', year: 'numeric' });
}

const pct = (v) => `${(Number(v) || 0).toFixed(1)}%`;

/** وسم الفرق عن الفترة المماثلة — ولا فرق يُذكر إن كانت السابقة ناقصة بيانات. */
function deltaChip(delta, partial) {
    if (partial) {
        return '<span class="csales__warn" role="note">الفترة السابقة تسبق بداية المرآة — لا قِياس</span>';
    }
    if (delta === null || delta === undefined) {return '<span class="csales__warn">لا فترة مماثلة للمقارنة</span>';}
    const dir = delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat';
    const icon = delta > 0 ? 'trending-up' : delta < 0 ? 'chevron-down' : 'dot-gray';
    return `<span class="erp-delta erp-delta--${dir}"><i class="ji" data-i="${icon}" aria-hidden="true"></i>`
        + `<span class="erp-num" dir="ltr">${esc(Math.abs(delta).toFixed(1))}%</span></span>`;
}

function kpiTile(k) {
    return `<li class="erp-kpi">
      <div class="erp-kpi__top">
        <span class="erp-kpi__icon" data-tone="${esc(k.tone || 'brand')}" aria-hidden="true">
          <i class="ji" data-i="${esc(k.icon)}"></i></span>
        <span class="erp-kpi__label">${esc(k.label)}<span class="erp-eyebrow" dir="ltr" lang="en">${esc(k.en)}</span></span>
      </div>
      <div class="erp-kpi__value"><span class="erp-num" dir="ltr">${esc(k.value)}</span>
        ${k.unit ? `<span class="csales__unit">${esc(k.unit)}</span>` : ''}</div>
      <div class="erp-kpi__foot">${k.delta || ''}<span class="erp-kpi__hint">${esc(k.hint)}</span></div>
    </li>`;
}

/** بطاقة رسم: الرسم العاري داخل erp-card — نفس بنية بقية شاشات V2. */
function chartCard(titleAr, titleEn, note, chartHtml, i) {
    return `<section class="erp-card csales__card erp-screen-in" style="--cs-i:${i}">
      <div class="erp-card__head">
        <h3 class="erp-card__title">${esc(titleAr)}<span class="erp-eyebrow" dir="ltr" lang="en">${esc(titleEn)}</span></h3>
        <span class="erp-text-muted csales__cardNote">${esc(note)}</span>
      </div>
      <div class="erp-card__body">${chartHtml}</div>
    </section>`;
}

const fact = (label, value, extra) => `<div class="csales__fact"><b>${esc(label)}</b>`
    + `<span${extra ? ` ${extra}` : ''}>${esc(value)}</span></div>`;

/** شريط الصدق: ماذا في المرآة ومتى زومِنت، وما الذي لا يُروى بالأرقام وحده. */
function pulseHtml(s) {
    const m = s.mirror || {};
    const t = s.totals || {};
    const bits = [
        `<span class="csales__pulseMain"><i class="ji" data-i="history" aria-hidden="true"></i>`
        + `المرآة من <span class="erp-num" dir="ltr">${esc(String(m.first_day || '—'))}</span> `
        + `إلى <span class="erp-num" dir="ltr">${esc(String(m.last_day || '—'))}</span> · `
        + `<span class="erp-num" dir="ltr">${esc(count(m.docs))}</span> سندًا</span>`,
        `<span class="csales__pulseAt">آخر مزامنة <span class="erp-num" dir="ltr">${esc(String(m.synced_at || '—'))}</span></span>`,
    ];
    /* الأعدادُ المعيبة تُذكر بقدرها: صفرٌ يعني لا شيء يُقال، وغيرُ الصفر
       يعني سببًا ونصًّا — فلا «نظافةٌ» مُستعارة من غياب البيانات. */
    if (Number(t.no_lines) > 0) {
        bits.push(`<span class="csales__pulseFlag" role="note" title="سندٌ مبلغه محسوبٌ في المجاميع لكن لا سطور أصناف له في المرآة">${esc(count(t.no_lines))} سندًا بلا سطور أصناف</span>`);
    }
    if (Number(t.no_time) > 0) {
        bits.push(`<span class="csales__pulseFlag" role="note" title="بلا طابع ساعة، فلا يظهر في منحنى الساعات">${esc(count(t.no_time))} سندًا بلا وقت</span>`);
    }
    if (Number(t.drift_docs) > 0) {
        const large = Number(t.drift_large_docs) || 0;
        bits.push(`<span class="csales__pulseFlag" role="note" title="${large
            ? esc(`${count(large)} منها بمقدارٍ ${money(t.drift_large_amount, '')} جاوزَ قدرَ تقريبِ السطور — المحصَّلُ لا يطابق المُسعَّر والمرآةُ لا تسجّل السبب`)
            : 'تقريبُ التسعيرة لكل سطرٍ قبل الجمع — الإجمالي هو ما دُفع فعلًا'}">`
            + `${esc(count(t.drift_docs))} سندًا إجماليه ≠ صافي + ضريبة (${esc(money(t.drift_amount, ''))})`
            + (large ? ` — <span class="erp-num" dir="ltr">${esc(count(large))}</span> جاوزَ التقريب` : '')
            + '</span>');
    }
    if (Number(t.pay_unreconciled) > 0) {
        bits.push(`<span class="csales__pulseFlag" role="note" title="مجموع أعمدة الدفع لا يساوي الإجمالي المحصَّل">${esc(count(t.pay_unreconciled))} سندًا دفعه لا يغطّي إجماليه</span>`);
    }
    if (Math.abs(Number(t.unaccounted) || 0) > 0.005) {
        bits.push(`<span class="csales__pulseFlag" role="note" title="فرقٌ بين الإجمالي المحصَّل ومجاميع أعمدة النقد والشبكة والجوال والآجل">${esc(money(t.unaccounted, s.currency))} غير مصنَّف الدفع</span>`);
    }
    /* شارةُ الاعتماد الزكوي في لوحة الفاتورة تُقرأ من جدولِ اعتمادٍ منفصل؛
       إن لم يغطِّ الفترة قِيل ذلك هنا بدل أن تبدو الفواتيرُ غير معتمَدة. */
    const z = s.zatca;
    if (z) {
        bits.push(Number(z.matched) > 0
            ? `<span class="csales__pulseAt">اعتمادٌ زكويّ لـ<span class="erp-num" dir="ltr">${esc(count(z.matched))}</span> سندًا</span>`
            : `<span class="csales__pulseFlag" role="note" title="جدول الاعتماد الزكويّ ينتهي عند ${esc(String(z.last_issued || '—'))} (آخر سنده ${esc(String(z.feed_last || '—'))})، والمرآة تبدأ من ${esc(String(z.win_first || '—'))} — فلا شارة اعتمادٍ تُعرض">لا اعتمادٍ زكويًّا يغطّي الفترة</span>`);
    }
    return bits.join('');
}

function template(presetKey, viewKey) {
    const seg = (attrs, items, active) => `<div class="erp-seg erp-no-print" role="group" ${attrs}>
      ${items.map((x) => `<button type="button" ${x.attr}="${esc(x.key)}"`
        + `${x.key === active ? ' class="is-active" aria-pressed="true"' : ' aria-pressed="false"'}>${esc(x.label)}</button>`).join('')}</div>`;
    const preset = PRESETS.find((p) => p.key === presetKey) || {};
    return `
    <section class="erp-v2 csales erp-stack">
      <header class="csales__head erp-screen-in">
        <div>
          <h1 class="csales__title">مبيعات الكاشير
            <span class="erp-eyebrow" dir="ltr" lang="en">Cashier Sales</span></h1>
          <p class="csales__sub">كل سندٍ صدر من الكاشيريات، وكل صنفٍ بِرمزه — والفاتورة تُطبع من داخلها</p>
        </div>
        <div class="csales__tools erp-no-print">
          ${seg('aria-label="العرض"', VIEWS.map((v) => ({ key: v.key, label: v.label, attr: 'data-sa-view' })), viewKey)}
          <button type="button" class="erp-btn erp-btn--sm" data-sa-print-sheet>
            <i class="ji" data-i="printer" aria-hidden="true"></i><span data-sa-print-label>طباعة الكشف</span></button>
        </div>
      </header>

      <div class="csales__pulseWrap erp-no-print" data-sa-pulse role="status" aria-live="polite"></div>

      <div class="csales__bar erp-no-print">
        ${seg('aria-label="الفترة"', PRESETS.map((p) => ({ key: p.key, label: p.label, attr: 'data-sa-preset' })), presetKey)}
        <label class="erp-field"><span class="erp-label">من</span>
          <input class="erp-input erp-input--ltr" type="date" data-sa="from" value="${esc(preset.from ?? isoDay(-6))}"></label>
        <label class="erp-field"><span class="erp-label">إلى</span>
          <input class="erp-input erp-input--ltr" type="date" data-sa="to" value="${esc(preset.to ?? isoDay(0))}" max="${esc(isoDay(0))}"></label>
        <label class="erp-field"><span class="erp-label">الكاشيرية</span>
          <select class="erp-select" data-sa="cashier"><option value="">كل الكاشيريات</option></select></label>
        <label class="csales__search">
          <i class="ji" data-i="search" aria-hidden="true"></i>
          <span class="erp-sr-only">بحث في السندات والأصناف</span>
          <input class="erp-input erp-grow" type="search" data-sa="q"
                 placeholder="رقم سند أو اسم صنف…" autocomplete="off">
        </label>
        <button type="button" class="erp-btn erp-btn--sm" data-sa-clear hidden>إلغاء المرشّحات</button>
      </div>

      <div class="csales__view" data-sa-board role="tabpanel" aria-label="لوحة المبيعات"></div>

      <div class="csales__view" data-sa-orders role="tabpanel" aria-label="الفواتير" hidden>
        <section class="erp-card csales__card erp-screen-in">
          <div class="erp-card__head">
            <h3 class="erp-card__title">الفواتير
              <span class="erp-eyebrow" dir="ltr" lang="en">Invoices</span></h3>
            <span class="csales__howto">افتح السطر لتراه بسطورِه، أو اضغط الطباعة في آخره</span>
            <span class="erp-grow"></span>
            <span class="csales__sum" data-sa-orders-sum></span>
          </div>
          <div class="erp-card__body"><div data-sa-orders-table></div></div>
        </section>
      </div>

      <div class="csales__view" data-sa-items role="tabpanel" aria-label="الأصناف" hidden>
        <section class="erp-card csales__card erp-screen-in">
          <div class="erp-card__head">
            <h3 class="erp-card__title">الأصناف المباعة
              <span class="erp-eyebrow" dir="ltr" lang="en">Items Sold</span></h3>
            <span class="csales__howto">الصنفُ بِرمزه: افتح السطر لملفّه بكل فواتيره</span>
            <span class="erp-grow"></span>
            <span class="csales__sum" data-sa-items-sum></span>
          </div>
          <div class="erp-card__body"><div data-sa-items-table></div></div>
        </section>
      </div>

      <div class="csales__scrim" data-sa-scrim hidden></div>
      <aside class="csales__panel" data-sa-panel hidden role="dialog" aria-modal="true"
             aria-labelledby="cs-panel-title"></aside>
    </section>`;
}

/**
 * @param {HTMLElement} host
 */
export function mountCashierSales(host) {
    const filters = { preset: 'month', from: `${isoDay(0).slice(0, 7)}-01`, to: isoDay(0), cashier: '', q: '' };
    let view = 'board';
    let currency = '';
    let lastFocus = null;
    let busySeq = 0;
    let paintSeq = 0;
    /* مكداسُ اللوحات: الفاتورة تُفتح فوق ملف الصنف، والإغلاق رجوعٌ للأول —
       فالتنقّل لا يفقد مكانَ المستخدم في كشفٍ كان يقلّبه. */
    const stack = [];

    host.insertAdjacentHTML('beforeend', template(filters.preset, view));
    const el = host.lastElementChild;
    const q = (sel) => el.querySelector(sel);
    const notify = (msg, kind) => {
        if (typeof window !== 'undefined' && typeof window.toast === 'function') {window.toast(msg, kind || 'success');}
    };

    /* ── جدول الفواتير ───────────────────────────────────────────────────── */
    const payBadges = (r) => {
        const on = [['ن', r.cash], ['ش', r.network], ['ج', r.mobile], ['آ', r.credit]]
            .filter(([, v]) => Number(v || 0) > 0);
        if (!on.length) {return '<span class="erp-text-faint" aria-hidden="true">—</span>';}
        return on.map(([k, v]) => `<span class="csales__pay" title="${esc(k)} ${esc(money(v, ''))}">${esc(k)}</span>`).join('');
    };

    const orderColumns = [
        {
            key: 'no', header: 'السند', sortable: true, type: 'number', width: '104px',
            render: (r) => `<span class="csales__ref" dir="ltr" title="${esc(String(r.doc_no))}">${esc(String(r.doc_no))}</span>`,
        },
        {
            key: 'date', header: 'التاريخ', sortable: true, width: '116px',
            render: (r) => `<span title="${esc(r.day)}">${esc(shortDay(r.day))}</span>`,
        },
        {
            key: 'time', header: 'الوقت', type: 'number', width: '72px',
            render: (r) => `<span class="erp-num" dir="ltr">${esc(r.time || '—')}</span>`,
        },
        { key: 'cashier', header: 'الكاشيرية', render: (r) => esc(r.cashier_name || '—') },
        {
            key: 'items', header: 'أصناف', sortable: true, type: 'number', width: '76px', align: 'end',
            render: (r) => `<span class="erp-num" dir="ltr">${esc(count(r.items))}</span>`,
        },
        {
            key: 'ex_vat', header: 'قبل الضريبة', sortable: true, type: 'number', align: 'end', width: '120px',
            render: (r) => `<span class="erp-num" dir="ltr">${esc(money(r.ex_vat, ''))}</span>`,
        },
        {
            key: 'vat', header: 'الضريبة', sortable: true, type: 'number', align: 'end', width: '110px',
            render: (r) => `<span class="erp-num" dir="ltr">${esc(money(r.vat, ''))}</span>`,
        },
        {
            key: 'collected', header: 'المحصّل', sortable: true, type: 'number', align: 'end', width: '150px',
            render: (r) => `<div class="csales__amt"><span class="erp-num" dir="ltr">${esc(money(r.collected, ''))}</span>
              <span class="csales__share" style="--cs-share:${Math.min(100, Number(r.share) || 0)}%"
                    title="${esc(`${pct(r.share)} من الفترة`)}" aria-hidden="true"></span></div>`,
        },
        { key: 'pay', header: 'الدفع', width: '96px', render: payBadges },
        {
            key: 'drift', header: 'فارق', width: '84px', align: 'end',
            /* الفارقُ عن (صافي + ضريبة): الخادمُ قال هل يفسّره التقريبُ بقدر
               عدد السطور، أم فارقٌ لا تسجّل المرآةُ سببَه — فلا نُنسبُه ههنا. */
            render: (r) => (Math.abs(Number(r.drift) || 0) > 0.005
                ? `<span class="csales__drift${r.drift_within_rounding ? '' : ' is-large'}" dir="ltr" `
                  + `title="${esc(r.drift_within_rounding
                      ? `تقريبُ التسعيرة عند الجمع: الإجمالي المحصَّل لا يساوي صافيًا + ضريبة (${money(r.drift, '')})`
                      : `جاوزَ قدرَ تقريبِ السطور — المحصَّلُ لا يطابق المُسعَّر (${money(r.drift, '')})`)}">${esc(money(r.drift, ''))}</span>`
                : '<span class="erp-text-faint" aria-hidden="true">·</span>'),
        },
        {
            key: 'go', header: '', width: '76px', align: 'center',
            render: (r) => `<span class="csales__rowTools">
              <button type="button" class="csales__open" data-sa-print="${esc(String(r.doc_no))}"
                      aria-label="طباعة فاتورة ${esc(String(r.doc_no))}">
                <i class="ji" data-i="printer" aria-hidden="true"></i></button>
              <button type="button" class="csales__open" data-sa-invoice="${esc(String(r.doc_no))}"
                      aria-label="فتح فاتورة ${esc(String(r.doc_no))}">
                <i class="ji" data-i="chevron-down" aria-hidden="true"></i></button></span>`,
        },
    ];

    const ordersTable = createDataTable({
        columns: orderColumns,
        rows: [],
        mode: 'server',
        pageSize: PAGE_SIZE,
        search: false,
        emptyMessage: 'لا فواتير تطابق المرشّحات',
        emptyHint: 'وسّع الفترة أو ألغِ البحث. المرآة تبدأ من أول يومٍ مزامَن.',
        rowKey: (r) => String(r.doc_no),
        onRowActivate: (r) => { if (r && r.doc_no) {openInvoice(String(r.doc_no));} },
        onStateChange: (s) => { loadOrders(s); },
    });
    q('[data-sa-orders-table]').appendChild(ordersTable.el);

    /* ── جدول الأصناف ────────────────────────────────────────────────────── */
    const itemColumns = [
        {
            key: 'code', header: 'الرمز', sortable: true, width: '116px',
            render: (r) => `<span class="csales__ref" dir="ltr" title="${esc(r.code)}">${esc(r.code)}</span>`,
        },
        {
            key: 'name', header: 'الصنف', sortable: true,
            render: (r) => `<span class="csales__itemName">${esc(r.name)}`
                + (Number(r.names) > 1
                    ? `<span class="csales__amb" title="هذا الرمز مسجَّل بأكثر من اسمٍ في الكاشيريات">${esc(count(r.names))} اسمًا</span>` : '')
                + `</span>`,
        },
        {
            key: 'qty', header: 'الكمية', sortable: true, type: 'number', align: 'end', width: '108px',
            render: (r) => `<span class="erp-num" dir="ltr">${esc(qty(r.qty))}</span>`,
        },
        {
            key: 'docs', header: 'فواتير', sortable: true, type: 'number', align: 'end', width: '92px',
            render: (r) => `<span class="erp-num" dir="ltr">${esc(count(r.docs))}</span>`,
        },
        {
            key: 'lines', header: 'سطور', sortable: true, type: 'number', align: 'end', width: '84px',
            render: (r) => `<span class="erp-num" dir="ltr">${esc(count(r.lines))}</span>`,
        },
        {
            key: 'prices', header: 'أسعار', sortable: true, type: 'number', align: 'end', width: '84px',
            render: (r) => `<span class="erp-num" dir="ltr">${esc(count(r.prices))}</span>`,
        },
        {
            key: 'total', header: 'قبل الضريبة', sortable: true, type: 'number', align: 'end', width: '136px',
            render: (r) => `<div class="csales__amt"><span class="erp-num" dir="ltr">${esc(money(r.ex_vat, ''))}</span>
              <span class="csales__share" style="--cs-share:${Math.min(100, Number(r.share) || 0)}%"
                    title="${esc(`${pct(r.share)} من قيمة الأصناف`)}" aria-hidden="true"></span></div>`,
        },
        {
            key: 'vat', header: 'الضريبة', sortable: true, type: 'number', align: 'end', width: '110px',
            render: (r) => `<span class="erp-num" dir="ltr">${esc(money(r.vat, ''))}</span>`,
        },
        {
            key: 'name2', header: 'متوسط الوحدة', align: 'end', width: '120px',
            render: (r) => `<span class="erp-num" dir="ltr">${esc(money(r.avg_price, ''))}</span>`,
        },
        {
            key: 'go', header: '', width: '72px', align: 'center',
            render: (r) => `<button type="button" class="csales__open" data-sa-item="${esc(r.code)}"
                      aria-label="ملف صنف ${esc(r.name)}">
                <i class="ji" data-i="chevron-down" aria-hidden="true"></i></button>`,
        },
    ];

    const itemsTable = createDataTable({
        columns: itemColumns,
        rows: [],
        mode: 'server',
        pageSize: PAGE_SIZE,
        search: false,
        emptyMessage: 'لا أصناف تطابق المرشّحات',
        emptyHint: 'جرّب رمزًا أو اسمًا أقصر، أو وسّع الفترة.',
        rowKey: (r) => String(r.code),
        onRowActivate: (r) => { if (r && r.code) {openItem(String(r.code));} },
        onStateChange: (s) => { loadItems(s); },
    });
    q('[data-sa-items-table]').appendChild(itemsTable.el);

    /* تفويضٌ واحد للسطرين: الطباعة وفتح اللوحة — زرٌّ يولَّد مع كل رسمٍ فلا
       معالجَ inline. */
    el.addEventListener('click', (ev) => {
        const p = ev.target.closest('[data-sa-print]');
        if (p) {printInvoice(p.dataset.saPrint, p); return;}
        const iv = ev.target.closest('[data-sa-invoice]');
        if (iv) {openInvoice(iv.dataset.saInvoice); return;}
        const it = ev.target.closest('[data-sa-item]');
        if (it) {openItem(it.dataset.saItem);}
    });

    /* ── اللوحة ──────────────────────────────────────────────────────────── */
    function paintBoard(s) {
        const t = s.totals || {};
        const prev = t.prev || {};
        const unit = s.currency;
        const tiles = [
            {
                icon: 'coins', en: 'Collected', label: 'المحصَّل', value: money(t.collected, ''), unit,
                /* إن بدأت الفترة المماثلة قبل أول يومٍ في المرآة فذلك عدمُ
                   بياناتٍ لا صفرُ مبيعات — والفرق بينهما يُقال ولا يُخمَّن. */
                hint: prev.collected && !prev.partial
                    ? `الفترة المماثلة (${prev.from} → ${prev.to}): ${money(prev.collected, '')}`
                    : `على ${count(t.days)} يومًا · ${count(t.docs)} فاتورة`,
                delta: prev.partial ? deltaChip(null, true) : deltaChip(t.delta),
            },
            {
                icon: 'receipt', en: 'Invoices', label: 'الفواتير', tone: 'info', value: count(t.docs),
                hint: `متوسط الفاتورة ${money(t.avg_invoice, '')} ${unit}`,
            },
            {
                icon: 'scale', en: 'Net', label: 'قبل الضريبة', tone: 'neutral',
                value: money(t.ex_vat, ''), unit,
                hint: `الضريبة ${money(t.vat, '')} ${unit}`,
            },
            {
                icon: 'calendar', en: 'Per day', label: 'متوسط اليوم', tone: 'brand',
                value: money(t.avg_day, ''), unit,
                hint: s.peak ? `الذروة ${s.peak.day}: ${money(s.peak.collected, '')} ${unit}` : 'لا أيام في المدى',
            },
            {
                icon: 'package', en: 'Items', label: 'أصناف مباعة', tone: 'success', value: count(t.codes),
                hint: `${count(t.lines)} سطر بيع · ${qty(t.avg_items)} صنفًا لكل فاتورة`,
            },
            {
                icon: 'store', en: 'Registers', label: 'الكاشيريات', tone: 'info', value: count(t.cashiers),
                hint: t.no_lines ? `${count(t.no_lines)} سندًا بلا سطور أصناف` : 'كل سندٍ بسطورِه',
            },
        ];
        const series = s.series || [];
        const days = series.map((x) => String(x.day || '').slice(5));
        const charts = [
            chartCard('المبيعات اليومية', 'Daily Sales', 'ما حُصِّل فعلًا — شاملًا الضريبة', lineChart({
                ariaLabel: `المحصَّل لكل يوم في الفترة (${days.length} يومًا)`,
                labels: days,
                series: [{ label: 'المحصَّل', tone: 'brand', values: series.map((x) => Number(x.collected) || 0), fill: true }],
                notes: series.map((x) => `${count(x.docs)} فاتورة · ${x.day}`),
                formatValue: (v) => money(v, unit),
                formatMark: (v) => (v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(Math.round(v))),
                emptyText: 'لا أيام في هذه الفترة',
                bare: true,
            }), 0),
            chartCard('كيف دُفع؟', 'Payment Mix', 'نِسَبٌ من الإجمالي المحصَّل', donutChart({
                ariaLabel: 'نسبة كل طريقة دفع من الإجمالي المحصَّل',
                /* «غير مصنَّف» شريحةٌ حقيقية من الفرق المحسوب عند الخادم — لا
                   تدويرٌ يجعل الشرائح تسبق الإجمالي. */
                slices: [...(s.payments || []),
                    ...(Math.abs(Number(t.unaccounted) || 0) > 0.005
                        ? [{ label: 'غير مصنَّف', amount: Number(t.unaccounted) }] : [])]
                    .filter((p) => Number(p.amount) > 0)
                    .map((p, i) => ({ label: p.label, value: Number(p.amount), tone: `chart-${(i % 6) + 1}` })),
                centerValue: money(t.collected, ''),
                centerLabel: `الإجمالي${unit ? ` (${unit})` : ''}`,
                formatValue: (v) => money(v, unit),
                emptyText: 'لا مدفوعاتٍ مسجَّلة في هذه الفترة',
                maxSlices: 6,
                bare: true,
            }), 1),
            chartCard('ساعات البيع', 'By Hour', 'السندات التي تحمل طابع ساعة', barChart({
                ariaLabel: 'عدد الفواتير لكل ساعة',
                labels: (s.hours || []).map((h) => `${String(h.hour).padStart(2, '0')}`),
                series: [{ label: 'الفواتير', tone: 'info', values: (s.hours || []).map((h) => Number(h.docs) || 0) }],
                notes: (s.hours || []).map((h) => `${money(h.collected, unit)} · الساعة ${String(h.hour).padStart(2, '0')}`),
                formatValue: (v) => count(v),
                emptyText: 'لا توقيتاتٍ مسجَّلة في هذه الفترة',
                max: Math.max(1, ...(s.hours || []).map((h) => Number(h.docs) || 0)),
                bare: true,
            }), 2),
            chartCard('أصناف الصدارة', 'Top Items', 'صافي القيمة قبل الضريبة', barChart({
                ariaLabel: 'العشرة الأصناف الأعلى قيمةً قبل الضريبة',
                labels: (s.topItems || []).map((x) => String(x.name || '').slice(0, 14)),
                series: [{ label: 'قبل الضريبة', tone: 'brand', values: (s.topItems || []).map((x) => Number(x.ex_vat) || 0) }],
                notes: (s.topItems || []).map((x) => `${qty(x.qty)} وحدة · ${count(x.docs)} فاتورة · ${x.name}`),
                formatValue: (v) => money(v, unit),
                formatMark: (v) => (v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(Math.round(v))),
                emptyText: 'لا سطور أصناف في هذه الفترة',
                bare: true,
            }), 3),
        ];
        const cashierRows = (s.cashiers || []).map((c) => `<li class="csales__cc">
            <span class="csales__ccName" title="${esc(c.no ? `كاشيرية ${c.no}` : '')}">${esc(c.name || 'غير مُسند')}</span>
            <span class="csales__ccBar" aria-hidden="true" style="--cs-share:${Math.min(100, Number(c.share) || 0)}%"></span>
            <span class="csales__ccNums"><span class="erp-num" dir="ltr">${esc(money(c.collected, ''))}</span>
              <span class="erp-num" dir="ltr">${esc(pct(c.share))}</span></span>
            <span class="csales__ccMeta">${esc(count(c.docs))} فاتورة · متوسط ${esc(money(c.avg, ''))} · آخر ${esc(shortDay(c.last_day))}</span>
          </li>`).join('');
        q('[data-sa-board]').innerHTML = `<ul class="erp-kpis" aria-label="مؤشرات الفترة">${tiles.map(kpiTile).join('')}</ul>
          <div class="erp-dash-grid">${charts.join('')}</div>
          <section class="erp-card csales__card erp-screen-in">
            <div class="erp-card__head">
              <h3 class="erp-card__title">الكاشيريات<span class="erp-eyebrow" dir="ltr" lang="en">Registers</span></h3>
              <span class="erp-text-muted csales__cardNote">مقسَّمة على محصَّل الفترة نفسها</span>
            </div>
            <div class="erp-card__body">
              ${cashierRows ? `<ul class="csales__ccList">${cashierRows}</ul>` : '<p class="erp-text-muted">لا كاشيريات في هذه الفترة</p>'}
            </div>
          </section>`;
    }

    /* ── التحميل ─────────────────────────────────────────────────────────── */
    function serverState(s = {}) {
        const sort = s.sort || null;
        return {
            from: filters.from, to: filters.to, cashier: filters.cashier, q: filters.q,
            limit: s.pageSize || PAGE_SIZE,
            offset: ((s.page || 1) - 1) * (s.pageSize || PAGE_SIZE),
            sort: sort ? sort.key : '', dir: sort ? sort.dir : '',
        };
    }

    async function loadSummary() {
        const seq = ++busySeq;
        try {
            const s = await fetchSummary({ from: filters.from, to: filters.to, cashier: filters.cashier, q: filters.q });
            if (seq !== busySeq) {return;}
            currency = s.currency;
            paintBoard(s);
            q('[data-sa-pulse]').innerHTML = pulseHtml(s);
            paintCashierOptions(s.cashiers || []);
        } catch (e) {
            if (seq !== busySeq) {return;}
            q('[data-sa-board]').innerHTML = `<p class="csales__error">تعذر تحميل اللوحة: ${esc((e && e.message) || 'خطأ')}</p>`;
        }
    }

    /** خيارُ الكاشيرية يبقى حتى لو لم تعد في الفترة: اختيارٌ لا يظهر هو اختيارٌ يضيع.
        بلا رقمٍ لا مرشِّح: «غير مُسند» حالةٌ تُعرض ولا تُطلَب. */
    function paintCashierOptions(cashiers) {
        const sel = q('[data-sa="cashier"]');
        const keep = filters.cashier;
        const list = cashiers.filter((c) => c.no);
        const known = new Set(list.map((c) => String(c.no)));
        sel.innerHTML = '<option value="">كل الكاشيريات</option>'
            + list.map((c) => `<option value="${esc(c.no)}">${esc(c.name || 'غير مُسند')} (${esc(c.no)})</option>`).join('')
            + (keep && !known.has(keep) ? `<option value="${esc(keep)}">${esc(keep)} (خارج الفترة)</option>` : '');
        sel.value = keep;
    }

    async function loadOrders(s = {}) {
        ordersTable.setLoading(true);
        try {
            const data = await fetchOrders(serverState(s));
            currency = data.currency;
            ordersTable.setRows(data.rows);
            ordersTable.setTotalRecords(data.totals.count);
            q('[data-sa-orders-sum]').innerHTML = `<span class="erp-num" dir="ltr">${esc(count(data.totals.count))}</span> فاتورة · `
                + `<span class="erp-num" dir="ltr">${esc(money(data.totals.collected, currency))}</span>`;
        } catch (e) {
            ordersTable.setError((e && e.message) || 'تعذر تحميل الفواتير');
        }
    }

    async function loadItems(s = {}) {
        itemsTable.setLoading(true);
        try {
            const data = await fetchItems(serverState(s));
            currency = data.currency;
            itemsTable.setRows(data.rows);
            itemsTable.setTotalRecords(data.totals.count);
            const r = data.reconcile;
            q('[data-sa-items-sum]').innerHTML = `<span class="erp-num" dir="ltr">${esc(count(data.totals.count))}</span> صنفًا · `
                + `<span class="erp-num" dir="ltr">${esc(money(data.totals.ex_vat, currency))}</span>`
                + (r && Math.abs(Number(r.gap) || 0) > 0.005
                    ? `<span class="csales__amb" title="قيمةُ الأسطر لا تساوي صافيَ السندات في نفس المدى: ${esc(count(r.no_lines))} سندًا بلا سطور، ${esc(count(r.line_mismatch))} سندًا مجموعُ أسطره يخالف رأسه">`
                      + `فرقٌ عن السندات ${esc(money(r.gap, currency))}</span>` : '');
        } catch (e) {
            itemsTable.setError((e && e.message) || 'تعذر تحميل الأصناف');
        }
    }

    function loadActiveTable() {
        if (view === 'orders') {loadOrders(ordersTable.getState());}
        if (view === 'items') {loadItems(itemsTable.getState());}
    }

    function loadAll() {
        loadSummary();
        loadActiveTable();
    }

    /* ── اللوحات المنسدلة ────────────────────────────────────────────────── */
    const panel = q('[data-sa-panel]');
    const scrim = q('[data-sa-scrim]');

    function panelChrome(titleAr, titleEn, actions) {
        return `<div class="csales__panelBar">
          <h2 class="csales__barTitle" id="cs-panel-title">${esc(titleAr)}
            <span class="erp-eyebrow" dir="ltr" lang="en">${esc(titleEn)}</span></h2>
          <span class="erp-grow"></span>
          ${actions}
          <button type="button" class="erp-icon-btn" data-sa-close aria-label="إغلاق">
            <i class="ji" data-i="x" aria-hidden="true"></i></button>
        </div>`;
    }

    const printBtn = (label, attr) => `<button type="button" class="erp-btn erp-btn--primary erp-btn--sm" ${attr}>
        <i class="ji" data-i="printer" aria-hidden="true"></i><span>${esc(label)}</span></button>`;

    async function showPanel(entry) {
        /* رقمُ الجولة: فتحُ لوحةٍ جديدةٍ يُبطل رسمَ ما سبقها في الطريق، فلا
           تُكتب فاتورةٌ قديمة فوق ملفِ صنفٍ فُتح بعدها. */
        const seq = ++paintSeq;
        lastFocus = lastFocus || document.activeElement;
        scrim.hidden = false;
        panel.hidden = false;
        document.body.classList.add('csales-open');
        panel.innerHTML = `<div class="csales__panelState"><span class="csales__shimmer"></span>جارٍ الفتح…</div>`;
        try {
            if (entry.kind === 'invoice') {await paintInvoice(entry.docNo, seq);} else {await paintItem(entry.code, entry.offset, seq);}
        } catch (e) {
            if (seq !== paintSeq) {return;}
            panel.innerHTML = `${panelChrome('تعذر الفتح', 'Error', '')}
              <div class="csales__scroll"><p class="csales__error">${esc((e && e.message) || 'خطأ')}</p></div>`;
        }
    }

    function openInvoice(docNo) {
        stack.push({ kind: 'invoice', docNo });
        showPanel(stack[stack.length - 1]);
    }

    function openItem(code, offset = 0) {
        stack.push({ kind: 'item', code, offset });
        showPanel(stack[stack.length - 1]);
    }

    function hidePanels() {
        paintSeq += 1;
        panel.hidden = true;
        scrim.hidden = true;
        panel.innerHTML = '';
        document.body.classList.remove('csales-open');
        if (lastFocus && lastFocus.isConnected) {try {lastFocus.focus();} catch (_) { /* أُزيل العنصر */ }}
        lastFocus = null;
    }

    /** إغلاقٌ رجوعٌ إلى اللوحة تحتها، لا إغلاقٌ لكل ما فُتح. */
    function closePanel() {
        stack.pop();
        if (stack.length) {showPanel(stack[stack.length - 1]); return;}
        hidePanels();
    }

    /** النقر على العتمة يُغلق الكلّ دفعةً واحدة. */
    function closeAll() {
        stack.length = 0;
        hidePanels();
    }

    /* ── الفاتورة على الشاشة ─────────────────────────────────────────────── */
    async function paintInvoice(docNo, seq) {
        const d = await fetchInvoice(docNo);
        if (seq !== paintSeq) {return;}
        const s = d.slip || {};
        const cur = d.currency || currency;
        const lines = Array.isArray(d.lines) ? d.lines : [];
        const paid = (s.payments || []).filter((p) => Number(p.amount) > 0);
        const lineVat = lines.reduce((a, l) => a + (Number(l.vat) || 0), 0);
        panel.innerHTML = panelChrome('فاتورة', 'Invoice', printBtn('طباعة الفاتورة', `data-sa-panel-print="${esc(String(s.doc_no || docNo))}"`)) + `
        <div class="csales__scroll">
          <div class="csales__hero">
            <div>
              <span class="csales__heroLabel">الإجمالي شاملًا الضريبة</span>
              <strong class="csales__heroValue erp-num" dir="ltr">${esc(money(s.collected, cur))}</strong>
              <p class="csales__words">السند <span class="erp-num" dir="ltr">${esc(String(s.doc_no))}</span>
                · <span class="erp-num" dir="ltr">${esc(s.day || '—')}</span> <span class="erp-num" dir="ltr">${esc(s.time || '')}</span>
                · ${esc(s.cashier_name || 'غير مُسند')}</p>
            </div>
            <div class="csales__heroSide">
              ${fact('قبل الضريبة', money(s.ex_vat, cur), 'class="erp-num" dir="ltr"')}
              ${fact('الضريبة', money(s.vat, cur), 'class="erp-num" dir="ltr"')}
              ${Number(s.discount) > 0 ? fact('الخصم', money(s.discount, cur), 'class="erp-num" dir="ltr"') : ''}
              ${fact('المسجَّل مدفوعًا', money(s.payed, cur), 'class="erp-num" dir="ltr"')}
              ${Number(s.due) > 0.005 ? fact('باقٍ على العميل', money(s.due, cur), 'class="erp-num" dir="ltr"') : ''}
              ${fact('عدد الأسطر', `${count(s.items)} سطرًا`)}
            </div>
          </div>

          ${paid.length ? `<div class="csales__pays">${paid.map((p) => `<span class="csales__payChip">
              <b>${esc(p.label)}</b><span class="erp-num" dir="ltr">${esc(money(p.amount, cur))}</span></span>`).join('')}</div>` : ''}

          <h3 class="csales__sec">سطور الفاتورة<span class="csales__count">${lines.length} سطرًا</span></h3>
          <table class="csales__items">
            <thead><tr><th class="c">#</th><th>الصنف</th><th class="c">الكمية</th><th class="c">السعر</th>
              <th class="c">قبل الضريبة</th><th class="c">الضريبة</th><th class="c">وحدة</th></tr></thead>
            <tbody>${lines.map((l) => `<tr>
              <td class="c idx erp-num" dir="ltr">${l.no}</td>
              <td>${esc(l.name)}${l.code ? ` <small class="csales__code erp-num" dir="ltr">#${esc(l.code)}</small>` : ''}</td>
              <td class="c erp-num" dir="ltr">${esc(qty(l.qty))}</td>
              <td class="c erp-num" dir="ltr">${esc(money(l.price, ''))}</td>
              <td class="c erp-num" dir="ltr"><b>${esc(money(l.total, ''))}</b></td>
              <td class="c erp-num" dir="ltr">${esc(money(l.vat, ''))}</td>
              <td class="c">${esc(l.unit || '—')}</td>
            </tr>`).join('') || '<tr><td class="c" colspan="7">لا سطور أصناف مسجَّلة لهذا السند في المرآة — المبلغ أعلاه كما دُفع فعلًا</td></tr>'}</tbody>
            ${lines.length ? `<tfoot>
              <tr><td colspan="4">مجموع الأسطر (${lines.length})</td>
                <td class="c erp-num" dir="ltr">${esc(money(s.line_sum, ''))}</td>
                <td class="c erp-num" dir="ltr">${esc(money(lineVat, ''))}</td><td></td></tr>
            </tfoot>` : ''}
          </table>

          ${Math.abs(Number(s.drift) || 0) > 0.005 ? `<p class="csales__note"><b>الفارق:</b> الإجمالي ${esc(money(s.collected, ''))} `
            + `لا يساوي صافيًا + ضريبة (${esc(money((Number(s.ex_vat) || 0) + (Number(s.vat) || 0), ''))}) `
            + `بمقدار <span class="erp-num" dir="ltr">${esc(money(s.drift, ''))}</span> — `
            + (s.drift_within_rounding
                ? 'قدرُ تقريبِ التسعيرة لكل سطرٍ قبل الجمع، والإجمالي هو ما دُفع فعلًا.'
                : 'أكبرُ من أن يفسّره تقريبُ السطور: المحصَّلُ لا يطابق المُسعَّر، والمرآةُ لا تسجّل سببَ الفرق.')
            + `</p>` : ''}
          ${lines.length && Math.abs((Number(s.line_sum) || 0) - (Number(s.ex_vat) || 0)) > 0.005
            ? `<p class="csales__note"><b>رأسُ السند:</b> مجموعُ الأسطر ${esc(money(s.line_sum, ''))} يخالف «قبل الضريبة» `
              + `المسجَّل على السند ${esc(money(s.ex_vat, ''))} — يُعرضان معًا ولا يُصفَّر أحدهما للآخر.</p>` : ''}

          ${d.zatca ? `<h3 class="csales__sec">الاعتماد الضريبي</h3>
            <div class="csales__zatca">
              <span class="erp-badge" data-tone="${d.zatca.isvalid ? 'success' : 'warning'}" data-unknown="false">
                <i class="ji" data-i="${d.zatca.isvalid ? 'circle-check' : 'flag'}" aria-hidden="true"></i>
                <span class="erp-badge-label">${d.zatca.isvalid ? 'مُعتمدة لدى الهيئة' : 'غير مُعتمدة'}</span></span>
              ${d.zatca.inv_no ? fact('رقم الفاتورة', String(d.zatca.inv_no).slice(0, 40), 'class="erp-num" dir="ltr"') : ''}
              ${d.zatca.pih ? fact('البصمة', String(d.zatca.pih).slice(0, 24), 'class="erp-num" dir="ltr"') : ''}
              ${d.zatca.payableamount != null ? fact('المبلغ لدى الهيئة', money(d.zatca.payableamount, cur), 'class="erp-num" dir="ltr"') : ''}
            </div>` : ''}

          <p class="csales__hint">الطباعة من شريط العارض بعد الفتح، أو من زر «طباعة الفاتورة» أعلاه.</p>
        </div>`;
    }

    /* ── ملف الصنف: كميّته وكل فواتيره ───────────────────────────────────── */
    async function paintItem(code, offset = 0, seq) {
        const d = await fetchItem(code, { from: filters.from, to: filters.to, cashier: filters.cashier, limit: PAGE_SIZE, offset });
        if (seq !== paintSeq) {return;}
        const cur = d.currency || currency;
        const a = d.agg || {};
        const name = d.names[0] ? d.names[0].name : code;
        const series = d.series || [];
        const invoices = d.invoices || [];
        const totalDocs = Number(d.totals.count) || 0;
        const pageFrom = totalDocs ? offset + 1 : 0;
        const pageTo = Math.min(offset + PAGE_SIZE, totalDocs);
        panel.innerHTML = panelChrome('ملف الصنف', 'Item File',
            printBtn('طباعة الملف', `data-sa-item-sheet="${esc(code)}"`)
            + `<button type="button" class="erp-btn erp-btn--sm" data-sa-item-orders="${esc(code)}">
                 <i class="ji" data-i="receipt" aria-hidden="true"></i><span>الفواتير في اللوحة</span></button>`) + `
        <div class="csales__scroll">
          <div class="csales__hero">
            <div>
              <span class="csales__heroLabel">الكمية المباعة${d.names.length > 1 ? ' لكل أسمائه' : ''}</span>
              <strong class="csales__heroValue erp-num" dir="ltr">${esc(qty(a.qty))}</strong>
              <p class="csales__words">${esc(name)} · رمز <span class="erp-num" dir="ltr">${esc(code)}</span>
                · في <span class="erp-num" dir="ltr">${esc(count(a.docs))}</span> فاتورة</p>
            </div>
            <div class="csales__heroSide">
              ${fact('قبل الضريبة', money(a.ex_vat, cur), 'class="erp-num" dir="ltr"')}
              ${fact('الضريبة', money(a.vat, cur), 'class="erp-num" dir="ltr"')}
              ${fact('متوسط الوحدة', money(a.avg_price, cur), 'class="erp-num" dir="ltr"')}
              ${fact('لكل فاتورة', `${qty(a.per_invoice)} وحدة`, 'class="erp-num" dir="ltr"')}
              ${fact('سطور البيع', `${count(a.lines)} سطرًا`)}
              ${fact('من أول يوم', String(a.first_day || '—'), 'class="erp-num" dir="ltr"')}
              ${fact('إلى آخر يوم', String(a.last_day || '—'), 'class="erp-num" dir="ltr"')}
            </div>
          </div>

          ${d.names.length > 1 ? `<p class="csales__note"><b>أسماء هذا الرمز:</b> الرمزُ واحدٌ والأسماءُ ${d.names.length} في الكاشيريات —
            الكميةُ أعلاه مجموعةٌ بالرمز لا بالاسم، فلا يُعدّ الصنفُ مرتين.</p>` : ''}
          <h3 class="csales__sec">الأسماء المرصودة<span class="csales__count">${d.names.length}</span></h3>
          <ul class="csales__mini">${d.names.map((n) => `<li><span>${esc(n.name)}</span>
            <span class="erp-num" dir="ltr">${esc(qty(n.qty))}</span>
            <span class="csales__miniMeta">${esc(count(n.lines))} سطرًا</span></li>`).join('') || '<li>—</li>'}</ul>

          <h3 class="csales__sec">الأسعار المرصودة<span class="csales__count">${d.prices.length}</span></h3>
          <ul class="csales__mini">${d.prices.map((p) => `<li><span class="erp-num" dir="ltr">${esc(money(p.price, cur))}</span>
            <span class="erp-num" dir="ltr">${esc(qty(p.qty))}</span>
            <span class="csales__miniMeta">${esc(count(p.lines))} سطرًا · ${esc(pct(p.share))} من القيمة</span></li>`).join('') || '<li>—</li>'}</ul>

          <div class="erp-dash-grid csales__panelGrid">${chartCard('منحنى الكمية اليومية', 'Daily Qty', 'وحدات في كل يوم', lineChart({
            ariaLabel: `الكمية المباعة لهذا الصنف كل يوم (${series.length} يومًا)`,
            labels: series.map((x) => String(x.day || '').slice(5)),
            series: [{ label: 'الكمية', tone: 'chart-2', values: series.map((x) => Number(x.qty) || 0), fill: true }],
            notes: series.map((x) => `${count(x.docs)} فاتورة · ${x.day}`),
            formatValue: (v) => qty(v),
            formatMark: (v) => (v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(Math.round(v))),
            emptyText: 'لا أيام بيعٍ لهذا الصنف',
            bare: true,
        }), 0)
            + chartCard('أين يُباع؟', 'By Register', 'كميةٌ لكل كاشيرية', donutChart({
                ariaLabel: 'حصة كل كاشيرية من كمية هذا الصنف',
                slices: (d.cashiers || []).map((c, i) => ({ label: c.name, value: Number(c.qty) || 0, tone: `chart-${(i % 6) + 1}` })),
                centerValue: qty(a.qty), centerLabel: 'الوحدة',
                formatValue: (v) => qty(v), emptyText: 'لا كاشيريات لهذا الصنف', maxSlices: 7, bare: true,
            }), 1)}</div>

          <h3 class="csales__sec">فواتير هذا الصنف<span class="csales__count">${esc(count(totalDocs))} فاتورة</span></h3>
          <table class="csales__items csales__items--orders">
            <thead><tr><th>السند</th><th>اليوم</th><th>الوقت</th><th>الكاشيرية</th><th>في هذه الفاتورة</th>
              <th>قبل الضريبة</th><th>الفاتورة</th><th></th></tr></thead>
            <tbody>${invoices.map((r) => `<tr>
              <td><button type="button" class="csales__ref erp-num" dir="ltr" data-sa-invoice="${esc(String(r.doc_no))}">${esc(String(r.doc_no))}</button></td>
              <td title="${esc(r.day)}">${esc(shortDay(r.day))}</td>
              <td class="erp-num" dir="ltr">${esc(r.time || '—')}</td>
              <td>${esc(r.cashier_name || '—')}</td>
              <td><span class="erp-num" dir="ltr">${esc(qty(r.qty))}</span> ×
                <span class="erp-num" dir="ltr">${esc(money(r.price, ''))}</span>
                ${r.times_in_invoice > 1 ? `<span class="csales__amb" title="مرات تكرار نفس الرمز داخل السند">${esc(count(r.times_in_invoice))}×</span>` : ''}</td>
              <td class="erp-num" dir="ltr">${esc(money(r.line_ex_vat, ''))}
                <small class="csales__code">ضريبة ${esc(money(r.line_vat, ''))}</small></td>
              <td class="erp-num" dir="ltr">${esc(money(r.invoice_collected, ''))}
                <small class="csales__code">${esc(count(r.invoice_items))} صنفًا</small></td>
              <td><button type="button" class="csales__open" data-sa-print="${esc(String(r.doc_no))}"
                     aria-label="طباعة فاتورة ${esc(String(r.doc_no))}">
                <i class="ji" data-i="printer" aria-hidden="true"></i></button></td>
            </tr>`).join('') || '<tr><td colspan="8">لا فواتير في هذه الصفحة</td></tr>'}</tbody>
          </table>
          <div class="csales__pager">
            <button type="button" class="erp-btn erp-btn--sm" data-sa-doff="${esc(String(Math.max(0, offset - PAGE_SIZE)))}"
                    ${offset <= 0 ? 'disabled' : ''}>
              <i class="ji" data-i="chevron-right" aria-hidden="true"></i><span>الأحدث</span></button>
            <span class="csales__pageInfo">من <span class="erp-num" dir="ltr">${esc(count(pageFrom))}</span>
              إلى <span class="erp-num" dir="ltr">${esc(count(pageTo))}</span>
              من <span class="erp-num" dir="ltr">${esc(count(totalDocs))}</span></span>
            <button type="button" class="erp-btn erp-btn--sm"
                    data-sa-doff="${esc(String(Math.min(offset + PAGE_SIZE, Math.max(0, totalDocs - PAGE_SIZE))))}"
                    ${offset + PAGE_SIZE >= totalDocs ? 'disabled' : ''}><span>الأقدم</span>
              <i class="ji" data-i="chevron-left" aria-hidden="true"></i></button>
          </div>
          <p class="csales__hint">ملفُ الصنف يُحسب على نفس مرشّحات الشاشة (الفترة والكاشيرية)، والفواتير مرتّبة من الأحدث.</p>
        </div>`;
    }

    /** تفويضٌ واحد على اللوحة: الأزرار تُستبدل بكل رسمٍ والمعالجُ يبقى. */
    panel.addEventListener('click', (ev) => {
        const close = ev.target.closest('[data-sa-close]');
        if (close) {closePanel(); return;}
        const pp = ev.target.closest('[data-sa-panel-print]');
        if (pp) {printInvoice(pp.dataset.saPanelPrint, pp); return;}
        const sheet = ev.target.closest('[data-sa-item-sheet]');
        if (sheet) {printSheet({ view: 'item', code: sheet.dataset.saItemSheet }, 'ملف الصنف', sheet); return;}
        const asOrders = ev.target.closest('[data-sa-item-orders]');
        if (asOrders) {
            /* الرمزُ في مربع البحث يُحوَّل إلى جدول الفواتير: نفس المرشّحات
               ونفس الأرقام، في جدولٍ يُقلَّب ويُطبع. */
            filters.q = asOrders.dataset.saItemOrders;
            q('[data-sa="q"]').value = filters.q;
            switchView('orders');
            closePanel();
            ordersTable.setPage(1);
            loadAll();
            return;
        }
        const off = ev.target.closest('[data-sa-doff]');
        if (off && !off.disabled) {
            const top = stack[stack.length - 1];
            if (top && top.kind === 'item') {
                top.offset = Number(off.dataset.saDoff) || 0;
                showPanel(top);
            }
        }
    });

    /* ── الطباعة ─────────────────────────────────────────────────────────── */
    async function printInvoice(docNo, btn) {
        if (btn) {btn.disabled = true;}
        try {
            const w = openInAppReport(`فاتورة ${docNo}`);
            w.document.write(await fetchInvoiceHtml(docNo));
            w.document.close();
        } catch (e) {
            notify((e && e.message) || 'تعذر طباعة الفاتورة', 'error');
        } finally {
            if (btn) {btn.disabled = false;}
        }
    }

    async function printSheet(extra, title, btn) {
        if (btn) {btn.disabled = true;}
        try {
            const w = openInAppReport(title);
            w.document.write(await fetchSheetHtml({
                from: filters.from, to: filters.to, cashier: filters.cashier, q: filters.q, limit: 500, ...extra,
            }));
            w.document.close();
        } catch (e) {
            notify((e && e.message) || 'تعذر طباعة الكشف', 'error');
        } finally {
            if (btn) {btn.disabled = false;}
        }
    }

    /* ── العرض والمرشّحات ────────────────────────────────────────────────── */
    function switchView(key) {
        view = key;
        for (const v of VIEWS) {
            q(`[data-sa-${v.key}]`).hidden = v.key !== key;
        }
        el.querySelectorAll('[data-sa-view]').forEach((b) => {
            const on = b.dataset.saView === key;
            b.classList.toggle('is-active', on);
            b.setAttribute('aria-pressed', on ? 'true' : 'false');
        });
        const names = { board: 'كشف الفواتير', orders: 'كشف الفواتير', items: 'كشف الأصناف' };
        q('[data-sa-print-label]').textContent = `طباعة ${names[key] || 'الكشف'}`;
    }

    function applyPreset(key) {
        const p = PRESETS.find((x) => x.key === key) || PRESETS[2];
        filters.preset = key;
        filters.from = p.from;
        filters.to = p.to;
        q('[data-sa="from"]').value = p.from;
        q('[data-sa="to"]').value = p.to;
        el.querySelectorAll('[data-sa-preset]').forEach((b) => {
            const on = b.dataset.saPreset === key;
            b.classList.toggle('is-active', on);
            b.setAttribute('aria-pressed', on ? 'true' : 'false');
        });
        touch();
    }

    /** تغيّرت المرشّحات: الصفحة تُصفَّر في الجدول النشط وتُعاد اللوحة معه. */
    function touch() {
        q('[data-sa-clear]').hidden = !(filters.cashier || filters.q);
        if (view === 'orders') {ordersTable.setPage(1);}
        if (view === 'items') {itemsTable.setPage(1);}
        loadAll();
    }

    el.querySelectorAll('[data-sa-preset]').forEach((b) => {
        b.addEventListener('click', () => applyPreset(b.dataset.saPreset));
    });
    el.querySelectorAll('[data-sa-view]').forEach((b) => {
        b.addEventListener('click', () => {
            switchView(b.dataset.saView);
            loadActiveTable();
        });
    });
    for (const key of ['from', 'to']) {
        q(`[data-sa="${key}"]`).addEventListener('change', () => {
            filters[key] = q(`[data-sa="${key}"]`).value;
            el.querySelectorAll('[data-sa-preset]').forEach((b) => {
                b.classList.remove('is-active');
                b.setAttribute('aria-pressed', 'false');
            });
            filters.preset = '';
            touch();
        });
    }
    q('[data-sa="cashier"]').addEventListener('change', () => {
        filters.cashier = q('[data-sa="cashier"]').value;
        touch();
    });
    let searchTimer = 0;
    q('[data-sa="q"]').addEventListener('input', () => {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(() => {
            filters.q = q('[data-sa="q"]').value.trim();
            touch();
        }, 350);
    });
    q('[data-sa-clear]').addEventListener('click', () => {
        filters.cashier = '';
        filters.q = '';
        q('[data-sa="cashier"]').value = '';
        q('[data-sa="q"]').value = '';
        ordersTable.setQuery('');
        itemsTable.setQuery('');
        touch();
    });
    q('[data-sa-print-sheet]').addEventListener('click', (ev) => {
        const view2 = view === 'items' ? 'items' : 'orders';
        printSheet({ view: view2 }, view2 === 'items' ? 'كشف الأصناف المباعة' : 'كشف فواتير الكاشير', ev.currentTarget);
    });

    scrim.addEventListener('click', closeAll);
    const onKey = (e) => {
        if (e.key === 'Escape' && !panel.hidden) {closePanel();}
    };
    document.addEventListener('keydown', onKey);

    /* إرجاءٌ أوليّ: اللوحة تُرسم أوّلًا، ثم الجدول إن كان هو النشط — فلا
       طلبٌ ثقيلٌ يسبق ما يراه المستخدم. */
    switchView(view);
    loadAll();
    return {
        destroy() {
            clearTimeout(searchTimer);
            document.removeEventListener('keydown', onKey);
            ordersTable.destroy();
            itemsTable.destroy();
            document.body.classList.remove('csales-open');
            host.innerHTML = '';
        },
        refresh: () => { loadAll(); },
        openInvoice,
        openItem,
    };
}
