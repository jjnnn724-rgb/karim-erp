/**
 * V2 — Warehouse governance screen · حوكمة المخزن (P2-4)
 * ═══════════════════════════════════════════════════════════════════════
 * Three cards, three independent server gates — never one pretend gate:
 *   1. السنوات المالية      → admin|manager|accountant (read + create)
 *                             close / create-next → admin only
 *   2. الرصيد الافتتاحي     → admin|manager|warehouse, READ ONLY
 *   3. فحص النظام            → admin only, READ ONLY
 * The roles are the server's own requireRole() lists (see
 * data/warehouse-gov-repo.js); a card the role cannot read is not drawn and
 * issues no request at all.
 *
 * WRITES ARE DOUBLE-LOCKED
 *   Role AND the independent `v2fiscalwrite` flag — OFF by default, query
 *   overrides storage. With the flag off the years stay readable and neither
 *   the create form nor a close/next button exists in the DOM (none is drawn
 *   disabled), because a disabled control would imply the door is merely
 *   waiting for a click.
 *
 * WHAT THE SCREEN SAYS OUT LOUD
 *   • Closing keeps every sale/expense row; it stores a closing snapshot and
 *     carries opening balances to the next year. The sentence is the legacy
 *     modal's own (features/warehouse.js:996).
 *   • The opening report is a read of OPEN-* invoices; currentQty is the
 *     register's own number and issuedSince is dispatch ledger since the
 *     invoice date. The screen never subtracts them to invent a balance.
 *   • System health shows the server's first 30 anomalies and the full count;
 *     it never claims to have inspected more than the server returned.
 *
 * WHAT IS NOT HERE
 *   No void, no delete, no "replace opening balance" editor. The legacy
 *   editor writes purchase invoices and direct inventory updates — doors this
 *   screen does not own (P2-4 is the read report plus the fiscal lifecycle).
 */

import { canWrite } from '../session.js?v=4.9.186';
import { fiscalWriteEnabled } from '../write-flags.js?v=4.9.186';
import { statusBadge } from '../status.js?v=4.9.186';
import { formatInt, formatQty, formatMoney, fetchCurrency } from '../data/reports-repo.js?v=4.9.186';
import {
    FISCAL_READ_ROLES, FISCAL_CREATE_ROLES, FISCAL_CLOSE_ROLES,
    OPENING_READ_ROLES, HEALTH_READ_ROLES,
    fetchFiscalYears, createFiscalYear, closeFiscalYear, createNextFiscalYear,
    fetchOpeningBalanceReport, fetchSystemHealth,
    validateFiscalYearForm, normalizeFiscalYearForm,
    fiscalYearToRow, fiscalSummary, openingToInvoice, openingTotals, healthSummary,
} from '../data/warehouse-gov-repo.js?v=4.9.186';

const esc = (v) => String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

function money(v, currency) {
    const m = formatMoney(v, currency);
    const unit = m.hasUnit ? ` <span class="erp-text-sm erp-text-muted">${esc(m.unit)}</span>` : '';
    return `<span class="erp-num" dir="ltr">${m.amount}</span>${unit}`;
}

function fmtDateTime(iso) {
    if (!iso) {return '—';}
    try {
        const d = new Date(iso);
        if (Number.isNaN(d.getTime())) {return '—';}
        return `${d.toLocaleDateString('ar-EG')} ${d.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit', hour12: false })}`;
    } catch {
        return '—';
    }
}

function errText(e, fallback) {
    if (e && e.message === 'UNAUTHORIZED') {
        return 'انتهت الجلسة — سجّل الدخول في النظام الحالي ثم أعد فتح الوضع الحيّ.';
    }
    if (e && e.code === 'FORBIDDEN') {
        return 'لا صلاحية لهذه العملية بهذا الحساب — القرار للخادم وحده.';
    }
    return (e && e.message) || fallback;
}

function stateHtml(title, body) {
    return `<div class="erp-state" role="status">
      <span class="erp-state__title">${esc(title)}</span>
      <span>${esc(body)}</span>
    </div>`;
}

function factsHtml(items) {
    return `<div class="erp-wgov__facts">${items.map((item) => `<span class="erp-badge" data-tone="${esc(item.tone)}"${item.title ? ` title="${esc(item.title)}"` : ''}>${esc(item.text)}</span>`).join('')}</div>`;
}

