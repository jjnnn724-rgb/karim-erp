'use strict';
/** تحقق من بيانات ZATCA على مستوى المستأجر (التنسيق السعودي). */
const VAT_RE = /^\d{15}$/;
const CR_RE = /^\d{10}$/;

function validateVat(value) {
    const v = String(value ?? '').trim();
    return VAT_RE.test(v) ? v : null;
}

function validateCr(value) {
    const c = String(value ?? '').trim();
    return CR_RE.test(c) ? c : null;
}

function validateConfig(body = {}) {
    const vat = validateVat(body.vatNumber ?? body.vat_number);
    const cr = validateCr(body.crNumber ?? body.cr_number);
    const errors = [];
    if (!vat) {errors.push('VAT_FORMAT_INVALID');}
    if (!cr) {errors.push('CR_FORMAT_INVALID');}
    if (typeof body.enabled !== 'undefined' && typeof body.enabled !== 'boolean') {errors.push('ENABLED_INVALID');}
    if (typeof body.sandbox !== 'undefined' && typeof body.sandbox !== 'boolean') {errors.push('SANDBOX_INVALID');}
    return { ok: errors.length === 0, errors, value: { vat, cr, enabled: Boolean(body.enabled), sandbox: body.sandbox !== false } };
}

module.exports = { validateVat, validateCr, validateConfig, VAT_RE, CR_RE };
