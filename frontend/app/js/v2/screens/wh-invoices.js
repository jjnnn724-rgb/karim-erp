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
 *   • The pay door is shared with screen 06 (payInvoiceFull, same roles).
 *     Create/edit (26c-2) live here because this is the legacy form's own
 *     page (features/warehouse.js:1532-1783): POST/PUT
 *     /warehouse/purchase-invoices, admin|manager|warehouse, behind the
 *     independent `v2invoicecreate` flag (OFF by default). Edit is offered
 *     only while paidAmount = 0 — the server re-checks supplier_payments.
 *     Delete/bulk-delete stay on screen 06 behind v2invoicevoid.
 *     The print button calls window.print() like screens 03/04.
 */

import { createDataTable } from '../data-display/data-table.js?v=4.9.296';
import { statusBadge } from '../status.js?v=4.9.296';
import { canWrite } from '../session.js?v=4.9.296';
import {
    fetchPurchaseInvoices, invoiceToRow, supplierIdMap,
} from '../data/purchase-invoices-repo.js?v=4.9.296';
import {
    fetchSuppliers, fetchCurrency, formatMoney, formatInt, PAYMENT_WRITE_ROLES,
    payInvoiceFull, rangeError,
} from '../data/procurement-repo.js?v=4.9.296';
import { fetchInventory } from '../data/inventory-repo.js?v=4.9.296';
import {
    INVOICE_CREATE_ROLES,
} from '../data/purchase-invoices-write-repo.js?v=4.9.296';
import { invoiceCreateWriteEnabled } from '../write-flags.js?v=4.9.296';
import { mountPurchaseInvoiceEditor } from '../invoice-editor.js?v=4.9.296';
import { kpiStrip } from '../role-dash-parts.js?v=4.9.296';
import { openInAppReport } from '../report-viewer.js?v=4.9.296';

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

