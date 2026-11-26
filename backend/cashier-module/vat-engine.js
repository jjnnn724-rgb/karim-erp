'use strict';

/**
 * vat-engine.js — KARIM ERP inclusive-first VAT engine (single source of truth).
 * ============================================================================
 * WHY THIS FILE EXISTS
 * --------------------
 * The sale was priced by three different engines (cashier write path, V3
 * preview, V2 preview), each mixing float arithmetic, `toFixed()` and
 * `Math.round()`. Rounding differences produced invoices where
 * `net + vat !== total` and forced the reports to display a separate
 * "تسوية / rounding adjustment" line. That line is now forbidden.
 *
 * ACCOUNTING MODEL (inclusive-first, line level)
 * ----------------------------------------------
 *   1. The price the customer sees is VAT-INCLUSIVE.
 *   2. Every line is rounded ONCE, to 2 decimals, with ROUND_HALF_UP.
 *   3. net  = ROUND_HALF_UP(line_total_incl / (1 + vat_rate))
 *      vat  = line_total_incl - net          (no second rounding)
 *   4. Invoice = SUM of lines. Never `total_incl - total_excl`.
 *   5. Therefore `SUM(net) + SUM(vat) === SUM(incl)` holds by construction,
 *      and any residual is a programming error, not a business amount.
 *
 * INTEGER MONEY
 * -------------
 * All monetary math runs on integers in minor units (halalas = 1/100 SAR).
 * No float touches money between input parsing and output formatting.
 * Quantities are integers in milli-units (1 unit = 1000) so fractional
 * weights (1.5 kg) stay exact.
 *
 * ROUNDING
 * --------
 * ROUND_HALF_UP is implemented explicitly (`divHalfUp`) instead of relying on
 * `Math.round`, because JS `Math.round(-0.5)` is HALF-UP-TO-+∞ and would
 * silently bias credit notes (negative lines) by one halala.
 */

/** Financial balance tolerance required by the spec (0.005 of a currency unit). */
const VAT_BALANCE_TOLERANCE = 0.005;

/** Minor-unit scale: 1 currency unit = 100 minor units. */
const MONEY_SCALE = 100;
/** Quantity scale: 1 unit = 1000 milli-units. */
const QTY_SCALE = 1000;
/** VAT rate scale: 1 percentage point = 1000 rate-milli. */
const RATE_SCALE = 1000;

/**
 * Error raised when a computed invoice does not satisfy net + vat = total.
 * Carries a machine-readable code and the offending lines so callers can log
 * them without inspecting the stack.
 */
class VatBalanceError extends Error {
    constructor(message, details = {}) {
        super(message);
        this.name = 'VatBalanceError';
        this.code = 'INVOICE_UNBALANCED';
        this.statusCode = 422;
        this.details = details;
    }
}

/**
 * ROUND_HALF_UP integer division (ties away from zero).
 * `Math.round` cannot be used: it rounds ties toward +Infinity, which would
 * make negative lines (credit notes, returns) drift by one minor unit.
 *
 * @param {number} numerator
 * @param {number} denominator
 * @returns {number}
 */
function divHalfUp(numerator, denominator) {
    if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) {
        throw Object.assign(new Error(`divHalfUp: invalid operands ${numerator}/${denominator}`), {
            code: 'INVALID_DECIMAL_OPERATION',
        });
    }
    const negative = (numerator < 0) !== (denominator < 0);
    const absNum = Math.abs(Math.trunc(numerator));
    const absDen = Math.abs(Math.trunc(denominator));
    const quotient = Math.floor(absNum / absDen);
    const remainder = absNum - quotient * absDen;
    const rounded = remainder * 2 >= absDen ? quotient + 1 : quotient;
    return negative ? -rounded : rounded;
}

/**
 * Parse a decimal value into an integer scaled by `scale`, ROUND_HALF_UP.
 *
 * Implemented on the shortest decimal representation (BigInt), NOT on
 * `value * scale`, because `9.2 * 100 === 919.9999999999999` in IEEE-754 and
 * would silently shave one halala off every 9.20 amount — the exact class of
 * bug this module exists to kill.
 *
 * @param {number|string|null|undefined} value
 * @param {number} scale  power of ten, e.g. 100 or 1000
 * @param {string} code   error code used when the value is not numeric
 * @returns {number} integer
 */
