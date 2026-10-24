/**
 * V2 — مقارنة الصرف والمبيعات · تحليل ذكي (قراءة فقط)
 * ═══════════════════════════════════════════════════════════════════════
 * مطابقة ما صرفه المخزن مع ما بيع في الكاشيرية بالاسم — فروقات ونسب
 * وتنبيهات كما يحسبها الخادم (/yara-reports/wh-vs-pos)، مع بطاقات الملخص
 * السبعة، وأكبر 10 فروقات، وتقرير طباعة، وتصدير Excel بأعمدة القديم.
 * الصلاحية قرار الخادم.
 */

import { createDataTable } from '../data-display/data-table.js?v=4.9.151';
import { formatInt, formatQty } from '../data/reports-repo.js?v=4.9.151';
import { fetchWhVsPos, fetchItemSuggestions, arSearchIncludes, rangeError } from '../data/yara-reports-repo.js?v=4.9.151';
import { ensureXlsx } from '../vendor.js?v=4.9.151';
import { prepareReportWorkbook } from '../report-export.js?v=4.9.151';
import { openInAppReport } from '../report-viewer.js?v=4.9.151';

/** أسماء الحالات كما في تصدير القديم (features/wh-vs-pos.js:301). */
const STATUS_AR = {
    match: 'متطابق', sold_more: 'المبيع أكثر', issued_more: 'المصروف أكثر',
    pos_only: 'مباع فقط', wh_only: 'مصروف فقط',
};

