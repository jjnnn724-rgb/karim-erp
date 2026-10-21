/**
 * V2 — Inventory query engine · محرك الاستعلامات (قراءة فقط)
 * ═══════════════════════════════════════════════════════════════════════
 * يطرح أسئلة المالك بحروفه: «أي صنف دخل من الفواتير وكم عدده؟»، «واللي في
 * المخزن واللي تم صرفه؟»، «أي صنف كم منه اتبع؟»، «كم الكوست العام وكم كوست
 * أي قسم؟». كل إجابة تأتي من /api/inventory-inquiry — الخادم يجمّع من دفتر
 * المخزون، وهذا الملف لا يحسب رقمًا ولا يمزج مصدرين.
 *
 * TWO NUMBERS THAT MUST NEVER BECOME ONE
 *   soldPos  = أسطر الكاشيرية مربوطة بالمعرّف (حقيقة).
 *   soldYara = مرآة يارا سوفت مربوطة بالاسم المطبَّع (تقريب مُعلَّن).
 *   يظهران بعمودين مسمّيين، ولا يُجمعان في خلايا ولا في بطاقة.
 *
 * ROW → CARD
 *   النقر على صنف (أو Enter) يفتح بطاقة الصنف الكاملة تحت الجدول عبر
 *   mountItemDossier — نفس المُحمِّل الذي تستخدمه شاشة «البطاقة الفاخرة»،
 *   فلا عقدَ ثانٍ ولا نسخةَ ثانية.
 *
 * الصلاحية قرار الخادم (admin + sous_chef أو من مُنح inventory-inquiry.view).
 */

import { createDataTable } from '../data-display/data-table.js?v=4.9.181';
import { barChart, donutChart } from '../charts.js?v=4.9.181';
import { fetchCurrency, formatInt, formatMoney, formatQty } from '../data/reports-repo.js?v=4.9.181';
import {
    fetchInquiryItems, fetchInquiryDepartments, engineKpis, expiryState,
    toExportAoa, deptCostSummary, rangeError, INQ_FILTERS,
} from '../data/inventory-inquiry-repo.js?v=4.9.181';
import { mountItemDossier } from '../data-display/item-dossier.js?v=4.9.181';
import { ensureXlsx } from '../vendor.js?v=4.9.181';
import { prepareReportWorkbook } from '../report-export.js?v=4.9.181';

const esc = (v) => String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const num = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
};

