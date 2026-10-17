/**
 * V2 — Dashboard preview ("المكس الساحر" + الطبقة الرسمية) · v1.1.0
 * ═══════════════════════════════════════════════════════════════════════
 *
 * WHAT IS REAL HERE
 *   • The command palette: Ctrl+K searches the REAL nav tree
 *     (buildNavTree — the same permission-aware source the sidebar uses)
 *     and runs REAL actions (navigate to a real screen, set a real theme
 *     preference). Nothing in the palette is faked.
 *   • The period switcher RE-RENDERS every figure from a different fixture
 *     set (day/week/month) — the control genuinely works; only the numbers
 *     are samples, stated on every section head.
 *   • The brand switcher sets ONE data-brand attribute on the .erp-v2 root;
 *     every accent re-resolves through --erp-dash-accent-* (white-label
 *     proof: the same dashboard serves any national company).
 *   • The greeting date is the browser's real current date (ar-SA locale).
 *   • Status badges use persisted values verified in the Gate B showcase.
 *   • Numbers/dates are tabular Latin digits per the Arabic-UX skill.
 *
 * WHAT IS SAMPLE (stated on the page itself and on every section head)
 *   KPI values, charts, invoices, alerts and the pipeline counts are
 *   fixtures for design review. Each period set is internally consistent
 *   (day invoices 12+34+168=214; day payments 6200+9800+2450=18450;
 *   week payments 41200+63900+16200=121300;
 *   month payments 168400+251300+67200=486900). No API is called;
 *   live wiring is Gate D — deliberately not faked here.
 */

import { buildNavTree } from '../layout/nav-model.js?v=4.9.154';
import { setPref } from '../theme.js?v=4.9.154';
import { hydrateStatusNodes } from '../status.js?v=4.9.154';

