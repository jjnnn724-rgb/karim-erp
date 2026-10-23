/**
 * V2 — محرر فاتورة الشراء (إنشاء/تعديل)
 * ═══════════════════════════════════════════════════════════════════════
 *
 * النقل الأمين لنافذة `showAddPurchaseInvoiceModal` و`savePurchaseInvoice`
 * في `features/warehouse.js:1532-1779`: نفس الحقول والترتيب والرسائل، ونفس
 * قواعد «مسدد تلقائي» (نقدي/بنكي = الشامل، آجل = صفر) وحكم جديد/محدَّث على
 * النافذة المحمّلة. العنوان «فاتورة مشتريات جديدة» في الوضعين كما القديم
 * حرفيًا (features/warehouse.js:1554)؛ زر الحفظ وحده يقول «حفظ التعديلات».
 * الكتابة تمر ببوابتَي POST/PUT في
 * `data/purchase-invoices-write-repo.js` وحدها؛ والخادم يعيد حساب الخصم
 * والضريبة وحالة السداد، فهو المرجع عند الحفظ.
 *
 * البحث الذكي منقول عن `features/smart-item-search.js` بمفتاح التفضيل نفسه
 * (`karim_smart_search_v1`): مغلق افتراضيًا، وعند فتحه يستبدل datalist
 * بقائمة مطابقة عربية متسامحة مع ↑↓/Enter/Esc، ويعبّئ الوحدة والسعر
 * والوزن عند الاختيار — كما القديم.
 *
 * تاريخ الصلاحية (سياسة المالك 2026-10-20): حقل اختياري لكل سطر يدخل المخزن؛
 * المحرر يمنع الإرسال عند الصيغة الفاسدة فقط عبر `data/expiry-policy.js`،
 * والخادم يرفض 422 INVALID_EXPIRY_DATE على أي حال.
 */

import { formatMoney } from './data/reports-repo.js?v=4.9.131';
import {
    createPurchaseInvoice, updatePurchaseInvoice,
    invoiceFormFromRow,
    isDuplicateInvoiceError, TAX_CATEGORIES,
} from './data/purchase-invoices-write-repo.js?v=4.9.131';
import { checkExpiryOnLines, normalizeExpiryDate } from './data/expiry-policy.js?v=4.9.131';
import {
    rankItemMatches, normalizeItemText, smartSearchEnabled, setSmartSearchEnabled,
} from './item-search.js?v=4.9.131';

const esc = (v) => String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const UNIT_OPTIONS = ['وحدة', 'كجم', 'كيلوجرام', 'جرام', 'شوال', 'كيس', 'علبة', 'كرتون', 'عبوة', 'لتر'];
const TAX_LABELS = {
    STANDARD: 'خاضع 15%',
    ZERO_RATED: 'صفري 0%',
    EXEMPT: 'معفى',
    OUT_OF_SCOPE: 'خارج النطاق',
};

const num = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
};
const r2 = (v) => Math.round((num(v) + Number.EPSILON) * 100) / 100;
const fmtPlain = (v) => num(v).toLocaleString('en-US', { maximumFractionDigits: 2 });
const escRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function isoToday() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function moneyText(v, currency) {
    const m = formatMoney(v, currency);
    return m.hasUnit ? `${m.amount} ${m.unit}` : m.amount;
}

function supplierRegistered(sup) {
    return !!sup && String(sup.tax_registration_status || sup.tax_status || '').toUpperCase() === 'REGISTERED';
}

function newItem() {
    return {
        itemId: null, itemName: '', qty: 1, price: 0, unit: 'وحدة',
        weight: '', taxCategory: 'STANDARD', packagingQty: null, packagingUom: null,
        expiryDate: '',
    };
}

function normalizeItem(item) {
    return {
        itemId: item && item.itemId !== undefined ? item.itemId : null,
        itemName: item && item.itemName ? String(item.itemName) : '',
        qty: num(item && item.qty),
        price: num(item && item.price),
        unit: (item && item.unit) ? String(item.unit) : 'وحدة',
        weight: item && item.weight !== undefined && item.weight !== null ? item.weight : '',
        taxCategory: item && TAX_CATEGORIES.includes(String(item.taxCategory))
            ? String(item.taxCategory) : 'STANDARD',
        packagingQty: item && item.packagingQty !== undefined ? item.packagingQty : null,
        packagingUom: item && item.packagingUom ? item.packagingUom : null,
        expiryDate: item && item.expiryDate ? String(item.expiryDate).slice(0, 10) : '',
    };
}

/**
 * @param {HTMLElement} host حاوية المحرر (فارغة)
 * @param {{
 *   invoice?: object|null, inventory?: object[], suppliers?: object[],
 *   currency?: string, notify?: Function, onSaved?: Function, onCancel?: Function
 * }} options
 */
