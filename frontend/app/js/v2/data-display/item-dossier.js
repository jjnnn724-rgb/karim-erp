/**
 * V2 — Item dossier · بطاقة الصنف الكاملة (قراءة فقط)
 * ═══════════════════════════════════════════════════════════════════════
 * يُبنى من /api/inventory-inquiry/item/:id وحده: حقائق الصنف، كاردكس برصيد
 * جاري حقيقي، فواتير دخوله، الأقسام التي انصرف لها، دُفعات الصلاحية، وخطوط
 * بيع الكاشيرية. لا حساب تجاري هنا: كل رقم يأتي مسمّى بمصدره من الخادم،
 * وهذا الملف يعرض ويوسم — لا يجمع ولا يقارن مصادر مختلفة في رقم واحد.
 *
 * يقيم في طبقة العرض المشتركة لا في screens/: لأنه لا شاشة قائمة بذاتها يُركِّبها
 * المضيف، بل قطعة يُستدعى منها مكانان — شاشة «البطاقة الفاخرة» (professional)
 * كمُحمِّل كامل، ومحرك الاستعلامات كبطاقة تحت الجدول عند النقر على صنف — فلا
 * نسخة ثانية من العقد في مكان ثانٍ، ولا شاشة ميتة في شجرة screens/.
 */

import { createDataTable } from './data-table.js?v=4.9.193';
import { barChart, donutChart, lineChart } from '../charts.js?v=4.9.193';
import { fetchCurrency, formatInt, formatMoney, formatQty } from '../data/reports-repo.js?v=4.9.193';
import { fetchInquiryItem, expiryState } from '../data/inventory-inquiry-repo.js?v=4.9.193';

const esc = (v) => String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const num = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
};

function moneyCell(v, currency, signed = false) {
    const m = formatMoney(v, currency);
    const cls = signed && Number(v) < 0 ? ' erp-text-danger' : '';
    return `<span class="erp-num${cls}" dir="ltr">${m.amount}</span>`
        + (m.hasUnit ? ` <span class="erp-text-sm erp-text-muted">${esc(m.unit)}</span>` : '');
}

/** رقم كمية بوحدة الصنف نفسها — لا وحدة عامة مُختَرَعة. */
function qtyCell(v, unit) {
    return `<span class="erp-num" dir="ltr">${formatQty(v)}</span>`
        + (unit ? ` <span class="erp-text-sm erp-text-muted">${esc(unit)}</span>` : '');
}

/** وسم نوع الحركة كما يسجله الدفتر — بأسماء عربية ثابتة لا تُترجم آليًا. */
const TYPE_AR = {
    opening_balance: 'رصيد افتتاحي', purchase_receipt: 'استلام شراء', transfer_out: 'تحويل صادر',
    transfer_in: 'تحويل وارد', sale_consumption: 'استهلاك بيع', production_consumption: 'استهلاك إنتاج',
    production_output: 'إنتاج', waste: 'هدر', return: 'مرتجع', adjustment: 'تسوية',
    count_correction: 'فرق جرد', reversal: 'عكس', receiving_variance: 'فارق استلام',
    other_approved_movement: 'حركة معتمدة',
};

const typeBadge = (row) => {
    const label = TYPE_AR[row.type] || row.type || '—';
    const tone = row.delta < 0 ? 'danger' : (row.delta > 0 ? 'success' : 'neutral');
    return `<span class="erp-badge" data-tone="${tone}">${esc(label)}</span>`;
};

function kpiCard(label, en, body, icon) {
    return `<li class="erp-kpi">
      <div class="erp-kpi__top">
        <span class="erp-kpi__icon" aria-hidden="true"><i class="ji" data-i="${esc(icon)}"></i></span>
        <span class="erp-kpi__label">${esc(label)}<span class="erp-eyebrow" dir="ltr" lang="en">${esc(en)}</span></span>
      </div>
      <div class="erp-kpi__value">${body}</div>
    </li>`;
}