const esc = (v) => String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/* ── Fixture sets per period (SAMPLE — see header) ────────────────────── */
const PERIODS = {
    day: {
        seg: 'اليوم', compare: 'مقارنة بأمس',
        kpis: [
            { icon: 'banknote',    label: 'مبيعات اليوم',   en: "Today's Sales", value: '18,450', unit: 'ر.س',  delta: { dir: 'up',   text: '12.4%' }, hint: 'مقارنة بأمس' },
            { icon: 'receipt',     label: 'فواتير اليوم',   en: 'Invoices',      value: '214',    unit: '',     delta: { dir: 'up',   text: '8.1%' },  hint: 'حتى هذه اللحظة' },
            { icon: 'wallet',      label: 'متوسط الفاتورة', en: 'Avg Ticket',    value: '86.2',   unit: 'ر.س',  delta: { dir: 'down', text: '3.2%' },  hint: 'للفاتورة الواحدة' },
            { icon: 'users',       label: 'الحضور الآن',    en: 'Attendance',    value: '34',     unit: '/ 40', delta: { dir: 'flat', text: '85%' },   hint: 'ضمن الوردية الحالية' },
            { icon: 'package',     label: 'أصناف حرجة',     en: 'Critical SKUs', value: '7',      unit: '',     delta: { dir: 'flat', text: 'تحتاج طلب شراء' }, hint: 'راجع المخزون' },
            { icon: 'trending-up', label: 'صافي اليوم',     en: 'Net Profit',    value: '6,120',  unit: 'ر.س',  delta: { dir: 'up',   text: '5.6%' },  hint: 'بعد المصروفات' },
        ],
        payments: [
            { label: 'نقدي',  value: 6200, tone: 'success' },
            { label: 'شبكة',  value: 9800, tone: 'info' },
            { label: 'تحويل', value: 2450, tone: 'warning' },
        ],
        tops: [
            { name: 'مشكل مشاوي',       count: 1240 },
            { name: 'مندي لحم',         count: 980 },
            { name: 'كنافة نابلسية',    count: 870 },
            { name: 'سلطة فتوش',        count: 640 },
            { name: 'عصير برتقال طازج', count: 590 },
        ],
    },
    week: {
        seg: 'الأسبوع', compare: 'مقارنة بالأسبوع الماضي',
        kpis: [
            { icon: 'banknote',    label: 'مبيعات الأسبوع', en: 'Weekly Sales',  value: '121,300', unit: 'ر.س', delta: { dir: 'up',   text: '9.2%' },  hint: 'مقارنة بالأسبوع الماضي' },
            { icon: 'receipt',     label: 'فواتير الأسبوع', en: 'Invoices',      value: '1,482',   unit: '',    delta: { dir: 'up',   text: '6.4%' },  hint: 'حتى هذه اللحظة' },
            { icon: 'wallet',      label: 'متوسط الفاتورة', en: 'Avg Ticket',    value: '81.8',    unit: 'ر.س', delta: { dir: 'down', text: '1.1%' },  hint: 'للفاتورة الواحدة' },
            { icon: 'users',       label: 'معدل الحضور',    en: 'Attendance',    value: '93',      unit: '%',   delta: { dir: 'flat', text: 'مستقر' }, hint: 'متوسط الأسبوع' },
            { icon: 'package',     label: 'أصناف حرجة',     en: 'Critical SKUs', value: '12',      unit: '',    delta: { dir: 'flat', text: 'تحتاج طلب شراء' }, hint: 'راجع المخزون' },
            { icon: 'trending-up', label: 'صافي الأسبوع',   en: 'Net Profit',    value: '38,400',  unit: 'ر.س', delta: { dir: 'up',   text: '6.8%' },  hint: 'بعد المصروفات' },
        ],
        payments: [
            { label: 'نقدي',  value: 41200, tone: 'success' },
            { label: 'شبكة',  value: 63900, tone: 'info' },
            { label: 'تحويل', value: 16200, tone: 'warning' },
        ],
        tops: [
            { name: 'مشكل مشاوي',       count: 8060 },
            { name: 'مندي لحم',         count: 6370 },
            { name: 'كنافة نابلسية',    count: 5660 },
            { name: 'سلطة فتوش',        count: 4160 },
            { name: 'عصير برتقال طازج', count: 3840 },
        ],
    },
    month: {
        seg: 'الشهر', compare: 'مقارنة بالشهر الماضي',
        kpis: [
            { icon: 'banknote',    label: 'مبيعات الشهر',   en: 'Monthly Sales', value: '486,900', unit: 'ر.س', delta: { dir: 'up',   text: '11.8%' }, hint: 'مقارنة بالشهر الماضي' },
            { icon: 'receipt',     label: 'فواتير الشهر',   en: 'Invoices',      value: '5,940',   unit: '',    delta: { dir: 'up',   text: '7.9%' },  hint: 'حتى هذه اللحظة' },
            { icon: 'wallet',      label: 'متوسط الفاتورة', en: 'Avg Ticket',    value: '82.0',    unit: 'ر.س', delta: { dir: 'up',   text: '0.6%' },  hint: 'للفاتورة الواحدة' },
            { icon: 'users',       label: 'معدل الحضور',    en: 'Attendance',    value: '95',      unit: '%',   delta: { dir: 'flat', text: 'ممتاز' }, hint: 'متوسط الشهر' },
            { icon: 'package',     label: 'أصناف حرجة',     en: 'Critical SKUs', value: '9',       unit: '',    delta: { dir: 'flat', text: 'تحتاج طلب شراء' }, hint: 'راجع المخزون' },
            { icon: 'trending-up', label: 'صافي الشهر',     en: 'Net Profit',    value: '152,700', unit: 'ر.س', delta: { dir: 'up',   text: '8.3%' },  hint: 'بعد المصروفات' },
        ],
        payments: [
            { label: 'نقدي',  value: 168400, tone: 'success' },
            { label: 'شبكة',  value: 251300, tone: 'info' },
            { label: 'تحويل', value: 67200,  tone: 'warning' },
        ],
        tops: [
            { name: 'مشكل مشاوي',       count: 32150 },
            { name: 'مندي لحم',         count: 25480 },
            { name: 'كنافة نابلسية',    count: 22630 },
            { name: 'سلطة فتوش',        count: 16640 },
            { name: 'عصير برتقال طازج', count: 15340 },
        ],
    },
};
const PERIOD_KEYS = ['day', 'week', 'month'];

