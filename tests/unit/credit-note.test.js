'use strict';

/**
 * credit-note.test.js — returns / credit notes reverse the issued invoice to
 * the halala, with no "settlement" line and no float drift.
 *
 * The source of truth is the stored invoice (net per line + vat per line), so
 * the tests feed the engine exactly what `pos_order_items` holds:
 *   line_total → net, vat_amount → vat.
 */

const {
    VatBalanceError,
    computeInvoice,
    computeCreditNote,
    toMinor,
} = require('../../backend/cashier-module/vat-engine');
const { invoiceFromOrder, buildCreditNote } = require('../../backend/cashier-module/returns-engine');

/** Invoice line → credit-note input (as stored on the invoice). */
function creditLines(invoice) {
    return invoice.line_items.map((line, index) => ({
        key: String(index),
        quantity: line.quantity,
        net: line.line_net,
        vat: line.vat_amount,
        vat_rate: line.vat_rate,
    }));
}

/** Stored rows as `pos_orders` + `pos_order_items` would return them. */
function storedOrder(invoice) {
    return {
        order: {
            id: 'o-1',
            subtotal: invoice.subtotal,
            tax_total: invoice.tax_total,
            total_amount: invoice.total_amount,
        },
        items: invoice.line_items.map((line, index) => ({
            id: index + 1,
            product_id: line.product_id ?? index + 1,
            quantity: line.quantity,
            vat_rate: line.vat_rate,
            line_total: line.line_net,
            vat_amount: line.vat_amount,
        })),
    };
}

