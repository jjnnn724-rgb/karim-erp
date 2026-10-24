/**
 * screens/cash-register.js — سجلّ الصرف + إذن الصرف
 * ══════════════════════════════════════════════════════════════════════
 * «سجلّ الصرف» صفحة واحدة تجمع كل ما خرج من الصندوق: كل حركة معلَّمةً بإذنها
 * وحالتها، فوقها مؤشرات الفترة ومنحنى أيامها وتوزيع أقسامها. فتح أي سطر
 * يُنزل **إذن الصرف** كما يُطبع: أصنافه المعتمدة، مسجَّله في دفتر الحركات،
 * سلسلة اعتماده، وتواقيعه الفعلية.
 *
 * الباب الواحد للشبكة: js/v2/data/expense-register-repo.js — هذه الشاشة لا
 * تعرف العنوان ولا الرؤوس ولا طريقة المصادقة. الورقتان HTML تُعرضان في عارض
 * V2 وشريطه هو مَن يطبع (قفزة المتصفح إلى نقطةٍ محمية برؤوس مصادقة ترجع 401
 * حتمًا، فالمتصفح لا يرسل معها شيئًا).
 *
 * المبادئ: قراءةٌ فقط · لا مكتبة رسوم · رموز --erp-* فقط · لا معالجات inline
 * · كل رقمٍ ومنةٍ ونسبةٍ من الخادم · RTL عربي · الترقيم صادق (العدد القادم
 * من الخادم هو عدد المطابق كلّه، لا المعروض).
 */
import { createDataTable } from '../data-display/data-table.js?v=4.9.154';
import { statusBadge } from '../status.js?v=4.9.154';
import { barChart, donutChart } from '../charts.js?v=4.9.154';
import { openInAppReport } from '../report-viewer.js?v=4.9.154';
import {
    fetchExpenseRegister, fetchVoucher, fetchVoucherHtml, fetchRegisterHtml,
    typeLabel, money, count, splitDesc, voucherRef, periodPresets, isoDay,
} from '../data/expense-register-repo.js?v=4.9.154';

const esc = (v) => String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const PRESETS = periodPresets();
const PAGE_SIZE = 25;

/** تاريخ ISO مختصر للجدول: «22 أكتوبر» مع بقاء الكامل في title. */
function shortDay(v) {
    const s = String(v || '').slice(0, 10);
    if (!s) {return '—';}
    const d = new Date(`${s}T00:00:00`);
    if (Number.isNaN(d.getTime())) {return s;}
    return d.toLocaleDateString('ar-EG', { day: '2-digit', month: 'short', year: 'numeric' });
}

/** وقت سلسلة الاعتماد: الخادم يرسل ISO أو naive — كلاهما يُعرض «تاريخ ساعة».
    ما لا يُقرأ يُطبع كما جاء؛ لا اختراعَ لطابع لم تُفهم صيغته. */