function kpi({ icon, label, value, hint }) {
    return `<li class="erp-kpi">
      <div class="erp-kpi__top"><span class="erp-kpi__icon" aria-hidden="true"><i class="ji" data-i="${esc(icon)}"></i></span><span class="erp-kpi__label">${esc(label)}</span></div>
      <div class="erp-kpi__value">${value}</div>
      ${hint ? `<div class="erp-kpi__foot"><span class="erp-kpi__hint">${hint}</span></div>` : ''}
    </li>`;
}

/* ── Markup ────────────────────────────────────────────────────────────── */

function fiscalCardHtml(caps) {
    if (!caps.fiscalRead) {return '';}
    return `<section class="erp-card">
      <div class="erp-card__head">
        <h3 class="erp-card__title">السنوات المالية
          <span class="erp-eyebrow" dir="ltr" lang="en">Fiscal Years</span>
        </h3>
        <span class="erp-grow"></span>
        <span class="erp-text-sm erp-text-muted" data-v2-fiscal-note role="status" aria-live="polite"></span>
        ${caps.fiscalCreate ? `<button type="button" class="erp-btn erp-btn--primary erp-btn--sm erp-no-print" data-v2-fiscal-new>
          <i class="ji" data-i="plus" aria-hidden="true"></i><span>سنة مالية جديدة</span>
        </button>` : ''}
      </div>
      <div class="erp-card__body erp-stack">
        <p class="erp-text-sm erp-text-muted">
          الإقفال لا يحذف مبيعات ولا مصروفات: يحفظ الخادم لقطة إقفال
          (الإيراد والمصروف والمشتريات وقيمة المخزون وصافيه)، ثم تُرحَّل أرصدة
          المخزون إلى السنة التالية. الإقفال والسنة التالية للإدارة وحدها،
          والإنشاء للإدارة والمدير والمحاسب، والقراءة لهؤلاء الثلاثة.
          ${caps.fiscalWrite
        ? ''
        : '<span data-v2-fiscal-ro>وضع القراءة فقط: ميزة الإقفال غير مفعّلة — لا نموذج إنشاء ولا أزرار إقفال.</span>'}
        </p>
        <p class="erp-text-sm erp-text-muted">
          الترتيب من الأحدث إلى الأقدم، والأرقام كما حفظها الإقفال، والعملة من
          إعدادات النظام.
        </p>
        <div data-v2-fiscal-form-host hidden></div>
        <div data-v2-fiscal-facts></div>
        <div data-v2-fiscal-table></div>
      </div>
    </section>`;
}

function openingCardHtml(caps) {
    if (!caps.openingRead) {return '';}
    return `<section class="erp-card">
      <div class="erp-card__head">
        <h3 class="erp-card__title">الرصيد الافتتاحي
          <span class="erp-eyebrow" dir="ltr" lang="en">Opening Balance</span>
        </h3>
        <span class="erp-grow"></span>
        <span class="erp-text-sm erp-text-muted" data-v2-opening-note role="status" aria-live="polite"></span>
      </div>
      <div class="erp-card__body erp-stack">
        <p class="erp-text-sm erp-text-muted">
          قراءة فقط لفواتير الرصيد الافتتاحي للإدارة والمدير والمخزن. «الرصيد
          الحالي» هو رقم سجل المخزون نفسه، و«المنصرف منذ الفاتورة» مجموع قيود
          الصرف من تاريخها؛ الشاشة لا تطرح ولا تجمع لتستنتج رصيدًا. التعديل
          والاستبدال والإلغاء من شاشة الرصيد الافتتاحي في النظام الأساسي —
          هذه الشاشة لا تكتب في المخزون.
        </p>
        <div data-v2-opening-kpis></div>
        <div data-v2-opening-list></div>
      </div>
    </section>`;
}

function healthCardHtml(caps) {
    if (!caps.healthRead) {return '';}
    return `<section class="erp-card">
      <div class="erp-card__head">
        <h3 class="erp-card__title">فحص النظام
          <span class="erp-eyebrow" dir="ltr" lang="en">System Health</span>
        </h3>
        <span class="erp-grow"></span>
        <span class="erp-text-sm erp-text-muted" data-v2-health-note role="status" aria-live="polite"></span>
      </div>
      <div class="erp-card__body erp-stack">
        <p class="erp-text-sm erp-text-muted">
          تشخيص الخادم وحده (للإدارة): لكل صنف يقارن الرصيد بمجموع أرصدة
          المخازن ثم بصافي دفتر الحركات. أول 30 ملاحظة تُعرض والعدد الكامل
          يُعلَن — الشاشة لا تدّعي فحص ما لم يعده الخادم.
        </p>
        <div data-v2-health></div>
      </div>
    </section>`;
}