describe('computeCreditNote — full and partial returns', () => {
    const invoice = computeInvoice({
        lines: [
            { unit_price_incl: 45, quantity: 1, vat_rate: 15 },
            { unit_price_incl: 25, quantity: 1, vat_rate: 15 },
        ],
    });

    test('the issued invoice is 60.87 / 9.13 / 70.00', () => {
        expect(invoice.subtotal).toBe(60.87);
        expect(invoice.tax_total).toBe(9.13);
        expect(invoice.total_amount).toBe(70);
    });

    test('returning every line reverses the invoice exactly', () => {
        const credit = computeCreditNote(creditLines(invoice), [
            { key: '0', quantity: 1 },
            { key: '1', quantity: 1 },
        ]);
        expect(credit.credit).toBe(true);
        expect(credit.subtotal).toBe(-60.87);
        expect(credit.tax_total).toBe(-9.13);
        expect(credit.total_amount).toBe(-70);
        expect(credit.subtotal + credit.tax_total).toBe(credit.total_amount);
        expect(credit.balanced).toBe(true);
        expect(credit.line_items.map((li) => li.vat_amount)).toEqual([-5.87, -3.26]);
    });

    test('returning only the 25.00 line reverses only its money', () => {
        const credit = computeCreditNote(creditLines(invoice), [{ key: '1', quantity: 1 }]);
        expect(credit.subtotal).toBe(-21.74);
        expect(credit.tax_total).toBe(-3.26);
        expect(credit.total_amount).toBe(-25);
        expect(credit.line_items).toHaveLength(1);
    });

    test('a partial quantity takes a proportional slice at the line rate', () => {
        const threeUnits = computeInvoice({
            lines: [{ unit_price_incl: 99.99, quantity: 3, vat_rate: 15 }],
        });
        const credit = computeCreditNote(creditLines(threeUnits), [{ key: '0', quantity: 1 }]);
        // 99.99 inclusive → 86.95 net + 13.04 vat
        expect(credit.subtotal).toBe(-86.95);
        expect(credit.tax_total).toBe(-13.04);
        expect(credit.total_amount).toBe(-99.99);
    });

    test('batched returns telescope to the full line without a residual', () => {
        const threeUnits = computeInvoice({
            lines: [{ unit_price_incl: 99.99, quantity: 3, vat_rate: 15 }],
        });
        const first = computeCreditNote(creditLines(threeUnits), [{ key: '0', quantity: 1 }]);
        const second = computeCreditNote(creditLines(threeUnits), [
            { key: '0', quantity: 2, already_returned: 1 },
        ]);
        expect(toMinor(first.total_amount) + toMinor(second.total_amount)).toBe(-29997);
        expect(toMinor(first.subtotal) + toMinor(second.subtotal)).toBe(-26084);
        expect(toMinor(first.tax_total) + toMinor(second.tax_total)).toBe(-3913);
        // The last batch closes on the stored split exactly.
        expect(second.subtotal).toBe(-173.89);
        expect(second.tax_total).toBe(-26.09);
    });

    test('a zero-rated line returns net only (no invented VAT)', () => {
        const invoice0 = computeInvoice({
            lines: [{ unit_price_incl: 100, quantity: 2, vat_rate: 0 }],
        });
        const credit = computeCreditNote(creditLines(invoice0), [{ key: '0', quantity: 1 }]);
        expect(credit.subtotal).toBe(-100);
        expect(credit.tax_total).toBe(0);
        expect(credit.total_amount).toBe(-100);
    });

    test('mixed 15% and 0% lines keep their own rates', () => {
        const mixed = computeInvoice({
            lines: [
                { unit_price_incl: 45, quantity: 1, vat_rate: 15 },
                { unit_price_incl: 10, quantity: 1, vat_rate: 0 },
            ],
        });
        const credit = computeCreditNote(creditLines(mixed), [
            { key: '0', quantity: 1 },
            { key: '1', quantity: 1 },
        ]);
        expect(credit.line_items.map((li) => li.vat_rate)).toEqual([15, 0]);
        expect(credit.line_items.map((li) => li.vat_amount)).toEqual([-5.87, 0]);
        expect(credit.total_amount).toBe(-55);
    });

    test('discounted invoice: full return reverses the discounted money', () => {
        const discounted = computeInvoice({
            lines: [
                { unit_price_incl: 57.5, quantity: 1, vat_rate: 15 },
                { unit_price_incl: 57.5, quantity: 1, vat_rate: 15 },
            ],
            invoice_discount: 15,
        });
        const credit = computeCreditNote(creditLines(discounted), [
            { key: '0', quantity: 1 },
            { key: '1', quantity: 1 },
        ]);
        expect(credit.subtotal).toBe(-discounted.subtotal);
        expect(credit.tax_total).toBe(-discounted.tax_total);
        expect(credit.total_amount).toBe(-discounted.total_amount);
        expect(credit.total_amount).toBe(-100);
    });

    test('a one-halala line returns exactly one halala', () => {
        const tiny = computeInvoice({ lines: [{ unit_price_incl: 0.01, quantity: 1, vat_rate: 15 }] });
        const credit = computeCreditNote(creditLines(tiny), [{ key: '0', quantity: 1 }]);
        expect(credit.total_amount).toBe(-0.01);
        expect(credit.subtotal + credit.tax_total).toBe(-0.01);
    });

    test('100 lines of 0.01 return to zero sum with no drift', () => {
        const many = Array.from({ length: 100 }, () => ({
            unit_price_incl: 0.01,
            quantity: 1,
            vat_rate: 15,
        }));
        const invoiceMany = computeInvoice({ lines: many });
        const credit = computeCreditNote(
            creditLines(invoiceMany),
            invoiceMany.line_items.map((_, index) => ({ key: String(index), quantity: 1 }))
        );
        expect(credit.total_amount).toBe(-invoiceMany.total_amount);
        expect(credit.subtotal).toBe(-invoiceMany.subtotal);
        expect(Math.abs(credit.tax_total)).toBe(invoiceMany.tax_total);
        expect(toMinor(credit.subtotal) + toMinor(credit.tax_total)).toBe(toMinor(credit.total_amount));
    });
});

