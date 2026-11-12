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
 *   • Identity is UNIFIED since 2026-10-25 («أونيكس وشامبانيا», one system
 *     palette owned by erp-identity.css): the dashboard-only white-label
 *     brand switcher (data-brand) was removed by user decision — no more
 *     half-applied rebrand.
 *   • The greeting date is the browser's real current date (ar-SA locale).
 *   • Status badges use persisted values verified in the Gate B showcase.
 *   • Numbers/dates are tabular Latin digits per the Arabic-UX skill.
 *
 * WHAT IS LIVE (Gate D — since 2026-11-06)
 *   With a session present the board reads ONE endpoint, GET
 *   /executive/summary (data/executive-repo.js — 30s TTL, one flight), and
 *   repaints with the server's own numbers: KPI strip, revenue/cost trend,
 *   COGS ratio, revenue by department, cash on books, top POS items and the
 *   decision alerts. Every live card names its source under the title.
 *
 * WHAT REMAINS SAMPLE
 *   Without a session (design preview) the fixture sets below still paint,
 *   and every section head says «بيانات نموذجية». If the live read fails the
 *   board keeps the sample AND says so in a banner — it never paints zeros
 *   in place of a record it could not read. Each fixture set stays internally
 *   consistent (day invoices 12+34+168=214; day payments
 *   6200+9800+2450=18450; week 41200+63900+16200=121300; month
 *   168400+251300+67200=486900).
 *
 * Animation is CSS-only (erp-motion.css) and never touches data values —
 * the owner's speed rule: no interval, no polling, no layout thrash.
 */

import { buildNavTree } from '../layout/nav-model.js?v=4.9.297';
import { setPref } from '../theme.js?v=4.9.297';
import { hydrateStatusNodes } from '../status.js?v=4.9.297';
import { barChart, donutChart, lineChart, niceCeiling } from '../charts.js?v=4.9.297';
import { kpiStrip } from '../role-dash-parts.js?v=4.9.297';
import { fetchExecutiveSummary, buildLiveBoard } from '../data/executive-repo.js?v=4.9.297';

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
            { label: 'نقدي',  value: 6200, tone: 'chart-1' },
            { label: 'شبكة',  value: 9800, tone: 'chart-2' },
            { label: 'تحويل', value: 2450, tone: 'chart-3' },
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
            { label: 'نقدي',  value: 41200, tone: 'chart-1' },
            { label: 'شبكة',  value: 63900, tone: 'chart-2' },
            { label: 'تحويل', value: 16200, tone: 'chart-3' },
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
            { label: 'نقدي',  value: 168400, tone: 'chart-1' },
            { label: 'شبكة',  value: 251300, tone: 'chart-2' },
            { label: 'تحويل', value: 67200,  tone: 'chart-3' },
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

/* سقفُ محور مبيعات الأسبوع: خطوةٌ لطيفة (٢٥ لا ٣٠)، فتأخذ الأعمدةُ
   المساحةَ كلَّها بدل أن تترك نصفَ اللوحةِ فراغًا. */
const SALES_MAX = niceCeiling(Math.max(...SALES_7.map((d) => d.value)));

/* ── طبقة الأداء (SAMPLE — نفس أرقام الـlab المثبتة) ───────────────────
   الإقنعة كلها fixture للمعاينة: لا تُحسب من API ولا تُستنتج.
   الإيراد 14 يومًا (ر.س) مع هدف يومي ثابت 15,000؛ الفئات لـ30 يومًا؛
   القنوات لليوم (صالة+سفري+توصيل = 18,450 = مبيعات fixtures اليوم)؛
   تكلفة الطعام 31.2% (مقعدٌ عائلي واقعي تحت الهدف 32%). */