function template(caps) {
    const hasAny = caps.fiscalRead || caps.openingRead || caps.healthRead;
    const none = `<section class="erp-card"><div class="erp-card__body">
      ${stateHtml('لا بطاقة متاحة لهذا الحساب',
        'السنوات المالية للإدارة والمدير والمحاسب، والرصيد الافتتاحي للإدارة والمدير والمخزن، وفحص النظام للإدارة وحدها. لم يُرسل أي طلب.')}
    </div></section>`;
    return `<div class="erp-v2-wgov" data-v2-wgov>
      <div class="erp-dash-head">
        <div>
          <h2 class="erp-dash-title">حوكمة المخزن
            <span class="erp-eyebrow" dir="ltr" lang="en">Warehouse Governance</span>
          </h2>
          <div class="erp-dash-sub" data-v2-scope-line role="status" aria-live="polite"></div>
        </div>
        <div class="erp-dash-controls">
          <button type="button" class="erp-btn erp-btn--sm erp-no-print" data-v2-reload aria-label="تحديث">
            <i class="ji" data-i="refresh" aria-hidden="true"></i><span>تحديث</span>
          </button>
        </div>
      </div>
      ${hasAny ? fiscalCardHtml(caps) + openingCardHtml(caps) + healthCardHtml(caps) : none}
    </div>`;
}

/* ── Fiscal-year bits ──────────────────────────────────────────────────── */

function fiscalFormHtml() {
    return `<form class="erp-wgov__fiscal-form" data-v2-fiscal-form-input novalidate>
      <div class="erp-wgov__form-grid">
        <label class="erp-field"><span>تاريخ البداية</span>
          <input class="erp-input erp-input--ltr" type="date" name="startDate" required>
        </label>
        <label class="erp-field"><span>تاريخ النهاية</span>
          <input class="erp-input erp-input--ltr" type="date" name="endDate" required>
        </label>
        <label class="erp-field"><span>كود السنة</span>
          <input class="erp-input erp-input--ltr" name="yearCode" maxlength="20" placeholder="افتراضي: سنة البداية">
        </label>
        <label class="erp-field"><span>الاسم</span>
          <input class="erp-input" name="name" maxlength="120" placeholder="افتراضي: السنة المالية …">
        </label>
      </div>
      <label class="erp-field"><span>ملاحظات</span>
        <input class="erp-input" name="notes" maxlength="500">
      </label>
      <p class="erp-text-sm erp-text-danger" data-v2-fiscal-err role="alert" hidden></p>
      <div class="erp-row erp-wgov__form-actions">
        <button type="submit" class="erp-btn erp-btn--primary erp-btn--sm">
          <i class="ji" data-i="save" aria-hidden="true"></i><span>حفظ السنة</span>
        </button>
        <button type="button" class="erp-btn erp-btn--sm erp-btn--ghost" data-v2-fiscal-cancel>إلغاء</button>
      </div>
    </form>`;
}

function snapshotCell(row, currency) {
    if (row.status !== 'closed') {
        return `<span class="erp-text-muted">${row.openingCount ? `افتتاحي مرحّل: ${formatInt(row.openingCount)} صنفًا` : 'بانتظار الإقفال'}</span>`;
    }
    if (!row.hasSnapshot) {
        return `<span class="erp-text-muted">مغلقة — بلا لقطة إقفال محفوظة</span>`;
    }
    const s = row.snapshot;
    return `<div class="erp-wgov__snap">
      <span>إيراد: ${money(s.revenueTotal, currency)} <span class="erp-text-muted">(${formatInt(s.revenueCount)})</span></span>
      <span>مصروف: ${money(s.expenseTotal, currency)} <span class="erp-text-muted">(${formatInt(s.expenseCount)})</span></span>
      <span>صافي: ${money(s.netResult, currency)}</span>
      <span>مخزون: ${money(s.inventoryValue, currency)} <span class="erp-text-muted">(${formatInt(s.inventoryCount)} صنفًا)</span></span>
    </div>`;
}

