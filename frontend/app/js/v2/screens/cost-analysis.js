/**
 * V2 — Cost analysis screen · شاشة 17 في سجل الترحيل (قراءة فقط)
 * ═══════════════════════════════════════════════════════════════════════
 *
 * LEGACY PARITY (features/finance.js:252-273 + auth-navigation.js:398-451)
 *   The legacy screen computes over STATE.revenues + STATE.expenses +
 *   STATE.departments. V2 uses /finance/cost-analysis to apply the same
 *   department-tree and expense-bucket rules in one aggregated read.
 *   Buckets per department: صرف مخزون (stock movement, net of returns via
 *   the Math.max(0, …) legacy rule) / فرق جرد (count_correction) /
 *   تشغيلية (the rest). KPI thresholds: <50 green, <75 orange, else red
 *   (finance.js:273).
 *   Charts (bar + donut) are drawn by js/v2/charts.js as SVG — no external
 *   library, no CSP change.
 *   Read gate on the sources: admin|manager|accountant|auditor.
 *
 * PRINTING
 *   The print action opens /finance/cost-analysis/print in the in-app
 *   report viewer: the server renders the full A4 sheet (logo, brand
 *   header, composition, departments, categories, totals, footer) from the
 *   same aggregate query. The screen never re-computes a number for print.
 *
 * THIS SCREEN NEVER WRITES.
 */

import { createDataTable } from '../data-display/data-table.js?v=4.9.152';
import { barChart, donutChart } from '../charts.js?v=4.9.152';
import { openInAppReport } from '../report-viewer.js?v=4.9.152';
import {
    fetchCostAnalysis, fetchCostAnalysisPrintHtml, firstOfMonth, riyadhToday,
} from '../data/finance-repo.js?v=4.9.152';
import { fetchCurrency, formatMoney, formatInt } from '../data/reports-repo.js?v=4.9.152';

const esc = (v) => String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const round1 = (v) => Math.round((Number(v) || 0) * 10) / 10;
const num = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
};

/** Legacy KPI threshold coloring (finance.js:273): <50 green, <75 orange. */
function costTone(pct) {
    if (pct < 50) {return 'erp-text-success';}
    if (pct < 75) {return 'erp-text-warning';}
    return 'erp-text-danger';
}

function toneName(pct) {
    if (pct < 50) {return 'success';}
    if (pct < 75) {return 'warning';}
    return 'danger';
}

/** A department may hold revenue, cost, both, or neither. Calling a pure
 *  cost centre «خاسر» would read as a loss when the company is profitable,
 *  so the verdict names the centre itself unless both sides exist. */
function verdict(row) {
    const hasRev = num(row.rev) > 0;
    const hasCost = num(row.exp) > 0;
    if (hasRev && hasCost) {
        return row.profit >= 0
            ? { label: 'مربح', tone: 'success' }
            : { label: 'خاسر', tone: 'danger' };
    }
    if (hasCost) {return { label: 'مركز تكلفة', tone: 'warning' };}
    if (hasRev) {return { label: 'مركز إيراد', tone: 'brand' };}
    return { label: 'بدون حركة', tone: 'neutral' };
}

function moneyCell(v, currency, signed = false) {
    const m = formatMoney(v, currency);
    const cls = signed && Number(v) < 0 ? ' erp-text-success' : (signed && Number(v) > 0 ? ' erp-text-danger' : '');
    return `<span class="erp-num${cls}" dir="ltr">${m.amount}</span>`
        + (m.hasUnit ? ` <span class="erp-text-sm erp-text-muted">${esc(m.unit)}</span>` : '');
}

function moneyText(v, currency) {
    const m = formatMoney(v, currency);
    return `${m.amount}${m.hasUnit ? ` ${m.unit}` : ''}`;
}

/** بنية المعيار المصدّق (نفس عقد المطبخ): ul.erp-kpis > li.erp-kpi — لا ديفات. */
function kpiCard(label, body, icon) {
    return `<li class="erp-kpi">
      <div class="erp-kpi__top">
        ${icon ? `<span class="erp-kpi__icon" aria-hidden="true"><i class="ji" data-i="${esc(icon)}"></i></span>` : ''}
        <span class="erp-kpi__label">${esc(label)}</span>
      </div>
      <div class="erp-kpi__value"><span data-v2-kpi="${esc(label)}">${body}</span></div>
    </li>`;
}

