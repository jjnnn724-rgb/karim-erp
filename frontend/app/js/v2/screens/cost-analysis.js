/**
 * V2 — Cost analysis screen · شاشة 17 في سجل الترحيل (قراءة فقط)
 * ═══════════════════════════════════════════════════════════════════════
 *
 * LEGACY PARITY (features/finance.js:252-273 + auth-navigation.js:398-451)
 *   The legacy screen has NO endpoint — it is a pure computation over
 *   STATE.revenues + STATE.expenses + STATE.departments. V2 mirrors the
 *   SAME calculators (deptWithChildren / deptExpenseBreakdown /
 *   calcDeptStats live in v2/data/finance-repo.js, copied field-by-field)
 *   and fetches the three sources itself in parallel.
 *   Buckets per department: صرف مخزون (stock movement, net of returns via
 *   the Math.max(0, …) legacy rule) / فرق جرد (count_correction) /
 *   تشغيلية (the rest). KPI thresholds: <50 green, <75 orange, else red
 *   (finance.js:273).
 *   Charts (bar + pie) are drawn by js/v2/charts.js as SVG — no external
 *   library, no CSP change. The bar reads the same rows the table shows;
 *   the pie folds the same categories the legacy screen counted.
 *   Read gate on the sources: admin|manager|accountant|auditor.
 *
 * THIS SCREEN NEVER WRITES.
 */