describe('computeCreditNote — guards (fail closed)', () => {
    const invoice = computeInvoice({
        lines: [{ unit_price_incl: 100, quantity: 3, vat_rate: 15 }],
    });
    const lines = creditLines(invoice);

    test('quantity above the invoiced amount is rejected', () => {
        expect(() => computeCreditNote(lines, [{ key: '0', quantity: 4 }])).toThrow(/exceeds invoiced/);
        try {
            computeCreditNote(lines, [{ key: '0', quantity: 4 }]);
        } catch (error) {
            expect(error.code).toBe('RETURN_QUANTITY_EXCEEDED');
            expect(error.details).toMatchObject({ invoiced: 3, requested: 4 });
        }
    });

    test('quantity above the remaining amount (after previous credits) is rejected', () => {
        expect(() =>
            computeCreditNote(lines, [{ key: '0', quantity: 2, already_returned: 2 }])
        ).toThrow(/exceeds invoiced/);
    });

    test('unknown line, duplicate line, empty request and zero quantity are rejected', () => {
        expect(() => computeCreditNote(lines, [{ key: '9', quantity: 1 }])).toThrow(/Unknown invoice line/);
        expect(() =>
            computeCreditNote(lines, [
                { key: '0', quantity: 1 },
                { key: '0', quantity: 1 },
            ])
        ).toThrow(/Duplicate return line/);
        expect(() => computeCreditNote(lines, [])).toThrow(/at least one returned line/);
        expect(() => computeCreditNote(lines, [{ key: '0', quantity: 0 }])).toThrow(/must be positive/);
    });

    test('returning more than once across batches cannot exceed the invoiced quantity', () => {
        const first = computeCreditNote(lines, [{ key: '0', quantity: 2 }]);
        expect(first.total_amount).toBeLessThan(0);
        expect(() =>
            computeCreditNote(lines, [{ key: '0', quantity: 2, already_returned: 2 }])
        ).toThrow(/exceeds invoiced/);
    });
});

describe('returns-engine — stored invoice rows', () => {
    const invoice = computeInvoice({
        lines: [
            { unit_price_incl: 45, quantity: 1, vat_rate: 15 },
            { unit_price_incl: 25, quantity: 1, vat_rate: 15 },
        ],
    });
    const { order, items } = storedOrder(invoice);

    test('builds the header from the lines and returns a full credit note', () => {
        const result = buildCreditNote(order, items, [
            { item_id: 1, quantity: 1 },
            { item_id: 2, quantity: 1 },
        ]);
        expect(result.invoice.subtotal).toBe(60.87);
        expect(result.credit_note.total_amount).toBe(-70);
        expect(result.credit_note.total_amount).toBe(-Number(order.total_amount));
    });

    test('accepts a single line by item id and keeps the others out', () => {
        const result = buildCreditNote(order, items, [{ item_id: 2, quantity: 1 }]);
        expect(result.credit_note.line_items).toHaveLength(1);
        expect(result.credit_note.total_amount).toBe(-25);
    });

    test('refuses a header that does not match its lines', () => {
        const broken = { ...order, subtotal: 60.88 };
        expect(() => buildCreditNote(broken, items, [{ item_id: 1, quantity: 1 }])).toThrow(VatBalanceError);
    });

    test('refuses a header where net + vat ≠ total', () => {
        const broken = { ...order, total_amount: 70.01 };
        expect(() => buildCreditNote(broken, items, [{ item_id: 1, quantity: 1 }])).toThrow(VatBalanceError);
    });

    test('refuses an invoice without lines', () => {
        expect(() => invoiceFromOrder(order, [], 'o-1')).toThrow(/no lines/);
    });

    test('already-credited quantities are honoured on top of stored rows', () => {
        const threeUnits = computeInvoice({
            lines: [{ unit_price_incl: 99.99, quantity: 3, vat_rate: 15 }],
        });
        const stored = storedOrder(threeUnits);
        expect(() =>
            buildCreditNote(stored.order, stored.items, [{ item_id: 1, quantity: 1 }], {
                alreadyReturned: { 1: 3 },
            })
        ).toThrow(/exceeds invoiced/);

        const ok = buildCreditNote(stored.order, stored.items, [{ item_id: 1, quantity: 1 }], {
            alreadyReturned: { 1: 2 },
        });
        expect(ok.credit_note.total_amount).toBe(-99.99);
    });
});
