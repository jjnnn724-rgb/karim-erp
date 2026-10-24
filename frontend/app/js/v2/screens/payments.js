/**
 * V2 — Supplier payments screen · شاشة 07 في سجل الترحيل (قراءة + عكس دفعة)
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Same per-screen contract as 01-06: doors in
 * v2/data/procurement-repo.js (payments) + supplier directory for names +
 * purchase invoices for the linked-invoice number (opportunistic join with
 * stated fallback), delegated listeners on a per-mount root, loading
 * guards, isConnected checks, destroy() on nav. Part of the procurement
 * hub (05/06/07 share the tab strip pattern; switching tabs navigates
 * via ctx.navigate).
 *
 * ONE WRITE DOOR (owner approval): reversing a payment —
 * procurement-repo.deletePayment → DELETE /procurement/payments/:id, which
 * the server guards to admin only. The word used in the UI is «عكس» because
 * that is what the operator means, and the confirm states plainly that the
 * row is deleted and its invoice recalculated (no compensating entry, no
 * undo). Recording a NEW payment is not this screen's door.
 */

import { createDataTable } from '../data-display/data-table.js?v=4.9.156';
import { canWrite } from '../session.js?v=4.9.156';
import {
    fetchSupplierPayments, fetchSuppliers, paymentToRow,
    fetchCurrency, formatMoney, formatInt, PAYMENT_DELETE_ROLES,
    deletePayment,
} from '../data/procurement-repo.js?v=4.9.156';
import { fetchPurchaseInvoices } from '../data/purchase-invoices-repo.js?v=4.9.156';

const esc = (v) => String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

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

