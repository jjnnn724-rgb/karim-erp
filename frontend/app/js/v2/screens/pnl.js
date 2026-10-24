/**
 * V2 — P&L screen · شاشة 18 في سجل الترحيل (قراءة فقط)
 * ═══════════════════════════════════════════════════════════════════════
 *
 * CONTRACT (backend/finance-routes.js — verified by exploration 2026-10-14)
 *   GET /finance/pnl?from=YYYY-MM-DD&to=YYYY-MM-DD →
 *     { period, previous_period, statement, comparison, generated_at,
 *       generated_by } (:632-639). Gate: requireRole admin|manager|
 *     accountant (:34,546). Both dates must come as a pair — a lone one
 *     is 400 INVALID_PERIOD (:548-574). Missing both → server defaults
 *     to current month..today, MAX_SPAN_DAYS=366.
 *   statement: revenue{pos_net,manual,total,pos_gross,vat_collected,
 *     pos_discounts,invoice_count,manual_count}, cogs{dispatch,returns,
 *     net,count}, gross_profit{amount,margin_pct},
 *     shrinkage{amount,count,losses,gains}, operating{items[{category,
 *     amount,count}],total,count}, payroll{total,count,months},
 *     net_profit{amount,margin_pct}, by_department[{code,name,revenue,
 *     manual,cogs,shrinkage,operating,net,margin_pct}], daily_series[
 *     {date,revenue,cogs,opex}], checks{balanced}.
 *   comparison: per key {current,previous,delta,pct}.
 *   The server builds it from 6 tables × 2 periods — V2 renders, never
 *   recomputes. All numbers come from recorded movements only (the same
 *   honesty line the legacy screen prints).
 *   No POST/PUT/DELETE — pure statement. Print = GET /finance/pnl/print
 *   (server-rendered HTML, same gate) opens in a new tab.
 *
 * Charts (trend + department bar) are drawn by js/v2/charts.js as SVG —
 * no Chart.js, no vendor file, no CSP change. The figures read the same
 * daily_series / by_department the tables read; nothing is recomputed.
 */

import { createDataTable } from '../data-display/data-table.js?v=4.9.151';
import { openInAppReport } from '../report-viewer.js?v=4.9.151';
import { lineChart, barChart } from '../charts.js?v=4.9.151';
import {
    fetchPnl, fetchPnlPrintHtml, PNL_PRESETS, pnlPresetRange,
} from '../data/finance-repo.js?v=4.9.151';
import { fetchCurrency, formatMoney, formatInt } from '../data/reports-repo.js?v=4.9.151';

const esc = (v) => String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const num = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
};

const round1 = (v) => Math.round((Number(v) || 0) * 10) / 10;

function money(v, currency) {
    const m = formatMoney(v, currency);
    return `<span class="erp-num" dir="ltr">${m.amount}</span>`
        + (m.hasUnit ? ` <span class="erp-text-sm erp-text-muted">${esc(m.unit)}</span>` : '');
}

function pct(v) {
    return `<span class="erp-num" dir="ltr">${round1(v)}%</span>`;
}

/** Comparison chip — same semantics as pnlCmpChip (finance.js:316-326). */
function cmpChip(comparison, key, label, goodWhenUp, currency) {
    const v = comparison && comparison[key];
    if (!v || v.previous == null) {return '';}
    const d = num(v.delta);
    const up = d > 0;
    const neutral = Math.abs(d) < 0.005;
    const good = neutral ? null : (up === goodWhenUp);
    const arrow = neutral ? '−' : (up ? '▲' : '▼');
    const pctTxt = v.pct == null || !Number.isFinite(Number(v.pct)) ? '' : ` (${round1(Math.abs(Number(v.pct)))}%)`;
    return `<span class="erp-badge" data-tone="${neutral ? 'neutral' : (good ? 'success' : 'danger')}">`
        + `${arrow} ${esc(label)} ${money(Math.abs(d), currency)}${pctTxt}</span>`;
}

