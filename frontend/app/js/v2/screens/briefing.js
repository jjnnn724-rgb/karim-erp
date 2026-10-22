/**
 * V2 — Manager briefing screen (الشاشة التنفيذية ببيانات حية)
 * ═══════════════════════════════════════════════════════════════════════
 *
 * WHAT THIS IS
 *   The V2 executive dashboard reading two production endpoints through
 *   v2/data/briefing-repo.js. Same visual language as the sample dashboard
 *   (erp-kpis / erp-delta / erp-tops / erp-pipe / erp-minis from
 *   css/v2/erp-dashboard.css), different source: every number on this
 *   screen is a row the legacy app already asks the database for.
 *
 * WHY IT LOOKS LIKE THE PREVIEW
 *   Reusing the existing classes is the point. If the real-data screen and
 *   the sample screen disagree about spacing or colour, the stylesheet is
 *   being changed to fit the demo — and the demo then ships.
 *
 * THE TWO CHARTS
 *   The sales bars and the payments donut are drawn by js/v2/charts.js —
 *   the same engine as the sample dashboard — so the production screen and
 *   the preview can never drift apart in colour, scale or behaviour.
 *   The engine's interaction layer (charts-live.js) gives both charts a
 *   hover tooltip, keyboard navigation and a spoken value for free.
 *
 * RULES THIS FILE FOLLOWS
 *   • No network of its own — every call goes through the repository.
 *   • No inline handlers: the origin sends a CSP *nonce*, which makes
 *     'unsafe-inline' inert, so `onclick=` would silently never run.
 *   • Both sources are fetched with allSettled: POS stats answering while the
 *     briefing 403s is a real state for a non-manager role, and the screen
 *     names what answered instead of blanking.
 *   • Colour = good/bad, arrow = direction (see deltaOf). A cost increase is
 *     red and points up.
 *   • Anything the payload does not carry is not drawn.
 *   • Six portlets only, and «يحتاج قرارًا» sits below them full-width — a
 *     work list is not a gauge.
 *   • One visual device: the «سَنَد» (thermal-receipt treatment of the latest
 *     invoices). Its CSS is css/v2/erp-briefing.css; the stamp appears on a
 *     cancelled invoice and on nothing else, because cancelling a bill is a
 *     stamped act in accounting.
 */

import { statusBadge, resolveStatus } from '../status.js?v=4.9.193';
import {
    fetchBriefing,
    fetchTodayStats,
    fetchAllOrders,
    buildBriefingView,
    formatMoney,
    formatInt,
} from '../data/briefing-repo.js?v=4.9.193';
import { fetchCurrency } from '../data/reports-repo.js?v=4.9.193';

import { barChart, donutChart, niceCeiling } from '../charts.js?v=4.9.193';

const esc = (v) => String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/* ── Markup builders ─────────────────────────────────────────────────── */

/** The pill: `favor` paints it, `sign` points it. */
function deltaPill(d) {
    const icon = d.sign === 'up' ? 'arrow-up' : d.sign === 'down' ? 'arrow-down' : null;
    const cls = d.favor === 'good' ? 'erp-delta--up' : d.favor === 'bad' ? 'erp-delta--down' : 'erp-delta--flat';
    return `<span class="erp-delta ${cls}" role="img" aria-label="${esc(d.aria)}">`
        + `${icon ? `<i class="ji" data-i="${icon}" aria-hidden="true"></i>` : ''}`
        + `<span class="erp-num" dir="ltr">${esc(d.text)}</span></span>`;
}

function kpiStrip(kpis) {
    return `<ul class="erp-kpis" aria-label="مؤشرات اليوم — مباشرة من قاعدة البيانات">`
        + kpis.map((k, i) => `
      <li class="erp-kpi" style="--erp-rise-i:${i}">
        <div class="erp-kpi__top">
          <span class="erp-kpi__icon" aria-hidden="true"><i class="ji" data-i="${esc(k.icon)}"></i></span>
          <span class="erp-kpi__label">${esc(k.label)}<span class="erp-eyebrow" dir="ltr" lang="en">${esc(k.en)}</span></span>
        </div>
        <div class="erp-kpi__value"><span class="erp-num" dir="ltr">${esc(k.value)}</span>${k.unit ? ` <span class="erp-kpi__unit">${esc(k.unit)}</span>` : ''}</div>
        <div class="erp-kpi__foot">${deltaPill(k.delta)}<span class="erp-kpi__hint">${esc(k.hint)}</span></div>
      </li>`).join('')
        + `</ul>`;
}

