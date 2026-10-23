/**
 * V2 — cashier entry and embedded POS.
 * Embedded checkout follows the host feature flag. The standalone POS stays
 * available as the fallback at all times.
 */
import { dayCloseStatus, execDayClose, fetchOpenShifts } from '../data/cfo-repo.js?v=4.9.131';
import { formatInt, formatMoney, fetchCurrency } from '../data/reports-repo.js?v=4.9.131';
import {
    closePosShift, completePosSale, deletePosHeldOrder, exportPosOrders, fetchActivePosShift, fetchPosDepartments,
    fetchPosHeldOrders, fetchPosKotPage, fetchPosOrderDetails, fetchPosOrders, fetchPosProducts, fetchPosShiftSummary,
    holdPosOrder, openPosShift, recallPosHeldOrder, reprintPosOrder, voidPosOrder,
} from '../data/pos-v2-repo.js?v=4.9.131';
import {
    addBuffetTier, buffetTierProducts, disableBuffetTier, fetchBuffetConfig, fetchBuffetInvoices, fetchBuffetLive,
    fetchBuffetReport, isBuffetDepartment, renameBuffetTier, saveBuffetPrices, setBuffetTierActive, BUFFET_ADMIN_ROLES,
} from '../data/pos-buffet-repo.js?v=4.9.131';
import { matchPosBarcode } from '../data/pos-barcode.js?v=4.9.131';
import { buildPosSaleItems, calculatePosTotals } from '../data/pos-pricing.js?v=4.9.131';
import { uploadProductImage } from '../data/recipes-edit-repo.js?v=4.9.131';
import { ensureRealtimeSocket } from '../realtime.js?v=4.9.131';
import { openInAppReport } from '../report-viewer.js?v=4.9.131';
import { ensureQrCode } from '../vendor.js?v=4.9.131';

const esc = (v) => String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const POS_ROLES = ['admin', 'manager', 'accountant', 'cashier'];
const SELL_ROLES = ['admin', 'manager', 'cashier'];
const INVOICE_HISTORY_ROLES = ['admin', 'manager', 'accountant'];
const ORDER_VOID_ROLES = ['admin', 'manager'];
const CATALOG_IMAGE_ROLES = ['admin', 'manager'];
const DAY_CLOSE_ROLES = ['admin', 'manager'];
const PAYMENT_FIELDS = [
    { key: 'cash', label: 'نقدي' },
    { key: 'card', label: 'بطاقة' },
    { key: 'wallet', label: 'محفظة' },
    { key: 'bank_transfer', label: 'تحويل بنكي' },
];

function safeProductImageUrl(value) {
    const url = String(value || '').trim();
    return url.startsWith('/uploads/menu/') || /^https:\/\//i.test(url) ? url : '';
}

function template(allowed, embedded, historyAllowed, salesEnabled) {
    return `
      <div class="erp-v2-posentry">
        <div class="erp-dash-head">
          <div>
            <h2 class="erp-dash-title">الكاشير
              <span class="erp-eyebrow" dir="ltr" lang="en">POS</span>
            </h2>
            <div class="erp-dash-sub" role="status" aria-live="polite" data-v2-note>
              ${embedded ? (salesEnabled ? 'نقطة البيع المدمجة — قرارات المخزون والضريبة والفاتورة للخادم.' : 'وضع تجهيز الكاشير — البيع وفتح الورديات متوقفان حتى الاعتماد الميداني.') : 'نقطة البيع المستقلة متاحة؛ واجهة V2 المدمجة مغلقة حتى اجتياز الاعتماد الميداني.'}
            </div>
          </div>
          <div class="erp-dash-controls">
            ${allowed && !embedded ? `<a class="erp-btn erp-btn--primary" href="/app/pos.html"
              target="_blank" rel="noopener" title="يفتح الكاشير المستقل في تبويب جديد">
              <i class="ji" data-i="receipt" aria-hidden="true"></i><span>فتح الكاشير المستقل</span>
            </a>` : ''}
            ${allowed ? `<a class="erp-btn erp-btn--sm" href="/app/cashier/" target="_blank" rel="noopener">
              <i class="ji" data-i="receipt" aria-hidden="true"></i><span>تطبيق الكاشير المنفصل</span>
            </a>` : ''}
            ${historyAllowed ? `<button type="button" class="erp-btn erp-btn--sm" data-pos-history>
              <i class="ji" data-i="clipboard-list" aria-hidden="true"></i><span>سجل الفواتير</span>
            </button>` : ''}
            <button type="button" class="erp-btn erp-btn--sm" data-v2-reload aria-label="تحديث">
              <i class="ji" data-i="refresh" aria-hidden="true"></i><span>تحديث</span>
            </button>
          </div>
        </div>
        <div data-v2-body></div>
      </div>`;
}

/**
 * @param {ParentNode} host where the screen is inserted
 * @param {{role?:string|null,notify?:(message:string,kind?:string)=>void,confirmFn?:(message:string)=>boolean|Promise<boolean>,featureFlags?:{embeddedPos?:boolean,salesEnabled?:boolean}}} [ctx]
 */
