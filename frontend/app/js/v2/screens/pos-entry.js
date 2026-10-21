/**
 * V2 — cashier entry and embedded POS.
 * Embedded checkout follows the host feature flag. The standalone POS stays
 * available as the fallback at all times.
 */
import { fetchOpenShifts } from '../data/cfo-repo.js?v=4.9.181';
import { formatInt, formatMoney, fetchCurrency } from '../data/reports-repo.js?v=4.9.181';
import {
    closePosShift, completePosSale, deletePosHeldOrder, fetchActivePosShift, fetchPosDepartments,
    fetchPosHeldOrders, fetchPosOrderDetails, fetchPosOrders, fetchPosProducts, fetchPosShiftSummary, holdPosOrder,
    openPosShift, recallPosHeldOrder, reprintPosOrder, voidPosOrder,
} from '../data/pos-v2-repo.js?v=4.9.181';
import { matchPosBarcode } from '../data/pos-barcode.js?v=4.9.181';
import { buildPosSaleItems, calculatePosTotals } from '../data/pos-pricing.js?v=4.9.181';
import { uploadProductImage } from '../data/recipes-edit-repo.js?v=4.9.181';
import { ensureRealtimeSocket } from '../realtime.js?v=4.9.181';
import { ensureQrCode } from '../vendor.js?v=4.9.181';

const esc = (v) => String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const POS_ROLES = ['admin', 'manager', 'accountant', 'cashier'];
const SELL_ROLES = ['admin', 'manager', 'cashier'];
const INVOICE_HISTORY_ROLES = ['admin', 'manager', 'accountant'];
const ORDER_VOID_ROLES = ['admin', 'manager'];
const CATALOG_IMAGE_ROLES = ['admin', 'manager'];
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
                const latest = await fetchPosProducts(activeShift.department_id);
                if (!el.isConnected) {return;}
                products = latest;
                renderCashier();
                notify('تم تحديث أصناف الوصفات في الكاشير.', 'info');
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
          ${rows.length ? `<div class="erp-table__scroll"><table class="erp-table__grid">
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
          <div class="erp-table__scroll"><table class="erp-table__grid">
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
          </div>
          <h4>وسائل الدفع</h4>
          ${paymentsList.length ? `<div class="erp-table__scroll"><table class="erp-table__grid">
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

    function renderCashier() {
        if (!activeShift) {return renderOpenShift();}
        const t = totals();
        const categories = [...new Set(products.map((p) => String(p.category || '').trim()).filter(Boolean))]
            .sort((a, b) => a.localeCompare(b, 'ar'));
        const filtered = products.filter((p) => {
            const categoryMatch = !selectedCategory || String(p.category || '').trim() === selectedCategory;
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
            <div class="erp-pos-v2-heading"><div><h3 class="erp-card__title">${esc(activeShift.dept_name || 'نقطة البيع')}</h3>
            <span class="erp-text-sm erp-text-muted">وردية #${esc(activeShift.id || activeShift.session_id)}</span></div>
            <button type="button" class="erp-btn erp-btn--sm" data-pos-close ${canSell ? '' : 'disabled'}>إغلاق الوردية</button></div>
            <label class="erp-pos-v2-search">بحث الأصناف<input class="erp-input" data-pos-search type="search" value="${esc(search)}" placeholder="اسم الصنف أو الباركود" autocomplete="off"></label>
            <div class="erp-pos-v2-categories" role="group" aria-label="تصنيف الأصناف">
              <button type="button" class="erp-pos-v2-category${selectedCategory ? '' : ' is-active'}" data-pos-category="" aria-pressed="${selectedCategory ? 'false' : 'true'}">الكل</button>
              ${categories.map((category) => `<button type="button" class="erp-pos-v2-category${selectedCategory === category ? ' is-active' : ''}" data-pos-category="${esc(category)}" aria-pressed="${selectedCategory === category ? 'true' : 'false'}">${esc(category)}</button>`).join('')}
            </div>
            <div class="erp-pos-v2-products">${filtered.length ? filtered.map((p) => {
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
            }).join('') : '<p class="erp-text-sm erp-text-muted">لا توجد أصناف مطابقة.</p>'}</div>
            ${canManageCatalog ? '<input class="erp-pos-v2-image-input" data-pos-image-input type="file" accept="image/jpeg,image/png,image/webp" hidden>' : ''}
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
              <div><strong>${esc(row.name)}</strong><small>${money(row.price)} × ${row.quantity}</small></div>
              <div class="erp-pos-v2-qty"><button type="button" data-pos-qty="${row.id}" data-delta="-1" aria-label="تقليل">−</button><span>${row.quantity}</span><button type="button" data-pos-qty="${row.id}" data-delta="1" aria-label="زيادة">+</button></div>
            </div>`).join('') : '<p class="erp-text-sm erp-text-muted">السلة فارغة — اختر صنفًا للبدء.</p>'}</div>
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
            ${receipt.order_id ? `<button type="button" class="erp-btn erp-btn--sm" data-pos-order-reprint="${esc(receipt.order_id)}">إعادة طباعة الإيصال</button>` : ''}
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
                    ? `<div class="erp-table__scroll"><table class="erp-table__grid"><caption class="erp-sr-only">الورديات المفتوحة</caption><thead><tr><th scope="col">وردية</th><th scope="col">الكاشير</th><th scope="col">القسم</th><th scope="col">اليوم</th><th scope="col">العهدة</th><th scope="col">المتوقع</th><th scope="col">الحركة</th></tr></thead><tbody>`
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
                    products = await fetchPosProducts(activeShift.department_id);
                    try {heldOrders = await fetchPosHeldOrders(shiftId());}
                    catch (heldError) {
                        heldOrders = [];
                        heldLoadError = `تعذّر تحميل الطلبات المعلقة: ${heldError.message || 'خطأ غير معروف'}`;
                    }
                }
            } catch (e) {
                if (e.code !== 'NO_OPEN_SHIFT') {throw e;}
                activeShift = null;
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
            cart = [];
            receipt = null;
            payments = { cash: 0, card: 0, wallet: 0, bank_transfer: 0 };
            paymentsTouched = false;
            try {
                products = await fetchPosProducts(departmentId);
            } catch (productError) {
                products = [];
                renderCashier();
                notify(`تم فتح الوردية، لكن تعذّر تحميل الأصناف: ${productError.message || 'خطأ غير معروف'}`, 'error');
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
                products = await fetchPosProducts(activeShift.department_id);
                if (el.isConnected) {renderCashier();}
            } catch (refreshError) {
                notify(`تم البيع بنجاح، لكن تعذّر تحديث قائمة الأصناف: ${refreshError.message || 'خطأ غير معروف'}`, 'error');
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
        if (target.matches('[data-pos-order-detail]')) {showOrderDetails(target.dataset.posOrderDetail); return;}
        if (target.matches('[data-pos-history-list]')) {renderOrderHistory(); return;}
        if (target.matches('[data-pos-order-reprint]')) {reprintOrder(target.dataset.posOrderReprint); return;}
        if (target.matches('[data-pos-order-void]')) {voidOrder(target.dataset.posOrderVoid); return;}
        if (target.matches('[data-v2-reload], [data-erp-retry]')) {reload(); return;}
        if (target.matches('[data-pos-open]')) {openShift(); return;}
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
            el.remove();
        },
    };
}
