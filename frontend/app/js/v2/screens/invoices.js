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
 * PAYMENT DOORS (owner approval): full-pay of the remaining balance, via
 * procurement-repo.payInvoiceFull → POST /procurement/invoices/:id/pay,
 * plus a partial payment linked to an invoice via
 * procurement-repo.payInvoicePartial → POST /procurement/payments
 * (server re-checks amount ≤ remaining and recomputes paymentStatus;
 * reversible through the payments screen's admin-only reversal).
 *
 * DESTRUCTIVE TAIL (P1-4, separate wave): void one invoice and clear all.
 * Both server doors are requireRole('admin'); this screen draws them only
 * for admin AND the independent v2invoicevoid flag (OFF by default). The
 * void button carries the server's refusals (manual payments, force) and
 * the clear-all panel demands the same checkbox the legacy page demanded.
 * Creating/editing invoices lives on screen 08 (the legacy form's own page)
 * behind the independent v2invoicecreate flag — no door here.
 */

import { createDataTable } from '../data-display/data-table.js?v=4.9.187';
import { statusBadge } from '../status.js?v=4.9.187';
import { canWrite } from '../session.js?v=4.9.187';
import {
    fetchPurchaseInvoices, invoiceToRow, invoiceRemaining, supplierIdMap,
} from '../data/purchase-invoices-repo.js?v=4.9.187';
import {
    fetchSuppliers, fetchCurrency, formatMoney, formatInt, PAYMENT_WRITE_ROLES,
    payInvoiceFull, payInvoicePartial,
} from '../data/procurement-repo.js?v=4.9.187';
import {
    voidPurchaseInvoice, clearAllPurchaseInvoices, INVOICE_VOID_ROLES,
} from '../data/purchase-invoices-write-repo.js?v=4.9.187';
import { invoiceVoidWriteEnabled } from '../write-flags.js?v=4.9.187';

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
            السجل يُعرض من النظام مباشرة، والصلاحية محكومة بالأدوار. الكتابة
            هنا: تسديد كامل المتبقي، أو دفعة جزئية مرتبطة بالفاتورة (يرفض
            النظام ما يتجاوز المتبقي ويعيد حساب حالة السداد؛ والعكس متاح
            لاحقًا من شاشة المدفوعات لحساب مدير النظام). الإنشاء والتعديل في
            صفحة فواتير الشراء (08)؛ والإلغاء الفردي والحذف الجماعي لمدير
            النظام وحده، ويتحقق النظام من الصلاحية وعبارة التأكيد. المتبقي =
            الإجمالي − المسدد (بحد صفر). حالة السداد المحفوظة تُعرض بعدّتها،
            والغائب يُقرأ «غير مسددة».
            <span data-v2-currency-note hidden>تعذّرت قراءة وحدة المال من الإعدادات — المبالغ تُعرض بلا وحدة.</span>
          </p>
          <div data-v2-pay-form></div>
          <div data-v2-table></div>
          <div data-v2-danger></div>
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
    const canVoid = canWrite(ctx.role, INVOICE_VOID_ROLES) && invoiceVoidWriteEnabled();

    let rows = [];
    let currency = '';
    let loading = false;
    let queued = false;          // a refresh asked for while one was running
    let saving = false;
    let payingInvoice = null;    // partial-payment form target

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
            ...((writable || canVoid) ? [{
                key: 'actions',
                header: 'إجراء',
                width: '320px',
                align: 'end',
                value: () => '',
                render: (row) => {
                    const pay = row.remaining > 0
                        ? (row.supplierId
                            ? `<button type="button" class="erp-btn erp-btn--sm" data-v2-act="pay-part" data-id="${esc(row.id)}">
                                <i class="ji" data-i="coins" aria-hidden="true"></i><span>جزئي</span>
                              </button>`
                            : '')
                          + `<button type="button" class="erp-btn erp-btn--sm" data-v2-act="pay" data-id="${esc(row.id)}">
                            <i class="ji" data-i="banknote" aria-hidden="true"></i><span>تسديد الكل</span>
                          </button>`
                        : '';
                    const del = canVoid
                        ? `<button type="button" class="erp-btn erp-btn--sm erp-btn--danger" data-v2-act="void" data-id="${esc(row.id)}" aria-label="حذف الفاتورة ${esc(row.number)}">
                            <i class="ji" data-i="trash" aria-hidden="true"></i><span>حذف</span>
                          </button>`
                        : '';
                    if (!pay && !del) {return `<span class="erp-text-muted">—</span>`;}
                    return `<span class="erp-row-wrap">${pay}${del}</span>`;
                },
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

    /** Void one invoice — server reverses stock, voids the journal, deletes
     *  auto payments, then deletes the row. Manual payments stay a 409 with
     *  the server's own sentence; the screen only adds where to reverse it. */
    async function runVoid(id) {
        if (saving || !canVoid) {return;}
        const row = rows.find((r) => String(r.id) === String(id));
        if (!row) {return;}
        const total = `${formatMoney(row.total, currency).amount}${currency ? ` ${currency}` : ''}`;
        const paid = row.paid > 0
            ? `\nعليها مبلغ مسدد ${formatMoney(row.paid, currency).amount}${currency ? ` ${currency}` : ''} — إن كانت دفعة تلقائية ستُعكس مع الإلغاء.`
            : '';
        if (!confirmFn(`حذف فاتورة الشراء ${row.number} (${total})؟\nسيُعكس أثرها على المخزون تلقائيًا.${paid}`)) {return;}
        saving = true;
        try {
            const res = await voidPurchaseInvoice(row.id);
            if (!el.isConnected) {return;}
            const auto = res && res.deletedPayments
                ? ` وعُكست ${formatInt(res.deletedPayments)} دفعة تلقائية مرتبطة`
                : '';
            notify(`حُذفت الفاتورة ${(res && res.invoiceNumber) || row.number} وعُكس مخزون ${formatInt((res && res.reversedItems) || 0)} صنفًا${auto}`);
            await reload();
        } catch (e) {
            if (!el.isConnected) {return;}
            const msg = String((e && e.message) || 'تعذر حذف الفاتورة');
            const guide = /يدوية|دفعات موردين/.test(msg)
                ? ' — افتح «المشتريات › المدفوعات» واعكس الدفعة يدويًا ثم أعد الإلغاء'
                : '';
            notify(`${msg}${guide}`, 'error');
        } finally {
            saving = false;
        }
    }

    /** Danger zone — only admin + v2invoicevoid. The server still demands
     *  the literal phrase, so the checkbox is a second deliberate step. */
    function paintDanger() {
        const holder = q('[data-v2-danger]');
        if (!holder) {return;}
        if (!canVoid || rows.length === 0) {holder.innerHTML = ''; return;}
        holder.innerHTML = `<section class="erp-card" data-v2-danger-card>
            <div class="erp-card__head">
              <h4 class="erp-card__title">منطقة الخطر
                <span class="erp-badge" data-tone="danger">إلغاء نهائي</span>
              </h4>
            </div>
            <div class="erp-card__body erp-stack">
              <p class="erp-text-sm erp-text-muted">
                حذف كل فواتير الشراء نهائي ولا يمكن التراجع: تُعكس كمياتها من
                المخزون، وتُحذف حركات المخزون المرتبطة بها، وتُبطَّل قيودها
                المحاسبية. خذ نسخة احتياطية أولًا.
              </p>
              <div class="erp-dash-controls">
                <label class="erp-text-sm">
                  <input type="checkbox" data-v2-clear-ok>
                  أفهم أن هذه العملية نهائية وتعكس كميات المخزون
                </label>
                <button type="button" class="erp-btn erp-btn--sm erp-btn--danger" data-v2-clear-go disabled>
                  <i class="ji" data-i="trash" aria-hidden="true"></i><span>حذف كل الفواتير نهائيًا</span>
                </button>
              </div>
              <div class="erp-text-sm erp-text-warning" data-v2-danger-err role="alert"></div>
            </div>
          </section>`;
    }

    async function runClearAll() {
        if (saving || !canVoid) {return;}
        const ok = q('[data-v2-clear-ok]');
        const err = q('[data-v2-danger-err]');
        if (!ok || !ok.checked) {
            if (err) {err.textContent = 'فعّل مربع التأكيد أولًا.';}
            return;
        }
        if (rows.length === 0) {return;}
        if (!confirmFn(`حذف كل فواتير الشراء (${formatInt(rows.length)}) نهائيًا؟\nستُعكس كمياتها من المخزون ولا يمكن التراجع.`)) {return;}
        saving = true;
        if (err) {err.textContent = '';}
        try {
            const res = await clearAllPurchaseInvoices();
            if (!el.isConnected) {return;}
            notify(`تم حذف ${formatInt((res && res.deletedInvoices) || 0)} فاتورة وعكس ${formatInt((res && res.reversedLedgerRows) || 0)} قيد مخزون`);
            await reload();
        } catch (e) {
            if (!el.isConnected) {return;}
            const msg = String((e && e.message) || 'تعذر حذف الفواتير');
            if (err) {err.textContent = msg;}
            notify(msg, 'error');
        } finally {
            saving = false;
        }
    }

    /** Local YYYY-MM-DD (device calendar — same basis as the legacy today()). */
    function isoToday() {
        const d = new Date();
        const p = (n) => String(n).padStart(2, '0');
        return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
    }

    function closePayForm() {
        payingInvoice = null;
        const holder = q('[data-v2-pay-form]');
        if (holder) {holder.innerHTML = '';}
    }

    /** Inline partial payment linked to this invoice. The server recomputes
     *  the remainder and paymentStatus; the client only refuses what the
     *  operator can already see (≤ 0 or above the displayed remainder). */
    function openPayForm(row) {
        if (!row || !(row.remaining > 0) || !row.supplierId) {return;}
        payingInvoice = row;
        const holder = q('[data-v2-pay-form]');
        if (!holder) {return;}
        const rem = `${formatMoney(row.remaining, currency).amount}${currency ? ` ${currency}` : ''}`;
        holder.innerHTML = `<section class="erp-card"><div class="erp-card__head">`
            + `<h4 class="erp-card__title">دفعة جزئية — ${esc(row.number)} <span class="erp-text-muted erp-text-sm">${esc(row.supplier)}</span></h4>`
            + `<span class="erp-grow"></span><span class="erp-badge" data-tone="info">المتبقي ${esc(rem)}</span></div>`
            + `<div class="erp-card__body erp-stack"><div class="erp-dash-controls">`
            + `<label class="erp-text-sm erp-text-muted">المبلغ<input class="erp-input erp-input--ltr" data-v2-pp-amount type="number" min="0.01" step="0.01" max="${esc(String(row.remaining))}"></label>`
            + `<label class="erp-text-sm erp-text-muted">طريقة الدفع<select class="erp-select" data-v2-pp-method>`
            + `<option value="cash">نقدي</option><option value="bank">تحويل بنكي</option><option value="card">بطاقة</option><option value="cheque">شيك</option>`
            + `</select></label>`
            + `<label class="erp-text-sm erp-text-muted">التاريخ<input class="erp-input erp-input--ltr" data-v2-pp-date type="date" value="${esc(isoToday())}"></label>`
            + `<label class="erp-text-sm erp-text-muted">ملاحظات<input class="erp-input" data-v2-pp-notes maxlength="255"></label>`
            + `<button type="button" class="erp-btn erp-btn--primary erp-btn--sm" data-v2-pp-go>حفظ الدفعة</button>`
            + `<button type="button" class="erp-btn erp-btn--sm" data-v2-pp-x>إلغاء</button>`
            + `</div><div class="erp-text-sm" style="color:var(--erp-danger-text)" data-v2-pp-err role="alert"></div></div></section>`;
        holder.scrollIntoView({block: 'nearest'});
    }

    async function submitPartial() {
        if (saving || !payingInvoice) {return;}
        const row = payingInvoice;
        const val = (n) => (q(`[data-v2-pp-${n}]`)?.value ?? '');
        const errBox = q('[data-v2-pp-err]');
        const fail = (t) => { if (errBox) {errBox.textContent = t;} notify(t, 'error'); };
        const amount = Number(val('amount'));
        const method = val('method') || 'cash';
        const date = val('date') || isoToday();
        const notes = String(val('notes') || '').trim();
        if (!Number.isFinite(amount) || amount <= 0) {fail('أدخل مبلغًا أكبر من صفر'); return;}
        if (amount > row.remaining + 0.005) {
            fail(`المبلغ يتجاوز المتبقي (${formatMoney(row.remaining, currency).amount})`);
            return;
        }
        const shown = `${formatMoney(amount, currency).amount}${currency ? ` ${currency}` : ''}`;
        if (!confirmFn(`تسجيل دفعة ${shown} على الفاتورة ${row.number}؟`)) {return;}
        saving = true;
        try {
            const res = await payInvoicePartial(row.id, {
                supplierId: row.supplierId, amount, method, date, notes,
            });
            if (!el.isConnected) {return;}
            const due = res && res.supplierDueTotal !== undefined && res.supplierDueTotal !== null
                ? ` — رصيد المورد الآن ${formatMoney(res.supplierDueTotal, currency).amount}${currency ? ` ${currency}` : ''}`
                : '';
            notify(`تم تسجيل دفعة ${shown} على الفاتورة ${row.number}${due}`);
            closePayForm();
            await reload();
        } catch (e) {
            if (!el.isConnected) {return;}
            fail((e && e.message) || 'فشل تسجيل الدفعة');
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
            paintDanger();
        } catch (e) {
            if (!el.isConnected) {return;}
            rows = [];
            table.setRows([]);
            summaryEl.textContent = '';
            countEl.textContent = '';
            paintDanger();
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
        if (event.target.closest('[data-v2-pp-go]')) {submitPartial(); return;}
        if (event.target.closest('[data-v2-pp-x]')) {closePayForm(); return;}
        if (event.target.closest('[data-v2-clear-go]')) {runClearAll(); return;}
        const actBtn = event.target.closest('[data-v2-act]');
        if (actBtn) {
            if (actBtn.disabled) {return;}
            const id = actBtn.dataset.id;
            if (actBtn.dataset.v2Act === 'pay-part') {
                const row = rows.find((r) => String(r.id) === String(id));
                if (row) {openPayForm(row);}
            } else if (actBtn.dataset.v2Act === 'void') {
                runVoid(id);
            } else {
                runPay(id);
            }
            return;
        }
        if (event.target.closest('[data-v2-reload]')) {reload(); return;}
        if (event.target.closest('[data-erp-retry]')) {reload();}
    });

    el.addEventListener('change', (event) => {
        const ok = event.target.closest('[data-v2-clear-ok]');
        if (!ok) {return;}
        const btn = q('[data-v2-clear-go]');
        if (btn) {btn.disabled = !ok.checked;}
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