function template(from, to, canCreate) {
    /* «زمرد كريم» 2026-11-01: داشبورد فواتير الشراء — بطل موحد + سجل
       مؤشرات + فترات سريعة، والتقرير الفاخر عبر عارض التقارير. */
    return `
      <div class="erp-v2-whinvoices-page">
      <div class="erp-dash-head erp-screen-in" style="--erp-dash-eyebrow:'PURCHASE INVOICES'">
        <div>
          <h2 class="erp-dash-title">فواتير الشراء</h2>
          <div class="erp-dash-sub">كل فواتير الموردين — الإجمالي والمسدد والمتبقي بحسب الفترة المحددة.</div>
        </div>
        <div class="erp-dash-controls erp-no-print">
          <div class="erp-seg" role="group" aria-label="فترات سريعة">
            <button type="button" class="erp-seg__label" tabindex="-1">الفترة</button>
            <button type="button" data-v2whi-preset="30">آخر 30 يومًا</button>
            <button type="button" data-v2whi-preset="month">هذا الشهر</button>
            <button type="button" data-v2whi-preset="all">كل الفترات</button>
          </div>
          <label class="erp-text-sm erp-text-muted" for="v2whi-from">من</label>
          <input class="erp-input erp-input--ltr" id="v2whi-from" type="date" value="${esc(from)}">
          <label class="erp-text-sm erp-text-muted" for="v2whi-to">إلى</label>
          <input class="erp-input erp-input--ltr" id="v2whi-to" type="date" value="${esc(to)}" max="${esc(isoDay(0))}">
          <button type="button" class="erp-btn erp-btn--primary erp-btn--sm" data-v2-reload>
            <i class="ji" data-i="refresh" aria-hidden="true"></i><span>عرض</span>
          </button>
          <button type="button" class="erp-btn erp-btn--sm" data-v2-print aria-label="تقرير فواتير الشراء">
            <i class="ji" data-i="printer" aria-hidden="true"></i><span>التقرير</span>
          </button>
          <button type="button" class="erp-btn erp-btn--sm" data-v2-hub title="دليل الموردين وملخص المشتريات">
            <i class="ji" data-i="users" aria-hidden="true"></i><span>الموردون</span>
          </button>
          ${canCreate ? `<button type="button" class="erp-btn erp-btn--primary erp-btn--sm" data-v2-new>
            <i class="ji" data-i="plus" aria-hidden="true"></i><span>فاتورة شراء جديدة</span>
          </button>` : ''}
        </div>
      </div>
      <div class="erp-kpis erp-screen-in" data-v2whi-kpis aria-label="مؤشرات فواتير الشراء"></div>
      <section class="erp-card erp-v2-whinvoices">
        <div class="erp-card__head">
          <h3 class="erp-card__title">سجل الفواتير
            <span class="erp-text-muted erp-text-sm" data-v2-count></span>
          </h3>
          <span class="erp-grow"></span>
          <button type="button" class="erp-btn erp-btn--sm" data-v2-clear hidden>عرض الكل</button>
        </div>
        <div class="erp-card__body erp-stack">
          <p class="erp-text-sm erp-text-muted" data-v2-summary role="status" aria-live="polite"></p>
          <div data-v2-editor-host></div>
            <p class="erp-text-sm erp-text-muted" data-v2-currency-note hidden>تعذّرت قراءة وحدة المال من الإعدادات — المبالغ تُعرض بلا وحدة.</p>
          <div data-v2-table></div>
          <p class="erp-print-note" data-v2-print-note></p>
        </div>
      </section>
      </div>`;
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
    const canCreate = canWrite(ctx.role, INVOICE_CREATE_ROLES) && invoiceCreateWriteEnabled();

    let allRows = [];
    let rawById = new Map();
    let suppliersCache = [];
    let inventoryCache = null;
    let editor = null;
    let editorLoading = false;
    let currency = '';
    let loading = false;
    let queued = false;          // a refresh asked for while one was running
    let saving = false;

    host.insertAdjacentHTML('beforeend', template(isoDay(-30), isoDay(0), canCreate));
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
            ...((writable || canCreate) ? [{
                key: 'actions',
                header: 'إجراءات',
                width: writable && canCreate ? '240px' : '160px',
                align: 'end',
                value: () => '',
                render: (row) => {
                    const acts = [];
                    if (canCreate) {
                        // قرار المالك 2026-10-31: التعديل متاح حتى للمدفوعة (أصناف فقط)
                        acts.push(`<button type="button" class="erp-btn erp-btn--sm" data-v2-act="edit" data-id="${esc(row.id)}">
                            <i class="ji" data-i="pencil" aria-hidden="true"></i><span>تعديل</span>
                          </button>`);
                    }
                    if (writable && row.remaining > 0) {
                        acts.push(`<button type="button" class="erp-btn erp-btn--sm" data-v2-act="pay" data-id="${esc(row.id)}">
                            <i class="ji" data-i="banknote" aria-hidden="true"></i><span>تسديد الكل</span>
                          </button>`);
                    }
                    return acts.length ? acts.join(' ') : '<span class="erp-text-muted">—</span>';
                },
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
        const paid = rows.reduce((a, r) => a + r.paid, 0);
        const remaining = rows.reduce((a, r) => a + r.remaining, 0);
        const m = `${formatMoney(total, currency).amount}${currency ? ` ${currency}` : ''}`;
        summaryEl.textContent = `${formatInt(rows.length)} فاتورة بإجمالي ${m}${filtered ? '' : ' · كل الفترات'}`;
        countEl.textContent = rows.length ? `(${formatInt(rows.length)})` : '';
        clearBtn.hidden = !filtered;
        /* سجل المؤشرات الموحد — داشبورد فواتير الشراء (2026-11-01) */
        const money = (v) => formatMoney(v, currency).amount;
        const supplierCount = new Set(rows.map((r) => r.supplier)).size;
        const kpisEl = q('[data-v2whi-kpis]');
        if (kpisEl) {
            kpisEl.innerHTML = kpiStrip([
                { icon: 'receipt', label: 'عدد الفواتير', en: 'INVOICES', value: formatInt(rows.length), hint: formatInt(supplierCount) + ' موردًا' },
                { icon: 'banknote', label: 'إجمالي المشتريات', en: 'TOTAL', value: money(total), unit: currency || '' },
                { icon: 'wallet', label: 'المسدد', en: 'PAID', value: money(paid), unit: currency || '' },
                { icon: 'clock', label: 'المتبقي', en: 'REMAINING', value: money(remaining), unit: currency || '' },
            ], 'مؤشرات فواتير الشراء للفترة المحددة');
        }
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

    function closeEditor() {
        if (!editor) {return;}
        editor.destroy();
        editor = null;
    }

    /** The legacy form lived in a modal over this same register
     *  (features/warehouse.js:1532). V2 mounts it as a panel at the top of
     *  the screen. قرار المالك 2026-10-31: الفواتير المدفوعة تُفتح أيضًا —
     *  المحرر يثبّت الترويسة والخادم يجمّد كل شيء عدا الأصناف (items_only). */
    async function openEditor(raw) {
        if (editorLoading) {return;}
        closeEditor();
        editorLoading = true;
        try {
            if (!inventoryCache) {
                const inventory = await fetchInventory();
                inventoryCache = inventory.rows;
            }
            if (!el.isConnected) {return;}
            editor = mountPurchaseInvoiceEditor(q('[data-v2-editor-host]'), {
                invoice: raw || null,
                inventory: inventoryCache,
                suppliers: suppliersCache,
                currency,
                notify,
                onSaved(_result, { editing }) {
                    closeEditor();
                    inventoryCache = null;      // receipt changed stock/cost
                    notify(editing
                        ? 'تم تحديث الفاتورة والمخزون والحسابات'
                        : 'تم حفظ الفاتورة');
                    reload();
                },
                onCancel: closeEditor,
            });
            if (editor && typeof editor.el.scrollIntoView === 'function') {
                editor.el.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
        } catch (e) {
            if (!el.isConnected) {return;}
            notify(`تعذّر فتح نموذج الفاتورة: ${(e && e.message) || 'خطأ'}`, 'error');
        } finally {
            editorLoading = false;
        }
    }

    function openEdit(id) {
        const raw = rawById.get(String(id));
        if (!raw) {
            notify('الفاتورة غير موجودة', 'error');
            return;
        }
        openEditor(raw);
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
            suppliersCache = suppliers;
            rawById = new Map(invoices.map((inv) => [String(inv.id), inv]));
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
        if (event.target.closest('[data-v2-print]')) {printReport(); return;}
        const presetBtn = event.target.closest('[data-v2whi-preset]');
        if (presetBtn) {
            const key = presetBtn.getAttribute('data-v2whi-preset');
            const fromI = q('#v2whi-from');
            const toI = q('#v2whi-to');
            if (key === '30') {fromI.value = isoDay(-30); toI.value = isoDay(0);}
            else if (key === 'month') {fromI.value = firstOfMonth(); toI.value = isoDay(0);}
            else {fromI.value = ''; toI.value = '';}
            paint();
            return;
        }
        if (event.target.closest('[data-v2-hub]')) {navigate('procurement'); return;}
        if (event.target.closest('[data-v2-new]')) {openEditor(null); return;}
        const actBtn = event.target.closest('[data-v2-act]');
        if (actBtn) {
            if (actBtn.disabled) {return;}
            if (actBtn.dataset.v2Act === 'edit') {openEdit(actBtn.dataset.id); return;}
            runPay(actBtn.dataset.id);
            return;
        }
        if (event.target.closest('[data-v2-reload]')) {reload(); return;}
        if (event.target.closest('[data-erp-retry]')) {reload();}
    });
    /* ── التقرير الفاخر (2026-11-01): كشف فواتير الشراء كاملًا بحسب
       الفترة — يُعرض في عارض التقارير فيتاح طباعةً وتحميل PDF ومشاركة
       وواتساب من شريطه، ويتكفل بدايةً الترويسة والشعار. كل الصفوف
       المفلترة تُطبع لا الصفحة الحالية من الجدول فقط. */
    function printReport() {
        const pickedFrom = q('#v2whi-from').value;
        const pickedTo = q('#v2whi-to').value;
        const bad = rangeError(pickedFrom, pickedTo);
        if (bad) {notify(bad); return;}
        const { rows } = inRange(allRows);
        const total = rows.reduce((a, r) => a + r.total, 0);
        const paid = rows.reduce((a, r) => a + r.paid, 0);
        const remaining = rows.reduce((a, r) => a + r.remaining, 0);
        const range = (pickedFrom || pickedTo)
            ? `${pickedFrom ? pickedFrom : 'البداية'} — ${pickedTo ? pickedTo : 'اليوم'}`
            : 'كل الفترات';
        const money = (v) => formatMoney(v, currency).amount;
        const body = rows.map((r, i) => `
            <tr>
              <td>${i + 1}</td>
              <td>${esc(r.number)}</td>
              <td>${esc(r.date || '—')}</td>
              <td class="rt">${esc(r.supplier)}</td>
              <td class="rt">${money(r.total)}</td>
              <td class="rt">${money(r.paid)}</td>
              <td class="rt">${money(r.remaining)}</td>
              <td>${esc(r.status === 'paid' ? 'مسددة' : r.status === 'partial' ? 'جزئية' : 'غير مسددة')}</td>
            </tr>`).join('') || '<tr><td colspan="8">لا فواتير في هذه الفترة</td></tr>';
        const html = `<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="UTF-8">
          <title>كشف فواتير الشراء</title><style>
          *{box-sizing:border-box}body{font-family:'IBM Plex Sans Arabic','Tajawal',Tahoma,Arial,sans-serif;color:#1c2420;background:#fff;margin:0;padding:28px 32px}
          .head{display:flex;justify-content:space-between;align-items:center;border-bottom:3px solid #18352b;padding-bottom:12px;margin-bottom:6px}
          .head h1{margin:0;font-size:22px;color:#18352b}
          .head .brand-note{font-size:12px;color:#5d6f66}
          .sub{text-align:center;margin:10px 0 2px;font-size:16px;font-weight:700;color:#18352b}
          .range{text-align:center;font-size:12.5px;color:#5d6f66;margin-bottom:14px}
          .kpis{display:flex;gap:10px;margin:0 0 14px}
          .kpi{flex:1;background:#eef5f1;border:1px solid #bcd8cb;border-radius:10px;padding:10px 12px;text-align:center}
          .kpi b{display:block;font-size:16px;color:#0a3d2f}
          .kpi span{font-size:11px;color:#5d6f66}
          table{width:100%;border-collapse:collapse;font-size:12.5px}
          th{background:#18352b;color:#fff;padding:8px 6px;border:1px solid #234a3b}
          td{border:1px solid #cfe0d8;padding:7px 6px}
          tbody tr:nth-child(even) td{background:#f3f8f5}
          tfoot td{font-weight:800;background:#e8f2ec;color:#0a3d2f;border:1px solid #bcd8cb}
          .rt{text-align:left;direction:ltr}
          .sig{display:flex;gap:18px;margin-top:34px}
          .sig div{flex:1;border-top:2px solid #18352b;padding-top:6px;text-align:center;font-size:11.5px;color:#5d6f66}
          .foot{margin-top:14px;text-align:center;font-size:11px;color:#7a8a80}
          @page{size:A4;margin:11mm}
          </style></head><body>
          <div class="head"><h1>كشف فواتير الشراء</h1><div class="brand-note">نظام مطاعم الشرفة — مستند إلكتروني معتمد</div></div>
          <div class="sub">فواتير الشراء بحسب الفترة</div>
          <div class="range">الفترة: ${range} · ${formatInt(rows.length)} فاتورة</div>
          <div class="kpis">
            <div class="kpi"><span>عدد الفواتير</span><b>${formatInt(rows.length)}</b></div>
            <div class="kpi"><span>إجمالي المشتريات</span><b>${money(total)} ${currency}</b></div>
            <div class="kpi"><span>المسدد</span><b>${money(paid)} ${currency}</b></div>
            <div class="kpi"><span>المتبقي</span><b>${money(remaining)} ${currency}</b></div>
          </div>
          <table><thead><tr><th>#</th><th>رقم الفاتورة</th><th>التاريخ</th><th>المورد</th><th>الإجمالي</th><th>المسدد</th><th>المتبقي</th><th>الحالة</th></tr></thead>
          <tbody>${body}</tbody>
          <tfoot><tr><td colspan="4">الإجمالي (${formatInt(rows.length)} فاتورة)</td><td>${money(total)}</td><td>${money(paid)}</td><td>${money(remaining)}</td><td></td></tr></tfoot></table>
          <div class="sig"><div>توقيع أمين المخزن</div><div>توقيع المحاسبة</div><div>اعتماد المدير</div></div>
          <div class="foot">طُبع بتاريخ ${new Date().toLocaleString('ar-EG')} — الفلترة حسب الفترة المحددة في الشاشة</div>
          </body></html>`;
        const w = openInAppReport('كشف فواتير الشراء');
        w.document.open();
        w.document.write(html);
        w.document.close();
        w.focus();
    }

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
            closeEditor();
            table.destroy();
            el.remove();
        },
    };
}
