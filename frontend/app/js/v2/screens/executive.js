/**
 * screens/executive.js — موجز المدير: كل الأرقام في لوحة واحدة
 * ══════════════════════════════════════════════════════════════════════
 * «موجز» لا «شاشة أخرى»: صفحة واحدة تُقرأ في ٣٠ ثانية، فيها كل ما يهمّ
 * الإدارة اليومي — وكل رقم فيها **حقيقي** (دفتر القيود + قراءات التشغيل)
 * ومعه زرُّ إجراء يقود إلى الشاشة التي تُعالَج فيها المسألة.
 *
 * السرعة (شرط المالك: بلا التأثير على سرعة الواجهة):
 *   · طلبٌ واحد (/api/executive/summary) ⇒ لا waterfall ولا N+1.
 *   · الوحدة تُحمَّل كسولًا (import ديناميكي) عند أول فتح ⇒ لا وزن على الإقلاع.
 *   · رسوم SVG من مكتبة المشروع (بلا مكتبة خارجية) ⇒ بلا vendor جديد.
 *   · الأنيميشن CSS فقط (لا JS) ⇒ لا إعادة رسم.
 */
import { apiFetch } from '../../core/api.js?v=4.9.180';
import { barChart, lineChart, donutChart } from '../charts.js?v=4.9.180';
import { kpiStrip } from '../role-dash-parts.js?v=4.9.180';

const esc = (v) => String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const money = (v) => `${Number(v || 0).toLocaleString('en-US', { maximumFractionDigits: 0 })} ر.س`;
const pct = (v) => (v == null ? '—' : `${Number(v).toFixed(1)}%`);
const bare = (v) => `${Number(v || 0).toLocaleString('en-US')}`;

const KPIS = [
    { key: 'revenue', label: 'إيراد اليوم', icon: 'banknote', en: 'Revenue', unit: 'ر.س', fmt: bare, hint: 'من دفتر القيود المُرحَّل' },
    { key: 'cogs', label: 'تكلفة البضاعة', icon: 'wallet', en: 'COGS', unit: 'ر.س', fmt: bare, hint: 'من دفتر القيود' },
    { key: 'net', label: 'الصافي', icon: 'gem', en: 'Net', unit: 'ر.س', fmt: bare, hint: 'إيراد − تكلفة − مصروف' },
    { key: 'margin', label: 'الهامش', icon: 'trending-up', en: 'Margin', unit: '', fmt: pct, hint: 'نسبة الصافي من الإيراد' },
    { key: 'cash', label: 'النقد في الدفاتر', icon: 'receipt', en: 'Cash on books', unit: 'ر.س', fmt: bare, hint: 'أرصدة حسابات النقد' },
    { key: 'entries', label: 'قيود مُرحَّلة اليوم', icon: 'save', en: 'Posted today', unit: 'قيد', fmt: bare, hint: 'عدد قيود اليوم' },
    { key: 'openShifts', label: 'ورديات مفتوحة', icon: 'clock', en: 'Open shifts', unit: 'وردية', fmt: bare, hint: 'نقد لم يُقفل' },
    { key: 'negativeStock', label: 'أصناف رصيدها سالب', icon: 'alert-triangle', en: 'Negative stock', unit: 'صنف', fmt: bare, hint: 'ثقة التكلفة' },
];

const SEV = { high: 'danger', medium: 'warning', low: 'info' };

/**
 * @param {HTMLElement} host
 * @param {{navigate?:(key:string)=>void}} [ctx]
 */