function fiscalTableHtml(rows, caps, currency) {
    const cols = caps.fiscalClose ? 5 : 4;
    const body = rows.length
        ? rows.map((row) => {
            const action = caps.fiscalClose
                ? `<td class="erp-wgov__actions">${row.status === 'closed'
                    ? `<button type="button" class="erp-btn erp-btn--sm" data-v2-fiscal-next="${esc(row.id)}" title="إنشاء السنة التالية وترحيل الأرصدة الافتتاحية">
                        <i class="ji" data-i="plus" aria-hidden="true"></i><span>السنة التالية</span></button>`
                    : `<button type="button" class="erp-btn erp-btn--sm erp-btn--danger" data-v2-fiscal-close="${esc(row.id)}" title="إقفال السنة بعد التحقق من الورديات والجرد">
                        <i class="ji" data-i="lock" aria-hidden="true"></i><span>إقفال السنة</span></button>`}</td>`
                : '';
            return `<tr>
              <td>
                <strong>${esc(row.name || row.yearCode || '—')}</strong>
                <div class="erp-text-sm erp-text-muted">
                  <span class="erp-mono" dir="ltr">${esc(row.yearCode || '—')}</span>
                  ${row.closedAt ? `<span aria-hidden="true"> · </span>أُقفلت ${esc(fmtDateTime(row.closedAt))}` : ''}
                </div>
              </td>
              <td><span class="erp-num" dir="ltr">${esc(row.startDate || '—')}</span><span aria-hidden="true"> → </span><span class="erp-num" dir="ltr">${esc(row.endDate || '—')}</span></td>
              <td>${statusBadge('fiscal_year', row.status)}</td>
              <td>${snapshotCell(row, currency)}</td>
              ${action}
            </tr>`;
        }).join('')
        : `<tr><td colspan="${cols}" class="erp-text-muted">لا سنوات مالية مسجّلة${caps.fiscalCreate ? ' — أنشئ الأولى من زر «سنة مالية جديدة».' : '.'}</td></tr>`;
    return `<div class="erp-table__scroll" tabindex="0">
      <table class="erp-table__grid">
        <caption class="erp-sr-only">السنوات المالية — الحالة ولقطة الإقفال</caption>
        <thead><tr><th>السنة</th><th>الفترة</th><th>الحالة</th><th>ملخص الإقفال</th>${caps.fiscalClose ? '<th>الإجراء</th>' : ''}</tr></thead>
        <tbody>${body}</tbody>
      </table>
    </div>`;
}

/* ── Opening / health bits ─────────────────────────────────────────────── */