/**
 * منحنى المبيعات: أعمدةٌ SVG بمحورٍ يعرف مداه. القيمُ بالألوف — فيبقى
 * المحورُ مقروءًا (٠ … ٢٥) بدل أرقامٍ بعشرات الآلاف، والمالُ الكاملُ في
 * التلميح والنطق.
 */
function barsBlock(bars) {
    if (!bars.length) {
        return `<div class="erp-state"><span class="erp-state__title">لا مبيعات في آخر ٧ أيام</span></div>`;
    }
    const values = bars.map((b) => b.value / 1000);
    const peak = Math.max(...bars.map((b) => b.value));
    return barChart({
        ariaLabel: `مبيعات آخر ${bars.length} أيام، أعلاها ${formatMoney(peak)}`,
        labels: bars.map((b) => b.label),
        series: [{ label: 'المبيعات', tone: 'brand', values }],
        notes: bars.map((b) => `${formatInt(b.invoices)} فاتورة · ${b.date}`),
        max: niceCeiling(Math.max(...values, 0.1)),
        formatValue: (v) => `${formatMoney(v * 1000)} ر.س`,
        formatMark: (v) => v.toFixed(1),
        bare: true,
    });
}

/**
 * توزيع طرق الدفع: شرائحٌ بسُلَّمٍ لونيٍّ متدرّج (لا لونٌ دلاليّ — فالطرق
 * فئاتٌ لا أحكام)، وفجوةٌ بين كل شريحتين فلا يتلامس جاران.
 */
function donutBlock(payments) {
    const total = payments.reduce((a, p) => a + p.value, 0);
    if (!(total > 0)) {
        return `<div class="erp-state"><span class="erp-state__title">لا مدفوعات مسجّلة اليوم</span>
          <span>يظهر التوزيع فور إغلاق أول فاتورة.</span></div>`;
    }
    return donutChart({
        ariaLabel: `توزيع طرق الدفع اليوم بإجمالي ${formatMoney(total)}`,
        slices: payments.map((p, i) => ({
            label: p.label,
            value: p.value,
            tone: `chart-${(i % 6) + 1}`,
        })),
        centerLabel: 'إجمالي (ر.س)',
        centerValue: formatMoney(total),
        formatValue: (v) => `${formatMoney(v)} ر.س`,
        bare: true,
    });
}

function topsBlock(tops) {
    if (!tops.length) {
        return `<div class="erp-state"><span class="erp-state__title">لا أصناف مباعة بعد اليوم</span></div>`;
    }
    const max = Math.max(...tops.map((t) => t.value), 1);
    return `<ul class="erp-tops" aria-label="الأعلى مبيعًا اليوم بقيمة المبيعات">`
        + tops.map((t) => `
      <li class="erp-top__row">
        <span class="erp-top__name">${esc(t.name)}</span>
        <span class="erp-top__track"><span class="erp-top__fill" style="inline-size:${Math.round((t.value / max) * 100)}%"></span></span>
        <span class="erp-top__val"><span class="erp-num" dir="ltr">${esc(formatMoney(t.value))}</span></span>
      </li>`).join('')
        + `</ul>`;
}

function pipeBlock(pipeline) {
    return `<ol class="erp-pipe" tabindex="0" aria-label="حركة فواتير اليوم بحسب حالتها الفعلية">`
        + pipeline.steps.map((s, i) => `
      <li class="erp-pipe__step is-${esc(s.state)}"${s.state === 'current' ? ' aria-current="step"' : ''}>
        <span class="erp-pipe__dot" aria-hidden="true"><span class="erp-num" dir="ltr">${i + 1}</span></span>
        <span class="erp-pipe__label">${esc(s.label)}</span>
        <span class="erp-pipe__count"><span class="erp-num" dir="ltr">${formatInt(s.count)}</span> فاتورة</span>
      </li>`).join('')
        + `</ol>`
        + `<p class="erp-text-xs erp-text-muted" style="margin-block-start:var(--erp-space-3)">
             إجمالي أوامر اليوم <span class="erp-num" dir="ltr">${formatInt(pipeline.orders)}</span> ·
             ملغاة <span class="erp-num" dir="ltr">${formatInt(pipeline.voided)}</span> ·
             ضريبة <span class="erp-num" dir="ltr">${formatMoney(pipeline.tax)}</span> ·
             خصومات <span class="erp-num" dir="ltr">${formatMoney(pipeline.discounts)}</span>
           </p>`;
}

