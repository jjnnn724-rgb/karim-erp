/**
 * V2 — Warehouse invoices screen · شاشة 08 في سجل الترحيل (الموجة الثانية: تسديد)
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Same per-screen contract as 01-07, plus explicit full-pay (owner
 * approval): confirm shows the exact amount, the server recomputes the
 * remainder and refuses already-paid, saving guards double-clicks.
 * delegated listeners on a per-mount root, loading guards, isConnected
 * checks, destroy() on nav.
 *
 * LENS (why this is not screen 06 twice)
 *   06 answers "who owes what" per supplier. This page answers "what came
 *   in this month": current-month date filter by default (owner's rule,
 *   features/warehouse.js:217), payment-method column, statement header
 *   (count + total), and a print button. Same register, different question.
 *
 * CONTRACT COPIED FROM renderWhInvoices (features/warehouse.js:219-226)
 *   • Access in legacy is the `warehouse` menu (checkMenuAccessLocal) —
 *     V2 shows this route from the same role menus, and the entity read
 *     gate stays server-side.
 *   • paymentMethod words are THIS page's map (cash:نقدي، bank:بنكي،
 *     card:بطاقة، cheque:شيك، credit:آجل) — note بنكي ≠ تحويل بنكي used
 *     on the procurement page; each screen keeps its page's own words.
 *   • Unknown paymentStatus: legacy prints «غير محددة». V2 is stricter —
 *     the adapter shows the stored key dashed-raw instead of guessing a
 *     label for it.
 *   • The only write here is the full-pay door shared with screen 06
 *     (payInvoiceFull, same roles). Creating invoices, deleting one and
 *     the bulk delete stay in legacy — this screen has no door to them.
 *     The print button calls window.print() like screens 03/04.
 */

import { createDataTable } from '../data-display/data-table.js?v=4.9.130';
import { statusBadge } from '../status.js?v=4.9.130';
import { canWrite } from '../session.js?v=4.9.130';
import {
    fetchPurchaseInvoices, invoiceToRow, supplierIdMap,
} from '../data/purchase-invoices-repo.js?v=4.9.130';
import {
    fetchSuppliers, fetchCurrency, formatMoney, formatInt, PAYMENT_WRITE_ROLES,
    payInvoiceFull, rangeError,
} from '../data/procurement-repo.js?v=4.9.130';

const esc = (v) => String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** This page's own method words (features/warehouse.js:226). Unknown
 *  methods are shown verbatim — relabelling would be inventing. */
const PAY_METHOD_AR = {
    cash: 'نقدي', bank: 'بنكي', card: 'بطاقة', cheque: 'شيك', credit: 'آجل',
};

/** Local YYYY-MM-DD (device calendar — same basis as the legacy today()). */
function isoDay(offsetDays = 0) {
    const d = new Date();
    d.setDate(d.getDate() + offsetDays);
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function firstOfMonth() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-01`;
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
      <section class="erp-card erp-v2-whinvoices">
        <div class="erp-card__head">
          <h3 class="erp-card__title">فواتير الشراء
            <span class="erp-eyebrow" dir="ltr" lang="en">Purchase Invoices</span>
            <span class="erp-text-muted erp-text-sm" data-v2-count></span>
          </h3>
          <span class="erp-grow"></span>
          <label class="erp-text-sm erp-text-muted" for="v2whi-from">من</label>
          <input class="erp-input erp-input--ltr" id="v2whi-from" type="date" value="${esc(from)}">
          <label class="erp-text-sm erp-text-muted" for="v2whi-to">إلى</label>
          <input class="erp-input erp-input--ltr" id="v2whi-to" type="date" value="${esc(to)}" max="${esc(isoDay(0))}">
          <button type="button" class="erp-btn erp-btn--sm" data-v2-clear hidden>عرض الكل</button>
          <button type="button" class="erp-btn erp-btn--sm" data-v2-print aria-label="طباعة الكشف">
            <i class="ji" data-i="printer" aria-hidden="true"></i><span>طباعة</span>
          </button>
          <button type="button" class="erp-btn erp-btn--sm" data-v2-hub title="دليل الموردين وملخص المشتريات">
            <i class="ji" data-i="users" aria-hidden="true"></i><span>الموردون</span>
          </button>
          <button type="button" class="erp-btn erp-btn--primary erp-btn--sm" data-v2-reload>
            <i class="ji" data-i="refresh" aria-hidden="true"></i><span>عرض</span>
          </button>
        </div>
        <div class="erp-card__body erp-stack">
          <p class="erp-text-sm erp-text-muted" data-v2-summary role="status" aria-live="polite"></p>
          <p class="erp-text-sm erp-text-muted">
            سجل فواتير الشراء
            (<span class="erp-addr" dir="ltr">/api/purchaseInvoices</span>)،
            والصلاحية قررها الخادم وحده. الافتراضي الشهر الحالي بطلب سابق؛
            إفراغ التاريخين يعرض الكل. الكتابة الوحيدة هنا تسديد كامل
            للفاتورة، للحساب الذي يملك ذلك عند الخادم؛ الإنشاء والحذف يبقيان
            في النظام الحالي. شاشة فواتير الموردين (06) تقرأ نفس السجل بعدسة
            المورد لا الشهر، ودليل الموردين هو شاشة (05).
            <span data-v2-currency-note hidden>تعذّرت قراءة وحدة المال من الإعدادات — المبالغ تُعرض بلا وحدة.</span>
          </p>
          <div data-v2-table></div>
          <p class="erp-print-note" data-v2-print-note></p>
        </div>
      </section>`;
}

