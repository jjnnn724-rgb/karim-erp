'use strict';

/**
 * vat-engine.test.js — VAT rounding & balance guarantees (no database).
 *
 * Covers the 14 mandated scenarios from the VAT directive:
 *  45+25 → 9.13 · single lines · 0.01 · 99.99 · 100 lines · line discount
 *  · invoice discount pro-rata · partial return · mixed 15%/0% · unbalanced
 *  rejection · end-to-end totals feed for QR/ZATCA · regression on the legacy
 *  net-price catalog · comparison against the ZATCA calculator formula.
 */

const {
    VatBalanceError,
    divHalfUp,
    toMinor,
    fromMinor,
    netToInclusivePrice,
    splitInclusive,
    allocateInvoiceDiscount,
    computeLine,
    computeInvoice,
    assertBalanced,
} = require('../../backend/cashier-module/vat-engine');

describe('rounding primitives (ROUND_HALF_UP, no float money)', () => {
    test('divHalfUp rounds ties away from zero — including negatives', () => {
        expect(divHalfUp(5, 2)).toBe(3);
        expect(divHalfUp(4, 2)).toBe(2);
        expect(divHalfUp(-5, 2)).toBe(-3); // Math.round(-2.5) would be -2
        expect(divHalfUp(-4, 2)).toBe(-2);
        expect(divHalfUp(7, 3)).toBe(2);
        expect(divHalfUp(8, 3)).toBe(3);
    });

    test('toMinor parses strings, rejects garbage', () => {
        expect(toMinor('39.13')).toBe(3913);
        expect(toMinor(0.005)).toBe(1);
        expect(toMinor(null)).toBe(0);
        expect(() => toMinor('abc')).toThrow(/Invalid numeric value/);
    });

    test('splitInclusive never loses a minor unit', () => {
        for (const incl of [1, 7, 99, 1234, 7000, 9999, 29997]) {
            const { netMinor, vatMinor } = splitInclusive(incl, 15000);
            expect(netMinor + vatMinor).toBe(incl);
            expect(netMinor).toBeGreaterThanOrEqual(0);
        }
    });
});

describe('1-3 · the reported case: 45.00 + 25.00 inclusive = 70.00', () => {
    test('invoice totals are 60.87 / 9.13 / 70.00', () => {
        const invoice = computeInvoice({
            lines: [
                { unit_price_incl: 45, quantity: 1, vat_rate: 15 },
                { unit_price_incl: 25, quantity: 1, vat_rate: 15 },
            ],
        });
        expect(invoice.subtotal).toBe(60.87);
        expect(invoice.tax_total).toBe(9.13);
        expect(invoice.total_amount).toBe(70);
        expect(invoice.balanced).toBe(true);
    });

    test('45.00 alone ⇒ 39.13 / 5.87', () => {
        const line = computeLine({ unit_price_incl: 45, quantity: 1, vat_rate: 15 });
        expect(line.line_net).toBe(39.13);
        expect(line.vat_amount).toBe(5.87);
        expect(line.line_total).toBe(45);
    });

    test('25.00 alone ⇒ 21.74 / 3.26', () => {
        const line = computeLine({ unit_price_incl: 25, quantity: 1, vat_rate: 15 });
        expect(line.line_net).toBe(21.74);
        expect(line.vat_amount).toBe(3.26);
        expect(line.line_total).toBe(25);
    });
});

describe('4-5 · boundary prices', () => {
    test('0.01 inclusive stays balanced (net 0.01, vat 0.00)', () => {
        const line = computeLine({ unit_price_incl: 0.01, quantity: 1, vat_rate: 15 });
        expect(line.line_total).toBe(0.01);
        expect(line.line_net).toBe(0.01);
        expect(line.vat_amount).toBe(0);
        expect(assertBalanced({ subtotal: line.line_net, tax_total: line.vat_amount, total_amount: line.line_total })).toBe(true);
    });

    test('99.99 inclusive ⇒ 86.95 / 13.04', () => {
        const line = computeLine({ unit_price_incl: 99.99, quantity: 1, vat_rate: 15 });
        expect(line.line_net).toBe(86.95);
        expect(line.vat_amount).toBe(13.04);
        expect(line.line_total).toBe(99.99);
    });

    test('99.99 × 3 keeps the published total (no halala drift)', () => {
        const invoice = computeInvoice({
            lines: [{ unit_price_incl: 99.99, quantity: 3, vat_rate: 15 }],
        });
        expect(invoice.total_amount).toBe(299.97); // legacy net engine produced 299.98
        expect(invoice.subtotal).toBe(260.84);
        expect(invoice.tax_total).toBe(39.13);
    });
});

describe('6 · 100 identical lines do not accumulate error', () => {
    test('100 × 1.00 inclusive = 100.00 total', () => {
        const lines = Array.from({ length: 100 }, () => ({ unit_price_incl: 1, quantity: 1, vat_rate: 15 }));
        const invoice = computeInvoice({ lines });
        expect(invoice.total_amount).toBe(100);
        expect(invoice.subtotal + invoice.tax_total).toBeCloseTo(100, 10);
        // per-line split of 1.00 is 0.87 + 0.13; 100 lines therefore 87.00 / 13.00
        expect(invoice.subtotal).toBe(87);
        expect(invoice.tax_total).toBe(13);
    });
});