import { createDataTable } from '../data-display/data-table.js?v=4.9.152';
import { barChart, donutChart } from '../charts.js?v=4.9.152';
import {
    fetchRevenues, fetchExpenses, fetchDepartments,
    buildCostRows, isoDay, firstOfMonth,
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

function moneyCell(v, currency, signed = false) {
    const m = formatMoney(v, currency);
    const cls = signed && Number(v) < 0 ? ' erp-text-success' : (signed && Number(v) > 0 ? ' erp-text-danger' : '');
    return `<span class="erp-num${cls}" dir="ltr">${m.amount}</span>`
        + (m.hasUnit ? ` <span class="erp-text-sm erp-text-muted">${esc(m.unit)}</span>` : '');
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

function template(from, to) {
    return `
      <section class="erp-card erp-v2-cost">
        <div class="erp-card__head">
          <h3 class="erp-card__title">تحليل التكاليف
            <span class="erp-eyebrow" dir="ltr" lang="en">Cost Analysis</span>
          </h3>
          <span class="erp-grow"></span>
          <label class="erp-text-sm erp-text-muted" for="v2cost-from">من</label>
          <input class="erp-input erp-input--ltr" id="v2cost-from" type="date" value="${esc(from)}">
          <label class="erp-text-sm erp-text-muted" for="v2cost-to">إلى</label>
          <input class="erp-input erp-input--ltr" id="v2cost-to" type="date" value="${esc(to)}" max="${esc(isoDay(0))}">
          <button type="button" class="erp-btn erp-btn--sm" data-v2-all>كل الفترة</button>
          <button type="button" class="erp-btn erp-btn--sm" data-v2-print aria-label="طباعة التحليل">
            <i class="ji" data-i="printer" aria-hidden="true"></i><span>طباعة</span>
          </button>
          <button type="button" class="erp-btn erp-btn--primary erp-btn--sm" data-v2-reload>
            <i class="ji" data-i="refresh" aria-hidden="true"></i><span>إعادة الحساب</span>
          </button>
        </div>
        <div class="erp-card__body erp-stack">
          <p class="erp-text-sm erp-text-muted">
            قراءة فقط — حساب محلي من نفس مصادر النظام
            (<span class="erp-addr" dir="ltr">/api/revenues</span> +
            <span class="erp-addr" dir="ltr">/api/expenses</span> +
            <span class="erp-addr" dir="ltr">/api/departments</span>)،
            بنفس قواعد التصنيف القديمة (شجرة الأقسام + صافي المرتجعات).
            لا يُطلب أي شيء من مسار كتابة. الرسوم SVG محلية بلا مكتبة خارجية.
          </p>
          <ul class="erp-kpis" data-v2-kpis></ul>
          <div class="erp-v2-chart-grid" data-v2-charts></div>
          <div data-v2-summary role="status" aria-live="polite" class="erp-text-sm erp-text-muted"></div>
          <div data-v2-table></div>
        </div>
      </section>`;
}

/**
 * @param {ParentNode} host where the screen is inserted
 * @param {{role?: string|null, notify?: (message:string, kind?:string)=>void}} [ctx]
 * @returns {{el: HTMLElement, reload: ()=>Promise<void>, getTotals: ()=>object|null, destroy: ()=>void}}
 */
export function mountCostAnalysisScreen(host, _ctx = {}) {
    let revenues = [];
    let expenses = [];
    let departments = [];
    let currency = '';
    let totals = null;
    let loading = false;

    host.insertAdjacentHTML('beforeend', template(firstOfMonth(), isoDay(0)));
    const el = host.lastElementChild;
    const q = (sel) => el.querySelector(sel);
    const kpisEl = q('[data-v2-kpis]');
    const chartsEl = q('[data-v2-charts]');
    const summaryEl = q('[data-v2-summary]');

    const table = createDataTable({
        caption: 'تكلفة الأقسام — بيانات حية',
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
                render: (row) => `<span class="erp-num ${costTone(row.costRatio)}" dir="ltr">${round1(row.costRatio)}%</span>`,
            },
            {
                key: 'profit', header: 'التقييم', sortable: true, width: '110px', align: 'center',
                value: (row) => row.profit,
                render: (row) => (row.profit >= 0
                    ? `<span class="erp-badge" data-tone="success">مربح</span>`
                    : `<span class="erp-badge" data-tone="danger">خاسر</span>`),
            },
        ],
    });

    q('[data-v2-table]').appendChild(table.el);

    function paintKpis(t) {
        kpisEl.innerHTML = [
            kpiCard('إجمالي الإيرادات', moneyCell(t.rev, currency), 'banknote'),
            kpiCard('إجمالي التكاليف', moneyCell(t.exp, currency), 'wallet'),
            kpiCard('متوسط نسبة التكلفة',
                `<span class="erp-num ${costTone(t.avgCost)}" dir="ltr">${round1(t.avgCost)}%</span>`, 'chart'),
            kpiCard('صرف مخزون (صافي المرتجعات)', moneyCell(t.mat, currency), 'package'),
            kpiCard('عجز / زيادة الجرد', moneyCell(t.cnt, currency, true), 'clipboard-list'),
            kpiCard('مصروفات تشغيلية', moneyCell(t.ops, currency), 'pen-tool'),
        ].join('');
    }

    function paint() {
        if (!departments.length) {
            summaryEl.textContent = 'لا توجد أقسام مسجلة.';
            kpisEl.innerHTML = '';
            chartsEl.innerHTML = '';
            table.setRows([]);
            return;
        }
        const from = q('#v2cost-from').value;
        const to = q('#v2cost-to').value;
        const { rows, totals: t } = buildCostRows(revenues, expenses, departments, from, to);
        totals = t;
        paintKpis(t);

        const inPeriod = (e) => {
            const d = String((e && e.date) || '').slice(0, 10);
            if (!d) {return false;}
            if (from && d < from) {return false;}
            if (to && d > to) {return false;}
            return true;
        };
        const categories = new Map();
        expenses.filter(inPeriod).forEach((e) => {
            const label = e && e.category ? String(e.category) : 'أخرى';
            categories.set(label, (categories.get(label) || 0) + num(e && e.amount));
        });
        const moneyText = (v) => {
            const m = formatMoney(v, currency);
            return `${m.amount}${m.hasUnit ? ` ${m.unit}` : ''}`;
        };
        chartsEl.innerHTML = [
            barChart({
                title: 'الإيرادات مقابل التكلفة حسب القسم',
                ariaLabel: 'أعمدة الإيرادات والتكلفة الإجمالية لكل قسم',
                labels: rows.map((r) => r.name),
                series: [
                    { label: 'الإيرادات', tone: 'success', values: rows.map((r) => r.rev) },
                    { label: 'التكلفة الإجمالية', tone: 'danger', values: rows.map((r) => r.exp) },
                ],
                formatValue: moneyText,
                emptyText: 'لا أقسام في هذه الفترة',
            }),
            donutChart({
                title: 'توزيع بنود التكلفة بالتصنيف',
                ariaLabel: 'رسم دائري لنسب تصنيفات المصروفات في الفترة',
                slices: [...categories.entries()].map(([label, value]) => ({ label, value })),
                centerLabel: 'إجمالي المصروفات',
                formatValue: moneyText,
                maxSlices: 8,
                emptyText: 'لا مصروفات في هذه الفترة',
            }),
        ].join('');

        summaryEl.textContent = `${formatInt(rows.length)} قسمًا`
            + `${from || to ? ` · الفترة ${from || 'البداية'} → ${to || 'اليوم'}` : ' · كل الفترات'}`
            + ' · الحساب محلي من الحركات المسجّلة فقط';
        table.setRows(rows);
    }

    async function reload() {
        if (loading) {return;}
        loading = true;
        table.setLoading(true);
        summaryEl.textContent = 'جارٍ تحميل المصادر…';
        try {
            const [revs, exps, deps, cur] = await Promise.all([
                fetchRevenues(), fetchExpenses(), fetchDepartments(),
                fetchCurrency().catch(() => ''),
            ]);
            if (!el.isConnected) {return;}          // destroyed while in flight
            currency = String(cur ?? '');
            revenues = revs;
            expenses = exps;
            departments = deps;
            paint();
        } catch (e) {
            if (!el.isConnected) {return;}
            totals = null;
            kpisEl.innerHTML = '';
            chartsEl.innerHTML = '';
            table.setRows([]);
            summaryEl.textContent = '';
            table.setError(e && e.message === 'UNAUTHORIZED'
                ? 'انتهت الجلسة — سجّل الدخول في النظام الحالي ثم أعد فتح الوضع الحيّ.'
                : (e && e.code === 'FORBIDDEN'
                    ? 'لا صلاحية لعرض تحليل التكاليف بهذا الحساب — القرار للخادم وحده.'
                    : `تعذّر حساب التحليل: ${(e && e.message) || 'خطأ'}`));
        } finally {
            loading = false;
        }
    }

    el.addEventListener('click', (event) => {
        if (event.target.closest('[data-v2-all]')) {
            q('#v2cost-from').value = '';
            q('#v2cost-to').value = '';
            paint();
            return;
        }
        if (event.target.closest('[data-v2-print]')) {window.print(); return;}
        if (event.target.closest('[data-v2-reload]')) {reload(); return;}
        if (event.target.closest('[data-erp-retry]')) {reload();}
    });
    el.addEventListener('change', (event) => {
        if (event.target.matches('#v2cost-from, #v2cost-to')) {paint();}
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