/** Local YYYY-MM-DD (device calendar — same basis as the legacy today()). */
function isoDay(offsetDays = 0) {
    const d = new Date();
    d.setDate(d.getDate() + offsetDays);
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function moneyCell(v, currency, opts = {}) {
    const m = formatMoney(v, currency);
    const n = `<span class="erp-num" dir="ltr">${m.amount}</span>`;
    const u = m.hasUnit ? ` <span class="erp-text-sm erp-text-muted">${esc(m.unit)}</span>` : '';
    const body = `${n}${u}`;
    return opts.title ? `<span title="${esc(opts.title)}">${body}</span>` : body;
}

function template(from, to) {
    return `
      <section class="erp-card erp-v2-payments">
        <div class="erp-card__head">
          <h3 class="erp-card__title">مدفوعات الموردين
            <span class="erp-eyebrow" dir="ltr" lang="en">Supplier Payments</span>
            <span class="erp-text-muted erp-text-sm" data-v2-count></span>
          </h3>
          <span class="erp-grow"></span>
          <span data-v2-hub>${hubTabs('procurement-payments')}</span>
          <label class="erp-text-sm erp-text-muted" for="v2pay-sup">المورد</label>
          <select class="erp-select" id="v2pay-sup" data-v2-sup>
            <option value="">كل الموردين</option>
          </select>
          <label class="erp-text-sm erp-text-muted" for="v2pay-from">من</label>
          <input class="erp-input erp-input--ltr" id="v2pay-from" type="date" value="${esc(from)}" max="${esc(isoDay(0))}">
          <label class="erp-text-sm erp-text-muted" for="v2pay-to">إلى</label>
          <input class="erp-input erp-input--ltr" id="v2pay-to" type="date" value="${esc(to)}" max="${esc(isoDay(0))}">
          <button type="button" class="erp-btn erp-btn--primary erp-btn--sm" data-v2-reload>
            <i class="ji" data-i="refresh" aria-hidden="true"></i><span>عرض</span>
          </button>
        </div>
        <div class="erp-card__body erp-stack">
          <p class="erp-text-sm erp-text-muted" data-v2-summary role="status" aria-live="polite"></p>
            <p class="erp-text-sm erp-text-muted" data-v2-currency-note hidden>تعذّرت قراءة وحدة المال من الإعدادات — المبالغ تُعرض بلا وحدة.</p>
          <div data-v2-table></div>
        </div>
      </section>`;
}

/**
 * @param {ParentNode} host where the screen is inserted
 * @param {{role?: string|null, notify?: Function, navigate?: (key:string)=>void}} [ctx]
 * @returns {{el: HTMLElement, reload: ()=>Promise<void>, getRows: ()=>any[], destroy: ()=>void}}
 */
export function mountPaymentsScreen(host, ctx = {}) {
    const notify = typeof ctx.notify === 'function' ? ctx.notify : (m) => console.info('[V2 payments]', m);
    const navigate = typeof ctx.navigate === 'function' ? ctx.navigate : () => {};
    const confirmFn = typeof ctx.confirmFn === 'function' ? ctx.confirmFn
        : (m) => (typeof window !== 'undefined' && window.confirm ? window.confirm(m) : false);
    const writable = canWrite(ctx.role, PAYMENT_DELETE_ROLES);

    let rows = [];
    let currency = '';
    let loading = false;
    let queued = false;          // a refresh asked for while one was running
    let saving = false;
    let invoiceById = new Map();

    host.insertAdjacentHTML('beforeend', template(isoDay(-29), isoDay(0)));
    const el = host.lastElementChild;
    const q = (sel) => el.querySelector(sel);
    const countEl = q('[data-v2-count]');
    const summaryEl = q('[data-v2-summary]');
    const currencyNote = q('[data-v2-currency-note]');
    const supSelect = q('[data-v2-sup]');

    const table = createDataTable({
        caption: 'سجل مدفوعات الموردين — بيانات حية',
        mode: 'client',
        pageSize: 20,
        stickyHeader: true,
        emptyMessage: 'لا توجد دفعات في الفترة المحددة',
        emptyHint: 'وسّع المدة أو غيّر المورد.',
        rowKey: (row) => row.id,
        columns: [
            {
                key: 'date', header: 'التاريخ', sortable: true, width: '120px',
                align: 'center', className: 'erp-tnum',
                render: (row) => (row.date
                    ? `<span class="erp-num" dir="ltr">${esc(row.date)}</span>`
                    : `<span class="erp-text-muted">—</span>`),
            },
            { key: 'supplier', header: 'المورد', sortable: true, filterable: true },
            {
                key: 'amount', header: 'المبلغ', sortable: true, type: 'number',
                width: '140px', align: 'end', value: (row) => row.amount,
                render: (row) => moneyCell(row.amount, currency),
            },
            {
                key: 'methodAr', header: 'الطريقة', sortable: true, filterable: true, width: '130px',
                render: (row) => esc(row.methodAr),
            },
            {
                key: 'invoiceId', header: 'الفاتورة', width: '140px', className: 'erp-mono',
                render: (row) => {
                    if (!row.invoiceId) {return `<span class="erp-text-muted">—</span>`;}
                    const inv = invoiceById.get(String(row.invoiceId));
                    const label = inv && inv.invoiceNumber ? inv.invoiceNumber : `#${row.invoiceId}`;
                    return `<span title="${esc(inv && inv.invoiceNumber ? `فاتورة ${inv.invoiceNumber}` : 'رقم الفاتورة كما في السجل — لم تُحلّ')}">${esc(label)}</span>`;
                },
            },
            { key: 'notes', header: 'ملاحظات', filterable: true,
                render: (row) => (row.notes ? esc(row.notes) : `<span class="erp-text-muted">—</span>`) },
            { key: 'by', header: 'سجّلها', width: '130px',
                render: (row) => esc(row.by) },
            ...(writable ? [{
                key: 'actions',
                header: 'إجراء',
                width: '130px',
                align: 'end',
                value: () => '',
                render: (row) => `<button type="button" class="erp-btn erp-btn--sm erp-btn--danger" data-v2-act="void" data-id="${esc(row.id)}">
                      <i class="ji" data-i="undo" aria-hidden="true"></i><span>عكس</span>
                    </button>`,
            }] : []),
        ],
    });

    q('[data-v2-table]').appendChild(table.el);

    function paintSummary(capped) {
        const total = rows.reduce((a, r) => a + r.amount, 0);
        const m = `${formatMoney(total, currency).amount}${currency ? ` ${currency}` : ''}`;
        summaryEl.textContent = `الإجمالي ${m} · ${formatInt(rows.length)} دفعة${capped ? ' · بلغ الحد الأقصى (500) — ضيّق المدة' : ''}`;
        countEl.textContent = rows.length ? `(${formatInt(rows.length)})` : '';
    }

    function fillSuppliers(suppliers) {
        const keep = supSelect.value;
        supSelect.innerHTML = `<option value="">كل الموردين</option>`
            + suppliers.map((s) => `<option value="${esc(String(s.id))}"${String(s.id) === keep ? ' selected' : ''}>${esc(s.name || `#${s.id}`)}</option>`).join('');
    }

    /** Reversal is final: the row is deleted and the linked invoice is
     *  recalculated server-side. Explicit confirm, saving guard, and the
     *  server re-checks the admin role regardless. */
    async function runVoid(id) {
        if (saving) {return;}
        const row = rows.find((r) => String(r.id) === String(id));
        if (!row) {return;}
        const amount = `${formatMoney(row.amount, currency).amount}${currency ? ` ${currency}` : ''}`;
        if (!confirmFn(`عكس الدفعة (${amount} — ${row.supplier})؟ تُحذف نهائيًا ويُعاد حساب فاتورتها. لا تراجع.`)) {return;}
        saving = true;
        try {
            await deletePayment(id);
            if (!el.isConnected) {return;}          // navigated away mid-reversal
            notify(`تم عكس الدفعة (${amount})`);
            await reload();
        } catch (e) {
            if (!el.isConnected) {return;}
            notify(`فشل العكس: ${(e && e.message) || 'خطأ'}`, 'error');
        } finally {
            saving = false;
        }
    }

    async function reload() {
        if (loading) {queued = true; return;}
        loading = true;
        table.setLoading(true);
        try {
            const [payments, suppliers, invoices, cur] = await Promise.all([
                fetchSupplierPayments({ supplierId: supSelect.value, from: q('#v2pay-from').value, to: q('#v2pay-to').value }),
                fetchSuppliers().catch(() => []),
                fetchPurchaseInvoices().catch(() => []),
                fetchCurrency().catch(() => ''),
            ]);
            if (!el.isConnected) {return;}          // destroyed while in flight
            currency = String(cur ?? '');
            currencyNote.hidden = !!currency;
            fillSuppliers(suppliers);
            invoiceById = new Map(invoices.map((inv) => [String(inv.id), inv]));
            rows = payments.map(paymentToRow);
            table.setRows(rows);
            paintSummary(payments.length >= 500);
        } catch (e) {
            if (!el.isConnected) {return;}
            rows = [];
            table.setRows([]);
            summaryEl.textContent = '';
            countEl.textContent = '';
            table.setError(e && e.message === 'UNAUTHORIZED'
                ? 'انتهت الجلسة — سجّل الدخول في النظام الحالي ثم أعد فتح الوضع الحيّ.'
                : (e && e.code === 'FORBIDDEN'
                    ? 'لا صلاحية لعرض مدفوعات الموردين بهذا الحساب — القرار للخادم وحده.'
                    : `تعذّر تحميل الدفعات: ${(e && e.message) || 'خطأ'}`));
        } finally {
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
        const actBtn = event.target.closest('[data-v2-act]');
        if (actBtn) {
            if (actBtn.disabled) {return;}
            runVoid(actBtn.dataset.id);
            return;
        }
        if (event.target.closest('[data-v2-reload]')) {reload(); return;}
        if (event.target.closest('[data-erp-retry]')) {reload();}
    });
    /** Date pickers commit on change (calendar click or leaving the field),
     *  so Enter-only reloading was dead weight. */
    el.addEventListener('change', (event) => {
        if (event.target.matches('[data-v2-sup], #v2pay-from, #v2pay-to')) {reload();}
    });

    reload();

    return {
        el,
        reload,
        getRows: () => rows,
        destroy() {
            table.destroy();
            el.remove();
        },
    };
}