const REVENUE_14 = [
    { label: '23 أكتوبر', v: 12140 }, { label: '24', v: 13480 },
    { label: '25', v: 16920 },       { label: '26', v: 15230 },
    { label: '27', v: 18710 },       { label: '28', v: 21040 },
    { label: '29', v: 13490 },       { label: '30', v: 12870 },
    { label: '31', v: 15600 },       { label: '1 نوفمبر', v: 17320 },
    { label: '2', v: 19880 },        { label: '3', v: 18240 },
    { label: '4', v: 17990 },        { label: '5', v: 18450 },
];
const REVENUE_TARGET = 15000;

const CATEGORIES = [
    { label: 'مشويات',   value: 51200, tone: 'chart-1' },
    { label: 'مشروبات',  value: 33150, tone: 'chart-2' },
    { label: 'أرز ومقدد', value: 27400, tone: 'chart-3' },
    { label: 'مقبلات',   value: 21800, tone: 'chart-4' },
    { label: 'حلويات',   value: 18900, tone: 'chart-5' },
    { label: 'أخرى',     value: 12300, tone: 'chart-6' },
];

const CHANNELS = [
    { name: 'صالة',   count: 7320 },
    { name: 'توصيل',  count: 7150 },
    { name: 'سفري',   count: 3980 },
];

const FOOD_COST = { value: 31.2, goal: 32, excellent: 30, ok: 34 };

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

/* ── Builders ─────────────────────────────────────────────────────────── */
/* kpiStrip/deltaPill مشتركان الآن في role-dash-parts.js — نسخة واحدة للنظام. */

/* ── المستشار الذكي: قواعد نصائح من أرقام اللوحة نفسها ─────────────────
   محركٌ محلي صرف (بلا شبكة ولا مفتاح خارجي): يقرأ مؤشرات الفترة ويحول
   الانحرافات إلى إرشادٍ عملي مرتّب بالأولوية. سريعٌ بلا تكلفة، ولا
   ينكسر: أي مؤشرٍ غائب يُتخطى بصمت، والبطاقة لا تظهر بلا نصائح. */
function pctOf(d) {
    const m = String((d && d.text) || '').match(/([\d.]+)/);
    return m ? Number(m[1]) : 0;
}
function findKpi(kpis, en) {
    return (kpis || []).find((k) => k.en === en) || null;
}
export function advise(kpis) {
    const out = [];
    const sales = findKpi(kpis, "Today's Sales");
    if (sales && sales.delta && sales.delta.dir === 'down' && pctOf(sales.delta) >= 10) {
        out.push({ tone: 'warning', icon: 'trending-down',
            text: `المبيعات تحت الأمس بنسبة ${sales.delta.text} — فعّل عرضًا سريعًا على الأصناف عالية الهامش وراجع ساعات الذروة مع كاشيريات اليوم.` });
    }
    const net = findKpi(kpis, 'Net Profit');
    if (net && net.delta && net.delta.dir === 'down' && pctOf(net.delta) >= 10) {
        out.push({ tone: 'danger', icon: 'wallet',
            text: `الصافي انخفض ${net.delta.text} رغم الإيراد — راجع مصاريف اليوم الاستثنائية وأي صرفٍ غير معتمد في سجل الصرف.` });
    }
    const critical = findKpi(kpis, 'Critical SKUs');
    if (critical && Number(String(critical.value).replace(/[^\d.]/g, '')) > 0) {
        out.push({ tone: 'danger', icon: 'package',
            text: `${critical.value} صنفًا تحت الحد الأدنى — أصدر طلبات الشراء اليوم من شاشة المخزن قبل أن يتوقف قسم.` });
    }
    const att = findKpi(kpis, 'Attendance');
    if (att) {
        const m = String(att.value).match(/(\d+)\s*\/\s*(\d+)/);
        const ratio = m && Number(m[2]) ? Number(m[1]) / Number(m[2]) : 1;
        if (ratio < 0.8) {
            out.push({ tone: 'warning', icon: 'users',
                text: `الحضور ${att.value} فقط (${Math.round(ratio * 100)}% من الوردية) — راجع دوامات القسم الغائب وفعّل الاحتياط من موظفي الأقسام الأخرى.` });
        }
    }
    const ticket = findKpi(kpis, 'Avg Ticket');
    if (ticket && ticket.delta && ticket.delta.dir === 'down' && pctOf(ticket.delta) >= 5) {
        out.push({ tone: 'warning', icon: 'receipt',
            text: `متوسط الفاتورة نزل ${ticket.delta.text} — درّب الكاشيريات على البيع الإضافي (طبق جانبي/مشروب) وضَع الأصناف المربحة أول القائمة.` });
    }
    const invoices = findKpi(kpis, 'Invoices');
    if (invoices && invoices.delta && invoices.delta.dir === 'up' && pctOf(invoices.delta) >= 10
        && sales && sales.delta && sales.delta.dir !== 'down') {
        out.push({ tone: 'success', icon: 'trending-up',
            text: `عدد الفواتير صاعد ${invoices.delta.text} — أداءُ الطاقة جيد؛ حافظ على سرعة التحضير وشاركه مع فريق الصالة.` });
    }
    return out;
}