/**
 * @param {ParentNode} host where the screen is inserted
 * @param {{role?: string|null, notify?: Function, navigate?: (key:string)=>void}} [ctx]
 * @returns {{el: HTMLElement, reload: ()=>Promise<void>, getRows: ()=>any[], destroy: ()=>void}}
 */
export function mountWhInvoicesScreen(host, ctx = {}) {
    const notify = typeof ctx.notify === 'function' ? ctx.notify : (m) => console.info('[V2 wh-invoices]', m);
    const navigate = typeof ctx.navigate === 'function' ? ctx.navigate : () => {};
    const confirmFn = typeof ctx.confirmFn === 'function' ? ctx.confirmFn
        : (m) => (typeof window !== 'undefined' && window.confirm ? window.confirm(m) : false);
    const writable = canWrite(ctx.role, PAYMENT_WRITE_ROLES);

    let allRows = [];
    let currency = '';
    let loading = false;
    let queued = false;          // a refresh asked for while one was running
    let saving = false;

    host.insertAdjacentHTML('beforeend', template(firstOfMonth(), isoDay(0)));
    const el = host.lastElementChild;
    const q = (sel) => el.querySelector(sel);
    const countEl = q('[data-v2-count]');
    const summaryEl = q('[data-v2-summary]');
    const currencyNote = q('[data-v2-currency-note]');
    const clearBtn = q('[data-v2-clear]');
    const printNote = q('[data-v2-print-note]');

    const table = createDataTable({
        caption: 'سجل فواتير الشراء — بيانات حية',
        mode: 'client',
        pageSize: 20,
        stickyHeader: true,
        emptyMessage: 'لا توجد فواتير في الفترة المحددة',
        emptyHint: 'وسّع الفترة أو اعرض الكل.',
        rowKey: (row) => row.id,
        columns: [
            {
                key: 'number', header: 'رقم الفاتورة', sortable: true, filterable: true,
                width: '150px', className: 'erp-mono',
            },
            { key: 'supplier', header: 'المورد', sortable: true, filterable: true },
            {
                key: 'date', header: 'التاريخ', sortable: true, filterable: true,
                width: '120px', align: 'center', className: 'erp-tnum',
            },
            {
                key: 'total', header: 'الإجمالي', sortable: true, type: 'number',
                width: '140px', align: 'end', value: (row) => row.total,
                render: (row) => moneyCell(row.total, currency),
            },
            {
                key: 'method', header: 'الدفع', sortable: true, filterable: true, width: '110px',
                render: (row) => esc(row.methodAr),
            },
            {
                key: 'status', header: 'الحالة', sortable: true, filterable: true, width: '150px',
                value: (row) => row.status,
                render: (row) => statusBadge('payment', row.status),
            },
            ...(writable ? [{
                key: 'actions',
                header: 'تسديد',
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

    function inRange(rows) {
        const from = q('#v2whi-from').value;
        const to = q('#v2whi-to').value;
        return {
            rows: rows.filter((r) => {
                if (from && r.date < from) {return false;}
                if (to && r.date > to) {return false;}
                return true;
            }),
            filtered: !!(from || to),
        };
    }

    function paint() {
        const pickedFrom = q('#v2whi-from').value;
        const pickedTo = q('#v2whi-to').value;
        const bad = rangeError(pickedFrom, pickedTo);
        if (bad) {
            // Same rule as screen 07's door and screen 04: an impossible
            // range is a typo, so it is named as one instead of painting an
            // empty table that reads like missing data.
            summaryEl.textContent = bad;
            countEl.textContent = '';
            printNote.textContent = `فواتير الشراء — ${bad}`;
            table.setError(bad);
            return;
        }
        const { rows, filtered } = inRange(allRows);
        const total = rows.reduce((a, r) => a + r.total, 0);
        const m = `${formatMoney(total, currency).amount}${currency ? ` ${currency}` : ''}`;
        summaryEl.textContent = `${formatInt(rows.length)} فاتورة بإجمالي ${m}${filtered ? '' : ' · كل الفترات'}`;
        countEl.textContent = rows.length ? `(${formatInt(rows.length)})` : '';
        clearBtn.hidden = !filtered;
        const from = q('#v2whi-from').value;
        const to = q('#v2whi-to').value;
        const range = (from || to)
            ? `${from ? `من ${from}` : 'من البداية'} ${to ? `إلى ${to}` : 'حتى اليوم'}`
            : 'كل الفترات';
        printNote.textContent = `فواتير الشراء — ${range} · ${formatInt(rows.length)} فاتورة. المطبوعة تعرض الصفحة الحالية من الجدول، لا السجل كاملًا.`;
        table.setRows(rows);
    }

    /** Full-pay with an explicit confirm showing the exact amount — the
     *  server recomputes the remainder itself and refuses already-paid
     *  (409), so a double-click can never double-pay. saving guards anyway. */
    async function runPay(id) {
        if (saving) {return;}
        const row = allRows.find((r) => String(r.id) === String(id));
        if (!row || !(row.remaining > 0)) {return;}
        const amount = `${formatMoney(row.remaining, currency).amount}${currency ? ` ${currency}` : ''}`;
        if (!confirmFn(`تسديد كامل للفاتورة ${row.number} — ${amount} نقدًا؟`)) {return;}
        saving = true;
        try {
            await payInvoiceFull(id, { method: 'cash' });
            if (!el.isConnected) {return;}          // navigated away mid-pay
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
            allRows = invoices.map((inv) => {
                const row = invoiceToRow(inv, byId);
                const method = inv.paymentMethod ? String(inv.paymentMethod) : '';
                return { ...row, method, methodAr: PAY_METHOD_AR[method] || method || '—' };
            });
            paint();
        } catch (e) {
            if (!el.isConnected) {return;}
            allRows = [];
            table.setRows([]);
            summaryEl.textContent = '';
            countEl.textContent = '';
            table.setError(e && e.message === 'UNAUTHORIZED'
                ? 'انتهت الجلسة — سجّل الدخول في النظام الحالي ثم أعد فتح الوضع الحيّ.'
                : (e && e.code === 'FORBIDDEN'
                    ? 'لا صلاحية لعرض فواتير الشراء بهذا الحساب — القرار للخادم وحده.'
                    : `تعذّر تحميل الفواتير: ${(e && e.message) || 'خطأ'}`));
        } finally {
            loading = false;
            if (queued && el.isConnected) {
                queued = false;
                reload();                            // the newest read wins
            }
        }
    }

    el.addEventListener('click', (event) => {
        if (event.target.closest('[data-v2-clear]')) {
            q('#v2whi-from').value = '';
            q('#v2whi-to').value = '';
            paint();
            return;
        }
        if (event.target.closest('[data-v2-print]')) {window.print(); return;}
        if (event.target.closest('[data-v2-hub]')) {navigate('procurement'); return;}
        const actBtn = event.target.closest('[data-v2-act]');
        if (actBtn) {
            if (actBtn.disabled) {return;}
            runPay(actBtn.dataset.id);
            return;
        }
        if (event.target.closest('[data-v2-reload]')) {reload(); return;}
        if (event.target.closest('[data-erp-retry]')) {reload();}
    });
    /** The period is a client-side slice of the loaded register, so picking
     *  a date repaints immediately — no round-trip, no Enter needed. */
    el.addEventListener('change', (event) => {
        if (event.target.matches('#v2whi-from, #v2whi-to')) {paint();}
    });

    reload();

    return {
        el,
        reload,
        getRows: () => allRows.filter((r) => {
            const from = q('#v2whi-from')?.value || '';
            const to = q('#v2whi-to')?.value || '';
            if (from && r.date < from) {return false;}
            if (to && r.date > to) {return false;}
            return true;
        }),
        destroy() {
            table.destroy();
            el.remove();
        },
    };
}
