/**
 * V2 — Purchase invoice destructive writes (ذيل P1-4)
 * ═══════════════════════════════════════════════════════════════════════
 *
 * The read repo (`purchase-invoices-repo.js`) stays read-only by contract.
 * This file owns the two irreversible doors, copied from the server:
 *
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

import { apiFetch } from '../../core/api.js?v=4.9.146';

/** Mirrors requireRole('admin') on both doors — not a client invention. */
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
