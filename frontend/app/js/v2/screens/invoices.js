/**
 * V2 — Supplier invoices screen · شاشة 06 في سجل الترحيل (قراءة + تسديد كامل)
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Same per-screen contract as 01-05: doors in
 * v2/data/purchase-invoices-repo.js (+ suppliers for the name join),
 * delegated listeners on a per-mount root, loading guards, isConnected
 * checks, destroy() on nav. Part of the procurement hub: the tab strip
 * below is shared with 05/07 (local copy, documented pattern — no
 * cross-screen coupling); switching tabs navigates via ctx.navigate.
 *
 * ONE WRITE DOOR (owner approval): full-pay of the remaining balance, via
 * procurement-repo.payInvoiceFull → POST /procurement/invoices/:id/pay.
 * Everything else on this screen is a read; the register itself is not
 * edited here (no create, no void, no delete-all — those stay in the
 * legacy warehouse page until their own approved wave).
 */

import { createDataTable } from '../data-display/data-table.js?v=4.9.130';
import { statusBadge } from '../status.js?v=4.9.130';
import { canWrite } from '../session.js?v=4.9.130';
import {
    fetchPurchaseInvoices, invoiceToRow, invoiceRemaining, supplierIdMap,
} from '../data/purchase-invoices-repo.js?v=4.9.130';
import {
    fetchSuppliers, fetchCurrency, formatMoney, formatInt, PAYMENT_WRITE_ROLES,
    payInvoiceFull,
} from '../data/procurement-repo.js?v=4.9.130';

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

/** Money cell — stored unit or bare (reports-screen rule). */
function moneyCell(v, currency, opts = {}) {
    const m = formatMoney(v, currency);
    const n = `<span class="erp-num" dir="ltr">${m.amount}</span>`;
    const u = m.hasUnit ? ` <span class="erp-text-sm erp-text-muted">${esc(m.unit)}</span>` : '';
    const body = `${n}${u}`;
    return opts.title ? `<span title="${esc(opts.title)}">${body}</span>` : body;
}

function template() {
    return `
      <section class="erp-card erp-v2-invoices">
        <div class="erp-card__head">
          <h3 class="erp-card__title">فواتير الموردين
            <span class="erp-eyebrow" dir="ltr" lang="en">Supplier Invoices</span>
            <span class="erp-text-muted erp-text-sm" data-v2-count></span>
          </h3>
          <span class="erp-grow"></span>
          <span data-v2-hub>${hubTabs('procurement-invoices')}</span>
          <button type="button" class="erp-btn erp-btn--primary erp-btn--sm" data-v2-reload>
            <i class="ji" data-i="refresh" aria-hidden="true"></i><span>تحديث</span>
          </button>
        </div>
        <div class="erp-card__body erp-stack">
          <p class="erp-text-sm erp-text-muted" data-v2-summary role="status" aria-live="polite"></p>
          <p class="erp-text-sm erp-text-muted">
            السجل يُقرأ من وجه الخادم الحالي
            (<span class="erp-addr" dir="ltr">/api/purchaseInvoices</span>)،
            والصلاحية قررها الخادم وحده. الكتابة الوحيدة هنا تسديد كامل
            المتبقي بفاتورة، بتأكيد يعرض المبلغ — والإنشاء والإلغاء والحذف
            الجماعي باقٍ في صفحته القديمة حتى موجته. المتبقي = الإجمالي −
            المسدد (بحد صفر، قاعدة النظام القديم). حالة السداد المحفوظة
            تُعرض بعدّتها، والغائب يُقرأ «غير مسددة» كما في القديم.
            <span data-v2-currency-note hidden>تعذّرت قراءة وحدة المال من الإعدادات — المبالغ تُعرض بلا وحدة.</span>
          </p>
          <div data-v2-table></div>
        </div>
      </section>`;
}

/**
 * @param {ParentNode} host where the screen is inserted
 * @param {{role?: string|null, notify?: Function, navigate?: (key:string)=>void}} [ctx]
 * @returns {{el: HTMLElement, reload: ()=>Promise<void>, getRows: ()=>any[], destroy: ()=>void}}
 */
