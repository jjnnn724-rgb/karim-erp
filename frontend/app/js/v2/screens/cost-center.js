/**
 * V2 — Cost Center Workbench · «حساب القسم» — صفحة واحدة تعمل كل شيء
 * ═══════════════════════════════════════════════════════════════════════
 * نظام تكلفة المراكز (2026-10-25 — اعتماد المستخدم بالمراحل الثلاث):
 *
 *   صافي القسم = إيراد الكاشير − كلفة الصرف − كلفة التوليد − الإضافات
 *
 * الوحيدة في النظام التي تجمع في شاشة واحدة:
 *   • المعادلة المباشرة (KPIs) من تجميع المالية نفسه (/finance/cost-analysis)
 *     مع تفكيك الكلفة إلى صرف/توليد/إضافات من مصادرها الأولية.
 *   • تفصيل أذون الصرف المعتمدة للقسم بقيمها الحقيقية (approvedValue).
 *   • الإضافات اليدوية (فئة «إضافات قسم») — إنشاؤها عبر الباب العام
 *     للمصروفات يولّد قيدها المحاسبي على الخادم تلقائيًا.
 *   • إذن التوليد: تنفيذ وصفة (يستهلك الخام بالمتوسط ويصرّح مصروف «توليد»
 *     ويرحّل Dr 5000/Cr 1200 بمركز تكلفة القسم) + سجل التوليد.
 *   • طباعة «حساب القسم» بنفس معايير الفترة والقسم.
 *
 * قراءة فقط افتراضيًا؛ الكتابة (إضافة/حذف/توليد) عبر أبواب الخادم التي
 * تتحقق من الدور والصلاحية — هذه الشاشة لا تحسب رقمًا بيدها إلا مجموعًا
 * لقيمٍ وردت من الخادم، وتنسب كل رقم إلى مصدره.
 */
import { createDataTable } from '../data-display/data-table.js?v=4.9.180';
import { openInAppReport } from '../report-viewer.js?v=4.9.180';
import { fetchDepartments } from '../data/employees-repo.js?v=4.9.180';
import { fetchRecipes } from '../data/recipes-repo.js?v=4.9.180';
import { fetchCurrency, formatMoney, formatInt } from '../data/reports-repo.js?v=4.9.180';
import {
    fetchDeptPnl, fetchDeptDispatches, fetchDeptAdditions,
    createDeptAddition, deleteDeptAddition, createProduction, fetchProductions,
    buildDeptEquation, ADDITION_CATEGORY,
} from '../data/cost-center-repo.js?v=4.9.180';

const esc = (v) => String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const firstOfMonth = () => `${new Date().toISOString().slice(0, 7)}-01`;
const today = () => new Date().toISOString().slice(0, 10);

function money(v, c) {
    const m = formatMoney(v, c);
    return `<span class="erp-num" dir="ltr">${esc(m.amount)}</span>${m.hasUnit ? ` <span class="erp-text-sm erp-text-muted">${esc(m.unit)}</span>` : ''}`;
}