function advisorCard(kpis) {
    const tips = advise(kpis);
    if (!tips.length) {return '';}
    return card('نصائح ذكية لليوم', 'AI Advisor',
        'مبنية على أرقام هذه اللوحة · محرك محلي لا يتوقف',
        `<ul class="erp-ai-tips" aria-label="نصائح ذكية مبنية على المؤشرات">`
        + tips.map((t) => `
          <li class="erp-ai-tip">
            <span class="erp-badge" data-tone="${t.tone}"><i class="ji" data-i="${t.icon}" aria-hidden="true"></i>
              <span class="erp-badge-label">${t.tone === 'danger' ? 'عاجل' : t.tone === 'warning' ? 'انتبه' : 'فرصة'}</span></span>
            <span class="erp-ai-tip__text">${esc(t.text)}</span>
          </li>`).join('')
        + `</ul>`);
}

/* الرسمان يُرسمان بمحرّك الرسوم نفسه (charts.js): محورٌ بقيمٍ حقيقية،
   تدرّجٌ على الأعمدة، أرقامٌ فوقها، وتلميحٌ ومؤشّرُ لوحةٍ مفاتيح من
   طبقة التفاعل. لا divs ولا SVG مكتوبٌ بيده — فتبقى الألوانُ توكناتٌ
   تعيد حلّها في الوضعين، ويبقى الرسمُ واحدًا في كل الشاشات. */
function salesBars() {
    return barChart({
        ariaLabel: 'مبيعات آخر 7 أيام بالألف ريال (بيانات نموذجية)',
        labels: SALES_7.map((d) => d.day),
        series: [{ label: 'المبيعات', tone: 'brand', values: SALES_7.map((d) => d.value) }],
        max: SALES_MAX,
        formatValue: (v) => `${v.toFixed(1)} ألف ر.س`,
        formatMark: (v) => v.toFixed(1),
        bare: true,
    });
}

function payDonut(payments) {
    const total = payments.reduce((a, p) => a + p.value, 0);
    return donutChart({
        ariaLabel: 'توزيع طرق الدفع (بيانات نموذجية)',
        slices: payments,
        centerLabel: 'إجمالي (ر.س)',
        centerValue: total.toLocaleString('en-US'),
        formatValue: (v) => `${v.toLocaleString('en-US')} ر.س`,
        bare: true,
    });
}

/* ── الإثراء التنفيذي: نفس محرك الرسوم، بلا أي عمل يدوي ────────────────
   الإيراد مساحةٌ متدرجة مع خط هدف — lineChart بتعبيئة `fill`، وسلسلة
   ثانية `chart-2` تحمل نفس قيمة الهدف طوال الأيام (مفتاحٌ صادق في التلميح
   والمفتاح، لا خطٌ منقطٌ مُزوَّر). */
