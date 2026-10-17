/**
 * V2 — Sales analyzer screen · تحليل مبيعات الكاشيرية (قراءة فقط)
 * ═══════════════════════════════════════════════════════════════════════
 * تبويبان: تحليل مجمّع (بصنف/كاشير/يوم) + الأوردرات المفصّلة بترقيم.
 * باب واحد لكل تبويب من yara-reports-repo، والمدى المعكوس/الواسع بوابة
 * محلية قبل أي طلب (نفس قاعدة 04/07/08). الصلاحية قرار الخادم.
 */

import { createDataTable } from '../data-display/data-table.js?v=4.9.147';
import { formatInt, formatMoney } from '../data/reports-repo.js?v=4.9.147';
import {
    fetchItemSales, fetchYaraOrders, rangeError, analysisLabel, safeTotals,
    SA_GROUPS,
} from '../data/yara-reports-repo.js?v=4.9.147';

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
            <p class="erp-text-sm erp-text-muted">
              قراءة فقط — المصدر مرآة المبيعات المحلية
              (<span class="erp-addr" dir="ltr">/api/yara-reports/item-sales</span> و
              <span class="erp-addr" dir="ltr">/orders</span>) — لا Oracle ولا كتابة.
              سقف المدى 93 يومًا بقرار الخادم؛ المبيعات صافي بعد المرتجعات.
            </p>
            <div data-v2-table></div>
          </div>
        </section>
      </div>`;
}

export function mountSalesAnalyzerScreen(host, _ctx = {}) {
    let tab = 'analysis';
    let rows = [];
    let orders = [];
    let ordersTotal = 0;
    let ordersPage = 0;
    const currency = '';
    let loading = false;

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
                render: (r) => `<span class="erp-num" dir="ltr">${esc(r.doc_no ?? r.id ?? '—')}</span>` },
            { key: 'doc_date', header: 'التاريخ', sortable: true, width: '120px', align: 'center', className: 'erp-tnum' },
            { key: 'cashier_name', header: 'الكاشير', sortable: true, filterable: true },
            { key: 'lines_count', header: 'أصناف', type: 'number', width: '100px', align: 'end', value: (r) => r.lines_count ?? 0,
                render: (r) => `<span class="erp-num" dir="ltr">${formatInt(r.lines_count ?? 0)}</span>` },
            { key: 'net', header: 'الصافي', type: 'number', width: '140px', align: 'end', value: (r) => r.net,
                render: (r) => money(r.net, currency) },
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
                rows = (data.rows || []).map((r) => ({
                    label: analysisLabel(r, f.group),
                    code: f.group === 'item' && r.item_code ? String(r.item_code) : '',
                    invoices: Number(r.invoices) || 0, qty: Number(r.qty) || 0,
                    net: Number(r.net) || 0, vat: Number(r.vat) || 0,
                }));
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

    el.addEventListener('click', (event) => {
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
