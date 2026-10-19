/**
 * V2 — Purchase invoice writes (ذيل P1-4 + 26c-2)
 * ═══════════════════════════════════════════════════════════════════════
 *
 * The read repo (`purchase-invoices-repo.js`) stays read-only by contract.
 * This file owns every purchase-invoice write door, copied from the server:
 *
 *   POST /warehouse/purchase-invoices
 *     backend/warehouse-routes.js:1802 — jwtAuth + requireRole('admin',
 *     'manager', 'warehouse'). The server matches items by normalized name,
 *     recomputes discount/VAT/payment status, and refuses duplicate numbers
 *     (409 DUPLICATE_INVOICE_NUMBER) and same-user/supplier/amount repeats
 *     within ten minutes (409 DUPLICATE_INVOICE).
 *   PUT /warehouse/purchase-invoices/:id
 *     backend/warehouse-routes.js:2114 — same roles. Refuses any invoice
 *     with a recorded payment (409 INVOICE_HAS_PAYMENTS); the UI never
 *     offers edit for paid rows, but the server remains the authority.
 *   POST /warehouse/purchase-invoices/:id/void
 *     backend/warehouse-routes.js:2682 — jwtAuth + requireRole('admin').
 *     Reverses stock, voids the journal entry, deletes auto payments made
 *     with the invoice itself, then deletes the invoice row. Manual
 *     supplier payments refuse with 409 INVOICE_HAS_PAYMENTS; `force` is
 *     refused with 409 FORCE_VOID_FORBIDDEN — so this repo never sends it.
 *   POST /warehouse/purchase-invoices/clear-all
 *     backend/warehouse-routes.js:2935 — jwtAuth + requireRole('admin').
 *     Requires the literal phrase `حذف كل الفواتير`; reverses every
 *     invoice's ledger rows and voids its posted journals.
 *
 * No `force`, no retries, no client-side recomputation: the server is the
 * authority on roles, balances and the confirmation phrase.
 */

import { apiFetch } from '../../core/api.js?v=4.9.169';

/** Mirrors requireRole('admin','manager','warehouse') on POST/PUT. */
export const INVOICE_CREATE_ROLES = ['admin', 'manager', 'warehouse'];
/** Server tax enum — the same four the legacy select offers. */
export const TAX_CATEGORIES = ['STANDARD', 'ZERO_RATED', 'EXEMPT', 'OUT_OF_SCOPE'];
/** Server sentence (warehouse-routes.js:2126) — shown before opening. */
export const EDIT_LOCKED_MESSAGE = 'لا يمكن تعديل فاتورة عليها دفعة مسجلة؛ اعكس الدفعة رسميًا أولًا';

const num = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
};
const str = (v) => (v === undefined || v === null ? '' : String(v).trim());

/** DB invoice → editable line models — legacy mapping verbatim
 *  (features/warehouse.js:1543-1552), including the JSON-string case. */
export function invoiceItemsFromRow(inv = {}) {
    let items = inv.items;
    if (typeof items === 'string') {
        try {items = JSON.parse(items);} catch {items = [];}
    }
    return (Array.isArray(items) ? items : []).map((item) => ({
        itemId: item.itemId || item.item_id || null,
        itemName: item.itemName || item.name || '',
        qty: Number(item.qty) || 0,
        price: Number(item.price) || 0,
        unit: item.unit || 'وحدة',
        weight: item.weight ?? '',
        taxCategory: item.taxCategory || item.tax_category || 'STANDARD',
        packagingQty: item.packagingQty ?? item.packaging_qty ?? null,
        packagingUom: item.packagingUom || item.packaging_uom || null,
    }));
}

/** DB invoice → editor header model (legacy reads snake_case discount fields). */
export function invoiceFormFromRow(inv = {}) {
    return {
        invoiceNumber: inv.invoiceNumber ? String(inv.invoiceNumber) : '',
        date: inv.date ? String(inv.date).slice(0, 10) : '',
        supplierId: inv.supplierId ?? '',
        supplierName: inv.supplierName ? String(inv.supplierName) : '',
        supplierPhone: inv.supplierPhone ? String(inv.supplierPhone) : '',
        paymentMethod: inv.paymentMethod ? String(inv.paymentMethod) : 'cash',
        notes: inv.notes ? String(inv.notes) : '',
        discountType: inv.discountType || inv.discount_type || 'none',
        discountValue: num(inv.discountValue ?? inv.discount_value),
        paidAmount: num(inv.paidAmount),
        items: invoiceItemsFromRow(inv),
    };
}

