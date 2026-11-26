'use strict';
/**
 * zatca/qr.js — توليد QR بصيغة TLV (9 حقول) — preparation scaffold.
 * الترتيب مطابق للكود الحالي في backend/cashier-module/zatca-tlv.js:
 *  1 sellerName · 2 vatNumber · 3 timestamp · 4 total · 5 vatTotal
 *  6 hash · 7 signature · 8 publicKey · 9 certificateDigest
 * لم يُتحقق منه مقابل عيّنة رسمية من ZATCA ⇒ لا يُستخدم للإرسال (G11 BLOCKED).
 */

function tlvRecord(tag, value) {
    const bytes = Buffer.isBuffer(value) ? value : Buffer.from(String(value ?? ''), 'utf8');
    if (tag < 0 || tag > 255) {throw new Error('INVALID_TLV_TAG');}
    if (bytes.length > 255) {throw new Error('TLV_VALUE_TOO_LONG');}
    return Buffer.concat([Buffer.from([tag, bytes.length]), bytes]);
}

function buildQrTlv(fields) {
    if (!fields || typeof fields !== 'object') {throw new Error('INVALID_QR_FIELDS');}
    const parts = [
        tlvRecord(1, fields.sellerName),
        tlvRecord(2, fields.vatNumber),
        tlvRecord(3, fields.timestamp),
        tlvRecord(4, String(fields.total)),
        tlvRecord(5, String(fields.vatTotal)),
        tlvRecord(6, Buffer.from(String(fields.hash || ''), 'base64')),
        tlvRecord(7, Buffer.from(String(fields.signature || ''), 'base64')),
        tlvRecord(8, Buffer.from(String(fields.publicKey || ''), 'base64')),
        tlvRecord(9, Buffer.from(String(fields.certificateDigest || ''), 'base64')),
    ];
    return Buffer.concat(parts).toString('base64');
}

function parseQrTlv(base64) {
    const buf = Buffer.from(String(base64 || ''), 'base64');
    const out = {};
    let i = 0;
    while (i + 2 <= buf.length) {
        const tag = buf[i]; const len = buf[i + 1];
        if (i + 2 + len > buf.length) {throw new Error('MALFORMED_TLV');}
        out[tag] = buf.subarray(i + 2, i + 2 + len);
        i += 2 + len;
    }
    if (i !== buf.length) {throw new Error('MALFORMED_TLV');}
    return out;
}

module.exports = { tlvRecord, buildQrTlv, parseQrTlv };
