/**
 * V2 — Received analyzer screen · ما استلمته الأقسام (قراءة فقط)
 * ═══════════════════════════════════════════════════════════════════════
 * سجلان: أذون الصرف المستلمة (قائمة) + الأصناف المستلمة مجمّعة
 * (بصنف/قسم/يوم)، وتحليل استهلاك ذكي (item-outflow) بملاحظاته وتنبيهاته.
 * كل باب من yara-reports-repo، والصلاحية قرار الخادم.
 */

import { createDataTable } from '../data-display/data-table.js?v=4.9.145';
import { formatInt } from '../data/reports-repo.js?v=4.9.145';
import {
    fetchReceivedItems, fetchReceivedDispatches, fetchItemOutflow, rangeError,
    analysisLabel, RECEIVED_GROUPS,
} from '../data/yara-reports-repo.js?v=4.9.145';

const esc = (v) => String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

function todayIso(offset = 0) {
    const d = new Date();
    d.setDate(d.getDate() + offset);
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function template(from, to) {
    return `
      <div class="erp-v2-ra">
        <div class="erp-dash-head">
          <div>
            <h2 class="erp-dash-title">المستلم من المخزن
              <span class="erp-eyebrow" dir="ltr" lang="en">Received Analyzer</span>
            </h2>
            <div class="erp-dash-sub" data-v2-scope-line role="status" aria-live="polite"></div>
          </div>
          <div class="erp-dash-controls">
            <button type="button" class="erp-btn erp-btn--sm erp-no-print" data-v2-print>
              <i class="ji" data-i="printer" aria-hidden="true"></i><span>طباعة</span>
            </button>
            <button type="button" class="erp-btn erp-btn--primary erp-btn--sm erp-no-print" data-v2-reload>
              <i class="ji" data-i="refresh" aria-hidden="true"></i><span>عرض</span>
            </button>
          </div>
        </div>

        <div class="erp-filterbar erp-no-print">
          <label class="erp-text-sm erp-text-muted" for="v2ra-from">من</label>
          <input class="erp-input erp-input--ltr" id="v2ra-from" type="date" value="${esc(from)}">
          <label class="erp-text-sm erp-text-muted" for="v2ra-to">إلى</label>
          <input class="erp-input erp-input--ltr" id="v2ra-to" type="date" value="${esc(to)}" max="${esc(todayIso(0))}">
          <label class="erp-text-sm erp-text-muted" for="v2ra-dept">القسم</label>
          <input class="erp-input erp-input--ltr" id="v2ra-dept" type="search" placeholder="CAF · SERVICE…" style="max-inline-size:160px">
          <label class="erp-text-sm erp-text-muted" for="v2ra-item">صنف</label>
          <input class="erp-input" id="v2ra-item" type="search" placeholder="اسم الصنف…" style="min-inline-size:160px">
        </div>

        <div data-v2-kpis></div>

        <section class="erp-card">
          <div class="erp-card__head">
            <h3 class="erp-card__title">أذون الصرف المستلمة
              <span class="erp-eyebrow" dir="ltr" lang="en">Dispatches</span>
              <span class="erp-text-muted erp-text-sm" data-v2-dcount></span>
            </h3>
          </div>
          <div class="erp-card__body"><div data-v2-dispatches></div></div>
        </section>

        <section class="erp-card">
          <div class="erp-card__head">
            <h3 class="erp-card__title">الأصناف المستلمة
              <span class="erp-eyebrow" dir="ltr" lang="en">Items</span>
              <span data-v2-groupseg></span>
              <span class="erp-text-muted erp-text-sm" data-v2-icount></span>
            </h3>
          </div>
          <div class="erp-card__body"><div data-v2-items></div></div>
        </section>

        <section class="erp-card">
          <div class="erp-card__head">
            <h3 class="erp-card__title">تحليل الاستهلاك
              <span class="erp-eyebrow" dir="ltr" lang="en">Outflow</span>
            </h3>
          </div>
          <div class="erp-card__body erp-stack">
            <p class="erp-text-sm erp-text-muted">
              يقرأ نفس مصادر النظام — ملخص ورصيد ومتوسط يومي واتجاه وتنبيهات،
              كما يحسبها الخادم (<span class="erp-addr" dir="ltr">/item-outflow</span>).
            </p>
            <div data-v2-outflow></div>
          </div>
        </section>
      </div>`;
}

export function mountReceivedAnalyzerScreen(host, _ctx = {}) {
    let dispatches = [];
    let itemRows = [];
    let outflow = null;
    let group = 'item';
    let loading = false;

    host.insertAdjacentHTML('beforeend', template(todayIso(-29), todayIso(0)));
    const el = host.lastElementChild;
    const q = (sel) => el.querySelector(sel);
    const scopeLine = q('[data-v2-scope-line]');
    const kpisHost = q('[data-v2-kpis]');

    const dispatchTable = createDataTable({
        caption: 'أذون الصرف المستلمة — بيانات حية', mode: 'client', pageSize: 15, stickyHeader: true,
        emptyMessage: 'لا أذون مستلمة في هذا المدى', rowKey: (r) => r.id,
        columns: [
            { key: 'doc_no', header: 'الإذن', width: '140px', className: 'erp-mono',
                render: (r) => `<span class="erp-num" dir="ltr">${esc(r.doc_no ?? r.id ?? '—')}</span>` },
            { key: 'date', header: 'التاريخ', sortable: true, width: '120px', align: 'center', className: 'erp-tnum' },
            { key: 'dept', header: 'القسم', sortable: true, filterable: true, width: '140px' },
            { key: 'items_count', header: 'أصناف', type: 'number', width: '100px', align: 'end', value: (r) => r.items_count ?? 0,
                render: (r) => `<span class="erp-num" dir="ltr">${formatInt(r.items_count ?? 0)}</span>` },
            { key: 'received_by', header: 'المستلم', filterable: true },
        ],
    });
    const itemsTable = createDataTable({
        caption: 'الأصناف المستلمة مجمّعة — بيانات حية', mode: 'client', pageSize: 20, stickyHeader: true,
        emptyMessage: 'لا أصناف مستلمة في هذا المدى', rowKey: (r, i) => `${i}`,
        columns: [
            { key: 'label', header: 'الاسم', sortable: true, filterable: true,
                render: (r) => esc(r.label) + (r.code ? `<span class="erp-mini__sub erp-mono" dir="ltr">${esc(r.code)}</span>` : '') },
            { key: 'qty', header: 'الكمية', type: 'number', width: '120px', align: 'end', value: (r) => r.qty,
                render: (r) => `<span class="erp-num" dir="ltr">${formatInt(r.qty)}</span>` },
            { key: 'dispatches', header: 'أذون', type: 'number', width: '100px', align: 'end', value: (r) => r.dispatches ?? 0,
                render: (r) => `<span class="erp-num" dir="ltr">${formatInt(r.dispatches ?? 0)}</span>` },
            { key: 'last_date', header: 'آخر استلام', width: '130px', align: 'center', className: 'erp-tnum' },
        ],
    });
    q('[data-v2-dispatches]').appendChild(dispatchTable.el);
    q('[data-v2-items]').appendChild(itemsTable.el);

    function paintGroupSeg() {
        q('[data-v2-groupseg]').innerHTML = `<span class="erp-seg" role="group" aria-label="تجميع الأصناف">`
            + RECEIVED_GROUPS.map((g) => `<button type="button" data-v2-group="${g}"${g === group ? ' class="is-active" aria-pressed="true"' : ' aria-pressed="false"'}>${
                { item: 'بالصنف', dept: 'بالقسم', day: 'باليوم' }[g]}</button>`).join('') + `</span>`;
    }

    function paintKpis() {
        const totalQty = itemRows.reduce((s, r) => s + (Number(r.qty) || 0), 0);
        kpisHost.innerHTML = `<ul class="erp-kpis" aria-label="مؤشرات الاستلام">`
            + [
                { icon: 'inbox', label: 'أذون مستلمة', en: 'Dispatches', value: formatInt(dispatches.length) },
                { icon: 'package', label: 'أصناف مجمّعة', en: 'Items', value: formatInt(itemRows.length) },
                { icon: 'scale', label: 'إجمالي الكميات', en: 'Total Qty', value: formatInt(totalQty) },
            ].map((k) => `<li class="erp-kpi">
                <div class="erp-kpi__top"><span class="erp-kpi__icon" aria-hidden="true"><i class="ji" data-i="${k.icon}"></i></span>
                <span class="erp-kpi__label">${esc(k.label)}<span class="erp-eyebrow" dir="ltr" lang="en">${esc(k.en)}</span></span></div>
                <div class="erp-kpi__value"><span class="erp-num" dir="ltr">${k.value}</span></div>
              </li>`).join('') + `</ul>`;
    }

    function paintOutflow() {
        const host2 = q('[data-v2-outflow]');
        if (!outflow || typeof outflow !== 'object' || !Object.keys(outflow).length) {
            host2.innerHTML = `<p class="erp-text-sm erp-text-muted">لا بيانات استهلاك في هذا المدى.</p>`;
            return;
        }
        const o = outflow;
        const rowsHtml = (o.alerts || []).length
            ? (o.alerts || []).map((a) => `<li>${esc(typeof a === 'string' ? a : (a && a.message) || JSON.stringify(a))}</li>`).join('')
            : `<li class="erp-text-muted">لا تنبيهات في هذا المدى.</li>`;
        const stats = [
            ['الرصيد الحالي', o.balance ?? o.current_balance],
            ['متوسط الاستهلاك اليومي', o.avg_daily ?? o.avg],
            ['إجمالي الصرف', o.total_out ?? o.outflow],
            ['إجمالي الوارد', o.total_in ?? o.inflow],
        ].filter(([, v]) => v !== undefined && v !== null)
            .map(([label, v]) => `<div class="erp-emp-stat"><span class="erp-emp-stat__l">${esc(label)}</span>
                <span class="erp-emp-stat__v erp-num" dir="ltr">${esc(String(v))}</span></div>`).join('');
        host2.innerHTML = `
          <div class="erp-emp-stats">${stats}</div>
          <ul class="erp-stack erp-text-sm">${rowsHtml}</ul>`;
    }

    function paint() {
        const f = filters();
        scopeLine.textContent = `${f.from} ← ${f.to}${f.dept ? ` · قسم ${f.dept}` : ''}${f.item ? ` · صنف: ${f.item}` : ''}`;
        q('[data-v2-dcount]').textContent = dispatches.length ? `(${formatInt(dispatches.length)})` : '';
        q('[data-v2-icount]').textContent = itemRows.length ? `(${formatInt(itemRows.length)})` : '';
        dispatchTable.setRows(dispatches);
        itemsTable.setRows(itemRows);
        paintKpis();
        paintOutflow();
    }

    function filters() {
        return {
            from: q('#v2ra-from').value, to: q('#v2ra-to').value,
            dept: q('#v2ra-dept').value.trim(), item: q('#v2ra-item').value.trim(),
        };
    }

    async function reload() {
        if (loading) {return;}
        const f = filters();
        const gate = rangeError(f.from, f.to);
        if (!gate.ok) {
            dispatchTable.setRows([]); itemsTable.setRows([]);
            kpisHost.innerHTML = ''; outflow = null;
            scopeLine.textContent = gate.message;
            dispatchTable.setError(gate.message);
            return;
        }
        loading = true;
        dispatchTable.setLoading(true);
        try {
            const [d, it, ofl] = await Promise.allSettled([
                fetchReceivedDispatches(f), fetchReceivedItems({ ...f, group }),
                fetchItemOutflow({ from: f.from, to: f.to, item: f.item }),
                import('../data/reports-repo.js?v=4.9.145').then((m) => m.fetchCurrency()).catch(() => ''),
            ]);
            if (!el.isConnected) {return;}
            if (d.status === 'fulfilled') {dispatches = d.value.dispatches || d.value.rows || [];}
            else {dispatches = []; dispatchTable.setError(`تعذّر الأذون: ${(d.reason && d.reason.message) || 'خطأ'}`);}
            if (it.status === 'fulfilled') {
                const raw = it.value.rows || it.value.items || [];
                itemRows = raw.map((r) => ({
                    label: analysisLabel(r, group),
                    code: group === 'item' && r.item_code ? String(r.item_code) : '',
                    qty: Number(r.qty) || 0,
                    dispatches: Number(r.dispatch_count ?? r.dispatches) || 0,
                    last_date: r.last_date ? String(r.last_date).slice(0, 10) : '—',
                }));
            } else {itemRows = []; itemsTable.setError(`تعذّر الأصناف: ${(it.reason && it.reason.message) || 'خطأ'}`);}
            outflow = ofl.status === 'fulfilled' ? ofl.value : null;
            paint();
        } catch (e) {
            if (!el.isConnected) {return;}
            dispatches = []; itemRows = []; outflow = null;
            dispatchTable.setError(e && e.message === 'UNAUTHORIZED'
                ? 'انتهت الجلسة — سجّل الدخول في النظام الحالي ثم أعد فتح الوضع الحيّ.'
                : `تعذّر التحميل: ${(e && e.message) || 'خطأ'}`);
        } finally {
            loading = false;
        }
    }

    el.addEventListener('click', (event) => {
        const g = event.target.closest('[data-v2-group]');
        if (g) {group = g.dataset.v2Group; paintGroupSeg(); reload(); return;}
        if (event.target.closest('[data-v2-reload]')) {reload(); return;}
        if (event.target.closest('[data-v2-print]')) {window.print(); return;}
        if (event.target.closest('[data-erp-retry]')) {reload();}
    });
    el.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' && event.target.matches('#v2ra-dept, #v2ra-item')) {reload();}
    });

    paintGroupSeg();
    reload();

    return {
        el,
        reload,
        getRows: () => ({ dispatches, items: itemRows }),
        destroy() {
            dispatchTable.destroy();
            itemsTable.destroy();
            el.remove();
        },
    };
}
