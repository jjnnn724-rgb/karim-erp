'use strict';
/**
 * zatca/pih.js — Previous Invoice Hash chain (preparation scaffold).
 * PIH = Base64(SHA-256(previous invoice hash bytes)) — مطابق لمنطق السلسلة الداخلية،
 * لكن لم يُعتمد من ZATCA (لا عيّنات/sandbox) ⇒ G11 BLOCKED.
 */
const crypto = require('crypto');

function computePih(previousInvoiceHashBase64) {
    if (typeof previousInvoiceHashBase64 !== 'string' || !previousInvoiceHashBase64) {
        throw new Error('INVALID_PREVIOUS_HASH');
    }
    const bytes = Buffer.from(previousInvoiceHashBase64, 'base64');
    return crypto.createHash('sha256').update(bytes).digest('base64');
}

function verifyPih(previousInvoiceHashBase64, claimedPih) {
    return computePih(previousInvoiceHashBase64) === String(claimedPih || '');
}

module.exports = { computePih, verifyPih };
