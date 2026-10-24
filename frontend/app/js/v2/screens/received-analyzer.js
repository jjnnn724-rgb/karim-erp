/**
 * V2 — Received analyzer screen · ما استلمته الأقسام (قراءة فقط)
 * ═══════════════════════════════════════════════════════════════════════
 * سجلان: أذون الصرف المستلمة (قائمة) + الأصناف المستلمة مجمّعة
 * (بصنف/قسم/يوم)، وتحليل استهلاك ذكي (item-outflow) بملاحظاته وتنبيهاته،
 * وتصدير Excel بثلاث أوراق بأعمدة القديم. كل باب من yara-reports-repo،
 * والصلاحية قرار الخادم.
 */

import { createDataTable } from '../data-display/data-table.js?v=4.9.151';
import { formatInt } from '../data/reports-repo.js?v=4.9.151';
import { openInAppReport } from '../report-viewer.js?v=4.9.151';
import {
    fetchReceivedItems, fetchReceivedDispatches, fetchItemOutflow,
    fetchReceivedDispatchDetail, rangeError, analysisLabel, RECEIVED_GROUPS,
} from '../data/yara-reports-repo.js?v=4.9.151';
import { ensureXlsx } from '../vendor.js?v=4.9.151';
import { prepareReportWorkbook } from '../report-export.js?v=4.9.151';