function section(title, en, bodyHtml, extra = '') {
    return `<section class="erp-card">
      <div class="erp-card__head">
        <h3 class="erp-card__title">${esc(title)}<span class="erp-eyebrow" dir="ltr" lang="en">${esc(en)}</span></h3>
        ${extra}
      </div>
      <div class="erp-card__body erp-stack">${bodyHtml}</div>
    </section>`;
}

/**
 * @param {ParentNode} host
 * @param {{itemId:number|string, from:string, to:string, ctx?:object, compact?:boolean}} opts
 * @returns {{el:HTMLElement, reload:()=>Promise<void>, destroy:()=>void, getData:()=>object|null}}
 */
export function mountItemDossier(host, { itemId, from, to, ctx = {}, compact = false } = {}) {
    let currentId = itemId;
    let data = null;
    let currency = '';
    let loading = false;
    const notify = typeof ctx.notify === 'function' ? ctx.notify : (m) => console.info('[V2 dossier]', m);

    const el = document.createElement('div');
    el.className = 'erp-v2-dossier';
    if (compact) {el.classList.add('is-compact');}
    el.innerHTML = `
      <div class="erp-v2-dossier__id" data-v2-id></div>
      <ul class="erp-kpis" data-v2-kpis aria-label="أرقام الصنف"></ul>
      <div class="erp-v2-dossier__charts" data-v2-charts></div>
      <div class="erp-v2-dossier__panels" data-v2-panels></div>
      <p class="erp-text-sm erp-text-muted" data-v2-note></p>`;
    host.appendChild(el);

    const q = (sel) => el.querySelector(sel);

    /** اللوحات تُبنى وتُهدم مع كل صنف — لا إعادة استخدام جدول بصنف سابق. */
    let tables = [];

    function destroyPanels() {
        tables.forEach((t) => t.destroy());
        tables = [];
        q('[data-v2-panels]').innerHTML = '';
    }

    function paintIdentity(item, state) {
        q('[data-v2-id]').innerHTML = `
          <div class="erp-v2-dossier__name">
            <h3>${esc(item.name)}</h3>
            <div class="erp-v2-dossier__meta">
              <span class="erp-mini__sub">${esc(item.category || 'بلا تصنيف')} · ${esc(item.unit || 'وحدة')}</span>
              ${item.barcode ? `<span class="erp-mono" dir="ltr">${esc(item.barcode)}</span>` : ''}
              ${item.shelf ? `<span>رف: ${esc(item.shelf)}</span>` : ''}
            </div>
          </div>
          <div class="erp-v2-dossier__flags">
            ${item.lowStock ? '<span class="erp-badge" data-tone="danger">تحت الحد</span>' : ''}
            <span class="erp-badge" data-tone="${esc(state.tone || 'neutral')}">صلاحية: ${esc(state.ar)}</span>
          </div>`;
    }

    function paintKpis(item, d) {
        const p = d.purchases || {};
        const s = d.sales || {};
        q('[data-v2-kpis]').innerHTML = [
            kpiCard('الرصيد', 'On Hand', qtyCell(item.qty, item.unit), 'package'),
            kpiCard('قيمة المخزون', 'Stock Value', moneyCell(item.stockValue, currency), 'banknote'),
            kpiCard('داخل من الفواتير', 'Received', qtyCell(p.qty, item.unit), 'inbox'),
            kpiCard('تكلفة المشتريات', 'Purchase Cost', moneyCell(p.cost, currency), 'wallet'),
            kpiCard('مبيع بالكاشيرية (POS)', 'Sold · POS', qtyCell(s.pos, item.unit), 'receipt'),
            kpiCard('إيراد POS', 'Revenue · POS', moneyCell(s.net, currency), 'chart'),
        ].join('');
    }

    function paintCharts(d) {
        const cardex = (d.cardex || []).slice().reverse();
        const shown = cardex.slice(-30);
        const depts = d.departments || [];
        const moneyText = (v) => {
            const m = formatMoney(v, currency);
            return `${m.amount}${m.hasUnit ? ` ${m.unit}` : ''}`;
        };
        const byDay = new Map();
        (d.sales && d.sales.lines ? d.sales.lines : []).forEach((l) => {
            byDay.set(l.day, (byDay.get(l.day) || 0) + num(l.qty));
        });
        const days = [...byDay.keys()].sort();
        q('[data-v2-charts]').innerHTML = [
            lineChart({
                title: shown.length < cardex.length
                    ? `الرصيد الجاري — آخر ${shown.length} حركة من ${formatInt(cardex.length)}`
                    : 'الرصيد الجاري عبر الحركات',
                ariaLabel: 'خط الرصيد الجاري للصنف عبر الحركات',
                labels: shown.map((r) => r.date.slice(5)),
                series: [{ label: 'الرصيد', tone: 'brand', values: shown.map((r) => r.runningQty), fill: true }],
                formatValue: (v) => formatQty(v),
                emptyText: 'لا حركات في هذا المدى',
            }),
            donutChart({
                title: 'تكلفة المنصرف لكل قسم',
                ariaLabel: 'رسم دائري لتوزيع تكلفة الصرف على الأقسام',
                slices: depts.map((r) => ({ label: r.deptName || r.deptCode || '—', value: r.cost })),
                centerLabel: 'إجمالي الصرف',
                formatValue: moneyText,
                emptyText: 'لا صرف مسجل في هذا المدى',
            }),
            barChart({
                title: 'داخل · منصرف · مبيع',
                ariaLabel: 'أعمدة المقارنة بين داخل الصنف ومنصرفه ومبيعه',
                labels: [from && to ? `${from} ← ${to}` : 'الفترة'],
                series: [
                    { label: 'داخل', tone: 'success', values: [num((d.purchases || {}).qty)] },
                    { label: 'منصرف', tone: 'warning', values: [depts.reduce((a, r) => a + num(r.qty), 0)] },
                    { label: 'مبيع (POS)', tone: 'info', values: [num((d.sales || {}).pos)] },
                ],
                formatValue: (v) => formatQty(v),
                emptyText: 'لا أرقام في هذا المدى',
            }),
        ].join('')
            + (days.length > 1 ? lineChart({
                title: 'مبيعات الصنف بالعدد يوميًا (POS)',
                ariaLabel: 'خط مبيعات الصنف اليومية بعدد الوحدات',
                labels: days.map((x) => String(x).slice(5)),
                series: [{ label: 'العدد', tone: 'info', values: days.map((x) => byDay.get(x)) }],
                formatValue: (v) => formatQty(v),
            }) : '');
    }

    function addTable(host2, opts) {
        const t = createDataTable(opts);
        host2.appendChild(t.el);
        tables.push(t);
        return t;
    }

    function paintPanels(d) {
        destroyPanels();
        const panels = q('[data-v2-panels]');
        const item = d.item;

        const cardexHost = document.createElement('div');
        panels.insertAdjacentHTML('beforeend', section('كراسي الحركة', 'Cardex',
            '<div data-v2-cardex></div>',
            '<span class="erp-text-sm erp-text-muted">الرصيد الجاري محسوب من كامل التاريخ ثم تُعرض نافذة المدى — لا يُخترع رقم بداية.</span>'));
        panels.querySelector('[data-v2-cardex]').appendChild(cardexHost);
        addTable(cardexHost, {
            caption: 'حركات الدفتر — بيانات حية', mode: 'client', pageSize: 15, stickyHeader: true,
            emptyMessage: 'لا حركة في هذا المدى', rowKey: (r, i) => `${r.date}:${i}`,
            columns: [
                { key: 'date', header: 'اليوم', width: '110px', render: (r) => `<span class="erp-num" dir="ltr">${esc(r.date)}</span>` },
                { key: 'type', header: 'الحركة', filterable: true, render: (r) => typeBadge(r) },
                { key: 'delta', header: 'الكمية', type: 'number', width: '120px', align: 'end', value: (r) => r.delta,
                    render: (r) => `<span class="erp-num ${r.delta < 0 ? 'erp-text-danger' : 'erp-text-success'}" dir="ltr">${formatQty(r.delta)}</span>` },
                { key: 'runningQty', header: 'الرصيد بعده', type: 'number', width: '130px', align: 'end', value: (r) => r.runningQty,
                    render: (r) => `<span class="erp-num" dir="ltr">${formatQty(r.runningQty)}</span>` },
                { key: 'unitCost', header: 'سعر التكلفة', type: 'number', width: '130px', align: 'end', value: (r) => r.unitCost,
                    render: (r) => moneyCell(r.unitCost, currency) },
                { key: 'location', header: 'الموقع', render: (r) => esc(r.location || '—') },
                { key: 'ref', header: 'المرجع', width: '120px',
                    render: (r) => `<span class="erp-mono" dir="ltr">${esc(r.referenceType || '')}${r.referenceId ? ` #${esc(r.referenceId)}` : ''}</span>` },
                { key: 'expiryDate', header: 'الصلاحية', width: '110px',
                    render: (r) => (r.expiryDate ? `<span class="erp-num" dir="ltr">${esc(r.expiryDate)}</span>` : '<span class="erp-text-muted">—</span>') },
            ],
        }).setRows(d.cardex || []);

        const invHost = document.createElement('div');
        panels.insertAdjacentHTML('beforeend', section('فواتير الشراء', 'Purchase Invoices', '<div data-v2-inv></div>',
            '<span class="erp-text-sm erp-text-muted">من قيود الدفتر بعائلة الشراء — العدد والتكلفة صافيان مُوقّعان، والسالب هو العكس.</span>'));
        panels.querySelector('[data-v2-inv]').appendChild(invHost);
        addTable(invHost, {
            caption: 'فواتير الشراء لهذا الصنف', mode: 'client', pageSize: 10, stickyHeader: true,
            emptyMessage: 'لا فاتورة شراء في هذا المدى', rowKey: (r, i) => `${r.invoiceId}:${i}`,
            columns: [
                { key: 'invoiceNumber', header: 'الفاتورة', filterable: true,
                    render: (r) => esc(r.invoiceNumber || `#${r.invoiceId}`) },
                { key: 'day', header: 'اليوم', width: '110px', render: (r) => `<span class="erp-num" dir="ltr">${esc(r.day)}</span>` },
                { key: 'supplier', header: 'المورد', render: (r) => esc(r.supplier || '—') },
                { key: 'qty', header: 'العدد', type: 'number', width: '120px', align: 'end', value: (r) => r.qty,
                    render: (r) => `<span class="erp-num ${r.qty < 0 ? 'erp-text-danger' : ''}" dir="ltr">${formatQty(r.qty)}</span>` },
                { key: 'unitCost', header: 'سعر الوحدة', type: 'number', width: '130px', align: 'end', value: (r) => r.unitCost,
                    render: (r) => moneyCell(r.unitCost, currency) },
                { key: 'lineTotal', header: 'قيمة السطر', type: 'number', width: '140px', align: 'end', value: (r) => r.lineTotal,
                    render: (r) => moneyCell(r.lineTotal, currency, true) },
                { key: 'expiryDate', header: 'الصلاحية', width: '110px', render: (r) => (r.expiryDate ? `<span class="erp-num" dir="ltr">${esc(r.expiryDate)}</span>` : '<span class="erp-text-muted">—</span>') },
            ],
        }).setRows((d.purchases || {}).invoices || []);

        const deptHost = document.createElement('div');
        panels.insertAdjacentHTML('beforeend', section('انصرف لهذه الأقسام', 'By Department', '<div data-v2-dept></div>'));
        panels.querySelector('[data-v2-dept]').appendChild(deptHost);
        addTable(deptHost, {
            caption: 'صرف الأقسام من الدفتر', mode: 'client', pageSize: 10, stickyHeader: true,
            emptyMessage: 'لا صرف لأقسام في هذا المدى', rowKey: (r) => r.deptCode || r.deptName,
            columns: [
                { key: 'deptName', header: 'القسم', filterable: true, render: (r) => esc(r.deptName || r.deptCode || '—') },
                { key: 'qty', header: 'العدد', type: 'number', width: '130px', align: 'end', value: (r) => r.qty,
                    render: (r) => qtyCell(r.qty, item.unit) },
                { key: 'cost', header: 'التكلفة', type: 'number', width: '150px', align: 'end', value: (r) => r.cost,
                    render: (r) => moneyCell(r.cost, currency) },
                { key: 'docs', header: 'عدد السندات', type: 'number', width: '120px', align: 'end', value: (r) => r.docs,
                    render: (r) => `<span class="erp-num" dir="ltr">${formatInt(r.docs)}</span>` },
            ],
        }).setRows(d.departments || []);

        const batchHost = document.createElement('div');
        panels.insertAdjacentHTML('beforeend', section('دُفعات الصلاحية', 'Batches & Expiry', '<div data-v2-batch></div>',
            '<span class="erp-text-sm erp-text-muted">تُقرأ من عمود الدفعة في الدفتر — الحركات الداخلية تحمل آخر صلاحية معروفة، لا تاريخًا مُختَرَعا.</span>'));
        panels.querySelector('[data-v2-batch]').appendChild(batchHost);
        addTable(batchHost, {
            caption: 'الدفعات وتواريخ الصلاحية', mode: 'client', pageSize: 10, stickyHeader: true,
            emptyMessage: 'لا دُفعات مسجلة في هذا المدى', rowKey: (r, i) => `${r.expiryDate}:${r.lot}:${i}`,
            columns: [
                { key: 'expiryDate', header: 'الصلاحية', width: '120px',
                    render: (r) => (r.expiryDate ? `<span class="erp-num" dir="ltr">${esc(r.expiryDate)}</span>` : '<span class="erp-text-muted">بلا تاريخ</span>') },
                { key: 'state', header: 'الحالة', width: '140px',
                    render: (r) => { const st = expiryState(r.expiryDate, (data && data.to) || ''); return st.tone ? `<span class="erp-badge" data-tone="${esc(st.tone)}">${esc(st.ar)}</span>` : '<span class="erp-text-muted">—</span>'; } },
                { key: 'lot', header: 'رقم الدفعة', render: (r) => (r.lot ? `<span class="erp-mono" dir="ltr">${esc(r.lot)}</span>` : '<span class="erp-text-muted">—</span>') },
                { key: 'qty', header: 'العدد', type: 'number', width: '130px', align: 'end', value: (r) => r.qty,
                    render: (r) => qtyCell(r.qty, item.unit) },
                { key: 'postings', header: 'عدد القيود', type: 'number', width: '120px', align: 'end', value: (r) => r.postings,
                    render: (r) => `<span class="erp-num" dir="ltr">${formatInt(r.postings)}</span>` },
            ],
        }).setRows(d.batches || []);

        const salesHost = document.createElement('div');
        panels.insertAdjacentHTML('beforeend', section('خطوط بيع الكاشيرية', 'POS Lines', '<div data-v2-sales></div>',
            '<span class="erp-text-sm erp-text-muted">الربط بمعرّف الصنف لا بالاسم. مرآة يارا تُقرأ بالاسم وحده ولا تُجمع مع هذا الرقم.</span>'));
        panels.querySelector('[data-v2-sales]').appendChild(salesHost);
        addTable(salesHost, {
            caption: 'أسطر البيع من نظام الكاشير', mode: 'client', pageSize: 10, stickyHeader: true,
            emptyMessage: 'لا أسطر بيع لهذا الصنف في هذا المدى', rowKey: (r, i) => `${r.orderId}:${i}`,
            columns: [
                { key: 'day', header: 'اليوم', width: '110px', render: (r) => `<span class="erp-num" dir="ltr">${esc(r.day)}</span>` },
                { key: 'orderId', header: 'الأوردر', width: '170px', render: (r) => `<span class="erp-mono" dir="ltr">${esc(r.orderId)}</span>` },
                { key: 'dept', header: 'القسم', filterable: true, render: (r) => esc(r.dept || '—') },
                { key: 'cashier', header: 'الكاشير', render: (r) => esc(r.cashier || '—') },
                { key: 'qty', header: 'العدد', type: 'number', width: '120px', align: 'end', value: (r) => r.qty,
                    render: (r) => qtyCell(r.qty, item.unit) },
                { key: 'unitPrice', header: 'السعر', type: 'number', width: '130px', align: 'end', value: (r) => r.unitPrice,
                    render: (r) => moneyCell(r.unitPrice, currency) },
                { key: 'lineTotal', header: 'الإجمالي', type: 'number', width: '140px', align: 'end', value: (r) => r.lineTotal,
                    render: (r) => moneyCell(r.lineTotal, currency) },
            ],
        }).setRows((d.sales || {}).lines || []);
    }

    function errorState(message) {
        destroyPanels();
        q('[data-v2-id]').innerHTML = '';
        q('[data-v2-kpis]').innerHTML = '';
        q('[data-v2-charts]').innerHTML = '';
        q('[data-v2-note]').textContent = '';
        q('[data-v2-panels]').innerHTML = `<div class="erp-state erp-state--error" role="alert">
            <span class="erp-state__title">بطاقة الصنف</span><span>${esc(message)}</span>
            <button type="button" class="erp-btn erp-btn--sm" data-erp-retry>إعادة المحاولة</button></div>`;
    }

    async function reload() {
        if (loading || !currentId) {return;}
        loading = true;
        q('[data-v2-note]').textContent = 'جارٍ قراءة الدفتر…';
        try {
            const [payload, cur] = await Promise.all([
                fetchInquiryItem(currentId, { from, to }),
                fetchCurrency().catch(() => ''),
            ]);
            if (!el.isConnected) {return;}
            data = payload;
            currency = String(cur ?? '');
            const item = payload.item || {};
            const firstExpiry = (payload.batches || []).map((b) => b.expiryDate).filter(Boolean).sort()[0] || null;
            const state = expiryState(firstExpiry, payload.to);
            paintIdentity(item, state);
            paintKpis(item, payload);
            paintCharts(payload);
            paintPanels(payload);
            q('[data-v2-note]').textContent = `المدى ${from} ← ${to} · الحركات المعروضة ${formatInt((payload.cardex || []).length)} · مصدر الحركة inventory_ledger`
                + ` · المبيع من أسطر POS بالمعرّف · الصلاحية من عمود الدفعة في الدفتر`;
            notify(`بطاقة «${item.name || currentId}» جاهزة`);
        } catch (e) {
            if (!el.isConnected) {return;}
            data = null;
            const msg = e && e.message === 'UNAUTHORIZED'
                ? 'انتهت الجلسة — سجّل الدخول في النظام الحالي ثم أعد فتح البطاقة.'
                : (e && e.code === 'ITEM_NOT_FOUND'
                    ? 'الصنف غير موجود في المخزون — ربما حُذف أو تغيّر معرّفه.'
                    : `تعذّر بناء البطاقة: ${(e && e.message) || 'خطأ'}`);
            errorState(msg);
        } finally {
            loading = false;
        }
    }

    el.addEventListener('click', (event) => {
        if (event.target.closest('[data-erp-retry]')) {reload();}
    });

    reload();

    return {
        el,
        reload,
        getData: () => data,
        setItem(nextId, range = {}) {
            currentId = nextId;
            if (range.from) {from = range.from;}
            if (range.to) {to = range.to;}
            reload();
        },
        destroy() {
            destroyPanels();
            el.remove();
        },
    };
}