function stageTime(v) {
    if (!v) {return '—';}
    const d = v instanceof Date ? v : new Date(String(v));
    if (Number.isNaN(d.getTime())) {return String(v);}
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** وسمُ الفرق: Rising cost is red AND points up — اللونُ للجودة والسهمُ للاتجاه. */
function deltaChip(delta, unit) {
    if (delta === null || delta === undefined) {
        return '<span class="erp-kpi__hint">لا فترة مماثلة للمقارنة</span>';
    }
    const dir = delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat';
    const icon = delta > 0 ? 'trending-up' : delta < 0 ? 'trending-down' : 'dot-gray';
    return `<span class="erp-delta erp-delta--${dir}"><i class="ji" data-i="${icon}" aria-hidden="true"></i>`
        + `<span class="erp-num" dir="ltr">${esc(Math.abs(delta).toFixed(1))}${esc(unit || '%')}</span></span>`;
}

function kpiTile(k) {
    return `<li class="erp-kpi">
      <div class="erp-kpi__top">
        <span class="erp-kpi__icon" data-tone="${esc(k.tone || 'brand')}" aria-hidden="true">
          <i class="ji" data-i="${esc(k.icon)}"></i></span>
        <span class="erp-kpi__label">${esc(k.label)}<span class="erp-eyebrow" dir="ltr" lang="en">${esc(k.en)}</span></span>
      </div>
      <div class="erp-kpi__value"><span class="erp-num" dir="ltr">${esc(k.value)}</span>
        ${k.unit ? `<span class="erp-kpi__unit">${esc(k.unit)}</span>` : ''}</div>
      <div class="erp-kpi__foot">${k.delta != null || k.noCompare
        ? deltaChip(k.delta) : ''}<span class="erp-kpi__hint">${esc(k.hint)}</span></div>
    </li>`;
}

function template(presetKey) {
    const seg = `<div class="erp-seg erp-no-print" role="group" aria-label="الفترة">
      <span class="erp-seg__label">الفترة</span>
      ${PRESETS.map((p) => `<button type="button" data-cr-preset="${esc(p.key)}"`
        + `${p.key === presetKey ? ' class="is-active" aria-pressed="true"' : ' aria-pressed="false"'}>${esc(p.label)}</button>`).join('')}
    </div>`;
    return `
    <section class="erp-v2 cashreg erp-stack">
      <header class="cashreg__head erp-screen-in">
        <div>
          <h1 class="cashreg__title">سجلّ الصرف
            <span class="erp-eyebrow" dir="ltr" lang="en">Expense Register</span></h1>
          <p class="cashreg__sub">كل ما خرج من الصندوق: حركةٌ بكلّ إذنها واعتماداتها وتواقيعها</p>
        </div>
        <div class="cashreg__tools erp-no-print">
          ${seg}
          <label class="erp-field"><span class="erp-label">من</span>
            <input class="erp-input erp-input--ltr" type="date" data-cr="from" value="${esc(PRESETS.find((p) => p.key === presetKey)?.from ?? isoDay(0))}"></label>
          <label class="erp-field"><span class="erp-label">إلى</span>
            <input class="erp-input erp-input--ltr" type="date" data-cr="to" value="${esc(PRESETS.find((p) => p.key === presetKey)?.to ?? isoDay(0))}" max="${esc(isoDay(0))}"></label>
          <button type="button" class="erp-btn erp-btn--sm" data-cr-print-list>
            <i class="ji" data-i="printer" aria-hidden="true"></i><span>طباعة الكشف</span></button>
        </div>
      </header>

      <div data-cr-kpis aria-live="polite"></div>

      <div class="erp-dash-grid" data-cr-charts></div>

      <section class="erp-card cashreg__card erp-screen-in">
        <div class="erp-card__head">
          <h3 class="erp-card__title">الحركات
            <span class="erp-eyebrow" dir="ltr" lang="en">Movements</span></h3>
          <span class="cashreg__howto">افتح أي سطر بقائمة السهم لترى إذنه كاملاً</span>
          <span class="erp-grow"></span>
          <div class="cashreg__filters erp-no-print">
            <label class="erp-field"><span class="erp-sr-only">النوع</span>
              <select class="erp-select" data-cr="type"><option value="">كل الأنواع</option></select></label>
            <label class="erp-field"><span class="erp-sr-only">القسم</span>
              <select class="erp-select" data-cr="dept"><option value="">كل الأقسام</option></select></label>
            <label class="cashreg__search">
              <i class="ji" data-i="search" aria-hidden="true"></i>
              <span class="erp-sr-only">بحث في البيان</span>
              <input class="erp-input erp-grow" type="search" data-cr="q" placeholder="بحث في البيان…" autocomplete="off">
            </label>
            <button type="button" class="erp-btn erp-btn--sm" data-cr-clear hidden>إلغاء المرشّحات</button>
          </div>
        </div>
        <div class="erp-card__body"><div data-cr-table></div></div>
      </section>

      <div class="cashreg__scrim" data-cr-scrim hidden></div>
      <aside class="cashreg__panel" data-cr-panel hidden role="dialog" aria-modal="true"
             aria-labelledby="cr-panel-title"></aside>
    </section>`;
}

/**
 * @param {HTMLElement} host
 * @param {{ navigate?: (key:string)=>void }} [ctx]
 */
export function mountCashRegister(host, ctx = {}) {
    const navigate = typeof ctx.navigate === 'function' ? ctx.navigate : () => {};
    const filters = { preset: 'month', from: `${isoDay(0).slice(0, 7)}-01`, to: isoDay(0), type: '', dept: '', q: '' };
    let currency = '';
    let lastFocus = null;
    let busySeq = 0;

    host.insertAdjacentHTML('beforeend', template(filters.preset));
    const el = host.lastElementChild;
    const q = (sel) => el.querySelector(sel);
    const notify = (msg, kind) => {
        if (typeof window !== 'undefined' && typeof window.toast === 'function') {window.toast(msg, kind || 'success');}
    };

    /* ── الجدول: صفحةٌ واحدة من الخادم في كل مرة ─────────────────────────── */
    const columns = [
        {
            key: 'date', header: 'التاريخ', sortable: true, type: 'text', width: '112px',
            render: (r) => `<span title="${esc(r.date)}">${esc(shortDay(r.date))}</span>`,
        },
        {
            key: 'voucher', header: 'إذن الصرف', sortable: true, type: 'number', width: '108px',
            render: (r) => (r.request_id
                ? `<span class="cashreg__ref" dir="ltr" title="${esc(String(r.request_id))}">${esc(voucherRef(r.request_id).short)}</span>`
                : '<span class="erp-text-faint">—</span>'),
        },
        {
            key: 'description', header: 'البيان', sortable: true,
            render: (r) => {
                const parts = splitDesc(r.desc, typeLabel(r.adjustmentType));
                return parts.lead
                    ? `<span class="cashreg__desc"><span class="cashreg__lead">${esc(parts.lead)}</span>${esc(parts.rest)}</span>`
                    : `<span class="cashreg__desc">${esc(r.desc || '—')}</span>`;
            },
        },
        {
            key: 'dept', header: 'القسم', sortable: true,
            render: (r) => esc(r.request_dept || r.deptId || '—'),
        },
        {
            key: 'type', header: 'النوع',
            render: (r) => `<span class="cashreg__type">${esc(typeLabel(r.adjustmentType))}</span>`,
        },
        {
            key: 'status', header: 'الحالة', sortable: true, width: '150px',
            render: (r) => (r.request_status
                ? statusBadge('dispatch', r.request_status, { title: `حالة إذن صرف ${voucherRef(r.request_id).full}` })
                : `<span class="erp-badge" data-tone="${r.autoGenerated ? 'neutral' : 'warning'}" data-unknown="false">
                     <i class="ji" data-i="${r.autoGenerated ? 'zap' : 'pencil'}" aria-hidden="true"></i>
                     <span class="erp-badge-label">${r.autoGenerated ? 'آليّ بلا إذن' : 'يدوي'}</span></span>`),
        },
        {
            key: 'amount', header: 'المبلغ', sortable: true, type: 'number', align: 'end', width: '150px',
            /* النسبة من إجمالي الفترة — محسوبةٌ عند الخادم، والعمودُ مصغّرٌ لها. */
            render: (r) => `<div class="cashreg__amt"><span class="erp-num" dir="ltr">${esc(money(r.amount, currency))}</span>
              <span class="cashreg__share" style="--cr-share:${Math.min(100, Number(r.share) || 0)}%"
                    title="${esc(`${Number(r.share) || 0}% من الفترة`)}" aria-hidden="true"></span></div>`,
        },
        {
            key: 'go', header: '', width: '44px', align: 'center',
            /* زرٌّ صريح لكل سطر: اللمسة الوحيدة تفتح الإذن (اللوحة تُفتح أيضًا
               بنقرٍ مزدوجٍ أو Enter كما يرى المكوّن). */
            render: (r) => (r.request_id
                ? `<button type="button" class="cashreg__open" data-cr-open="${esc(String(r.request_id))}"
                           aria-label="فتح إذن صرف ${esc(voucherRef(r.request_id).short)}">
                      <i class="ji" data-i="chevron-down" aria-hidden="true"></i></button>`
                : '<span class="erp-text-faint" aria-hidden="true">·</span>'),
        },
    ];

    const table = createDataTable({
        columns,
        rows: [],
        mode: 'server',
        pageSize: PAGE_SIZE,
        search: false,
        emptyMessage: 'لا حركات في هذه الفترة',
        emptyHint: 'وسّع المدى أو ألغِ المرشّحات.',
        rowKey: (r) => String(r.id),
        onRowActivate: (r) => { if (r && r.request_id) {openVoucher(r.request_id);} },
        onStateChange: (s) => { load(s); },
    });
    q('[data-cr-table]').appendChild(table.el);

    /* تفويضٌ واحد للسطر: زر «افتح الإذن» يولَّد مع كل رسمٍ فلا معالجَ inline. */
    table.el.addEventListener('click', (ev) => {
        const btn = ev.target.closest('[data-cr-open]');
        if (btn) {openVoucher(btn.dataset.crOpen);}
    });

    /* ── المؤشرات والرسوم ────────────────────────────────────────────────── */
    function paintKpis(t) {
        const top = t.depts && t.depts.length ? t.depts[0] : null;
        const tiles = [
            {
                icon: 'wallet', en: 'Total', label: 'إجمالي الصرف',
                value: money(t.totals.total, ''), unit: currency,
                hint: `على ${count(t.totals.days)} يوم`,
                delta: t.totals.delta, noCompare: t.totals.delta == null,
            },
            {
                icon: 'receipt', en: 'Movements', label: 'عدد الحركات', tone: 'info',
                value: count(t.totals.count),
                hint: `${count(t.totals.vouchers)} إذن صرف`,
            },
            {
                icon: 'scale', en: 'Average', label: 'متوسط اليوم', tone: 'neutral',
                value: money(t.totals.avg_day, ''), unit: currency,
                hint: `متوسط الحركة ${money(t.totals.avg_row, '')}`,
            },
            {
                icon: 'store', en: 'Top dept', label: 'أكثر قسمًا صرفًا', tone: 'brand',
                value: esc(top ? top.dept : '—'),
                hint: top ? `${money(top.total, '')} ${esc(currency)} · ${count(top.n)} حركة` : 'لا بيانات',
            },
            {
                icon: 'pencil', en: 'Manual', label: 'صرف يدوي', tone: 'warning',
                value: money(t.totals.manual_total, ''), unit: currency,
                hint: 'غير مُولَّد آليًا',
            },
            {
                icon: 'circle-alert', en: 'Unlinked', label: 'بلا إذن صرف', tone: t.totals.unlinked ? 'danger' : 'success',
                value: count(t.totals.unlinked),
                hint: t.totals.unlinked ? 'حرّكاتها غير مربوطة بإذن' : 'كل الحركة معلَّمة بإذن',
            },
        ];
        q('[data-cr-kpis]').innerHTML = `<ul class="erp-kpis" aria-label="مؤشرات الفترة">${tiles.map(kpiTile).join('')}</ul>`;
    }

    /** بطاقة رسم: الرسم العاري داخل erp-card — نفس بنية موجز المدير. */
    function chartCard(titleAr, titleEn, note, chartHtml, i) {
        return `<section class="erp-card cashreg__card erp-screen-in" style="--cr-i:${i}">
          <div class="erp-card__head">
            <h3 class="erp-card__title">${esc(titleAr)}<span class="erp-eyebrow" dir="ltr" lang="en">${esc(titleEn)}</span></h3>
            <span class="erp-text-muted cashreg__cardNote">${esc(note)}</span>
          </div>
          <div class="erp-card__body">${chartHtml}</div>
        </section>`;
    }

    function paintCharts(t) {
        const series = t.series || [];
        const days = series.map((s) => String(s.day || '').slice(5));
        const trend = barChart({
            ariaLabel: `إجمالي الصرف لكل يوم في الفترة (${days.length} يومًا)`,
            labels: days,
            series: [{ label: 'الصرف', tone: 'brand', values: series.map((s) => Number(s.total) || 0) }],
            notes: series.map((s) => `${count(s.n)} حركة · ${s.day}`),
            formatValue: (v) => money(v, currency),
            formatMark: (v) => (v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(Math.round(v))),
            emptyText: 'لا أيام في هذه الفترة',
            bare: true,
        });
        /* الألوان فئاتٌ لا أحكام: سُلَّم chart-* المتدرّج، لا ألوان دلالية. */
        const slices = (t.depts || []).map((d, i) => ({
            label: d.dept, value: Number(d.total) || 0, tone: `chart-${(i % 6) + 1}`,
        }));
        const mix = donutChart({
            ariaLabel: 'نسبة كل قسم من إجمالي الصرف',
            slices,
            centerValue: money(t.totals.total, ''),
            centerLabel: `الإجمالي${currency ? ` (${currency})` : ''}`,
            formatValue: (v) => money(v, currency),
            emptyText: 'لا أقسام في هذه الفترة',
            maxSlices: 7,
            bare: true,
        });
        q('[data-cr-charts]').innerHTML = [
            chartCard('منحنى الصرف اليومي', 'Daily Spend', 'لكل يومٍ في المدى', trend, 0),
            chartCard('أين يصرف؟', 'By Department', 'نِسَبٌ من إجمالي الفترة', mix, 1),
        ].join('');
    }

    function paintFilters(t) {
        const typeSel = q('[data-cr="type"]');
        typeSel.innerHTML = '<option value="">كل الأنواع</option>'
            + (t.types || []).map((x) => `<option value="${esc(x.type)}">${esc(x.label || typeLabel(x.type))} (${count(x.n)})</option>`).join('');
        typeSel.value = filters.type;

        const deptSel = q('[data-cr="dept"]');
        deptSel.innerHTML = '<option value="">كل الأقسام</option>'
            + (t.depts || []).filter((d) => d.code)
                .map((d) => `<option value="${esc(d.code)}">${esc(d.dept)}</option>`).join('');
        deptSel.value = filters.dept;

        const anyFilter = !!(filters.type || filters.dept || filters.q);
        q('[data-cr-clear]').hidden = !anyFilter;
    }

    /* ── التحميل ─────────────────────────────────────────────────────────── */
    function serverState(s = {}) {
        const sort = s.sort || null;
        return {
            from: filters.from, to: filters.to, type: filters.type, dept: filters.dept, q: filters.q,
            limit: s.pageSize || PAGE_SIZE,
            offset: ((s.page || 1) - 1) * (s.pageSize || PAGE_SIZE),
            sort: sort ? sort.key : '', dir: sort ? sort.dir : '',
        };
    }

    async function load(s = {}) {
        const seq = ++busySeq;
        table.setLoading(true);
        try {
            const data = await fetchExpenseRegister(serverState(s));
            if (seq !== busySeq) {return;}
            currency = data.currency;
            paintKpis(data);
            paintCharts(data);
            paintFilters(data);
            table.setRows(data.rows);
            table.setTotalRecords(data.totals.count);
        } catch (e) {
            if (seq !== busySeq) {return;}
            table.setError((e && e.message) || 'تعذر تحميل السجل');
        }
    }

    /* ── لوحة إذن الصرف ─────────────────────────────────────────────────── */
    const panel = q('[data-cr-panel]');
    const scrim = q('[data-cr-scrim]');

    function closePanel() {
        panel.hidden = true;
        scrim.hidden = true;
        panel.innerHTML = '';
        document.body.classList.remove('cashreg-open');
        if (lastFocus && lastFocus.isConnected) {try {lastFocus.focus();} catch (_) { /* أُزيل العنصر */ }}
        lastFocus = null;
    }

    const fact = (label, value, extra) => `<div class="cashreg__fact"><b>${esc(label)}</b>`
        + `<span${extra ? ` ${extra}` : ''}>${esc(value)}</span></div>`;

    const stageIcon = { created: 'file-text', chef: 'chef-hat', warehouse: 'shield-check', kitchen: 'package', reject: 'circle-x' };

    function stageRow(s, i) {
        return `<li class="cashreg__stage${s.bad ? ' is-bad' : ''}${s.current ? ' is-current' : ''}">
          <span class="cashreg__stageDot" aria-hidden="true"><i class="ji" data-i="${esc(s.icon)}"></i></span>
          <div><b>${esc(s.kind)}</b>
            <span class="cashreg__stageWho">${esc(s.who || '—')}</span>
            ${s.at ? `<span class="cashreg__stageAt erp-num" dir="ltr">${esc(stageTime(s.at))}</span>` : ''}</div>
          <span class="cashreg__stageNo" aria-hidden="true">${i + 1}</span>
        </li>`;
    }

    async function openVoucher(id) {
        lastFocus = document.activeElement;
        scrim.hidden = false;
        panel.hidden = false;
        document.body.classList.add('cashreg-open');
        panel.innerHTML = '<div class="cashreg__panelState"><span class="cashreg__shimmer"></span>جارٍ فتح الإذن…</div>';
        let v;
        try {
            v = await fetchVoucher(id);
        } catch (e) {
            panel.innerHTML = `<div class="cashreg__panelState">تعذّر فتح الإذن: ${esc((e && e.message) || 'خطأ')}
              <button type="button" class="erp-btn erp-btn--sm" data-cr-close>إغلاق</button></div>`;
            panel.querySelector('[data-cr-close]').addEventListener('click', closePanel);
            return;
        }
        const d = v.dispatch || {};
        const items = Array.isArray(v.items) ? v.items : [];
        const issued = Array.isArray(v.issued) ? v.issued : [];
        const cur = v.currency || currency;
        const sig = (label, dataUrl, who) => (dataUrl ? `<figure class="cashreg__sig">
            <img src="${esc(dataUrl)}" alt="${esc(label)}"><figcaption>${esc(label)}${who ? ` — ${esc(who)}` : ''}</figcaption></figure>` : '');

        const sigHtml = [
            sig('مُعِدّ الطلب', d.requestSignatureData, d.createdBy),
            sig('اعتماد الشيف', d.chefApprovalSignatureData, d.chefApprovedBy),
            sig('أمين المخزن', d.warehouseApprovalSignatureData, d.warehouseApprovedBy || d.approvedBy),
            sig('مستلم المطبخ', d.kitchenReceiptSignatureData, d.kitchenReceivedBy),
        ].join('');
        const hasSig = sigHtml.length > 0;

        const stages = [
            d.createdBy && { kind: 'إعداد الطلب', who: d.createdBy, at: d.requestedAt || d.date, icon: stageIcon.created },
            d.chefApprovedBy && { kind: 'اعتماد الشيف', who: d.chefApprovedBy, at: d.chefApprovedAt, icon: stageIcon.chef },
            (d.warehouseApprovedBy || d.approvedBy) && {
                kind: 'اعتماد المخزن', who: d.warehouseApprovedBy || d.approvedBy,
                at: d.warehouseApprovedAt || d.approvedDate, icon: stageIcon.warehouse },
            (d.warehouseRejectedBy || d.rejectedBy) && {
                kind: 'رفض المخزن', who: d.warehouseRejectedBy || d.rejectedBy,
                at: d.warehouseRejectedAt || d.rejectedDate, icon: stageIcon.reject, bad: true },
            d.chefRejectedBy && { kind: 'رفض الشيف', who: d.chefRejectedBy, at: d.chefRejectedAt, icon: stageIcon.reject, bad: true },
            d.kitchenReceivedBy && { kind: 'استلام المطبخ', who: d.kitchenReceivedBy, at: d.kitchenReceivedAt, icon: stageIcon.kitchen },
        ].filter(Boolean).map((s, i, arr) => ({ ...s, current: i === arr.length - 1 }));

        panel.innerHTML = `
        <div class="cashreg__bar">
          <h2 class="cashreg__barTitle" id="cr-panel-title">إذن صرف
            <span class="cashreg__ref erp-num" dir="ltr">${esc(voucherRef(d.id).short || String(d.id || ''))}</span></h2>
          ${statusBadge('dispatch', d.status, { title: `الحالة القادمة من الخادم: ${String(d.status ?? '')}` })}
          <span class="erp-grow"></span>
          <button type="button" class="erp-btn erp-btn--primary erp-btn--sm" data-cr-print>
            <i class="ji" data-i="printer" aria-hidden="true"></i><span>طباعة الإذن</span></button>
          <button type="button" class="erp-btn erp-btn--sm" data-cr-open-dispatch>
            <i class="ji" data-i="external" aria-hidden="true"></i><span>طلب الصرف</span></button>
          <button type="button" class="erp-icon-btn" data-cr-close aria-label="إغلاق">
            <i class="ji" data-i="x" aria-hidden="true"></i></button>
        </div>

        <div class="cashreg__scroll">
          <div class="cashreg__hero">
            <div>
              <span class="cashreg__heroLabel">إجمالي الصرف${issued.length ? ' المسجَّل في الدفتر' : ''}</span>
              <strong class="cashreg__heroValue erp-num" dir="ltr">${esc(money(v.total, cur))}</strong>
              <p class="cashreg__words">${esc(v.amountWords || '')}</p>
            </div>
            <div class="cashreg__heroSide">
              ${fact('القسم الطالب', d.deptName || d.deptCode || '—')}
              ${fact('تاريخ الطلب', String(d.requestedAt || d.date || '—').slice(0, 10), 'class="erp-num" dir="ltr"')}
              ${fact('عدد الأصناف', String(items.length))}
              ${fact('قيمة الاعتماد', money(v.approvedValue, cur), 'class="erp-num" dir="ltr"')}
            </div>
          </div>

          <h3 class="cashreg__sec">الأصناف المعتمدة</h3>
          <table class="cashreg__items">
            <thead><tr><th class="c">#</th><th>الصنف</th><th class="c">مطلوب</th><th class="c">معتمد</th>
              <th class="c">وحدة</th><th class="c">تكلفة</th><th class="c">قيمة</th></tr></thead>
            <tbody>${items.map((it, i) => `<tr>
              <td class="c idx">${i + 1}</td>
              <td>${esc(it.itemName || it.name || '—')}</td>
              <td class="c erp-num" dir="ltr">${esc(it.requestedQty ?? it.qty ?? '—')}</td>
              <td class="c erp-num" dir="ltr">${esc(it.approvedQty ?? it.requestedQty ?? it.qty ?? '—')}</td>
              <td class="c">${esc(it.unit || '—')}</td>
              <td class="c erp-num" dir="ltr">${it.avgCost != null ? esc(Number(it.avgCost).toFixed(2)) : '—'}</td>
              <td class="c erp-num" dir="ltr"><b>${esc(Number(it.approvedValue || 0).toFixed(2))}</b></td>
            </tr>`).join('') || '<tr><td class="c" colspan="7">لا أصناف على هذا الإذن</td></tr>'}</tbody>
            <tfoot><tr><td colspan="6">الإجمالي (${items.length} صنف)</td>
              <td class="c erp-num" dir="ltr">${esc(Number(v.approvedValue || 0).toFixed(2))}</td></tr></tfoot>
          </table>

          ${issued.length ? `<h3 class="cashreg__sec">المنفَّذ في دفتر الحركات
            <span class="cashreg__count">${issued.length} حركة</span></h3>
            <ul class="cashreg__ledger">${issued.map((x) => `<li>
              <span class="erp-num" dir="ltr">${esc(String(x.date || '').slice(0, 10))}</span>
              <span class="cashreg__ledgerDesc">${esc(x.desc || '')}</span>
              <b class="erp-num" dir="ltr">${esc(Number(x.amount || 0).toFixed(2))}</b></li>`).join('')}</ul>` : ''}

          ${stages.length ? `<h3 class="cashreg__sec">سلسلة الاعتماد</h3>
            <ol class="cashreg__stages">${stages.map(stageRow).join('')}</ol>` : ''}

          ${(d.notes || d.approveNotes || d.receiptNotes || d.rejectionReason)
            ? `<h3 class="cashreg__sec">ملاحظات</h3>
            <div class="cashreg__notes">
              ${d.notes ? `<p><b>الطلب:</b> ${esc(d.notes)}</p>` : ''}
              ${d.approveNotes ? `<p><b>الاعتماد:</b> ${esc(d.approveNotes)}</p>` : ''}
              ${d.receiptNotes ? `<p><b>الاستلام:</b> ${esc(d.receiptNotes)}</p>` : ''}
              ${d.rejectionReason ? `<p class="erp-text-danger"><b>سبب الرفض:</b> ${esc(d.rejectionReason)}</p>` : ''}
            </div>` : ''}

          ${hasSig ? `<h3 class="cashreg__sec">التواقيع</h3>
            <div class="cashreg__sigs">${sigHtml}</div>
            <p class="cashreg__nosig">توقيعٌ بلا صورة يعني أنه سُجِّل قبل تفعيل لوحة التوقيع.</p>` : ''}
        </div>`;

        panel.querySelector('[data-cr-close]').addEventListener('click', closePanel);
        panel.querySelector('[data-cr-open-dispatch]').addEventListener('click', () => { closePanel(); navigate('dispatch'); });
        panel.querySelector('[data-cr-print]').addEventListener('click', async (ev) => {
            const btn = ev.currentTarget;
            btn.disabled = true;
            try {
                const w = openInAppReport(`إذن صرف ${voucherRef(d.id).short}`);
                w.document.write(await fetchVoucherHtml(d.id));
                w.document.close();
            } catch (e) {
                notify((e && e.message) || 'تعذر طباعة الإذن', 'error');
            } finally {
                btn.disabled = false;
            }
        });
    }

    /* ── أحداث المرشّحات ─────────────────────────────────────────────────── */
    function applyPreset(key) {
        const p = PRESETS.find((x) => x.key === key) || PRESETS[2];
        filters.preset = key;
        filters.from = p.from;
        filters.to = p.to;
        q('[data-cr="from"]').value = p.from;
        q('[data-cr="to"]').value = p.to;
        el.querySelectorAll('[data-cr-preset]').forEach((b) => {
            const on = b.dataset.crPreset === key;
            b.classList.toggle('is-active', on);
            b.setAttribute('aria-pressed', on ? 'true' : 'false');
        });
        table.setPage(1);
        load(table.getState());
    }

    el.querySelectorAll('[data-cr-preset]').forEach((b) => {
        b.addEventListener('click', () => applyPreset(b.dataset.crPreset));
    });
    for (const key of ['from', 'to']) {
        q(`[data-cr="${key}"]`).addEventListener('change', () => {
            filters[key] = q(`[data-cr="${key}"]`).value;
            el.querySelectorAll('[data-cr-preset]').forEach((b) => {
                b.classList.remove('is-active');
                b.setAttribute('aria-pressed', 'false');
            });
            filters.preset = '';
            table.setPage(1);
            load(table.getState());
        });
    }
    for (const key of ['type', 'dept']) {
        q(`[data-cr="${key}"]`).addEventListener('change', () => {
            filters[key] = q(`[data-cr="${key}"]`).value;
            table.setPage(1);
            load(table.getState());
        });
    }
    let searchTimer = 0;
    q('[data-cr="q"]').addEventListener('input', () => {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(() => {
            filters.q = q('[data-cr="q"]').value.trim();
            table.setPage(1);
            load(table.getState());
        }, 350);
    });
    q('[data-cr-clear]').addEventListener('click', () => {
        filters.type = '';
        filters.dept = '';
        filters.q = '';
        q('[data-cr="q"]').value = '';
        table.setQuery('');
        table.setPage(1);
        load(table.getState());
    });
    q('[data-cr-print-list]').addEventListener('click', async () => {
        try {
            const w = openInAppReport('كشف سجلّ الصرف');
            w.document.write(await fetchRegisterHtml({
                from: filters.from, to: filters.to, type: filters.type, dept: filters.dept, q: filters.q,
            }));
            w.document.close();
        } catch (e) {
            notify((e && e.message) || 'تعذر طباعة الكشف', 'error');
        }
    });

    scrim.addEventListener('click', closePanel);
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !panel.hidden) {closePanel();}
    });

    load();
    return {
        destroy() { clearTimeout(searchTimer); table.destroy(); host.innerHTML = ''; },
        refresh: () => load(table.getState()),
        openVoucher,
        printVoucherHtml: fetchVoucherHtml,
    };
}