export function mountPosEntryScreen(host, ctx = {}) {
    const role = String(ctx.role || '');
    const allowed = POS_ROLES.includes(role);
    const salesEnabled = ctx.featureFlags?.salesEnabled === true;
    const canSell = SELL_ROLES.includes(role) && salesEnabled;
    const historyAllowed = INVOICE_HISTORY_ROLES.includes(role);
    const canManageCatalog = CATALOG_IMAGE_ROLES.includes(role);
    const canManageBuffet = BUFFET_ADMIN_ROLES.includes(role);
    const embedded = ctx.featureFlags?.embeddedPos === true;
    let currency = '';
    let loading = false;
    let busy = false;
    let departments = [];
    let products = [];
    let heldOrders = [];
    let activeShift = null;
    let cart = [];
    let cartDiscount = { type: '', value: '0' };
    let imageProductId = null;
    let imageUploadPending = false;
    let payments = { cash: 0, card: 0, wallet: 0, bank_transfer: 0 };
    let paymentReferences = { card: '', wallet: '', bank_transfer: '' };
    let paymentsTouched = false;
    let search = '';
    let selectedCategory = '';
    let receipt = null;
    let saleKey = '';
    let previousPosBody = '';
    let historyPage = 1;
    let historyFilters = { dateFrom: '', dateTo: '', status: '', search: '' };
    let historyResult = null;
    let catalogSocket = null;
    let catalogRefreshPromise = null;
    let catalogRefreshQueued = false;
    let buffet = null;
    let buffetLive = null;
    let buffetTimer = null;
    let buffetBusy = false;
    let buffetReportDate = '';
    let buffetReport = null;
    let buffetReportInvoices = [];

    host.insertAdjacentHTML('beforeend', template(allowed, embedded, historyAllowed, salesEnabled));
    const el = host.lastElementChild;
    const q = (sel) => el.querySelector(sel);
    const body = q('[data-v2-body]');
    const notify = (message, kind = 'error') => {
        if (typeof ctx.notify === 'function') {ctx.notify(message, kind);}
        const note = q('[data-v2-note]');
        if (note) {note.textContent = message;}
    };
    const money = (value) => {
        const m = formatMoney(value, currency);
        return `<span class="erp-num" dir="ltr">${esc(m.amount)}</span>${m.hasUnit ? ` <span class="erp-text-sm erp-text-muted">${esc(m.unit)}</span>` : ''}`;
    };
    const number = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;
    const parseMoneyInput = (value) => {
        const normalized = String(value ?? '').trim()
            .replace(/[٠-٩]/g, (digit) => '٠١٢٣٤٥٦٧٨٩'.indexOf(digit))
            .replace(/[۰-۹]/g, (digit) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(digit))
            .replace(/[٫]/g, '.')
            .replace(/[٬,\s]/g, '');
        const parsed = Number(normalized);
        return Number.isFinite(parsed) && parsed >= 0 ? parsed : NaN;
    };

    async function refreshCatalog() {
        if (!activeShift || !el.isConnected) {return;}
        if (loading || previousPosBody || catalogRefreshPromise) {
            catalogRefreshQueued = true;
            return catalogRefreshPromise;
        }
        catalogRefreshPromise = (async () => {
            try {
                await loadCatalogProducts();
                if (!el.isConnected) {return;}
                renderCashier();
                notify(buffetMode() ? 'تم تحديث فئات وأسعار البوفيه.' : 'تم تحديث أصناف الوصفات في الكاشير.', 'info');
            } catch (error) {
                if (el.isConnected) {
                    notify(`تعذّر تحديث أصناف الوصفات: ${error.message || 'خطأ غير معروف'}`, 'error');
                }
            } finally {
                catalogRefreshPromise = null;
                if (catalogRefreshQueued && !loading && !previousPosBody && el.isConnected) {
                    catalogRefreshQueued = false;
                    void refreshCatalog();
                }
            }
        })();
        return catalogRefreshPromise;
    }

    function onCatalogChanged(event) {
        if (!event || !['posProducts', 'recipes'].includes(event.entity)) {return;}
        void refreshCatalog();
    }

    async function bindCatalogRealtime() {
        try {
            const socket = await ensureRealtimeSocket();
            if (!socket || !el.isConnected) {return;}
            catalogSocket = socket;
            socket.on('entity_changed', onCatalogChanged);
        } catch (error) {
            console.warn('[V2 POS] realtime catalog updates unavailable:', error);
        }
    }

    function totals() {
        return calculatePosTotals(cart, cartDiscount);
    }

    function shiftId() {
        return activeShift?.session_id || activeShift?.id;
    }

    function buffetMode() {
        return Boolean(activeShift && isBuffetDepartment(activeShift));
    }

    function stopBuffetLiveTimer() {
        if (buffetTimer) {
            clearInterval(buffetTimer);
            buffetTimer = null;
        }
    }

    function startBuffetLiveTimer() {
        stopBuffetLiveTimer();
        if (!buffetMode()) {return;}
        buffetTimer = setInterval(() => {
            if (!el.isConnected || !buffetMode()) {stopBuffetLiveTimer(); return;}
            void refreshBuffetLive();
        }, 60000);
    }

    async function refreshBuffetLive() {
        if (!buffetMode()) {stopBuffetLiveTimer(); return;}
        try {
            buffetLive = await fetchBuffetLive({ sessionId: shiftId() });
            if (el.isConnected && buffetMode()) {updateBuffetLiveDom();}
        } catch (_) { /* keep the last reading; the next tick retries */ }
    }

    function buffetLiveHtml() {
        if (!buffetLive?.daily) {
            return '<span class="erp-pos-v2-live-dot" aria-hidden="true"></span><span>العداد الحي غير متاح حاليًا.</span>';
        }
        const daily = buffetLive.daily;
        return `<span class="erp-pos-v2-live-dot" aria-hidden="true"></span>
          <span class="erp-pos-v2-live-pill"><strong>${formatInt(daily.covers_total)}</strong> فرد اليوم</span>
          <span class="erp-pos-v2-live-pill"><strong>${money(daily.revenue)}</strong></span>
          <span class="erp-pos-v2-live-pill"><strong>${formatInt(daily.invoices_count)}</strong> فاتورة</span>
          ${buffetLive.shift ? `<span class="erp-pos-v2-live-pill"><strong>${formatInt(buffetLive.shift.covers_total)}</strong> فرد الوردية</span>` : ''}
          ${daily.voided?.count ? `<span class="erp-pos-v2-live-pill is-warning">${formatInt(daily.voided.count)} ملغاة</span>` : ''}`;
    }

    function updateBuffetLiveDom() {
        const box = q('[data-buffet-live]');
        if (box) {box.innerHTML = buffetLiveHtml();}
    }

    async function loadBuffetCatalog() {
        buffet = await fetchBuffetConfig();
        products = buffetTierProducts(buffet.tiers);
        startBuffetLiveTimer();
        try {buffetLive = await fetchBuffetLive({ sessionId: shiftId() });}
        catch (_) {buffetLive = null;}
    }

    async function loadCatalogProducts() {
        if (buffetMode()) {
            await loadBuffetCatalog();
            return;
        }
        buffet = null;
        buffetLive = null;
        stopBuffetLiveTimer();
        products = await fetchPosProducts(activeShift.department_id);
    }

    function buffetToday() {
        return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Riyadh' });
    }

    function renderOpenShift() {
        body.innerHTML = `<section class="erp-card"><div class="erp-card__body erp-pos-v2-open">
          <h3 class="erp-card__title">فتح وردية</h3>
          <label>القسم<select class="erp-select" data-pos-department><option value="">اختر القسم</option>
            ${departments.map((d) => `<option value="${esc(d.id)}">${esc(d.name_ar || d.name_en || d.code)}</option>`).join('')}
          </select></label>
          <label>العهدة الافتتاحية<input class="erp-input erp-input--ltr" data-pos-opening type="number" min="0" step="0.01" value="0"></label>
          <button type="button" class="erp-btn erp-btn--primary" data-pos-open ${canSell ? '' : 'disabled'}>فتح الوردية</button>
          ${salesEnabled ? (canSell ? '' : '<p class="erp-text-sm erp-text-muted">هذا الحساب للقراءة فقط ولا يمكنه فتح وردية.</p>')
        : '<p class="erp-text-sm erp-text-muted">وضع تجهيز فقط: لا تُسجّل مبيعات ولا تُفتح ورديات من هذه الشاشة.</p>'}
          <p class="erp-text-sm erp-text-muted" data-pos-error role="alert"></p>
        </div></section>`;
    }

    function orderStatusLabel(status) {
        return ({ issued: 'صادرة', reported: 'مبلّغ عنها', cancelled: 'ملغاة' })[status] || status || 'غير محددة';
    }

    function renderOrderHistory() {
        const rows = historyResult?.data || [];
        const pagination = historyResult?.pagination || { page: historyPage, total: 0, totalPages: 0 };
        body.innerHTML = `<section class="erp-card"><div class="erp-card__head">
          <h3 class="erp-card__title">سجل فواتير الكاشير</h3><span class="erp-grow"></span>
          <button type="button" class="erp-btn erp-btn--sm" data-pos-history-print ${rows.length ? '' : 'disabled'}>طباعة النتائج</button>
          <button type="button" class="erp-btn erp-btn--sm" data-pos-history-back>العودة إلى الكاشير</button>
        </div><div class="erp-card__body erp-stack">
          <div class="erp-dash-controls">
            <label>من تاريخ<input class="erp-input erp-input--ltr" type="date" data-pos-history-from value="${esc(historyFilters.dateFrom)}"></label>
            <label>إلى تاريخ<input class="erp-input erp-input--ltr" type="date" data-pos-history-to value="${esc(historyFilters.dateTo)}"></label>
            <label>الحالة<select class="erp-select" data-pos-history-status>
              <option value="">كل الحالات</option>
              <option value="issued"${historyFilters.status === 'issued' ? ' selected' : ''}>صادرة</option>
              <option value="reported"${historyFilters.status === 'reported' ? ' selected' : ''}>مبلّغ عنها</option>
              <option value="cancelled"${historyFilters.status === 'cancelled' ? ' selected' : ''}>ملغاة</option>
            </select></label>
            <label>رقم الفاتورة / القسم / الكاشير<input class="erp-input" type="search" maxlength="100" data-pos-history-search-input value="${esc(historyFilters.search)}"></label>
            <button type="button" class="erp-btn erp-btn--primary erp-btn--sm" data-pos-history-apply>بحث</button>
          </div>
          <p class="erp-text-sm erp-text-muted" role="status" aria-live="polite">${pagination.total} فاتورة · الصفحة ${pagination.page} من ${pagination.totalPages || 1}</p>
          ${rows.length ? `<div class="erp-table__scroll" tabindex="0"><table class="erp-table__grid">
            <caption class="erp-sr-only">سجل فواتير الكاشير</caption>
            <thead><tr><th scope="col">رقم الفاتورة</th><th scope="col">القسم</th><th scope="col">التاريخ</th><th scope="col">الكاشير</th><th scope="col">الأصناف</th><th scope="col">الإجمالي</th><th scope="col">الحالة</th><th scope="col">التفاصيل</th></tr></thead>
            <tbody>${rows.map((order) => `<tr>
              <td class="erp-td erp-mono">#${esc(order.invoice_counter ?? order.id)}</td>
              <td class="erp-td">${esc(order.department_name || '—')}</td>
              <td class="erp-td erp-mono" dir="ltr">${esc(order.created_at || '—')}</td>
              <td class="erp-td">${esc(order.cashier_name || '—')}</td>
              <td class="erp-td erp-num">${esc(order.item_count ?? '—')}</td>
              <td class="erp-td">${money(order.total_amount)}</td>
              <td class="erp-td"><span class="erp-badge" data-tone="${order.status === 'cancelled' ? 'danger' : 'success'}">${esc(orderStatusLabel(order.status))}</span></td>
              <td class="erp-td"><button type="button" class="erp-btn erp-btn--sm" data-pos-order-detail="${esc(order.id)}">عرض</button></td>
            </tr>`).join('')}</tbody>
          </table></div>` : '<p class="erp-text-sm erp-text-muted">لا توجد فواتير مطابقة للفلاتر.</p>'}
          <div class="erp-row-wrap">
            <button type="button" class="erp-btn erp-btn--sm" data-pos-history-page="${Math.max(1, historyPage - 1)}" ${historyPage <= 1 ? 'disabled' : ''}>السابق</button>
            <button type="button" class="erp-btn erp-btn--sm" data-pos-history-page="${historyPage + 1}" ${!pagination.totalPages || historyPage >= pagination.totalPages ? 'disabled' : ''}>التالي</button>
          </div>
        </div></section>`;
    }

    function renderOrderDetails(order) {
        const items = Array.isArray(order.items) ? order.items : [];
        const paymentsList = Array.isArray(order.payments) ? order.payments : [];
        body.innerHTML = `<section class="erp-card"><div class="erp-card__head">
          <h3 class="erp-card__title">تفاصيل الفاتورة #${esc(order.invoice_counter ?? order.id)}</h3><span class="erp-grow"></span>
          <button type="button" class="erp-btn erp-btn--sm" data-pos-history-list>العودة للسجل</button>
        </div><div class="erp-card__body erp-stack">
          <ul class="erp-kpis">
            <li class="erp-kpi"><span class="erp-kpi__label">القسم</span><span class="erp-kpi__value">${esc(order.department_name || '—')}</span></li>
            <li class="erp-kpi"><span class="erp-kpi__label">الكاشير</span><span class="erp-kpi__value">${esc(order.cashier_name || '—')}</span></li>
            <li class="erp-kpi"><span class="erp-kpi__label">التاريخ</span><span class="erp-kpi__value erp-mono" dir="ltr">${esc(order.created_at || '—')}</span></li>
            <li class="erp-kpi"><span class="erp-kpi__label">الحالة</span><span class="erp-kpi__value">${esc(orderStatusLabel(order.status))}</span></li>
          </ul>
          <div class="erp-table__scroll" tabindex="0"><table class="erp-table__grid">
            <caption class="erp-sr-only">أصناف الفاتورة</caption>
            <thead><tr><th scope="col">الصنف</th><th scope="col">الكمية</th><th scope="col">سعر الوحدة</th><th scope="col">الخصم</th><th scope="col">الإجمالي</th></tr></thead>
            <tbody>${items.length ? items.map((item) => `<tr>
              <td class="erp-td">${esc(item.product_name || '—')}</td><td class="erp-td erp-num">${esc(item.quantity ?? '—')}</td>
              <td class="erp-td">${money(item.unit_price)}</td><td class="erp-td">${money(item.discount)}</td><td class="erp-td">${money(item.line_total)}</td>
            </tr>`).join('') : '<tr><td class="erp-td" colspan="5">لا توجد أصناف مسجلة.</td></tr>'}</tbody>
          </table></div>
          <div class="erp-row-wrap"><span>قبل الضريبة: <strong>${money(order.subtotal)}</strong></span>
            <span>الخصم: <strong>${money(order.discount_total)}</strong></span><span>الضريبة: <strong>${money(order.tax_total)}</strong></span>
            <span>الإجمالي: <strong>${money(order.total_amount)}</strong></span></div>
          <div class="erp-row-wrap">
            ${ORDER_VOID_ROLES.includes(role) && order.status !== 'cancelled' ? `<button type="button" class="erp-btn erp-btn--danger" data-pos-order-void="${esc(order.id)}">إلغاء الفاتورة ورد المبلغ</button>` : ''}
            ${SELL_ROLES.includes(role) ? `<button type="button" class="erp-btn erp-btn--sm" data-pos-order-reprint="${esc(order.id)}">إعادة طباعة الفاتورة</button>` : ''}
            <button type="button" class="erp-btn erp-btn--sm" data-pos-kot="${esc(order.id)}" data-pos-kot-counter="${esc(order.invoice_counter ?? '')}">تذاكر المطبخ</button>
          </div>
          <h4>وسائل الدفع</h4>
          ${paymentsList.length ? `<div class="erp-table__scroll" tabindex="0"><table class="erp-table__grid">
            <thead><tr><th scope="col">الوسيلة</th><th scope="col">المبلغ</th><th scope="col">المرجع</th></tr></thead>
            <tbody>${paymentsList.map((payment) => `<tr><td class="erp-td">${esc(payment.method || '—')}</td><td class="erp-td">${money(payment.amount)}</td><td class="erp-td erp-mono">${esc(payment.reference || '—')}</td></tr>`).join('')}</tbody>
          </table></div>` : '<p class="erp-text-sm erp-text-muted">لا توجد تفاصيل دفع مسجلة.</p>'}
        </div></section>`;
    }

    async function loadOrderHistory(page = 1) {
        if (!historyAllowed || loading) {return;}
        loading = true;
        body.setAttribute('aria-busy', 'true');
        body.innerHTML = '<p class="erp-text-sm erp-text-muted" role="status">جارٍ تحميل سجل الفواتير…</p>';
        try {
            historyResult = await fetchPosOrders({ ...historyFilters, page, limit: 20 });
            if (!el.isConnected) {return;}
            historyPage = historyResult.pagination.page;
            renderOrderHistory();
        } catch (error) {
            if (!el.isConnected) {return;}
            body.innerHTML = `<section class="erp-card"><div class="erp-card__body erp-stack">
              <p class="erp-error" role="alert">تعذّر تحميل سجل الفواتير: ${esc(error.message || 'خطأ غير معروف')}</p>
              <div class="erp-row-wrap"><button type="button" class="erp-btn erp-btn--sm" data-pos-history-retry>إعادة المحاولة</button>
              <button type="button" class="erp-btn erp-btn--sm" data-pos-history-back>العودة إلى الكاشير</button></div>
            </div></section>`;
        } finally {
            body.removeAttribute('aria-busy');
            loading = false;
        }
    }

    function openOrderHistory() {
        if (!historyAllowed || loading) {return;}
        previousPosBody = body.innerHTML;
        loadOrderHistory(1);
    }

    function closeOrderHistory() {
        if (!previousPosBody) {return;}
        body.innerHTML = previousPosBody;
        previousPosBody = '';
        void refreshCatalog();
    }

    function paymentMethodLabel(method) {
        return ({ cash: 'نقدي', card: 'بطاقة', wallet: 'محفظة', bank_transfer: 'تحويل بنكي' })[method] || method || '—';
    }

    function buffetPriceRow(tier) {
        const active = tier.is_active !== false;
        const core = tier.is_core === true;
        const key = core ? tier.tier : `custom_${tier.id}`;
        return `<div class="erp-pos-v2-price-row${active ? '' : ' is-inactive'}" data-buffet-price-row data-key="${esc(key)}" data-id="${esc(tier.id)}" data-name="${esc(tier.name_ar)}">
          <div class="erp-pos-v2-price-name">
            ${core
        ? `<strong>${esc(tier.name_ar)}</strong><span class="erp-badge" data-tone="brand">فئة أساسية</span>`
        : `<input class="erp-input" data-buffet-tier-name maxlength="100" value="${esc(tier.name_ar)}" aria-label="اسم الفئة" ${active ? '' : 'disabled'}>`}
            ${active ? '' : '<span class="erp-badge" data-tone="warning">معطّلة</span>'}
          </div>
          <label>السعر لكل فرد<input class="erp-input erp-input--ltr" data-buffet-tier-price type="number" min="0" step="0.01" value="${Number(tier.price).toFixed(2)}" ${active ? '' : 'disabled'}></label>
          <span class="erp-text-sm erp-text-muted">ضريبة ${formatInt(tier.vat_rate)}%</span>
          ${core ? '<span></span>' : `<button type="button" class="erp-btn erp-btn--sm" data-buffet-tier-toggle="${esc(tier.id)}" data-active="${active ? 'true' : 'false'}">${active ? 'تعطيل' : 'تفعيل'}</button>`}
        </div>`;
    }

    function buffetPricesPanel() {
        return `<section class="erp-card"><div class="erp-card__head">
          <h3 class="erp-card__title">قائمة أسعار البوفيه</h3><span class="erp-grow"></span>
          <button type="button" class="erp-btn erp-btn--sm" data-buffet-back>العودة إلى الكاشير</button>
        </div><div class="erp-card__body erp-stack">
          <p class="erp-text-sm erp-text-muted">التعديل يسري على الفواتير الجديدة فقط. فئات كبير/صغير/ضيافة أساسية يمكن تعديل سعرها فقط، وإضافة فئات جديدة متاحة دائمًا.</p>
          <div class="erp-pos-v2-prices">${buffet?.tiers?.length ? buffet.tiers.map(buffetPriceRow).join('') : '<p class="erp-text-sm erp-text-muted">لا توجد فئات بعد.</p>'}</div>
          <div class="erp-dash-controls">
            <label>فئة جديدة<input class="erp-input" data-buffet-new-name maxlength="100" placeholder="مثال: بوفيه عائلي"></label>
            <label>السعر<input class="erp-input erp-input--ltr" data-buffet-new-price type="number" min="0" step="0.01" value="0"></label>
            <button type="button" class="erp-btn erp-btn--sm" data-buffet-add-tier>إضافة الفئة</button>
            <button type="button" class="erp-btn erp-btn--primary" data-buffet-save-prices>حفظ الأسعار والأسماء</button>
          </div>
          <p class="erp-error" data-buffet-prices-error role="alert"></p>
        </div></section>`;
    }

    function openBuffetPrices() {
        if (!buffetMode() || !canManageBuffet || loading || !buffet) {return;}
        previousPosBody = body.innerHTML;
        body.innerHTML = buffetPricesPanel();
    }

    async function saveBuffetPricesFromPanel() {
        if (!canManageBuffet || buffetBusy) {return;}
        const errorBox = q('[data-buffet-prices-error]');
        const prices = {};
        const renames = [];
        let invalid = '';
        el.querySelectorAll('[data-buffet-price-row]').forEach((row) => {
            const priceInput = row.querySelector('[data-buffet-tier-price]');
            if (priceInput && !priceInput.disabled) {
                const price = parseMoneyInput(priceInput.value);
                if (!Number.isFinite(price)) {invalid = invalid || 'كل الأسعار يجب أن تكون أرقامًا موجبة أو صفرًا.'; return;}
                prices[row.dataset.key] = price;
            }
            const nameInput = row.querySelector('[data-buffet-tier-name]');
            if (nameInput && !nameInput.disabled) {
                const name = nameInput.value.trim();
                if (!name) {invalid = invalid || 'اسم الفئة مطلوب.'; return;}
                if (name !== row.dataset.name) {renames.push({ id: Number(row.dataset.id), name });}
            }
        });
        if (invalid) {
            if (errorBox) {errorBox.textContent = invalid;}
            return;
        }
        if (!Object.keys(prices).length) {
            if (errorBox) {errorBox.textContent = 'لا توجد أسعار لحفظها.';}
            return;
        }
        buffetBusy = true;
        try {
            await saveBuffetPrices(prices);
            for (const rename of renames) {await renameBuffetTier(rename.id, rename.name);}
            buffet = await fetchBuffetConfig();
            products = buffetTierProducts(buffet.tiers);
            previousPosBody = '';
            renderCashier();
            notify('تم حفظ قائمة الأسعار؛ الفواتير الجديدة فقط تتأثر.', 'success');
        } catch (error) {
            if (errorBox && el.isConnected) {
                errorBox.textContent = `تعذّر حفظ الأسعار: ${error.message || 'خطأ غير معروف'}`;
            }
        } finally {
            buffetBusy = false;
        }
    }

    async function addBuffetTierFromPanel() {
        if (!canManageBuffet || buffetBusy) {return;}
        const errorBox = q('[data-buffet-prices-error]');
        const name = String(q('[data-buffet-new-name]')?.value || '').trim();
        const price = parseMoneyInput(q('[data-buffet-new-price]')?.value || '0');
        if (!name) {
            if (errorBox) {errorBox.textContent = 'أدخل اسم الفئة الجديدة.';}
            return;
        }
        if (!Number.isFinite(price)) {
            if (errorBox) {errorBox.textContent = 'السعر يجب أن يكون رقمًا موجبًا أو صفرًا.';}
            return;
        }
        buffetBusy = true;
        try {
            const result = await addBuffetTier({ nameAr: name, price });
            buffet = { ...buffet, tiers: result.tiers };
            products = buffetTierProducts(result.tiers);
            body.innerHTML = buffetPricesPanel();
            notify('تمت إضافة الفئة إلى قائمة أسعار البوفيه.', 'success');
        } catch (error) {
            if (errorBox && el.isConnected) {
                errorBox.textContent = `تعذّر إضافة الفئة: ${error.message || 'خطأ غير معروف'}`;
            }
        } finally {
            buffetBusy = false;
        }
    }

    async function toggleBuffetTier(tierId) {
        if (!canManageBuffet || buffetBusy) {return;}
        const tier = (buffet?.tiers || []).find((row) => Number(row.id) === Number(tierId));
        if (!tier) {return;}
        const active = tier.is_active !== false;
        if (active) {
            const ok = await (ctx.confirmFn || window.confirm)('تعطيل هذه الفئة؟ تبقى فواتيرها السابقة محفوظة ويمكن تفعيلها لاحقًا.');
            if (ok !== true) {return;}
        }
        buffetBusy = true;
        try {
            const result = active ? await disableBuffetTier(tier.id) : await setBuffetTierActive(tier.id, true);
            buffet = { ...buffet, tiers: result.tiers };
            products = buffetTierProducts(result.tiers);
            body.innerHTML = buffetPricesPanel();
            notify(active ? 'تم تعطيل الفئة — سجل مبيعاتها محفوظ.' : 'تم تفعيل الفئة.', 'success');
        } catch (error) {
            notify(`تعذّر تحديث الفئة: ${error.message || 'خطأ غير معروف'}`, 'error');
        } finally {
            buffetBusy = false;
        }
    }

    function buffetReportPanel() {
        return `<section class="erp-card"><div class="erp-card__head">
          <h3 class="erp-card__title">تقرير البوفيه المفتوح</h3><span class="erp-grow"></span>
          <button type="button" class="erp-btn erp-btn--sm" data-buffet-back>العودة إلى الكاشير</button>
        </div><div class="erp-card__body erp-stack">
          <div class="erp-dash-controls">
            <label>تاريخ التقرير<input class="erp-input erp-input--ltr" type="date" data-buffet-report-date value="${esc(buffetReportDate)}"></label>
            <button type="button" class="erp-btn erp-btn--primary erp-btn--sm" data-buffet-report-run>عرض التقرير</button>
            <button type="button" class="erp-btn erp-btn--sm" data-buffet-report-print disabled>طباعة التقرير</button>
          </div>
          <div data-buffet-report-body><p class="erp-text-sm erp-text-muted" role="status">جارٍ توليد التقرير…</p></div>
        </div></section>`;
    }

    function openBuffetReport() {
        if (!buffetMode() || loading) {return;}
        previousPosBody = body.innerHTML;
        buffetReportDate = buffetReportDate || buffetToday();
        buffetReport = null;
        buffetReportInvoices = [];
        body.innerHTML = buffetReportPanel();
        void loadBuffetReport();
    }

    function reportTiersRows(report) {
        return (report.tiers || []).map((tier) => `<tr><td class="erp-td">${esc(tier.name)}</td><td class="erp-td erp-num">${formatInt(tier.covers)}</td><td class="erp-td">${money(tier.revenue)}</td><td class="erp-td">${money(tier.avg_price)}</td><td class="erp-td erp-num">${formatInt(tier.invoices)}</td></tr>`).join('') || '<tr><td class="erp-td" colspan="5">لا مبيعات في هذا اليوم.</td></tr>';
    }

    function reportHourlyRows(report) {
        return (report.hourly || []).map((row) => `<tr><td class="erp-td erp-mono" dir="ltr">${String(row.hour).padStart(2, '0')}:00</td><td class="erp-td erp-num">${formatInt(row.invoices)}</td><td class="erp-td erp-num">${formatInt(row.covers)}</td><td class="erp-td">${money(row.revenue)}</td></tr>`).join('') || '<tr><td class="erp-td" colspan="4">—</td></tr>';
    }

    function reportPaymentRows(report) {
        return (report.payments || []).map((row) => `<tr><td class="erp-td">${esc(paymentMethodLabel(row.method))}</td><td class="erp-td erp-num">${formatInt(row.count)}</td><td class="erp-td">${money(row.total)}</td></tr>`).join('') || '<tr><td class="erp-td" colspan="3">—</td></tr>';
    }

    function reportCashierRows(report) {
        return (report.cashiers || []).map((row) => `<tr><td class="erp-td">${esc(row.cashier || '—')}</td><td class="erp-td erp-num">${formatInt(row.invoices)}</td><td class="erp-td">${money(row.revenue)}</td></tr>`).join('') || '<tr><td class="erp-td" colspan="3">—</td></tr>';
    }

    function reportInvoiceRows() {
        return (buffetReportInvoices || []).map((invoice) => {
            const covers = Object.values(invoice.covers?.tiers || {})
                .map((tier) => `${tier.name}: ${tier.covers}`).join(' • ') || '—';
            return `<tr><td class="erp-td erp-mono">#${esc(invoice.invoice_counter ?? invoice.id)}</td><td class="erp-td erp-mono" dir="ltr">${esc(invoice.created_at || '—')}</td><td class="erp-td erp-num">${formatInt(invoice.covers?.covers_total || 0)}</td><td class="erp-td">${esc(covers)}</td><td class="erp-td">${money(invoice.total_amount)}</td><td class="erp-td">${esc(orderStatusLabel(invoice.status))}</td><td class="erp-td">${esc(invoice.cashier_name || '—')}</td></tr>`;
        }).join('') || '<tr><td class="erp-td" colspan="7">لا فواتير بوفيه في هذا اليوم.</td></tr>';
    }

    function buffetReportBodyHtml() {
        const t = buffetReport?.totals || {};
        const kpi = (label, value) => `<div class="erp-kpi"><span class="erp-kpi__label">${esc(label)}</span><span class="erp-kpi__value">${value}</span></div>`;
        return `<ul class="erp-kpis">
            ${kpi('إجمالي الأفراد', formatInt(t.covers_total || 0))}
            ${kpi('الإيراد المحصل', esc(moneyText(t.revenue || 0)))}
            ${kpi('ضريبة القيمة المضافة', esc(moneyText(t.vat_total || 0)))}
            ${kpi('صافي الإيراد', esc(moneyText(t.net_revenue || 0)))}
            ${kpi('الفواتير', formatInt(t.invoices || 0))}
            ${kpi('متوسط الفرد', esc(moneyText(t.revenue_per_cover || 0)))}
            ${kpi('ملغاة', `${formatInt(t.voided?.count || 0)} · ${esc(moneyText(t.voided?.amount || 0))}`)}
            ${kpi('معلقة بالكاشير', `${formatInt(t.still_held?.count || 0)} · ${esc(moneyText(t.still_held?.amount || 0))}`)}
          </ul>
          <h4>حسب الفئة</h4>
          <div class="erp-table__scroll" tabindex="0"><table class="erp-table__grid"><caption class="erp-sr-only">تقرير البوفيه حسب الفئة</caption>
            <thead><tr><th scope="col">الفئة</th><th scope="col">أفراد</th><th scope="col">الإيراد الصافي</th><th scope="col">متوسط الفرد</th><th scope="col">فواتير</th></tr></thead>
            <tbody>${reportTiersRows(buffetReport)}</tbody></table></div>
          <h4>التوزيع الساعي</h4>
          <div class="erp-table__scroll" tabindex="0"><table class="erp-table__grid"><caption class="erp-sr-only">تقرير البوفيه حسب الساعة</caption>
            <thead><tr><th scope="col">الساعة</th><th scope="col">فواتير</th><th scope="col">أفراد</th><th scope="col">الإيراد</th></tr></thead>
            <tbody>${reportHourlyRows(buffetReport)}</tbody></table></div>
          <div class="erp-row-wrap">
            <div class="erp-grow"><h4>طرق الدفع</h4><div class="erp-table__scroll" tabindex="0"><table class="erp-table__grid">
              <thead><tr><th scope="col">الطريقة</th><th scope="col">عدد</th><th scope="col">المبلغ</th></tr></thead>
              <tbody>${reportPaymentRows(buffetReport)}</tbody></table></div></div>
            <div class="erp-grow"><h4>أداء الكاشيرين</h4><div class="erp-table__scroll" tabindex="0"><table class="erp-table__grid">
              <thead><tr><th scope="col">الكاشير</th><th scope="col">فواتير</th><th scope="col">الإيراد</th></tr></thead>
              <tbody>${reportCashierRows(buffetReport)}</tbody></table></div></div>
          </div>
          <h4>فواتير البوفيه</h4>
          <div class="erp-table__scroll" tabindex="0"><table class="erp-table__grid"><caption class="erp-sr-only">فواتير البوفيه</caption>
            <thead><tr><th scope="col">رقم الفاتورة</th><th scope="col">التاريخ</th><th scope="col">أفراد</th><th scope="col">الفئات</th><th scope="col">الإجمالي</th><th scope="col">الحالة</th><th scope="col">الكاشير</th></tr></thead>
            <tbody>${reportInvoiceRows()}</tbody></table></div>`;
    }

    async function loadBuffetReport() {
        const input = q('[data-buffet-report-date]');
        const date = String(input?.value || buffetReportDate || buffetToday());
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
            notify('تاريخ التقرير غير صالح.', 'error');
            return;
        }
        buffetReportDate = date;
        const box = q('[data-buffet-report-body]');
        const printBtn = q('[data-buffet-report-print]');
        if (printBtn) {printBtn.disabled = true;}
        if (box) {box.innerHTML = '<p class="erp-text-sm erp-text-muted" role="status">جارٍ توليد تقرير البوفيه…</p>';}
        try {
            const [report, invoices] = await Promise.all([
                fetchBuffetReport(date),
                fetchBuffetInvoices({ date, limit: 200 }).catch(() => ({ data: [] })),
            ]);
            if (!el.isConnected) {return;}
            buffetReport = report;
            buffetReportInvoices = invoices.data;
            if (box) {box.innerHTML = buffetReportBodyHtml();}
            if (printBtn) {printBtn.disabled = false;}
        } catch (error) {
            if (!el.isConnected) {return;}
            buffetReport = null;
            buffetReportInvoices = [];
            if (box) {box.innerHTML = `<p class="erp-error" role="alert">تعذّر توليد التقرير: ${esc(error.message || 'خطأ غير معروف')}</p>`;}
            if (printBtn) {printBtn.disabled = true;}
        }
    }

    function buffetPrintDocument(report) {
        const t = report.totals || {};
        const amount = (value) => esc(moneyText(value || 0));
        const tierRows = (report.tiers || []).map((tier) => `<tr><td>${esc(tier.name)}</td><td>${formatInt(tier.covers)}</td><td>${amount(tier.revenue)}</td><td>${amount(tier.avg_price)}</td><td>${formatInt(tier.invoices)}</td></tr>`).join('') || '<tr><td colspan="5">لا مبيعات</td></tr>';
        const hourlyRows = (report.hourly || []).map((row) => `<tr><td>${String(row.hour).padStart(2, '0')}:00</td><td>${formatInt(row.invoices)}</td><td>${formatInt(row.covers)}</td><td>${amount(row.revenue)}</td></tr>`).join('') || '<tr><td colspan="4">—</td></tr>';
        const paymentRows = (report.payments || []).map((row) => `<tr><td>${esc(paymentMethodLabel(row.method))}</td><td>${formatInt(row.count)}</td><td>${amount(row.total)}</td></tr>`).join('') || '<tr><td colspan="3">—</td></tr>';
        const cashierRows = (report.cashiers || []).map((row) => `<tr><td>${esc(row.cashier || '—')}</td><td>${formatInt(row.invoices)}</td><td>${amount(row.revenue)}</td></tr>`).join('') || '<tr><td colspan="3">—</td></tr>';
        const invoiceRows = (buffetReportInvoices || []).map((invoice) => {
            const covers = Object.values(invoice.covers?.tiers || {}).map((tier) => `${tier.name}: ${tier.covers}`).join(' • ') || '—';
            return `<tr><td>#${esc(invoice.invoice_counter ?? invoice.id)}</td><td dir="ltr">${esc(invoice.created_at || '—')}</td><td>${formatInt(invoice.covers?.covers_total || 0)}</td><td>${esc(covers)}</td><td>${amount(invoice.total_amount)}</td><td>${esc(orderStatusLabel(invoice.status))}</td><td>${esc(invoice.cashier_name || '—')}</td></tr>`;
        }).join('') || '<tr><td colspan="7">لا فواتير</td></tr>';
        return `<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><title>تقرير البوفيه — ${esc(report.date)}</title><style>
          body{font-family:'Segoe UI',Tahoma,Arial,sans-serif;padding:18px;color:#1a1a1a}
          h1{font-size:20px;margin:0 0 4px}h2{font-size:13px;color:#666;margin:0 0 14px;font-weight:normal}h4{margin:14px 0 6px;font-size:14px}
          .cards{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:14px}
          .card{border:1px solid #ddd;border-radius:8px;padding:8px 12px;min-width:130px}
          .card span{display:block;font-size:11px;color:#777}.card strong{font-size:15px}
          table{width:100%;border-collapse:collapse;margin-bottom:10px}
          th,td{border:1px solid #e2e2e2;padding:5px 8px;font-size:12px;text-align:right}
          th{background:#f5f0e6}
        </style></head><body>
          <h1>تقرير البوفيه المفتوح — ${esc(report.date)}</h1>
          <h2>أُنشئ في ${esc(new Date(report.generated_at || Date.now()).toLocaleString('ar-EG'))}</h2>
          <div class="cards">
            <div class="card"><span>إجمالي الأفراد</span><strong>${formatInt(t.covers_total || 0)}</strong></div>
            <div class="card"><span>الإيراد المحصل</span><strong>${amount(t.revenue)}</strong></div>
            <div class="card"><span>ضريبة القيمة المضافة</span><strong>${amount(t.vat_total)}</strong></div>
            <div class="card"><span>صافي الإيراد</span><strong>${amount(t.net_revenue)}</strong></div>
            <div class="card"><span>الفواتير</span><strong>${formatInt(t.invoices || 0)}</strong></div>
            <div class="card"><span>متوسط الفرد</span><strong>${amount(t.revenue_per_cover)}</strong></div>
            <div class="card"><span>فواتير ملغاة</span><strong>${formatInt(t.voided?.count || 0)} (${amount(t.voided?.amount)})</strong></div>
            <div class="card"><span>معلقة بالكاشير</span><strong>${formatInt(t.still_held?.count || 0)} (${amount(t.still_held?.amount)})</strong></div>
          </div>
          <h4>حسب الفئة</h4><table><thead><tr><th>الفئة</th><th>أفراد</th><th>الإيراد الصافي</th><th>متوسط الفرد</th><th>فواتير</th></tr></thead><tbody>${tierRows}</tbody></table>
          <h4>التوزيع الساعي</h4><table><thead><tr><th>الساعة</th><th>فواتير</th><th>أفراد</th><th>الإيراد</th></tr></thead><tbody>${hourlyRows}</tbody></table>
          <h4>طرق الدفع</h4><table><thead><tr><th>الطريقة</th><th>عدد</th><th>المبلغ</th></tr></thead><tbody>${paymentRows}</tbody></table>
          <h4>أداء الكاشيرين</h4><table><thead><tr><th>الكاشير</th><th>فواتير</th><th>الإيراد</th></tr></thead><tbody>${cashierRows}</tbody></table>
          <h4>فواتير البوفيه</h4><table><thead><tr><th>رقم الفاتورة</th><th>التاريخ</th><th>أفراد</th><th>الفئات</th><th>الإجمالي</th><th>الحالة</th><th>الكاشير</th></tr></thead><tbody>${invoiceRows}</tbody></table>
        </body></html>`;
    }

    function printBuffetReport() {
        if (!buffetReport) {
            notify('اعرض تقرير البوفيه أولًا ثم اطبعه.', 'error');
            return;
        }
        const win = openInAppReport(`تقرير البوفيه — ${buffetReport.date}`);
        win.document.open();
        win.document.write(buffetPrintDocument(buffetReport));
        win.document.close();
        win.print();
    }

    function ordersPrintDocument(result) {
        const rows = (result.data || []).map((order) => {
            const items = Array.isArray(order.items) ? order.items : [];
            const summary = items.length
                ? items.map((item) => `${item.product_name || 'صنف'} × ${item.quantity}`).join('، ')
                : '—';
            return `<tr><td>#${esc(order.invoice_counter ?? order.id)}</td><td dir="ltr">${esc(order.created_at || '—')}</td><td>${esc(order.department_name || '—')}</td><td>${esc(order.cashier_name || '—')}</td><td>${esc(summary)}</td><td>${esc(moneyText(order.subtotal || 0))}</td><td>${esc(moneyText(order.discount_total || 0))}</td><td>${esc(moneyText(order.tax_total || 0))}</td><td>${esc(moneyText(order.total_amount || 0))}</td><td>${esc(orderStatusLabel(order.status))}</td></tr>`;
        }).join('') || '<tr><td colspan="10">لا فواتير مطابقة.</td></tr>';
        const range = [historyFilters.dateFrom, historyFilters.dateTo].filter(Boolean).join(' → ') || 'كل الفترات';
        return `<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><title>سجل فواتير الكاشير</title><style>
          body{font-family:'Segoe UI',Tahoma,Arial,sans-serif;padding:18px;color:#1a1a1a}
          h1{font-size:20px;margin:0 0 4px}h2{font-size:13px;color:#666;margin:0 0 14px;font-weight:normal}
          table{width:100%;border-collapse:collapse;margin-top:10px}
          th,td{border:1px solid #e2e2e2;padding:5px 8px;font-size:11px;text-align:right}
          th{background:#f5f0e6}
        </style></head><body>
          <h1>سجل فواتير الكاشير</h1>
          <h2>الفترة: ${esc(range)} · ${formatInt((result.data || []).length)} فاتورة · أُنشئ في ${esc(new Date().toLocaleString('ar-EG'))}</h2>
          <table><thead><tr><th>رقم الفاتورة</th><th>التاريخ</th><th>القسم</th><th>الكاشير</th><th>الأصناف</th><th>قبل الضريبة</th><th>الخصم</th><th>الضريبة</th><th>الإجمالي</th><th>الحالة</th></tr></thead><tbody>${rows}</tbody></table>
        </body></html>`;
    }

    async function printOrderHistory() {
        if (!historyAllowed || loading) {return;}
        loading = true;
        body.setAttribute('aria-busy', 'true');
        try {
            const result = await exportPosOrders({
                dateFrom: historyFilters.dateFrom,
                dateTo: historyFilters.dateTo,
                status: historyFilters.status,
                search: historyFilters.search,
            });
            const win = openInAppReport('سجل فواتير الكاشير');
            win.document.open();
            win.document.write(ordersPrintDocument(result));
            win.document.close();
            win.print();
            notify(`أُرسل ${result.data.length} فاتورة إلى الطباعة.`, 'success');
        } catch (error) {
            notify(`تعذّر تصدير الفواتير: ${error.message || 'خطأ غير معروف'}`, 'error');
        } finally {
            body.removeAttribute('aria-busy');
            loading = false;
        }
    }

    async function openKotTickets(orderId, counter) {
        if (busy) {return;}
        busy = true;
        try {
            const html = await fetchPosKotPage(orderId);
            if (!el.isConnected) {return;}
            const win = openInAppReport(`تذاكر المطبخ${counter ? ` — فاتورة #${counter}` : ''}`);
            win.document.open();
            win.document.write(html);
            win.document.close();
        } catch (error) {
            notify(`تعذّر فتح تذاكر المطبخ: ${error.message || 'خطأ غير معروف'}`, 'error');
        } finally {
            busy = false;
        }
    }

    async function runDayClose() {
        if (!DAY_CLOSE_ROLES.includes(role) || busy) {return;}
        busy = true;
        try {
            const status = await dayCloseStatus();
            if (status.existing_z) {
                notify(`اليوم مقفل مسبقًا برقم ${status.existing_z.z_number}.`, 'info');
                return;
            }
            if ((status.open || []).length) {
                notify(`أغلق ${status.open.length} وردية مفتوحة أولًا من سجل الورديات، ثم أعد المحاولة.`, 'error');
                return;
            }
            const ok = await (ctx.confirmFn || window.confirm)(`تنفيذ الإقفال اليومي Z ليوم ${status.today}؟ سيُقفل اليوم ويُرحّل الفرق للدفتر.`);
            if (ok !== true) {return;}
            const result = await execDayClose(status.today);
            notify(`تم الإقفال ${result?.z?.z_number || ''} — الفرق ${moneyText(result?.z?.total_variance || 0)}.`, 'success');
        } catch (error) {
            notify(`تعذّر تنفيذ الإقفال اليومي: ${error.message || 'خطأ غير معروف'}`, 'error');
        } finally {
            busy = false;
        }
    }

    async function showOrderDetails(orderId) {
        body.setAttribute('aria-busy', 'true');
        body.innerHTML = '<p class="erp-text-sm erp-text-muted" role="status">جارٍ تحميل تفاصيل الفاتورة…</p>';
        try {
            const order = await fetchPosOrderDetails(orderId);
            if (!el.isConnected) {return;}
            renderOrderDetails(order);
        } catch (error) {
            if (!el.isConnected) {return;}
            body.innerHTML = `<section class="erp-card"><div class="erp-card__body erp-stack">
              <p class="erp-error" role="alert">تعذّر تحميل تفاصيل الفاتورة: ${esc(error.message || 'خطأ غير معروف')}</p>
              <button type="button" class="erp-btn erp-btn--sm" data-pos-history-list>العودة للسجل</button>
            </div></section>`;
        } finally {
            body.removeAttribute('aria-busy');
        }
    }

    function buffetTierIcon(tier) {
        if (tier === 'adult') {return 'users';}
        if (tier === 'child') {return 'user';}
        if (tier === 'hospitality') {return 'party';}
        return 'star';
    }

    function buffetPersonCard(product) {
        const free = number(product.price) === 0;
        return `<article class="erp-pos-v2-person">
          <button type="button" class="erp-pos-v2-person-btn${product.tier === 'hospitality' ? ' is-hospitality' : ''}" data-pos-add="${esc(product.id)}" aria-label="إضافة ${esc(product.name_ar || 'فرد')} إلى السلة" ${busy ? 'disabled' : ''}>
            <span class="erp-pos-v2-person-icon" aria-hidden="true"><i class="ji" data-i="${buffetTierIcon(product.tier)}"></i></span>
            <strong>${esc(product.name_ar || 'فئة بوفيه')}</strong>
            <small>${free ? 'ضيافة مجانية' : `${esc(product.unit || 'فرد')} واحد`}</small>
            <span class="erp-pos-v2-person-price">${free ? 'مجاناً' : money(product.price)}</span>
            <span class="erp-pos-v2-person-add">+ إضافة فرد</span>
          </button>
        </article>`;
    }

    function productCard(p) {
        const image = safeProductImageUrl(p.image_url);
        const imageContent = image
            ? `<img src="${esc(image)}" alt="${esc(p.name_ar || p.name_en || 'صنف')}" loading="lazy" decoding="async">`
            : '<span class="erp-pos-v2-product-placeholder" aria-hidden="true"><i class="ji" data-i="image"></i></span>';
        return `<article class="erp-pos-v2-product-card">
          <button class="erp-pos-v2-product" type="button" data-pos-add="${esc(p.id)}" aria-label="إضافة ${esc(p.name_ar || p.name_en || 'الصنف')} إلى السلة" ${busy ? 'disabled' : ''}>
            <span class="erp-pos-v2-product-image">${imageContent}</span>
            <span class="erp-pos-v2-product-info">
              <strong>${esc(p.name_ar || p.name_en || 'صنف')}</strong>
              <span class="erp-pos-v2-product-price">${money(p.price)}</span>
              <span class="erp-pos-v2-product-meta"><small>المتاح: ${esc(p.stock_quantity ?? '—')} ${esc(p.unit || '')}</small>${p.barcode ? `<small dir="ltr">${esc(p.barcode)}</small>` : ''}</span>
            </span>
          </button>
          ${canManageCatalog ? `<button class="erp-pos-v2-image-action" type="button" data-pos-image="${esc(p.id)}" aria-label="رفع أو تغيير صورة ${esc(p.name_ar || p.name_en || 'الصنف')}" title="رفع صورة الصنف" ${busy || imageUploadPending ? 'disabled' : ''}><i class="ji" data-i="image" aria-hidden="true"></i><span>${image ? 'تغيير الصورة' : 'إضافة صورة'}</span></button>` : ''}
        </article>`;
    }

    function renderCashier() {
        if (!activeShift) {return renderOpenShift();}
        const isBuffet = buffetMode();
        const t = totals();
        const categories = [...new Set(products.map((p) => String(p.category || '').trim()).filter(Boolean))]
            .sort((a, b) => a.localeCompare(b, 'ar'));
        const filtered = products.filter((p) => {
            const categoryMatch = isBuffet || !selectedCategory || String(p.category || '').trim() === selectedCategory;
            const searchMatch = `${p.name_ar || ''} ${p.name_en || ''} ${p.barcode || ''} ${p.category || ''}`
                .toLocaleLowerCase().includes(search.toLocaleLowerCase());
            return categoryMatch && searchMatch;
        });
        body.innerHTML = `<div class="erp-pos-v2">
          ${embedded && !salesEnabled ? `<div class="erp-pos-v2-mode" role="status">
            <strong>وضع التجهيز — البيع غير مفعّل</strong>
            <span>تصفّح الأصناف وجرّب البحث والباركود والسلة. لن تُصدر فاتورة أو تُسجّل حركة.</span>
          </div>` : ''}
          <section class="erp-card erp-pos-v2-catalog"><div class="erp-card__body">
            <div class="erp-pos-v2-heading"><div><h3 class="erp-card__title">${esc(activeShift.dept_name || 'نقطة البيع')}${isBuffet ? ' <span class="erp-badge" data-tone="brand">بوفيه مفتوح</span>' : ''}</h3>
            <span class="erp-text-sm erp-text-muted">وردية #${esc(activeShift.id || activeShift.session_id)}${isBuffet ? ' · البيع بعدد الأفراد لا الأصناف' : ''}</span></div>
            <div class="erp-row-wrap">
              ${isBuffet && canManageBuffet ? '<button type="button" class="erp-btn erp-btn--sm" data-buffet-prices>أسعار البوفيه</button>' : ''}
              ${isBuffet ? '<button type="button" class="erp-btn erp-btn--sm" data-buffet-report>تقرير البوفيه</button>' : ''}
              ${DAY_CLOSE_ROLES.includes(role) ? '<button type="button" class="erp-btn erp-btn--sm" data-pos-day-close>إقفال اليوم Z</button>' : ''}
              <button type="button" class="erp-btn erp-btn--sm" data-pos-close ${canSell ? '' : 'disabled'}>إغلاق الوردية</button>
            </div></div>
            ${isBuffet ? `<div class="erp-pos-v2-live" data-buffet-live role="status" aria-live="polite">${buffetLiveHtml()}</div>` : ''}
            <label class="erp-pos-v2-search">${isBuffet ? 'بحث الفئات' : 'بحث الأصناف'}<input class="erp-input" data-pos-search type="search" value="${esc(search)}" placeholder="${isBuffet ? 'اسم فئة البوفيه' : 'اسم الصنف أو الباركود'}" autocomplete="off"></label>
            ${isBuffet ? '' : `<div class="erp-pos-v2-categories" role="group" aria-label="تصنيف الأصناف">
              <button type="button" class="erp-pos-v2-category${selectedCategory ? '' : ' is-active'}" data-pos-category="" aria-pressed="${selectedCategory ? 'false' : 'true'}">الكل</button>
              ${categories.map((category) => `<button type="button" class="erp-pos-v2-category${selectedCategory === category ? ' is-active' : ''}" data-pos-category="${esc(category)}" aria-pressed="${selectedCategory === category ? 'true' : 'false'}">${esc(category)}</button>`).join('')}
            </div>`}
            <div class="erp-pos-v2-products${isBuffet ? ' erp-pos-v2-people' : ''}">${filtered.length
                ? filtered.map((p) => isBuffet ? buffetPersonCard(p) : productCard(p)).join('')
                : `<p class="erp-text-sm erp-text-muted">${isBuffet ? 'لا توجد فئات بوفيه مطابقة أو مفعّلة — راجع أسعار البوفيه.' : 'لا توجد أصناف مطابقة.'}</p>`}</div>
            ${canManageCatalog && !isBuffet ? '<input class="erp-pos-v2-image-input" data-pos-image-input type="file" accept="image/jpeg,image/png,image/webp" hidden>' : ''}
            <section class="erp-pos-v2-held"><h4>الطلبات المعلقة <span class="erp-badge" data-tone="brand">${heldOrders.length}</span></h4>
              ${heldOrders.length ? heldOrders.map((order) => `<article class="erp-pos-v2-held-row"><div><strong>${esc(order.items_preview || 'طلب محفوظ')}</strong><small>${money(order.total_amount)} · ${esc(order.created_at || '')}</small></div>
                <div><button class="erp-btn erp-btn--sm" type="button" data-pos-recall="${esc(order.id)}" ${canSell ? '' : 'disabled'}>استرجاع</button>
                <button class="erp-btn erp-btn--sm" type="button" data-pos-held-delete="${esc(order.id)}" ${canSell ? '' : 'disabled'}>حذف</button></div></article>`).join('')
                  : '<p class="erp-text-sm erp-text-muted">لا توجد طلبات معلقة.</p>'}
            </section>
          </div></section>
          <section class="erp-card erp-pos-v2-order"><div class="erp-card__body">
            <h3 class="erp-card__title">السلة <span class="erp-badge" data-tone="brand">${cart.reduce((n, r) => n + r.quantity, 0)}</span></h3>
            <button type="button" class="erp-btn erp-btn--sm" data-pos-hold ${cart.length && canSell ? '' : 'disabled'}>تعليق الطلب الحالي</button>
            <div class="erp-pos-v2-cart">${cart.length ? cart.map((row) => `<div class="erp-pos-v2-line">
              <div><strong>${esc(row.name)}</strong><small>${money(row.price)} × ${row.quantity}${isBuffet ? ' فرد' : ''}</small></div>
              <div class="erp-pos-v2-qty"><button type="button" data-pos-qty="${row.id}" data-delta="-1" aria-label="تقليل">−</button><span>${row.quantity}</span><button type="button" data-pos-qty="${row.id}" data-delta="1" aria-label="زيادة">+</button></div>
            </div>`).join('') : `<p class="erp-text-sm erp-text-muted">السلة فارغة — ${isBuffet ? 'اختر فئة وأضف فردًا للبدء.' : 'اختر صنفًا للبدء.'}</p>`}</div>
            <div class="erp-pos-v2-totals"><div><span>قبل الخصم</span><strong>${money(t.subtotalBeforeDiscount)}</strong></div>${t.discount ? `<div><span>الخصم</span><strong>−${money(t.discount)}</strong></div>` : ''}<div><span>بعد الخصم وقبل الضريبة</span><strong>${money(t.subtotal)}</strong></div><div><span>الضريبة التقديرية</span><strong>${money(t.tax)}</strong></div><div class="total"><span>الإجمالي التقديري</span><strong data-pos-total>${money(t.total)}</strong></div></div>
            ${canSell ? `<fieldset class="erp-pos-v2-payments"><legend>طرق الدفع</legend>
            <div class="erp-pos-v2-discount">
              <label>نوع الخصم<select class="erp-select" data-pos-discount-type>
                <option value=""${!cartDiscount.type ? ' selected' : ''}>بدون خصم</option>
                <option value="percent"${cartDiscount.type === 'percent' ? ' selected' : ''}>نسبة مئوية</option>
                <option value="fixed"${cartDiscount.type === 'fixed' ? ' selected' : ''}>مبلغ ثابت</option>
              </select></label>
              <label>قيمة الخصم<input class="erp-input erp-input--ltr" data-pos-discount-value type="text" inputmode="decimal" value="${esc(cartDiscount.value)}" ${cartDiscount.type ? '' : 'disabled'}></label>
            </div>
            ${t.valid ? '' : '<p class="erp-error" role="alert">قيمة الخصم غير صالحة؛ النسبة من 0 إلى 100.</p>'}
            ${PAYMENT_FIELDS.map((f) => `<label>${f.label}<input class="erp-input erp-input--ltr" data-pos-payment="${f.key}" type="number" min="0" step="0.01" value="${esc(paymentsTouched ? payments[f.key] : (f.key === 'cash' ? t.total.toFixed(2) : '0'))}"></label>${f.key === 'cash' ? '' : `<label class="erp-pos-v2-reference">مرجع ${f.label}<input class="erp-input erp-input--ltr" data-pos-reference="${f.key}" maxlength="120" value="${esc(paymentReferences[f.key])}" autocomplete="off"></label>`}`).join('')}
            <p class="erp-text-sm erp-text-muted" data-pos-payment-state role="status"></p>
            <button type="button" class="erp-btn erp-btn--primary erp-pos-v2-submit" data-pos-complete ${cart.length && t.valid ? '' : 'disabled'}>إتمام البيع</button>
            <button type="button" class="erp-btn erp-btn--sm" data-pos-clear ${cart.length ? '' : 'disabled'}>تفريغ السلة</button></fieldset>`
                : `<p class="erp-text-sm erp-text-muted">${salesEnabled ? 'قراءة فقط — لا يمكن إتمام البيع بهذا الدور.' : 'وضع التجهيز فقط — البيع وفتح الورديات غير مفعّلين.'}</p>`}
            ${receipt ? `<section class="erp-pos-v2-receipt" data-pos-receipt><h3>إيصال البيع</h3><dl>
              <div><dt>رقم الفاتورة</dt><dd>#${esc(receipt.invoice_counter ?? '—')}</dd></div>
              <div><dt>UUID</dt><dd class="erp-mono">${esc(receipt.invoice_uuid || '—')}</dd></div>
              <div><dt>الإجمالي</dt><dd>${money(receipt.total_amount)}</dd></div>
              <div><dt>المدفوع</dt><dd>${money(receipt.paid)}</dd></div>
              <div><dt>الباقي</dt><dd>${money(receipt.change)}</dd></div>
              <div><dt>الطباعة</dt><dd>${receipt.print_job_id ? 'أُضيف الإيصال إلى الطابور' : 'لا توجد مهمة طباعة مؤكدة'}</dd></div>
              <div><dt>ZATCA</dt><dd>${receipt.zatca_queued ? 'أُضيف إلى الطابور' : 'غير مؤكد من الخادم'}</dd></div>
              <div><dt>تذاكر المطبخ</dt><dd>${receipt.kot_enabled ? `${Array.isArray(receipt.kot_jobs) ? receipt.kot_jobs.length : 0} مهمة` : 'متوقفة من إعداد الخادم'}</dd></div>
            </dl><img data-pos-qr alt="رمز الفاتورة الضريبي" hidden><p data-pos-qr-error class="erp-text-sm erp-text-muted"></p>
            ${receipt.order_id ? `<div class="erp-row-wrap">
              <button type="button" class="erp-btn erp-btn--sm" data-pos-order-reprint="${esc(receipt.order_id)}">إعادة طباعة الإيصال</button>
              <button type="button" class="erp-btn erp-btn--sm" data-pos-kot="${esc(receipt.order_id)}" data-pos-kot-counter="${esc(receipt.invoice_counter ?? '')}">تذاكر المطبخ</button>
            </div>` : ''}
            <button type="button" class="erp-btn erp-btn--sm" data-pos-print>طباعة الإيصال</button></section>` : ''}
          </div></section>
        </div>`;
        updatePaymentState();
        if (receipt?.qr_payload) {renderQr(receipt.qr_payload);}
    }

    function updatePaymentState() {
        const state = q('[data-pos-payment-state]');
        if (!state) {return;}
        const amounts = PAYMENT_FIELDS.map((f) => parseMoneyInput(q(`[data-pos-payment="${f.key}"]`)?.value));
        if (amounts.some((amount) => !Number.isFinite(amount))) {
            state.textContent = 'أدخل مبالغ دفع صحيحة غير سالبة.';
            return;
        }
        const paid = amounts.reduce((sum, amount) => sum + amount, 0);
        const due = Math.max(0, totals().total - paid);
        state.textContent = due > 0.009 ? `المتبقي للدفع: ${moneyText(due)}` : paid > totals().total + 0.009
            ? `الباقي للعميل: ${moneyText(paid - totals().total)}`
            : 'المبلغ المدفوع مطابق للإجمالي.';
    }

    function moneyText(value) {
        const m = formatMoney(value, currency);
        return `${m.amount}${m.hasUnit ? ` ${m.unit}` : ''}`;
    }

    async function renderQr(payload) {
        const img = q('[data-pos-qr]');
        if (!img) {return;}
        const ok = await ensureQrCode();
        if (!el.isConnected) {return;}
        const qr = window.QRCode;
        if (!ok || !qr || typeof qr.toDataURL !== 'function') {
            q('[data-pos-qr-error]').textContent = 'تعذّر تحميل مولّد رمز الفاتورة؛ يمكنك طباعة تفاصيل الإيصال دون الرمز.';
            return;
        }
        try {
            img.src = await qr.toDataURL(payload, { width: 220, margin: 1, errorCorrectionLevel: 'M' });
            img.hidden = false;
        } catch (error) {
            q('[data-pos-qr-error]').textContent = `تعذّر إنشاء رمز الفاتورة: ${error.message || 'خطأ غير معروف'}`;
        }
    }

    function showFailure(message) {
        const error = q('[data-pos-error]');
        if (error) {error.textContent = message;}
        else {notify(message, 'error');}
    }

    async function reload() {
        if (loading) {return;}
        if (!allowed) {
            body.innerHTML = '<p class="erp-text-sm erp-text-muted">مدخل الكاشير متاح للأدوار المخوّلة فقط — القرار النهائي للخادم.</p>';
            return;
        }
        if (!embedded) {
            loading = true;
            body.setAttribute('aria-busy', 'true');
            body.innerHTML = '<p class="erp-text-sm erp-text-muted">الواجهة المدمجة مغلقة افتراضيًا حتى اجتياز اختبارات الاعتماد. يمكنك استخدام POS المستقل دون تغيير.</p>';
            try {
                if (role === 'cashier') {
                    try {
                        const ownShift = await fetchActivePosShift();
                        if (!el.isConnected) {return;}
                        body.insertAdjacentHTML('beforeend', `<p class="erp-text-sm">وردية حسابك مفتوحة في <strong>${esc(ownShift.dept_name || 'القسم المحدد')}</strong> — #${esc(ownShift.id)} — العهدة ${money(ownShift.opening_balance)}.</p>`);
                    } catch (e) {
                        if (e.code !== 'NO_OPEN_SHIFT') {throw e;}
                        if (!el.isConnected) {return;}
                        body.insertAdjacentHTML('beforeend', '<p class="erp-text-sm erp-text-muted">لا توجد وردية مفتوحة لهذا الحساب.</p>');
                    }
                    return;
                }
                const d = await fetchOpenShifts();
                const shifts = d.shifts || [];
                if (!el.isConnected) {return;}
                body.insertAdjacentHTML('beforeend', shifts.length
                    ? `<div class="erp-table__scroll" tabindex="0"><table class="erp-table__grid"><caption class="erp-sr-only">الورديات المفتوحة</caption><thead><tr><th scope="col">وردية</th><th scope="col">الكاشير</th><th scope="col">القسم</th><th scope="col">اليوم</th><th scope="col">العهدة</th><th scope="col">المتوقع</th><th scope="col">الحركة</th></tr></thead><tbody>`
                    + shifts.map((s) => `<tr><td class="erp-td erp-mono">#${esc(s.id)}</td><td class="erp-td">${esc(s.cashier_name || '—')}</td><td class="erp-td">${esc(s.dept_name || '—')}</td><td class="erp-td erp-mono">${esc(s.biz_date || '—')}${s.biz_date !== s.today ? ' <span class="erp-badge" data-tone="warning">يوم سابق</span>' : ''}</td><td class="erp-td">${money(s.opening_balance)}</td><td class="erp-td">${money(s.expected_cash)}</td><td class="erp-td">${formatInt(s.invoice_count)} فاتورة</td></tr>`).join('')
                    + '</tbody></table></div><p class="erp-text-sm erp-text-muted">الإغلاق المركزي من لوحة المدير المالي.</p>'
                    : '<p class="erp-text-sm erp-text-muted">لا ورديات مفتوحة — كل الكاشيريات مغلقة.</p>');
            } catch (e) {
                if (!el.isConnected) {return;}
                showFailure(e.message === 'UNAUTHORIZED' ? 'انتهت الجلسة — سجّل الدخول مجددًا.' : `تعذّر قراءة الورديات: ${e.message || 'خطأ'}`);
            } finally {
                body.removeAttribute('aria-busy');
                loading = false;
                if (catalogRefreshQueued && !previousPosBody && el.isConnected) {
                    catalogRefreshQueued = false;
                    void refreshCatalog();
                }
            }
            return;
        }
        loading = true;
        body.setAttribute('aria-busy', 'true');
        body.innerHTML = '<p class="erp-text-sm erp-text-muted">جارٍ تجهيز نقطة البيع…</p>';
        try {
            const depts = await fetchPosDepartments();
            if (!el.isConnected) {return;}
            departments = depts.filter((d) => d.is_active !== false);
            let heldLoadError = '';
            heldOrders = [];
            try {
                activeShift = await fetchActivePosShift();
                if (activeShift) {
                    await loadCatalogProducts();
                    try {heldOrders = await fetchPosHeldOrders(shiftId());}
                    catch (heldError) {
                        heldOrders = [];
                        heldLoadError = `تعذّر تحميل الطلبات المعلقة: ${heldError.message || 'خطأ غير معروف'}`;
                    }
                }
            } catch (e) {
                if (e.code !== 'NO_OPEN_SHIFT') {throw e;}
                activeShift = null;
                buffet = null;
                buffetLive = null;
                products = [];
                stopBuffetLiveTimer();
            }
            if (!el.isConnected) {return;}
            renderCashier();
            notify(heldLoadError || (activeShift ? 'تم تحميل الوردية والأصناف من الخادم.' : 'لا توجد وردية مفتوحة؛ اختر القسم وأدخل العهدة.'), heldLoadError ? 'error' : 'info');
        } catch (e) {
            if (!el.isConnected) {return;}
            body.innerHTML = `<p class="erp-text-sm erp-text-muted" role="alert">${esc(e.message === 'UNAUTHORIZED' ? 'انتهت الجلسة — سجّل الدخول مجددًا.' : `تعذّر تجهيز نقطة البيع: ${e.message || 'خطأ غير معروف'}`)}</p><button type="button" class="erp-btn erp-btn--sm" data-erp-retry>إعادة المحاولة</button>`;
        } finally {
            body.removeAttribute('aria-busy');
            loading = false;
            if (catalogRefreshQueued && !previousPosBody && el.isConnected) {
                catalogRefreshQueued = false;
                void refreshCatalog();
            }
        }
    }

    async function openShift() {
        if (!canSell || busy) {return;}
        const departmentId = Number(q('[data-pos-department]')?.value);
        const openingBalance = parseMoneyInput(q('[data-pos-opening]')?.value);
        if (!departmentId || !Number.isFinite(openingBalance) || openingBalance < 0) {
            showFailure('اختر القسم وتحقق من العهدة الافتتاحية.');
            return;
        }
        const department = departments.find((d) => Number(d.id) === departmentId);
        const ok = await (ctx.confirmFn || window.confirm)(`فتح وردية ${department?.name_ar || ''} بعهدة ${moneyText(openingBalance)}؟`);
        if (ok !== true) {return;}
        busy = true;
        let heldLoadError = '';
        try {
            activeShift = await openPosShift({ departmentId, openingBalance });
            activeShift.department_id = departmentId;
            activeShift.dept_name = department?.name_ar || '—';
            activeShift.dept_code = department?.code || '';
            cart = [];
            receipt = null;
            payments = { cash: 0, card: 0, wallet: 0, bank_transfer: 0 };
            paymentsTouched = false;
            try {
                await loadCatalogProducts();
            } catch (productError) {
                products = [];
                renderCashier();
                notify(`تم فتح الوردية، لكن تعذّر تحميل ${buffetMode() ? 'فئات البوفيه' : 'الأصناف'}: ${productError.message || 'خطأ غير معروف'}`, 'error');
                return;
            }
            try {heldOrders = await fetchPosHeldOrders(shiftId());}
            catch (heldError) {
                heldOrders = [];
                heldLoadError = `فُتحت الوردية، لكن تعذّر تحميل الطلبات المعلقة: ${heldError.message || 'خطأ غير معروف'}`;
            }
            renderCashier();
            notify(heldLoadError || 'تم فتح الوردية بنجاح.', heldLoadError ? 'error' : 'success');
        } catch (e) {
            showFailure(`تعذّر فتح الوردية: ${e.message || 'خطأ غير معروف'}`);
        } finally {
            busy = false;
        }
    }

    function changeQuantity(productId, delta) {
        if (busy) {return;}
        const row = cart.find((item) => item.id === Number(productId));
        if (!row) {return;}
        row.quantity += Number(delta);
        if (row.quantity <= 0) {cart = cart.filter((item) => item !== row);}
        receipt = null;
        saleKey = '';
        renderCashier();
    }

    function addProduct(product) {
        if (!product || busy) {return;}
        const row = cart.find((item) => item.id === Number(product.id));
        if (row) {row.quantity += 1;}
        else {
            cart.push({
                id: Number(product.id),
                name: String(product.name_ar || product.name_en || 'صنف'),
                price: number(product.price),
                vatRate: number(product.vat_rate ?? 15),
                quantity: 1,
            });
        }
        receipt = null;
        saleKey = '';
        renderCashier();
    }

    async function uploadSelectedProductImage() {
        const input = q('[data-pos-image-input]');
        const file = input?.files?.[0];
        const productId = Number(imageProductId);
        if (!canManageCatalog || busy || imageUploadPending) {return;}
        if (!Number.isInteger(productId) || productId <= 0 || !file) {
            notify('اختر صورة صالحة للصنف أولاً.', 'error');
            return;
        }
        if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
            notify('الصيغ المدعومة: JPG وPNG وWEBP.', 'error');
            input.value = '';
            return;
        }
        if (file.size > 5 * 1024 * 1024) {
            notify('حجم الصورة يجب ألا يتجاوز 5 ميجابايت.', 'error');
            input.value = '';
            return;
        }
        const product = products.find((item) => Number(item.id) === productId);
        if (!product) {
            notify('الصنف لم يعد موجودًا في القائمة؛ حدّث الشاشة وحاول مجددًا.', 'error');
            input.value = '';
            return;
        }
        imageUploadPending = true;
        el.querySelectorAll('[data-pos-image]').forEach((button) => {button.disabled = true;});
        notify(`جارٍ رفع صورة ${product.name_ar || product.name_en || 'الصنف'}…`, 'info');
        let saved = false;
        try {
            const result = await uploadProductImage(productId, file);
            if (!el.isConnected) {return;}
            if (!result?.image_url) {throw new Error('لم يرجع الخادم رابط الصورة بعد الحفظ');}
            products = products.map((item) => Number(item.id) === productId ? { ...item, image_url: result.image_url } : item);
            input.value = '';
            saved = true;
        } catch (error) {
            if (el.isConnected) {
                notify(`تعذّر رفع صورة الصنف: ${error.message || 'خطأ غير معروف'}`, 'error');
            }
        } finally {
            imageUploadPending = false;
            if (el.isConnected) {renderCashier();}
        }
        if (saved && el.isConnected) {notify('تم حفظ الصورة؛ ستظهر لكل الكاشيريات بعد تحديث الأصناف.', 'success');}
    }

    async function completeSale() {
        if (!canSell || busy || !activeShift || !cart.length) {return;}
        const t = totals();
        if (!t.valid) {notify('قيمة الخصم غير صالحة؛ تحقق من نوع الخصم وقيمته.', 'error'); return;}
        const enteredPayments = PAYMENT_FIELDS.map((f) => ({
            method: f.key,
            amount: parseMoneyInput(q(`[data-pos-payment="${f.key}"]`)?.value),
            reference: paymentReferences[f.key] || null,
        }));
        if (enteredPayments.some((payment) => !Number.isFinite(payment.amount))) {
            notify('أدخل مبالغ دفع صحيحة غير سالبة.', 'error');
            return;
        }

        const salePayments = enteredPayments.filter((p) => p.amount > 0);
        const paid = salePayments.reduce((sum, p) => sum + p.amount, 0);
        if (paid + 0.009 < t.total) {notify('المبلغ المدفوع أقل من إجمالي الفاتورة.', 'error'); return;}
        if (paid - t.total > 0.01) {
            const ok = await (ctx.confirmFn || window.confirm)(`المدفوع ${moneyText(paid)} يزيد عن الإجمالي ${moneyText(t.total)}. سيتم احتساب الباقي للعميل؛ هل تتابع؟`);
            if (ok !== true) {return;}
        }
        if (!saleKey) {
            const random = globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
            saleKey = `v2-pos-${activeShift.session_id || activeShift.id}-${random}`;
        }
        busy = true;
        const button = q('[data-pos-complete]');
        if (button) {button.disabled = true; button.textContent = 'جارٍ إتمام البيع…';}
        try {
            const result = await completePosSale({
                departmentId: activeShift.department_id,
                sessionId: activeShift.session_id || activeShift.id,
                items: buildPosSaleItems(cart, cartDiscount),
                payments: salePayments,
                idempotencyKey: saleKey,
            });
            if (!el.isConnected) {return;}
            receipt = result;
            cart = [];
            payments = { cash: 0, card: 0, wallet: 0, bank_transfer: 0 };
            paymentReferences = { card: '', wallet: '', bank_transfer: '' };
            cartDiscount = { type: '', value: '0' };
            paymentsTouched = false;
            saleKey = '';
            renderCashier();
            notify('تم تسجيل البيع؛ حالة الطباعة وZATCA معروضة حسب رد الخادم.', 'success');
            try {
                await loadCatalogProducts();
                if (el.isConnected) {renderCashier();}
            } catch (refreshError) {
                notify(`تم البيع بنجاح، لكن تعذّر تحديث قائمة ${buffetMode() ? 'فئات البوفيه' : 'الأصناف'}: ${refreshError.message || 'خطأ غير معروف'}`, 'error');
            }
        } catch (e) {
            notify(`فشل إتمام البيع ولم تُفرّغ السلة: ${e.message || 'خطأ غير معروف'}`, 'error');
        } finally {
            busy = false;
            const currentButton = q('[data-pos-complete]');
            if (currentButton) {currentButton.disabled = !cart.length; currentButton.textContent = 'إتمام البيع';}
        }
    }

    async function holdOrder() {
        if (!canSell || busy || !cart.length || !activeShift) {return;}
        const t = totals();
        if (!t.valid) {notify('قيمة الخصم غير صالحة؛ لا يمكن تعليق الطلب.', 'error'); return;}
        busy = true;
        try {
            const held = await holdPosOrder({
                sessionId: shiftId(),
                departmentId: activeShift.department_id,
                items: cart.map((row) => ({ product_id: row.id, quantity: row.quantity, unit_price: row.price, discount: 0 })),
                cartDiscount: cartDiscount.type ? { type: cartDiscount.type, value: parseMoneyInput(cartDiscount.value) } : null,
            });
            const preview = cart.map((row) => `${row.name}(${row.quantity})`).join('، ');
            const amount = totals().total;
            cart = [];
            payments = { cash: 0, card: 0, wallet: 0, bank_transfer: 0 };
            paymentReferences = { card: '', wallet: '', bank_transfer: '' };
            cartDiscount = { type: '', value: '0' };
            paymentsTouched = false;
            saleKey = '';
            heldOrders.unshift({ id: held.id, items_preview: preview, total_amount: held.total_amount || amount, created_at: held.created_at });
            renderCashier();
            notify('تم تعليق الطلب في الخادم.', 'success');
            try {
                heldOrders = await fetchPosHeldOrders(shiftId());
                if (el.isConnected) {renderCashier();}
            } catch (refreshError) {
                notify(`تم تعليق الطلب، لكن تعذّر تحديث القائمة: ${refreshError.message || 'خطأ غير معروف'}`, 'error');
            }
        } catch (e) {
            notify(`تعذّر تعليق الطلب: ${e.message || 'خطأ غير معروف'}`, 'error');
        } finally {
            busy = false;
        }
    }

    async function recallOrder(orderId) {
        if (!canSell || busy) {return;}
        if (cart.length && !(await (ctx.confirmFn || window.confirm)('السلة الحالية غير فارغة. استبدالها بالطلب المعلق؟'))) {return;}
        busy = true;
        try {
            const result = await recallPosHeldOrder(orderId, shiftId());
            if (!Array.isArray(result.items) || result.items.length === 0) {throw new Error('الطلب المحفوظ لا يحتوي أصنافًا صالحة');}
            cart = result.items.map((item) => ({
                id: Number(item.product_id),
                name: String(item.name || 'صنف'),
                price: number(item.unit_price),
                vatRate: number(item.vat_rate ?? 15),
                quantity: number(item.quantity),
            }));
            cartDiscount = result.cart_discount && ['percent', 'fixed'].includes(result.cart_discount.type)
                ? { type: result.cart_discount.type, value: String(result.cart_discount.value ?? '0') }
                : { type: '', value: '0' };
            payments = { cash: 0, card: 0, wallet: 0, bank_transfer: 0 };
            paymentReferences = { card: '', wallet: '', bank_transfer: '' };
            paymentsTouched = false;
            receipt = null;
            saleKey = '';
            heldOrders = heldOrders.filter((order) => String(order.id) !== String(orderId));
            renderCashier();
            notify('تم استرجاع الطلب المعلق.', 'success');
            try {
                heldOrders = await fetchPosHeldOrders(shiftId());
                if (el.isConnected) {renderCashier();}
            } catch (refreshError) {
                notify(`تم الاسترجاع، لكن تعذّر تحديث قائمة الطلبات المعلقة: ${refreshError.message || 'خطأ غير معروف'}`, 'error');
            }
        } catch (e) {
            notify(`تعذّر استرجاع الطلب: ${e.message || 'خطأ غير معروف'}`, 'error');
        } finally {
            busy = false;
        }
    }

    async function deleteHeldOrder(orderId) {
        if (!canSell || busy) {return;}
        const ok = await (ctx.confirmFn || window.confirm)('حذف الطلب المعلق نهائيًا؟');
        if (ok !== true) {return;}
        busy = true;
        try {
            await deletePosHeldOrder(orderId, shiftId());
            heldOrders = heldOrders.filter((order) => String(order.id) !== String(orderId));
            renderCashier();
            notify('تم حذف الطلب المعلق.', 'success');
            try {
                heldOrders = await fetchPosHeldOrders(shiftId());
                if (el.isConnected) {renderCashier();}
            } catch (refreshError) {
                notify(`تم الحذف، لكن تعذّر تحديث القائمة: ${refreshError.message || 'خطأ غير معروف'}`, 'error');
            }
        } catch (e) {
            notify(`تعذّر حذف الطلب: ${e.message || 'خطأ غير معروف'}`, 'error');
        } finally {
            busy = false;
        }
    }

    async function closeShift() {
        if (!activeShift || busy) {return;}
        busy = true;
        try {
            const summary = await fetchPosShiftSummary(activeShift.session_id || activeShift.id);
            if (!el.isConnected) {return;}
            const actual = window.prompt(`النقد المتوقع ${moneyText(summary.expected_cash)}. أدخل النقد الفعلي لإغلاق الوردية:`, String(summary.expected_cash));
            if (actual === null) {return;}
            const actualCash = parseMoneyInput(actual);
            if (!Number.isFinite(actualCash) || actualCash < 0) {notify('النقد الفعلي غير صالح؛ بقيت الوردية مفتوحة.', 'error'); return;}
            const notes = window.prompt('ملاحظات الإغلاق (اختياري):', '');
            if (notes === null) {return;}
            const ok = await (ctx.confirmFn || window.confirm)('سيغلق الخادم الوردية نهائيًا. هل تؤكد الإغلاق؟');
            if (ok !== true) {return;}
            const result = await closePosShift({ sessionId: activeShift.session_id || activeShift.id, actualCash, notes });
            activeShift = null;
            cart = [];
            cartDiscount = { type: '', value: '0' };
            receipt = null;
            saleKey = '';
            buffet = null;
            buffetLive = null;
            buffetReport = null;
            buffetReportInvoices = [];
            products = [];
            stopBuffetLiveTimer();
            renderOpenShift();
            notify(`أُغلقت الوردية. فرق النقد: ${moneyText(result.cash_variance)}.`, 'success');
        } catch (e) {
            notify(`تعذّر إغلاق الوردية: ${e.message || 'خطأ غير معروف'}`, 'error');
        } finally {
            busy = false;
        }
    }

    async function reprintOrder(orderId) {
        if (!SELL_ROLES.includes(role) || busy) {return;}
        busy = true;
        try {
            const result = await reprintPosOrder(orderId);
            notify(result.message || 'أُضيفت الفاتورة إلى طابور الطباعة.', 'success');
        } catch (error) {
            notify(`تعذرت إعادة الطباعة: ${error.message || 'خطأ غير معروف'}`, 'error');
        } finally {
            busy = false;
        }
    }

    async function voidOrder(orderId) {
        if (!ORDER_VOID_ROLES.includes(role) || busy) {return;}
        const ok = await (ctx.confirmFn || window.confirm)('سيؤدي ذلك إلى إلغاء الفاتورة وعكس المخزون والإيراد ورد المبلغ وفق بياناتها. هل تريد المتابعة؟');
        if (ok !== true) {return;}
        const reason = window.prompt('اكتب سبب إلغاء الفاتورة (مطلوب):', '');
        if (reason === null) {return;}
        if (!reason.trim() || reason.trim().length > 500) {
            notify('سبب الإلغاء مطلوب وبحد أقصى 500 حرف.', 'error');
            return;
        }
        busy = true;
        try {
            const result = await voidPosOrder(orderId, reason);
            notify(result.message || 'تم إلغاء الفاتورة.', 'success');
            await showOrderDetails(orderId);
        } catch (error) {
            notify(`تعذر إلغاء الفاتورة: ${error.message || 'خطأ غير معروف'}`, 'error');
        } finally {
            busy = false;
        }
    }

    el.addEventListener('click', (event) => {
        const target = event.target.closest('button');
        if (!target) {return;}
        if (target.matches('[data-pos-history]')) {openOrderHistory(); return;}
        if (target.matches('[data-pos-history-back]')) {closeOrderHistory(); return;}
        if (target.matches('[data-pos-history-retry]')) {loadOrderHistory(historyPage || 1); return;}
        if (target.matches('[data-pos-history-apply]')) {
            const dateFrom = q('[data-pos-history-from]')?.value || '';
            const dateTo = q('[data-pos-history-to]')?.value || '';
            if (dateFrom && dateTo && dateFrom > dateTo) {
                notify('تاريخ البداية يجب ألا يتجاوز تاريخ النهاية.', 'error');
                return;
            }
            historyFilters = {
                dateFrom,
                dateTo,
                status: q('[data-pos-history-status]')?.value || '',
                search: q('[data-pos-history-search-input]')?.value || '',
            };
            loadOrderHistory(1);
            return;
        }
        if (target.matches('[data-pos-history-page]')) {loadOrderHistory(Number(target.dataset.posHistoryPage)); return;}
        if (target.matches('[data-pos-history-print]')) {printOrderHistory(); return;}
        if (target.matches('[data-pos-order-detail]')) {showOrderDetails(target.dataset.posOrderDetail); return;}
        if (target.matches('[data-pos-history-list]')) {renderOrderHistory(); return;}
        if (target.matches('[data-pos-order-reprint]')) {reprintOrder(target.dataset.posOrderReprint); return;}
        if (target.matches('[data-pos-order-void]')) {voidOrder(target.dataset.posOrderVoid); return;}
        if (target.matches('[data-v2-reload], [data-erp-retry]')) {reload(); return;}
        if (target.matches('[data-pos-open]')) {openShift(); return;}
        if (target.matches('[data-buffet-prices]')) {openBuffetPrices(); return;}
        if (target.matches('[data-buffet-report]')) {openBuffetReport(); return;}
        if (target.matches('[data-buffet-back]')) {closeOrderHistory(); return;}
        if (target.matches('[data-buffet-save-prices]')) {saveBuffetPricesFromPanel(); return;}
        if (target.matches('[data-buffet-add-tier]')) {addBuffetTierFromPanel(); return;}
        if (target.matches('[data-buffet-tier-toggle]')) {toggleBuffetTier(target.dataset.buffetTierToggle); return;}
        if (target.matches('[data-buffet-report-run]')) {loadBuffetReport(); return;}
        if (target.matches('[data-buffet-report-print]')) {
            const date = q('[data-buffet-report-date]')?.value;
            if (!buffetReport || (date && date !== buffetReport.date)) {
                void loadBuffetReport().then(() => {if (buffetReport) {printBuffetReport();}});
                return;
            }
            printBuffetReport();
            return;
        }
        if (target.matches('[data-pos-kot]')) {openKotTickets(target.dataset.posKot, target.dataset.posKotCounter); return;}
        if (target.matches('[data-pos-day-close]')) {runDayClose(); return;}
        if (target.matches('[data-pos-category]')) {
            selectedCategory = target.dataset.posCategory || '';
            renderCashier();
            return;
        }
        if (target.matches('[data-pos-add]')) {
            const p = products.find((item) => Number(item.id) === Number(target.dataset.posAdd));
            if (!p) {notify('الصنف غير موجود في القائمة الحالية.', 'error'); return;}
            addProduct(p);
            return;
        }
        if (target.matches('[data-pos-image]')) {
            if (!canManageCatalog || busy || imageUploadPending) {return;}
            imageProductId = target.dataset.posImage;
            q('[data-pos-image-input]')?.click();
            return;
        }
        if (target.matches('[data-pos-qty]')) {changeQuantity(target.dataset.posQty, target.dataset.delta); return;}
        if (target.matches('[data-pos-clear]')) {
            cart = [];
            cartDiscount = { type: '', value: '0' };
            payments = { cash: 0, card: 0, wallet: 0, bank_transfer: 0 };
            paymentReferences = { card: '', wallet: '', bank_transfer: '' };
            paymentsTouched = false;
            receipt = null; saleKey = ''; renderCashier(); return;
        }
        if (target.matches('[data-pos-complete]')) {completeSale(); return;}
        if (target.matches('[data-pos-hold]')) {holdOrder(); return;}
        if (target.matches('[data-pos-recall]')) {recallOrder(target.dataset.posRecall); return;}
        if (target.matches('[data-pos-held-delete]')) {deleteHeldOrder(target.dataset.posHeldDelete); return;}
        if (target.matches('[data-pos-close]')) {closeShift(); return;}
        if (target.matches('[data-pos-print]')) {
            document.body.classList.add('erp-pos-v2-printing');
            window.addEventListener('afterprint', () => document.body.classList.remove('erp-pos-v2-printing'), { once: true });
            window.print();
        }
    });
    el.addEventListener('input', (event) => {
        if (event.target.matches('[data-pos-search]')) {search = event.target.value; renderCashier(); const input = q('[data-pos-search]'); input?.focus(); input?.setSelectionRange(search.length, search.length);}
        if (event.target.matches('[data-pos-discount-value]')) {
            cartDiscount.value = event.target.value;
            saleKey = '';
            renderCashier();
            const input = q('[data-pos-discount-value]');
            input?.focus();
            input?.setSelectionRange(input.value.length, input.value.length);
        }
        if (event.target.matches('[data-pos-payment]')) {
            payments[event.target.dataset.posPayment] = parseMoneyInput(event.target.value);
            paymentsTouched = true;
            saleKey = '';
            updatePaymentState();
        }
        if (event.target.matches('[data-pos-reference]')) {
            paymentReferences[event.target.dataset.posReference] = event.target.value;
            saleKey = '';
        }
    });
    el.addEventListener('change', (event) => {
        if (event.target.matches('[data-pos-image-input]')) {
            uploadSelectedProductImage();
            return;
        }
        if (event.target.matches('[data-pos-discount-type]')) {
            cartDiscount.type = event.target.value;
            saleKey = '';
            renderCashier();
        }
    });
    el.addEventListener('keydown', (event) => {
        if (!event.target.matches('[data-pos-search]') || event.key !== 'Enter') {return;}
        const match = matchPosBarcode(products, event.target.value);
        if (match.status === 'ambiguous') {
            event.preventDefault();
            notify('الباركود مرتبط بأكثر من صنف؛ راجع بيانات الأصناف قبل البيع.', 'error');
            return;
        }
        if (match.status !== 'matched') {return;}
        event.preventDefault();
        search = '';
        addProduct(match.product);
        q('[data-pos-search]')?.focus();
    });

    async function reloadWithCurrency() {
        try {currency = String(await fetchCurrency() || '');}
        catch (error) {
            currency = '';
            notify(`وحدة العملة غير متاحة — ستُعرض المبالغ بلا وحدة: ${error.message || 'تعذّر قراءة الإعدادات'}`, 'error');
        }
        await reload();
    }

    void bindCatalogRealtime();
    reloadWithCurrency();
    return {
        el,
        reload: reloadWithCurrency,
        destroy() {
            if (catalogSocket) {catalogSocket.off('entity_changed', onCatalogChanged);}
            stopBuffetLiveTimer();
            el.remove();
        },
    };
}
