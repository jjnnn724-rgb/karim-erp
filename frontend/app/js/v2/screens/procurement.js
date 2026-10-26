/**
 * V2 — Procurement screen · شاشة 05 في سجل الترحيل (الموجة الثانية: كتابة)
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Same per-screen contract as 01-04, plus explicit write doors (owner
 * approval): one network door (v2/data/procurement-repo.js), delegated
 * listeners on a per-mount root, loading AND saving guards (a click can
 * never start two of the same operation), isConnected checks, destroy()
 * on nav. Scope: suppliers directory + summary KPIs + supplier create/
 * edit/toggle/delete. Supplier invoices and payments are separate doors
 * and separate screens (06/07) — stated in the UI, never silently folded
 * in. Every rule lives server-side; the UI gates buttons by role for
 * convenience only, and the server re-checks each call.
 */

import { createDataTable } from '../data-display/data-table.js?v=4.9.180';
import { statusBadge } from '../status.js?v=4.9.180';
import { canWrite } from '../session.js?v=4.9.180';
import { kpiStrip } from '../role-dash-parts.js?v=4.9.180';
import { paintFormErrors } from '../form-errors.js?v=4.9.180';
import {
    fetchProcurementSummary, fetchSuppliers, searchSuppliers, supplierToRow,
    fetchCurrency, formatMoney, formatInt, SUPPLIER_WRITE_ROLES,
    validateSupplierForm, createSupplier, updateSupplier, toggleSupplier,
    deleteSupplier, fetchSupplierStatement,
} from '../data/procurement-repo.js?v=4.9.180';

const esc = (v) => String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** Money cell — same rule as the reports screen: stored unit or bare. */
function moneyCell(v, currency, opts = {}) {
    const m = formatMoney(v, currency);
    const n = `<span class="erp-num" dir="ltr">${m.amount}</span>`;
    const u = m.hasUnit ? ` <span class="erp-text-sm erp-text-muted">${esc(m.unit)}</span>` : '';
    const body = `${n}${u}`;
    return opts.title ? `<span title="${esc(opts.title)}">${body}</span>` : body;
}

/* kpiStrip مشترك الآن في role-dash-parts.js — نسخة واحدة للنظام. */

function nameCell(row) {
    const label = row.nameResolved ? esc(row.name)
        : `<span class="erp-text-muted" title="لا اسم مخزّن — يُعرض رقم السجل">${esc(row.name)}</span>`;
    const sub = row.vat
        ? `<span class="erp-mini__sub erp-mono" dir="ltr" title="الرقم الضريبي">VAT ${esc(row.vat)}</span>`
        : (row.nameEn ? `<span class="erp-mini__sub" dir="ltr">${esc(row.nameEn)}</span>` : '');
    return sub ? `${label}${sub}` : label;
}

/** Procurement hub tabs — local copy per hub screen (no cross-coupling). */
function hubTabs(active) {
    const tabs = [
        ['procurement', 'الموردون'],
        ['procurement-invoices', 'الفواتير'],
        ['procurement-payments', 'المدفوعات'],
    ];
    return `<div class="erp-seg" role="group" aria-label="أقسام المشتريات">`
        + tabs.map(([key, label]) => `<button type="button" data-v2-hub="${key}"`
            + `${key === active ? ' class="is-active" aria-pressed="true"' : ' aria-pressed="false"'}>${label}</button>`).join('')
        + `</div>`;
}

