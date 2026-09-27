'use strict';

/**
 * tax-rule-service.js — Centralized Saudi VAT rule engine for PURCHASE transactions.
 * ────────────────────────────────────────────────────────────────────────────
 * Chain (never hardcoded): Supplier → Tax Profile → Tax Status →
 * Transaction Treatment → Line Tax Category → Tax Rule Engine → VAT Amount.
 *
 * The standard rate lives in the `tax_config` table (single source of truth).
 * FALLBACK_STANDARD_RATE exists only for pre-migration / offline pure-function
 * use and MUST equal the seeded tax_config value (KSA 15% since 1 July 2020).
 *
 * All money math rounds HALF_UP to 2 decimals per line (ZATCA line-level
 * rounding), then sums — never round-then-round.
 */

const VAT_15_DIGITS = /^[0-9]{15}$/;

// KSA standard rate, effective 1 July 2020 (ZATCA). Fallback only — the DB
// tax_config row is authoritative whenever reachable.
const FALLBACK_STANDARD_RATE = 15;

const TAX_STATUSES = new Set(['REGISTERED', 'NOT_REGISTERED', 'EXEMPT']);
const ITEM_TAX_CATEGORIES = new Set(['STANDARD', 'ZERO_RATED', 'EXEMPT', 'OUT_OF_SCOPE']);

// Arabic-Indic + Extended Arabic-Indic digits → ASCII (normalization, not validation bypass)
function asciiDigits(value) {
  return String(value ?? '')
    .replace(/[٠-٩]/g, d => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/[۰-۹]/g, d => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)));
}

/** Normalize a VAT number: trim, strip separators/spaces, ASCII digits only → 15-digit string or null. */
function normalizeVatNumber(value) {
  if (value === null || value === undefined) {
    return null;
  }
  const digits = asciiDigits(value).replace(/\D/g, '');
  if (digits === '') {
    return null;
  }
  return digits;
}

/** Strict validator: exactly 15 ASCII digits. Returns { ok, normalized, error }. */
function validateVatNumber(value) {
  const normalized = normalizeVatNumber(value);
  if (normalized === null) {
    return { ok: false, normalized: null, error: 'VAT_REQUIRED' };
  }
  if (!VAT_15_DIGITS.test(normalized)) {
    return { ok: false, normalized, error: 'VAT_MUST_BE_15_DIGITS' };
  }
  return { ok: true, normalized, error: null };
}

/**
 * Resolve the applicable tax rate — the ONLY place purchase VAT rates are decided.
 *
 * @param {object} args
 * @param {'PURCHASE'} args.transactionType
 * @param {object} args.supplierTaxProfile { status, vat_number?, country? }
 * @param {'STANDARD'|'ZERO_RATED'|'EXEMPT'|'OUT_OF_SCOPE'} args.itemTaxCategory
 * @param {Date|string} [args.transactionDate]
 * @param {number} [args.standardRate] — from tax_config; falls back to KSA 15%.
 * @returns {{ rate, ruleCode, legalRef }}
 */
function getApplicableTaxRate({
  transactionType,
  supplierTaxProfile,
  itemTaxCategory = 'STANDARD',
  transactionDate = new Date(),
  standardRate = FALLBACK_STANDARD_RATE,
} = {}) {
  if (transactionType !== 'PURCHASE') {
    throw Object.assign(new Error(`Unsupported transaction type: ${transactionType}`), { statusCode: 422 });
  }
  const profile = supplierTaxProfile && typeof supplierTaxProfile === 'object' ? supplierTaxProfile : {};
  const status = String(profile.status || 'NOT_REGISTERED').toUpperCase();
  if (!TAX_STATUSES.has(status)) {
    throw Object.assign(new Error(`Unknown supplier tax status: ${profile.status}`), { statusCode: 422 });
  }
  const category = String(itemTaxCategory || 'STANDARD').toUpperCase();
  if (!ITEM_TAX_CATEGORIES.has(category)) {
    throw Object.assign(new Error(`Unknown item tax category: ${itemTaxCategory}`), { statusCode: 422 });
  }
  const std = Number(standardRate);
  const effectiveStd = Number.isFinite(std) && std >= 0 && std <= 100 ? std : FALLBACK_STANDARD_RATE;
  const txDate = transactionDate instanceof Date ? transactionDate : new Date(transactionDate);
  if (Number.isNaN(txDate.getTime())) {
    throw Object.assign(new Error('Invalid transaction date'), { statusCode: 422 });
  }
  const legalRef = 'KSA VAT Law — standard rate 15% since 1 July 2020 (ZATCA)';

  // Line tax category wins over supplier status (zero-rated/exempt goods stay
  // zero even from a REGISTERED supplier; out-of-scope never taxes).
  if (category === 'ZERO_RATED') {
    return { rate: 0, ruleCode: 'KSA-PURCHASE-ZERO_RATED', legalRef };
  }
  if (category === 'EXEMPT') {
    return { rate: 0, ruleCode: 'KSA-PURCHASE-ITEM_EXEMPT', legalRef };
  }
  if (category === 'OUT_OF_SCOPE') {
    return { rate: 0, ruleCode: 'KSA-PURCHASE-OUT_OF_SCOPE', legalRef };
  }
  // STANDARD goods → supplier status decides deductibility/treatment.
  if (status === 'REGISTERED') {
    return { rate: effectiveStd, ruleCode: 'KSA-PURCHASE-STANDARD-REGISTERED', legalRef };
  }
  if (status === 'NOT_REGISTERED') {
    return { rate: 0, ruleCode: 'KSA-PURCHASE-SUPPLIER_NOT_REGISTERED', legalRef };
  }
  // EXEMPT supplier: conservative no-VAT treatment; business rule lives in
  // tax_config/docs — never silently treated as REGISTERED.
  return { rate: 0, ruleCode: 'KSA-PURCHASE-SUPPLIER_EXEMPT', legalRef };
}