/** بنية المعيار المصدّق (نفس عقد المطبخ): ul.erp-kpis > li.erp-kpi — لا ديفات. */
function kpiCard(label, valueHtml, subHtml, tone) {
    return `<li class="erp-kpi">
      <div class="erp-kpi__top"><span class="erp-kpi__label">${esc(label)}</span></div>
      <div class="erp-kpi__value">${valueHtml}</div>
      ${subHtml ? `<div class="erp-kpi__foot"><span class="${tone || 'erp-text-muted'} erp-text-xs">${subHtml}</span></div>` : ''}
    </li>`;
}

function template() {
    return `
      <section class="erp-card erp-v2-pnl">
        <div class="erp-card__head">
          <h3 class="erp-card__title">قائمة الدخل
            <span class="erp-eyebrow" dir="ltr" lang="en">Profit &amp; Loss</span>
          </h3>
          <span class="erp-grow"></span>
          <span data-v2-presets></span>
          <label class="erp-text-sm erp-text-muted" for="v2pnl-from">من</label>
          <input class="erp-input erp-input--ltr" id="v2pnl-from" type="date">
          <label class="erp-text-sm erp-text-muted" for="v2pnl-to">إلى</label>
          <input class="erp-input erp-input--ltr" id="v2pnl-to" type="date" max="${esc(pnlPresetRange('today')[1])}">
          <button type="button" class="erp-btn erp-btn--sm" data-v2-print-open>
            <i class="ji" data-i="printer" aria-hidden="true"></i><span>طباعة</span>
          </button>
          <button type="button" class="erp-btn erp-btn--primary erp-btn--sm" data-v2-reload>
            <i class="ji" data-i="refresh" aria-hidden="true"></i><span>تحديث</span>
          </button>
        </div>
        <div class="erp-card__body erp-stack">
          <p class="erp-text-sm erp-text-muted" data-v2-note role="status" aria-live="polite">
            كل الأرقام من حركات مسجّلة فعليًا (لا إدخال يدوي) —
            الخادم يبني القائمة من 6 جداول × فترتين، والواجهة تعرض ولا تعيد الحساب.
          </p>
          <ul class="erp-kpis" data-v2-kpis></ul>
          <div class="erp-v2-chart-grid" data-v2-charts></div>
          <div class="erp-stack" data-v2-detail></div>
        </div>
      </section>`;
}

/**
 * @param {ParentNode} host where the screen is inserted
 * @param {{role?: string|null, notify?: (message:string, kind?:string)=>void}} [ctx]
 * @returns {{el: HTMLElement, reload: ()=>Promise<void>, getData: ()=>object|null, destroy: ()=>void}}
 */