function template(writable) {
    return `
      <section class="erp-card erp-v2-procurement">
        <div class="erp-card__head">
          <h3 class="erp-card__title">الموردون
            <span class="erp-eyebrow" dir="ltr" lang="en">Suppliers</span>
            <span class="erp-text-muted erp-text-sm" data-v2-count></span>
          </h3>
          <span class="erp-grow"></span>
          <span data-v2-hub>${hubTabs('procurement')}</span>
          <button type="button" class="erp-btn erp-btn--primary erp-btn--sm" data-v2-add${writable ? '' : ' hidden'}>
            <i class="ji" data-i="plus" aria-hidden="true"></i><span>مورد جديد</span>
          </button>
          <button type="button" class="erp-btn erp-btn--primary erp-btn--sm" data-v2-reload>
            <i class="ji" data-i="refresh" aria-hidden="true"></i><span>تحديث</span>
          </button>
        </div>
        <div class="erp-card__body erp-stack">
          <div data-v2-kpis></div>
            <p class="erp-text-sm erp-text-muted" data-v2-currency-note hidden>تعذّرت قراءة وحدة المال من الإعدادات — المبالغ تُعرض بلا وحدة.</p>
          <section class="erp-supsearch" data-v2-search aria-label="بحث الموردين">
            <div class="erp-supsearch__bar">
              <span class="erp-supsearch__field">
                <i class="ji" data-i="search" aria-hidden="true"></i>
                <input class="erp-input erp-grow" type="search" data-v2-search-q autocomplete="off"
                       placeholder="ابحث باسم المورد أو رقمه الضريبي أو سجله التجاري…"
                       aria-label="بحث الموردين">
              </span>
              <select class="erp-select erp-supsearch__tax" data-v2-search-tax aria-label="الحالة الضريبية">
                <option value="ALL">كل الحالات الضريبية</option>
                <option value="REGISTERED">مسجل ضريبيًا</option>
                <option value="NOT_REGISTERED">غير مسجل</option>
                <option value="EXEMPT">معفى</option>
              </select>
              <button type="button" class="erp-btn erp-btn--sm" data-v2-search-clear hidden>
                <i class="ji" data-i="x" aria-hidden="true"></i><span>مسح</span>
              </button>
            </div>
            <p class="erp-supsearch__status" data-v2-search-status aria-live="polite">بحث فوري في كل الموردين — بالاسم أو الرقم الضريبي أو السجل التجاري.</p>
            <ul class="erp-supsearch__list" data-v2-search-list hidden></ul>
            <div class="erp-supsearch__pager" data-v2-search-pager hidden>
              <button type="button" class="erp-btn erp-btn--sm" data-v2-search-prev>السابق</button>
              <span class="erp-text-sm erp-text-muted" data-v2-search-page></span>
              <button type="button" class="erp-btn erp-btn--sm" data-v2-search-next>التالي</button>
            </div>
          </section>
          <div data-v2-form hidden></div>
          <div data-v2-table></div>
        </div>
      </section>`;
}

/**
 * @param {ParentNode} host where the screen is inserted
 * @param {{role?: string|null, notify?: (message:string, kind?:string)=>void}} [ctx]
 * @returns {{el: HTMLElement, reload: ()=>Promise<void>, getRows: ()=>any[], destroy: ()=>void}}
 */
