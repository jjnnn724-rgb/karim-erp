/**
 * V2 — Manager briefing screen (الشاشة التنفيذية ببيانات حية)
 * ═══════════════════════════════════════════════════════════════════════
 *
 * WHAT THIS IS
 *   The V2 executive dashboard reading two production endpoints through
 *   v2/data/briefing-repo.js. Same visual language as the sample dashboard
 *   (erp-kpis / erp-delta / erp-bars / erp-donut / erp-tops / erp-pipe /
 *   erp-minis from css/v2/erp-dashboard.css), different source: every number
 *   on this screen is a row the legacy app already asks the database for.
 *
 * WHY IT LOOKS LIKE THE PREVIEW
 *   Reusing the existing classes is the point. If the real-data screen and
 *   the sample screen disagree about spacing or colour, the stylesheet is
 *   being changed to fit the demo — and the demo then ships.
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

import { statusBadge, resolveStatus } from '../status.js?v=4.9.185';
import {
    fetchBriefing,
    fetchTodayStats,
    buildBriefingView,
    formatMoney,
    formatInt,
} from '../data/briefing-repo.js?v=4.9.185';
import { fetchCurrency } from '../data/reports-repo.js?v=4.9.185';

const esc = (v) => String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** Tokens, not hexes: the donut must survive a theme switch. */
const TONE_VAR = {
    success: 'var(--erp-success)',
    info: 'var(--erp-info)',
    warning: 'var(--erp-warning)',
    danger: 'var(--erp-danger)',
    neutral: 'var(--erp-neutral)',
};
const TONE_ORDER = ['success', 'info', 'warning', 'danger', 'neutral'];

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

function barsBlock(bars) {
    if (!bars.length) {
        return `<div class="erp-state"><span class="erp-state__title">لا مبيعات في آخر ٧ أيام</span></div>`;
    }
    const max = Math.max(...bars.map((b) => b.value), 1);
    const top = 110;
    const aria = `مبيعات آخر ${bars.length} أيام، أعلاها ${formatMoney(max)}`;
    return `<div class="erp-bars" role="img" aria-label="${esc(aria)}">`
        + bars.map((b) => {
            const isMax = b.value === max;
            const h = Math.max(8, Math.round((b.value / max) * top));
            return `<div class="erp-bar${isMax ? ' erp-bar--max' : ''}">
          <span class="erp-bar__val"><span class="erp-num" dir="ltr">${(b.value / 1000).toFixed(1)}</span></span>
          <span class="erp-bar__track" style="block-size:${h}px"
                title="${esc(`${b.date}: ${formatMoney(b.value)} — ${formatInt(b.invoices)} فاتورة`)}"></span>
          <span class="erp-bar__day">${esc(b.label)}</span>
        </div>`;
        }).join('')
        + `</div>`;
}

function donutBlock(payments) {
    const total = payments.reduce((a, p) => a + p.value, 0);
    if (!(total > 0)) {
        return `<div class="erp-state"><span class="erp-state__title">لا مدفوعات مسجّلة اليوم</span>
          <span>يظهر التوزيع فور إغلاق أول فاتورة.</span></div>`;
    }
    const r = 54;
    const c = 2 * Math.PI * r;
    let start = 0;
    const segs = payments.map((p, i) => {
        const len = (p.value / total) * c;
        const tone = TONE_ORDER[i % TONE_ORDER.length];
        const seg = `<circle cx="66" cy="66" r="${r}" fill="none" stroke-width="16"
            style="stroke:${TONE_VAR[tone]}" stroke-dasharray="${len.toFixed(1)} ${c.toFixed(1)}"
            stroke-dashoffset="${(-start).toFixed(1)}" transform="rotate(-90 66 66)">
          <title>${esc(p.label)}: ${esc(formatMoney(p.value))}</title></circle>`;
        start += len;
        return seg;
    }).join('');
    const legend = payments.map((p, i) => {
        const tone = TONE_ORDER[i % TONE_ORDER.length];
        const pct = ((p.value / total) * 100).toFixed(1);
        return `<li><span class="erp-legend__dot" style="background:${TONE_VAR[tone]}" aria-hidden="true"></span>`
            + `<span>${esc(p.label)}</span>`
            + `<span class="erp-legend__val"><span class="erp-num" dir="ltr">${esc(pct)}%</span></span></li>`;
    }).join('');
    return `<div class="erp-donut-wrap">
      <div class="erp-donut" role="img" aria-label="توزيع طرق الدفع اليوم بإجمالي ${esc(formatMoney(total))}">
        <svg viewBox="0 0 132 132" aria-hidden="true">
          <circle cx="66" cy="66" r="${r}" fill="none" stroke-width="16" style="stroke:var(--erp-surface-sunken)" />${segs}
        </svg>
        <div class="erp-donut__center"><span class="erp-donut__total"><span class="erp-num" dir="ltr">${esc(formatMoney(total))}</span></span><span class="erp-donut__cap">إجمالي (ر.س)</span></div>
      </div>
      <ul class="erp-legend">${legend}</ul>
    </div>`;
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
        card('منحنى المبيعات', 'Last 7 Days', 'من جدول الإيرادات', barsBlock(view.bars), { i: 0 }),
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
 * @param {HTMLElement} host
 * @param {{ notify?: (msg: string) => void }} [ctx]
 * @returns {{el: HTMLElement, reload: () => void, getView: () => object|null, destroy: () => void}}
 */
export function mountBriefingScreen(host, ctx = {}) {
    host.insertAdjacentHTML('beforeend', template());
    const el = host.lastElementChild;

    const body = el.querySelector('[data-v2-brief-body]');
    const when = el.querySelector('[data-v2-when]');

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