/**
 * الحافة السفلية للورق الحراري: أسنان SVG بنمذجة userSpaceOnUse — السنّ 16px
 * و9px عمقًا مهما كان عرض البطاقة، لأن الباترن يتكرار ولا يتمدد. المعرّف
 * متصاعد لكل رسم حتى لا يتصادم نسبان في نفس الصفحة.
 */
let tearSeq = 0;
function tearEdge(tooth = 16, depth = 9) {
    const id = `erp-teeth-${(tearSeq += 1)}`;
    return `<svg class="erp-sand__tear" width="100%" height="${depth}" aria-hidden="true">
        <defs><pattern id="${id}" width="${tooth}" height="${depth}" patternUnits="userSpaceOnUse">
          <path d="M0 0 L${tooth / 2} ${depth} L${tooth} 0"></path>
        </pattern></defs>
        <rect width="100%" height="${depth}" fill="url(#${id})"></rect>
      </svg>`;
}

/**
 * «السَنَد» — portlet «أحدث الفواتير» مُرندَق كورق فاتورة حرارية بدل أن يكون
 * بطاقة بيضاء سادسة: رقم غربي monospace، نقاط-قاطعة بين القسم والمبلغ،
 * فواصل متقطعة، وحافة سفلية مسنّنة. الختم للأوراق الملغاة فقط — الإلغاء في
 * المحاسبة يُختم فعلًا، وهو نادر فلا يتحوّل الجهاز إلى زحمة.
 *
 * @param {Array} recent   rows from buildRecent()
 * @param {string} day     meta.day as the server stored it
 * @param {number} i       rise order for the first-paint sequence
 */
function sandPortlet(recent, day, i) {
    const body = recent.length
        ? `<ul class="erp-sand__rows" aria-label="أحدث فواتير اليوم">${recent.map((o) => {
            const s = resolveStatus('pos_order', o.status);
            const stamped = s.known === true && s.raw === 'cancelled';
            return `<li class="erp-sand__row">
          <span class="erp-sand__no" dir="ltr">${esc(o.counter)}</span>
          <span class="erp-sand__dept">${esc(o.dept)}</span>
          <span class="erp-sand__leader" aria-hidden="true"></span>
          <span class="erp-sand__amt"><span class="erp-num" dir="ltr">${esc(formatMoney(o.amount))}</span> <small>ر.س</small></span>
          ${stamped ? `<span class="erp-sand__stamp" role="img" aria-label="الحالة: ${esc(s.label)}">${esc(s.label)}</span>` : ''}
          <span class="erp-sand__sub">${esc([o.cashier, o.time].filter(Boolean).join(' · '))}
            ${stamped ? '' : statusBadge('pos_order', o.status)}</span>
        </li>`;
        }).join('')}</ul>`
        : `<div class="erp-state"><span class="erp-state__title">لا فواتير صادرة اليوم</span>
             <span>يظهر السَنَد فور إغلاق أول فاتورة.</span></div>`;
    return `<section class="erp-sand" style="--erp-rise-i:${i}">
      <div class="erp-sand__head">
        <h3 class="erp-card__title">أحدث الفواتير
          <span class="erp-eyebrow" dir="ltr" lang="en">Latest Orders</span></h3>
        <span class="erp-sand__day" dir="ltr">${esc(day || '—')}</span>
        <button type="button" class="erp-btn erp-btn--sm" data-v2-all-orders>كل الفواتير</button>
      </div>
      ${body}
      ${tearEdge()}
    </section>`;
}