function round2(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    return 0;
  }
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** Line VAT = net × rate%, rounded HALF_UP to 2dp. Net must be ≥ 0. */
function computeLineVat(netAmount, rate) {
  const net = Number(netAmount);
  const r = Number(rate);
  if (!Number.isFinite(net) || net < 0) {
    throw Object.assign(new Error('Line net amount must be a non-negative number'), { statusCode: 422 });
  }
  if (!Number.isFinite(r) || r < 0 || r > 100) {
    throw Object.assign(new Error('Tax rate must be between 0 and 100'), { statusCode: 422 });
  }
  return round2((net * r) / 100);
}

/**
 * Full invoice computation: per-line rule resolution → line VAT → aggregates.
 * Lines: [{ net, taxCategory? }]. Supplier profile applies to every line.
 * Returns { lines: [{ net, rate, vat, ruleCode }], subtotalNet, vatTotal, grandTotal, ruleCode }.
 * ruleCode is the header treatment (first non-zero-rate line's rule, else first line's).
 */
function computeInvoiceVat(lines, supplierTaxProfile, opts = {}) {
  const arr = Array.isArray(lines) ? lines : [];
  if (!arr.length) {
    throw Object.assign(new Error('Invoice needs at least one line'), { statusCode: 422 });
  }
  const out = arr.map(ln => {
    const net = round2(ln.net);
    const { rate, ruleCode } = getApplicableTaxRate({
      transactionType: 'PURCHASE',
      supplierTaxProfile,
      itemTaxCategory: ln.taxCategory || 'STANDARD',
      transactionDate: opts.transactionDate || new Date(),
      standardRate: opts.standardRate,
    });
    return { net, rate, vat: computeLineVat(net, rate), ruleCode };
  });
  const subtotalNet = round2(out.reduce((s, l) => s + l.net, 0));
  const vatTotal = round2(out.reduce((s, l) => s + l.vat, 0));
  const grandTotal = round2(subtotalNet + vatTotal);
  const headerRule = (out.find(l => l.rate > 0) || out[0]).ruleCode;
  return { lines: out, subtotalNet, vatTotal, grandTotal, ruleCode: headerRule };
}

/** Load the authoritative standard rate from tax_config (falls back to KSA 15% on any failure). */
async function loadStandardRate(db) {
  try {
    const row = (await db.query('SELECT standard_vat_rate FROM tax_config WHERE id = 1')).rows[0];
    const rate = Number(row?.standard_vat_rate);
    if (Number.isFinite(rate) && rate >= 0 && rate <= 100) {
      return rate;
    }
  } catch (_) {
    /* table missing pre-migration → fallback */
  }
  return FALLBACK_STANDARD_RATE;
}

module.exports = {
  VAT_15_DIGITS,
  FALLBACK_STANDARD_RATE,
  TAX_STATUSES,
  ITEM_TAX_CATEGORIES,
  asciiDigits,
  normalizeVatNumber,
  validateVatNumber,
  getApplicableTaxRate,
  round2,
  computeLineVat,
  computeInvoiceVat,
  loadStandardRate,
};