/** Legacy's edit gate (features/warehouse.js:1535): paidAmount > 0.
 *  The server also looks at supplier_payments rows and stays authoritative. */
export function invoiceEditable(inv = {}) {
    return !(num(inv.paidAmount) > 0);
}

/** Form model → POST/PUT body. Same fields and defaults the legacy form sent;
 *  invalid lines are dropped exactly where the legacy save dropped them. */
export function purchaseInvoicePayload(form = {}) {
    const items = (Array.isArray(form.items) ? form.items : [])
        .filter((item) => str(item && item.itemName) && Number(item.qty) > 0 && Number(item.price) >= 0)
        .map((item) => {
            const tax = String(item.taxCategory || 'STANDARD').trim().toUpperCase();
            const line = {
                itemId: item.itemId === undefined ? null : item.itemId,
                itemName: str(item.itemName),
                qty: num(item.qty),
                price: num(item.price),
                unit: str(item.unit) || 'وحدة',
                weight: item.weight === '' || item.weight === undefined || item.weight === null
                    ? 0 : num(item.weight),
                taxCategory: TAX_CATEGORIES.includes(tax) ? tax : 'STANDARD',
            };
            if (item.packagingQty !== undefined && item.packagingQty !== null && item.packagingQty !== '') {
                line.packagingQty = num(item.packagingQty);
                line.packagingUom = item.packagingUom ? String(item.packagingUom) : null;
            }
            return line;
        });
    const payload = {
        invoiceNumber: str(form.invoiceNumber),
        date: str(form.date),
        supplierName: str(form.supplierName),
        supplierPhone: str(form.supplierPhone),
        supplierId: form.supplierId === undefined || form.supplierId === null || form.supplierId === ''
            ? null : form.supplierId,
        paymentMethod: str(form.paymentMethod) || 'cash',
        notes: str(form.notes),
        discountType: str(form.discountType) || 'none',
        discountValue: num(form.discountValue),
        items,
    };
    // The legacy form omitted paidAmount until the operator touched the field;
    // the server then auto-settles cash/bank and leaves credit at zero.
    if (form.paidTouched && form.paidAmount !== '' && form.paidAmount !== undefined && form.paidAmount !== null) {
        payload.paidAmount = num(form.paidAmount);
    }
    return payload;
}

/** Legacy duplicate-invoice catch (features/warehouse.js:1770-1772). */
export function isDuplicateInvoiceError(e) {
    return !!(e && (e.code === 'DUPLICATE_INVOICE'
        || /مكرر|مشابهة|DUPLICATE/.test(String(e.message || ''))));
}

export async function createPurchaseInvoice(form) {
    return apiFetch('/warehouse/purchase-invoices', {
        method: 'POST',
        body: JSON.stringify(purchaseInvoicePayload(form)),
    });
}

export async function updatePurchaseInvoice(id, form) {
    const invoiceId = Number(id);
    if (!Number.isInteger(invoiceId) || invoiceId <= 0) {
        throw new Error('معرف الفاتورة غير صحيح');
    }
    return apiFetch(`/warehouse/purchase-invoices/${invoiceId}`, {
        method: 'PUT',
        body: JSON.stringify(purchaseInvoicePayload(form)),
    });
}

/** Mirrors requireRole('admin') on both destructive doors — not a client invention. */
export const INVOICE_VOID_ROLES = ['admin'];
export const CLEAR_ALL_CONFIRM = 'حذف كل الفواتير';

export async function voidPurchaseInvoice(id) {
    const invoiceId = Number(id);
    if (!Number.isInteger(invoiceId) || invoiceId <= 0) {
        throw new Error('معرف الفاتورة غير صحيح');
    }
    return apiFetch(`/warehouse/purchase-invoices/${invoiceId}/void`, {
        method: 'POST',
        body: JSON.stringify({}),
    });
}

export async function clearAllPurchaseInvoices() {
    return apiFetch('/warehouse/purchase-invoices/clear-all', {
        method: 'POST',
        body: JSON.stringify({ confirm: CLEAR_ALL_CONFIRM }),
    });
}