function toScaledInt(value, scale, code) {
    if (value === null || value === undefined || value === '') {return 0;}
    const text = typeof value === 'string' ? value.trim() : String(value);
    const match = /^([+-]?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(text);
    if (!match || (!match[2] && !match[3])) {
        throw Object.assign(new Error(`Invalid numeric value: ${String(value)}`), { code });
    }
    const negative = match[1] === '-';
    const intPart = match[2] || '0';
    const fracPart = match[3] || '';
    const exponent = Number(match[4] || 0);
    const scalePow = Math.round(Math.log10(scale));
    const shift = exponent - fracPart.length + scalePow;

    let digits = BigInt((intPart + fracPart) || '0');
    if (negative) {digits = -digits;}

    let result;
    if (shift >= 0) {
        result = digits * (10n ** BigInt(shift));
    } else {
        const divisor = 10n ** BigInt(-shift);
        result = digits / divisor;
        const remainder = digits % divisor;
        const twice = (remainder < 0n ? -remainder : remainder) * 2n;
        if (twice >= divisor) {result += digits < 0n ? -1n : 1n;}
    }

    const asNumber = Number(result);
    if (!Number.isSafeInteger(asNumber)) {
        throw Object.assign(new Error(`Value out of range: ${String(value)}`), { code });
    }
    return asNumber;
}

/**
 * Parse any money-ish value into integer minor units, half-up.
 * Accepts numbers and numeric strings ("39.13"); rejects NaN/holes so a bad
 * payload fails loudly instead of becoming 0.00.
 *
 * @param {number|string|null|undefined} value
 * @returns {number} integer minor units
 */
function toMinor(value) {
    return toScaledInt(value, MONEY_SCALE, 'INVALID_MONEY_VALUE');
}

/**
 * Parse a quantity into integer milli-units.
 * @param {number|string|null|undefined} value
 * @returns {number}
 */
function toMilliQty(value) {
    return toScaledInt(value, QTY_SCALE, 'INVALID_QUANTITY');
}

/**
 * Minor units → 2-decimal number (display / JSON / NUMERIC(14,2) columns).
 * Built from string parts so the result never carries float noise.
 */
function fromMinor(minor) {
    const n = Math.trunc(minor);
    const negative = n < 0;
    const abs = Math.abs(n);
    const whole = Math.floor(abs / MONEY_SCALE);
    const cents = String(abs % MONEY_SCALE).padStart(2, '0');
    return Number(`${negative ? '-' : ''}${whole}.${cents}`);
}

/**
 * Milli-units → quantity number with no float noise (1500 → 1.5, 1000 → 1).
 * @param {number} milli
 * @returns {number}
 */
function fromMilliQty(milli) {
    const n = Math.trunc(milli);
    const negative = n < 0;
    const abs = Math.abs(n);
    const whole = Math.floor(abs / QTY_SCALE);
    const frac = String(abs % QTY_SCALE).padStart(3, '0').replace(/0+$/, '');
    return Number(`${negative ? '-' : ''}${whole}${frac ? `.${frac}` : ''}`);
}

/** Percentage → integer rate-milli (15 → 15000). */
function toRateMilli(vatRate) {
    const milli = toScaledInt(vatRate, RATE_SCALE, 'INVALID_VAT_RATE');
    if (milli < 0) {
        throw Object.assign(new Error(`Invalid VAT rate: ${String(vatRate)}`), { code: 'INVALID_VAT_RATE' });
    }
    return milli;
}

/**
 * Adapter: stored NET price → published INCLUSIVE price.
 *
 * The catalog is currently stored net-of-VAT (200.00 net = 173.92 stored), so
 * inclusive-first pricing needs one deterministic conversion. Rounding the
 * inclusive price half-up reproduces the price the customer actually sees
 * (173.92 × 1.15 = 199.9995 → 200.00) and keeps every legacy total intact.
 *
 * NOTE: no float is involved beyond parsing; the multiplication is done in
 * integer minor units with a scaled rate.
 *
 * @param {number|string} netPrice  net (VAT-exclusive) price
 * @param {number|string} vatRate   percent, e.g. 15
 * @returns {number} inclusive price in currency units (2 decimals)
 */
function netToInclusivePrice(netPrice, vatRate) {
    const netMinor = toMinor(netPrice);
    const rateMilli = toRateMilli(vatRate);
    // net × (100000 + rateMilli) / 100000, all integers.
    const inclusiveMinor = divHalfUp(netMinor * (100000 + rateMilli), 100000);
    return fromMinor(inclusiveMinor);
}

/**
 * Split an inclusive amount into net + vat exactly.
 * @param {number} inclMinor
 * @param {number} rateMilli
 * @returns {{ netMinor: number, vatMinor: number }}
 */
function splitInclusive(inclMinor, rateMilli) {
    const netMinor = divHalfUp(inclMinor * 100000, 100000 + rateMilli);
    return { netMinor, vatMinor: inclMinor - netMinor };
}

/**
 * Distribute an invoice-level discount across lines, pro-rata to line gross.
 * Each share is half-up rounded; the residual (at most a few minor units) is
 * absorbed by the last line with a non-zero share. The residual is INTERNAL:
 * it adjusts a line's total, it never appears as its own invoice line.
 *
 * @param {number[]} grossMinors
 * @param {number} discountMinor  positive discount in minor units
 * @returns {number[]} per-line discount in minor units (sum === discountMinor)
 */
function allocateInvoiceDiscount(grossMinors, discountMinor) {
    if (!discountMinor) {return grossMinors.map(() => 0);}
    const total = grossMinors.reduce((s, v) => s + v, 0);
    if (total <= 0) {return grossMinors.map(() => 0);}

    const shares = grossMinors.map((gross) => divHalfUp(gross * discountMinor, total));
    const allocated = shares.reduce((s, v) => s + v, 0);
    let residual = discountMinor - allocated;

    // Absorb the residual on the largest line, never on a zero-value line.
    while (residual !== 0) {
        let target = -1;
        for (let i = 0; i < shares.length; i += 1) {
            if (grossMinors[i] - shares[i] <= 0) {continue;}
            if (target === -1 || grossMinors[i] > grossMinors[target]) {target = i;}
        }
        if (target === -1) {break;}
        const step = residual > 0 ? 1 : -1;
        if (shares[target] + step < 0) {break;}
        shares[target] += step;
        residual -= step;
    }
    return shares.map((share, i) => Math.min(share, grossMinors[i]));
}

/**
 * Resolve which price convention a line uses.
 *  · `unit_price_incl` — published price, VAT included (preferred / spec).
 *  · `unit_price_net`  — legacy catalog price, VAT excluded (adapter).
 */
function resolveLineMode(line) {
    if (line.unit_price_incl !== undefined && line.unit_price_incl !== null) {return 'inclusive';}
    if (line.unit_price_net !== undefined && line.unit_price_net !== null) {return 'net';}
    throw Object.assign(new Error('Line requires unit_price_incl or unit_price_net'), {
        code: 'MISSING_LINE_PRICE',
    });
}

/**
 * Normalise one input line into integer intermediates.
 * Discounts are expressed in the same convention as the line price (VAT
 * inclusive for inclusive lines, VAT exclusive for legacy net lines) so that
 * existing discount semantics are preserved.
 */
function prepareLine(line) {
    const mode = resolveLineMode(line);
    const priceMinor = toMinor(mode === 'inclusive' ? line.unit_price_incl : line.unit_price_net);
    if (priceMinor < 0) {
        throw Object.assign(new Error('Line price cannot be negative'), { code: 'NEGATIVE_LINE_PRICE' });
    }
    const qtyMilli = toMilliQty(line.quantity);
    if (qtyMilli < 0) {
        throw Object.assign(new Error('Line quantity cannot be negative'), { code: 'NEGATIVE_QUANTITY' });
    }
    const rateMilli = toRateMilli(line.vat_rate);
    const grossMinor = divHalfUp(priceMinor * qtyMilli, QTY_SCALE);
    const requestedDiscountMinor = toMinor(line.discount || 0);
    if (requestedDiscountMinor < 0) {
        throw Object.assign(new Error('Line discount cannot be negative'), { code: 'INVALID_DISCOUNT' });
    }
    if (requestedDiscountMinor > grossMinor) {
        // Never clamp silently: a discount above the line value is a data or
        // authorisation error, not an amount to be "fixed".
        throw Object.assign(new Error('Line discount exceeds line value'), { code: 'INVALID_DISCOUNT' });
    }
    const discountMinor = requestedDiscountMinor;
    return { mode, priceMinor, qtyMilli, rateMilli, grossMinor, discountMinor, baseMinor: grossMinor - discountMinor };
}

/**
 * Finalise one prepared line into net / vat / inclusive total.
 *
 * INCLUSIVE (spec):  net = ROUND_HALF_UP(base / (1 + rate)); vat = base - net.
 * NET (legacy):      net = base; vat = ROUND_HALF_UP(net × rate); total = net + vat.
 *
 * Both branches round exactly once, and both define the total as a SUM, so
 * `net + vat === total` is true by construction.
 */
function finaliseLine(prepared, invoiceDiscountMinor, sourceLine) {
    const baseMinor = prepared.baseMinor - invoiceDiscountMinor;
    if (baseMinor < 0) {
        throw Object.assign(new Error('Invoice discount exceeds line value'), { code: 'INVALID_DISCOUNT' });
    }

    let netMinor;
    let vatMinor;
    let totalMinor;
    if (prepared.mode === 'inclusive') {
        const split = splitInclusive(baseMinor, prepared.rateMilli);
        netMinor = split.netMinor;
        vatMinor = split.vatMinor;
        totalMinor = baseMinor;
    } else {
        netMinor = baseMinor;
        vatMinor = divHalfUp(netMinor * prepared.rateMilli, 100000);
        totalMinor = netMinor + vatMinor;
    }

    return {
        unit_price: fromMinor(prepared.priceMinor),
        quantity: Number(sourceLine.quantity),
        discount: fromMinor(prepared.discountMinor + invoiceDiscountMinor),
        vat_rate: Number(sourceLine.vat_rate),
        line_total: fromMinor(totalMinor),
        line_net: fromMinor(netMinor),
        vat_amount: fromMinor(vatMinor),
        price_mode: prepared.mode,
        _minor: { price: prepared.priceMinor, gross: prepared.grossMinor, total_incl: totalMinor, net: netMinor, vat: vatMinor },
    };
}

/**
 * Compute a single line (inclusive-first by default).
 *
 * @param {object} line
 * @param {number|string} [line.unit_price_incl] published price, VAT included
 * @param {number|string} [line.unit_price_net]  legacy net price (adapter)
 * @param {number|string} line.quantity
 * @param {number|string} [line.discount]
 * @param {number|string} line.vat_rate         percent (15, 0, …)
 * @param {number} [line.invoice_discount_minor] internal pro-rata share
 */
function computeLine(line) {
    const prepared = prepareLine(line);
    const invoiceDiscountMinor = Math.min(
        prepared.baseMinor,
        Math.max(0, Math.trunc(line.invoice_discount_minor || 0))
    );
    const { _minor, ...rest } = finaliseLine(prepared, invoiceDiscountMinor, line);
    return { ...rest, _minor };
}

/**
 * Compute an invoice from line-level prices.
 *
 * @param {object} input
 * @param {Array<object>} input.lines
 * @param {number|string} [input.invoice_discount] invoice-level discount in the
 *        same convention as the lines (pro-rata, internal residual, never a line)
 * @returns {{ subtotal:number, discount_total:number, tax_total:number,
 *             total_amount:number, line_items:Array<object>, balanced:boolean }}
 */
function computeInvoice(input) {
    const lines = Array.isArray(input?.lines) ? input.lines : [];
    if (!lines.length) {
        throw Object.assign(new Error('Invoice must contain at least one line'), { code: 'EMPTY_INVOICE' });
    }

    const prepared = lines.map((line) => prepareLine(line));
    const invoiceDiscountMinor = Math.max(0, toMinor(input?.invoice_discount || 0));

    if (invoiceDiscountMinor > 0) {
        const modes = new Set(prepared.map((p) => p.mode));
        if (modes.size > 1) {
            // Allocating one discount across two price conventions would mix
            // VAT-inclusive and VAT-exclusive money in the same ratio.
            throw Object.assign(new Error('Invoice discount requires homogeneous price modes'), {
                code: 'MIXED_PRICE_MODES',
            });
        }
    }

    const shares = allocateInvoiceDiscount(prepared.map((p) => p.baseMinor), invoiceDiscountMinor);
    const lineItems = prepared.map((p, i) => {
        const { _minor, ...rest } = finaliseLine(p, shares[i], lines[i]);
        return { ...rest, _minor };
    });

    const subtotalMinor = lineItems.reduce((s, li) => s + li._minor.net, 0);
    const taxMinor = lineItems.reduce((s, li) => s + li._minor.vat, 0);
    const totalMinor = lineItems.reduce((s, li) => s + li._minor.total_incl, 0);
    const discountMinor = lineItems.reduce((s, li) => s + toMinor(li.discount), 0);

    const totals = {
        subtotal: fromMinor(subtotalMinor),
        discount_total: fromMinor(discountMinor),
        tax_total: fromMinor(taxMinor),
        total_amount: fromMinor(totalMinor),
        line_items: lineItems.map(({ _minor, ...rest }) => rest),
        balanced: subtotalMinor + taxMinor === totalMinor,
        _minor: { net: subtotalMinor, vat: taxMinor, total: totalMinor, discount: discountMinor },
    };

    // Fail closed: an unbalanced invoice must never reach the database, the
    // printer or ZATCA. This is an assertion, not a business rule.
    assertBalanced(totals, { phase: 'computeInvoice' });
    return totals;
}

/**
 * Compute a CREDIT NOTE (إشعار دائن) for an issued invoice.
 *
 * The credit note reverses the exact money that was charged, not a re-priced
 * copy of it: each returned line contributes a share of the *inclusive* amount
 * that was actually invoiced (`net + vat` as stored). Returning a full line
 * therefore reverses `net` and `vat` verbatim, and returning every line
 * reverses the invoice to the halala — `credit.net === -invoice.net`, etc.
 *
 * For a partial quantity the inclusive refund is a proportional slice
 * (`divHalfUp`) split once at the line's own VAT rate. The split telescopes on
 * `already_returned`, so returning a line in two batches sums to the stored
 * amount exactly — no residual ever needs a "settlement" line. Negative
 * numbers come from the same ties-away-from-zero rule as positive invoices.
 *
 * @param {Array<{key?: string|number, quantity:number|string, net:number|string,
 *                vat:number|string, vat_rate:number|string}>} invoiceLines
 *        lines as stored on the issued invoice (net and vat are positive)
 * @param {Array<{key?: string|number, index?: number, quantity:number|string,
 *                already_returned?:number|string}>} returnLines
 *        requested returns; `key` matches the invoice line, `index` is a
 *        0-based fallback, `already_returned` is the quantity credited earlier
 * @returns {{ credit:true, subtotal:number, tax_total:number,
 *             total_amount:number, line_items:Array<object>, balanced:true,
 *             _minor:{net:number,vat:number,total:number} }}
 */
function computeCreditNote(invoiceLines, returnLines) {
    if (!Array.isArray(invoiceLines) || !invoiceLines.length) {
        throw Object.assign(new Error('Invoice must contain at least one line'), { code: 'EMPTY_INVOICE' });
    }
    if (!Array.isArray(returnLines) || !returnLines.length) {
        throw Object.assign(new Error('Credit note requires at least one returned line'), {
            code: 'RETURN_EMPTY',
        });
    }

    const prepared = invoiceLines.map((line, index) => {
        const netMinor = toMinor(line.net);
        const vatMinor = toMinor(line.vat);
        if (netMinor < 0 || vatMinor < 0) {
            throw Object.assign(new Error('Invoice line net/vat must be non-negative'), {
                code: 'INVALID_INVOICE_LINE',
            });
        }
        return {
            key: line.key === undefined || line.key === null ? index : String(line.key),
            index,
            quantity: toMilliQty(line.quantity),
            netMinor,
            vatMinor,
            inclusiveMinor: netMinor + vatMinor,
            rateMilli: toRateMilli(line.vat_rate),
        };
    });

    const byKey = new Map(prepared.map((line) => [line.key, line]));
    const seen = new Set();
    const items = returnLines.map((requested) => {
        const rawKey = requested?.key !== undefined && requested?.key !== null
            ? String(requested.key)
            : (requested?.index !== undefined && requested?.index !== null ? String(requested.index) : '');
        const source = byKey.get(rawKey);
        if (!source) {
            throw Object.assign(new Error(`Unknown invoice line: ${rawKey || '(empty)'}`), {
                code: 'RETURN_UNKNOWN_LINE',
            });
        }
        if (seen.has(source.key)) {
            throw Object.assign(new Error(`Duplicate return line: ${source.key}`), {
                code: 'RETURN_DUPLICATE_LINE',
            });
        }
        seen.add(source.key);

        const qtyMilli = toMilliQty(requested?.quantity);
        if (qtyMilli <= 0) {
            throw Object.assign(new Error(`Return quantity must be positive on line ${source.key}`), {
                code: 'RETURN_INVALID_QUANTITY',
            });
        }
        const alreadyMilli = toMilliQty(requested?.already_returned || 0);
        if (alreadyMilli < 0) {
            throw Object.assign(new Error(`Already returned quantity cannot be negative on line ${source.key}`), {
                code: 'RETURN_INVALID_QUANTITY',
            });
        }
        const cumMilli = alreadyMilli + qtyMilli;
        if (cumMilli > source.quantity) {
            throw Object.assign(
                new Error(`Return quantity exceeds invoiced quantity on line ${source.key}`),
                {
                    code: 'RETURN_QUANTITY_EXCEEDED',
                    details: {
                        line: source.key,
                        invoiced: source.quantity / QTY_SCALE,
                        already_returned: alreadyMilli / QTY_SCALE,
                        requested: qtyMilli / QTY_SCALE,
                    },
                }
            );
        }

        // Telescoping split: credit(cumulative) − credit(previous). A line
        // returned in batches therefore reverses the stored net/vat to the
        // halala (the last batch lands exactly on `inclusiveMinor`), instead
        // of drifting one minor unit per proportional rounding.
        const sliceOf = (qtyMilliSlice) => {
            if (qtyMilliSlice <= 0) {return { incl: 0, net: 0, vat: 0 };}
            if (qtyMilliSlice >= source.quantity) {
                return { incl: source.inclusiveMinor, net: source.netMinor, vat: source.vatMinor };
            }
            const incl = divHalfUp(source.inclusiveMinor * qtyMilliSlice, source.quantity);
            const split = splitInclusive(incl, source.rateMilli);
            return { incl, net: split.netMinor, vat: split.vatMinor };
        };
        const previous = sliceOf(alreadyMilli);
        const cumulative = sliceOf(cumMilli);
        const refundIncl = cumulative.incl - previous.incl;
        const refundNet = cumulative.net - previous.net;
        const refundVat = cumulative.vat - previous.vat;

        return {
            key: source.key,
            quantity: -fromMilliQty(qtyMilli),
            netMinor: -refundNet,
            vatMinor: -refundVat,
            inclusiveMinor: -refundIncl,
            rateMilli: source.rateMilli,
        };
    });

    const netSum = items.reduce((s, li) => s + li.netMinor, 0);
    const vatSum = items.reduce((s, li) => s + li.vatMinor, 0);
    const totalSum = items.reduce((s, li) => s + li.inclusiveMinor, 0);

    const creditNote = {
        credit: true,
        subtotal: fromMinor(netSum),
        tax_total: fromMinor(vatSum),
        total_amount: fromMinor(totalSum),
        line_items: items.map((li) => ({
            key: li.key,
            quantity: li.quantity,
            vat_rate: li.rateMilli / RATE_SCALE,
            line_net: fromMinor(li.netMinor),
            vat_amount: fromMinor(li.vatMinor),
            line_total_incl: fromMinor(li.inclusiveMinor),
        })),
        balanced: netSum + vatSum === totalSum,
        _minor: { net: netSum, vat: vatSum, total: totalSum },
    };

    assertBalanced(creditNote, { phase: 'computeCreditNote' });
    return creditNote;
}

/**
 * Assert `net + vat === total` (exactly, in minor units).
 * @param {{subtotal:number,tax_total:number,total_amount:number,line_items?:Array<object>}} totals
 * @param {object} [context]
 * @returns {true}
 */
function assertBalanced(totals, context = {}) {
    const net = toMinor(totals?.subtotal);
    const vat = toMinor(totals?.tax_total);
    const total = toMinor(totals?.total_amount);
    const deltaMinor = net + vat - total;
    if (deltaMinor !== 0) {
        throw new VatBalanceError(
            `الفاتورة غير متوازنة: الصافي ${fromMinor(net).toFixed(2)} + الضريبة ${fromMinor(vat).toFixed(2)}`
            + ` ≠ الإجمالي ${fromMinor(total).toFixed(2)} (فرق ${fromMinor(deltaMinor).toFixed(2)})`,
            {
                context,
                net: fromMinor(net),
                vat: fromMinor(vat),
                total: fromMinor(total),
                delta: fromMinor(deltaMinor),
                lines: Array.isArray(totals?.line_items)
                    ? totals.line_items.map((li) => ({
                        product_id: li.product_id ?? null,
                        quantity: li.quantity,
                        line_total: li.line_total,
                        line_net: li.line_net,
                        vat_amount: li.vat_amount,
                        vat_rate: li.vat_rate,
                    }))
                    : [],
            }
        );
    }
    return true;
}

module.exports = {
    VAT_BALANCE_TOLERANCE,
    MONEY_SCALE,
    QTY_SCALE,
    RATE_SCALE,
    VatBalanceError,
    divHalfUp,
    toMinor,
    toMilliQty,
    fromMinor,
    fromMilliQty,
    toRateMilli,
    netToInclusivePrice,
    splitInclusive,
    allocateInvoiceDiscount,
    computeLine,
    computeInvoice,
    computeCreditNote,
    assertBalanced,
};
