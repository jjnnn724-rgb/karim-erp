/**
 * V2 — Purchase invoices repository (الباب الوحيد إلى /api/purchaseInvoices)
 * ═══════════════════════════════════════════════════════════════════════
 *
 * CONTRACT COPIED FROM THE SERVER, NOT INVENTED
 *   GET /purchaseInvoices?page=&limit=&sort=id&order=asc → { data, pagination }
 *     (generic entity list, app.js:81 apiList shape; read gate =
 *     ENTITY_READ_ROLES.purchaseInvoices = SENSITIVE + warehouse
 *     — server.js:1246. The server stays the authority.)
 *   purchaseInvoices columns (DB, read-only SELECT verified 2026-10-14):
 *     id, invoiceNumber, date, supplierName, supplierPhone, items(jsonb),
 *     totalAmount, paymentMethod, notes, createdAt, createdBy, supplierId,
 *     paidAmount, paymentStatus, subtotal_net, vat_total,
 *     tax_rate_snapshot, tax_rule_code_snapshot, supplier_name_snapshot,
 *     supplier_vat_number_snapshot, supplier_cr_snapshot,
 *     supplier_tax_status_snapshot, zatca_uuid, zatca_qr, discount_type,
 *     discount_value, discount_amount, branch_id.
 *   paymentStatus values: paid | partial | unpaid (null reads as unpaid —
 *     features/warehouse.js:469). All three are verified adapter values
 *     (status.js payment:paid/partial/unpaid).
 *
 * DISPLAY SCOPE: register fields only. items jsonb (line details),
 * snapshots beyond the supplier name, and ZATCA artefacts are not
 * register columns — the screen reads names, dates and money.
 *
 * THIS FILE NEVER WRITES. No POST/PUT/DELETE here by construction.
 */

import { apiFetch } from '../../core/api.js?v=4.9.146';

const num = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
};

/** Remaining on an invoice — the legacy rule, verbatim
 *  (features/warehouse.js:347 pcmtInvoiceRemaining). */
export function invoiceRemaining(inv = {}) {
    return Math.max(0, num(inv.totalAmount) - num(inv.paidAmount));
}

/** Bounded entity walk (5 × 1000), same shape as the other registers. */
export async function fetchPurchaseInvoices() {
    const rows = [];
    for (let page = 1; page <= 5; page += 1) {
        const res = await apiFetch(`/purchaseInvoices?page=${page}&limit=1000&sort=id&order=asc`);
        const batch = res && Array.isArray(res.data) ? res.data
            : (Array.isArray(res) ? res : []);
        rows.push(...batch);
        const totalPages = Number(res && res.pagination && res.pagination.totalPages) || 0;
        if (!batch.length || (totalPages > 0 && page >= totalPages) || batch.length < 1000) {break;}
    }
    return rows;
}

/**
 * Database row → table row. Supplier name prefers the live directory,
 * then the row's own snapshots (written at issue time), then the id —
 * in that order, stated in the UI. Pure and exported so it is testable
 * without a browser.
 */
export function invoiceToRow(inv = {}, supplierById = new Map()) {
    const sup = supplierById.get(String(inv.supplierId));
    const name = (sup && sup.name) ? String(sup.name)
        : (inv.supplier_name_snapshot ? String(inv.supplier_name_snapshot)
            : (inv.supplierName ? String(inv.supplierName)
                : (inv.supplierId ? `#${inv.supplierId}` : '—')));
    const status = inv.paymentStatus ? String(inv.paymentStatus) : 'unpaid';
    return {
        id: inv.id,
        number: inv.invoiceNumber ? String(inv.invoiceNumber) : `#${inv.id ?? '؟'}`,
        date: inv.date ? String(inv.date).slice(0, 10) : '',
        supplierId: inv.supplierId ?? null,
        supplier: name,
        supplierResolved: !!(sup && sup.name),
        total: num(inv.totalAmount),
        paid: num(inv.paidAmount),
        remaining: invoiceRemaining(inv),
        status,
    };
}

export function supplierIdMap(suppliers = []) {
    const map = new Map();
    for (const s of suppliers) {
        if (s && s.id !== undefined && s.id !== null) {map.set(String(s.id), s);}
    }
    return map;
}
