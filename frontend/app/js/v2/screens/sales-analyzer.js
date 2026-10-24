/**
 * V2 — Sales analyzer screen · تحليل مبيعات الكاشيرية (قراءة فقط)
 * ═══════════════════════════════════════════════════════════════════════
 * تبويبان: تحليل مجمّع (بصنف/كاشير/يوم) + الأوردرات المفصّلة بترقيم،
 * وتصدير Excel للتبويب النشط بأعمدة القديم. باب واحد لكل تبويب من
 * yara-reports-repo، والمدى المعكوس/الواسع بوابة محلية قبل أي طلب
 * (نفس قاعدة 04/07/08). الصلاحية قرار الخادم.
 */

import { createDataTable } from '../data-display/data-table.js?v=4.9.152';
import { formatInt, formatMoney } from '../data/reports-repo.js?v=4.9.152';
import { openInAppReport } from '../report-viewer.js?v=4.9.152';
import {
    fetchItemSales, fetchYaraOrders, fetchOrderDetail, arSearchIncludes,
    rangeError, analysisLabel, safeTotals, SA_GROUPS,
} from '../data/yara-reports-repo.js?v=4.9.152';
import { ensureXlsx } from '../vendor.js?v=4.9.152';
import { prepareReportWorkbook } from '../report-export.js?v=4.9.152';

const esc = (v) => String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const GROUP_AR = { item: 'بالصنف', cashier: 'بالكاشير', day: 'باليوم' };

function money(v, currency) {
    const m = formatMoney(v, currency);
    return `<span class="erp-num" dir="ltr">${m.amount}</span>`
        + (m.hasUnit ? ` <span class="erp-text-sm erp-text-muted">${esc(m.unit)}</span>` : '');
}

