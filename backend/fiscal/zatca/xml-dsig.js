'use strict';
/**
 * zatca/xml-dsig.js — هيكل توقيع XML-DSig فقط.
 * لا مفاتيح، لا شهادات، لا توقيع فعلي. التنفيذ الكامل يتطلب CSID/sandbox (G11 BLOCKED).
 */
class FiscalCredentialsRequired extends Error {
    constructor() {
        super('FISCAL_SIGNING_KEY_REQUIRED — CSID signing needs a certificate and private key; none were provided');
        this.name = 'FiscalCredentialsRequired';
        this.code = 'FISCAL_SIGNING_KEY_REQUIRED';
    }
}

function buildSignedEnvelope(xml, _credentials = null) {
    if (!xml || typeof xml !== 'string') {throw new Error('INVALID_XML');}
    throw new FiscalCredentialsRequired();
}

module.exports = { buildSignedEnvelope, FiscalCredentialsRequired };