export function mountPurchaseInvoiceEditor(host, options = {}) {
    const inventory = Array.isArray(options.inventory) ? options.inventory : [];
    const suppliers = Array.isArray(options.suppliers) ? options.suppliers : [];
    const currency = String(options.currency ?? '');
    const notify = typeof options.notify === 'function' ? options.notify : () => {};
    const editing = !!(options.invoice && options.invoice.id !== undefined);
    const initial = editing ? invoiceFormFromRow(options.invoice) : {
        invoiceNumber: '', date: isoToday(), supplierId: '', supplierName: '',
        supplierPhone: '', paymentMethod: 'cash', notes: '', discountType: 'none',
        discountValue: 0, paidAmount: 0, items: [],
    };

    const rows = (Array.isArray(initial.items) ? initial.items : []).map(normalizeItem);
    let paidTouched = editing;
    let smartOn = smartSearchEnabled();
    let saving = false;
    let expiryChecked = false;
    let activeIdx = -1;
    let results = [];
    let highlight = -1;
    let highlightExplicit = false;

    const currentSupplierId = initial.supplierId === undefined || initial.supplierId === null
        ? '' : String(initial.supplierId);
    const supplierOptions = suppliers.filter((s) => s
        && (s.is_active || String(s.id) === currentSupplierId));
    const inventoryOptions = inventory.map((item) => `<option value="${esc(item.name)}">`
        + `${esc(item.name)} (${esc(item.unit || 'وحدة')}) — ${esc(fmtPlain(item.avgCost))} ${esc(currency)}</option>`).join('');

    host.insertAdjacentHTML('beforeend', `
      <section class="erp-card erp-vi" data-vi-editor aria-labelledby="erp-vi-title">
        <div class="erp-card__head">
          <h4 class="erp-card__title" id="erp-vi-title">
            <i class="ji" data-i="file-text" aria-hidden="true"></i>
            فاتورة مشتريات جديدة
          </h4>
          <span class="erp-grow"></span>
          <button type="button" class="erp-btn erp-btn--sm" data-vi-cancel aria-label="إغلاق نموذج الفاتورة">
            <i class="ji" data-i="x" aria-hidden="true"></i><span>إغلاق</span>
          </button>
        </div>
        <div class="erp-card__body erp-stack">
          <p class="erp-text-sm erp-text-muted">
            الخادم يعيد حساب الخصم والضريبة وحالة السداد عند الحفظ، ويطابق
            الأصناف بتطبيع الاسم. الأصناف غير الموجودة تُنشأ برصيد صفر ثم
            يضيفها استلام الفاتورة.
          </p>
          <div class="erp-vi-grid">
            <label class="erp-field">
              <span class="erp-label">رقم الفاتورة</span>
              <input class="erp-input" data-vi-field="invoiceNumber" placeholder="INV-001" value="${esc(initial.invoiceNumber)}">
            </label>
            <label class="erp-field">
              <span class="erp-label">تاريخ الفاتورة</span>
              <input class="erp-input erp-input--ltr" data-vi-field="date" type="date" value="${esc(initial.date || isoToday())}">
            </label>
          </div>
          <div class="erp-vi-grid">
            <label class="erp-field">
              <span class="erp-label">المورد <small class="erp-text-muted">(اختياري — يربط الفاتورة بالحساب)</small></span>
              <select class="erp-select" data-vi-field="supplierId">
                <option value="">بدون ربط (اسم حر)</option>
                ${supplierOptions.map((s) => `<option value="${esc(s.id)}"${String(s.id) === currentSupplierId ? ' selected' : ''}>${esc(s.name)}</option>`).join('')}
              </select>
            </label>
            <label class="erp-field erp-vi-free" data-vi-free-name>
              <span class="erp-label">اسم المورد</span>
              <input class="erp-input" data-vi-field="supplierName" value="${esc(initial.supplierName)}">
            </label>
            <label class="erp-field erp-vi-free" data-vi-free-phone>
              <span class="erp-label">رقم الهاتف</span>
              <input class="erp-input erp-input--ltr" data-vi-field="supplierPhone" value="${esc(initial.supplierPhone)}">
            </label>
          </div>
          <div class="erp-vi-supplier-hint" data-vi-supplier-hint aria-live="polite"></div>
          <div class="erp-vi-section">
            <div class="erp-vi-items-head">
              <strong><i class="ji" data-i="package" aria-hidden="true"></i> الأصناف</strong>
              <span class="erp-grow"></span>
              <button type="button" class="erp-vi-smart${smartOn ? ' is-on' : ''}" data-vi-smart aria-pressed="${smartOn}">
                بحث ذكي ⚡<span class="erp-vi-dot"></span>
              </button>
            </div>
            <div class="erp-stack" data-vi-items></div>
            <div>
              <button type="button" class="erp-btn erp-btn--sm erp-btn--primary" data-vi-add>
                <i class="ji" data-i="plus" aria-hidden="true"></i><span>إضافة صنف</span>
              </button>
            </div>
            <div class="erp-text-sm erp-text-muted">
              الوحدة مرنة ويمكن كتابتها مثل: كجم، شوال، علبة أو كرتون.
              الوزن الإجمالي اختياري بالكيلوجرام.
              <strong class="erp-vi-expiry-hint">تاريخ الصلاحية اختياري، وإن أُدخل فيجب أن يكون بصيغة YYYY-MM-DD.</strong>
            </div>
            <datalist id="erp-vi-units">
              ${UNIT_OPTIONS.map((u) => `<option value="${esc(u)}"></option>`).join('')}
            </datalist>
            <datalist id="erp-vi-inventory">${inventoryOptions}</datalist>
          </div>
          <div class="erp-vi-grid">
            <div class="erp-field">
              <span class="erp-label">خصم الفاتورة</span>
              <div class="erp-vi-discount">
                <select class="erp-select" data-vi-field="discountType">
                  <option value="none"${initial.discountType === 'none' ? ' selected' : ''}>بدون خصم</option>
                  <option value="percent"${initial.discountType === 'percent' ? ' selected' : ''}>نسبة مئوية %</option>
                  <option value="amount"${initial.discountType === 'amount' ? ' selected' : ''}>مبلغ ثابت</option>
                </select>
                <input class="erp-input erp-input--ltr" data-vi-field="discountValue" type="number" min="0" step="0.01" value="${esc(initial.discountValue)}" placeholder="قيمة الخصم">
              </div>
              <small class="erp-text-muted" data-vi-discount-hint aria-live="polite"></small>
            </div>
            <label class="erp-field">
              <span class="erp-label">إجمالي الفاتورة <small class="erp-text-muted">(محسوب تلقائيًا)</small></span>
              <input class="erp-input erp-input--ltr erp-vi-total" data-vi-total type="number" readonly aria-readonly="true" title="يُحسب تلقائيًا من كمية وسعر كل صنف">
              <small class="erp-text-muted" data-vi-vat-hint aria-live="polite"></small>
            </label>
            <label class="erp-field">
              <span class="erp-label">طريقة الدفع</span>
              <select class="erp-select" data-vi-field="paymentMethod">
                <option value="cash"${initial.paymentMethod === 'cash' ? ' selected' : ''}>نقدي (مسدد)</option>
                <option value="bank"${initial.paymentMethod === 'bank' ? ' selected' : ''}>تحويل بنكي (مسدد)</option>
                <option value="credit"${initial.paymentMethod === 'credit' ? ' selected' : ''}>آجل (غير مسدد)</option>
                <option value="card"${initial.paymentMethod === 'card' ? ' selected' : ''}>بطاقة</option>
                <option value="cheque"${initial.paymentMethod === 'cheque' ? ' selected' : ''}>شيك</option>
              </select>
            </label>
          </div>
          <div class="erp-vi-grid">
            <label class="erp-field">
              <span class="erp-label">المسدد الآن</span>
              <input class="erp-input erp-input--ltr" data-vi-field="paidAmount" type="number" step="0.01" min="0" value="${editing ? num(initial.paidAmount).toFixed(2) : '0.00'}">
              <small class="erp-text-muted">تلقائي = الشامل (نقدي) أو 0 (آجل) — يقبل الكسور حتى هللتين</small>
            </label>
            <div class="erp-field">
              <span class="erp-label">حالة السداد المتوقعة</span>
              <div data-vi-status-preview aria-live="polite"></div>
            </div>
          </div>
          <label class="erp-field">
            <span class="erp-label">ملاحظات</span>
            <textarea class="erp-input" data-vi-field="notes" rows="2">${esc(initial.notes)}</textarea>
          </label>
          <div class="erp-vi-actions">
            <button type="button" class="erp-btn erp-btn--sm" data-vi-cancel-secondary>إلغاء</button>
            <button type="button" class="erp-btn erp-btn--sm erp-btn--primary" data-vi-save>
              <i class="ji" data-i="save" aria-hidden="true"></i>
              <span>${editing ? 'حفظ التعديلات' : 'حفظ الفاتورة'}</span>
            </button>
          </div>
        </div>
      </section>`);
    const el = host.lastElementChild;
    const q = (sel) => el.querySelector(sel);
    const field = (name) => {
        const node = q(`[data-vi-field="${name}"]`);
        return node ? String(node.value ?? '') : '';
    };
    const itemsBox = q('[data-vi-items]');
    const saveBtn = q('[data-vi-save]');

    function findSupplier() {
        const id = field('supplierId');
        return id ? suppliers.find((s) => String(s.id) === String(id)) : null;
    }

    function exactInventory(name) {
        const value = String(name || '');
        if (!value) {return null;}
        return inventory.find((item) => String(item.name) === value) || null;
    }

    function taxOptions(value) {
        const picked = TAX_CATEGORIES.includes(String(value)) ? String(value) : 'STANDARD';
        return TAX_CATEGORIES.map((key) => `<option value="${key}"${key === picked ? ' selected' : ''}>${TAX_LABELS[key]}</option>`).join('');
    }

    function markName(name, query) {
        let html = esc(name);
        for (const token of normalizeItemText(query).split(' ').filter(Boolean)) {
            try {
                html = html.replace(new RegExp(`(${escRegex(token)})`, 'gi'), '<mark>$1</mark>');
            } catch {
                // رمز لا يصلح لنمط — الاسم يبقى بلا تظليل.
            }
        }
        return html;
    }

    function rowTemplate(item, idx) {
        const total = r2(num(item.qty) * num(item.price));
        const smartAttrs = smartOn
            ? ` role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="erp-vi-dd-${idx}"`
            : ' list="erp-vi-inventory"';
        return `<div class="erp-vi-row" data-vi-row="${idx}">
          <label class="erp-field erp-vi-name">
            <span class="erp-label">الصنف</span>
            <input class="erp-input" data-vi-item="name" data-idx="${idx}" value="${esc(item.itemName)}" placeholder="ابحث عن صنف..." autocomplete="off"${smartAttrs}>
            <div class="erp-vi-dd" id="erp-vi-dd-${idx}" data-vi-dd="${idx}" role="listbox" hidden></div>
          </label>
          <label class="erp-field erp-vi-qty">
            <span class="erp-label">الكمية</span>
            <input class="erp-input erp-input--ltr" data-vi-item="qty" data-idx="${idx}" type="number" step="0.001" min="0" value="${esc(item.qty)}" placeholder="الكمية">
          </label>
          <label class="erp-field erp-vi-unit">
            <span class="erp-label">الوحدة</span>
            <input class="erp-input" data-vi-item="unit" data-idx="${idx}" value="${esc(item.unit || 'وحدة')}" list="erp-vi-units" placeholder="كجم / شوال / علبة">
          </label>
          <label class="erp-field erp-vi-weight">
            <span class="erp-label">الوزن (كجم)</span>
            <input class="erp-input erp-input--ltr" data-vi-item="weight" data-idx="${idx}" type="number" min="0" step="0.001" value="${esc(item.weight)}" placeholder="اختياري">
          </label>
          <label class="erp-field erp-vi-expiry" data-vi-expiry="${idx}">
            <span class="erp-label">تاريخ الصلاحية</span>
            <input class="erp-input erp-input--ltr" data-vi-item="expiryDate" data-idx="${idx}" type="date" value="${esc(item.expiryDate)}" aria-required="false" aria-label="تاريخ الصلاحية للصنف ${idx + 1}" title="اختياري — YYYY-MM-DD">
          </label>
          <label class="erp-field erp-vi-price">
            <span class="erp-label">سعر الوحدة</span>
            <input class="erp-input erp-input--ltr" data-vi-item="price" data-idx="${idx}" type="number" min="0" step="0.01" value="${esc(item.price)}" placeholder="السعر">
          </label>
          <label class="erp-field erp-vi-tax">
            <span class="erp-label">الفئة الضريبية</span>
            <select class="erp-select" data-vi-item="taxCategory" data-idx="${idx}" aria-label="الفئة الضريبية للصنف">${taxOptions(item.taxCategory)}</select>
          </label>
          <div class="erp-vi-line-total">
            <span>الإجمالي</span>
            <strong data-vi-line-total="${idx}">${esc(moneyText(total, currency))}</strong>
          </div>
          <button type="button" class="erp-btn erp-btn--sm erp-btn--danger erp-vi-remove" data-vi-remove="${idx}" aria-label="حذف الصنف ${idx + 1}">
            <i class="ji" data-i="x" aria-hidden="true"></i>
          </button>
        </div>`;
    }

    function paintItems() {
        hideSearch();
        if (!rows.length) {
            itemsBox.innerHTML = `<div class="erp-vi-empty">
              <i class="ji" data-i="package" aria-hidden="true"></i>
              أضف صنفاً بالنقر على زر "إضافة صنف"
            </div>`;
        } else {
            itemsBox.innerHTML = rows.map((item, idx) => rowTemplate(item, idx)).join('');
        }
        paintTotals();
        paintExpiryMarks();
    }

    /** الصيغة الفاسدة تُعلَّم بعد محاولة الحفظ فقط — الغياب مقبول (اختياري). */
    function paintExpiryMarks() {
        rows.forEach((item, idx) => {
            const wrap = q(`[data-vi-expiry="${idx}"]`);
            if (!wrap) {return;}
            const raw = String(item.expiryDate ?? '').trim();
            const bad = expiryChecked && raw !== '' && !normalizeExpiryDate(item.expiryDate);
            wrap.classList.toggle('is-missing', bad);
            const input = wrap.querySelector('[data-vi-item="expiryDate"]');
            if (input) {input.setAttribute('aria-invalid', bad ? 'true' : 'false');}
        });
    }

    function discountAmountOf(subtotal) {
        const type = field('discountType') || 'none';
        const value = num(field('discountValue'));
        if (type === 'percent') {return r2(subtotal * Math.min(Math.max(value, 0), 100) / 100);}
        if (type === 'amount') {return Math.min(subtotal, r2(Math.max(value, 0)));}
        return 0;
    }

    /** مرآة حساب القديم `pcmtGrandEstimate` — الخادم يعيد الحساب عند الحفظ. */
    function estimate() {
        const selected = findSupplier();
        const registered = supplierRegistered(selected);
        const grossLines = rows.map((item) => r2(num(item.qty) * num(item.price)));
        const subtotal = r2(grossLines.reduce((sum, value) => sum + value, 0));
        const discount = discountAmountOf(subtotal);
        let allocated = 0;
        let net = 0;
        let vat = 0;
        grossLines.forEach((gross, index) => {
            const lineDiscount = index === grossLines.length - 1
                ? r2(discount - allocated)
                : (subtotal > 0 ? r2(discount * gross / subtotal) : 0);
            allocated = r2(allocated + lineDiscount);
            const lineNet = r2(gross - lineDiscount);
            net = r2(net + lineNet);
            const category = String(rows[index].taxCategory || 'STANDARD').toUpperCase();
            const rate = (registered && category === 'STANDARD') ? 15 : 0;
            vat = r2(vat + r2(lineNet * rate / 100));
        });
        return { subtotal, discount, net, vat, grand: r2(net + vat), registered, selected };
    }

    function paintVatHint(est) {
        const hint = q('[data-vi-vat-hint]');
        if (!hint) {return;}
        if (est.registered && est.vat > 0) {
            hint.innerHTML = `شامل الضريبة تلقائيًا: صافي ${esc(moneyText(est.net, currency))} + ضريبة 15% (${esc(moneyText(est.vat, currency))}) = شامل ${esc(moneyText(est.grand, currency))} — يُحسم عند الحفظ`;
        } else if (est.registered) {
            hint.textContent = 'المورد مسجل — لا ضريبة على هذه الأصناف (معفاة/صفرية)';
        } else {
            hint.textContent = est.selected
                ? 'المورد غير مسجل/معفى — لا ضريبة متوقعة'
                : 'بدون ربط مورد — لا ضريبة متوقعة';
        }
    }

    function paintStatus(total) {
        const preview = q('[data-vi-status-preview]');
        if (!preview) {return;}
        const paid = Math.min(Math.max(num(field('paidAmount')), 0), total);
        let tone = 'danger';
        let label = 'غير مسددة';
        if (total <= 0 || paid >= total) {
            tone = 'success';
            label = 'مدفوعة';
        } else if (paid > 0) {
            tone = 'warning';
            label = `مسددة جزئياً — متبقٍ ${formatMoney(total - paid, currency).amount}`;
        }
        preview.innerHTML = `<span class="erp-badge" data-tone="${tone}">${esc(label)}</span>`;
    }

    function paintTotals() {
        const est = estimate();
        const totalEl = q('[data-vi-total]');
        if (totalEl) {totalEl.value = est.grand.toFixed(2);}
        rows.forEach((item, idx) => {
            const cell = q(`[data-vi-line-total="${idx}"]`);
            if (cell) {cell.textContent = moneyText(r2(num(item.qty) * num(item.price)), currency);}
        });
        const discountHint = q('[data-vi-discount-hint]');
        if (discountHint) {
            discountHint.textContent = `قبل الخصم ${moneyText(est.subtotal, currency)} · الخصم ${moneyText(est.discount, currency)}`;
        }
        paintVatHint(est);
        if (!paidTouched) {
            const paidEl = q('[data-vi-field="paidAmount"]');
            if (paidEl) {paidEl.value = field('paymentMethod') === 'credit' ? '0' : est.grand.toFixed(2);}
        }
        paintStatus(est.grand);
    }

    function toggleFreeFields() {
        const linked = !!field('supplierId');
        const nameWrap = q('[data-vi-free-name]');
        const phoneWrap = q('[data-vi-free-phone]');
        if (nameWrap) {nameWrap.hidden = linked;}
        if (phoneWrap) {phoneWrap.hidden = linked;}
    }

    function paintSupplierHint() {
        const hint = q('[data-vi-supplier-hint]');
        if (!hint) {return;}
        hint.innerHTML = '';
        if (field('supplierId')) {return;}
        const typed = field('supplierName').trim().toLowerCase();
        if (!typed) {return;}
        const match = suppliers.find((s) => s && s.is_active
            && String(s.name || '').trim().toLowerCase() === typed
            && supplierRegistered(s));
        if (!match) {return;}
        hint.innerHTML = `«${esc(match.name)}» مسجل ضريبيًا (15%) — `
            + `<button type="button" class="erp-btn erp-btn--sm erp-btn--primary" data-vi-link-supplier="${esc(match.id)}">اربط لتطبيق الضريبة</button>`;
    }

    function hideSearch() {
        el.querySelectorAll('[data-vi-dd]').forEach((dd) => {
            dd.hidden = true;
            dd.innerHTML = '';
        });
        const active = activeIdx >= 0 ? q(`[data-vi-item="name"][data-idx="${activeIdx}"]`) : null;
        if (active) {active.setAttribute('aria-expanded', 'false'); active.removeAttribute('aria-activedescendant');}
        activeIdx = -1;
        results = [];
        highlight = -1;
        highlightExplicit = false;
    }

    function paintHighlight() {
        const dd = activeIdx >= 0 ? q(`[data-vi-dd="${activeIdx}"]`) : null;
        const input = activeIdx >= 0 ? q(`[data-vi-item="name"][data-idx="${activeIdx}"]`) : null;
        if (!dd || !input) {return;}
        dd.querySelectorAll('[data-vi-pick]').forEach((row, i) => {
            row.classList.toggle('is-active', i === highlight);
            row.setAttribute('aria-selected', i === highlight ? 'true' : 'false');
            if (i === highlight) {
                input.setAttribute('aria-activedescendant', row.id);
                row.scrollIntoView({ block: 'nearest' });
            }
        });
    }

    function paintSearch(idx) {
        const input = q(`[data-vi-item="name"][data-idx="${idx}"]`);
        const dd = q(`[data-vi-dd="${idx}"]`);
        if (!input || !dd) {return;}
        const query = input.value.trim();
        if (!query) {hideSearch(); return;}
        const wasActive = activeIdx;
        if (wasActive >= 0 && wasActive !== idx) {
            const old = q(`[data-vi-dd="${wasActive}"]`);
            if (old) {old.hidden = true; old.innerHTML = '';}
        }
        activeIdx = idx;
        results = rankItemMatches(inventory, query);
        highlight = -1;
        highlightExplicit = false;
        const head = `<div class="erp-vi-dd-head"><span>${results.length
            ? `أصناف المخزون المطابقة (${results.length}${results.length >= 30 ? '+' : ''})`
            : 'لا توجد نتائج'}</span><span>↑↓ · Enter · Esc</span></div>`;
        if (!results.length) {
            dd.innerHTML = `${head}<div class="erp-vi-dd-empty">لا يوجد صنف يطابق «${esc(query)}» — يمكن حفظه كاسم حر أو جرّب كلمة أقصر</div>`;
        } else {
            dd.innerHTML = head + results.map((item, i) => {
                const qty = num(item.qty);
                const low = qty <= (num(item.minQty) || 5);
                return `<div class="erp-vi-opt${i === highlight ? ' is-active' : ''}" id="erp-vi-opt-${idx}-${i}" role="option" aria-selected="false" data-vi-pick="${i}">
                  <span class="erp-vi-opt-name">${markName(item.name, query)}</span>
                  ${item.unit ? `<span class="erp-vi-opt-meta">${esc(item.unit)}</span>` : ''}
                  <span class="erp-vi-opt-stock${low ? ' is-low' : ''}">المخزون: ${esc(fmtPlain(qty))} ${esc(item.unit || '')}</span>
                  <span class="erp-vi-opt-price">${esc(fmtPlain(item.avgCost))}</span>
                </div>`;
            }).join('');
        }
        dd.hidden = false;
        input.setAttribute('aria-expanded', 'true');
    }

    function fillPickedItem(idx, item) {
        const row = rows[idx];
        if (!row || !item) {return;}
        row.itemId = item.id ?? null;
        row.itemName = String(item.name || '');
        row.unit = item.unit ? String(item.unit) : 'وحدة';
        row.price = num(item.avgCost);
        row.weight = '';
        const nameEl = q(`[data-vi-item="name"][data-idx="${idx}"]`);
        const unitEl = q(`[data-vi-item="unit"][data-idx="${idx}"]`);
        const priceEl = q(`[data-vi-item="price"][data-idx="${idx}"]`);
        const weightEl = q(`[data-vi-item="weight"][data-idx="${idx}"]`);
        if (nameEl) {nameEl.value = row.itemName;}
        if (unitEl) {unitEl.value = row.unit;}
        if (priceEl) {priceEl.value = String(row.price);}
        if (weightEl) {weightEl.value = '';}
        hideSearch();
        paintTotals();
        const qtyEl = q(`[data-vi-item="qty"][data-idx="${idx}"]`);
        if (qtyEl) {qtyEl.focus(); qtyEl.select();}
    }

    function pickSearch(resIndex) {
        const idx = activeIdx;
        const item = results[resIndex];
        if (idx < 0 || !item) {return;}
        fillPickedItem(idx, item);
    }

    function resolveExactName(idx) {
        const row = rows[idx];
        if (!row) {return;}
        const item = exactInventory(row.itemName);
        if (!item) {row.itemId = null; return;}
        row.itemId = item.id ?? null;
        row.unit = item.unit ? String(item.unit) : 'وحدة';
        row.price = num(item.avgCost);
        row.weight = '';
        const unitEl = q(`[data-vi-item="unit"][data-idx="${idx}"]`);
        const priceEl = q(`[data-vi-item="price"][data-idx="${idx}"]`);
        const weightEl = q(`[data-vi-item="weight"][data-idx="${idx}"]`);
        if (unitEl) {unitEl.value = row.unit;}
        if (priceEl) {priceEl.value = String(row.price);}
        if (weightEl) {weightEl.value = '';}
        paintTotals();
    }

    function addRow() {
        rows.push(newItem());
        paintItems();
        const idx = rows.length - 1;
        const nameEl = q(`[data-vi-item="name"][data-idx="${idx}"]`);
        if (nameEl) {nameEl.focus();}
    }

    function removeRow(idx) {
        if (!rows[idx]) {return;}
        rows.splice(idx, 1);
        paintItems();
    }

    function readItemsFromDom() {
        // الحالة تُحدَّث أثناء الإدخال؛ القراءة هنا احتياط لصف أُضيف للتو.
        el.querySelectorAll('[data-vi-item]').forEach((node) => {
            const idx = Number(node.dataset.idx);
            const row = rows[idx];
            if (!row) {return;}
            const key = node.dataset.viItem;
            if (key === 'name' || key === 'unit' || key === 'taxCategory') {row[key] = node.value;}
            else if (key === 'expiryDate') {row.expiryDate = node.value;}
        });
    }

    function formModel() {
        readItemsFromDom();
        return {
            invoiceNumber: field('invoiceNumber'),
            date: field('date') || isoToday(),
            supplierId: field('supplierId'),
            supplierName: field('supplierName'),
            supplierPhone: field('supplierPhone'),
            paymentMethod: field('paymentMethod') || 'cash',
            notes: field('notes'),
            discountType: field('discountType') || 'none',
            discountValue: field('discountValue'),
            paidTouched,
            paidAmount: field('paidAmount'),
            items: rows,
        };
    }

    function fail(message) {
        notify(message, 'error');
        const first = q('[data-vi-item="name"]');
        if (first) {first.focus();}
    }

    async function save() {
        if (saving) {
            notify('جارٍ حفظ الفاتورة... انتظر', 'info');
            return;
        }
        const paidRaw = field('paidAmount');
        const discountType = field('discountType') || 'none';
        const discountValue = num(field('discountValue') || 0);
        const valid = rows.filter((item) => item.itemName && num(item.qty) > 0 && num(item.price) >= 0);
        if (!valid.length) {fail('أضف صنفًا واحدًا على الأقل'); return;}
        if (rows.some((item) => item.itemName && (!Number.isFinite(Number(item.qty))
            || !Number.isFinite(Number(item.price)) || Number(item.qty) < 0 || Number(item.price) < 0))) {
            fail('تحقق من إدخال كمية وسعر صحيحين لكل صنف');
            return;
        }
        if (paidTouched && paidRaw !== '' && (!Number.isFinite(Number(paidRaw)) || Number(paidRaw) < 0)) {
            fail('أدخل مبلغ سداد صحيحًا أو اتركه فارغًا');
            return;
        }
        if (!Number.isFinite(discountValue) || discountValue < 0
            || (discountType === 'percent' && discountValue > 100)) {
            fail('قيمة الخصم غير صحيحة');
            return;
        }
        // سياسة 2026-10-20: الغياب مقبول — نرفض فقط الصيغة الفاسدة (نفس قرار الخادم).
        const expiryGate = checkExpiryOnLines(valid);
        if (!expiryGate.ok) {
            expiryChecked = true;
            paintExpiryMarks();
            notify(expiryGate.message, 'error');
            const firstMissing = q('[data-vi-expiry].is-missing [data-vi-item="expiryDate"]');
            if (firstMissing) {firstMissing.focus();}
            return;
        }
        if (expiryChecked) {expiryChecked = false; paintExpiryMarks();}
        saving = true;
        if (saveBtn) {saveBtn.disabled = true;}
        try {
            const model = formModel();
            if (!model.invoiceNumber) {model.invoiceNumber = `INV-${Date.now().toString(36).toUpperCase()}`;}
            const result = editing
                ? await updatePurchaseInvoice(options.invoice.id, model)
                : await createPurchaseInvoice(model);
            if (!el.isConnected) {return;}
            if (typeof options.onSaved === 'function') {options.onSaved(result, { editing });}
        } catch (e) {
            if (!el.isConnected) {return;}
            const message = String((e && e.message) || 'تعذر حفظ فاتورة الشراء');
            if (isDuplicateInvoiceError(e)) {
                notify('الفاتورة مسجلة بالفعل — لم تتكرر', 'info');
            } else {
                notify(`تعذر الحفظ: ${message}`, 'error');
            }
        } finally {
            saving = false;
            if (el.isConnected && saveBtn) {saveBtn.disabled = false;}
        }
    }

    function cancel() {
        if (typeof options.onCancel === 'function') {options.onCancel();}
        else {destroy();}
    }

    function focusEntry() {
        const first = q('[data-vi-item="qty"]');
        if (first) {
            first.focus();
            first.select();
            notify('الإجمالي محسوب تلقائيًا؛ اكتب الكمية أو السعر في سطر الصنف', 'info');
            return;
        }
        addRow();
        setTimeout(() => {
            const next = q('[data-vi-item="qty"]');
            if (next) {next.focus(); next.select();}
        }, 0);
        notify('الإجمالي محسوب تلقائيًا؛ اكتب الكمية أو السعر في سطر الصنف', 'info');
    }

    const docClick = (event) => {
        if (!el.isConnected) {return;}
        if (!el.contains(event.target)) {hideSearch();}
    };
    document.addEventListener('click', docClick, true);

    el.addEventListener('click', (event) => {
        if (event.target.closest('[data-vi-add]')) {addRow(); return;}
        const removeBtn = event.target.closest('[data-vi-remove]');
        if (removeBtn) {removeRow(Number(removeBtn.dataset.viRemove)); return;}
        if (event.target.closest('[data-vi-smart]')) {
            smartOn = !smartOn;
            setSmartSearchEnabled(smartOn);
            const chip = q('[data-vi-smart]');
            if (chip) {
                chip.classList.toggle('is-on', smartOn);
                chip.setAttribute('aria-pressed', String(smartOn));
                chip.title = smartOn
                    ? 'البحث الذكي مفعّل — اكتب في حقل الصنف لتظهر كل المطابقين من المخزون (كليك للإيقاف)'
                    : 'تجربة: اكتب أي حرف أو كلمة من اسم الصنف لتظهر كل المطابقين — كليك للتشغيل';
            }
            paintItems();
            return;
        }
        if (event.target.closest('[data-vi-cancel]') || event.target.closest('[data-vi-cancel-secondary]')) {
            cancel();
            return;
        }
        if (event.target.closest('[data-vi-save]')) {save(); return;}
        const link = event.target.closest('[data-vi-link-supplier]');
        if (link) {
            const select = q('[data-vi-field="supplierId"]');
            if (select) {select.value = String(link.dataset.viLinkSupplier);}
            toggleFreeFields();
            paintSupplierHint();
            paintTotals();
            return;
        }
        if (event.target.closest('[data-vi-total]')) {focusEntry(); return;}
        const pick = event.target.closest('[data-vi-pick]');
        if (pick) {pickSearch(Number(pick.dataset.viPick));}
    });

    el.addEventListener('mousedown', (event) => {
        const pick = event.target.closest('[data-vi-pick]');
        if (!pick) {return;}
        event.preventDefault();
        pickSearch(Number(pick.dataset.viPick));
    });

    el.addEventListener('input', (event) => {
        const itemNode = event.target.closest('[data-vi-item]');
        if (itemNode) {
            const idx = Number(itemNode.dataset.idx);
            const row = rows[idx];
            if (!row) {return;}
            const key = itemNode.dataset.viItem;
            if (key === 'name') {
                row.itemName = itemNode.value;
                if (smartOn) {paintSearch(idx);}
                return;
            }
            if (key === 'qty') {row.qty = itemNode.value === '' ? 0 : num(itemNode.value);}
            else if (key === 'price') {row.price = itemNode.value === '' ? 0 : num(itemNode.value);}
            else if (key === 'weight') {row.weight = itemNode.value === '' ? '' : num(itemNode.value);}
            else if (key === 'unit') {row.unit = itemNode.value;}
            else if (key === 'expiryDate') {
                row.expiryDate = itemNode.value;
                paintExpiryMarks();
            }
            paintTotals();
            return;
        }
        if (event.target.matches('[data-vi-field="discountValue"]')) {paintTotals(); return;}
        if (event.target.matches('[data-vi-field="paidAmount"]')) {
            paidTouched = true;
            paintTotals();
            return;
        }
        if (event.target.matches('[data-vi-field="supplierName"]')) {
            paintSupplierHint();
        }
    });

    el.addEventListener('change', (event) => {
        if (event.target.matches('[data-vi-field="supplierId"]')) {
            toggleFreeFields();
            paintSupplierHint();
            paintTotals();
            return;
        }
        if (event.target.matches('[data-vi-field="paymentMethod"]')) {
            paintTotals();
            return;
        }
        if (event.target.matches('[data-vi-field="discountType"]')
            || event.target.matches('[data-vi-field="discountValue"]')) {
            paintTotals();
            return;
        }
        if (event.target.matches('[data-vi-field="paidAmount"]')) {
            paidTouched = true;
            paintTotals();
            return;
        }
        const itemNode = event.target.closest('[data-vi-item]');
        if (!itemNode) {return;}
        const idx = Number(itemNode.dataset.idx);
        if (itemNode.dataset.viItem === 'name') {resolveExactName(idx);}
    });

    el.addEventListener('keydown', (event) => {
        const nameNode = event.target.closest('[data-vi-item="name"]');
        if (!nameNode || !smartOn) {return;}
        const idx = Number(nameNode.dataset.idx);
        if (activeIdx !== idx) {return;}
        const dd = q(`[data-vi-dd="${idx}"]`);
        if (!dd || dd.hidden || !results.length) {
            if (event.key === 'Escape') {hideSearch();}
            return;
        }
        if (event.key === 'ArrowDown') {
            event.preventDefault();
            highlight = (highlight + 1) % results.length;
            highlightExplicit = true;
            paintHighlight();
        } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            highlight = (highlight - 1 + results.length) % results.length;
            highlightExplicit = true;
            paintHighlight();
        } else if (event.key === 'Enter') {
            const exact = results.length === 1
                || (results[0] && normalizeItemText(results[0].name) === normalizeItemText(nameNode.value));
            if (highlightExplicit && highlight >= 0) {
                event.preventDefault();
                pickSearch(highlight);
            } else if (exact) {
                event.preventDefault();
                pickSearch(0);
            }
        } else if (event.key === 'Escape') {
            hideSearch();
        }
    });

    el.addEventListener('focusin', (event) => {
        const nameNode = event.target.closest('[data-vi-item="name"]');
        if (!nameNode || !smartOn) {return;}
        if (nameNode.value.trim()) {paintSearch(Number(nameNode.dataset.idx));}
    });

    toggleFreeFields();
    paintSupplierHint();
    paintItems();

    const chip = q('[data-vi-smart]');
    if (chip) {
        chip.title = smartOn
            ? 'البحث الذكي مفعّل — اكتب في حقل الصنف لتظهر كل المطابقين من المخزون (كليك للإيقاف)'
            : 'تجربة: اكتب أي حرف أو كلمة من اسم الصنف لتظهر كل المطابقين — كليك للتشغيل';
    }

    function destroy() {
        document.removeEventListener('click', docClick, true);
        el.remove();
    }

    return { el, destroy };
}