function todayIso(offset = 0) {
    const d = new Date();
    d.setDate(d.getDate() + offset);
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function template(from, to) {
    return `
      <div class="erp-v2-sa">
        <div class="erp-dash-head">
          <div>
            <h2 class="erp-dash-title">تحليل مبيعات الكاشيرية
              <span class="erp-eyebrow" dir="ltr" lang="en">Sales Analyzer</span>
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
              <i class="ji" data-i="refresh" aria-hidden="true"></i><span>تحليل</span>
            </button>
          </div>
        </div>

        <span data-v2-tabseg></span>

        <div class="erp-filterbar erp-no-print">
          <label class="erp-text-sm erp-text-muted" for="v2sa-from">من</label>
          <input class="erp-input erp-input--ltr" id="v2sa-from" type="date" value="${esc(from)}">
          <label class="erp-text-sm erp-text-muted" for="v2sa-to">إلى</label>
          <input class="erp-input erp-input--ltr" id="v2sa-to" type="date" value="${esc(to)}" max="${esc(todayIso(0))}">
          <label class="erp-text-sm erp-text-muted" for="v2sa-cashier">الكاشير</label>
          <select class="erp-select" id="v2sa-cashier"><option value="">الكل</option></select>
          <label class="erp-text-sm erp-text-muted" for="v2sa-item">بحث صنف</label>
          <input class="erp-input" id="v2sa-item" type="search" placeholder="مثال: البيبسي، شاورما…" style="min-inline-size:180px">
          <span data-v2-groupwrap></span>
        </div>

        <div data-v2-kpis></div>

        <section class="erp-card">
          <div class="erp-card__head">
            <h3 class="erp-card__title"><span data-v2-body-label>التحليل المجمّع</span>
              <span class="erp-eyebrow" dir="ltr" lang="en" data-v2-body-en>Analysis</span>
              <span class="erp-text-muted erp-text-sm" data-v2-count></span>
            </h3>
          </div>
          <div class="erp-card__body erp-stack">
            <div data-v2-table></div>
            <div data-v2-order-detail></div>
          </div>
        </section>
      </div>`;
}

export function mountSalesAnalyzerScreen(host, ctx = {}) {
    let tab = 'analysis';
    let rows = [];
    let orders = [];
    let ordersTotal = 0;
    let ordersPage = 0;
    const currency = '';
    let loading = false;
    let exporting = false;
    const notify = typeof ctx.notify === 'function' ? ctx.notify : (m) => console.info('[V2 sales-analyzer]', m);

    host.insertAdjacentHTML('beforeend', template(todayIso(-29), todayIso(0)));
    const el = host.lastElementChild;
    const q = (sel) => el.querySelector(sel);
    const scopeLine = q('[data-v2-scope-line]');
    const kpisHost = q('[data-v2-kpis]');
    const countEl = q('[data-v2-count]');
    const bodyLabel = q('[data-v2-body-label]');
    const bodyEn = q('[data-v2-body-en]');

    const analysisTable = createDataTable({
        caption: 'التحليل المجمّع — بيانات حية', mode: 'client', pageSize: 20, stickyHeader: true,
        emptyMessage: 'لا نتائج في هذا المدى', emptyHint: 'وسّع المدى أو غيّر التجميع.',
        rowKey: (r, i) => `${i}`,
        columns: [
            { key: 'label', header: 'الاسم', sortable: true, filterable: true,
                render: (r) => esc(r.label) + (r.code ? `<span class="erp-mini__sub erp-mono" dir="ltr">${esc(r.code)}</span>` : '') },
            { key: 'invoices', header: 'فواتير', type: 'number', width: '110px', align: 'end', value: (r) => r.invoices,
                render: (r) => `<span class="erp-num" dir="ltr">${formatInt(r.invoices)}</span>` },
            { key: 'qty', header: 'الكمية', type: 'number', width: '110px', align: 'end', value: (r) => r.qty,
                render: (r) => `<span class="erp-num" dir="ltr">${formatInt(r.qty)}</span>` },
            { key: 'net', header: 'الصافي', type: 'number', width: '140px', align: 'end', value: (r) => r.net,
                render: (r) => money(r.net, currency) },
            { key: 'vat', header: 'ضريبة', type: 'number', width: '130px', align: 'end', value: (r) => r.vat,
                render: (r) => money(r.vat, currency) },
        ],
    });
    const ordersTable = createDataTable({
        caption: 'الأوردرات المفصّلة — بيانات حية', mode: 'client', pageSize: 20, stickyHeader: true,
        emptyMessage: 'لا أوردرات في هذا المدى', rowKey: (r) => r.doc_no || r.id,
        columns: [
            { key: 'doc_no', header: 'الفاتورة', sortable: true, width: '130px', className: 'erp-mono',
                render: (r) => `<button type="button" class="erp-link-btn" data-v2-order-view="${esc(r.doc_no ?? r.id)}"><span class="erp-num" dir="ltr">${esc(r.doc_no ?? r.id ?? '—')}</span></button>` },
            { key: 'doc_date', header: 'التاريخ', sortable: true, width: '120px', align: 'center', className: 'erp-tnum' },
            { key: 'cashier_name', header: 'الكاشير', sortable: true, filterable: true },
            { key: 'lines_count', header: 'أصناف', type: 'number', width: '100px', align: 'end', value: (r) => r.lines_count ?? 0,
                render: (r) => `<span class="erp-num" dir="ltr">${formatInt(r.lines_count ?? 0)}</span>` },
            { key: 'net', header: 'الصافي', type: 'number', width: '140px', align: 'end', value: (r) => r.net,
                render: (r) => money(r.net, currency) },
            { key: 'actions', header: 'إجراءات', width: '110px', align: 'center', className: 'erp-no-print',
                render: (r) => `<span class="erp-row-wrap" style="gap:4px">`
                    + `<button type="button" class="erp-btn erp-btn--subtle erp-btn--xs" data-v2-order-view="${esc(r.doc_no ?? r.id)}" title="عرض التفاصيل"><i class="ji" data-i="eye" aria-hidden="true"></i></button>`
                    + `<button type="button" class="erp-btn erp-btn--subtle erp-btn--xs" data-v2-order-print="${esc(r.doc_no ?? r.id)}" title="طباعة"><i class="ji" data-i="printer" aria-hidden="true"></i></button>`
                    + `</span>` },
        ],
    });
    q('[data-v2-table]').appendChild(analysisTable.el);

    function filters() {
        return {
            from: q('#v2sa-from').value, to: q('#v2sa-to').value,
            cashier: q('#v2sa-cashier').value, item: q('#v2sa-item').value.trim(),
            group: q('[data-v2-group]:checked') ? q('[data-v2-group]:checked').value : 'item',
        };
    }

    /* ── تبويبات + تجميع (شرائح قياسية) ──────────────────────────────── */
    function paintTabs() {
        q('[data-v2-tabseg]').innerHTML = `<div class="erp-seg" role="group" aria-label="نمط العرض">`
            + [['analysis', 'تحليل مجمّع'], ['orders', 'الأوردرات']].map(([id, label]) =>
                `<button type="button" data-v2-tab="${id}"${tab === id ? ' class="is-active" aria-pressed="true"' : ' aria-pressed="false"'}>${label}</button>`,
            ).join('') + `</div>`;
        q('[data-v2-groupwrap]').innerHTML = tab === 'analysis'
            ? `<div class="erp-seg" role="group" aria-label="التجميع">`
                + SA_GROUPS.map((g) => `<label class="erp-text-sm" style="display:inline-flex;gap:4px;align-items:center">
                    <input type="radio" name="v2sa-group" data-v2-group value="${g}"${g === filters().group ? ' checked' : ''}>${GROUP_AR[g]}</label>`).join('')
                + `</div>`
            : '';
    }

    function paintKpis(t) {
        const tot = safeTotals(t);
        kpisHost.innerHTML = `<ul class="erp-kpis" aria-label="مؤشرات التحليل">`
            + [
                { icon: 'receipt', label: 'فواتير', en: 'Invoices', value: formatInt(tot.invoices) },
                { icon: 'package', label: 'الكمية', en: 'Qty', value: formatInt(tot.qty) },
                { icon: 'banknote', label: 'الصافي', en: 'Net', value: money(tot.net, currency) },
                { icon: 'percent', label: 'ضريبة', en: 'VAT', value: money(tot.vat, currency) },
            ].map((k) => `<li class="erp-kpi">
                <div class="erp-kpi__top"><span class="erp-kpi__icon" aria-hidden="true"><i class="ji" data-i="${k.icon}"></i></span>
                <span class="erp-kpi__label">${esc(k.label)}<span class="erp-eyebrow" dir="ltr" lang="en">${esc(k.en)}</span></span></div>
                <div class="erp-kpi__value">${k.value}</div>
              </li>`).join('') + `</ul>`;
    }

    function paint() {
        const f = filters();
        if (tab === 'orders') {
            bodyLabel.textContent = 'الأوردرات';
            bodyEn.textContent = 'Orders';
            countEl.textContent = ordersTotal ? `(${formatInt(ordersTotal)} إجمالاً — معروض ${formatInt(orders.length)})` : '';
            ordersTable.setRows(orders);
        } else {
            bodyLabel.textContent = 'التحليل المجمّع';
            bodyEn.textContent = 'Analysis';
            countEl.textContent = rows.length ? `(${formatInt(rows.length)})` : '';
            analysisTable.setRows(rows);
        }
        scopeLine.textContent = `${f.from} ← ${f.to}${f.cashier ? ` · كاشير ${f.cashier}` : ''}${f.item ? ` · صنف: ${f.item}` : ''}`;
    }

    function cashierOptions() {
        const map = new Map();
        for (const r of rows) { if (r.cashier_no) {map.set(String(r.cashier_no), r.cashier_name || r.cashier_no);} }
        for (const o of orders) { if (o.cashier_no) {map.set(String(o.cashier_no), o.cashier_name || o.cashier_no);} }
        const sel = q('#v2sa-cashier');
        const keep = sel.value;
        sel.innerHTML = `<option value="">الكل</option>`
            + [...map.entries()].sort((a, b) => Number(a[0]) - Number(b[0]))
                .map(([no, name]) => `<option value="${esc(no)}"${no === keep ? ' selected' : ''}>${esc(name)}</option>`).join('');
    }

    /** تصدير تبويب القديم نفسه: أوردرات أم تحليل مجمّع (features/sales-analyzer.js:366). */
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
            let exportTitle;
            if (tab === 'orders') {
                exportTitle = `تقرير الأوردرات ${f.from} إلى ${f.to}`;
                const data = [['الفاتورة', 'الكاشير', 'التاريخ', 'الوقت', 'الوردية', 'الصافي', 'الإجمالي',
                    'الخصم', 'الضريبة', 'مدفوع', 'نقدًا', 'شبكة', 'الأصناف', 'المنطقة']];
                orders.forEach((o) => data.push([
                    o.doc_no, o.cashier_name || o.cashier_no, o.doc_date,
                    String(o.doc_time || '').slice(0, 5), o.shift_no || '',
                    o.net, o.total, o.discount, o.vat, o.payed, o.pay_cash, o.pay_network,
                    o.lines_count, o.zone_name || o.table_name || '',
                ]));
                window.XLSX.utils.book_append_sheet(wb, window.XLSX.utils.aoa_to_sheet(data), 'الأوردرات');
            } else {
                exportTitle = `تحليل المبيعات ${f.from} إلى ${f.to}`;
                const grpLabel = { item: 'الصنف', cashier: 'الكاشير', day: 'اليوم' }[f.group];
                const data = [[grpLabel, 'فواتير', 'الكمية', 'الصافي', 'الضريبة', 'الإجمالي']];
                rows.forEach((r) => data.push([
                    r.label, r.invoices, r.qty, r.net, r.vat, Number(r.net) + Number(r.vat),
                ]));
                window.XLSX.utils.book_append_sheet(wb, window.XLSX.utils.aoa_to_sheet(data), 'تحليل المبيعات');
            }
            prepareReportWorkbook(window.XLSX, wb, exportTitle);
            window.XLSX.writeFile(wb, tab === 'orders'
                ? `orders_${f.from}_${f.to}.xlsx` : `item-sales_${f.from}_${f.to}.xlsx`);
            notify('تم تصدير Excel');
        } finally {
            exporting = false;
        }
    }

    async function reload({ pageShift = 0 } = {}) {
        if (loading) {return;}
        const f = filters();
        const gate = rangeError(f.from, f.to);
        if (!gate.ok) {
            analysisTable.setRows([]); ordersTable.setRows([]);
            kpisHost.innerHTML = '';
            countEl.textContent = '';
            scopeLine.textContent = gate.message;
            (tab === 'orders' ? ordersTable : analysisTable).setError(gate.message);
            return;
        }
        loading = true;
        (tab === 'orders' ? ordersTable : analysisTable).setLoading(true);
        try {
            if (tab === 'orders') {
                ordersPage = Math.max(0, ordersPage + pageShift);
                const data = await fetchYaraOrders({ ...f, limit: 50, offset: ordersPage * 50 });
                if (!el.isConnected) {return;}
                orders = data.orders || [];
                ordersTotal = Number(data.total) || 0;
            } else {
                const data = await fetchItemSales(f);
                if (!el.isConnected) {return;}
                let rawRows = (data.rows || []).map((r) => ({
                    label: analysisLabel(r, f.group),
                    code: f.group === 'item' && r.item_code ? String(r.item_code) : '',
                    invoices: Number(r.invoices) || 0, qty: Number(r.qty) || 0,
                    net: Number(r.net) || 0, vat: Number(r.vat) || 0,
                }));
                if (f.item && f.group === 'item') {
                    rawRows = rawRows.filter((r) => arSearchIncludes(r.label, f.item));
                }
                rows = rawRows;
                paintKpis(data.totals);
            }
            cashierOptions();
            paint();
        } catch (e) {
            if (!el.isConnected) {return;}
            rows = []; orders = []; ordersTotal = 0;
            analysisTable.setRows([]); ordersTable.setRows([]);
            kpisHost.innerHTML = '';
            countEl.textContent = '';
            (tab === 'orders' ? ordersTable : analysisTable).setError(e && e.message === 'UNAUTHORIZED'
                ? 'انتهت الجلسة — سجّل الدخول في النظام الحالي ثم أعد فتح الوضع الحيّ.'
                : `تعذّر التحميل: ${(e && e.message) || 'خطأ'}`);
        } finally {
            loading = false;
        }
    }

    async function openOrderDetail(docNo) {
        const detailHost = q('[data-v2-order-detail]');
        if (!detailHost) {return;}
        detailHost.innerHTML = '<div class="erp-card erp-card--subtle" style="margin-top:14px"><div class="erp-card__body erp-text-center"><span class="erp-spinner" aria-hidden="true"></span> جارٍ جلب تفاصيل الفاتورة…</div></div>';
        try {
            const data = await fetchOrderDetail(docNo);
            if (!el.isConnected) {return;}
            const o = (data && data.order) || {};
            const lines = Array.isArray(o.lines) ? o.lines : [];
            const linesHtml = lines.map((l, i) => `<tr>
                <td>${i + 1}</td>
                <td style="text-align:start">${esc(l.name || '—')}</td>
                <td><span class="erp-num" dir="ltr">${formatInt(l.qty)}</span></td>
                <td>${money(l.price, currency)}</td>
                <td>${money(l.total, currency)}</td>
            </tr>`).join('');
            detailHost.innerHTML = `
              <div class="erp-card erp-card--subtle" style="margin-top:16px">
                <div class="erp-card__head">
                  <h4 class="erp-card__title">
                    <i class="ji" data-i="receipt" aria-hidden="true"></i>
                    فاتورة رقم <span class="erp-mono" dir="ltr">${esc(o.doc_no || docNo)}</span>
                    — <span class="erp-badge" data-tone="brand">${esc(o.cashier_name || ('كاشير ' + (o.cashier_no || '')))}</span>
                    — <span class="erp-tnum">${esc(o.doc_date || '')}</span>
                  </h4>
                  <span class="erp-grow"></span>
                  <button type="button" class="erp-btn erp-btn--sm" data-v2-order-print="${esc(o.doc_no || docNo)}">
                    <i class="ji" data-i="printer" aria-hidden="true"></i><span>طباعة الإيصال</span>
                  </button>
                  <button type="button" class="erp-btn erp-btn--sm erp-btn--ghost" data-v2-order-close>
                    <i class="ji" data-i="x" aria-hidden="true"></i><span>إغلاق</span>
                  </button>
                </div>
                <div class="erp-card__body erp-stack">
                  <div class="erp-emp-stats">
                    <div class="erp-emp-stat"><span class="erp-emp-stat__l">الوقت</span><span class="erp-emp-stat__v erp-tnum" dir="ltr">${esc(String(o.doc_time || '').slice(0, 5))}</span></div>
                    <div class="erp-emp-stat"><span class="erp-emp-stat__l">الوردية</span><span class="erp-emp-stat__v">${esc(o.shift_no || '—')}</span></div>
                    <div class="erp-emp-stat"><span class="erp-emp-stat__l">المنطقة</span><span class="erp-emp-stat__v">${esc(o.zone_name || o.table_name || '—')}</span></div>
                    <div class="erp-emp-stat"><span class="erp-emp-stat__l">الإجمالي</span><span class="erp-emp-stat__v">${money(o.total, currency)}</span></div>
                    <div class="erp-emp-stat"><span class="erp-emp-stat__l">الصافي</span><span class="erp-emp-stat__v">${money(o.net, currency)}</span></div>
                    <div class="erp-emp-stat"><span class="erp-emp-stat__l">الخصم</span><span class="erp-emp-stat__v">${money(o.discount, currency)}</span></div>
                    <div class="erp-emp-stat"><span class="erp-emp-stat__l">الضريبة</span><span class="erp-emp-stat__v">${money(o.vat, currency)}</span></div>
                    <div class="erp-emp-stat"><span class="erp-emp-stat__l">المدفوع</span><span class="erp-emp-stat__v">${money(o.payed, currency)}</span></div>
                    <div class="erp-emp-stat"><span class="erp-emp-stat__l">نقدًا</span><span class="erp-emp-stat__v">${money(o.pay_cash, currency)}</span></div>
                    <div class="erp-emp-stat"><span class="erp-emp-stat__l">شبكة</span><span class="erp-emp-stat__v">${money(o.pay_network, currency)}</span></div>
                  </div>
                  <div class="erp-tbl-wrap" style="overflow-x:auto">
                    <table class="erp-tbl">
                      <thead><tr><th>#</th><th>الصنف</th><th>الكمية</th><th>السعر</th><th>الإجمالي</th></tr></thead>
                      <tbody>${linesHtml || '<tr><td colspan="5" class="erp-text-muted erp-text-center">لا توجد سطور مفصلة</td></tr>'}</tbody>
                    </table>
                  </div>
                </div>
              </div>`;
        } catch (e) {
            if (!el.isConnected) {return;}
            detailHost.innerHTML = `<div class="erp-card erp-card--subtle" style="margin-top:14px"><div class="erp-card__body erp-text-danger">تعذر جلب تفاصيل الفاتورة: ${esc((e && e.message) || 'خطأ')}</div></div>`;
        }
    }

    async function printOrderReceipt(docNo) {
        try {
            const data = await fetchOrderDetail(docNo);
            const o = (data && data.order) || {};
            const lines = Array.isArray(o.lines) ? o.lines : [];
            const linesHtml = lines.map((l, i) => `
              <tr><td>${i + 1}</td><td style="text-align:start">${esc(l.name || '—')}</td>
              <td>${formatInt(l.qty)}</td><td>${formatMoney(l.price).amount}</td><td>${formatMoney(l.total).amount}</td></tr>`).join('');
            const w = openInAppReport(`فاتورة ${esc(o.doc_no || docNo)}`);
            if (!w) { notify('تعذر فتح عارض الطباعة'); return; }
            w.document.write(`<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="UTF-8"><title>فاتورة ${esc(o.doc_no || docNo)}</title>
            <style>body{font-family:'Cairo',Tahoma,sans-serif;padding:20px;max-width:400px;margin:0 auto;color:#111}
            h2{text-align:center;font-size:18px;margin:4px 0}h3{text-align:center;font-size:13px;color:#555;margin:2px 0 10px}
            table{width:100%;border-collapse:collapse;font-size:12px;margin-top:8px}th,td{border:1px solid #333;padding:4px 6px;text-align:center}
            th{background:#f0f0f0}.meta{font-size:12px;line-height:1.8}.meta b{display:inline-block;min-width:70px}
            .tot{margin-top:10px;border:2px solid #333;padding:8px;font-size:13px}.tot div{display:flex;justify-content:space-between;margin:2px 0}
            @media print{body{padding:0}}</style></head><body>
            <h2>مطاعم الشرفة العالمي</h2><h3>فاتورة رقم: ${esc(o.doc_no || docNo)}</h3>
            <div class="meta">
              <div><b>التاريخ:</b> ${esc(o.doc_date || '')} — <b dir="ltr">${esc(String(o.doc_time || '').slice(0, 5))}</b></div>
              <div><b>الكاشير:</b> ${esc(o.cashier_name || o.cashier_no || '')}</div>
              <div><b>الوردية:</b> ${esc(o.shift_no || '—')}</div>
              <div><b>المنطقة:</b> ${esc(o.zone_name || o.table_name || '—')}</div>
            </div>
            <table><thead><tr><th>#</th><th>الصنف</th><th>كمية</th><th>سعر</th><th>إجمالي</th></tr></thead><tbody>${linesHtml}</tbody></table>
            <div class="tot">
              <div><span>الإجمالي:</span><b>${formatMoney(o.total).amount}</b></div>
              <div><span>الخصم:</span><b>${formatMoney(o.discount).amount}</b></div>
              <div><span>الضريبة:</span><b>${formatMoney(o.vat).amount}</b></div>
              <div><span>الصافي:</span><b>${formatMoney(o.net).amount}</b></div>
              <div style="border-top:1px solid #333;padding-top:4px;margin-top:4px"><span>المدفوع:</span><b style="font-size:15px">${formatMoney(o.payed).amount}</b></div>
              <div><span>نقدًا:</span><b>${formatMoney(o.pay_cash).amount}</b></div>
              <div><span>شبكة:</span><b>${formatMoney(o.pay_network).amount}</b></div>
            </div>
            <p style="text-align:center;font-size:11px;margin-top:10px;color:#777">تاريخ الطباعة: ${new Date().toLocaleString('ar-EG')}</p>
            </body></html>`);
            w.document.close();
            w.focus();
        } catch (e) {
            notify('تعذر طباعة الأوردر: ' + ((e && e.message) || 'خطأ'));
        }
    }

    el.addEventListener('click', (event) => {
        const viewBtn = event.target.closest('[data-v2-order-view]');
        if (viewBtn) {openOrderDetail(viewBtn.dataset.v2OrderView); return;}
        const printBtn = event.target.closest('[data-v2-order-print]');
        if (printBtn) {printOrderReceipt(printBtn.dataset.v2OrderPrint); return;}
        if (event.target.closest('[data-v2-order-close]')) {
            const host3 = q('[data-v2-order-detail]');
            if (host3) {host3.innerHTML = '';}
            return;
        }
        const t = event.target.closest('[data-v2-tab]');
        if (t) {
            tab = t.dataset.v2Tab;
            paintTabs();
            const host2 = q('[data-v2-table]');
            host2.innerHTML = '';
            host2.appendChild(tab === 'orders' ? ordersTable.el : analysisTable.el);
            reload();
            return;
        }
        if (event.target.closest('[data-v2-next]')) {reload({ pageShift: 1 }); return;}
        if (event.target.closest('[data-v2-prev]')) {reload({ pageShift: -1 }); return;}
        if (event.target.closest('[data-v2-reload]')) {reload(); return;}
        if (event.target.closest('[data-v2-excel]')) {exportExcel(); return;}
        if (event.target.closest('[data-v2-print]')) {window.print(); return;}
        if (event.target.closest('[data-erp-retry]')) {reload();}
    });
    el.addEventListener('change', (event) => {
        if (event.target.matches('#v2sa-cashier, [data-v2-group]')) {reload(); return;}
        if (event.target.matches('#v2sa-from, #v2sa-to')) {reload();}
    });
    el.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' && event.target.matches('#v2sa-item')) {reload();}
    });

    paintTabs();
    reload();

    return {
        el,
        reload,
        getRows: () => (tab === 'orders' ? orders : rows),
        destroy() {
            analysisTable.destroy();
            ordersTable.destroy();
            el.remove();
        },
    };
}