function template() {
    return `<div class="erp-v2-cc-root">
      <section class="erp-card erp-v2-cc">
        <div class="erp-card__head">
          <h3 class="erp-card__title">حساب القسم <span class="erp-eyebrow" dir="ltr" lang="en">Cost Center</span>
            <span class="erp-text-muted erp-text-sm" data-v2-count></span></h3>
          <span class="erp-grow"></span>
          <label class="erp-text-sm erp-text-muted" for="cc-dept">القسم</label>
          <select class="erp-select" id="cc-dept" data-v2-dept aria-label="القسم"></select>
          <label class="erp-text-sm erp-text-muted" for="cc-from">من</label>
          <input class="erp-input erp-input--ltr" id="cc-from" type="date" value="${firstOfMonth()}">
          <label class="erp-text-sm erp-text-muted" for="cc-to">إلى</label>
          <input class="erp-input erp-input--ltr" id="cc-to" type="date" value="${today()}">
          <button type="button" class="erp-btn erp-btn--sm" data-v2-print aria-label="طباعة حساب القسم">
            <i class="ji" data-i="printer" aria-hidden="true"></i><span>طباعة</span>
          </button>
          <button type="button" class="erp-btn erp-btn--primary erp-btn--sm" data-v2-reload>
            <i class="ji" data-i="refresh" aria-hidden="true"></i><span>عرض</span>
          </button>
        </div>
        <div class="erp-card__body erp-stack">
          <ul class="erp-kpis" data-v2-kpis aria-label="معادلة القسم"></ul>
          <p class="erp-text-sm erp-text-muted" data-v2-summary role="status" aria-live="polite"></p>
          <p class="erp-text-sm erp-text-muted">المعادلة: صافي القسم = إيراد الكاشير المرتبط به − كلفة الصرف − كلفة التوليد − الإضافات.
            كل قيمة من مصدرها الأولي (أذون معتمدة، مصروفات، تجميع المالية)، واعتماد الصرف والتوليد يُرحّل قيد
            Dr 5000 / Cr 1200 بمركز تكلفة القسم تلقائيًا على الخادم.</p>
          <div class="erp-error" data-v2-failures role="alert" hidden></div>
        </div>
      </section>

      <section class="erp-card"><div class="erp-card__head">
          <h3 class="erp-card__title">أذون الصرف المعتمدة <span class="erp-text-muted erp-text-sm" data-v2-dsp-count></span></h3>
          <span class="erp-grow"></span>
          <span class="erp-text-sm erp-text-muted">الإجمالي: <b data-v2-dsp-total>—</b></span>
        </div><div class="erp-card__body"><div data-v2-dsp-table></div></div></section>

      <section class="erp-card"><div class="erp-card__head">
          <h3 class="erp-card__title">كلفة التوليد (وصفات) <span class="erp-text-muted erp-text-sm" data-v2-prod-count></span></h3>
          <span class="erp-grow"></span>
          <span class="erp-text-sm erp-text-muted">الإجمالي: <b data-v2-prod-total>—</b></span>
        </div><div class="erp-card__body erp-stack">
          <div class="erp-dash-controls" data-v2-prod-form></div>
          <div class="erp-text-sm" data-v2-prod-result role="status" aria-live="polite"></div>
          <div data-v2-prod-table></div>
        </div></section>

      <section class="erp-card"><div class="erp-card__head">
          <h3 class="erp-card__title">إضافات القسم <span class="erp-text-muted erp-text-sm" data-v2-add-count></span></h3>
          <span class="erp-grow"></span>
          <span class="erp-text-sm erp-text-muted">الإجمالي: <b data-v2-add-total>—</b></span>
        </div><div class="erp-card__body erp-stack">
          <div class="erp-dash-controls">
            <input class="erp-input" data-v2-add-desc placeholder="الوصف (تغليف، غاز، ثلج…)" aria-label="وصف الإضافة" style="min-inline-size:24ch">
            <input class="erp-input erp-input--ltr" data-v2-add-amt type="number" step="0.01" placeholder="المبلغ" aria-label="مبلغ الإضافة">
            <input class="erp-input erp-input--ltr" data-v2-add-date type="date" value="${today()}" aria-label="تاريخ الإضافة">
            <button type="button" class="erp-btn erp-btn--primary erp-btn--sm" data-v2-add-save>إضافة</button>
          </div>
          <div class="erp-text-sm" data-v2-add-err role="alert"></div>
          <div data-v2-add-table></div>
        </div></section>
    </div>`;
}