const SALES_7 = [
    { day: 'السبت',    value: 12.4 }, { day: 'الأحد',   value: 15.1 },
    { day: 'الاثنين',  value: 13.8 }, { day: 'الثلاثاء', value: 16.2 },
    { day: 'الأربعاء', value: 19.7 }, { day: 'الخميس',  value: 24.3 },
    { day: 'الجمعة',   value: 18.4 },
];

const TONE_HEX = { success: '#0b9e6c', info: '#2563eb', warning: '#d97706', danger: '#e5484d', neutral: '#667085' };

const INVOICES = [
    { id: '#90412', main: 'طاولة 7',             sub: 'صالة العائلات · 13:42', amount: '245', badge: ['pos_order', 'issued'] },
    { id: '#90411', main: 'طلب سفري',            sub: 'كاشير 2 · 13:31',       amount: '120', badge: ['pos_order', 'issued'] },
    { id: '#90410', main: 'طاولة 3',             sub: 'الصالة الرئيسية · 13:18', amount: '310', badge: ['payment', 'partial'] },
    { id: '#90409', main: 'توصيل — حي الياسمين', sub: 'مندوب 4 · 12:55',       amount: '185', badge: ['dispatch', 'pending'] },
];

const PIPELINE = [
    { label: 'مسودة',  count: 12,  state: 'done' },
    { label: 'مؤكدة',  count: 34,  state: 'done' },
    { label: 'مدفوعة', count: 168, state: 'current' },
];

const ALERTS = [
    { tone: 'danger',  text: 'صنف حرج: دجاج طازج (المتبقي 4 كجم)', time: 'منذ 25 دقيقة', badge: null },
    { tone: null,      text: 'طلب الشراء PR-231 بانتظار الاعتماد — المخزن', time: 'منذ ساعة', badge: ['purchase_request', 'pending'] },
    { tone: 'warning', text: 'تأخر عن الوردية: خالد سعيد (+25 دقيقة)', time: 'الحضور', badge: null },
];

const BRANDS = [
    { id: 'gold',      label: 'ذهبي ملكي',  en: 'Royal Gold' },
    { id: 'corporate', label: 'كحلي مؤسسي', en: 'Corporate Navy' },
];

/* ── Builders ─────────────────────────────────────────────────────────── */
function deltaPill(d) {
    const icon = d.dir === 'up' ? 'arrow-up' : d.dir === 'down' ? 'arrow-down' : null;
    return `<span class="erp-delta erp-delta--${d.dir}">${icon ? `<i class="ji" data-i="${icon}" aria-hidden="true"></i>` : ''}<span class="erp-num" dir="ltr">${esc(d.text)}</span></span>`;
}

function kpiStrip(kpis) {
    return `<ul class="erp-kpis" aria-label="مؤشرات الفترة (بيانات نموذجية)">`
        + kpis.map((k) => `
      <li class="erp-kpi">
        <div class="erp-kpi__top">
          <span class="erp-kpi__icon" aria-hidden="true"><i class="ji" data-i="${k.icon}"></i></span>
          <span class="erp-kpi__label">${esc(k.label)}<span class="erp-eyebrow" dir="ltr" lang="en">${esc(k.en)}</span></span>
        </div>
        <div class="erp-kpi__value"><span class="erp-num" dir="ltr">${esc(k.value)}</span>${k.unit ? ` <span class="erp-kpi__unit">${esc(k.unit)}</span>` : ''}</div>
        <div class="erp-kpi__foot">${deltaPill(k.delta)}<span class="erp-kpi__hint">${esc(k.hint)}</span></div>
      </li>`).join('')
        + `</ul>`;
}