describe('7 · line discount (VAT inclusive)', () => {
    test('30.00 with 5.00 discount ⇒ 25.00 / 21.74 / 3.26', () => {
        const line = computeLine({ unit_price_incl: 30, quantity: 1, discount: 5, vat_rate: 15 });
        expect(line.line_total).toBe(25);
        expect(line.line_net).toBe(21.74);
        expect(line.vat_amount).toBe(3.26);
        expect(line.discount).toBe(5);
    });

    test('100% line discount yields a zero line, still balanced', () => {
        const invoice = computeInvoice({
            lines: [
                { unit_price_incl: 45, quantity: 1, discount: 45, vat_rate: 15 },
                { unit_price_incl: 25, quantity: 1, vat_rate: 15 },
            ],
        });
        expect(invoice.line_items[0].line_total).toBe(0);
        expect(invoice.total_amount).toBe(25);
        expect(invoice.balanced).toBe(true);
    });
});

describe('8 · invoice-level discount is allocated pro-rata', () => {
    test('allocations sum exactly to the invoice discount', () => {
        const shares = allocateInvoiceDiscount([3333, 3333, 3333], 10);
        expect(shares.reduce((s, v) => s + v, 0)).toBe(10);
    });

    test('60 + 40 with 10.00 invoice discount ⇒ 90.00 and balanced', () => {
        const invoice = computeInvoice({
            lines: [
                { unit_price_incl: 60, quantity: 1, vat_rate: 15 },
                { unit_price_incl: 40, quantity: 1, vat_rate: 15 },
            ],
            invoice_discount: 10,
        });
        expect(invoice.discount_total).toBe(10);
        expect(invoice.total_amount).toBe(90);
        expect(invoice.line_items[0].line_total).toBe(54);
        expect(invoice.line_items[1].line_total).toBe(36);
        expect(invoice.balanced).toBe(true);
    });

    test('never allocates more than a line holds', () => {
        const invoice = computeInvoice({
            lines: [
                { unit_price_incl: 1, quantity: 1, vat_rate: 15 },
                { unit_price_incl: 100, quantity: 1, vat_rate: 15 },
            ],
            invoice_discount: 10,
        });
        expect(invoice.line_items.every((li) => li.line_total >= 0)).toBe(true);
        expect(invoice.balanced).toBe(true);
    });
});

describe('9 · partial return / credit note', () => {
    test('return of one 45.00 line reverses exactly 39.13 / 5.87', () => {
        const original = computeInvoice({
            lines: [
                { unit_price_incl: 45, quantity: 1, vat_rate: 15 },
                { unit_price_incl: 25, quantity: 1, vat_rate: 15 },
            ],
        });
        const credit = computeInvoice({ lines: [{ unit_price_incl: 45, quantity: 1, vat_rate: 15 }] });
        // Compare in minor units: `60.87 - 39.13` is 21.739999999999995 as float.
        expect(toMinor(original.subtotal) - toMinor(credit.subtotal)).toBe(2174);
        expect(toMinor(original.tax_total) - toMinor(credit.tax_total)).toBe(326);
        expect(toMinor(original.total_amount) - toMinor(credit.total_amount)).toBe(2500);
    });
});

describe('10 · mixed VAT rates', () => {
    test('15% + 0% lines each balance and sum correctly', () => {
        const invoice = computeInvoice({
            lines: [
                { unit_price_incl: 115, quantity: 1, vat_rate: 15 }, // 100.00 net + 15.00 vat
                { unit_price_incl: 50, quantity: 1, vat_rate: 0 }, // 50.00 net, zero-rated
            ],
        });
        expect(invoice.subtotal).toBe(150);
        expect(invoice.tax_total).toBe(15);
        expect(invoice.total_amount).toBe(165);
        expect(invoice.balanced).toBe(true);
    });

    test('zero-rated line carries no tax', () => {
        const line = computeLine({ unit_price_incl: 50, quantity: 1, vat_rate: 0 });
        expect(line.vat_amount).toBe(0);
        expect(line.line_net).toBe(50);
    });
});

describe('11 · an unbalanced invoice is rejected, never printed', () => {
    test('assertBalanced throws VatBalanceError with line details', () => {
        const totals = {
            subtotal: 60.87,
            tax_total: 9.2, // the reported bug
            total_amount: 70,
            line_items: [{ product_id: '1', quantity: 1, line_total: 45, line_net: 39.13, vat_amount: 5.9, vat_rate: 15 }],
        };
        expect(() => assertBalanced(totals)).toThrow(VatBalanceError);
        try {
            assertBalanced(totals);
        } catch (err) {
            expect(err.code).toBe('INVOICE_UNBALANCED');
            expect(err.statusCode).toBe(422);
            expect(err.details.delta).toBe(0.07);
            expect(err.details.lines).toHaveLength(1);
        }
    });

    test('the engine itself cannot emit an unbalanced invoice', () => {
        const invoice = computeInvoice({ lines: [{ unit_price_incl: 45, quantity: 1, vat_rate: 15 }] });
        expect(() => assertBalanced(invoice)).not.toThrow();
    });
});