function todayIso(offset = 0) {
    const d = new Date();
    d.setDate(d.getDate() + offset);
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function moneyCell(v, currency, signed = false) {
    const m = formatMoney(v, currency);
    const cls = signed && Number(v) < 0 ? ' erp-text-danger' : '';
    return `<span class="erp-num${cls}" dir="ltr">${m.amount}</span>`
        + (m.hasUnit ? ` <span class="erp-text-sm erp-text-muted">${esc(m.unit)}</span>` : '');
}

function template(from, to) {
    return `
      <div class="erp-v2-inq">
        <div class="erp-dash-head">
          <div>
            <h2 class="erp-dash-title">محرك الاستعلامات
              <span class="erp-eyebrow" dir="ltr" lang="en">Inventory Query</span>
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
              <i class="ji" data-i="refresh" aria-hidden="true"></i><span>استعلام</span>
            </button>
          </div>
        </div>

        <div class="erp-filterbar erp-no-print">
          <label class="erp-text-sm erp-text-muted" for="v2inq-from">من</label>
          <input class="erp-input erp-input--ltr" id="v2inq-from" type="date" value="${esc(from)}">
          <label class="erp-text-sm erp-text-muted" for="v2inq-to">إلى</label>
          <input class="erp-input erp-input--ltr" id="v2inq-to" type="date" value="${esc(to)}" max="${esc(todayIso(0))}">
          <span class="erp-seg" role="group" aria-label="فترة مسبقة">
            <button type="button" data-v2-preset="today">اليوم</button>
            <button type="button" data-v2-preset="yesterday">أمس</button>
            <button type="button" data-v2-preset="7">7 أيام</button>
            <button type="button" data-v2-preset="30" class="is-active">30 يوم</button>
          </span>
          <label class="erp-text-sm erp-text-muted" for="v2inq-dept">مخزن القسم</label>
          <select class="erp-input" id="v2inq-dept">
            <option value="">المخزن الرئيسي وكل الأقسام</option>
          </select>
          <label class="erp-text-sm erp-text-muted" for="v2inq-q">بحث</label>
          <input class="erp-input" id="v2inq-q" type="search" placeholder="اسم أو تصنيف أو باركود" autocomplete="off">
          <label class="erp-text-sm erp-text-muted" for="v2inq-cat">تصنيف</label>
          <select class="erp-input" id="v2inq-cat"><option value="">الكل</option></select>
          <label class="erp-text-sm erp-text-muted" for="v2inq-only">الحالة</label>
          <select class="erp-input" id="v2inq-only">
            <option value="all">كل الأصناف</option>
            <option value="moved">تحركت في المدى</option>
            <option value="active">موجودة أو متحركة</option>
            <option value="low">تحت الحد</option>
            <option value="expired">صلاحية منتهية</option>
          </select>
          <label class="erp-text-sm erp-text-muted" for="v2inq-sort">ترتيب</label>
          <select class="erp-input" id="v2inq-sort">
            <option value="movements">الأكثر حركة</option>
            <option value="onHand">الأعلى رصيدًا</option>
            <option value="value">الأعلى قيمة</option>
            <option value="qtyIn">الأكثر دخولًا</option>
            <option value="qtyOut">الأكثر انصرافًا</option>
            <option value="sold">الأكثر مبيعًا</option>
            <option value="cost">الأعلى كوستًا</option>
            <option value="expiry">أقرب صلاحية</option>
            <option value="name">الاسم</option>
          </select>
        </div>

        <div data-v2-kpis></div>

        <div class="erp-v2-inq__charts erp-v2-chart-grid" data-v2-charts></div>

        <section class="erp-card">
          <div class="erp-card__head">
            <h3 class="erp-card__title">الأصناف
              <span class="erp-eyebrow" dir="ltr" lang="en">Items</span>
              <span class="erp-text-muted erp-text-sm" data-v2-count></span>
            </h3>
          </div>
          <div class="erp-card__body erp-stack">
            <p class="erp-text-sm erp-text-muted">
              قراءة فقط من دفتر المخزون (<span class="erp-addr" dir="ltr">/api/inventory-inquiry/items</span>) —
              انقر صنفًا أو اضغط Enter لفتح بطاقته الكاملة بالأسفل. المبيع بالعدد (POS) ربطٌ بالمعرّف،
              ومقابلُه في مرآة يارا ربطٌ بالاسم: عمودان مسمّيان لا رقم واحد.
            </p>
            <div data-v2-table></div>
          </div>
        </section>

        <div data-v2-dossier></div>

        <section class="erp-card">
          <div class="erp-card__head">
            <h3 class="erp-card__title">تكلفة الأقسام والكوست العام
              <span class="erp-eyebrow" dir="ltr" lang="en">Department Cost</span>
            </h3>
          </div>
          <div class="erp-card__body erp-stack">
            <p class="erp-text-sm erp-text-muted" data-v2-dept-note role="status" aria-live="polite"></p>
            <ul class="erp-kpis" data-v2-dept-kpis aria-label="إجماليات التكلفة"></ul>
            <div class="erp-v2-chart-grid" data-v2-dept-charts></div>
            <div data-v2-dept-table></div>
          </div>
        </section>
      </div>`;
}

/**
 * @param {ParentNode} host
 * @param {{role?:string|null, notify?:(m:string,k?:string)=>void, navigate?:(key:string)=>void}} [ctx]
 */
export function mountQueryScreen(host, ctx = {}) {
    let rows = [];
    let deptPayload = null;
    let currency = '';
    let loading = false;
    let exporting = false;
    let dossier = null;
    let searchTimer = null;
    const notify = typeof ctx.notify === 'function' ? ctx.notify : (m) => console.info('[V2 query]', m);

    host.insertAdjacentHTML('beforeend', template(todayIso(-29), todayIso(0)));
    const el = host.lastElementChild;
    const q = (sel) => el.querySelector(sel);
    const scopeLine = q('[data-v2-scope-line]');
    const kpisHost = q('[data-v2-kpis]');
    const chartsHost = q('[data-v2-charts]');
    const deptNote = q('[data-v2-dept-note]');

    const table = createDataTable({
        caption: 'أصناف المخزون — حركة الدخول والانصراف والمبيع', mode: 'client', pageSize: 20,
        stickyHeader: true, onRowActivate: (row) => openDossier(row),
        emptyMessage: 'لا أصناف تطابق المرشّحات', emptyHint: 'وسّع المدى أو امسح البحث.',
        rowKey: (row) => row.itemId,
        columns: [
            { key: 'itemName', header: 'الصنف', sortable: true, filterable: true,
                render: (r) => esc(r.itemName)
                    + (r.category ? `<span class="erp-mini__sub">${esc(r.category)}</span>` : '') },
            { key: 'unit', header: 'الوحدة', width: '90px', render: (r) => esc(r.unit || '—') },
            { key: 'onHand', header: 'الرصيد', type: 'number', width: '120px', align: 'end', value: (r) => r.onHand,
                render: (r) => `<span class="erp-num" dir="ltr">${formatQty(r.onHand)}</span>` },
            { key: 'qtyInPurchases', header: 'دخل من الفواتير', type: 'number', width: '150px', align: 'end',
                value: (r) => r.qtyInPurchases,
                render: (r) => `<span class="erp-num ${r.qtyInPurchases < 0 ? 'erp-text-danger' : ''}" dir="ltr">${formatQty(r.qtyInPurchases)}</span>` },
            { key: 'qtyOutTotal', header: 'المنصرف', type: 'number', width: '120px', align: 'end', value: (r) => r.qtyOutTotal,
                render: (r) => `<span class="erp-num" dir="ltr">${formatQty(r.qtyOutTotal)}</span>` },
            { key: 'qtyNet', header: 'صافي الحركة', type: 'number', width: '130px', align: 'end', value: (r) => r.qtyNet,
                render: (r) => `<span class="erp-num ${r.qtyNet < 0 ? 'erp-text-danger' : 'erp-text-success'}" dir="ltr">${formatQty(r.qtyNet)}</span>` },
            { key: 'soldPos', header: 'مبيع (POS · معرّف)', type: 'number', width: '150px', align: 'end', value: (r) => r.soldPos,
                render: (r) => `<span class="erp-num" dir="ltr">${formatQty(r.soldPos)}</span>` },
            { key: 'soldYara', header: 'مبيع (يارا · اسم)', type: 'number', width: '150px', align: 'end', value: (r) => r.soldYara,
                render: (r) => `<span class="erp-num erp-text-muted" dir="ltr">${formatQty(r.soldYara)}</span>`
                    + (r.yaraMatched ? '' : ' <span class="erp-badge" data-tone="neutral">بلا مطابقة</span>') },
            { key: 'purchaseCost', header: 'كوست الشراء', type: 'number', width: '140px', align: 'end', value: (r) => r.purchaseCost,
                render: (r) => moneyCell(r.purchaseCost, currency, true) },
            { key: 'stockValue', header: 'قيمة المخزون', type: 'number', width: '140px', align: 'end', value: (r) => r.stockValue,
                render: (r) => moneyCell(r.stockValue, currency) },
            { key: 'nearestExpiry', header: 'الصلاحية', width: '140px',
                render: (r) => {
                    const st = expiryState(r.nearestExpiry, filters().to);
                    return st.tone
                        ? `<span class="erp-badge" data-tone="${esc(st.tone)}">${esc(st.ar)}</span>`
                        : '<span class="erp-text-muted">—</span>';
                } },
            { key: 'open', header: '', width: '110px', align: 'center',
                render: (r) => `<button type="button" class="erp-btn erp-btn--sm" data-v2-card data-v2-item="${esc(r.itemId)}">البطاقة</button>` },
        ],
    });
    q('[data-v2-table]').appendChild(table.el);

    /** تكلفة الأقسام — جدول واحد يُنشأ عند التركيب ويُملأ بالبيانات فقط. */
    const deptTable = createDataTable({
        caption: 'تكلفة الأقسام — بيانات حية', mode: 'client', pageSize: 20, stickyHeader: true,
        emptyMessage: 'لا أقسام في هذا المدى', emptyHint: 'أعد تحميل المدى أو امسح القسم.',
        rowKey: (r) => r.code,
        columns: [
            { key: 'name', header: 'القسم', sortable: true, filterable: true,
                render: (r) => esc(r.name) + (r.parentCode ? `<span class="erp-mini__sub">${esc(r.parentCode)}</span>` : '') },
            { key: 'issuedQty', header: 'منصرف (عدد)', type: 'number', width: '130px', align: 'end', value: (r) => r.issuedQty,
                render: (r) => `<span class="erp-num" dir="ltr">${formatQty(r.issuedQty)}</span>` },
            { key: 'issuedCost', header: 'تكلفة الصرف', type: 'number', width: '150px', align: 'end', value: (r) => r.issuedCost,
                render: (r) => moneyCell(r.issuedCost, currency) },
            { key: 'expenseOperating', header: 'تشغيلي', type: 'number', width: '140px', align: 'end', value: (r) => r.expenseOperating,
                render: (r) => moneyCell(r.expenseOperating, currency) },
            { key: 'expenseStock', header: 'سطور مخزنية (غير محسوبة)', type: 'number', width: '180px', align: 'end', value: (r) => r.expenseStock,
                render: (r) => `<span class="erp-num erp-text-muted" dir="ltr">${formatMoney(r.expenseStock, currency).amount}</span>` },
            { key: 'costTotal', header: 'تكلفة القسم', type: 'number', width: '150px', align: 'end', value: (r) => r.costTotal,
                render: (r) => `<strong class="erp-num" dir="ltr">${formatMoney(r.costTotal, currency).amount}</strong>` },
            { key: 'revenueManual', header: 'إيراد يدوي', type: 'number', width: '130px', align: 'end', value: (r) => r.revenueManual,
                render: (r) => moneyCell(r.revenueManual, currency) },
            { key: 'revenuePos', header: 'إيراد الكاشيرية', type: 'number', width: '150px', align: 'end', value: (r) => r.revenuePos,
                render: (r) => moneyCell(r.revenuePos, currency) },
        ],
    });
    q('[data-v2-dept-table]').appendChild(deptTable.el);

    function filters() {
        return {
            from: q('#v2inq-from').value,
            to: q('#v2inq-to').value,
            dept: q('#v2inq-dept').value,
            q: q('#v2inq-q').value.trim(),
            cat: q('#v2inq-cat').value,
            only: q('#v2inq-only').value,
            sort: q('#v2inq-sort').value,
        };
    }

    function openDossier(row) {
        if (!row || !row.itemId) {return;}
        const host2 = q('[data-v2-dossier]');
        const f = filters();
        if (dossier) {dossier.destroy();}
        host2.innerHTML = '';
        dossier = mountItemDossier(host2, {
            itemId: row.itemId, from: f.from, to: f.to, ctx: { notify }, compact: true,
        });
        host2.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    function paintKpis(totals) {
        kpisHost.innerHTML = `<ul class="erp-kpis" aria-label="إجماليات المحرك">`
            + engineKpis(totals, currency).map((k) => `<li class="erp-kpi">
                <div class="erp-kpi__top">
                  <span class="erp-kpi__icon" aria-hidden="true"><i class="ji" data-i="${esc(k.icon || 'chart')}"></i></span>
                  <span class="erp-kpi__label">${esc(k.label)}<span class="erp-eyebrow" dir="ltr" lang="en">${esc(k.en)}</span></span>
                </div>
                <div class="erp-kpi__value">
                  ${k.kind === 'money'
                    ? `<span class="erp-num" dir="ltr">${esc(k.amount)}</span>${k.hasUnit ? ` <span class="erp-text-sm erp-text-muted">${esc(k.unit)}</span>` : ''}`
                    : `<span class="erp-num" dir="ltr">${esc(k.value)}</span>`}
                </div>
              </li>`).join('') + `</ul>`;
    }

    function paintCharts() {
        const moneyText = (v) => {
            const m = formatMoney(v, currency);
            return `${m.amount}${m.hasUnit ? ` ${m.unit}` : ''}`;
        };
        const top = rows.slice()
            .sort((a, b) => (num(b.qtyOutTotal) + num(b.soldPos)) - (num(a.qtyOutTotal) + num(a.soldPos)))
            .slice(0, 8);
        const byCat = new Map();
        rows.forEach((r) => {
            const key = r.category || 'بلا تصنيف';
            byCat.set(key, (byCat.get(key) || 0) + num(r.stockValue));
        });
        chartsHost.innerHTML = [
            top.length ? barChart({
                title: rows.length > top.length
                    ? `أعلى ${top.length} صنفًا تحركًا — الجدول يعرض الجميع`
                    : 'داخل · منصرف · مبيع لكل صنف',
                ariaLabel: 'أعمدة مقارنة الدخول والانصراف والمبيع لأكثر الأصناف تحركًا',
                labels: top.map((r) => r.itemName),
                series: [
                    { label: 'دخل من الفواتير', tone: 'success', values: top.map((r) => r.qtyInPurchases) },
                    { label: 'المنصرف', tone: 'warning', values: top.map((r) => r.qtyOutTotal) },
                    { label: 'مبيع (POS)', tone: 'info', values: top.map((r) => r.soldPos) },
                ],
                formatValue: (v) => formatQty(v),
                emptyText: 'لا حركة في هذا المدى',
            }) : '',
            byCat.size ? donutChart({
                title: 'قيمة المخزون بالتصنيف',
                ariaLabel: 'رسم دائري لتوزيع قيمة المخزون على التصنيفات',
                slices: [...byCat.entries()].map(([label, value]) => ({ label, value })),
                centerLabel: 'إجمالي القيمة',
                formatValue: moneyText,
                maxSlices: 8,
                emptyText: 'لا قيمة مخزون محسوبة',
            }) : '',
        ].filter(Boolean).join('');
    }

    function fillDeptPicker(payload) {
        const sel = q('#v2inq-dept');
        const keep = sel.value;
        sel.innerHTML = '<option value="">المخزن الرئيسي وكل الأقسام</option>'
            + (payload.rows || []).map((d) => `<option value="${esc(d.code)}">${esc(d.name)}</option>`).join('');
        if ([...sel.options].some((o) => o.value === keep)) {sel.value = keep;}
    }

    function fillCatPicker() {
        const sel = q('#v2inq-cat');
        const keep = sel.value;
        const cats = [...new Set(rows.map((r) => r.category).filter(Boolean))].sort();
        sel.innerHTML = '<option value="">الكل</option>'
            + cats.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
        if (cats.includes(keep)) {sel.value = keep;}
    }

    function paintDept(noteOverride) {
        const rows2 = (deptPayload && deptPayload.rows) || [];
        const s = deptCostSummary(deptPayload || {});
        const un = (deptPayload && deptPayload.unattributed) || {};
        deptNote.textContent = deptPayload
            ? `تكلفة القسم = تكلفة ما انصرف له من الدفتر بسعر التكلفة + مصروفه التشغيلي فقط. `
                + `سطور مصروفات المخزون والجرد مستثناة لأنها نفس قيود الدفتر — جمعها يضاعف الرقم. `
                + `غير مُسند لقسم معروف: صرف ${formatMoney(un.issuedCost, currency).amount} ومصروف ${formatMoney(un.expenseOperating, currency).amount}.`
            : (noteOverride || 'جارٍ قراءة تكلفة الأقسام…');
        if (!deptPayload) {
            q('[data-v2-dept-kpis]').innerHTML = '';
            q('[data-v2-dept-charts]').innerHTML = '';
            deptTable.setRows([]);
            return;
        }
        q('[data-v2-dept-kpis]').innerHTML = [
            { label: 'الكوست العام', en: 'Total Cost', body: moneyCell(s.costTotal, currency), icon: 'wallet' },
            { label: 'تكلفة الصرف', en: 'Issued Cost', body: moneyCell(s.issuedCost, currency), icon: 'package' },
            { label: 'مصروف تشغيلي', en: 'Operating', body: moneyCell(s.expenseOperating, currency), icon: 'pen-tool' },
            { label: 'مصروف مخزني (غير محسوب)', en: 'Stock Rows', body: moneyCell(s.expenseStock, currency), icon: 'shield-check' },
            { label: 'قيمة المخزون', en: 'Stock Value', body: moneyCell(s.stockValue, currency), icon: 'banknote' },
            { label: 'أقسام', en: 'Departments', body: `<span class="erp-num" dir="ltr">${formatInt(s.departments)}</span>`, icon: 'building' },
        ].map((k) => `<li class="erp-kpi">
            <div class="erp-kpi__top"><span class="erp-kpi__icon" aria-hidden="true"><i class="ji" data-i="${esc(k.icon)}"></i></span>
            <span class="erp-kpi__label">${esc(k.label)}<span class="erp-eyebrow" dir="ltr" lang="en">${esc(k.en)}</span></span></div>
            <div class="erp-kpi__value">${k.body}</div></li>`).join('');

        const top = rows2.slice().sort((a, b) => num(b.costTotal) - num(a.costTotal)).slice(0, 8);
        q('[data-v2-dept-charts]').innerHTML = top.length ? barChart({
            title: `أعلى ${top.length} قسمًا في التكلفة`,
            ariaLabel: 'أعمدة تكلفة الأقسام: صرف المخزون مقابل المصروف التشغيلي',
            labels: top.map((r) => r.name),
            series: [
                { label: 'صرف من المخزون', tone: 'warning', values: top.map((r) => r.issuedCost) },
                { label: 'تشغيلي', tone: 'info', values: top.map((r) => r.expenseOperating) },
            ],
            formatValue: (v) => {
                const m = formatMoney(v, currency);
                return `${m.amount}${m.hasUnit ? ` ${m.unit}` : ''}`;
            },
            emptyText: 'لا تكلفة مسجلة في هذا المدى',
        }) : '';

        deptTable.setRows(rows2);
    }

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
            window.XLSX.utils.book_append_sheet(wb, window.XLSX.utils.aoa_to_sheet(toExportAoa(rows)), 'الأصناف');
            const deptAoa = [['القسم', 'منصرف (عدد)', 'تكلفة الصرف', 'تشغيلي', 'سطور مخزنية', 'تكلفة القسم', 'إيراد يدوي', 'إيراد الكاشيرية']];
            ((deptPayload && deptPayload.rows) || []).forEach((d) => deptAoa.push([
                d.name, d.issuedQty, d.issuedCost, d.expenseOperating, d.expenseStock, d.costTotal, d.revenueManual, d.revenuePos,
            ]));
            window.XLSX.utils.book_append_sheet(wb, window.XLSX.utils.aoa_to_sheet(deptAoa), 'تكلفة الأقسام');
            prepareReportWorkbook(window.XLSX, wb, `تقرير استعلام المخزون ${f.from} إلى ${f.to}`);
            window.XLSX.writeFile(wb, `inventory-inquiry_${f.from}_${f.to}.xlsx`);
            notify('تم تصدير Excel');
        } finally {
            exporting = false;
        }
    }

    function stateError(message) {
        rows = [];
        table.setRows([]);
        kpisHost.innerHTML = '';
        chartsHost.innerHTML = '';
        q('[data-v2-count]').textContent = '';
        table.setError(message);
    }

    async function reload() {
        if (loading) {return;}
        const f = filters();
        scopeLine.textContent = `${f.from} ← ${f.to}${f.dept ? ` · مخزن قسم: ${f.dept}` : ' · كل المواقع'}`;
        const gate = rangeError(f.from, f.to);
        if (!gate.ok) {
            stateError(gate.message);
            deptNote.textContent = gate.message;
            return;
        }
        if (!INQ_FILTERS.includes(f.only)) {f.only = 'all';}
        loading = true;
        table.setLoading(true);
        try {
            const [items, depts, cur] = await Promise.all([
                fetchInquiryItems({ ...f, limit: 500 }),
                fetchInquiryDepartments({ from: f.from, to: f.to }).catch(() => null),
                fetchCurrency().catch(() => ''),
            ]);
            if (!el.isConnected) {return;}
            currency = String(cur ?? '');
            rows = items.rows || [];
            deptPayload = depts;
            fillDeptPicker(depts || { rows: [] });
            fillCatPicker();
            paintKpis(items.totals || {});
            paintCharts();
            table.setRows(rows);
            q('[data-v2-count]').textContent = rows.length ? `(${formatInt(rows.length)} من ${formatInt((items.totals || {}).items || rows.length)})` : '';
            paintDept(depts ? undefined : 'تعذّرت قراءة تكلفة الأقسام لهذا المدى — بقية المحرك يعمل بأرقامه من الدفتر.');
            const y = (items.meta || {}).yara || {};
            scopeLine.textContent += ` · المرآة: ${formatInt(y.qtyMatched || 0)} من ${formatInt(y.qtyTotal || 0)} مطابقة بالاسم`;
        } catch (e) {
            if (!el.isConnected) {return;}
            const msg = e && e.message === 'UNAUTHORIZED'
                ? 'انتهت الجلسة — سجّل الدخول في النظام الحالي ثم أعد فتح المحرك.'
                : (e && e.code === 'RANGE_TOO_WIDE'
                    ? 'المدى أوسع مما يسمح الخادم — قلّصه إلى 93 يومًا أو أقل.'
                    : `تعذّر الاستعلام: ${(e && e.message) || 'خطأ'}`);
            deptPayload = null;
            paintDept('لا بيانات لتكلفة الأقسام — تعذّرت قراءة هذا المصدر، فلا تعرض أرقام صفرية توحي بأنها مطابقة.');
            stateError(msg);
        } finally {
            loading = false;
        }
    }

    function applyPreset(name) {
        if (name === 'today') {
            q('#v2inq-from').value = todayIso(0);
            q('#v2inq-to').value = todayIso(0);
        } else if (name === 'yesterday') {
            q('#v2inq-from').value = todayIso(-1);
            q('#v2inq-to').value = todayIso(-1);
        } else {
            const days = Math.max(1, num(name) - 1);
            q('#v2inq-from').value = todayIso(-days);
            q('#v2inq-to').value = todayIso(0);
        }
        reload();
    }

    el.addEventListener('click', (event) => {
        const preset = event.target.closest('[data-v2-preset]');
        if (preset) {
            [...el.querySelectorAll('[data-v2-preset]')].forEach((b) => b.classList.remove('is-active'));
            preset.classList.add('is-active');
            applyPreset(preset.dataset.v2Preset);
            return;
        }
        if (event.target.closest('[data-v2-reload]')) {reload(); return;}
        if (event.target.closest('[data-v2-excel]')) {exportExcel(); return;}
        if (event.target.closest('[data-v2-print]')) {window.print(); return;}
        if (event.target.closest('[data-erp-retry]')) {reload(); return;}
        const cardBtn = event.target.closest('[data-v2-card]');
        if (cardBtn) {
            const wanted = String(cardBtn.dataset.v2Item || '');
            openDossier(rows.find((r) => String(r.itemId) === wanted) || null);
            return;
        }
    });
    el.addEventListener('change', (event) => {
        if (event.target.matches('#v2inq-from, #v2inq-to, #v2inq-dept, #v2inq-cat, #v2inq-only, #v2inq-sort')) {reload();}
    });
    el.addEventListener('input', (event) => {
        if (!event.target.matches('#v2inq-q')) {return;}
        clearTimeout(searchTimer);
        searchTimer = setTimeout(reload, 350);
    });

    /** بطاقة تُفتح من الشاشة الأخت: `ctx.openItem` من المعاينة أو من لوحة المخزن. */
    if (ctx.openItemId) {
        const f = filters();
        const host2 = q('[data-v2-dossier]');
        dossier = mountItemDossier(host2, { itemId: ctx.openItemId, from: f.from, to: f.to, ctx: { notify }, compact: true });
    }

    reload();

    return {
        el,
        reload,
        getRows: () => rows,
        openDossier,
        destroy() {
            clearTimeout(searchTimer);
            if (dossier) {dossier.destroy();}
            table.destroy();
            deptTable.destroy();
            el.remove();
        },
    };
}