function salesBars() {
    const max = Math.max(...SALES_7.map((d) => d.value));
    const top = 110;
    return `<div class="erp-bars" role="img" aria-label="مبيعات آخر 7 أيام بالألف (بيانات نموذجية)">`
        + SALES_7.map((d) => {
            const isMax = d.value === max;
            const h = Math.max(8, Math.round((d.value / max) * top));
            return `<div class="erp-bar${isMax ? ' erp-bar--max' : ''}">
          <span class="erp-bar__val"><span class="erp-num" dir="ltr">${d.value.toFixed(1)}</span></span>
          <span class="erp-bar__track" style="block-size:${h}px" title="${esc(d.day)}: ${d.value.toFixed(1)} ألف"></span>
          <span class="erp-bar__day">${esc(d.day)}</span>
        </div>`;
        }).join('')
        + `</div>`;
}

function payDonut(payments) {
    const total = payments.reduce((a, p) => a + p.value, 0);
    const r = 54, c = 2 * Math.PI * r;
    let start = 0;
    const segs = payments.map((p) => {
        const len = (p.value / total) * c;
        const s = `<circle cx="66" cy="66" r="${r}" fill="none" stroke-width="16"
            style="stroke:${TONE_HEX[p.tone]}" stroke-dasharray="${len.toFixed(1)} ${c.toFixed(1)}"
            stroke-dashoffset="${(-start).toFixed(1)}" transform="rotate(-90 66 66)">
          <title>${esc(p.label)}: ${p.value.toLocaleString('en-US')}</title></circle>`;
        start += len;
        return s;
    }).join('');
    const legend = payments.map((p) => {
        const pct = ((p.value / total) * 100).toFixed(1);
        return `<li><span class="erp-legend__dot" style="background:${TONE_HEX[p.tone]}" aria-hidden="true"></span>`
            + `<span>${esc(p.label)}</span>`
            + `<span class="erp-legend__val"><span class="erp-num" dir="ltr">${pct}%</span></span></li>`;
    }).join('');
    return `<div class="erp-donut-wrap">
      <div class="erp-donut" role="img" aria-label="توزيع طرق الدفع (بيانات نموذجية)">
        <svg viewBox="0 0 132 132" aria-hidden="true">
          <circle cx="66" cy="66" r="${r}" fill="none" stroke-width="16" style="stroke:var(--erp-surface-sunken)" />${segs}
        </svg>
        <div class="erp-donut__center"><span class="erp-donut__total"><span class="erp-num" dir="ltr">${total.toLocaleString('en-US')}</span></span><span class="erp-donut__cap">إجمالي (ر.س)</span></div>
      </div>
      <ul class="erp-legend">${legend}</ul>
    </div>`;
}

function topItems(tops) {
    const max = Math.max(...tops.map((t) => t.count));
    return `<ul class="erp-tops" aria-label="الأعلى مبيعًا (بيانات نموذجية)">`
        + tops.map((t) => `
      <li class="erp-top__row">
        <span class="erp-top__name">${esc(t.name)}</span>
        <span class="erp-top__track"><span class="erp-top__fill" style="inline-size:${Math.round((t.count / max) * 100)}%"></span></span>
        <span class="erp-top__val"><span class="erp-num" dir="ltr">${t.count.toLocaleString('en-US')}</span></span>
      </li>`).join('')
        + `</ul>`;
}

function invoiceList(statusBadge) {
    return `<ul class="erp-minis" aria-label="أحدث الفواتير (بيانات نموذجية)">`
        + INVOICES.map((inv) => `
      <li class="erp-mini">
        <span class="erp-mini__id"><span class="erp-num" dir="ltr">${esc(inv.id)}</span></span>
        <span class="erp-mini__main">${esc(inv.main)}<span class="erp-mini__sub">${esc(inv.sub)}</span></span>
        <span class="erp-mini__amount"><span class="erp-num" dir="ltr">${esc(inv.amount)}</span> ر.س</span>
        ${statusBadge(inv.badge[0], inv.badge[1])}
      </li>`).join('')
        + `</ul>`;
}

function pipeline() {
    return `<ol class="erp-pipe" aria-label="خط سير فواتير اليوم (بيانات نموذجية)">`
        + PIPELINE.map((s, i) => `
      <li class="erp-pipe__step is-${s.state}"${s.state === 'current' ? ' aria-current="step"' : ''}>
        <span class="erp-pipe__dot" aria-hidden="true"><span class="erp-num" dir="ltr">${i + 1}</span></span>
        <span class="erp-pipe__label">${esc(s.label)}</span>
        <span class="erp-pipe__count"><span class="erp-num" dir="ltr">${s.count}</span> فاتورة</span>
      </li>`).join('')
        + `</ol>`;
}

