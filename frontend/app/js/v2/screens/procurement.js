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

import { createDataTable } from '../data-display/data-table.js?v=4.9.154';
import { statusBadge } from '../status.js?v=4.9.154';
import { canWrite } from '../session.js?v=4.9.154';
import {
    fetchProcurementSummary, fetchSuppliers, supplierToRow,
    fetchCurrency, formatMoney, formatInt, SUPPLIER_WRITE_ROLES,
    validateSupplierForm, createSupplier, updateSupplier, toggleSupplier,
    deleteSupplier, fetchSupplierStatement,
} from '../data/procurement-repo.js?v=4.9.154';

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

function kpiStrip(kpis) {
    return `<ul class="erp-kpis" aria-label="ملخص المشتريات — محسوبة في الخادم">`
        + kpis.map((k) => `
      <li class="erp-kpi">
        <div class="erp-kpi__top">
          <span class="erp-kpi__icon" aria-hidden="true"><i class="ji" data-i="${esc(k.icon)}"></i></span>
          <span class="erp-kpi__label">${esc(k.label)}<span class="erp-eyebrow" dir="ltr" lang="en">${esc(k.en)}</span></span>
        </div>
        <div class="erp-kpi__value"><span class="erp-num" dir="ltr">${esc(k.value)}</span>${k.unit ? ` <span class="erp-kpi__unit">${esc(k.unit)}</span>` : ''}</div>
        <div class="erp-kpi__foot">
          ${k.pill ? `<span class="erp-delta erp-delta--flat" role="img" aria-label="${esc(k.pill.aria)}"><span class="erp-num" dir="ltr">${esc(k.pill.text)}</span></span>` : ''}
          <span class="erp-kpi__hint">${esc(k.hint)}</span>
        </div>
      </li>`).join('')
        + `</ul>`;
}

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
          <p class="erp-text-sm erp-text-muted">
            الدليل والملخص من وجه الخادم الحالي
            (<span class="erp-addr" dir="ltr">/api/procurement/suppliers</span> و
            <span class="erp-addr" dir="ltr">/summary</span>)، والصلاحية قررها
            الخادم وحده. المستحق = الافتتاحي + المشتريات − المدفوعات كما
            يحسبها الخادم. فواتير الموردين ومدفوعاتهم شاشتان مستقلتان (06/07).
            <span data-v2-currency-note hidden>تعذّرت قراءة وحدة المال من الإعدادات — المبالغ تُعرض بلا وحدة.</span>
          </p>
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
    let statementPop = null;     // نافذة كشف الحساب المنбряقة (تُغلَق عند التنقل)
    let statementOutside = null; // معالج النقر خارج اللوحة (يُفكَّك معها)

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
                render: (row) => moneyCell(row.purchasesTotal, currency, { title: 'SUM(totalAmount) لفواتير هذا المورد' }),
            },
            {
                key: 'paymentsTotal', header: 'المدفوعات', sortable: true, type: 'number',
                width: '130px', align: 'end', value: (row) => row.paymentsTotal,
                render: (row) => moneyCell(row.paymentsTotal, currency, { title: 'SUM(amount) لمدفوعات هذا المورد' }),
            },
            {
                key: 'dueTotal', header: 'المستحق', sortable: true, type: 'number',
                width: '130px', align: 'end', value: (row) => row.dueTotal,
                render: (row) => moneyCell(row.dueTotal, currency, { title: 'الافتتاحي + المشتريات − المدفوعات كما في الخادم' }),
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
                pill: null, hint: 'SUM(totalAmount) المرتبطة بموردين',
            },
            {
                icon: 'wallet', label: 'إجمالي المدفوعات', en: 'Payments',
                value: m(summary.paymentsTotal), unit: cur,
                pill: null, hint: 'SUM(amount) لمدفوعات الموردين',
            },
            {
                icon: 'alert-triangle', label: 'المستحق للموردين', en: 'Amount Due',
                value: m(summary.dueTotal), unit: cur,
                pill: summary.unpaidInvoices > 0
                    ? { text: String(summary.unpaidInvoices), aria: `${formatInt(summary.unpaidInvoices)} فاتورة غير مدفوعة` }
                    : null,
                hint: 'الافتتاحي + المشتريات − المدفوعات',
            },
        ]);
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
            <div class="erp-error" data-v2-form-error role="alert"></div>
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
        const box = formHost.querySelector('[data-v2-form-error]');
        if (!box) {return;}
        box.textContent = errors.map((e) => e.message).join(' · ');
        const form = formHost.querySelector('[data-v2-form-el]');
        if (!form) {return;}
        for (const key of SUPPLIER_FIELDS) {
            const input = form.querySelector(`[name="${key}"]`);
            if (input) {input.setAttribute('aria-invalid', errors.some((e) => e.field === key) ? 'true' : 'false');}
        }
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

    /** إغلاق كشف الحساب: يفكك معالج النقر خارج ثم يزيل اللوحة. */
    function closeStatement() {
        if (statementOutside) {
            document.removeEventListener('click', statementOutside, true);
            statementOutside = null;
        }
        if (statementPop) { statementPop.remove(); statementPop = null; }
    }

    async function openStatement(id) {
        closeStatement();
        const row = rows.find((r) => String(r.id) === String(id));
        if (!row) {return;}
        statementPop = document.createElement('section');
        statementPop.className = 'erp-card erp-statement-pop';
        statementPop.innerHTML = `
          <div class="erp-statement-pop__head">
            <h4 class="erp-statement-pop__title">كشف حساب — ${esc(row.name)}</h4>
            <button type="button" class="erp-statement-pop__close" aria-label="إغلاق كشف الحساب">
              <i class="ji" data-i="x" aria-hidden="true"></i>
            </button>
          </div>
          <div class="erp-statement-pop__meta">
            <b>المستحق:</b> <span class="erp-statement-pop__amt">${formatMoney(row.dueTotal, currency).amount}</span>
            <b>المشتريات:</b> <span class="erp-statement-pop__amt">${formatMoney(row.purchasesTotal, currency).amount}</span>
            <b>المدفوعات:</b> <span class="erp-statement-pop__amt">${formatMoney(row.paymentsTotal, currency).amount}</span>
          </div>
          <div class="erp-statement-pop__table" data-v2-st-body>
            <div class="erp-statement-pop__row"><span>جارٍ التحميل…</span></div>
          </div>
        `;
        el.appendChild(statementPop);
        statementPop.querySelector('.erp-statement-pop__close').addEventListener('click', closeStatement);
        // النقر خارج اللوحة يغلقها — بحصاد capture لنقرات الزر نفسه (يفتحها) بعد this phase.
        statementOutside = (ev) => {
            const t = ev.target;
            if (statementPop && t && typeof t.closest === 'function'
                && !statementPop.contains(t) && !t.closest('[data-v2-act="statement"]')) { closeStatement(); }
        };
        document.addEventListener('click', statementOutside, true);
        try {
            const data = await fetchSupplierStatement(row.id);
            const body = statementPop.querySelector('[data-v2-st-body]');
            if (!data || !body) {return;}
            const st = data.statement || { rows: [], totals: {}, openingBalance: 0 };
            const m = (v) => formatMoney(v, currency).amount;
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
        const actBtn = event.target.closest('[data-v2-act]');
        if (actBtn) {
            if (actBtn.disabled) {return;}
            if (actBtn.dataset.v2Act === 'statement') {
                openStatement(actBtn.dataset.id);
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
            closeStatement();
            closeForm();
            table.destroy();
            el.remove();
        },
    };
}