export function mountExecutive(host, ctx = {}) {
    const navigate = typeof ctx.navigate === 'function' ? ctx.navigate : () => {};
    let data = null;
    let busy = false;

    host.innerHTML = `
      <section class="erp-v2 exec" data-exec>
        <header class="erp-dash-head erp-screen-in">
          <div>
            <h2 class="erp-dash-title">موجز المدير
              <span class="erp-eyebrow" dir="ltr" lang="en">Executive Pulse</span>
            </h2>
            <p class="erp-dash-sub" data-exec-sub>جارٍ جمع الأرقام…</p>
          </div>
          <div class="erp-dash-controls">
            <button type="button" class="erp-btn erp-btn--sm" data-exec-refresh>تحديث</button>
          </div>
        </header>
        <div data-exec-kpis></div>
        <div class="exec__grid">
          <section class="erp-card exec__card exec__card--wide erp-screen-in">
            <div class="erp-card__head"><h2 class="erp-card__title">إيراد وتكلفة — آخر ١٤ يومًا</h2></div>
            <div class="erp-card__body" data-exec-chart-trend></div>
          </section>
          <section class="erp-card exec__card erp-screen-in">
            <div class="erp-card__head"><h2 class="erp-card__title">الصافي اليومي</h2></div>
            <div class="erp-card__body" data-exec-chart-net></div>
          </section>
          <section class="erp-card exec__card erp-screen-in">
            <div class="erp-card__head"><h2 class="erp-card__title">النقد في الدفاتر</h2></div>
            <div class="erp-card__body" data-exec-chart-cash></div>
          </section>
        </div>
        <section class="erp-card exec__alerts erp-screen-in">
          <div class="erp-card__head"><h2 class="erp-card__title">ماذا يحتاج قرارًا اليوم</h2></div>
          <div class="erp-card__body" data-exec-alerts></div>
        </section>
        <div class="exec__grid">
          <section class="erp-card exec__card erp-screen-in">
            <div class="erp-card__head"><h2 class="erp-card__title">الأقسام الأعلى اليوم</h2></div>
            <div class="erp-card__body" data-exec-depts></div>
          </section>
          <section class="erp-card exec__card erp-screen-in">
            <div class="erp-card__head"><h2 class="erp-card__title">أصناف نقاط البيع الأعلى اليوم</h2></div>
            <div class="erp-card__body" data-exec-items></div>
          </section>
        </div>
      </section>`;

    const q = (sel) => host.querySelector(sel);

    function paintKpis() {
        const k = (data && data.kpi) || {};
        // سجل المؤشرات الموحّد (ul.erp-kpis) — نفس لغة لوحة القيادة، مرقّم 01…NN.
        q('[data-exec-kpis]').innerHTML = kpiStrip(KPIS.map((c) => ({
            icon: c.icon, label: c.label, en: c.en,
            value: c.fmt(k[c.key]), unit: c.unit, hint: c.hint,
        })));
    }

    function paintCharts() {
        const s = (data && data.series) || [];
        const labels = s.map((r) => String(r.day).slice(5));
        q('[data-exec-chart-trend]').innerHTML = barChart({
            title: 'إيراد وتكلفة — آخر ١٤ يومًا',
            ariaLabel: 'أعمدة مقارنة بين الإيراد والتكلفة يوميًا',
            labels,
            series: [
                { label: 'الإيراد', tone: 'success', values: s.map((r) => r.revenue) },
                { label: 'التكلفة', tone: 'warning', values: s.map((r) => r.cost) },
            ],
            formatValue: (v) => money(v),
            formatMark: (v) => (Math.abs(v) >= 1000 ? `${Math.round(v / 1000)}k` : String(Math.round(v * 10) / 10)),
            emptyText: 'لا قيود في الفترة',
        });
        q('[data-exec-chart-net]').innerHTML = lineChart({
            title: 'الصافي اليومي',
            ariaLabel: 'خطّ الصافي اليومي',
            labels,
            series: [{ label: 'الصافي', tone: 'brand', values: s.map((r) => r.net), fill: true }],
            formatValue: (v) => money(v),
            formatMark: (v) => (Math.abs(v) >= 1000 ? `${Math.round(v / 1000)}k` : String(Math.round(v * 10) / 10)),
            emptyText: 'لا بيانات',
        });
        const cash = (data && data.cash) || [];
        q('[data-exec-chart-cash]').innerHTML = donutChart({
            title: 'النقد في الدفاتر',
            ariaLabel: 'توزيع النقد على الحسابات',
            labels: cash.map((c) => c.name || c.code),
            values: cash.map((c) => Math.abs(c.balance)),
            formatValue: (v) => money(v),
            emptyText: 'لا حسابات نقد',
        });
    }

    function paintAlerts() {
        const list = (data && data.alerts) || [];
        const box = q('[data-exec-alerts]');
        if (!list.length) {
            box.innerHTML = '<p class="exec__ok">لا شيء يحتاج قرارًا الآن — الأرقام سليمة.</p>';
            return;
        }
        box.innerHTML = `<ul class="exec__alert-list">${list.map((a) => `
          <li class="exec__alert exec__alert--${esc(SEV[a.severity] || 'info')}">
            <div class="exec__alert-text">
              <strong class="exec__alert-title">${esc(a.title)}</strong>
              <span class="exec__alert-detail">${esc(a.detail)}</span>
            </div>
            ${a.action ? `<button type="button" class="erp-btn erp-btn--sm" data-exec-go="${esc(a.action.screen)}">${esc(a.action.label)}</button>` : ''}
          </li>`).join('')}</ul>`;
        box.querySelectorAll('[data-exec-go]').forEach((b) => {
            b.addEventListener('click', () => navigate(b.dataset.execGo));
        });
    }

    function paintLists() {
        const depts = (data && data.topDepts) || [];
        q('[data-exec-depts]').innerHTML = depts.length
            ? `<ul class="exec__list">${depts.map((d) => `<li><span>${esc(d.name)}</span><strong>${esc(money(d.total))}</strong></li>`).join('')}</ul>`
            : '<p class="exec__muted">لا إيراد مقسَّم اليوم.</p>';
        const items = (data && data.topItems) || [];
        q('[data-exec-items]').innerHTML = items.length
            ? `<ul class="exec__list">${items.map((i) => `<li><span>${esc(i.name)}</span><strong>${esc(money(i.total))}</strong></li>`).join('')}</ul>`
            : '<p class="exec__muted">لا مبيعات اليوم.</p>';
    }

    function paint() {
        if (!data) {return;}
        const close = data.kpi && data.kpi.lastClose;
        q('[data-exec-sub]').textContent = `${data.day} · ${data.postedToday} قيد مُرحَّل اليوم`
            + (close ? ` · آخر إقفال Z${close.z} (${close.date})` : ' · لا إقفال مسجَّل');
        paintKpis();
        paintCharts();
        paintAlerts();
        paintLists();
    }

    async function load() {
        if (busy) {return;}
        busy = true;
        const btn = q('[data-exec-refresh]');
        if (btn) {btn.disabled = true;}
        try {
            data = await apiFetch('/executive/summary');
            paint();
        } catch (e) {
            q('[data-exec-sub]').textContent = `تعذّر جمع الأرقام: ${(e && e.message) || 'خطأ'}`;
        } finally {
            busy = false;
            if (btn) {btn.disabled = false;}
        }
    }

    const refreshBtn = q('[data-exec-refresh]');
    if (refreshBtn) {refreshBtn.addEventListener('click', load);}

    load();
    return { destroy() { host.innerHTML = ''; }, refresh: load };
}