export function mountPnlScreen(host, ctx = {}) {
    let data = null;
    let currency = '';
    let loading = false;
    let preset = 'thismonth';

    const [pFrom, pTo] = pnlPresetRange('thismonth');
    host.insertAdjacentHTML('beforeend', template());
    const el = host.lastElementChild;
    const q = (sel) => el.querySelector(sel);
    const kpisEl = q('[data-v2-kpis]');
    const chartsEl = q('[data-v2-charts]');
    const detailEl = q('[data-v2-detail]');
    const noteEl = q('[data-v2-note]');
    const fromEl = q('#v2pnl-from');
    const toEl = q('#v2pnl-to');
    fromEl.value = pFrom;
    toEl.value = pTo;

    function paintPresets() {
        q('[data-v2-presets]').innerHTML = `<span class="erp-seg" role="group" aria-label="فترة سريعة">`
            + PNL_PRESETS.filter(([k]) => k !== 'custom').map(([k, label]) => `<button type="button" data-v2-preset="${k}"`
                + `${k === preset ? ' class="is-active" aria-pressed="true"' : ' aria-pressed="false"'}>${esc(label)}</button>`).join('')
            + `</span>`;
    }

    const statementTable = () => {
        const st = data.statement || {};
        const rev = st.revenue || {};
        const cogs = st.cogs || {};
        const gp = st.gross_profit || {};
        const sh = st.shrinkage || {};
        const op = st.operating || {};
        const pr = st.payroll || {};
        const np = st.net_profit || {};
        const ofRev = (v) => (num(rev.total) > 0 ? pct((num(v) / num(rev.total)) * 100) : '—');
        const rows = [
            ['مبيعات الكاشير (صافي)', money(rev.pos_net, currency), ofRev(rev.pos_net)],
            ['إجمالي المبيعات (قبل الخصم)', money(rev.pos_gross, currency), ''],
            ['الإيرادات اليدوية/الأخرى', money(rev.manual, currency), ofRev(rev.manual)],
            ['إجمالي الإيرادات', money(rev.total, currency), '100%'],
            ['خصومات المبيعات', money(rev.pos_discounts, currency), ''],
            ['ضريبة القيمة المضافة المحصلة', money(rev.vat_collected, currency), ''],
            ['صرف مخزون مواد للأقسام', money(cogs.dispatch, currency), ''],
            ['مرتجعات الصرف (داخل COGS)', money(cogs.returns, currency), ''],
            ['تكلفة المواد الصافية (COGS)', money(cogs.net, currency), ofRev(cogs.net)],
            ['مجمل الربح', money(gp.amount, currency), pct(num(gp.margin_pct))],
            ['فروق الجرد', money(sh.amount, currency), ''],
            ['مصاريف تشغيلية', money(op.total, currency), ofRev(op.total)],
            ['الرواتب والأجور', money(pr.total, currency), ofRev(pr.total)],
            ['صافي الربح التشغيلي', money(np.amount, currency), pct(num(np.margin_pct))],
        ];
        return `<table class="erp-table"><caption class="erp-sr-only">قائمة الدخل</caption>
          <thead><tr><th>البند</th><th class="erp-num-head">المبلغ</th><th>% من الإيراد</th></tr></thead>
          <tbody>${rows.map(([label, val, p]) => `<tr><td>${esc(label)}</td><td class="erp-tnum">${val}</td><td class="erp-tnum">${p}</td></tr>`).join('')}</tbody>
        </table>`;
    };

    const opItemsTable = () => {
        const items = (data.statement && data.statement.operating && data.statement.operating.items) || [];
        if (!items.length) {return '';}
        return `<table class="erp-table"><caption class="erp-sr-only">بنود المصروفات التشغيلية</caption>
          <thead><tr><th>التصنيف</th><th class="erp-num-head">المبلغ</th><th>عدد القيود</th></tr></thead>
          <tbody>${items.map((i) => `<tr><td>${esc(i.category || '—')}</td><td class="erp-tnum">${money(i.amount, currency)}</td><td class="erp-tnum">${formatInt(i.count)}</td></tr>`).join('')}</tbody>
        </table>`;
    };

    const deptTable = createDataTable({
        caption: 'ربحية الأقسام — بيانات حية',
        mode: 'client',
        pageSize: 50,
        stickyHeader: true,
        emptyMessage: 'لا توجد أقسام في هذه الفترة',
        rowKey: (row) => row.code,
        columns: [
            { key: 'name', header: 'القسم', sortable: true, filterable: true },
            { key: 'revenue', header: 'الإيرادات', type: 'number', sortable: true, align: 'end', value: (r) => num(r.revenue), render: (r) => money(r.revenue, currency) },
            { key: 'cogs', header: 'تكلفة المواد', type: 'number', sortable: true, align: 'end', value: (r) => num(r.cogs), render: (r) => money(r.cogs, currency) },
            { key: 'shrinkage', header: 'فروق الجرد', type: 'number', sortable: true, align: 'end', value: (r) => num(r.shrinkage), render: (r) => money(r.shrinkage, currency) },
            { key: 'operating', header: 'تشغيلية', type: 'number', sortable: true, align: 'end', value: (r) => num(r.operating), render: (r) => money(r.operating, currency) },
            {
                key: 'net', header: 'الصافي', type: 'number', sortable: true, align: 'end', value: (r) => num(r.net),
                render: (r) => (num(r.net) >= 0 ? money(r.net, currency) : `<span class="erp-text-danger">${money(r.net, currency)}</span>`),
            },
            { key: 'margin_pct', header: 'الهامش', type: 'number', sortable: true, width: '110px', align: 'end', value: (r) => num(r.margin_pct), render: (r) => pct(r.margin_pct) },
        ],
    });

    function paint() {
        const st = data.statement || {};
        const rev = st.revenue || {};
        const cogs = st.cogs || {};
        const gp = st.gross_profit || {};
        const sh = st.shrinkage || {};
        const pr = st.payroll || {};
        const np = st.net_profit || {};
        const cmp = data.comparison || {};
        const balanced = st.checks ? st.checks.balanced !== false : true;

        kpisEl.innerHTML = [
            kpiCard('إجمالي الإيرادات', money(rev.total, currency),
                `${formatInt(rev.invoice_count)} فاتورة كاشير + ${formatInt(rev.manual_count)} إيراد يدوي ${cmpChip(cmp, 'revenue', 'إيراد', true, currency)}`),
            kpiCard('تكلفة المواد (COGS)', money(cogs.net, currency),
                `${pct(num(rev.total) > 0 ? (num(cogs.net) / num(rev.total)) * 100 : 0)} من الإيراد ${cmpChip(cmp, 'cogs', 'COGS', false, currency)}`),
            kpiCard('مجمل الربح', money(gp.amount, currency),
                `الهامش ${pct(num(gp.margin_pct))} ${cmpChip(cmp, 'gross_profit', 'مجمل', true, currency)}`),
            kpiCard('صافي الربح التشغيلي', money(np.amount, currency),
                `الهامش ${pct(num(np.margin_pct))} ${cmpChip(cmp, 'net_profit', 'الصافي', true, currency)}`,
                num(np.amount) >= 0 ? 'erp-text-success' : 'erp-text-danger'),
            kpiCard('فروق الجرد', money(sh.amount, currency),
                `${formatInt(sh.count)} حركة (خسائر ${money(sh.losses, currency)} · مكاسب ${money(sh.gains, currency)}) ${cmpChip(cmp, 'shrinkage', 'جرد', false, currency)}`),
            kpiCard('رواتب وأجور', money(pr.total, currency),
                `${formatInt(pr.count)} قيدًا · ${(pr.months || []).join('، ')} ${cmpChip(cmp, 'payroll', 'رواتب', false, currency)}`),
        ].join('');

        const daily = Array.isArray(st.daily_series) ? st.daily_series : [];
        const depts = Array.isArray(st.by_department) ? st.by_department : [];
        const moneyText = (v) => {
            const m = formatMoney(v, currency);
            return `${m.amount}${m.hasUnit ? ` ${m.unit}` : ''}`;
        };
        chartsEl.innerHTML = [
            lineChart({
                title: 'اتجاه الإيرادات والتكاليف',
                ariaLabel: 'خط الإيرادات وتكلفة المواد والمصاريف التشغيلية حسب اليوم',
                labels: daily.map((d) => String((d && d.date) || '').slice(5)),
                series: [
                    { label: 'الإيرادات', tone: 'success', values: daily.map((d) => d && d.revenue), fill: true },
                    { label: 'تكلفة المواد', tone: 'danger', values: daily.map((d) => d && d.cogs) },
                    { label: 'تكاليف أخرى', tone: 'warning', values: daily.map((d) => d && d.opex) },
                ],
                formatValue: moneyText,
                emptyText: 'لا حركات يومية في هذه الفترة',
            }),
            barChart({
                title: 'ربحية الأقسام',
                ariaLabel: 'أعمدة الإيرادات وتكلفة المواد وصافي الربح لكل قسم',
                labels: depts.map((d) => String((d && d.name) || '—')),
                series: [
                    { label: 'الإيرادات', tone: 'success', values: depts.map((d) => d && d.revenue) },
                    { label: 'تكلفة المواد', tone: 'danger', values: depts.map((d) => d && d.cogs) },
                    { label: 'الصافي', tone: 'brand', values: depts.map((d) => d && d.net) },
                ],
                formatValue: moneyText,
                emptyText: 'لا حركات أقسام في هذه الفترة',
            }),
        ].join('');
        const period = data.period || {};
        const prev = data.previous_period || {};
        detailEl.innerHTML = `
          <p class="erp-text-sm erp-text-muted">
            الفترة ${esc(period.from || '—')} → ${esc(period.to || '—')}
            · مقارنة بـ ${esc(prev.from || '—')} → ${esc(prev.to || '—')}
            · ${balanced ? '<span class="erp-badge" data-tone="success">التحقق متوازن</span>' : '<span class="erp-badge" data-tone="warning">فروق تحقّق</span>'}
          </p>
          ${statementTable()}
          ${opItemsTable()}
          <div data-v2-dept-table></div>`;

        detailEl.querySelector('[data-v2-dept-table]').appendChild(deptTable.el);
        deptTable.setRows(Array.isArray(st.by_department) ? st.by_department : []);
        noteEl.textContent = `الفترة ${period.from || '—'} → ${period.to || '—'} — كل الأرقام من حركات مسجّلة فعليًا (لا إدخال يدوي).`;
    }

    async function reload() {
        if (loading) {return;}
        loading = true;
        deptTable.setLoading(true);
        try {
            const [pnl, cur] = await Promise.all([
                fetchPnl(fromEl.value || undefined, toEl.value || undefined),
                fetchCurrency().catch(() => ''),
            ]);
            if (!el.isConnected) {return;}          // destroyed while in flight
            currency = String(cur ?? '');
            data = pnl;
            if (pnl && pnl.period) {
                fromEl.value = pnl.period.from || fromEl.value;
                toEl.value = pnl.period.to || toEl.value;
            }
            paint();
        } catch (e) {
            if (!el.isConnected) {return;}
            data = null;
            kpisEl.innerHTML = '';
            chartsEl.innerHTML = '';
            detailEl.innerHTML = '';
            deptTable.setRows([]);
            noteEl.textContent = e && e.message === 'UNAUTHORIZED'
                ? 'انتهت الجلسة — سجّل الدخول في النظام الحالي ثم أعد فتح الوضع الحيّ.'
                : (e && (e.code === 'FORBIDDEN' || e.status === 403)
                    ? 'لا صلاحية لعرض قائمة الدخل بهذا الحساب — القرار للنظام وحده.'
                    : `تعذّر تحميل قائمة الدخل: ${(e && e.message) || 'خطأ'}`);
        } finally {
            loading = false;
        }
    }

    /* Fetched with credentials, then handed to the viewer as text — an iframe
       src jump cannot carry the Authorization header the print route needs. */
    async function openPrintSheet(from, to) {
        try {
            const html = await fetchPnlPrintHtml(from, to);
            const viewer = openInAppReport('قائمة الأرباح والخسائر');
            viewer.document.write(html);
            viewer.document.close();
        } catch (e) {
            ctx.notify?.((e && e.message) || 'تعذر تجهيز المستند للطباعة', 'error');
        }
    }

    el.addEventListener('click', (event) => {
        const p = event.target.closest('[data-v2-preset]');
        if (p) {
            preset = p.getAttribute('data-v2-preset');
            const [f, t] = pnlPresetRange(preset);
            fromEl.value = f;
            toEl.value = t;
            paintPresets();
            reload();
            return;
        }
        if (event.target.closest('[data-v2-print-open]')) {
            openPrintSheet(fromEl.value, toEl.value);
            return;
        }
        if (event.target.closest('[data-v2-reload]')) {reload(); return;}
        if (event.target.closest('[data-erp-retry]')) {reload();}
    });
    el.addEventListener('change', (event) => {
        if (event.target.matches('#v2pnl-from, #v2pnl-to')) {
            preset = 'custom';
            paintPresets();
            reload();
        }
    });

    paintPresets();
    reload();

    return {
        el,
        reload,
        getData: () => data,
        destroy() {
            deptTable.destroy();
            el.remove();
        },
    };
}
