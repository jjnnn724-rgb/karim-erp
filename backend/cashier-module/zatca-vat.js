/**
 * zatca-vat.js — Seller VAT resolution chain for every ZATCA artifact (QR + receipts)
 * ────────────────────────────────────────────────────────────────────────────────────
 * The ZATCA settings hub (zatca_settings) is the single source of truth that the
 * owner manages entirely from the settings screen — no code, no SQL. Departments
 * may still carry their own VAT number (multi-entity support).
 *
 * Resolution order (first VALID 15-digit VAT wins):
 *   1. department VAT          (branch-level override)
 *   2. ZATCA settings hub VAT  (managed from الضبط ← ZATCA in the UI)
 *   3. hardcoded placeholder   → placeholder=true, every layer must warn loudly
 *
 * WHY: previously the sale path read ONLY pos_departments.vat_number, so a VAT
 * number saved in the settings hub never reached invoices/QRs — a settings
 * screen that silently did nothing. This module is the single tested chokepoint.
 */

const ZATCA_PLACEHOLDER_VAT = '300000000000003'; // official ZATCA sample VAT — never a real seller
const VAT_15_DIGITS = /^\d{15}$/;

/** Digits-only normalization → 15-digit VAT or null. Accepts '3-0-0…', ' 3000… ', 3000…(number). */
function normalizeVat(value) {
    if (value === null || value === undefined) {return null;}
    const digits = String(value).replace(/\D/g, '');
    return VAT_15_DIGITS.test(digits) ? digits : null;
}

/**
 * Resolve the seller VAT for a ZATCA artifact.
 * @returns {{vat: string, placeholder: boolean, source: 'department'|'settings_hub'|'placeholder'}}
 */
function resolveSellerVat({ deptVat, settingsVat } = {}) {
    const dept = normalizeVat(deptVat);
    if (dept) {return { vat: dept, placeholder: false, source: 'department' };}

    const hub = normalizeVat(settingsVat);
    if (hub) {return { vat: hub, placeholder: false, source: 'settings_hub' };}

    return { vat: ZATCA_PLACEHOLDER_VAT, placeholder: true, source: 'placeholder' };
}

module.exports = { resolveSellerVat, normalizeVat, ZATCA_PLACEHOLDER_VAT };