const esc = (v) => String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const iso = (d) => {
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

function todayIso(offset = 0) {
    const d = new Date();
    d.setDate(d.getDate() + offset);
    return iso(d);
}

function monthStartIso() {
    const d = new Date();
    d.setDate(1);
    return iso(d);
}

function weekStartIso() {
    const d = new Date();
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    return iso(d);
}

function formatMoney(v) {
    return (Number(v) || 0).toLocaleString('ar-EG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const signed = (v) => `${Number(v) > 0 ? '+' : ''}${formatQty(v)}`;
const signedPct = (v) => `${Number(v) > 0 ? '+' : ''}${Number(v) || 0}%`;

function template(from, to) {
    return `
      <div class="erp-v2-wv">
        <div class="erp-dash-head">
          <div>
            <h2 class="erp-dash-title">مقارنة الصرف والمبيعات <span class="erp-eyebrow">— تحليل ذكي</span></h2>
            <div class="erp-dash-sub" data-v2-scope-line role="status" aria-live="polite"></div>
          </div>
          <div class="erp-dash-controls">
            <span class="erp-badge" data-tone="success" data-v2-live><i class="ji" data-i="activity" aria-hidden="true"></i> مباشر</span>
            <span class="erp-text-sm erp-text-muted">آخر تحديث: <b data-v2-stamp>—</b></span>
            <button type="button" class="erp-btn erp-btn--primary erp-btn--sm erp-no-print" data-v2-reload>
              <i class="ji" data-i="search" aria-hidden="true"></i><span>استعلام</span>
            </button>
            <button type="button" class="erp-btn erp-btn--sm erp-no-print" data-v2-print>
              <i class="ji" data-i="printer" aria-hidden="true"></i><span>طباعة</span>
            </button>
            <button type="button" class="erp-btn erp-btn--sm erp-no-print" data-v2-excel>
              <i class="ji" data-i="inbox" aria-hidden="true"></i><span>Excel</span>
            </button>
          </div>
        </div>

        <div class="erp-filterbar erp-no-print">
          <label class="erp-text-sm erp-text-muted" for="v2wv-from">من</label>
          <input class="erp-input erp-input--ltr" id="v2wv-from" type="date" value="${esc(from)}">
          <label class="erp-text-sm erp-text-muted" for="v2wv-to">إلى</label>
          <input class="erp-input erp-input--ltr" id="v2wv-to" type="date" value="${esc(to)}" max="${esc(todayIso(0))}">
          <span class="erp-seg" role="group" aria-label="فترة مسبقة">
            <button type="button" data-v2-preset="today">اليوم</button>
            <button type="button" data-v2-preset="yesterday">أمس</button>
            <button type="button" data-v2-preset="week">هذا الأسبوع</button>
            <button type="button" data-v2-preset="month" class="is-active">هذا الشهر</button>
            <button type="button" data-v2-preset="7">آخر 7 أيام</button>
            <button type="button" data-v2-preset="30">آخر 30 يوم</button>
          </span>
          <label class="erp-text-sm erp-text-muted" style="display:inline-flex;gap:4px;align-items:center">
            <input type="checkbox" data-v2-diffonly> المختلفة فقط
          </label>
          <label class="erp-text-sm erp-text-muted" for="v2wv-item">بحث صنف</label>
          <span style="position:relative;min-inline-size:180px">
            <input class="erp-input" id="v2wv-item" type="search" placeholder="مثال: أرز، شاورما…" autocomplete="off">
            <div data-v2-suggest style="display:none;position:absolute;top:100%;inset-inline:0;background:var(--erp-surface,#fff);border:1px solid var(--erp-border,#ddd);border-radius:0 0 8px 8px;max-height:200px;overflow-y:auto;z-index:var(--erp-z-drawer,50);box-shadow:0 8px 20px rgba(0,0,0,.12)"></div>
          </span>
          <label class="erp-text-sm erp-text-muted" style="display:inline-flex;gap:4px;align-items:center">
            <input type="checkbox" data-v2-auto checked> تحديث تلقائي <span class="erp-text-sm erp-text-muted" data-v2-countdown></span>
          </label>
        </div>

        <div data-v2-kpis></div>
        <div data-v2-alerts></div>
        <div data-v2-chart></div>

        <section class="erp-card">
          <div class="erp-card__head">
            <h3 class="erp-card__title">المقارنة التفصيلية
              <span class="erp-eyebrow" dir="ltr" lang="en">Comparison</span>
              <span class="erp-text-muted erp-text-sm" data-v2-count></span>
            </h3>
          </div>
          <div class="erp-card__body erp-stack">
            <p class="erp-text-sm" data-v2-fresh hidden></p>
            <div data-v2-table></div>
          </div>
        </section>
      </div>`;
}

export function mountWhVsPosScreen(host, ctx = {}) {
    let rows = [];
    let summary = null;
    let loading = false;
    let exporting = false;
    let suggestTimer = null;
    let suggestSeq = 0;
    let autoTimer = null;
    let autoLeft = 0;
    let filterText = '';
    let diffOnly = false;
    const notify = typeof ctx.notify === 'function' ? ctx.notify : (m) => console.info('[V2 wh-vs-pos]', m);

    host.insertAdjacentHTML('beforeend', template(monthStartIso(), todayIso(0)));
    const el = host.lastElementChild;
    const q = (sel) => el.querySelector(sel);
    const scopeLine = q('[data-v2-scope-line]');
    const kpisHost = q('[data-v2-kpis]');
    const alertsHost = q('[data-v2-alerts]');
    const chartHost = q('[data-v2-chart]');
    const freshEl = q('[data-v2-fresh]');

    const table = createDataTable({
        caption: 'مقارنة الصرف والمبيعات — بيانات حية', mode: 'client', pageSize: 20, stickyHeader: true,
        emptyMessage: 'لا مطابقة في هذا المدى', emptyHint: 'وسّع المدى أو تحقق من مزامنة المرآة.',
        rowKey: (r, i) => `${i}`,
        columns: [
            { key: 'label', header: 'الصنف', sortable: true, filterable: true,
                render: (r) => esc(r.label) + (r.code ? `<span class="erp-mini__sub erp-mono" dir="ltr">${esc(r.code)}</span>` : '') },
            { key: 'wh_qty', header: 'مصروف من المخزن', type: 'number', width: '150px', align: 'end', value: (r) => r.wh_qty,
                render: (r) => `<span class="erp-num" dir="ltr">${formatQty(r.wh_qty)}</span>`
                    + (r.wh_docs ? `<span class="erp-mini__sub">${formatInt(r.wh_docs)} إذن</span>` : '') },
            { key: 'pos_qty', header: 'مبيع بالكاشيرية', type: 'number', width: '160px', align: 'end', value: (r) => r.pos_qty,
                render: (r) => `<span class="erp-num" dir="ltr">${formatQty(r.pos_qty)}</span>`
                    + (r.pos_invoices ? `<span class="erp-mini__sub">${formatInt(r.pos_invoices)} فاتورة</span>` : '') },
            { key: 'diff', header: 'الفرق', type: 'number', width: '110px', align: 'end', value: (r) => r.diff,
                render: (r) => `<span class="erp-num ${r.diff > 0 ? 'erp-text-danger' : (r.diff < 0 ? 'erp-text-warning' : '')}" dir="ltr">${signed(r.diff)}</span>` },
            { key: 'pct', header: 'النسبة', width: '100px', align: 'end', value: (r) => (r.pct == null ? 0 : r.pct),
                render: (r) => (r.pct == null ? `<span class="erp-text-muted">—</span>`
                    : `<span class="erp-num ${r.pct > 50 ? 'erp-text-danger' : (r.pct > 10 ? 'erp-text-warning' : '')}" dir="ltr">${signedPct(r.pct)}</span>`) },
            { key: 'pos_gross', header: 'قيمة المبيع', type: 'number', width: '150px', align: 'end', value: (r) => r.pos_gross,
                render: (r) => `<span class="erp-num" dir="ltr">${formatMoney(r.pos_gross)}</span>` },
            { key: 'status', header: 'الحالة', width: '130px', render: (r) => statusBadge(r.status) },
        ],
    });
    q('[data-v2-table]').appendChild(table.el);

    /** الصفوف المعروضة: بحث عربي متسامح + «المختلفة فقط» — نفس قاعدة القديم. */
    function visibleRows() {
        const term = String(filterText || '').trim();
        return rows.filter((r) => (!diffOnly || r.diff !== 0)
            && (!term || arSearchIncludes(r.label, term) || arSearchIncludes(r.code, term)));
    }

    function statusBadge(status) {
        const map = {
            match: ['success', '✓ متطابق'],
            sold_more: ['danger', 'المبيع أكثر'],
            issued_more: ['warning', 'المصروف أكثر'],
            pos_only: ['info', 'مباع فقط'],
            wh_only: ['warning', 'مصروف فقط'],
        };
        const found = map[status];
        if (!found) {return `<span class="erp-text-muted">${esc(status || '—')}</span>`;}
        return `<span class="erp-badge" data-tone="${found[0]}">${esc(found[1])}</span>`;
    }

    function summarizeRows(list) {
        const out = {
            total_items: list.length, matched: 0, sold_more: 0, issued_more: 0,
            pos_only: 0, wh_only: 0, total_pos_gross: 0,
        };
        for (const r of list) {
            if (Object.prototype.hasOwnProperty.call(out, r.status)) {out[r.status] += 1;}
            out.total_pos_gross += Number(r.pos_gross) || 0;
        }
        out.total_pos_gross = Math.round(out.total_pos_gross * 100) / 100;
        return out;
    }

    function kpiHtml(s) {
        const cards = [
            { icon: 'clipboard-list', label: 'إجمالي الأصناف', value: formatInt(s.total_items) },
            { icon: 'circle-check', label: '✓ متطابقة', value: formatInt(s.matched), tone: 'success' },
            { icon: 'trending-up', label: 'المبيعات أكثر', value: formatInt(s.sold_more), tone: 'danger' },
            { icon: 'trending-down', label: 'المصروف أكثر', value: formatInt(s.issued_more), tone: 'warning' },
            { icon: 'receipt', label: 'مباع فقط', value: formatInt(s.pos_only) },
            { icon: 'package', label: 'مصروف فقط', value: formatInt(s.wh_only) },
            { icon: 'banknote', label: 'إجمالي المبيعات', value: formatMoney(s.total_pos_gross) },
        ];
        return `<ul class="erp-kpis" aria-label="ملخص المقارنة">`
            + cards.map((k) => `<li class="erp-kpi">
                <div class="erp-kpi__top"><span class="erp-kpi__icon" aria-hidden="true"><i class="ji" data-i="${k.icon}"></i></span>
                <span class="erp-kpi__label">${esc(k.label)}</span></div>
                <div class="erp-kpi__value"><span class="erp-num${k.tone ? ` erp-text-${k.tone}` : ''}" dir="ltr">${k.value}</span></div>
              </li>`).join('') + `</ul>`;
    }

    function alertsHtml() {
        const sold = rows.filter((r) => r.status === 'sold_more' && Math.abs(r.diff) >= 10).slice(0, 5);
        const issued = rows.filter((r) => r.status === 'issued_more' && Math.abs(r.diff) >= 10).slice(0, 3);
        if (!sold.length && !issued.length) {return '';}
        const line = (tone, icon, name, text) => `<li class="erp-text-sm" style="display:flex;align-items:center;gap:var(--erp-space-2);padding:var(--erp-space-2) var(--erp-space-3);border-radius:var(--erp-radius-sm);background:var(--erp-${tone}-soft);border-inline-start:3px solid var(--erp-${tone})">
            <i class="ji" data-i="${icon}" style="color:var(--erp-${tone})" aria-hidden="true"></i>
            <span><b>${esc(name)}</b> ${text}</span>
          </li>`;
        const items = [
            ...sold.map((m) => line('danger', 'alert-triangle', m.label,
                `باعوا ${formatQty(m.pos_qty)} بس صُرف ${formatQty(m.wh_qty)} — فرق <b>${formatQty(m.diff)}</b> (${signedPct(m.pct)})`)),
            ...issued.map((m) => line('warning', 'alert-triangle', m.label,
                `صُرف ${formatQty(m.wh_qty)} بس باعوا ${formatQty(m.pos_qty)} — فرق <b>${formatQty(Math.abs(m.diff))}</b>`)),
        ];
        return `<ul class="erp-stack" aria-label="تنبيهات الفروقات">${items.join('')}</ul>`;
    }

    function chartHtml() {
        const top = rows.filter((r) => r.status !== 'match').slice(0, 10);
        if (!top.length) {return '';}
        const maxVal = Math.max(...top.map((r) => Math.max(r.wh_qty, r.pos_qty)), 1);
        const bar = (qty, tone) => `<span style="display:block;block-size:8px;border-radius:999px;background:var(--erp-${tone});inline-size:${Math.min((Number(qty) / maxVal) * 100, 100)}%"></span>`;
        return `<section class="erp-card">
            <div class="erp-card__head">
              <h3 class="erp-card__title">أكبر 10 فروقات <span class="erp-eyebrow" dir="ltr" lang="en">Top 10</span></h3>
              <span class="erp-text-sm erp-text-muted"><span style="color:var(--erp-success)">■</span> مصروف &nbsp; <span style="color:var(--erp-danger)">■</span> مبيع</span>
            </div>
            <div class="erp-card__body erp-stack">
              ${top.map((r) => `<div style="display:grid;grid-template-columns:minmax(120px,180px) 1fr auto;gap:var(--erp-space-2);align-items:center">
                <span class="erp-text-sm" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(r.label)}">${esc(r.label)}</span>
                <span class="erp-stack" style="gap:2px">${bar(r.wh_qty, 'success')}${bar(r.pos_qty, 'danger')}</span>
                <span class="erp-num erp-text-sm ${r.diff > 0 ? 'erp-text-danger' : (r.diff < 0 ? 'erp-text-warning' : '')}" dir="ltr">${signed(r.diff)}</span>
              </div>`).join('')}
            </div>
          </section>`;
    }

    function paint() {
        const f = filters();
        scopeLine.textContent = `${f.from} ← ${f.to}`;
        kpisHost.innerHTML = kpiHtml(summary || summarizeRows(rows));
        alertsHost.innerHTML = alertsHtml();
        chartHost.innerHTML = chartHtml();
        const shown = visibleRows();
        table.setRows(shown);
        q('[data-v2-count]').textContent = shown.length
            ? `(${formatInt(shown.length)}${shown.length !== rows.length ? ` من ${formatInt(rows.length)}` : ''})`
            : '';
    }

    /* ── الفترات المسبقة / بحث الصنف / التحديث التلقائي (وظائف القديم) ── */

    function applyPreset(key) {
        const map = {
            today: [todayIso(0), todayIso(0)],
            yesterday: [todayIso(-1), todayIso(-1)],
            week: [weekStartIso(), todayIso(0)],
            month: [monthStartIso(), todayIso(0)],
            7: [todayIso(-6), todayIso(0)],
            30: [todayIso(-29), todayIso(0)],
        };
        const range = map[String(key)];
        if (!range) {return;}
        q('#v2wv-from').value = range[0];
        q('#v2wv-to').value = range[1];
        el.querySelectorAll('[data-v2-preset]').forEach((b) => {
            const on = b.dataset.v2Preset === String(key);
            b.classList.toggle('is-active', on);
            b.setAttribute('aria-pressed', on ? 'true' : 'false');
        });
        reload();
    }

    function hideSuggest() {
        const box = q('[data-v2-suggest]');
        if (box) {box.style.display = 'none'; box.innerHTML = '';}
    }

    async function suggestItems(term) {
        const box = q('[data-v2-suggest]');
        if (!box) {return;}
        if (String(term).trim().length < 2) {hideSuggest(); return;}
        const seq = ++suggestSeq;
        let list;
        try {
            list = await fetchItemSuggestions(term);
        } catch (_) {
            list = [];
        }
        if (seq !== suggestSeq || !el.isConnected) {return;}   // آخر كتابة تفوز
        if (!list.length) {hideSuggest(); return;}
        box.innerHTML = list.slice(0, 12).map((name) => `<button type="button" class="erp-btn erp-btn--sm erp-btn--ghost" data-v2-suggest-item="${esc(name)}" style="display:block;inline-size:100%;text-align:start">${esc(name)}</button>`).join('');
        box.style.display = 'block';
    }

    function stopAuto() {
        if (autoTimer) {clearInterval(autoTimer); autoTimer = null;}
        autoLeft = 0;
        const c = q('[data-v2-countdown]');
        if (c) {c.textContent = '';}
    }

    function startAuto() {
        stopAuto();
        autoLeft = 60;
        const tick = () => {
            if (!el.isConnected) {stopAuto(); return;}
            const c = q('[data-v2-countdown]');
            if (c) {c.textContent = `(${autoLeft}s)`;}
            if (autoLeft <= 0) {
                autoLeft = 60;
                reload();                       // القراءة التالية لا تنتظر النقرة
                return;
            }
            autoLeft -= 1;
        };
        tick();
        autoTimer = setInterval(tick, 1000);
    }

    function filters() {
        return { from: q('#v2wv-from').value, to: q('#v2wv-to').value };
    }

    function stampRefresh(liveSynced, lastSyncAt) {
        const stamp = q('[data-v2-stamp]');
        if (stamp) {stamp.textContent = new Date().toLocaleTimeString('ar-EG');}
        const live = q('[data-v2-live]');
        if (live) {
            live.innerHTML = `<i class="ji" data-i="activity" aria-hidden="true"></i> ${liveSynced ? 'تمت المزامنة الآن' : 'مباشر'}`;
        }
        freshEl.hidden = !lastSyncAt;
        if (lastSyncAt) {
            const when = new Date(lastSyncAt);
            freshEl.textContent = `آخر مزامنة للمرآة: ${Number.isNaN(when.getTime()) ? lastSyncAt : when.toLocaleString('ar-EG')}`;
        }
    }

    /** نفس أعمدة وأسماء ملف القديم — تُحمَّل المكتبة عند أول تصدير فقط. */
    async function exportExcel() {
        if (exporting) {return;}
        exporting = true;
        try {
            const ready = await ensureXlsx();
            if (!ready || typeof window.XLSX === 'undefined') {
                notify('مكتبة Excel غير محمّلة — حدّث الصفحة');
                return;
            }
            const f = filters();
            const data = [['الصنف', 'مصروف من المخزن', 'مبيع بالكاشيرية', 'الفرق', 'النسبة %',
                'قيمة المبيع الصافي', 'قيمة المبيع الإجمالي', 'عدد الأذونات', 'عدد الفواتير', 'القسم', 'الحالة']];
            const exported = visibleRows();
            exported.forEach((r) => data.push([
                r.label, r.wh_qty, r.pos_qty, r.diff, r.pct == null ? '' : r.pct,
                r.pos_net, r.pos_gross, r.wh_docs, r.pos_invoices, r.dept, STATUS_AR[r.status] || r.status,
            ]));
            const ws = window.XLSX.utils.aoa_to_sheet(data);
            const wb = window.XLSX.utils.book_new();
            window.XLSX.utils.book_append_sheet(wb, ws, 'المقارنة');
            prepareReportWorkbook(window.XLSX, wb, `تقرير المخزن مع الكاشيرية ${f.from} إلى ${f.to}`);
            window.XLSX.writeFile(wb, `wh-vs-pos_${f.from}_${f.to}.xlsx`);
            notify('تم تصدير Excel');
        } finally {
            exporting = false;
        }
    }

    function printReport() {
        const s = summary || summarizeRows(rows);
        const f = filters();
        const list = visibleRows();
        const w = openInAppReport('تقرير مقارنة الصرف والمبيعات');
        const bodyRows = list.map((r, i) => `<tr>
            <td>${i + 1}</td><td style="text-align:start">${esc(r.label)}</td>
            <td>${formatQty(r.wh_qty)}</td><td>${formatQty(r.pos_qty)}</td>
            <td>${signed(r.diff)}</td><td>${signedPct(r.pct)}</td>
            <td>${formatMoney(r.pos_gross)}</td><td>${esc(STATUS_AR[r.status] || r.status)}</td>
          </tr>`).join('');
        w.document.write(`<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="UTF-8"><title>تقرير مقارنة الصرف والمبيعات</title>
          <style>body{font-family:'Cairo',Tahoma,sans-serif;padding:36px;color:#111}h1{text-align:center;font-size:22px}h2{text-align:center;color:#666;font-size:14px;margin-bottom:12px}
          .summary{display:flex;gap:12px;justify-content:center;flex-wrap:wrap;margin-bottom:14px}.summary div{border:1px solid #999;padding:8px 16px;border-radius:6px;font-size:13px}
          table{width:100%;border-collapse:collapse;font-size:12px}th,td{border:1px solid #999;padding:5px;text-align:center}th{background:#0f172a;color:#f5d76e}
          p.note{text-align:center;margin-top:14px;font-size:12px;color:#777}</style></head><body>
          <h1>تقرير مقارنة الصرف والمبيعات</h1>
          <h2>مطاعم الشرفه العالمي · من ${esc(f.from)} إلى ${esc(f.to)}${filterText ? ' · بحث: ' + esc(filterText) : ''}</h2>
          <div class="summary">
            <div>الأصناف: <b>${formatInt(s.total_items)}</b></div>
            <div>متطابقة: <b style="color:#16a34a">${formatInt(s.matched)}</b></div>
            <div>مباع أكثر: <b style="color:#dc2626">${formatInt(s.sold_more)}</b></div>
            <div>مصروف أكثر: <b style="color:#d97706">${formatInt(s.issued_more)}</b></div>
            <div>مباع فقط: <b>${formatInt(s.pos_only)}</b></div>
            <div>مصروف فقط: <b>${formatInt(s.wh_only)}</b></div>
          </div>
          <table><thead><tr><th>#</th><th>الصنف</th><th>مصروف</th><th>مبيع</th><th>الفرق</th><th>النسبة</th><th>قيمة المبيع</th><th>الحالة</th></tr></thead>
          <tbody>${bodyRows}</tbody></table>
          <p class="note">تاريخ الطباعة: ${new Date().toLocaleString('ar-EG')}</p>
          </body></html>`);
        w.document.close();
        w.focus();
    }

    async function reload() {
        if (loading) {return;}
        const f = filters();
        const gate = rangeError(f.from, f.to);
        if (!gate.ok) {
            rows = []; summary = null; table.setRows([]); kpisHost.innerHTML = '';
            alertsHost.innerHTML = ''; chartHost.innerHTML = '';
            scopeLine.textContent = gate.message;
            table.setError(gate.message);
            return;
        }
        loading = true;
        table.setLoading(true);
        try {
            const data = await fetchWhVsPos(f);
            if (!el.isConnected) {return;}
            const raw = Array.isArray(data.rows) ? data.rows
                : (Array.isArray(data.comparison) ? data.comparison : []);
            rows = raw.map((r) => ({
                label: String(r.item_name || r.name || r.name_ar || '—'),
                code: r.item_code ? String(r.item_code) : '',
                wh_qty: Number(r.wh_qty ?? r.warehouse_qty) || 0,
                pos_qty: Number(r.pos_qty ?? r.sales_qty) || 0,
                diff: Number(r.diff ?? r.difference) || 0,
                pct: r.pct == null ? null : Number(r.pct),
                alert: r.alert || r.severity_label || '',
                // حقول تصدير القديم (features/wh-vs-pos.js:299) — تُحفظ ولا تُعرض
                status: r.status ? String(r.status) : '',
                pos_net: Number(r.pos_net) || 0,
                pos_gross: Number(r.pos_gross) || 0,
                wh_docs: Number(r.wh_docs) || 0,
                pos_invoices: Number(r.pos_invoices) || 0,
                dept: r.dept ? String(r.dept) : '',
            }));
            summary = data.summary && typeof data.summary === 'object'
                ? {
                    total_items: Number(data.summary.total_items) || 0,
                    matched: Number(data.summary.matched) || 0,
                    sold_more: Number(data.summary.sold_more) || 0,
                    issued_more: Number(data.summary.issued_more) || 0,
                    pos_only: Number(data.summary.pos_only) || 0,
                    wh_only: Number(data.summary.wh_only) || 0,
                    total_pos_gross: Number(data.summary.total_pos_gross) || 0,
                }
                : summarizeRows(rows);
            stampRefresh(!!data.liveSynced, data.lastSyncAt || '');
            paint();
        } catch (e) {
            if (!el.isConnected) {return;}
            rows = []; summary = null;
            table.setRows([]);
            kpisHost.innerHTML = '';
            alertsHost.innerHTML = '';
            chartHost.innerHTML = '';
            q('[data-v2-count]').textContent = '';
            table.setError(e && e.message === 'UNAUTHORIZED'
                ? 'انتهت الجلسة — سجّل الدخول في النظام الحالي ثم أعد فتح الوضع الحيّ.'
                : `تعذّر التحميل: ${(e && e.message) || 'خطأ'}`);
        } finally {
            loading = false;
        }
    }

    el.addEventListener('click', (event) => {
        const preset = event.target.closest('[data-v2-preset]');
        if (preset) {applyPreset(preset.dataset.v2Preset); return;}
        const sug = event.target.closest('[data-v2-suggest-item]');
        if (sug) {
            const name = sug.dataset.v2SuggestItem || '';
            q('#v2wv-item').value = name;
            filterText = name;
            hideSuggest();
            paint();
            return;
        }
        if (!event.target.closest('[data-v2-suggest]') && !event.target.closest('#v2wv-item')) {hideSuggest();}
        if (event.target.closest('[data-v2-reload]')) {reload(); return;}
        if (event.target.closest('[data-v2-excel]')) {exportExcel(); return;}
        if (event.target.closest('[data-v2-print]')) {printReport(); return;}
        if (event.target.closest('[data-erp-retry]')) {reload();}
    });
    el.addEventListener('input', (event) => {
        if (!event.target.matches('#v2wv-item')) {return;}
        filterText = event.target.value;
        paint();                                  // فلترة فورية على المعروض
        if (suggestTimer) {clearTimeout(suggestTimer);}
        suggestTimer = setTimeout(() => suggestItems(filterText), 250);
    });
    el.addEventListener('change', (event) => {
        if (event.target.matches('#v2wv-from, #v2wv-to')) {reload(); return;}
        if (event.target.matches('[data-v2-diffonly]')) {diffOnly = !!event.target.checked; paint(); return;}
        if (event.target.matches('[data-v2-auto]')) {
            if (event.target.checked) {startAuto();} else {stopAuto();}
        }
    });

    reload();
    startAuto();

    return {
        el,
        reload,
        getRows: () => rows,
        getVisibleRows: () => visibleRows(),
        destroy() {
            if (suggestTimer) {clearTimeout(suggestTimer);}
            stopAuto();
            table.destroy();
            el.remove();
        },
    };
}