export function mountProcurementScreen(host, ctx = {}) {
    const notify = typeof ctx.notify === 'function' ? ctx.notify : (m) => console.info('[V2 procurement]', m);
    const navigate = typeof ctx.navigate === 'function' ? ctx.navigate : () => {};
    const confirmFn = typeof ctx.confirmFn === 'function' ? ctx.confirmFn
        : (m) => (typeof window !== 'undefined' && window.confirm ? window.confirm(m) : false);
    const writable = canWrite(ctx.role, SUPPLIER_WRITE_ROLES);

    let rows = [];
    let currency = '';
    let loading = false;
    let queued = false;          // a refresh asked for while one was running
    let saving = false;
    let editing = null;          // row being edited; null while creating
    let rawById = new Map();     // raw API records for truthful editing
    let statementPop = null;     // نافذة كشف الحساب المنبثقة (تُغلَق عند التنقل)

    host.insertAdjacentHTML('beforeend', template(writable));
    const el = host.lastElementChild;
    const q = (sel) => el.querySelector(sel);
    const countEl = q('[data-v2-count]');
    const kpisHost = q('[data-v2-kpis]');
    const currencyNote = q('[data-v2-currency-note]');
    const formHost = q('[data-v2-form]');

    const table = createDataTable({
        caption: 'دليل الموردين — بيانات حية',
        mode: 'client',
        pageSize: 20,
        stickyHeader: true,
        emptyMessage: 'لا يوجد موردون',
        emptyHint: 'تحقق من صلاحية العرض.',
        rowKey: (row) => row.id,
        columns: [
            { key: 'name', header: 'المورد', sortable: true, filterable: true, render: nameCell },
            {
                key: 'phone', header: 'الهاتف', width: '130px', className: 'erp-tnum',
                render: (row) => (row.phone && row.phone !== '—'
                    ? `<span class="erp-num" dir="ltr">${esc(row.phone)}</span>`
                    : `<span class="erp-text-muted">—</span>`),
            },
            { key: 'category', header: 'الفئة', sortable: true, filterable: true, width: '120px',
                render: (row) => (row.category ? esc(row.category) : `<span class="erp-text-muted">—</span>`) },
            {
                key: 'purchasesTotal', header: 'المشتريات', sortable: true, type: 'number',
                width: '130px', align: 'end', value: (row) => row.purchasesTotal,
                render: (row) => moneyCell(row.purchasesTotal, currency, { title: 'مجموع فواتير هذا المورد' }),
            },
            {
                key: 'paymentsTotal', header: 'المدفوعات', sortable: true, type: 'number',
                width: '130px', align: 'end', value: (row) => row.paymentsTotal,
                render: (row) => moneyCell(row.paymentsTotal, currency, { title: 'مجموع مدفوعات هذا المورد' }),
            },
            {
                key: 'dueTotal', header: 'المستحق', sortable: true, type: 'number',
                width: '130px', align: 'end', value: (row) => row.dueTotal,
                render: (row) => moneyCell(row.dueTotal, currency, { title: 'الافتتاحي + المشتريات − المدفوعات' }),
            },
            {
                key: 'lastPurchaseDate', header: 'آخر شراء', sortable: true, width: '120px', align: 'center',
                render: (row) => (row.lastPurchaseDate
                    ? `<span class="erp-num" dir="ltr">${esc(row.lastPurchaseDate)}</span>`
                    : `<span class="erp-text-muted">—</span>`),
            },
            {
                key: 'status', header: 'الحالة', sortable: true, filterable: true, width: '130px',
                value: (row) => row.status,
                render: (row) => statusBadge('branches', row.status),
            },
            ...(writable ? [{
                key: 'actions',
                header: 'إجراءات',
                width: '220px',
                align: 'end',
                value: () => '',
                render: (row) => `
                  <span class="erp-row-wrap">
                    <button type="button" class="erp-btn erp-btn--sm" data-v2-act="edit" data-id="${esc(row.id)}">
                      <i class="ji" data-i="pencil" aria-hidden="true"></i><span>تعديل</span>
                    </button>
                    ${row.status === 'active'
                        ? `<button type="button" class="erp-btn erp-btn--sm" data-v2-act="toggle" data-id="${esc(row.id)}" data-name="${esc(row.name)}">
                            <i class="ji" data-i="circle-x" aria-hidden="true"></i><span>إيقاف</span>
                          </button>`
                        : `<button type="button" class="erp-btn erp-btn--sm" data-v2-act="toggle" data-id="${esc(row.id)}" data-name="${esc(row.name)}">
                            <i class="ji" data-i="circle-check" aria-hidden="true"></i><span>تفعيل</span>
                          </button>`}
                    <button type="button" class="erp-btn erp-btn--sm erp-btn--danger" data-v2-act="delete" data-id="${esc(row.id)}" data-name="${esc(row.name)}">
                      <i class="ji" data-i="trash" aria-hidden="true"></i><span>حذف</span>
                    </button>
                    <button type="button" class="erp-btn erp-btn--sm" data-v2-act="statement" data-id="${esc(row.id)}" data-name="${esc(row.name)}">
                      <i class="ji" data-i="receipt" aria-hidden="true"></i><span>كشف حساب</span>
                    </button>
                  </span>`,
            }] : []),
        ],
    });

    q('[data-v2-table]').appendChild(table.el);

    /* ── بحث الموردين (خادمي، فوق الجدول) ─────────────────────────────────
       الجدول أدناه يصفّي ما حُمِّل في الذاكرة؛ هذا يبحث في الدليل كله عبر
       `/procurement/suppliers/search`: اسم عربي ضبابي (arFuzzyPattern) أو
       الرقم الضريبي أو السجل التجاري أو الاسم الإنجليزي، مع ترقيم وفلتر
       ضريبي. النتائج لا تحمل مجاميع مالية — الخادم لا يجمعها في هذا المسار —
       فلا نعرض رقمًا مخترعًا: كشف الحساب هو من يجلب الأرقام.
       (يحتاج حرفين: حرف واحد يطابق كل شيء فيبدو البحث معطوبًا.) */
    const searchQ = q('[data-v2-search-q]');
    const searchTax = q('[data-v2-search-tax]');
    const searchStatus = q('[data-v2-search-status]');
    const searchList = q('[data-v2-search-list]');
    const searchPager = q('[data-v2-search-pager]');
    const searchPageEl = q('[data-v2-search-page]');
    const searchClear = q('[data-v2-search-clear]');
    const searchPrev = q('[data-v2-search-prev]');
    const searchNext = q('[data-v2-search-next]');
    const SEARCH_MIN = 2;
    let searchTimer = null;
    let searchSeq = 0;
    let searchPage = 1;
    let searchPages = 0;

    const searchBlank = () => !searchQ.value.trim() && searchTax.value === 'ALL';

    function resetSearch(message) {
        searchSeq += 1;                 // يبطل أي ردٍّ في الطريق
        searchPage = 1;
        searchPages = 0;
        searchList.hidden = true;
        searchList.innerHTML = '';
        searchPager.hidden = true;
        searchClear.hidden = searchBlank();
        searchStatus.textContent = message;
        searchStatus.removeAttribute('data-tone');
    }

    function paintSearchResults(out) {
        searchPage = out.page;
        searchPages = out.pages;
        searchClear.hidden = searchBlank();
        if (!out.total) {
            searchList.hidden = true;
            searchList.innerHTML = '';
            searchPager.hidden = true;
            searchStatus.textContent = 'لا مورد يطابق هذا البحث — جرّب جزءًا من الاسم أو أول أرقام الرقم الضريبي.';
            searchStatus.setAttribute('data-tone', 'empty');
            return;
        }
        searchStatus.removeAttribute('data-tone');
        searchStatus.textContent = out.pages > 1
            ? `${formatInt(out.total)} نتيجة — صفحة ${formatInt(out.page)} من ${formatInt(out.pages)}`
            : `${formatInt(out.total)} نتيجة`;
        searchList.innerHTML = out.rows.map((s) => {
            const active = !(s.is_active === false || s.is_active === 'false' || s.is_active === 0);
            const taxLabel = s.tax_status === 'REGISTERED' ? 'مسجل ضريبيًا'
                : s.tax_status === 'EXEMPT' ? 'معفى' : 'غير مسجل';
            const dot = '<span class="erp-supsearch__dot" aria-hidden="true">·</span>';
            const meta = [
                s.phone ? `<span class="erp-num" dir="ltr">${esc(s.phone)}</span>` : '',
                s.category ? esc(s.category) : '',
                s.vat_number ? `<span class="erp-num" dir="ltr">VAT ${esc(s.vat_number)}</span>` : '',
                taxLabel,
            ].filter(Boolean).join(dot);
            /* «تعديل» يظهر فقط لمن سجلُه الكامل محمّل في الجدول: نموذج
               التعديل يقرأ openingBalance/address/notes، ونتيجة البحث لا
               تحملها — ففتحه منها كان سيمسح ما لا نعرفه. */
            const editable = writable && rawById.has(String(s.id));
            return `<li class="erp-supsearch__item${active ? '' : ' is-inactive'}">
              <div class="erp-supsearch__id">
                <strong class="erp-supsearch__name">${esc(s.name || `#${s.id}`)}</strong>
                ${s.name_en ? `<span class="erp-supsearch__en" dir="ltr">${esc(s.name_en)}</span>` : ''}
                <span class="erp-supsearch__meta">${meta}</span>
              </div>
              <span class="erp-supsearch__badge" data-tone="${active ? 'success' : 'neutral'}">${active ? 'نشط' : 'موقوف'}</span>
              <span class="erp-row-wrap">
                <button type="button" class="erp-btn erp-btn--sm" data-v2-search-show="${esc(s.name || '')}">
                  <i class="ji" data-i="clipboard-list" aria-hidden="true"></i><span>في الدليل</span></button>
                <button type="button" class="erp-btn erp-btn--sm" data-v2-search-statement="${esc(s.id)}" data-name="${esc(s.name || '')}">
                  <i class="ji" data-i="receipt" aria-hidden="true"></i><span>كشف حساب</span></button>
                ${editable ? `<button type="button" class="erp-btn erp-btn--sm" data-v2-search-edit="${esc(s.id)}">
                  <i class="ji" data-i="pencil" aria-hidden="true"></i><span>تعديل</span></button>` : ''}
              </span>
            </li>`;
        }).join('');
        searchList.hidden = false;
        searchPager.hidden = out.pages <= 1;
        searchPageEl.textContent = `${formatInt(out.page)} / ${formatInt(out.pages)}`;
        searchPrev.disabled = out.page <= 1;
        searchNext.disabled = out.page >= out.pages;
    }

    async function runSearch({ page = 1 } = {}) {
        const term = searchQ.value.trim();
        searchClear.hidden = searchBlank();
        if (term.length < SEARCH_MIN && searchTax.value === 'ALL') {
            resetSearch(term
                ? `أكمل ${formatInt(SEARCH_MIN)} حرفين على الأقل — البحث يبدأ من حرفين.`
                : 'بحث فوري في كل الموردين — بالاسم أو الرقم الضريبي أو السجل التجاري.');
            return;
        }
        const seq = ++searchSeq;
        searchStatus.textContent = 'جارٍ البحث…';
        searchStatus.removeAttribute('data-tone');
        try {
            const out = await searchSuppliers({ q: term, taxStatus: searchTax.value, page });
            if (seq !== searchSeq || !el.isConnected) {return;}
            paintSearchResults(out);
        } catch (e) {
            if (seq !== searchSeq || !el.isConnected) {return;}
            resetSearch(`تعذّر البحث: ${(e && e.message) || 'خطأ'}`);
            searchStatus.setAttribute('data-tone', 'error');
        }
    }

    function onSearchInput() {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(() => {runSearch({ page: 1 });}, 250);
    }

    searchQ.addEventListener('input', onSearchInput);
    searchQ.addEventListener('search', onSearchInput);   // زر المسح داخل حقل البحث
    searchTax.addEventListener('change', () => {runSearch({ page: 1 });});

    function paintKpis(summary) {
        const cur = formatMoney(0, currency).hasUnit ? formatMoney(0, currency).unit : '';
        const m = (v) => formatMoney(v, currency).amount;
        kpisHost.innerHTML = kpiStrip([
            {
                icon: 'users', label: 'موردون نشطون', en: 'Active Suppliers',
                value: String(summary.activeSuppliers),
                unit: `/ ${formatInt(summary.totalSuppliers)}`,
                pill: null, hint: 'من دليل الموردين',
            },
            {
                icon: 'banknote', label: 'إجمالي المشتريات', en: 'Purchases',
                value: m(summary.purchasesTotal), unit: cur,
                pill: null, hint: 'مجموع فواتير الموردين المرتبطة',
            },
            {
                icon: 'wallet', label: 'إجمالي المدفوعات', en: 'Payments',
                value: m(summary.paymentsTotal), unit: cur,
                pill: null, hint: 'مجموع مدفوعات الموردين',
            },
            {
                icon: 'alert-triangle', label: 'المستحق للموردين', en: 'Amount Due',
                value: m(summary.dueTotal), unit: cur,
                pill: summary.unpaidInvoices > 0
                    ? { text: String(summary.unpaidInvoices), aria: `${formatInt(summary.unpaidInvoices)} فاتورة غير مدفوعة` }
                    : null,
                hint: 'الافتتاحي + المشتريات − المدفوعات',
            },
        ], 'ملخص المشتريات — محسوبة في الخادم');
    }

    /* ── Form (in-card panel — no legacy modal, no inline handler) ───── */
    const SUPPLIER_FIELDS = ['name', 'name_en', 'phone', 'email', 'category', 'address', 'notes', 'openingBalance', 'tax_registration_status', 'vat_number', 'commercial_register'];

    function fieldHtml(key, label, opts = {}) {
        const value = editing && editing[key] !== undefined && editing[key] !== null
            ? editing[key]
            : (opts.default ?? '');
        if (key === 'tax_registration_status') {
            const cur = String(value || 'NOT_REGISTERED');
            const opt = (v, t) => `<option value="${v}"${cur === v ? ' selected' : ''}>${t}</option>`;
            return `
          <div class="erp-field">
            <label class="erp-label" for="v2sup-${key}">${esc(label)}</label>
            <select class="erp-select" id="v2sup-${key}" name="${key}">
              ${opt('NOT_REGISTERED', 'غير مسجل')}${opt('REGISTERED', 'مسجل ضريبيًا')}${opt('EXEMPT', 'معفى')}
            </select>
          </div>`;
        }
        return `
          <div class="erp-field">
            <label class="erp-label" for="v2sup-${key}">${esc(label)}${opts.required ? ' *' : ''}</label>
            <input class="erp-input${opts.ltr ? ' erp-input--ltr' : ''}" id="v2sup-${key}" name="${key}"
                    value="${esc(value)}"${opts.maxlength ? ` maxlength="${opts.maxlength}"` : ''}
                    placeholder="${esc(opts.placeholder || '')}">
          </div>`;
    }

    function formHtml() {
        return `
          <form class="erp-stack" data-v2-form-el novalidate>
            <h4 class="erp-card__title">${editing ? 'تعديل المورد' : 'مورد جديد'}</h4>
            <div class="erp-row-wrap">
              <div class="erp-grow">${fieldHtml('name', 'الاسم', { required: true, placeholder: 'شركة التوريد' })}</div>
              <div class="erp-grow">${fieldHtml('name_en', 'الاسم بالإنجليزية', { ltr: true })}</div>
            </div>
            <div class="erp-row-wrap">
              <div class="erp-grow">${fieldHtml('phone', 'الهاتف', { ltr: true })}</div>
              <div class="erp-grow">${fieldHtml('email', 'البريد', { ltr: true })}</div>
            </div>
            <div class="erp-row-wrap">
              <div class="erp-grow">${fieldHtml('category', 'نوع التوريد', { placeholder: 'لحوم / خضار / مشروبات' })}</div>
              <div class="erp-grow">${fieldHtml('openingBalance', 'الرصيد الافتتاحي', { ltr: true, placeholder: '0' })}</div>
            </div>
            ${fieldHtml('address', 'العنوان')}
            ${fieldHtml('notes', 'ملاحظات')}
            <div class="erp-row-wrap">
              <div class="erp-grow">${fieldHtml('tax_registration_status', 'الحالة الضريبية')}</div>
              <div class="erp-grow">${fieldHtml('vat_number', 'الرقم الضريبي (15 رقمًا)', { ltr: true, maxlength: 15 })}</div>
              <div class="erp-grow">${fieldHtml('commercial_register', 'السجل التجاري', { ltr: true, maxlength: 20 })}</div>
            </div>
            <p class="erp-text-sm erp-text-muted">الاسم مكرر أو الرقم الضريبي مكرر يرفضهما الخادم — وتظهر رسالته حرفيًا هنا.</p>
            <div class="erp-error" id="v2sup-form-error" data-v2-form-error role="alert"></div>
            <div class="erp-row-wrap">
              <span class="erp-grow"></span>
              <button type="button" class="erp-btn" data-v2-form-cancel>إلغاء</button>
              <button type="submit" class="erp-btn erp-btn--primary" data-v2-form-save>
                <i class="ji" data-i="save" aria-hidden="true"></i><span>حفظ</span>
              </button>
            </div>
          </form>`;
    }

    function openForm(row) {
        if (!writable) {return;}
        // The table row carries display strings; the form needs raw fields.
        // Re-read the raw record so openingBalance/vat/email edit truthfully.
        const raw = row ? rawById.get(String(row.id)) : null;
        editing = raw ? { ...raw } : null;
        formHost.innerHTML = formHtml();
        formHost.hidden = false;
        formHost.querySelector('[name="name"]')?.focus();
    }

    function closeForm() {
        editing = null;
        formHost.hidden = true;
        formHost.innerHTML = '';
    }

    function readForm() {
        const out = {};
        const form = formHost.querySelector('[data-v2-form-el]');
        if (!form) {return out;}
        for (const key of SUPPLIER_FIELDS) {
            const input = form.querySelector(`[name="${key}"]`);
            out[key] = input ? input.value : '';
        }
        return out;
    }

    function showFormErrors(errors) {
        paintFormErrors(
            formHost.querySelector('[data-v2-form-el]'),
            formHost.querySelector('[data-v2-form-error]'),
            errors,
        );
    }

    async function submitForm(event) {
        event.preventDefault();
        if (saving) {return;}
        const form = readForm();
        const errors = validateSupplierForm(form);
        if (errors.length) {
            showFormErrors(errors);
            return;
        }
        showFormErrors([]);
        saving = true;
        const saveBtn = formHost.querySelector('[data-v2-form-save]');
        if (saveBtn) {saveBtn.disabled = true;}
        try {
            if (editing && editing.id !== undefined) {
                await updateSupplier(editing.id, form);
                if (!el.isConnected) {return;}      // navigated away mid-save
                notify(`تم تعديل المورد «${String(form.name).trim()}»`);
            } else {
                await createSupplier(form);
                if (!el.isConnected) {return;}
                notify(`تم إنشاء المورد «${String(form.name).trim()}»`);
            }
            closeForm();
            await reload();
        } catch (e) {
            if (!el.isConnected) {return;}
            // The server's sentence stays verbatim: a duplicate name or a bad
            // VAT is the operator's to fix, not ours to re-word.
            showFormErrors([{ field: '', message: (e && e.message) || 'فشل الحفظ' }]);
        } finally {
            saving = false;
            const btn = formHost.querySelector('[data-v2-form-save]');
            if (btn) {btn.disabled = false;}
        }
    }

    async function runAction(action, id, name) {
        if (saving) {return;}
        if (action === 'toggle') {
            const row = rows.find((r) => String(r.id) === String(id));
            const willDisable = row && row.status === 'active';
            if (!confirmFn(willDisable
                ? `إيقاف المورد «${name}»؟ يُخفى من القوائم، وسجلاته تبقى كما هي.`
                : `إعادة تفعيل المورد «${name}»؟`)) {return;}
        }
        if (action === 'delete') {
            if (!confirmFn(`حذف المورد «${name}» نهائيًا؟ يرفض الخادم الحذف لو له فواتير أو دفعات — وعندها عطّله بدلًا من ذلك.`)) {return;}
        }
        saving = true;
        try {
            if (action === 'toggle') {
                await toggleSupplier(id);
                if (!el.isConnected) {return;}      // navigated away mid-write
                notify(`تم تحديث حالة المورد «${name}»`);
            } else if (action === 'delete') {
                await deleteSupplier(id);
                if (!el.isConnected) {return;}
                notify(`تم حذف المورد «${name}»`);
            }
            await reload();
        } catch (e) {
            if (!el.isConnected) {return;}
            // 409 arrives as the server's own sentence (counts included) —
            // the operator reads why, not a paraphrase of it.
            notify(`فشلت العملية: ${(e && e.message) || 'خطأ'}`, 'error');
        } finally {
            saving = false;
        }
    }

    /** إغلاق كشف الحساب: يزيل اللوحة ويعيد الحالة. */
    function closeStatement() {
        if (statementPop) { statementPop.remove(); statementPop = null; }
    }

    /**
     * كشف حساب مورد — من سطر الجدول أو من نتيجة البحث.
     * نتيجة البحث تحمل الاسم والمعرّف فقط، فالأرقام تُرسم بعد وصول الكشف
     * (totals.debit = المشتريات، totals.credit = المدفوعات، totals.closing =
     * المستحق) بدل عرض شرطات دائمة أو أرقام مخترعة.
     * @param {string|number} id
     * @param {{name?:string}} [seed]
     */
    async function openStatement(id, seed) {
        closeStatement();
        const row = rows.find((r) => String(r.id) === String(id))
            || { id, name: (seed && seed.name) || `#${id}` };
        statementPop = document.createElement('section');
        statementPop.className = 'erp-card erp-statement-pop';
        statementPop.innerHTML = `
          <div class="erp-statement-pop__head">
            <h4 class="erp-statement-pop__title">كشف حساب — ${esc(row.name)}</h4>
            <button type="button" class="erp-icon-btn erp-modal-x" aria-label="إغلاق كشف الحساب" title="إغلاق">
              <i class="ji" data-i="x" aria-hidden="true"></i>
            </button>
          </div>
          <div class="erp-statement-pop__meta">
            <b>المستحق:</b> <span class="erp-statement-pop__amt" data-v2-st-due>—</span>
            <b>المشتريات:</b> <span class="erp-statement-pop__amt" data-v2-st-buy>—</span>
            <b>المدفوعات:</b> <span class="erp-statement-pop__amt" data-v2-st-paid>—</span>
          </div>
          <div class="erp-statement-pop__table" data-v2-st-body>
            <div class="erp-statement-pop__row"><span>جارٍ التحميل…</span></div>
          </div>
        `;
        el.appendChild(statementPop);
        statementPop.querySelector('.erp-modal-x').addEventListener('click', closeStatement);
        /* لا إغلاق بنقرة خارج الكشف: هو سطحُ اطلاع، وX وحده يغلقه — نفس
           عقد عارض المستندات. */
        try {
            const data = await fetchSupplierStatement(row.id);
            const body = statementPop.querySelector('[data-v2-st-body]');
            if (!data || !body) {return;}
            const st = data.statement || { rows: [], totals: {}, openingBalance: 0 };
            const m = (v) => formatMoney(v, currency).amount;
            const paint = (sel, v) => {
                const node = statementPop.querySelector(sel);
                if (node) { node.textContent = m(v); }
            };
            paint('[data-v2-st-buy]', st.totals.debit || 0);
            paint('[data-v2-st-paid]', st.totals.credit || 0);
            paint('[data-v2-st-due]', st.totals.closing || 0);
            body.innerHTML = st.rows.map((r) => `
              <div class="erp-statement-pop__row ${r.debit > 0 ? 'debit' : r.credit > 0 ? 'credit' : ''}">
                <span class="erp-statement-pop__date">${r.date || '—'}</span>
                <span title="${esc(r.ref || '')}">${esc(r.ref || '—')}</span>
                <span title="${esc(r.description || '')}">${esc(r.description || '')}</span>
                <span class="erp-statement-pop__amt erp-statement-pop__debit">${r.debit > 0 ? m(r.debit) : ''}</span>
                <span class="erp-statement-pop__amt erp-statement-pop__credit">${r.credit > 0 ? m(r.credit) : ''}</span>
                <span class="erp-statement-pop__amt">${m(r.balance)}</span>
              </div>`).join('') || `<div class="erp-statement-pop__empty">لا حركات في المدى المختار.</div>`;
            const foot = document.createElement('div');
            foot.className = 'erp-statement-pop__row total';
            foot.innerHTML = `
              <span>المجموع</span><span></span><span>${st.totals.debit ? m(st.totals.debit) : ''}</span>
              <span class="erp-statement-pop__amt">${st.totals.credit ? m(st.totals.credit) : ''}</span>
              <span class="erp-statement-pop__amt">${m(st.totals.closing)}</span>
            `;
            body.appendChild(foot);
        } catch (e) {
            const body = statementPop.querySelector('[data-v2-st-body]');
            if (body) { body.innerHTML = `<div class="erp-statement-pop__empty">تعذّر تحميل الكشف: ${(e && e.message) || 'خطأ'}</div>`; }
        }
    }

    async function reload() {
        if (loading) {queued = true; return;}
        loading = true;
        table.setLoading(true);
        try {
            const [summary, suppliers, cur] = await Promise.all([
                fetchProcurementSummary(),
                fetchSuppliers(),
                fetchCurrency().catch(() => ''),
            ]);
            if (!el.isConnected) {return;}          // destroyed while in flight
            currency = String(cur ?? '');
            currencyNote.hidden = !!currency;
            rows = suppliers.map(supplierToRow);
            rawById = new Map(suppliers.map((s) => [String(s.id), s]));
            table.setRows(rows);
            paintKpis(summary);
            countEl.textContent = rows.length ? `(${formatInt(rows.length)})` : '';
        } catch (e) {
            if (!el.isConnected) {return;}
            rows = [];
            rawById = new Map();
            table.setRows([]);
            kpisHost.innerHTML = '';
            countEl.textContent = '';
            table.setError(e && e.message === 'UNAUTHORIZED'
                ? 'انتهت الجلسة — سجّل الدخول في النظام الحالي ثم أعد فتح الوضع الحيّ.'
                : (e && e.code === 'FORBIDDEN'
                    ? 'لا صلاحية لعرض المشتريات بهذا الحساب — القرار للخادم وحده.'
                    : `تعذّر تحميل الموردين: ${(e && e.message) || 'خطأ'}`));
        } finally {
            table.setLoading(false);
            loading = false;
            if (queued && el.isConnected) {
                queued = false;
                reload();                            // the newest read wins
            }
        }
    }

    el.addEventListener('click', (event) => {
        const hubBtn = event.target.closest('[data-v2-hub]');
        if (hubBtn) {
            if (!hubBtn.classList.contains('is-active')) {navigate(hubBtn.dataset.v2Hub);}
            return;
        }
        if (event.target.closest('[data-v2-reload]')) {reload(); return;}
        if (event.target.closest('[data-v2-add]')) {openForm(null); return;}
        if (event.target.closest('[data-v2-form-cancel]')) {closeForm(); return;}

        /* بحث الموردين */
        if (event.target.closest('[data-v2-search-clear]')) {
            searchQ.value = '';
            searchTax.value = 'ALL';
            clearTimeout(searchTimer);
            runSearch({ page: 1 });
            searchQ.focus();
            return;
        }
        if (event.target.closest('[data-v2-search-prev]')) {
            if (searchPage > 1) {runSearch({ page: searchPage - 1 });}
            return;
        }
        if (event.target.closest('[data-v2-search-next]')) {
            if (searchPage < searchPages) {runSearch({ page: searchPage + 1 });}
            return;
        }
        const searchStatementBtn = event.target.closest('[data-v2-search-statement]');
        if (searchStatementBtn) {
            openStatement(searchStatementBtn.dataset.v2SearchStatement,
                { name: searchStatementBtn.dataset.name || '' });
            return;
        }
        const searchEditBtn = event.target.closest('[data-v2-search-edit]');
        if (searchEditBtn) {
            const row = rows.find((item) => String(item.id) === String(searchEditBtn.dataset.v2SearchEdit));
            if (row) {openForm(row);}
            return;
        }
        const searchShowBtn = event.target.closest('[data-v2-search-show]');
        if (searchShowBtn) {
            /* «في الدليل» يمرّر الجدول إلى اسم المورد بدل تكرار صفّه هنا. */
            table.setQuery(searchShowBtn.dataset.v2SearchShow || '');
            q('[data-v2-table]').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
            return;
        }

        const actBtn = event.target.closest('[data-v2-act]');
        if (actBtn) {
            if (actBtn.disabled) {return;}
            if (actBtn.dataset.v2Act === 'statement') {
                openStatement(actBtn.dataset.id);
                return;
            }
            if (actBtn.dataset.v2Act === 'edit') {
                const row = rows.find((item) => String(item.id) === String(actBtn.dataset.id));
                if (row) {openForm(row);}
                return;
            }
            runAction(actBtn.dataset.v2Act, actBtn.dataset.id, actBtn.dataset.name || '');
            return;
        }
        if (event.target.closest('[data-erp-retry]')) {reload();}
    });

    formHost.addEventListener('submit', submitForm);

    reload();

    return {
        el,
        reload,
        getRows: () => rows,
        destroy() {
            clearTimeout(searchTimer);
            closeStatement();
            closeForm();
            table.destroy();
            el.remove();
        },
    };
}