export function mountInvoicesScreen(host, ctx = {}) {
    const notify = typeof ctx.notify === 'function' ? ctx.notify : (m) => console.info('[V2 invoices]', m);
    const navigate = typeof ctx.navigate === 'function' ? ctx.navigate : () => {};
    const confirmFn = typeof ctx.confirmFn === 'function' ? ctx.confirmFn
        : (m) => (typeof window !== 'undefined' && window.confirm ? window.confirm(m) : false);
    const writable = canWrite(ctx.role, PAYMENT_WRITE_ROLES);

    let rows = [];
    let currency = '';
    let loading = false;
    let queued = false;          // a refresh asked for while one was running
    let saving = false;

    host.insertAdjacentHTML('beforeend', template());
    const el = host.lastElementChild;
    const q = (sel) => el.querySelector(sel);
    const countEl = q('[data-v2-count]');
    const summaryEl = q('[data-v2-summary]');
    const currencyNote = q('[data-v2-currency-note]');

    const table = createDataTable({
        caption: 'سجل فواتير الموردين — بيانات حية',
        mode: 'client',
        pageSize: 20,
        stickyHeader: true,
        emptyMessage: 'لا توجد فواتير',
        emptyHint: 'تحقق من صلاحية العرض.',
        rowKey: (row) => row.id,
        columns: [
            {
                key: 'number', header: 'رقم الفاتورة', sortable: true, filterable: true,
                width: '150px', className: 'erp-mono',
            },
            {
                key: 'date', header: 'التاريخ', sortable: true, filterable: true,
                width: '120px', align: 'center', className: 'erp-tnum',
            },
            { key: 'supplier', header: 'المورد', sortable: true, filterable: true },
            {
                key: 'total', header: 'الإجمالي', sortable: true, type: 'number',
                width: '130px', align: 'end', value: (row) => row.total,
                render: (row) => moneyCell(row.total, currency),
            },
            {
                key: 'paid', header: 'المسدد', sortable: true, type: 'number',
                width: '130px', align: 'end', value: (row) => row.paid,
                render: (row) => moneyCell(row.paid, currency),
            },
            {
                key: 'remaining', header: 'المتبقي', sortable: true, type: 'number',
                width: '130px', align: 'end', value: (row) => row.remaining,
                render: (row) => moneyCell(row.remaining, currency, { title: 'max(0, الإجمالي − المسدد)' }),
            },
            {
                key: 'status', header: 'السداد', sortable: true, filterable: true, width: '150px',
                value: (row) => row.status,
                render: (row) => statusBadge('payment', row.status),
            },
            ...(writable ? [{
                key: 'actions',
                header: 'إجراء',
                width: '150px',
                align: 'end',
                value: () => '',
                render: (row) => (row.remaining > 0
                    ? `<button type="button" class="erp-btn erp-btn--sm" data-v2-act="pay" data-id="${esc(row.id)}">
                        <i class="ji" data-i="banknote" aria-hidden="true"></i><span>تسديد الكل</span>
                      </button>`
                    : `<span class="erp-text-muted">—</span>`),
            }] : []),
        ],
    });

    q('[data-v2-table]').appendChild(table.el);

    function paintSummary() {
        const total = rows.reduce((a, r) => a + r.total, 0);
        const paid = rows.reduce((a, r) => a + r.paid, 0);
        const rem = rows.reduce((a, r) => a + invoiceRemaining(r), 0);
        const m = (v) => `${formatMoney(v, currency).amount}${currency ? ` ${currency}` : ''}`;
        summaryEl.textContent = `الإجمالي ${m(total)} · المسدد ${m(paid)} · المتبقي ${m(rem)} · ${formatInt(rows.length)} فاتورة`;
        countEl.textContent = rows.length ? `(${formatInt(rows.length)})` : '';
    }

    /** Full-pay with an explicit confirm showing the exact amount — the
     *  server recomputes the remainder itself and refuses already-paid
     *  (409), so a double-click can never double-pay. saving guards anyway. */
    async function runPay(id) {
        if (saving) {return;}
        const row = rows.find((r) => String(r.id) === String(id));
        if (!row || !(row.remaining > 0)) {return;}
        const amount = `${formatMoney(row.remaining, currency).amount}${currency ? ` ${currency}` : ''}`;
        if (!confirmFn(`تسديد كامل للفاتورة ${row.number} — ${amount} نقدًا؟`)) {return;}
        saving = true;
        try {
            await payInvoiceFull(id, { method: 'cash' });
            if (!el.isConnected) {return;}           // navigated away mid-pay
            notify(`تم تسديد الفاتورة ${row.number} (${amount})`);
            await reload();
        } catch (e) {
            if (!el.isConnected) {return;}
            notify(`فشل التسديد: ${(e && e.message) || 'خطأ'}`, 'error');
        } finally {
            saving = false;
        }
    }

    async function reload() {
        if (loading) {queued = true; return;}
        loading = true;
        table.setLoading(true);
        try {
            const [invoices, suppliers, cur] = await Promise.all([
                fetchPurchaseInvoices(),
                fetchSuppliers().catch(() => []),
                fetchCurrency().catch(() => ''),
            ]);
            if (!el.isConnected) {return;}          // destroyed while in flight
            currency = String(cur ?? '');
            currencyNote.hidden = !!currency;
            const byId = supplierIdMap(suppliers);
            rows = invoices.map((inv) => invoiceToRow(inv, byId));
            table.setRows(rows);
            paintSummary();
        } catch (e) {
            if (!el.isConnected) {return;}
            rows = [];
            table.setRows([]);
            summaryEl.textContent = '';
            countEl.textContent = '';
            table.setError(e && e.message === 'UNAUTHORIZED'
                ? 'انتهت الجلسة — سجّل الدخول في النظام الحالي ثم أعد فتح الوضع الحيّ.'
                : (e && e.code === 'FORBIDDEN'
                    ? 'لا صلاحية لعرض فواتير المشتريات بهذا الحساب — القرار للخادم وحده.'
                    : `تعذّر تحميل الفواتير: ${(e && e.message) || 'خطأ'}`));
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
        const actBtn = event.target.closest('[data-v2-act]');
        if (actBtn) {
            if (actBtn.disabled) {return;}
            runPay(actBtn.dataset.id);
            return;
        }
        if (event.target.closest('[data-v2-reload]')) {reload(); return;}
        if (event.target.closest('[data-erp-retry]')) {reload();}
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