function statCard({ label, value, note, icon, tone }) {
    return `<article class="erp-v2-cost__stat" data-tone="${esc(tone)}">
      <span class="erp-v2-cost__stat-icon" aria-hidden="true"><i class="ji" data-i="${esc(icon)}"></i></span>
      <div class="erp-v2-cost__stat-body">
        <span class="erp-v2-cost__stat-label">${esc(label)}</span>
        <strong class="erp-v2-cost__stat-value" data-v2-stat="${esc(label)}">${value}</strong>
        <span class="erp-v2-cost__stat-note">${esc(note)}</span>
      </div>
    </article>`;
}

function template(from, to) {
    return `
      <section class="erp-card erp-v2-cost">
        <div class="erp-card__head">
          <div class="erp-v2-cost__heading">
            <span class="erp-v2-cost__eyebrow" dir="ltr" lang="en">FINANCE · COST CONTROL</span>
            <h3 class="erp-card__title">تحليل التكاليف
              <span class="erp-eyebrow" dir="ltr" lang="en">Cost Analysis</span>
            </h3>
            <p>ملخص الإيرادات والتكاليف حسب القسم والفترة المحددة.</p>
          </div>
          <div class="erp-v2-cost__filters" role="group" aria-label="فترة تحليل التكاليف">
            <label class="erp-v2-cost__date" for="v2cost-from">
              <span>من تاريخ</span>
              <input class="erp-input erp-input--ltr" id="v2cost-from" type="date" value="${esc(from)}" min="${esc(firstOfMonth())}" max="${esc(riyadhToday())}">
            </label>
            <label class="erp-v2-cost__date" for="v2cost-to">
              <span>إلى تاريخ</span>
              <input class="erp-input erp-input--ltr" id="v2cost-to" type="date" value="${esc(to)}" min="${esc(firstOfMonth())}" max="${esc(riyadhToday())}">
            </label>
            <div class="erp-v2-cost__actions">
              <button type="button" class="erp-btn erp-btn--sm" data-v2-month>بداية الشهر</button>
              <button type="button" class="erp-btn erp-btn--sm" data-v2-print aria-label="طباعة التحليل">
                <i class="ji" data-i="printer" aria-hidden="true"></i><span>طباعة</span>
              </button>
              <button type="button" class="erp-btn erp-btn--primary erp-btn--sm" data-v2-reload>
                <i class="ji" data-i="refresh" aria-hidden="true"></i><span>إعادة الحساب</span>
              </button>
            </div>
          </div>
        </div>
        <div class="erp-card__body erp-stack">
          <section class="erp-v2-cost__hero" data-v2-hero aria-label="المؤشرات الرئيسية">
            <div class="erp-v2-cost__hero-head">
              <span class="erp-v2-cost__hero-kicker">ملخص الفترة</span>
              <span class="erp-v2-cost__hero-range" data-v2-range></span>
            </div>
            <div class="erp-v2-cost__hero-grid" data-v2-hero-grid>
              ${statCard({ label: 'إجمالي الإيرادات', value: '—', note: ' ', icon: 'banknote', tone: 'brand' })}
              ${statCard({ label: 'إجمالي التكاليف', value: '—', note: ' ', icon: 'wallet', tone: 'danger' })}
              ${statCard({ label: 'صافي الربح', value: '—', note: ' ', icon: 'trending-up', tone: 'success' })}
              ${statCard({ label: 'نسبة التكلفة', value: '—', note: ' ', icon: 'pie', tone: 'warning' })}
            </div>
          </section>
          <ul class="erp-kpis erp-v2-cost__kpis" data-v2-kpis></ul>

          <div class="erp-v2-cost__split">
            <section class="erp-v2-cost__panel" aria-labelledby="v2cost-mix-title">
              <header class="erp-v2-cost__panel-head">
                <h4 id="v2cost-mix-title">تركيب التكلفة</h4>
                <span class="erp-v2-cost__panel-note" data-v2-mix-total></span>
              </header>
              <ul class="erp-v2-cost__mix" data-v2-mix></ul>
            </section>
            <section class="erp-v2-cost__panel" aria-labelledby="v2cost-rank-title">
              <header class="erp-v2-cost__panel-head">
                <h4 id="v2cost-rank-title">أعلى الأقسام تكلفة</h4>
                <span class="erp-v2-cost__panel-note" data-v2-rank-note></span>
              </header>
              <ol class="erp-v2-cost__rank" data-v2-rank></ol>
            </section>
          </div>

          <div class="erp-v2-chart-grid" data-v2-charts></div>

          <section class="erp-v2-cost__register" aria-labelledby="v2cost-table-title">
            <div class="erp-v2-cost__register-head">
              <h4 id="v2cost-table-title">تفصيل التكاليف حسب القسم</h4>
              <span class="erp-v2-cost__register-total" data-v2-register-total></span>
              <p data-v2-summary role="status" aria-live="polite" class="erp-text-sm erp-text-muted"></p>
            </div>
            <div data-v2-table></div>
          </section>
        </div>
      </section>`;
}

