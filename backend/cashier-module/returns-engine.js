'use strict';

/**
 * returns-engine.js — credit notes (إشعار دائن) for POS sales, maligned-free.
 * ────────────────────────────────────────────────────────────────────────────
 * A return must reverse exactly the money that was invoiced. Re-pricing the
 * returned quantities from the catalog drifts by a halala as soon as a line
 * carries a discount or a price that changed after the sale, and the old
 * workaround was a "تسوية كسور" line — which is forbidden.
 *
 * Therefore the source of truth is the stored invoice itself:
 *   pos_order_items.line_total  → net  (legacy meaning, kept)
 *   pos_order_items.vat_amount  → vat
 *   inclusive line amount       → net + vat
 *
 * `computeCreditNote` (vat-engine) reverses those amounts with integer math,
 * so a full return zeroes the invoice to the halala and a partial return takes
 * a proportional share that never needs a settlement line.
 *
 * This module is pure (no database access) so the arithmetic is unit-tested
 * without a pool. The route only loads rows, calls it, and serialises.
 */

const {
    computeCreditNote,
    fromMinor,
    toMinor,
    toMilliQty,
    assertBalanced,
    VatBalanceError,
} = require('./vat-engine');

/**
 * Build the invoice view (positive) from stored rows and prove it balances.
 *
 * @param {object} order   row of `pos_orders`
 * @param {Array<object>} items rows of `pos_order_items` (id, quantity,
 *        line_total net, vat_amount, vat_rate)
 * @param {string|number} [orderId] identifier used in error details
 * @returns {{ subtotal:number, tax_total:number, total_amount:number,
 *             line_items:Array<{key:string, product_id:*, quantity:number,
 *             net:number, vat:number, vat_rate:number}> }}
 */
function invoiceFromOrder(order, items, orderId = null) {
    const rows = Array.isArray(items) ? items : [];
    if (!rows.length) {
        throw Object.assign(new Error('Invoice has no lines'), {
            code: 'EMPTY_INVOICE',
            statusCode: 409,
        });
    }

    const lineItems = rows.map((item, index) => ({
        key: String(item.id ?? item.line_id ?? index),
        product_id: item.product_id ?? null,
        quantity: toMilliQty(item.quantity) / 1000,
        net: fromMinor(toMinor(item.line_total)),
        vat: fromMinor(toMinor(item.vat_amount)),
        vat_rate: Number(item.vat_rate ?? 15),
    }));

    const subtotal = lineItems.reduce((s, li) => s + toMinor(li.net), 0);
    const taxTotal = lineItems.reduce((s, li) => s + toMinor(li.vat), 0);
    const total = subtotal + taxTotal;

    // 1) The lines must agree with the invoice header. A mismatch means the
    //    row was written by an old engine; returning money from it would be a
    //    guess, so fail closed with the house error (422 + audit upstream).
    const headerNet = toMinor(order?.subtotal);
    const headerVat = toMinor(order?.tax_total);
    if (headerNet !== subtotal || headerVat !== taxTotal) {
        throw new VatBalanceError(
            `سطور الفاتورة لا تطابق إجماليها: الصافي ${fromMinor(subtotal).toFixed(2)}`
            + `/${fromMinor(headerNet).toFixed(2)}، الضريبة ${fromMinor(taxTotal).toFixed(2)}`
            + `/${fromMinor(headerVat).toFixed(2)} — لا يمكن إصدار إشعار دائن`,
            {
                context: { phase: 'credit-note-source', order_id: orderId },
                net: fromMinor(subtotal),
                vat: fromMinor(taxTotal),
                total: fromMinor(total),
                header: { net: fromMinor(headerNet), vat: fromMinor(headerVat) },
            }
        );
    }

    // 2) The header itself must satisfy net + vat = total (the engine's rule).
    assertBalanced(
        {
            subtotal: order?.subtotal,
            tax_total: order?.tax_total,
            total_amount: order?.total_amount,
        },
        { phase: 'credit-note-header', order_id: orderId }
    );

    return {
        subtotal: fromMinor(subtotal),
        tax_total: fromMinor(taxTotal),
        total_amount: fromMinor(total),
        line_items: lineItems,
    };
}

/**
 * Normalise requested returns into `{ key, quantity }` pairs.
 * Accepts `{ key }`, `{ item_id }`, `{ line_id }` or `{ index }` selectors.
 *
 * @param {Array<object>} returns
 * @returns {Array<{key:string, quantity:number}>}
 */
function normalizeReturns(returns) {
    const rows = Array.isArray(returns) ? returns : [];
    return rows.map((row) => {
        const selector = row?.key ?? row?.item_id ?? row?.line_id ?? row?.index;
        return {
            key: selector === undefined || selector === null ? '' : String(selector),
            quantity: row?.quantity,
        };
    });
}

/**
 * Compute a credit note for an issued order.
 *
 * @param {object} order
 * @param {Array<object>} items
 * @param {Array<object>} returns requested lines (`key`/`item_id` + quantity)
 * @param {object} [options]
 * @param {Record<string, number|string>} [options.alreadyReturned] quantities
 *        already credited per line key — prevents over-return when a writer
 *        exists (there is none yet; the guard is here so it cannot be skipped).
 * @returns {{ invoice:object, credit_note:object }}
 */
function buildCreditNote(order, items, returns, options = {}) {
    const invoice = invoiceFromOrder(order, items, order?.id ?? null);
    const already = options.alreadyReturned || {};

    const requested = normalizeReturns(returns).map((row) => ({
        key: row.key,
        quantity: row.quantity,
        already_returned: already[row.key] ?? 0,
    }));

    // All quantity / identity rules live in the engine so a writer cannot
    // bypass them; this module only translates database rows.
    const creditNote = computeCreditNote(
        invoice.line_items.map((line) => ({
            key: line.key,
            quantity: line.quantity,
            net: line.net,
            vat: line.vat,
            vat_rate: line.vat_rate,
        })),
        requested
    );

    return { invoice, credit_note: creditNote };
}

module.exports = { invoiceFromOrder, normalizeReturns, buildCreditNote };