/** أسماء حالات الاستهلاك كما في تصدير القديم (features/received-analyzer.js:550). */
const OUTFLOW_ALERT_AR = { negative: 'سالب', depleted: 'صفر', low: 'منخفض', ok: 'سليم' };

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
            <button type="button" class="erp-btn erp-btn--sm erp-no-print" data-v2-excel>
              <i class="ji" data-i="inbox" aria-hidden="true"></i><span>Excel</span>
            </button>
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
          <div class="erp-card__body"><div data-v2-dispatches></div><div data-v2-dispatch-detail></div></div>
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
              كما يحسبها النظام.
            </p>
            <div data-v2-outflow></div>
          </div>
        </section>
      </div>`;
}

export function mountReceivedAnalyzerScreen(host, ctx = {}) {
    let dispatches = [];
    let itemRows = [];
    let outflow = null;
    let outflowRows = [];
    let group = 'item';
    let loading = false;
    let exporting = false;
    const notify = typeof ctx.notify === 'function' ? ctx.notify : (m) => console.info('[V2 received-analyzer]', m);

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
                render: (r) => `<button type="button" class="erp-link-btn" data-v2-disp-view="${esc(r.id)}"><span class="erp-num" dir="ltr">${esc(r.doc_no ?? r.id ?? '—')}</span></button>` },
            { key: 'date', header: 'التاريخ', sortable: true, width: '120px', align: 'center', className: 'erp-tnum' },
            { key: 'dept', header: 'القسم', sortable: true, filterable: true, width: '140px' },
            { key: 'items_count', header: 'أصناف', type: 'number', width: '100px', align: 'end', value: (r) => r.items_count ?? 0,
                render: (r) => `<span class="erp-num" dir="ltr">${formatInt(r.items_count ?? 0)}</span>` },
            { key: 'received_by', header: 'المستلم', filterable: true },
            { key: 'actions', header: 'إجراءات', width: '110px', align: 'center', className: 'erp-no-print',
                render: (r) => `<span class="erp-row-wrap" style="gap:4px">`
                    + `<button type="button" class="erp-btn erp-btn--subtle erp-btn--xs" data-v2-disp-view="${esc(r.id)}" title="عرض التفاصيل"><i class="ji" data-i="eye" aria-hidden="true"></i></button>`
                    + `<button type="button" class="erp-btn erp-btn--subtle erp-btn--xs" data-v2-disp-print="${esc(r.id)}" title="طباعة"><i class="ji" data-i="printer" aria-hidden="true"></i></button>`
                    + `</span>` },
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

    /** ثلاثة أوراق بأعمدة تصدير القديم الثلاثة — مكتبة Excel تُحمَّل عند أول تصدير. */
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
            const wb = window.XLSX.utils.book_new();

            const outflowData = [['الصنف', 'وارد بالفترة', 'مصروف بالفترة', 'الرصيد الكلي',
                'متوسط يومي', 'الحالة', 'أول حركة', 'آخر حركة']];
            outflowRows.forEach((r) => outflowData.push([
                r.item_name || '', r.qty_in, r.qty_out, r.balance, r.period_avg_daily,
                OUTFLOW_ALERT_AR[r.alert] || r.alert || '', r.first_date || '', r.last_date || '',
            ]));
            window.XLSX.utils.book_append_sheet(wb, window.XLSX.utils.aoa_to_sheet(outflowData), 'المصروفات');

            const dispatchData = [['الإذن', 'القسم', 'التاريخ', 'وقت الاستلام', 'المستلم',
                'أصناف', 'إجمالي الكمية', 'ملاحظات']];
            dispatches.forEach((d) => dispatchData.push([
                d.doc_no ?? d.id, d.dept_name || '', d.date,
                String(d.received_at || '').slice(0, 16).replace('T', ' '),
                d.received_by || '', d.items_count, d.total_qty, d.notes || '',
            ]));
            window.XLSX.utils.book_append_sheet(wb, window.XLSX.utils.aoa_to_sheet(dispatchData), 'أذونات الصرف');

            const grpLabel = { item: 'الصنف', dept: 'القسم', day: 'اليوم' }[group];
            const itemData = [[grpLabel, 'أذونات', 'كمية مستلمة', 'كمية معتمدة', 'الفرق']];
            itemRows.forEach((r) => itemData.push([
                r.label, r.dispatches, r.qty, r.approved_qty, r.variance_qty,
            ]));
            window.XLSX.utils.book_append_sheet(wb, window.XLSX.utils.aoa_to_sheet(itemData), 'الأصناف المستلمة');

            prepareReportWorkbook(window.XLSX, wb, `تقرير المستلم من المخزن ${f.from} إلى ${f.to}`);
            window.XLSX.writeFile(wb, `received_${f.from}_${f.to}.xlsx`);
            notify('تم تصدير Excel');
        } finally {
            exporting = false;
        }
    }

    async function reload() {
        if (loading) {return;}
        const f = filters();
        const gate = rangeError(f.from, f.to);
        if (!gate.ok) {
            dispatchTable.setRows([]); itemsTable.setRows([]);
            kpisHost.innerHTML = ''; outflow = null; outflowRows = [];
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
                import('../data/reports-repo.js?v=4.9.151').then((m) => m.fetchCurrency()).catch(() => ''),
            ]);
            if (!el.isConnected) {return;}
            if (d.status === 'fulfilled') {dispatches = d.value.dispatches || d.value.rows || [];}
            else {dispatches = []; dispatchTable.setError(`تعذّر الأذون: ${(d.reason && d.reason.message) || 'خطأ'}`);}
            if (it.status === 'fulfilled') {
                const raw = it.value.rows || it.value.items || [];
                itemRows = raw.map((r) => ({
                    label: analysisLabel(r, group),
                    code: group === 'item' && (r.item_code || r.code) ? String(r.item_code || r.code) : '',
                    qty: Number(r.qty) || 0,
                    dispatches: Number(r.dispatch_count ?? r.dispatches) || 0,
                    last_date: r.last_date ? String(r.last_date).slice(0, 10) : '—',
                    // عمودا تصدير القديم (features/received-analyzer.js:562) — يُحفظان ولا يُعرضان
                    approved_qty: Number(r.approved_qty) || 0,
                    variance_qty: Number(r.variance_qty) || 0,
                }));
            } else {itemRows = []; itemsTable.setError(`تعذّر الأصناف: ${(it.reason && it.reason.message) || 'خطأ'}`);}
            outflow = ofl.status === 'fulfilled' ? ofl.value : null;
            outflowRows = outflow && Array.isArray(outflow.rows) ? outflow.rows : [];
            paint();
        } catch (e) {
            if (!el.isConnected) {return;}
            dispatches = []; itemRows = []; outflow = null; outflowRows = [];
            dispatchTable.setError(e && e.message === 'UNAUTHORIZED'
                ? 'انتهت الجلسة — سجّل الدخول في النظام الحالي ثم أعد فتح الوضع الحيّ.'
                : `تعذّر التحميل: ${(e && e.message) || 'خطأ'}`);
        } finally {
            loading = false;
        }
    }

    /** فتح تفاصيل إذن صرف — مرآة raOpenDispatch (features/received-analyzer.js:323-396). */
    async function openDispatchDetail(dispId) {
        const detailHost = q('[data-v2-dispatch-detail]');
        if (!detailHost) {return;}
        detailHost.innerHTML = '<div class="erp-card erp-card--subtle" style="margin-top:14px"><div class="erp-card__body erp-text-center"><span class="erp-spinner" aria-hidden="true"></span> جارٍ جلب تفاصيل الإذن…</div></div>';
        try {
            const data = await fetchReceivedDispatchDetail(dispId);
            if (!el.isConnected) {return;}
            const disp = (data && data.dispatch) || {};
            const items = Array.isArray(disp.approved_items) && disp.approved_items.length
                ? disp.approved_items : (Array.isArray(disp.items) ? disp.items : []);
            const receivedMap = new Map();
            (disp.received_items || []).forEach((ri) => {
                receivedMap.set(String(ri.itemName || ri.item_name || ''), ri);
            });
            const linesHtml = items.map((it, i) => {
                const name = it.itemName || it.name || '';
                const ri = receivedMap.get(String(name)) || {};
                const approved = Number(it.qty || it.approvedQty || 0);
                const received = Number(ri.receivedQty || 0);
                const variance = Number(ri.varianceQty || 0);
                return `<tr>
                    <td>${i + 1}</td>
                    <td style="text-align:start">${esc(name)}</td>
                    <td>${esc(it.unit || '')}</td>
                    <td><span class="erp-num" dir="ltr">${formatInt(approved)}</span></td>
                    <td><span class="erp-num" dir="ltr">${formatInt(received)}</span></td>
                    <td class="${variance < 0 ? 'erp-text-danger' : (variance > 0 ? 'erp-text-success' : '')}"><span class="erp-num" dir="ltr">${formatInt(variance)}</span></td>
                </tr>`;
            }).join('');
            detailHost.innerHTML = `
              <div class="erp-card erp-card--subtle" style="margin-top:16px">
                <div class="erp-card__head">
                  <h4 class="erp-card__title">
                    <i class="ji" data-i="file-text" aria-hidden="true"></i>
                    إذن صرف ${esc(disp.dept_name || '')} — ${esc(disp.date || '')}
                  </h4>
                  <span class="erp-grow"></span>
                  <button type="button" class="erp-btn erp-btn--sm" data-v2-disp-print="${esc(dispId)}">
                    <i class="ji" data-i="printer" aria-hidden="true"></i><span>طباعة</span>
                  </button>
                  <button type="button" class="erp-btn erp-btn--sm erp-btn--ghost" data-v2-disp-close>
                    <i class="ji" data-i="x" aria-hidden="true"></i><span>إغلاق</span>
                  </button>
                </div>
                <div class="erp-card__body erp-stack">
                  <div class="erp-emp-stats">
                    <div class="erp-emp-stat"><span class="erp-emp-stat__l">القسم</span><span class="erp-emp-stat__v">${esc(disp.dept_name || '—')}</span></div>
                    <div class="erp-emp-stat"><span class="erp-emp-stat__l">التاريخ</span><span class="erp-emp-stat__v erp-tnum" dir="ltr">${esc(disp.date || '')}</span></div>
                    <div class="erp-emp-stat"><span class="erp-emp-stat__l">المستلم</span><span class="erp-emp-stat__v">${esc(disp.received_by || '—')}</span></div>
                    <div class="erp-emp-stat"><span class="erp-emp-stat__l">وقت الاستلام</span><span class="erp-emp-stat__v erp-tnum" dir="ltr">${esc(String(disp.received_at || '').slice(0, 16).replace('T', ' '))}</span></div>
                    <div class="erp-emp-stat"><span class="erp-emp-stat__l">المُنشئ</span><span class="erp-emp-stat__v">${esc(disp.created_by || '—')}</span></div>
                  </div>
                  <div class="erp-tbl-wrap" style="overflow-x:auto">
                    <table class="erp-tbl">
                      <thead><tr><th>#</th><th>الصنف</th><th>الوحدة</th><th>معتمد</th><th>مستلم</th><th>الفرق</th></tr></thead>
                      <tbody>${linesHtml || '<tr><td colspan="6" class="erp-text-muted erp-text-center">لا أصناف مفصّلة</td></tr>'}</tbody>
                    </table>
                  </div>
                  ${disp.notes ? `<p class="erp-text-sm"><strong>ملاحظات:</strong> ${esc(disp.notes)}</p>` : ''}
                  ${disp.receipt_notes ? `<p class="erp-text-sm"><strong>ملاحظات الاستلام:</strong> ${esc(disp.receipt_notes)}</p>` : ''}
                </div>
              </div>`;
            detailHost.scrollIntoView({ behavior: 'smooth', block: 'start' });
        } catch (e) {
            if (!el.isConnected) {return;}
            detailHost.innerHTML = `<div class="erp-card erp-card--subtle" style="margin-top:14px"><div class="erp-card__body erp-text-danger">تعذر جلب تفاصيل الإذن: ${esc((e && e.message) || 'خطأ')}</div></div>`;
        }
    }

    /** طباعة إذن صرف فردي — مرآة raPrintDispatch (features/received-analyzer.js:400-457). */
    async function printDispatchReceipt(dispId) {
        try {
            const data = await fetchReceivedDispatchDetail(dispId);
            const disp = (data && data.dispatch) || {};
            const items = Array.isArray(disp.approved_items) && disp.approved_items.length
                ? disp.approved_items : (Array.isArray(disp.items) ? disp.items : []);
            const receivedMap = new Map();
            (disp.received_items || []).forEach((ri) => {
                receivedMap.set(String(ri.itemName || ri.item_name || ''), ri);
            });
            const linesHtml = items.map((it, i) => {
                const name = it.itemName || it.name || '';
                const ri = receivedMap.get(String(name)) || {};
                return `<tr><td>${i + 1}</td><td style="text-align:start">${esc(name)}</td><td>${esc(it.unit || '')}</td>
                <td>${formatInt(it.qty || it.approvedQty || 0)}</td><td><b>${formatInt(ri.receivedQty || 0)}</b></td></tr>`;
            }).join('');
            const w = openInAppReport(`إذن صرف ${esc(disp.dept_name || dispId)}`);
            if (!w) { notify('تعذر فتح عارض الطباعة'); return; }
            w.document.write(`<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="UTF-8"><title>إذن صرف ${esc(disp.dept_name || '')}</title>
            <style>body{font-family:'Cairo',Tahoma,sans-serif;padding:36px;color:#111}h1{text-align:center;font-size:22px}h2{text-align:center;color:#666;font-size:14px;margin-bottom:16px}
            table{width:100%;border-collapse:collapse;font-size:12.5px}th,td{border:1px solid #999;padding:6px;text-align:center}th{background:#0f172a;color:#f5d76e}
            .meta{font-size:13px;line-height:1.9;margin:10px 0}.meta b{display:inline-block;min-width:90px}
            @media print{body{padding:0}}</style></head><body>
            <h1>مطاعم الشرفة العالمي</h1><h2>إذن صرف — ${esc(disp.dept_name || '')}</h2>
            <div class="meta">
              <div><b>التاريخ:</b> ${esc(disp.date || '')}</div>
              <div><b>المستلم:</b> ${esc(disp.received_by || '—')}</div>
              <div><b>وقت الاستلام:</b> ${esc(String(disp.received_at || '').slice(0, 16).replace('T', ' '))}</div>
              <div><b>المُنشئ:</b> ${esc(disp.created_by || '—')}</div>
            </div>
            <table><thead><tr><th>#</th><th>الصنف</th><th>الوحدة</th><th>معتمد</th><th>مستلم</th></tr></thead><tbody>${linesHtml}</tbody></table>
            ${disp.notes ? `<p style="margin-top:10px;font-size:12px"><b>ملاحظات:</b> ${esc(disp.notes)}</p>` : ''}
            <p style="text-align:center;font-size:11px;margin-top:16px;color:#777">تاريخ الطباعة: ${new Date().toLocaleString('ar-EG')}</p>
            </body></html>`);
            w.document.close();
            w.focus();
        } catch (e) {
            notify('تعذر طباعة الإذن: ' + ((e && e.message) || 'خطأ'));
        }
    }

    el.addEventListener('click', (event) => {
        const dispView = event.target.closest('[data-v2-disp-view]');
        if (dispView) {openDispatchDetail(dispView.dataset.v2DispView); return;}
        const dispPrint = event.target.closest('[data-v2-disp-print]');
        if (dispPrint) {printDispatchReceipt(dispPrint.dataset.v2DispPrint); return;}
        if (event.target.closest('[data-v2-disp-close]')) {
            const dh = q('[data-v2-dispatch-detail]');
            if (dh) {dh.innerHTML = '';}
            return;
        }
        const g = event.target.closest('[data-v2-group]');
        if (g) {group = g.dataset.v2Group; paintGroupSeg(); reload(); return;}
        if (event.target.closest('[data-v2-reload]')) {reload(); return;}
        if (event.target.closest('[data-v2-excel]')) {exportExcel(); return;}
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