function departmentsBlock(departments) {
    if (!departments.length) {
        return `<div class="erp-state"><span class="erp-state__title">لا إيرادات مسجّلة اليوم</span>
          <span>لم تُغلق أي كاشيرية بعد.</span></div>`;
    }
    return `<ul class="erp-minis" aria-label="أداء الأقسام اليوم مقابل أمس لكل قسم">`
        + departments.map((d) => `
      <li class="erp-mini">
        <span class="erp-mini__id erp-mono">${esc(d.code)}</span>
        <span class="erp-mini__main">${esc(d.name)}<span class="erp-mini__sub">${formatInt(d.invoices)} فاتورة</span></span>
        <span class="erp-mini__amount"><span class="erp-num" dir="ltr">${esc(formatMoney(d.total))}</span> ر.س</span>
        ${d.hasBase ? deltaPill(d.delta) : ''}
      </li>`).join('')
        + `</ul>`;
}

function alertsBlock(alerts) {
    if (!alerts.length) {
        return `<div class="erp-state"><span class="erp-state__icon" aria-hidden="true"><i class="ji" data-i="circle-check"></i></span>
          <span class="erp-state__title">لا معلّقات</span>
          <span>كل شيء محسوم: لا نواقص، لا إجازات بانتظار قرار، والأجهزة متصلة.</span></div>`;
    }
    return `<ul class="erp-minis" aria-label="بنود تحتاج تدخلًا">`
        + alerts.map((a) => `
      <li class="erp-mini">
        ${a.tone ? `<span class="erp-dot erp-dot--${esc(a.tone)}" aria-hidden="true"></span>` : ''}
        <span class="erp-mini__main">${esc(a.text)}<span class="erp-mini__sub">${esc(a.sub || '')}</span></span>
      </li>`).join('')
        + `</ul>`;
}

function card(titleAr, titleEn, note, content, opts = {}) {
    const cls = opts.cls ? ` ${opts.cls}` : '';
    const rise = opts.i === undefined ? '' : ` style="--erp-rise-i:${opts.i}"`;
    return `<section class="erp-card${cls}"${rise}>
      <div class="erp-card__head">
        <h3 class="erp-card__title">${esc(titleAr)}<span class="erp-eyebrow" dir="ltr" lang="en">${esc(titleEn)}</span></h3>
        <span class="erp-text-muted" style="text-align:end">${esc(note)}</span>
      </div>
      <div class="erp-card__body">${content}</div>
    </section>`;
}

function sourceLine(view, failures) {
    const answered = [
        view.sources.briefing === 'ok' ? 'موجز المدير' : null,
        view.sources.stats === 'ok' ? 'إحصاء فواتير اليوم' : null,
    ].filter(Boolean).join(' · ');
    const head = `<p class="erp-text-xs erp-text-muted">مصدر الأرقام: ${esc(answered || 'لا مصدر استجاب')}</p>`;
    if (!failures.length) {return head;}
    // Stated, not swallowed: a missing source is a fact about the dashboard.
    return `${head}<div class="erp-error" role="alert">
        ${failures.map((f) => `<span>${esc(f)}</span>`).join('<br>')}
      </div>`;
}

/**
 * الترتيب مقصود: ستة portlets فقط — ما يُقاس، لا ما يُقترح. «يحتاج قرارًا»
 * يخرج من الشبكة إلى شريط كامل العرض تحتها، لأنه list عمل لا مقياس.
 *
 * @param {object} view
 * @param {string[]} failures
 * @param {{animate?: boolean}} [opts] first paint only: a refresh must not replay the intro
 */
function bodyHTML(view, failures, opts = {}) {
    const flow = [
        card('منحنى المبيعات', 'Last 7 Days', 'من جدول الإيرادات · بالألوف', barsBlock(view.bars), { i: 0 }),
        card('طرق الدفع', 'Payments Today', 'مبالغ واردة فقط', donutBlock(view.payments), { i: 1 }),
        card('الأعلى مبيعًا', 'Best Sellers', 'بقيمة أسطر اليوم', topsBlock(view.tops), { i: 2 }),
        card('حركة الفواتير', 'Invoice Flow', 'حالتها الفعلية الآن', pipeBlock(view.pipeline), { i: 3 }),
        sandPortlet(view.recent, view.meta.day, 4),
        card('أداء الأقسام', 'Departments', 'كل قسم مقابل أمس', departmentsBlock(view.departments), { i: 5 }),
    ].join('');
    return `<div class="${opts.animate ? 'erp-brief erp-brief--in' : 'erp-brief'}">
      ${sourceLine(view, failures)}
      ${kpiStrip(view.kpis)}
      <div class="erp-dash-grid">${flow}</div>
      ${card('يحتاج قرارًا', 'Needs A Decision', `${view.alerts.length} بند`, alertsBlock(view.alerts), { cls: 'erp-brief__decisions', i: 6 })}
    </div>`;
}