export function mountCostCenterScreen(host, ctx = {}) {
    const notify = typeof ctx.notify === 'function' ? ctx.notify : (m) => console.info('[V2 cost-center]', m);
    const confirmFn = typeof ctx.confirmFn === 'function' ? ctx.confirmFn
        : (m) => (typeof window !== 'undefined' && window.confirm ? window.confirm(m) : false);

    let dept = '';
    let currency = '';
    let loading = false;
    let readSeq = 0;
    let dispatchRows = [];
    let additionRows = [];
    let productionRows = [];
    let pnlRow = null;
    let recipes = [];

    host.insertAdjacentHTML('beforeend', template());
    const el = host.lastElementChild;
    const q = (s) => el.querySelector(s);
    const kpisEl = q('[data-v2-kpis]');
    const summaryEl = q('[data-v2-summary]');
    const countEl = q('[data-v2-count]');
    const failuresBox = q('[data-v2-failures]');
    const deptSel = q('[data-v2-dept]');

    /* ── جدول الأذون ── */
    const dspTable = createDataTable({
        caption: 'أذون الصرف المعتمدة للقسم — القيمة من البنود المعتمدة', mode: 'client',
        pageSize: 15, stickyHeader: true, emptyMessage: 'لا أذون في الفترة',
        rowKey: (r) => r.id,
        search: false,
        columns: [
            { key: 'id', header: 'الإذن', width: '90px', className: 'erp-mono', render: (r) => `<span class="erp-num" dir="ltr">#${esc(r.id ?? '؟')}</span>` },
            { key: 'date', header: 'التاريخ', width: '110px', sortable: true, render: (r) => `<span class="erp-num" dir="ltr">${esc(r.date || '—')}</span>` },
            { key: 'itemsText', header: 'الأصناف والكميات' },
            { key: 'value', header: 'القيمة', type: 'number', align: 'end', sortable: true, value: (r) => r.value, render: (r) => money(r.value, currency) },
            { key: 'status', header: 'الحالة', width: '140px', render: (r) => (r.status ? `<span class="erp-badge" data-tone="success">${esc(r.status)}</span>` : '<span class="erp-text-muted">—</span>') },
        ],
    });
    q('[data-v2-dsp-table]').appendChild(dspTable.el);

    /* ── جدول التوليد ── */
    const prodTable = createDataTable({
        caption: 'سجل التوليد — مصروفات فئة توليد', mode: 'client',
        pageSize: 10, stickyHeader: true, emptyMessage: 'لا توليد في الفترة',
        rowKey: (r) => r.id,
        search: false,
        columns: [
            { key: 'date', header: 'التاريخ', width: '110px', sortable: true, render: (r) => `<span class="erp-num" dir="ltr">${esc(String(r.date || '').slice(0, 10))}</span>` },
            { key: 'desc', header: 'الوصفة والدفعات' },
            { key: 'amount', header: 'الكلفة', type: 'number', align: 'end', sortable: true, value: (r) => r.amount, render: (r) => money(r.amount, currency) },
        ],
    });
    q('[data-v2-prod-table]').appendChild(prodTable.el);

    /* ── جدول الإضافات ── */
    const addTable = createDataTable({
        caption: 'إضافات القسم اليدوية — فئة إضافات قسم', mode: 'client',
        pageSize: 10, stickyHeader: true, emptyMessage: 'لا إضافات في الفترة',
        rowKey: (r) => r.id,
        search: false,
        columns: [
            { key: 'date', header: 'التاريخ', width: '110px', sortable: true, render: (r) => `<span class="erp-num" dir="ltr">${esc(String(r.date || '').slice(0, 10))}</span>` },
            { key: 'desc', header: 'الوصف' },
            { key: 'amount', header: 'المبلغ', type: 'number', align: 'end', sortable: true, value: (r) => r.amount, render: (r) => money(r.amount, currency) },
            { key: 'actions', header: '', width: '70px', align: 'center', className: 'erp-no-print',
                render: (r) => `<button type="button" class="erp-btn erp-btn--sm erp-btn--danger" data-v2-add-del="${esc(String(r.id))}" aria-label="حذف الإضافة"><i class="ji" data-i="trash" aria-hidden="true"></i></button>` },
        ],
    });
    q('[data-v2-add-table]').appendChild(addTable.el);

    /* ── نماذج التوليد ── */
    function paintProdForm() {
        const box = q('[data-v2-prod-form]');
        if (!box) {return;}
        box.innerHTML = `<label class="erp-text-sm erp-text-muted" for="cc-prod-recipe">الوصفة</label>
            <select class="erp-select" id="cc-prod-recipe" data-v2-prod-recipe aria-label="الوصفة">
              ${recipes.map((r) => `<option value="${esc(String(r.id))}">${esc(r.name)}${dept && String(r.deptId) === dept ? ' ★' : ''}</option>`).join('')}
            </select>
            <label class="erp-text-sm erp-text-muted" for="cc-prod-batches">الدفعات</label>
            <input class="erp-input erp-input--ltr" id="cc-prod-batches" data-v2-prod-batches type="number" min="1" step="1" value="1" aria-label="عدد الدفعات">
            <input class="erp-input erp-input--ltr" data-v2-prod-date type="date" value="${today()}" aria-label="تاريخ التوليد">
            <button type="button" class="erp-btn erp-btn--primary erp-btn--sm" data-v2-prod-run>تنفيذ التوليد</button>`;
    }

    /* ── الرسم ── */
    function paintEquation() {
        const productionCost = productionRows.reduce((s, r) => s + (Number(r.amount) || 0), 0);
        const additions = additionRows.reduce((s, r) => s + (Number(r.amount) || 0), 0);
        const dispatchCost = dispatchRows.reduce((s, r) => s + (Number(r.value) || 0), 0);
        const eq = buildDeptEquation({
            revenue: pnlRow ? Number(pnlRow.rev) || 0 : 0,
            dispatchCost,
            additions,
            productionCost,
        });
        const kpi = (label, en, value, tone) => `<li class="erp-kpi"><div class="erp-kpi__top">
              <span class="erp-kpi__label">${esc(label)}<span class="erp-eyebrow" dir="ltr" lang="en">${esc(en)}</span></span></div>
              <div class="erp-kpi__value"><span class="erp-num${tone ? ` ${tone}` : ''}" dir="ltr">${esc(value)}</span></div></li>`;
        kpisEl.innerHTML = ''
            + kpi('إيراد القسم', 'Revenue', formatMoney(eq.revenue, currency).amount)
            + kpi('كلفة الصرف', 'Materials', formatMoney(eq.dispatchCost, currency).amount)
            + kpi('كلفة التوليد', 'Production', formatMoney(eq.productionCost, currency).amount)
            + kpi('الإضافات', 'Additions', formatMoney(eq.additions, currency).amount)
            + `<li class="erp-kpi"><div class="erp-kpi__top"><span class="erp-kpi__label">الصافي
                <span class="erp-eyebrow" dir="ltr" lang="en">Net</span></span></div>
              <div class="erp-kpi__value"><span class="erp-num ${eq.net >= 0 ? 'erp-text-success' : 'erp-text-danger'}" dir="ltr">${esc(formatMoney(eq.net, currency).amount)}</span>
              ${eq.marginPct !== null ? `<span class="erp-kpi__unit">${esc(String(eq.marginPct))}%</span>` : ''}</div></li>`;
        summaryEl.textContent = `${formatInt(dispatchRows.length)} إذنًا · ${formatInt(productionRows.length)} توليدًا · ${formatInt(additionRows.length)} إضافة — صافي القسم ${formatMoney(eq.net, currency).amount}${eq.marginPct !== null ? ` (هامش ${eq.marginPct}%)` : ''}`;
        countEl.textContent = dept ? `— ${dept}` : '';
    }

    function paintAll() {
        const dspTotal = dispatchRows.reduce((s, r) => s + (Number(r.value) || 0), 0);
        const prodTotal = productionRows.reduce((s, r) => s + (Number(r.amount) || 0), 0);
        const addTotal = additionRows.reduce((s, r) => s + (Number(r.amount) || 0), 0);
        q('[data-v2-dsp-count]').textContent = dispatchRows.length ? `(${formatInt(dispatchRows.length)})` : '';
        q('[data-v2-dsp-total]').textContent = formatMoney(dspTotal, currency).amount;
        q('[data-v2-prod-count]').textContent = productionRows.length ? `(${formatInt(productionRows.length)})` : '';
        q('[data-v2-prod-total]').textContent = formatMoney(prodTotal, currency).amount;
        q('[data-v2-add-count]').textContent = additionRows.length ? `(${formatInt(additionRows.length)})` : '';
        q('[data-v2-add-total]').textContent = formatMoney(addTotal, currency).amount;
        dspTable.setRows(dispatchRows);
        prodTable.setRows(productionRows);
        addTable.setRows(additionRows);
        paintEquation();
    }

    const range = () => ({ from: q('#cc-from').value || '', to: q('#cc-to').value || '' });

    async function reload() {
        if (loading) {return;}
        loading = true;
        const seq = ++readSeq;
        failuresBox.hidden = true;
        failuresBox.textContent = '';
        const { from, to } = range();
        const failures = [];
        try {
            const tasks = [
                fetchDeptPnl(from, to).then((pnl) => {
                    const list = Array.isArray(pnl?.rows) ? pnl.rows : (Array.isArray(pnl) ? pnl : []);
                    pnlRow = dept ? list.find((r) => String(r.code) === dept) || null : null;
                }).catch((e) => {failures.push(`تحليل التكاليف: ${(e && e.message) || 'خطأ'}`);}),
                fetchDeptDispatches(dept, 'all').then((rows) => {
                    dispatchRows = rows.filter((r) => (!from || String(r.date || '') >= from) && (!to || String(r.date || '') <= to));
                }).catch((e) => {failures.push(`الأذون: ${(e && e.message) || 'خطأ'}`);}),
                fetchDeptAdditions(dept, { from, to }).then((rows) => {
                    additionRows = rows.filter((r) => String(r.category || '') === ADDITION_CATEGORY);
                }).catch((e) => {failures.push(`الإضافات: ${(e && e.message) || 'خطأ'}`);}),
                fetchProductions({ from, to, dept }).then((res) => {
                    productionRows = Array.isArray(res?.data) ? res.data : [];
                }).catch((e) => {failures.push(`التوليد: ${(e && e.message) || 'خطأ'}`);}),
            ];
            await Promise.all(tasks);
            if (!el.isConnected || seq !== readSeq) {return;}
            paintAll();
            if (failures.length) {
                failuresBox.hidden = false;
                failuresBox.textContent = `مصادر لم تستجب: ${failures.join(' · ')}`;
            }
        } finally {
            loading = false;
        }
    }

    /* ── طباعة حساب القسم ── */
    function printAccount() {
        const { from, to } = range();
        const productionCost = productionRows.reduce((s, r) => s + (Number(r.amount) || 0), 0);
        const additions = additionRows.reduce((s, r) => s + (Number(r.amount) || 0), 0);
        const dispatchCost = dispatchRows.reduce((s, r) => s + (Number(r.value) || 0), 0);
        const eq = buildDeptEquation({ revenue: pnlRow ? Number(pnlRow.rev) || 0 : 0, dispatchCost, additions, productionCost });
        const w = openInAppReport('حساب القسم');
        w.document.write('<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="UTF-8"><title>حساب القسم</title></head><body style="font-family:\'Cairo\',Tahoma,Arial,sans-serif;padding:24px">جارٍ تجهيز الحساب…</body></html>');
        const eqRow = (label, val, tone) => `<tr><td>${esc(label)}</td><td dir="ltr" style="text-align:left${tone ? `;color:${tone}` : ''}"><b>${esc(formatMoney(val, currency).amount)}</b></td></tr>`;
        const dspRows = dispatchRows.map((r, i) => `<tr><td>${i + 1}</td><td dir="ltr">#${esc(String(r.id))}</td><td>${esc(r.date || '—')}</td><td style="text-align:right">${esc(r.itemsText || '—')}</td><td dir="ltr">${esc(formatMoney(r.value, currency).amount)}</td></tr>`).join('');
        const prodRows = productionRows.map((r, i) => `<tr><td>${i + 1}</td><td>${esc(String(r.date || '').slice(0, 10))}</td><td style="text-align:right">${esc(r.desc || '')}</td><td dir="ltr">${esc(formatMoney(r.amount, currency).amount)}</td></tr>`).join('');
        const addRows = additionRows.map((r, i) => `<tr><td>${i + 1}</td><td>${esc(String(r.date || '').slice(0, 10))}</td><td style="text-align:right">${esc(r.desc || '')}</td><td dir="ltr">${esc(formatMoney(r.amount, currency).amount)}</td></tr>`).join('');
        w.document.open();
        w.document.write(`<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="UTF-8"><title>حساب القسم ${esc(dept)}</title>`
            + '<style>body{font-family:\'Cairo\',Tahoma,Arial,sans-serif;color:#111;background:#fff;margin:0;padding:28px;direction:rtl}'
            + '.sheet{max-width:960px;margin:auto}.head{text-align:center;border-bottom:3px solid #b45309;padding-bottom:14px;margin-bottom:16px}'
            + '.head h1{margin:0 0 6px;color:#b45309;font-size:22px}.head p{margin:3px 0;color:#555;font-size:13px}'
            + '.net{margin:14px 0;border:2px solid #b45309;border-radius:10px;padding:12px;text-align:center;font-size:15px}.net b{font-size:20px;color:#7c3500}'
            + 'h2{font-size:14px;color:#7c3500;border-bottom:2px solid #f7ead8;padding-bottom:5px;margin:16px 0 8px}'
            + 'table{width:100%;border-collapse:collapse;margin-bottom:6px}th,td{border:1px solid #ccc;padding:6px;text-align:right;font-size:12px}'
            + 'th{background:#f7ead8;color:#7c3500}'
            + '.controls{text-align:center;margin-bottom:18px}.controls button{border:0;border-radius:7px;padding:10px 24px;margin:0 5px;font:inherit;cursor:pointer;background:#b45309;color:#fff}'
            + '.controls button.secondary{background:#555}'
            + '@media print{body{padding:0}.controls{display:none!important}@page{size:A4;margin:11mm}}</style></head><body>'
            + '<div class="controls"><button type="button" data-cc-print>طباعة</button><button type="button" class="secondary" data-cc-close>إغلاق</button></div>'
            + `<main class="sheet"><header class="head"><h1>حساب القسم — ${esc(dept || '—')}</h1>`
            + `<p>الفترة: ${esc(from || 'البداية')} → ${esc(to || 'اليوم')} — تاريخ التقرير: ${new Date().toLocaleString('ar-EG')}</p></header>`
            + '<table><tbody>'
            + eqRow('إيراد القسم (الكاشير المرتبط)', eq.revenue)
            + eqRow('− كلفة الصرف (أذون معتمدة)', eq.dispatchCost)
            + eqRow('− كلفة التوليد (وصفات)', eq.productionCost)
            + eqRow('− الإضافات اليدوية', eq.additions)
            + '</tbody></table>'
            + `<div class="net">صافي القسم: <b dir="ltr">${esc(formatMoney(eq.net, currency).amount)}</b>${eq.marginPct !== null ? ` — هامش <span dir="ltr">${esc(String(eq.marginPct))}%</span>` : ''}</div>`
            + `<h2>تفصيل أذون الصرف (${formatInt(dispatchRows.length)})</h2>`
            + '<table><thead><tr><th>#</th><th>الإذن</th><th>التاريخ</th><th>الأصناف</th><th>القيمة</th></tr></thead>'
            + `<tbody>${dspRows || '<tr><td colspan="5">—</td></tr>'}</tbody></table>`
            + `<h2>التوليد (${formatInt(productionRows.length)})</h2>`
            + '<table><thead><tr><th>#</th><th>التاريخ</th><th>الوصفة والدفعات</th><th>الكلفة</th></tr></thead>'
            + `<tbody>${prodRows || '<tr><td colspan="4">—</td></tr>'}</tbody></table>`
            + `<h2>الإضافات (${formatInt(additionRows.length)})</h2>`
            + '<table><thead><tr><th>#</th><th>التاريخ</th><th>الوصف</th><th>المبلغ</th></tr></thead>'
            + `<tbody>${addRows || '<tr><td colspan="4">—</td></tr>'}</tbody></table>`
            + '</main></body></html>');
        w.document.close();
        w.document.querySelector('[data-cc-print]')?.addEventListener('click', () => w.print());
        w.document.querySelector('[data-cc-close]')?.addEventListener('click', () => w.close());
        w.focus();
    }

    /* ── كتابة: إضافة / حذف / توليد ── */
    async function saveAddition() {
        const desc = q('[data-v2-add-desc]')?.value.trim();
        const amount = Number(q('[data-v2-add-amt]')?.value);
        const date = q('[data-v2-add-date]')?.value || today();
        const errBox = q('[data-v2-add-err]');
        if (!dept) {errBox.textContent = 'اختر القسم أولًا'; return;}
        if (!desc) {errBox.textContent = 'اكتب وصف الإضافة'; return;}
        if (!(amount > 0)) {errBox.textContent = 'المبلغ يجب أن يكون أكبر من صفر'; return;}
        errBox.textContent = '';
        try {
            await createDeptAddition({ deptCode: dept, desc, amount, date });
            notify('تمت الإضافة وترحيل قيدها');
            q('[data-v2-add-desc]').value = '';
            q('[data-v2-add-amt]').value = '';
            await reload();
        } catch (e) {
            errBox.textContent = (e && e.message) || 'تعذر الحفظ';
        }
    }

    async function runProduction() {
        const recipeId = q('[data-v2-prod-recipe]')?.value;
        const batches = Number(q('[data-v2-prod-batches]')?.value);
        const date = q('[data-v2-prod-date]')?.value || today();
        const resultBox = q('[data-v2-prod-result]');
        if (!recipeId) {resultBox.textContent = 'اختر الوصفة'; return;}
        if (!(batches > 0)) {resultBox.textContent = 'عدد الدفعات 1 على الأقل'; return;}
        resultBox.textContent = 'جارٍ تنفيذ التوليد…';
        try {
            const res = await createProduction({ recipeId, batches, date });
            if (!el.isConnected) {return;}
            const items = (res.items || []).map((it) => `${esc(it.name)} (${esc(String(it.needed))} ${esc(it.unit || '')})`).join(' · ');
            resultBox.innerHTML = `<span class="erp-badge" data-tone="success">تم التوليد</span> ${esc(res.production.recipe)} × ${esc(String(res.production.batches))} — الكلفة <b dir="ltr">${esc(formatMoney(res.totalValue, currency).amount)}</b> · كلفة الوحدة <b dir="ltr">${esc(String(res.unitCost))}</b><br><span class="erp-text-sm erp-text-muted">${items}</span>`;
            notify(`تم التوليد: ${res.production.recipe} × ${res.production.batches}`);
            await reload();
        } catch (e) {
            if (!el.isConnected) {return;}
            resultBox.textContent = (e && e.message) || 'تعذر التنفيذ';
        }
    }

    /* ── الأحداث ── */
    el.addEventListener('click', (event) => {
        if (event.target.closest('[data-v2-reload]') || event.target.closest('[data-erp-retry]')) {reload(); return;}
        if (event.target.closest('[data-v2-print]')) {printAccount(); return;}
        if (event.target.closest('[data-v2-add-save]')) {saveAddition(); return;}
        if (event.target.closest('[data-v2-prod-run]')) {runProduction(); return;}
        const del = event.target.closest('[data-v2-add-del]');
        if (del) {
            (async () => {
                if (!await confirmFn('حذف هذه الإضافة؟ (الخادم يلغي قيدها مع الحذف)')) {return;}
                try {
                    await deleteDeptAddition(del.dataset.v2AddDel);
                    notify('تم الحذف وإلغاء القيد');
                    await reload();
                } catch (e) {notify((e && e.message) || 'تعذر الحذف');}
            })();
        }
    });
    el.addEventListener('change', (event) => {
        if (event.target.matches('[data-v2-dept], #cc-from, #cc-to')) {
            dept = deptSel.value;
            reload();
        }
    });

    /* ── التهيئة: الأقسام + الوصفات + العملة ثم أول قراءة ── */
    (async () => {
        const seq = ++readSeq;
        try {
            const [depts, recs, cur] = await Promise.all([
                fetchDepartments().catch(() => []),
                fetchRecipes().catch(() => []),
                fetchCurrency().catch(() => ''),
            ]);
            if (!el.isConnected || seq !== readSeq) {return;}
            currency = String(cur ?? '');
            recipes = Array.isArray(recs) ? recs : [];
            const list = Array.isArray(depts) ? depts : [];
            deptSel.innerHTML = list.map((d) => `<option value="${esc(String(d.code))}">${esc(d.name || d.code)}</option>`).join('');
            dept = deptSel.value || '';
            paintProdForm();
        } catch { /* القوائم تظل فارغة والقراءة تعيد المحاولة بالزر */ }
        reload();
    })();

    return {
        el,
        reload,
        getRows: () => dispatchRows,
        destroy() {
            dspTable.destroy();
            prodTable.destroy();
            addTable.destroy();
            el.remove();
        },
    };
}