describe('12-13 · totals feed for receipt, QR and ZATCA', () => {
    test('QR/ZATCA payload values equal the line sums', () => {
        const invoice = computeInvoice({
            lines: [
                { unit_price_incl: 45, quantity: 1, vat_rate: 15 },
                { unit_price_incl: 25, quantity: 1, vat_rate: 15 },
            ],
        });
        // buildZatcaTlvInJs receives these three numbers verbatim.
        const zatca = {
            total: invoice.total_amount,
            vat: invoice.tax_total,
            net: invoice.subtotal,
        };
        expect(zatca.net + zatca.vat).toBe(zatca.total);
        expect(zatca.vat).toBe(9.13);
    });

    test('regression: legacy net catalog converts without changing the charge', () => {
        // Stored net prices observed in production: 39.13, 21.74, 86.95, 0.87
        expect(netToInclusivePrice(39.13, 15)).toBe(45);
        expect(netToInclusivePrice(21.74, 15)).toBe(25);
        expect(netToInclusivePrice(86.95, 15)).toBe(99.99);
        expect(netToInclusivePrice(0.87, 15)).toBe(1);
        // 173.92 net is the 2-decimal rounding of 200/1.15 (=173.913…), so the
        // round-trip lands on 200.01 — exactly what the legacy engine charges
        // today (173.92 + 26.09). Documented, not a regression.
        expect(netToInclusivePrice(173.92, 15)).toBe(200.01);
    });
});

describe('15 · legacy net catalog adapter (server write path)', () => {
    test('net lines 39.13 + 21.74 ⇒ 60.87 / 9.13 / 70.00 (the production case)', () => {
        const invoice = computeInvoice({
            lines: [
                { unit_price_net: 39.13, quantity: 1, vat_rate: 15 },
                { unit_price_net: 21.74, quantity: 1, vat_rate: 15 },
            ],
        });
        expect(invoice.subtotal).toBe(60.87);
        expect(invoice.tax_total).toBe(9.13);
        expect(invoice.total_amount).toBe(70);
        expect(invoice.balanced).toBe(true);
    });

    test('net mode keeps one rounding per line: 86.95 × 3 = 260.85 net', () => {
        const invoice = computeInvoice({ lines: [{ unit_price_net: 86.95, quantity: 3, vat_rate: 15 }] });
        expect(invoice.subtotal).toBe(260.85);
        expect(invoice.tax_total).toBe(39.13);
        // Documented limitation: the catalog stores the ROUNDED net price, so
        // 3 × 99.99 published is not recoverable from 86.95. Fixing this needs
        // an inclusive price column (Phase 2 migration), not a rounding patch.
        expect(invoice.total_amount).toBe(299.98);
        expect(invoice.balanced).toBe(true);
    });

    test('zero-rated net lines carry no VAT', () => {
        const invoice = computeInvoice({ lines: [{ unit_price_net: 50, quantity: 2, vat_rate: 0 }] });
        expect(invoice.tax_total).toBe(0);
        expect(invoice.total_amount).toBe(100);
    });

    test('a discount above the line value is rejected, never clamped', () => {
        expect(() => computeInvoice({ lines: [{ unit_price_net: 10, quantity: 1, discount: 11, vat_rate: 15 }] }))
            .toThrow(/Line discount exceeds line value/);
    });

    test('a line without any price field is rejected', () => {
        expect(() => computeInvoice({ lines: [{ quantity: 1, vat_rate: 15 }] })).toThrow(/unit_price_incl or unit_price_net/);
    });
});

describe('14 · agreement with the ZATCA VAT calculator formula', () => {
    test('VAT = total × 15 / 115, rounded half-up, for every published price', () => {
        const prices = [0.01, 0.5, 1, 5, 9.99, 25, 45, 70, 99.99, 130.45, 200, 1000];
        for (const price of prices) {
            const line = computeLine({ unit_price_incl: price, quantity: 1, vat_rate: 15 });
            const expectedVatMinor = divHalfUp(toMinor(price) * 15, 115);
            expect(toMinor(line.vat_amount)).toBe(expectedVatMinor);
            expect(fromMinor(toMinor(line.line_net) + toMinor(line.vat_amount))).toBe(price);
        }
    });

    test('fractional quantity (1.5 kg) stays exact', () => {
        const line = computeLine({ unit_price_incl: 10, quantity: 1.5, vat_rate: 15 });
        expect(line.line_total).toBe(15);
        expect(line.line_net).toBe(13.04);
        expect(line.vat_amount).toBe(1.96);
        expect(line.line_net + line.vat_amount).toBeCloseTo(15, 10);
    });
});