function alertList(statusBadge) {
    return `<ul class="erp-minis" aria-label="تنبيهات تحتاج تدخلًا (بيانات نموذجية)">`
        + ALERTS.map((a) => `
      <li class="erp-mini">
        ${a.tone ? `<span class="erp-dot erp-dot--${a.tone}" aria-hidden="true"></span>` : ''}
        <span class="erp-mini__main">${esc(a.text)}<span class="erp-mini__sub">${esc(a.time)}</span></span>
        ${a.badge ? statusBadge(a.badge[0], a.badge[1]) : ''}
      </li>`).join('')
        + `</ul>`;
}

function card(titleAr, titleEn, sampleNote, bodyHTML) {
    return `<section class="erp-card">
      <div class="erp-card__head">
        <h3 class="erp-card__title">${esc(titleAr)}<span class="erp-eyebrow" dir="ltr" lang="en">${esc(titleEn)}</span></h3>
        <span class="erp-text-muted" style="text-align:end">${esc(sampleNote)}</span>
      </div>
      <div class="erp-card__body">${bodyHTML}</div>
    </section>`;
}

function greeting() {
    const h = new Date().getHours();
    const hi = h < 12 ? 'صباح الخير' : h < 18 ? 'مساء النور' : 'مساء الخير';
    let name = 'ضيف';
    try { name = (window.STATE && window.STATE.currentUser && window.STATE.currentUser.name) || name; } catch { /* no STATE → guest */ }
    let date;
    try {
        date = new Date().toLocaleDateString('ar-SA-u-ca-gregory-nu-latn',
            { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    } catch { date = new Date().toLocaleDateString('ar'); }
    return { hi, name, date };
}

/**
 * Render the dashboard preview into `host` (synchronous — no await, so the
 * icons hydrator still sees a complete document at DOMContentLoaded).
 * Re-renders on period change and re-hydrates its own badges, because the
 * host's one-shot hydrate call has already run by then.
 * @param {HTMLElement} host
 * @param {{ statusBadge: Function }} ctx
 */
export function renderDashboard(host, ctx) {
    const { statusBadge } = ctx;
    let period = 'day';
    let brand = 'gold';

    function segGroup(kind, options, current, _onPick) {
        return `<div class="erp-seg" role="group" aria-label="${kind === 'period' ? 'الفترة' : 'الهوية'}">`
            + `<span class="erp-seg__label">${kind === 'period' ? 'الفترة' : 'الهوية'}</span>`
            + options.map((o) => {
                const id = kind === 'period' ? o : o.id;
                const label = kind === 'period' ? PERIODS[o].seg : o.label;
                const on = id === current;
                return `<button type="button" data-seg-kind="${kind}" data-seg-id="${id}"${on ? ' class="is-active" aria-pressed="true"' : ' aria-pressed="false"'}>${esc(label)}</button>`;
            }).join('')
            + `</div>`;
    }

    function paint() {
        const P = PERIODS[period];
        const g = greeting();
        host.innerHTML = `
      <div class="erp-dash-head">
        <div>
          <h2 class="erp-dash-title">${esc(g.hi)}، ${esc(g.name)}</h2>
          <div class="erp-dash-sub">نظرة على العمليات — ${esc(g.date)}</div>
        </div>
        <div class="erp-dash-controls">
          ${segGroup('period', PERIOD_KEYS, period)}
          ${segGroup('brand', BRANDS, brand)}
        </div>
      </div>
      ${card('نبض ' + P.seg, 'Pulse', 'بيانات نموذجية للمعاينة · ' + P.compare, kpiStrip(P.kpis))}
      <div class="erp-dash-grid">
        ${card('مبيعات آخر 7 أيام (ألف ر.س)', 'Weekly Trend', 'بيانات نموذجية', salesBars())}
        ${card('طرق الدفع', 'Payment Mix', 'بيانات نموذجية · ' + P.compare, payDonut(P.payments))}
      </div>
      <div class="erp-dash-grid">
        ${card('الأعلى مبيعًا', 'Top Sellers', 'بيانات نموذجية · ' + P.compare, topItems(P.tops))}
        ${card('أحدث الفواتير', 'Latest Invoices', 'بيانات نموذجية', invoiceList(statusBadge))}
      </div>
      ${card('خط سير فواتير اليوم', 'Invoice Pipeline', 'بيانات نموذجية', pipeline())}
      ${card('تنبيهات تحتاج تدخلًا', 'Action Alerts', 'بيانات نموذجية', alertList(statusBadge))}`;
        host.querySelectorAll('[data-seg-kind]').forEach((b) => {
            b.addEventListener('click', () => {
                const kind = b.dataset.segKind, id = b.dataset.segId;
                if (kind === 'period' && PERIODS[id]) {period = id; paint();}
                else if (kind === 'brand') {setBrand(id); paint();}
            });
        });
        try { hydrateStatusNodes(host); } catch { /* badges stay raw text — never fatal */ }
    }

    function setBrand(id) {
        const root = (host.isConnected ? host : document).closest?.('.erp-v2')
            || document.querySelector('.erp-v2');
        brand = id === 'corporate' ? 'corporate' : 'gold';
        if (!root) {return;}
        if (brand === 'corporate') {root.setAttribute('data-brand', 'corporate');}
        else {root.removeAttribute('data-brand');}
    }

    paint();
}

/* ── Command palette (REAL — searches the live nav tree) ──────────────── */
const THEME_ACTIONS = [
    { id: 'theme-light',  label: 'مظهر فاتح',  icon: 'sun',     run: () => setPref('light') },
    { id: 'theme-dark',   label: 'مظهر داكن',  icon: 'moon',    run: () => setPref('dark') },
    { id: 'theme-system', label: 'مظهر النظام', icon: 'monitor', run: () => setPref('system') },
];

function collectEntries() {
    const entries = [];
    let tree = [];
    try { tree = buildNavTree() || []; } catch { /* standalone without config → actions only */ }
    for (const group of tree) {
        for (const item of group.items || []) {
            if (!item || !item.key) {continue;}
            entries.push({ kind: 'nav', key: item.key, label: item.label || item.key, group: group.title || '', icon: item.icon || 'circle' });
        }
    }
    for (const a of THEME_ACTIONS) {entries.push({ kind: 'action', ...a, group: 'إجراءات' });}
    return entries;
}

const norm = (s) => String(s || '').replace(/[\u064B-\u0652\u0640]/g, '').trim();

/**
 * Mount the palette trigger into the shell's `search` boundary slot and wire
 * Ctrl+K. The overlay is appended to the shell root (not <body>) so it
 * inherits .erp-v2 tokens and the white-label data-brand, while surviving
 * screen swaps (it is a sibling of <main>, never inside it).
 * @param {{ root: HTMLElement, mountBoundary: Function, navigate: Function }} shell
 * @returns {{ destroy: () => void }}
 */
export function mountCommandPalette(shell) {
    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'erp-search-trigger';
    trigger.setAttribute('aria-label', 'بحث سريع في الشاشات (Ctrl+K)');
    trigger.innerHTML = `<i class="ji" data-i="search" aria-hidden="true"></i>
      <span class="erp-search-trigger__text">بحث سريع…</span>
      <kbd class="erp-pal__kbd" aria-hidden="true">Ctrl+K</kbd>`;
    if (!shell.mountBoundary('search', trigger)) {return { destroy() {} };}

    const layer = (shell && shell.root) || document.body;
    let backdrop = null;
    let input = null;
    let list = null;
    let entries = [];
    let filtered = [];
    let active = 0;
    let lastFocus = null;

    function close() {
        if (!backdrop) {return;}
        backdrop.remove();
        backdrop = null; input = null; list = null;
        document.removeEventListener('keydown', onDocKey, true);
        if (lastFocus && typeof lastFocus.focus === 'function') {lastFocus.focus();}
        lastFocus = null;
    }

    function run(entry) {
        close();
        if (!entry) {return;}
        if (entry.kind === 'nav') {shell.navigate(entry.key);}
        else if (typeof entry.run === 'function') {entry.run();}
    }

    function paint() {
        if (!list) {return;}
        if (!filtered.length) {
            list.innerHTML = `<li class="erp-pal__empty" role="presentation">لا نتائج مطابقة — جرّب كلمة أخرى</li>`;
            return;
        }
        list.innerHTML = filtered.slice(0, 12).map((e, i) => `
          <li role="option" id="erp-pal-opt-${i}" aria-selected="${i === active ? 'true' : 'false'}">
            <button type="button" class="erp-pal__opt${i === active ? ' is-active' : ''}" data-idx="${i}" tabindex="-1">
              <i class="ji" data-i="${esc(e.icon)}" aria-hidden="true"></i>
              <span class="erp-pal__label">${esc(e.label)}</span>
              <span class="erp-pal__group">${esc(e.group)}</span>
            </button>
          </li>`).join('');
        input?.setAttribute('aria-activedescendant', `erp-pal-opt-${active}`);
        list.querySelectorAll('[data-idx]').forEach((b) => {
            b.addEventListener('click', () => run(filtered[Number(b.dataset.idx)]));
            b.addEventListener('mousemove', () => {
                const i = Number(b.dataset.idx);
                if (i !== active) {active = i; paint();}
            });
        });
    }

    function applyFilter() {
        const q = norm(input ? input.value : '');
        filtered = !q ? entries.slice(0, 12)
            : entries.filter((e) => norm(e.label).includes(q) || norm(e.group).includes(q)).slice(0, 12);
        active = 0;
        paint();
    }

    function onDocKey(e) {
        if (e.key === 'Escape') {e.preventDefault(); close(); return;}
        if (!input) {return;}
        if (e.key === 'ArrowDown') {e.preventDefault(); active = Math.min(active + 1, filtered.length - 1); paint();}
        else if (e.key === 'ArrowUp') {e.preventDefault(); active = Math.max(active - 1, 0); paint();}
        else if (e.key === 'Enter') {e.preventDefault(); run(filtered[active]);}
    }

    function open() {
        if (backdrop) {close(); return;}
        lastFocus = document.activeElement;
        entries = collectEntries();
        backdrop = document.createElement('div');
        backdrop.className = 'erp-pal-backdrop';
        backdrop.innerHTML = `
          <div class="erp-pal" role="dialog" aria-modal="true" aria-label="بحث سريع في الشاشات">
            <div class="erp-pal__input-row">
              <i class="ji" data-i="search" aria-hidden="true"></i>
              <input class="erp-pal__input" type="text" role="combobox" aria-expanded="true"
                     aria-controls="erp-pal-list" autocomplete="off"
                     placeholder="ابحث عن شاشة أو إجراء… (مثال: مخزن، رواتب، مظهر داكن)">
              <kbd class="erp-pal__kbd" aria-hidden="true">Esc</kbd>
            </div>
            <ul class="erp-pal__list" id="erp-pal-list" role="listbox" aria-label="النتائج"></ul>
          </div>`;
        backdrop.addEventListener('mousedown', (e) => { if (e.target === backdrop) {close();} });
        backdrop.querySelector('.erp-pal').addEventListener('mousedown', (e) => e.stopPropagation());
        layer.appendChild(backdrop);
        input = backdrop.querySelector('.erp-pal__input');
        list = backdrop.querySelector('.erp-pal__list');
        input.addEventListener('input', applyFilter);
        document.addEventListener('keydown', onDocKey, true);
        applyFilter();
        input.focus();
    }

    function onGlobalKey(e) {
        const mod = e.ctrlKey || e.metaKey;
        if (mod && (e.key === 'k' || e.key === 'K' || e.key === 'ك')) {e.preventDefault(); open();}
    }

    trigger.addEventListener('click', open);
    document.addEventListener('keydown', onGlobalKey);

    return {
        destroy() {
            close();
            document.removeEventListener('keydown', onGlobalKey);
            trigger.remove();
        },
    };
}
