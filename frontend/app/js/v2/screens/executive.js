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
import { apiFetch } from '../../core/api.js?v=4.9.193';
import { barChart, lineChart, donutChart } from '../charts.js?v=4.9.193';

const esc = (v) => String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const money = (v) => `${Number(v || 0).toLocaleString('en-US', { maximumFractionDigits: 0 })} ر.س`;
const pct = (v) => (v == null ? '—' : `${Number(v).toFixed(1)}%`);

const KPIS = [
    { key: 'revenue', label: 'إيراد اليوم', tone: 'success', fmt: money, hint: 'من دفتر القيود المُرحَّل' },
    { key: 'cogs', label: 'تكلفة البضاعة', tone: 'warning', fmt: money, hint: 'من دفتر القيود' },
    { key: 'net', label: 'الصافي', tone: 'brand', fmt: money, hint: 'إيراد − تكلفة − مصروف' },
    { key: 'margin', label: 'الهامش', tone: 'info', fmt: pct, hint: 'نسبة الصافي من الإيراد' },
    { key: 'cash', label: 'النقد في الدفاتر', tone: 'neutral', fmt: money, hint: 'أرصدة حسابات النقد' },
    { key: 'entries', label: 'قيود مُرحَّلة اليوم', tone: 'neutral', fmt: (v) => String(v || 0), hint: 'عدد قيود اليوم' },
    { key: 'openShifts', label: 'ورديات مفتوحة', tone: 'danger', fmt: (v) => String(v || 0), hint: 'نقد لم يُقفل' },
    { key: 'negativeStock', label: 'أصناف رصيدها سالب', tone: 'danger', fmt: (v) => String(v || 0), hint: 'ثقة التكلفة' },
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
        <header class="exec__head erp-screen-in">
          <div>
            <h1 class="exec__title">موجز المدير</h1>
            <p class="exec__sub" data-exec-sub>جارٍ جمع الأرقام…</p>
          </div>
          <button type="button" class="erp-btn erp-btn--sm" data-exec-refresh>تحديث</button>
        </header>
        <div class="exec__kpis" data-exec-kpis></div>
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
        q('[data-exec-kpis]').innerHTML = KPIS.map((c, i) => `
          <article class="exec__kpi exec__kpi--${c.tone}" style="--exec-i:${i}">
            <span class="exec__kpi-label">${esc(c.label)}</span>
            <strong class="exec__kpi-value">${esc(c.fmt(k[c.key]))}</strong>
            <span class="exec__kpi-hint">${esc(c.hint)}</span>
          </article>`).join('');
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