function revenueChart() {
    return lineChart({
        ariaLabel: 'الإيراد — آخر 14 يوم مع الهدف اليومي (بيانات نموذجية)',
        labels: REVENUE_14.map((d) => d.label),
        series: [
            { label: 'الإيراد الفعلي', tone: 'brand', values: REVENUE_14.map((d) => d.v), fill: true },
            { label: 'الهدف اليومي', tone: 'chart-2', values: REVENUE_14.map(() => REVENUE_TARGET) },
        ],
        max: niceCeiling(Math.max(REVENUE_TARGET, ...REVENUE_14.map((d) => d.v))),
        formatValue: (v) => `${v.toLocaleString('en-US')} ر.س`,
        formatMark: (v) => `${(v / 1000).toFixed(1)}k`,
        bare: true,
    });
}

function categoryDonut() {
    const total = CATEGORIES.reduce((a, c) => a + c.value, 0);
    return donutChart({
        ariaLabel: 'المبيعات حسب الفئة — آخر 30 يوم (بيانات نموذجية)',
        slices: CATEGORIES,
        centerLabel: 'إجمالي (ر.س)',
        centerValue: total.toLocaleString('en-US'),
        formatValue: (v) => `${v.toLocaleString('en-US')} ر.س`,
        bare: true,
        maxSlices: 6,
    });
}

function channelBars() {
    const max = Math.max(...CHANNELS.map((c) => c.count));
    return `<ul class="erp-tops" aria-label="المبيعات حسب القناة — اليوم (بيانات نموذجية)">`
        + CHANNELS.map((c) => `
      <li class="erp-top__row">
        <span class="erp-top__name">${esc(c.name)}</span>
        <span class="erp-top__track"><span class="erp-top__fill" style="inline-size:${Math.round((c.count / max) * 100)}%"></span></span>
        <span class="erp-top__val"><span class="erp-num" dir="ltr">${c.count.toLocaleString('en-US')}</span> ر.س</span>
      </li>`).join('')
        + `</ul>`;
}

/* تكلفة الطعام: رقمٌ كبير + شريط تقدم + عتبات صريحة — لا رسم جديد ولا
   وحدة ملوّنة تُقرأ وحدها. يعيد استعمال `erp-chart__donut-total` (وجه
   الرقم البطل) و`erp-top__track/fill` (نفس شريط الأعلى مبيعًا). */