/* ── Mount ───────────────────────────────────────────────────────────── */

function template() {
    return `
      <section class="erp-card erp-v2-briefing" data-v2-briefing>
        <div class="erp-brief__lock">
          <h2 class="erp-brief__name">موجز المدير</h2>
          <span class="erp-brief__when" dir="ltr" data-v2-when></span>
          <span class="erp-grow"></span>
          <button type="button" class="erp-btn erp-btn--sm" data-v2-reload>
            <i class="ji" data-i="refresh" aria-hidden="true"></i><span>تحديث</span>
          </button>
        </div>
        <div class="erp-card__body">
          <div data-v2-brief-body>
            <div class="erp-state" role="status" aria-live="polite">
              <span class="erp-state__title">جارٍ قراءة الأرقام الحية…</span>
              <span>يُستهلك موجز المدير + إحصاء فواتير اليوم في نفس اللحظة.</span>
            </div>
          </div>
        </div>
      </section>`;
}

/**
 * «كل الفواتير» — لوحة بتفاصيل كل سند (رقم · وقت · صافي · ضريبة · خصم ·
 * دفعات · كاشير) من مرآة YaraSoft،的范围 يختاره المالك.
 */
async function openAllOrders(day) {
    const layer = document.createElement('div');
    layer.className = 'erp-allorders';
    layer.setAttribute('role', 'dialog');
    layer.setAttribute('aria-modal', 'true');
    layer.setAttribute('aria-label', 'كل الفواتير');
    layer.innerHTML = `
      <div class="erp-allorders__panel">
        <header class="erp-allorders__head">
          <strong>كل الفواتير</strong>
          <input class="erp-allorders__date" type="date" value="${esc(day || '')}" aria-label="التاريخ">
          <button type="button" class="erp-icon-btn" data-v2-close-orders aria-label="إغلاق">&times;</button>
        </header>
        <div class="erp-allorders__body" data-v2-orders-body><p class="erp-state">جارٍ جلب السندات…</p></div>
      </div>`;
    document.body.appendChild(layer);
    const bodyEl = layer.querySelector('[data-v2-orders-body]');
    const dateEl = layer.querySelector('.erp-allorders__date');
    const close = () => layer.remove();
    layer.querySelector('[data-v2-close-orders]').addEventListener('click', close);
    layer.addEventListener('mousedown', (e) => { if (e.target === layer) {close();}});

    const load = async () => {
        const d = dateEl.value || day || '';
        bodyEl.innerHTML = '<p class="erp-state">جارٍ جلب السندات…</p>';
        try {
            const r = await fetchAllOrders({ from: d, to: d, limit: 500 });
            const rows = Array.isArray(r && r.rows) ? r.rows : [];
            const t = (r && r.totals) || {};
            if (!rows.length) {
                bodyEl.innerHTML = '<p class="erp-state">لا فواتير في هذا اليوم.</p>';
                return;
            }
            bodyEl.innerHTML = `
              <p class="erp-allorders__totals">${rows.length} فاتورة · الإجمالي ${Math.round(Number(t.total || 0) * 100) / 100} ر.س · ضريبة ${Math.round(Number(t.vat || 0) * 100) / 100} · نقد ${Math.round(Number(t.cash || 0) * 100) / 100} · شبكة ${Math.round(Number(t.network || 0) * 100) / 100}</p>
              <table class="erp-allorders__table">
                <thead><tr><th>السند</th><th>الوقت</th><th>القسم</th><th>صافي</th><th>ضريبة</th><th>خصم</th><th>المدفوع</th><th>الكاشير</th></tr></thead>
                <tbody>${rows.map((x) => `<tr>
                  <td dir="ltr">${esc(x.invoice_counter)}</td>
                  <td dir="ltr">${esc(String(x.doc_time || '').slice(0, 5))}</td>
                  <td>${esc(x.department_name || x.dept_id || '—')}</td>
                  <td dir="ltr">${Math.round(Number(x.net_amount || 0) * 100) / 100}</td>
                  <td dir="ltr">${Math.round(Number(x.vat_amount || 0) * 100) / 100}</td>
                  <td dir="ltr">${Math.round(Number(x.discount_amount || 0) * 100) / 100}</td>
                  <td dir="ltr">${Math.round(Number(x.paid_amount || 0) * 100) / 100}</td>
                  <td dir="ltr">${esc(x.cashier_no || '—')}</td>
                </tr>`).join('')}</tbody>
              </table>`;
        } catch (e) {
            bodyEl.innerHTML = `<p class="erp-state">تعذّر جلب الفواتير: ${esc((e && e.message) || 'خطأ')}</p>`;
        }
    };
    dateEl.addEventListener('change', load);
    load();
}