/**
 * @param {ParentNode} host where the screen is inserted
 * @param {{role?: string|null, notify?: (message:string, kind?:string)=>void}} [ctx]
 * @returns {{el: HTMLElement, reload: ()=>Promise<void>, getTotals: ()=>object|null, destroy: ()=>void}}
 */
export function mountCostAnalysisScreen(host, ctx = {}) {
    let rows = [];
    let categories = [];
    let currency = '';
    let totals = null;
    let loading = false;

    host.insertAdjacentHTML('beforeend', template(firstOfMonth(), riyadhToday()));
    const el = host.lastElementChild;
    const q = (sel) => el.querySelector(sel);
    const kpisEl = q('[data-v2-kpis]');
    const mixEl = q('[data-v2-mix]');
    const rankEl = q('[data-v2-rank]');
    const chartsEl = q('[data-v2-charts]');
    const summaryEl = q('[data-v2-summary]');

    const table = createDataTable({
        caption: 'تكلفة الأقسام',
        mode: 'client',
        pageSize: 50,
        stickyHeader: true,
        emptyMessage: 'لا توجد أقسام مسجلة',
        rowKey: (row) => row.code,
        columns: [
            { key: 'name', header: 'القسم', sortable: true, filterable: true },
            {
                key: 'rev', header: 'الإيرادات', type: 'number', sortable: true,
                align: 'end', value: (row) => row.rev, render: (row) => moneyCell(row.rev, currency),
            },
            {
                key: 'materials', header: 'صرف مخزون', type: 'number', sortable: true,
                align: 'end', value: (row) => row.materials, render: (row) => moneyCell(row.materials, currency),
            },
            {
                key: 'countAdj', header: 'فرق جرد', type: 'number', sortable: true,
                align: 'end', value: (row) => row.countAdj, render: (row) => moneyCell(row.countAdj, currency, true),
            },
            {
                key: 'operating', header: 'تشغيلية', type: 'number', sortable: true,
                align: 'end', value: (row) => row.operating, render: (row) => moneyCell(row.operating, currency),
            },
            {
                key: 'exp', header: 'التكلفة الإجمالية', type: 'number', sortable: true,
                align: 'end', value: (row) => row.exp, render: (row) => moneyCell(row.exp, currency),
            },
            {
                key: 'costRatio', header: 'نسبة التكلفة', type: 'number', sortable: true,
                width: '120px', align: 'end', value: (row) => row.costRatio,
                render: (row) => (num(row.rev) > 0
                    ? `<span class="erp-num ${costTone(row.costRatio)}" dir="ltr">${round1(row.costRatio)}%</span>`
                    : '<span class="erp-text-muted">—</span>'),
            },
            {
                key: 'profit', header: 'صافي الربح', type: 'number', sortable: true,
                align: 'end', value: (row) => row.profit,
                render: (row) => `<span class="erp-num ${row.profit >= 0 ? 'erp-text-success' : 'erp-text-danger'}" dir="ltr">${moneyText(row.profit, currency)}</span>`,
            },
            {
                key: 'margin', header: 'هامش الربح', type: 'number', sortable: true,
                width: '110px', align: 'end', value: (row) => row.margin,
                render: (row) => (num(row.rev) > 0
                    ? `<span class="erp-num erp-text-muted" dir="ltr">${round1(row.margin)}%</span>`
                    : '<span class="erp-text-muted">—</span>'),
            },
            {
                key: 'rowCount', header: 'الحركات', type: 'number', sortable: true,
                width: '90px', align: 'end', value: (row) => row.rowCount,
                render: (row) => `<span class="erp-num erp-text-muted" dir="ltr">${formatInt(row.rowCount)}</span>`,
            },
            {
                key: 'status', header: 'التقييم', sortable: true, width: '120px', align: 'center',
                value: (row) => row.profit,
                render: (row) => {
                    const v = verdict(row);
                    return `<span class="erp-badge" data-tone="${v.tone}">${v.label}</span>`;
                },
            },
        ],
    });

    q('[data-v2-table]').appendChild(table.el);

    function withMargin(list) {
        return list.map((row) => ({
            ...row,
            margin: row.rev > 0 ? (row.profit / row.rev) * 100 : 0,
        }));
    }

    function paintHero(t) {
        const net = num(t.rev) - num(t.exp);
        const shareOfRev = num(t.rev) > 0 ? (num(t.exp) / num(t.rev)) * 100 : 0;
        const margin = num(t.rev) > 0 ? (net / num(t.rev)) * 100 : 0;
        const from = q('#v2cost-from').value || firstOfMonth();
        const to = q('#v2cost-to').value || riyadhToday();
        const rangeEl = q('[data-v2-range]');
        if (rangeEl) {
            rangeEl.innerHTML = `<span dir="ltr">${esc(from)}</span> ← <span dir="ltr">${esc(to)}</span>`;
        }
        q('[data-v2-hero-grid]').innerHTML = [
            statCard({
                label: 'إجمالي الإيرادات',
                value: moneyCell(t.rev, currency),
                note: `${formatInt(rows.length)} قسمًا مسجلًا`,
                icon: 'banknote', tone: 'brand',
            }),
            statCard({
                label: 'إجمالي التكاليف',
                value: moneyCell(t.exp, currency),
                note: `${round1(shareOfRev)}% من الإيراد`,
                icon: 'wallet', tone: 'danger',
            }),
            statCard({
                label: 'صافي الربح',
                value: moneyCell(net, currency),
                note: `هامش الربح ${round1(margin)}%`,
                icon: net >= 0 ? 'trending-up' : 'trending-down',
                tone: net >= 0 ? 'success' : 'danger',
            }),
            statCard({
                label: 'نسبة التكلفة',
                value: `<span class="erp-num ${costTone(shareOfRev)}" dir="ltr">${round1(shareOfRev)}%</span>`,
                note: 'التكلفة ÷ الإيراد',
                icon: 'pie', tone: toneName(shareOfRev),
            }),
        ].join('');
    }

    function paintKpis(t) {
        kpisEl.innerHTML = [
            kpiCard('صرف مخزون (صافي المرتجعات)', moneyCell(t.mat, currency), 'package'),
            kpiCard('عجز / زيادة الجرد', moneyCell(t.cnt, currency, true), 'clipboard-list'),
            kpiCard('مصروفات تشغيلية', moneyCell(t.ops, currency), 'pen-tool'),
            kpiCard('تصنيفات المصروف', `<span class="erp-num" dir="ltr">${formatInt(categories.length)}</span>`, 'layers'),
        ].join('');
    }

    function paintMix(t) {
        const total = num(t.exp);
        const items = [
            { label: 'صرف المخزون', value: num(t.mat), tone: 'brand' },
            { label: 'فروق الجرد', value: num(t.cnt), tone: 'warning' },
            { label: 'مصروفات تشغيلية', value: num(t.ops), tone: 'success' },
        ];
        q('[data-v2-mix-total]').textContent = `الإجمالي ${moneyText(total, currency)}`;
        mixEl.innerHTML = items.map((item) => {
            const ofCost = total > 0 ? (item.value / total) * 100 : 0;
            const ofRev = num(t.rev) > 0 ? (item.value / num(t.rev)) * 100 : 0;
            const bar = Math.max(0, Math.min(100, ofCost));
            return `<li class="erp-v2-cost__mix-row" data-tone="${item.tone}">
              <div class="erp-v2-cost__mix-top">
                <span class="erp-v2-cost__mix-label">${esc(item.label)}</span>
                <span class="erp-v2-cost__mix-value">${moneyCell(item.value, currency)}</span>
              </div>
              <div class="erp-v2-cost__mix-bar"><span style="--mix:${round1(bar)}%"></span></div>
              <div class="erp-v2-cost__mix-meta">
                <span>${round1(ofCost)}% من التكلفة</span>
                <span>${round1(ofRev)}% من الإيراد</span>
              </div>
            </li>`;
        }).join('');
    }

    function paintRank() {
        const ranked = rows.slice()
            .filter((row) => num(row.exp) > 0)
            .sort((a, b) => num(b.exp) - num(a.exp))
            .slice(0, 5);
        const top = ranked.length ? num(ranked[0].exp) : 0;
        q('[data-v2-rank-note]').textContent = ranked.length ? `أعلى ${formatInt(ranked.length)}` : '';
        rankEl.innerHTML = ranked.length
            ? ranked.map((row, index) => {
                const v = verdict(row);
                const share = top > 0 ? Math.max(2, Math.min(100, (num(row.exp) / top) * 100)) : 0;
                const ratio = num(row.rev) > 0
                    ? `${round1(row.costRatio)}% من الإيراد`
                    : 'مركز تكلفة';
                return `
              <li class="erp-v2-cost__rank-row">
                <span class="erp-v2-cost__rank-no" aria-hidden="true">${index + 1}</span>
                <span class="erp-v2-cost__rank-body">
                  <span class="erp-v2-cost__rank-name">${esc(row.name)}</span>
                  <span class="erp-v2-cost__rank-sub">${moneyText(row.exp, currency)} · ${ratio}</span>
                  <span class="erp-v2-cost__rank-bar" aria-hidden="true"><span style="--rank:${round1(share)}%"></span></span>
                </span>
                <span class="erp-badge" data-tone="${v.tone}">${v.label}</span>
              </li>`;
            }).join('')
            : '<li class="erp-v2-cost__rank-empty">لا تكاليف مسجلة في هذه الفترة</li>';
    }

    function paint() {
        const from = q('#v2cost-from').value;
        const to = q('#v2cost-to').value;
        const t = totals || { rev: 0, mat: 0, cnt: 0, ops: 0, exp: 0, avgCost: 0 };
        paintHero(t);
        paintKpis(t);
        paintMix(t);
        paintRank();
        const totalEl = q('[data-v2-register-total]');
        if (totalEl) {
            totalEl.innerHTML = totals
                ? `<span>إجمالي التكاليف</span><strong class="erp-num" dir="ltr">${moneyText(num(t.exp), currency)}</strong>`
                : '';
        }

        if (!rows.length) {
            chartsEl.innerHTML = '';
            summaryEl.textContent = 'لا توجد أقسام مسجلة.';
            table.setRows([]);
            return;
        }

        const chartRows = rows.slice()
            .sort((a, b) => (num(b.rev) + num(b.exp)) - (num(a.rev) + num(a.exp)))
            .slice(0, 8);
        chartsEl.innerHTML = [
            barChart({
                title: rows.length > chartRows.length
                    ? `مقارنة أعلى ${formatInt(chartRows.length)} أقسام`
                    : 'الإيرادات مقابل التكلفة حسب القسم',
                ariaLabel: rows.length > chartRows.length
                    ? `أعمدة الإيرادات والتكلفة لأعلى ${chartRows.length} أقسام`
                    : 'أعمدة الإيرادات والتكلفة الإجمالية لكل قسم',
                labels: chartRows.map((r) => r.name),
                series: [
                    { label: 'الإيرادات', tone: 'success', values: chartRows.map((r) => r.rev) },
                    { label: 'التكلفة الإجمالية', tone: 'danger', values: chartRows.map((r) => r.exp) },
                ],
                formatValue: (v) => moneyText(v, currency),
                emptyText: 'لا أقسام في هذه الفترة',
            }),
            donutChart({
                title: 'توزيع بنود التكلفة بالتصنيف',
                ariaLabel: 'رسم دائري لنسب تصنيفات المصروفات في الفترة',
                slices: categories,
                centerLabel: 'إجمالي المصروفات',
                formatValue: (v) => moneyText(v, currency),
                maxSlices: 8,
                emptyText: 'لا مصروفات في هذه الفترة',
            }),
        ].join('');

        summaryEl.textContent = `${formatInt(rows.length)} قسمًا · ${from || firstOfMonth()} → ${to || riyadhToday()}`;
        table.setRows(rows);
    }

    async function printSheet(button) {
        if (button) {button.disabled = true;}
        try {
            const html = await fetchCostAnalysisPrintHtml(
                q('#v2cost-from').value, q('#v2cost-to').value,
            );
            const viewer = openInAppReport('تحليل التكاليف');
            viewer.document.write(html);
            viewer.document.close();
        } catch (e) {
            ctx.notify?.((e && e.message) || 'تعذر تجهيز المستند للطباعة', 'error');
        } finally {
            if (button && button.isConnected) {button.disabled = false;}
        }
    }

    async function reload() {
        if (loading) {return;}
        const from = q('#v2cost-from').value;
        const to = q('#v2cost-to').value;
        if (Boolean(from) !== Boolean(to)) {
            summaryEl.textContent = 'تاريخ البداية والنهاية مطلوبان معًا.';
            return;
        }
        loading = true;
        table.setLoading(true);
        summaryEl.textContent = 'جارٍ التجميع…';
        q('#v2cost-from').disabled = true;
        q('#v2cost-to').disabled = true;
        q('[data-v2-reload]').disabled = true;
        q('[data-v2-month]').disabled = true;
        try {
            const [result, cur] = await Promise.all([
                fetchCostAnalysis(from, to),
                fetchCurrency().catch(() => ''),
            ]);
            if (!el.isConnected) {return;}          // destroyed while in flight
            currency = String(cur ?? '');
            rows = withMargin(Array.isArray(result && result.rows) ? result.rows : []);
            categories = Array.isArray(result && result.categories) ? result.categories : [];
            totals = result && result.totals ? result.totals : null;
            if (!totals) {throw new Error('استجابة تحليل التكاليف غير مكتملة من الخادم');}
            paint();
        } catch (e) {
            if (!el.isConnected) {return;}
            totals = null;
            rows = [];
            categories = [];
            paint();
            summaryEl.textContent = '';
            table.setError(e && e.message === 'UNAUTHORIZED'
                ? 'انتهت الجلسة — سجّل الدخول في النظام الحالي ثم أعد فتح الوضع الحيّ.'
                : (e && e.code === 'FORBIDDEN'
                    ? 'لا صلاحية لعرض تحليل التكاليف بهذا الحساب.'
                    : `تعذّر حساب التحليل: ${(e && e.message) || 'خطأ'}`));
        } finally {
            loading = false;
            if (el.isConnected) {
                q('#v2cost-from').disabled = false;
                q('#v2cost-to').disabled = false;
                q('[data-v2-reload]').disabled = false;
                q('[data-v2-month]').disabled = false;
            }
        }
    }

    el.addEventListener('click', (event) => {
        if (event.target.closest('[data-v2-month]')) {
            q('#v2cost-from').value = firstOfMonth();
            q('#v2cost-to').value = riyadhToday();
            reload();
            return;
        }
        if (event.target.closest('[data-v2-print]')) {
            printSheet(event.target.closest('[data-v2-print]'));
            return;
        }
        if (event.target.closest('[data-v2-reload]')) {reload(); return;}
        if (event.target.closest('[data-erp-retry]')) {reload();}
    });
    el.addEventListener('change', (event) => {
        if (event.target.matches('#v2cost-from, #v2cost-to')) {reload();}
    });

    reload();

    return {
        el,
        reload,
        getTotals: () => totals,
        destroy() {
            table.destroy();
            el.remove();
        },
    };
}