function foodCost() {
    const width = Math.round((FOOD_COST.value / 45) * 100);
    const state = FOOD_COST.value <= FOOD_COST.excellent ? 'ممتاز'
        : FOOD_COST.value <= FOOD_COST.goal ? 'ضمن الهدف'
        : FOOD_COST.value <= FOOD_COST.ok ? 'مقبول' : 'خطر';
    return `<div class="erp-foodc">
      <div class="erp-foodc__stage">
        <span class="erp-chart__donut-total" dir="ltr">${FOOD_COST.value}%</span>
        <span class="erp-foodc__state">${state}</span>
      </div>
      <div class="erp-top__track"><span class="erp-top__fill" style="inline-size:${width}%"></span></div>
      <p class="erp-text-muted">الهدف ≤ ${FOOD_COST.goal}% · ممتاز ≤ ${FOOD_COST.excellent}% · مقبول ≤ ${FOOD_COST.ok}%</p>
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
    return `<ol class="erp-pipe" tabindex="0" aria-label="خط سير فواتير اليوم (بيانات نموذجية)">`
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
    } catch { date = new Date().toLocaleDateString('ar-SA-u-ca-gregory-nu-latn'); }
    return { hi, name, date };
}

/* ── Live board (Gate D) ────────────────────────────────────────────────
   One request, one repaint. The sample board stays on screen until the
   server answers, so the first paint is never blocked by the network. */

const liveMoney = (v) => `${Number(v || 0).toLocaleString('en-US', { maximumFractionDigits: 0 })} ر.س`;
const liveClock = () => {
    try { return new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }); }
    catch { return ''; }
};

function liveTrend(board) {
    const labels = board.trend.map((t) => t.day);
    const values = board.trend.map((t) => t.revenue);
    const costs = board.trend.map((t) => t.cost);
    const max = niceCeiling(Math.max(1, ...values, ...costs));
    const fmtMark = (v) => (Math.abs(v) >= 1000 ? `${Math.round(v / 1000)}k` : String(Math.round(v)));
    return lineChart({
        ariaLabel: 'الإيراد والتكلفة — آخر 14 يومًا من دفتر القيود',
        labels,
        series: [
            { label: 'الإيراد', tone: 'brand', values, fill: true },
            { label: 'التكلفة', tone: 'chart-2', values: costs },
        ],
        max,
        formatValue: liveMoney,
        formatMark: fmtMark,
        emptyText: 'لا قيود مُرحَّلة في الفترة',
        bare: true,
    });
}

function liveCostRatio(board) {
    if (board.costRatio == null) {
        return '<p class="erp-text-muted">لا إيراد مُسجَّل اليوم — النسبة بلا أساس لا تُعرض.</p>';
    }
    const v = board.costRatio;
    const state = v <= 30 ? 'ممتاز' : v <= 32 ? 'ضمن الهدف' : v <= 34 ? 'مقبول' : 'خطر';
    const cogs = Math.max(0, board.kpi.cogs);
    const rest = Math.max(0, board.kpi.revenue - cogs);
    /* قرصٌ حقيقي لا شريطٌ في بطاقةٍ فارغة: نفس محرك الرسوم، ومجموعه =
       إيراد اليوم، فيُقرأ الباقي والمسحوب معًا بلا حسابٍ ذهني. */
    return donutChart({
        ariaLabel: `نسبة تكلفة البضاعة ${v.toFixed(1)}% — ${state}`,
        slices: [
            { label: 'تكلفة البضاعة', tone: 'brand', value: cogs },
            { label: 'باقي الإيراد', tone: 'chart-2', value: rest },
        ],
        centerLabel: 'من إيراد اليوم',
        centerValue: `${v.toFixed(1)}%`,
        formatValue: liveMoney,
        bare: true,
    })
        + `<p class="erp-text-muted erp-dash-note">${esc(state)} · ممتاز ≤ 30% · الهدف ≤ 32% · مقبول ≤ 34% · المصدر: قيود التكلفة المُرحَّلة</p>`;
}

function liveDonut(rows, ariaLabel, centerLabel, emptyText) {
    if (!rows.length) {return `<p class="erp-text-muted">${esc(emptyText)}</p>`;}
    const total = rows.reduce((a, r) => a + r.value, 0);
    return donutChart({
        ariaLabel,
        slices: rows,
        centerLabel,
        centerValue: total.toLocaleString('en-US'),
        formatValue: liveMoney,
        bare: true,
        maxSlices: 6,
    });
}

function liveTopItems(board) {
    if (!board.topItems.length) {return '<p class="erp-text-muted">لا مبيعات نقاط بيع اليوم.</p>';}
    return topItems(board.topItems.map((i) => ({ name: i.name, count: i.count })));
}

function liveAlerts(board) {
    if (!board.alerts.length) {
        return '<p class="exec__ok">لا شيء يحتاج قرارًا الآن — الأرقام سليمة.</p>';
    }
    const tone = (s) => (s === 'high' ? 'danger' : s === 'medium' ? 'warning' : null);
    return `<ul class="erp-minis" aria-label="ماذا يحتاج قرارًا اليوم — من الخادم">`
        + board.alerts.map((a) => `
      <li class="erp-mini">
        ${tone(a.severity) ? `<span class="erp-dot erp-dot--${tone(a.severity)}" aria-hidden="true"></span>` : ''}
        <span class="erp-mini__main">${esc(a.title)}<span class="erp-mini__sub">${esc(a.detail)}</span></span>
        ${a.action ? `<button type="button" class="erp-btn erp-btn--sm" data-dash-go="${esc(a.action.screen)}">${esc(a.action.label)}</button>` : ''}
      </li>`).join('')
        + `</ul>`;
}

/** Does this document hold an authenticated session apiFetch can use? */
function hasSession() {
    try { return !!window._jwt; } catch { return false; }
}

/**
 * Render the dashboard preview into `host` (synchronous — no await, so the
 * icons hydrator still sees a complete document at DOMContentLoaded).
 * Re-renders on period change and re-hydrates its own badges, because the
 * host's one-shot hydrate call has already run by then.
 * @param {HTMLElement} host
 * @param {{ statusBadge: Function }} ctx
 */
export function renderDashboard(host, ctx = {}) {
    const { statusBadge, navigate } = ctx;
    const go = typeof navigate === 'function' ? navigate : () => {};
    let period = 'day';
    let board = null;          // live model from buildLiveBoard
    let liveError = '';        // last failure message ('' = none)
    let liveBusy = false;

    function segGroup(options, current) {
        return `<div class="erp-seg" role="group" aria-label="الفترة">`
            + `<span class="erp-seg__label">الفترة</span>`
            + options.map((o) => {
                const id = o;
                const label = PERIODS[o].seg;
                const on = id === current;
                return `<button type="button" data-seg-kind="period" data-seg-id="${id}"${on ? ' class="is-active" aria-pressed="true"' : ' aria-pressed="false"'}>${esc(label)}</button>`;
            }).join('')
            + `</div>`;
    }

    /* ── Sample board (no session, or a failed read) ─────────────────── */
    function paintSample() {
        const P = PERIODS[period];
        const g = greeting();
        host.innerHTML = `
      <div class="erp-dash-head">
        <div>
          <h2 class="erp-dash-title">${esc(g.hi)}، ${esc(g.name)}</h2>
          <div class="erp-dash-sub">نظرة على العمليات — ${esc(g.date)}</div>
        </div>
        <div class="erp-dash-controls">
          ${segGroup(PERIOD_KEYS, period)}
        </div>
      </div>
      ${liveError ? `<div class="erp-state" role="status">
        <span class="erp-state__title">تعذّر قراءة السجل الحي</span>
        <span>هذه عينة تصميم — لم نعرض أصفارًا مكان سجلٍّ لم يُقرأ. (${esc(liveError)})</span>
      </div>` : ''}
      ${card('نبض ' + P.seg, 'Pulse', 'بيانات نموذجية للمعاينة · ' + P.compare, kpiStrip(P.kpis, 'مؤشرات الفترة (بيانات نموذجية)'))}
      ${advisorCard(P.kpis)}
      <div class="erp-dash-grid">
        ${card('الإيراد — آخر 14 يوم', 'Revenue 14D', 'بيانات نموذجية · الهدف 15,000 ر.س', revenueChart())}
        ${card('تكلفة الطعام اليوم', 'Food Cost %', 'بيانات نموذجية · الهدف ≤ 32%', foodCost())}
      </div>
      <div class="erp-dash-grid">
        ${card('المبيعات حسب الفئة', 'Category Mix', 'بيانات نموذجية', categoryDonut())}
        ${card('القنوات — اليوم', 'Channels', 'بيانات نموذجية', channelBars())}
      </div>
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
        host.querySelectorAll('[data-seg-kind="period"]').forEach((b) => {
            b.addEventListener('click', () => {
                const id = b.dataset.segId;
                if (PERIODS[id]) {period = id; paintSample();}
            });
        });
        try { hydrateStatusNodes(host); } catch { /* badges stay raw text — never fatal */ }
    }

    /* ── Live board — every number from /executive/summary ───────────── */
    function paintLive() {
        const g = greeting();
        const b = board;
        const tag = liveError
            ? '<span class="erp-badge" data-tone="warning"><span class="erp-badge-label">آخر قراءة ناجحة — تعذّر التحديث</span></span>'
            : '<span class="erp-badge" data-tone="success"><span class="erp-badge-label">بيانات حية</span></span>';
        host.innerHTML = `
      <div class="erp-dash-head">
        <div>
          <h2 class="erp-dash-title">${esc(g.hi)}، ${esc(g.name)}</h2>
          <div class="erp-dash-sub">موجز تنفيذي من دفتر القيود — ${esc(g.date)} · محدَّث ${esc(liveClock())}</div>
        </div>
        <div class="erp-dash-controls">
          ${tag}
          <button type="button" class="erp-btn erp-btn--sm" data-dash-refresh>
            <i class="ji" data-i="refresh" aria-hidden="true"></i><span>تحديث</span>
          </button>
        </div>
      </div>
      ${card('نبض اليوم', 'Pulse', 'من دفتر القيود المُرحَّل · ' + b.day, kpiStrip(b.kpis, { ariaLabel: 'مؤشرات اليوم — من الخادم', cols: 4 }))}
      <div class="erp-dash-grid">
        ${card('الإيراد والتكلفة — آخر 14 يوم', 'Revenue vs Cost', 'دفتر القيود المُرحَّل — لا تقدير', liveTrend(b))}
        ${card('نسبة تكلفة البضاعة', 'COGS Ratio', 'من إيراد اليوم — الهدف ≤ 32%', liveCostRatio(b))}
      </div>
      <div class="erp-dash-grid">
        ${card('الإيراد حسب القسم — اليوم', 'Revenue by Dept', 'أقسام اليوم من الخادم', liveDonut(b.departments, 'الإيراد حسب القسم — اليوم', 'إجمالي (ر.س)', 'لا إيراد مقسَّم اليوم.'))}
        ${card('النقد في الدفاتر', 'Cash on Books', 'أرصدة حسابات النقد', liveDonut(b.cash, 'توزيع النقد على الحسابات', 'إجمالي (ر.س)', 'لا حسابات نقد.'))}
      </div>
      ${card('ماذا يحتاج قرارًا اليوم', 'Action Alerts', 'مرتّب بالأولوية — إجراء مباشر', liveAlerts(b))}
      ${card('أصناف نقاط البيع الأعلى اليوم', 'Top POS Items', 'كمية مباعة — من نقاط البيع', liveTopItems(b))}`;
        host.querySelector('[data-dash-refresh]')?.addEventListener('click', () => hydrate(true));
        host.querySelectorAll('[data-dash-go]').forEach((btn) => {
            btn.addEventListener('click', () => go(btn.dataset.dashGo));
        });
        try { hydrateStatusNodes(host); } catch { /* badges stay raw text — never fatal */ }
    }

    function paint() {
        if (board) {paintLive();} else {paintSample();}
    }

    async function hydrate(force) {
        if (!hasSession() || liveBusy) {return;}
        liveBusy = true;
        const btn = host.querySelector('[data-dash-refresh]');
        if (btn) {btn.disabled = true;}
        try {
            const payload = await fetchExecutiveSummary({ days: 14, force: !!force });
            board = buildLiveBoard(payload);
            liveError = '';
        } catch (e) {
            liveError = String((e && e.message) || 'خطأ في القراءة');
        } finally {
            liveBusy = false;
            const again = host.querySelector('[data-dash-refresh]');
            if (again) {again.disabled = false;}
            if (host.isConnected) {paint();}
        }
    }

    paint();
    hydrate(false);
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
 * inherits the unified .erp-v2 tokens, while surviving
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
        /* الأسهم تنقل الاختيار بين نتائج تتجاوز ارتفاع القائمة (12 نتيجة في
           284px): بلا هذا يتحرّك aria-activedescendant إلى صفٍّ خارج النظر. */
        list.querySelector(`#erp-pal-opt-${active}`)?.scrollIntoView({ block: 'nearest' });
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
        /* الحوار معلن aria-modal، فلا يجوز أن يخرج Tab إلى صفحةٍ خلفه:
           التنقّل داخل النتائج بالأسهم (aria-activedescendant). */
        if (e.key === 'Tab') {e.preventDefault(); input.focus(); return;}
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