/**
 * @param {HTMLElement} host
 * @param {{ notify?: (msg: string) => void }} [ctx]
 * @returns {{el: HTMLElement, reload: () => void, getView: () => object|null, destroy: () => void}}
 */
export function mountBriefingScreen(host, ctx = {}) {
    host.insertAdjacentHTML('beforeend', template());
    const el = host.lastElementChild;

    const body = el.querySelector('[data-v2-brief-body]');
    const when = el.querySelector('[data-v2-when]');

    // تفويضٌ واحد: زرّ «كل الفواتير» (البورتليت يُعاد رسمه مع كل تحديث)
    el.addEventListener('click', (ev) => {
        const btn = ev.target.closest('[data-v2-all-orders]');
        if (!btn) {return;}
        openAllOrders(view && view.meta ? view.meta.day : '');
    });

    let loading = false;
    let view = null;
    let introPending = true;

    function stateBlock(title, note, role) {
        return `<div class="erp-state"${role ? ` role="${role}"` : ''}>
          <span class="erp-state__title">${esc(title)}</span>
          ${note ? `<span>${esc(note)}</span>` : ''}
        </div>`;
    }

    async function reload() {
        if (loading) {return;}
        loading = true;
        el.querySelector('[data-v2-reload]').disabled = true;
        body.innerHTML = stateBlock('جارٍ قراءة الأرقام الحية…', 'موجز المدير + إحصاء فواتير اليوم.', 'status');

        // allSettled: one source answering is still a dashboard — and the
        // screen says which one answered. Currency rides along, never sinking
        // the numbers when the settings read fails.
        const settled = await Promise.allSettled([fetchBriefing(), fetchTodayStats(), fetchCurrency().catch(() => '')]);
        const briefing = settled[0].status === 'fulfilled' ? settled[0].value : null;
        const stats = settled[1].status === 'fulfilled' ? settled[1].value : null;
        const currency = settled[2].status === 'fulfilled' ? String(settled[2].value ?? '') : '';

        loading = false;
        if (el.isConnected) {el.querySelector('[data-v2-reload]').disabled = false;}

        if (!briefing && !stats) {
            const reason = settled.map((r) => (r.status === 'rejected' ? r.reason : null))
                .find((e) => e && e.message)?.message || 'تعذّر الوصول إلى البيانات';
            body.innerHTML = `${stateBlock('تعذّر جلب الأرقام', reason, 'alert')}
              <p class="erp-text-sm" style="text-align:center">
                <button type="button" class="erp-btn erp-btn--sm" data-v2-retry>إعادة المحاولة</button>
              </p>`;
            body.querySelector('[data-v2-retry]')?.addEventListener('click', reload);
            return;
        }

        const failures = settled
            .map((r, i) => (r.status === 'rejected'
                ? `${i === 0 ? 'موجز المدير' : 'إحصاء فواتير اليوم'}: ${r.reason?.message || 'لم يستجب'}`
                : (r.value === null ? `${i === 0 ? 'موجز المدير' : 'إحصاء فواتير اليوم'}: استجابة فارغة` : null)))
            .filter(Boolean);

        view = buildBriefingView({ briefing, stats, currency });
        if (!el.isConnected) {return;}
        // الحركة مرة واحدة عند أول رسم: التحديث اليدوي لا يعيد المقدمة.
        body.innerHTML = bodyHTML(view, failures, { animate: introPending });
        introPending = false;
        when.textContent = view.meta.day ? `— ${view.meta.day}` : '';
        if (ctx.notify) {ctx.notify('');}
    }

    el.addEventListener('click', (e) => {
        if (e.target.closest('[data-v2-reload]')) {reload();}
    });

    reload();

    return {
        el,
        reload,
        getView: () => view,
        destroy() { el.remove(); },
    };
}