function openingItemRows(items, currency) {
    return items.map((item) => `<tr>
      <td>
        <strong>${esc(item.name) || (item.itemId ? `#${esc(item.itemId)}` : '—')}</strong>
        ${item.itemId ? `<div class="erp-text-sm erp-text-muted"><span class="erp-mono" dir="ltr">#${esc(item.itemId)}</span></div>` : ''}
      </td>
      <td>${item.category ? esc(item.category) : '<span class="erp-text-muted">بلا فئة</span>'}</td>
      <td>
        <span class="erp-num" dir="ltr">${formatQty(item.qty)}</span> ${esc(item.unit)}
        ${item.packagingQty != null ? `<div class="erp-text-sm erp-text-muted">${formatQty(item.packagingQty)} عبوة</div>` : ''}
      </td>
      <td><span class="erp-num" dir="ltr">${formatQty(item.issuedSince)}</span>${item.unit ? ` <span class="erp-text-muted">${esc(item.unit)}</span>` : ''}</td>
      <td>${item.currentQty == null
        ? '<span class="erp-text-muted" title="الصنف غير موجود في سجل المخزون">—</span>'
        : `<span class="erp-num" dir="ltr">${formatQty(item.currentQty)}</span>${item.unit ? ` <span class="erp-text-muted">${esc(item.unit)}</span>` : ''}`}</td>
      <td>${money(item.price, currency)}</td>
      <td>${item.itemExists
        ? '<span class="erp-badge" data-tone="success">في السجل</span>'
        : '<span class="erp-badge" data-tone="danger">محذوف من السجل</span>'}</td>
    </tr>`).join('');
}

function openingListHtml(invoices, currency) {
    if (!invoices.length) {
        return stateHtml('لا فواتير رصيد افتتاحي', 'لا سجل يطابق OPEN-* أو ملاحظات «رصيد افتتاحي» — لا صفوف تُختلق.');
    }
    return invoices.map((invoice) => `<details class="erp-wgov__inv" data-v2-opening-row="${esc(invoice.id)}">
      <summary class="erp-wgov__inv-head">
        <span class="erp-wgov__inv-title">
          <strong dir="ltr">${esc(invoice.number) || `#${esc(invoice.id)}`}</strong>
          <span class="erp-text-sm erp-text-muted" dir="ltr">${esc(invoice.date || '—')}</span>
        </span>
        <span class="erp-badge" data-tone="info">${formatInt(invoice.items.length)} بندًا</span>
        <span>${money(invoice.totalAmount, currency)}</span>
      </summary>
      <div class="erp-wgov__inv-body">
        ${invoice.notes ? `<p class="erp-text-sm erp-text-muted">${esc(invoice.notes)}</p>` : ''}
        ${invoice.items.length ? `<div class="erp-table__scroll" tabindex="0">
          <table class="erp-table__grid">
            <caption class="erp-sr-only">بنود الرصيد الافتتاحي ${esc(invoice.number)}</caption>
            <thead><tr><th>الصنف</th><th>الفئة</th><th>المسجّل افتتاحًا</th><th>المنصرف منذ الفاتورة</th><th>الرصيد الحالي</th><th>سعر البند</th><th>الحالة</th></tr></thead>
            <tbody>${openingItemRows(invoice.items, currency)}</tbody>
          </table>
        </div>` : '<p class="erp-text-sm erp-text-muted">الفاتورة بلا بنود محفوظة.</p>'}
      </div>
    </details>`).join('');
}

function healthHtml(h) {
    if (!h) {return '';}
    const tone = h.ok ? 'success' : 'danger';
    const anomalies = h.anomalies.length
        ? `<div class="erp-table__scroll" tabindex="0">
            <table class="erp-table__grid">
              <caption class="erp-sr-only">ملاحظات فحص النظام</caption>
              <thead><tr><th>الصنف</th><th>الملاحظة</th></tr></thead>
              <tbody>${h.anomalies.map((a) => `<tr><td><strong>${esc(a.name) || '—'}</strong></td><td>${esc(a.issue)}</td></tr>`).join('')}</tbody>
            </table>
          </div>`
        : stateHtml('لا ملاحظات', 'كل الأرصدة المفحوصة متطابقة مع المخازن ودفتر الحركات.');
    return `<div class="erp-wgov__health-banner" data-tone="${tone}" role="status">
      <i class="ji" data-i="${h.ok ? 'clipboard-list' : 'alert-triangle'}" aria-hidden="true"></i>
      <strong>${h.ok ? 'النظام سليم' : 'توجد ملاحظات تحتاج نظرًا'}</strong>
      <span>${h.ok
        ? 'كل الأرصدة المفحوصة متطابقة مع المخازن والدفاتر.'
        : `${formatInt(h.anomaliesCount)} ملاحظة — يعرض الخادم ${formatInt(h.anomalies.length)} منها.`}</span>
    </div>
    <ul class="erp-kpis" aria-label="مؤشرات فحص النظام">
      ${kpi({ icon: 'package', label: 'إجمالي الأصناف', value: `<span class="erp-num" dir="ltr">${formatInt(h.itemsTotal)}</span>` })}
      ${kpi({ icon: 'circle-check', label: 'سليمة', value: `<span class="erp-num" dir="ltr">${formatInt(h.consistent)}</span>` })}
      ${kpi({ icon: 'alert-triangle', label: 'ملاحظات', value: `<span class="erp-num" dir="ltr">${formatInt(h.anomaliesCount)}</span>` })}
      ${kpi({ icon: 'circle-x', label: 'صفر الرصيد', value: `<span class="erp-num" dir="ltr">${formatInt(h.zeroStock)}</span>` })}
      ${kpi({ icon: 'hourglass', label: 'تحت الحد الأدنى', value: `<span class="erp-num" dir="ltr">${formatInt(h.lowStock)}</span>` })}
    </ul>
    ${anomalies}`;
}

/* ── Mount ─────────────────────────────────────────────────────────────── */

/**
 * @param {ParentNode} host
 * @param {{role?: string|null, notify?: (message:string, kind?:string)=>void,
 *          confirmFn?: (message:string)=>boolean|Promise<boolean>}} [ctx]
 */
export function mountWarehouseGovScreen(host, ctx = {}) {
    const role = String(ctx.role || '');
    const notify = typeof ctx.notify === 'function' ? ctx.notify : (m) => console.info('[V2 warehouse-gov]', m);
    const confirmFn = typeof ctx.confirmFn === 'function' ? ctx.confirmFn
        : (m) => (typeof window !== 'undefined' && window.confirm ? window.confirm(m) : false);

    const fiscalWrite = fiscalWriteEnabled();
    const caps = {
        fiscalRead: canWrite(role, FISCAL_READ_ROLES),
        fiscalCreate: canWrite(role, FISCAL_CREATE_ROLES) && fiscalWrite,
        fiscalClose: canWrite(role, FISCAL_CLOSE_ROLES) && fiscalWrite,
        fiscalWrite,
        openingRead: canWrite(role, OPENING_READ_ROLES),
        healthRead: canWrite(role, HEALTH_READ_ROLES),
    };

    host.insertAdjacentHTML('beforeend', template(caps));
    const el = host.lastElementChild;
    const q = (sel) => el.querySelector(sel);
    const scopeLine = q('[data-v2-scope-line]');
    const fiscalNote = q('[data-v2-fiscal-note]');
    const fiscalFacts = q('[data-v2-fiscal-facts]');
    const fiscalTable = q('[data-v2-fiscal-table]');
    const fiscalFormHost = q('[data-v2-fiscal-form-host]');
    const openingNote = q('[data-v2-opening-note]');
    const openingKpis = q('[data-v2-opening-kpis]');
    const openingList = q('[data-v2-opening-list]');
    const healthNote = q('[data-v2-health-note]');
    const healthHost = q('[data-v2-health]');

    let years = [];
    let fiscalCurrency = '';
    let invoices = [];
    let openingCurrency = '';
    let health = null;
    let saving = false;
    let fiscalLoading = false;
    let fiscalQueued = false;
    let openingLoading = false;
    let openingQueued = false;
    let healthLoading = false;
    let healthQueued = false;

    if (scopeLine) {
        scopeLine.textContent = caps.fiscalRead || caps.openingRead || caps.healthRead
            ? 'ثلاث قراءات مستقلة — كل بطاقة تحمل دورها وصلاحيتها، فلا بطاقة تتجاوز صلاحيتها.'
            : 'لا باب واحد لهذا الحساب في الشاشة — لم يُرسل أي طلب.';
    }

    function say(node, text) {
        if (node) {node.textContent = text;}
    }

    function renderFiscalFacts() {
        if (!fiscalFacts) {return;}
        const s = fiscalSummary(years);
        fiscalFacts.innerHTML = factsHtml([
            { tone: 'info', text: `إجمالي ${formatInt(s.total)} سنة` },
            { tone: 'success', text: `مفتوحة ${formatInt(s.open)}` },
            { tone: 'neutral', text: `مغلقة ${formatInt(s.closed)}` },
            ...(s.current ? [{ tone: 'brand', text: `الحالية: ${s.current.name || s.current.yearCode || '—'}`, title: 'أول سنة مفتوحة في ترتيب الخادم، وإلا أحدث سنة' }] : []),
        ]);
    }

    function renderFiscal() {
        renderFiscalFacts();
        if (fiscalTable) {fiscalTable.innerHTML = fiscalTableHtml(years, caps, fiscalCurrency);}
    }

    function fiscalFormError(message, field) {
        const box = fiscalFormHost.querySelector('[data-v2-fiscal-err]');
        if (box) {box.textContent = message; box.hidden = false;}
        const input = field ? fiscalFormHost.querySelector(`[name="${field}"]`) : null;
        if (input && typeof input.focus === 'function') {input.focus();}
    }

    function closeFiscalForm() {
        if (fiscalFormHost) {
            fiscalFormHost.innerHTML = '';
            fiscalFormHost.hidden = true;
        }
    }

    function openFiscalForm() {
        if (!caps.fiscalCreate || !fiscalFormHost) {return;}
        fiscalFormHost.innerHTML = fiscalFormHtml();
        fiscalFormHost.hidden = false;
        const first = fiscalFormHost.querySelector('input[name="startDate"]');
        if (first && typeof first.focus === 'function') {first.focus();}
    }

    async function loadFiscal() {
        if (!caps.fiscalRead) {return;}
        if (fiscalLoading) {fiscalQueued = true; return;}
        fiscalLoading = true;
        say(fiscalNote, 'جارٍ قراءة السنوات المالية…');
        try {
            const [yearsRes, currencyRes] = await Promise.allSettled([fetchFiscalYears(), fetchCurrency()]);
            if (!el.isConnected) {return;}
            fiscalCurrency = currencyRes.status === 'fulfilled' ? currencyRes.value : '';
            if (yearsRes.status === 'rejected') {
                years = [];
                renderFiscalFacts();
                if (fiscalTable) {fiscalTable.innerHTML = stateHtml('تعذّر تحميل السنوات المالية', errText(yearsRes.reason, 'خطأ غير معروف'));}
                say(fiscalNote, errText(yearsRes.reason, 'تعذّر تحميل السنوات المالية'));
                return;
            }
            years = yearsRes.value.map(fiscalYearToRow);
            renderFiscal();
            say(fiscalNote, fiscalCurrency
                ? ''
                : 'وحدة العملة غير متاحة من الإعدادات — مبالغ لقطات الإقفال تُعرض بلا وحدة.');
        } finally {
            fiscalLoading = false;
            if (fiscalQueued && el.isConnected) {
                fiscalQueued = false;
                loadFiscal();
            }
        }
    }

    async function submitFiscal(form) {
        if (!caps.fiscalCreate || saving) {return;}
        const data = new FormData(form);
        const raw = {
            startDate: data.get('startDate') || '',
            endDate: data.get('endDate') || '',
            yearCode: data.get('yearCode') || '',
            name: data.get('name') || '',
            notes: data.get('notes') || '',
        };
        const errors = validateFiscalYearForm(raw);
        if (errors.length) {fiscalFormError(errors[0].message, errors[0].field); return;}
        const payload = normalizeFiscalYearForm(raw);
        saving = true;
        const button = form.querySelector('button[type="submit"]');
        if (button) {button.disabled = true;}
        try {
            await createFiscalYear(payload);
            if (!el.isConnected) {return;}
            notify(`تم إنشاء السنة المالية «${payload.name}»`);
            closeFiscalForm();
            await loadFiscal();
        } catch (e) {
            if (!el.isConnected) {return;}
            fiscalFormError(errText(e, 'تعذّر إنشاء السنة المالية'));
        } finally {
            saving = false;
            if (button && button.isConnected) {button.disabled = false;}
        }
    }

    async function closeYear(row) {
        if (!caps.fiscalClose || saving) {return;}
        const ok = await confirmFn(`سيتم إقفال السنة المالية «${row.name}» بعد التحقق من إغلاق الورديات واعتماد الجرد. لا يمكن تكرار الإقفال. هل تريد المتابعة؟`);
        if (ok === false || ok == null) {return;}
        saving = true;
        try {
            await closeFiscalYear(row.id);
            if (!el.isConnected) {return;}
            notify('تم إقفال السنة المالية وحفظ لقطة الأرصدة');
            await loadFiscal();
        } catch (e) {
            if (!el.isConnected) {return;}
            notify(errText(e, 'تعذّر إقفال السنة المالية'), 'error');
        } finally {
            saving = false;
        }
    }

    async function nextYear(row) {
        if (!caps.fiscalClose || saving) {return;}
        const ok = await confirmFn('سيتم إنشاء السنة التالية وترحيل أرصدة المخزون الافتتاحية. هل تريد المتابعة؟');
        if (ok === false || ok == null) {return;}
        saving = true;
        try {
            await createNextFiscalYear(row.id);
            if (!el.isConnected) {return;}
            notify('تم إنشاء السنة التالية وترحيل الأرصدة');
            await loadFiscal();
        } catch (e) {
            if (!el.isConnected) {return;}
            notify(errText(e, 'تعذّر إنشاء السنة التالية'), 'error');
        } finally {
            saving = false;
        }
    }

    function renderOpening() {
        if (!openingKpis || !openingList) {return;}
        const t = openingTotals(invoices);
        openingKpis.innerHTML = `<ul class="erp-kpis" aria-label="مؤشرات الرصيد الافتتاحي">
          ${kpi({ icon: 'file-text', label: 'فواتير افتتاحية', value: `<span class="erp-num" dir="ltr">${formatInt(t.invoices)}</span>` })}
          ${kpi({ icon: 'clipboard-list', label: 'بنود مسجّلة', value: `<span class="erp-num" dir="ltr">${formatInt(t.lines)}</span>` })}
          ${kpi({ icon: 'package', label: 'كمية افتتاحية', value: `<span class="erp-num" dir="ltr">${formatQty(t.qty)}</span>`, hint: `منصرف منذ الافتتاحي: <span class="erp-num" dir="ltr">${formatQty(t.issuedSince)}</span>` })}
          ${kpi({ icon: 'coins', label: 'إجمالي الفواتير', value: money(t.totalAmount, openingCurrency), hint: t.missing ? `${formatInt(t.missing)} بندًا لصنف غير موجود` : '' })}
        </ul>`;
        openingList.innerHTML = openingListHtml(invoices, openingCurrency);
    }

    async function loadOpening() {
        if (!caps.openingRead) {return;}
        if (openingLoading) {openingQueued = true; return;}
        openingLoading = true;
        say(openingNote, 'جارٍ قراءة تقرير الرصيد الافتتاحي…');
        try {
            const [reportRes, currencyRes] = await Promise.allSettled([fetchOpeningBalanceReport(), fetchCurrency()]);
            if (!el.isConnected) {return;}
            openingCurrency = currencyRes.status === 'fulfilled' ? currencyRes.value : '';
            if (reportRes.status === 'rejected') {
                invoices = [];
                if (openingKpis) {openingKpis.innerHTML = '';}
                if (openingList) {openingList.innerHTML = stateHtml('تعذّر تحميل الرصيد الافتتاحي', errText(reportRes.reason, 'خطأ غير معروف'));}
                say(openingNote, errText(reportRes.reason, 'تعذّر تحميل التقرير'));
                return;
            }
            invoices = reportRes.value.map(openingToInvoice);
            renderOpening();
            say(openingNote, openingCurrency
                ? ''
                : 'وحدة العملة غير متاحة — المبالغ تُعرض بلا وحدة.');
        } finally {
            openingLoading = false;
            if (openingQueued && el.isConnected) {
                openingQueued = false;
                loadOpening();
            }
        }
    }

    async function loadHealth() {
        if (!caps.healthRead) {return;}
        if (healthLoading) {healthQueued = true; return;}
        healthLoading = true;
        say(healthNote, 'جارٍ فحص النظام…');
        try {
            const raw = await fetchSystemHealth();
            if (!el.isConnected) {return;}
            health = healthSummary(raw);
            if (healthHost) {healthHost.innerHTML = healthHtml(health);}
            say(healthNote, '');
        } catch (e) {
            if (!el.isConnected) {return;}
            health = null;
            if (healthHost) {healthHost.innerHTML = stateHtml('تعذّر فحص النظام', errText(e, 'خطأ غير معروف'));}
            say(healthNote, errText(e, 'تعذّر الفحص'));
        } finally {
            healthLoading = false;
            if (healthQueued && el.isConnected) {
                healthQueued = false;
                loadHealth();
            }
        }
    }

    async function reload() {
        await Promise.all([loadFiscal(), loadOpening(), loadHealth()]);
    }

    el.addEventListener('click', (event) => {
        if (event.target.closest('[data-v2-reload]')) {reload(); return;}
        if (event.target.closest('[data-v2-fiscal-new]')) {openFiscalForm(); return;}
        if (event.target.closest('[data-v2-fiscal-cancel]')) {closeFiscalForm(); return;}
        const closeBtn = event.target.closest('[data-v2-fiscal-close]');
        if (closeBtn) {
            const row = years.find((r) => String(r.id) === String(closeBtn.getAttribute('data-v2-fiscal-close')));
            if (row) {closeYear(row);}
            return;
        }
        const nextBtn = event.target.closest('[data-v2-fiscal-next]');
        if (nextBtn) {
            const row = years.find((r) => String(r.id) === String(nextBtn.getAttribute('data-v2-fiscal-next')));
            if (row) {nextYear(row);}
        }
    });

    el.addEventListener('submit', (event) => {
        const form = event.target.closest('[data-v2-fiscal-form-input]');
        if (!form) {return;}
        event.preventDefault();
        submitFiscal(form);
    });

    reload();

    return {
        el,
        reload,
        getState: () => ({ years, invoices, health }),
        destroy() {
            el.remove();
        },
    };
}
