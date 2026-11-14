/**
 * zatca-tlv.js — ZATCA Phase-2 QR TLV builder
 * ════════════════════════════════════════════════════════════════════════════
 * الوسوم (Tag layout — Simplified Tax Invoice):
 *   1  Seller Name (اسم البائع المسجل في zatca_settings.seller_name)
 *   2  Company Identification Number (VAT/TIN — zatca_settings.vat_number)
 *   3  Invoice Timestamp (UTC ISO8601)
 *   4  Invoice Total (شامل الضريبة — SAR)
 *   5  Total VAT (مجموع الضريبة — SAR)
 *   6  Invoice Hash (SHA-256 base64 — من pos_orders.invoice_hash مُحوَّل hex→bin64)
 *   7  ECDSA Signature (base64 — توقيع الرقم المرجعي)
 *   8  ECDSA Public Key (base64 — مفتاح التوقيع العام)
 *   9  ZATCA CA Public Key Hash — شهادة CSID/XAdES (base64 — هشّ الشهادة)
 *
 * كل سجل TLV = [1 byte tag][1 byte length][N bytes UTF-8 value].
 * Base64 للناتج، ويُفك كالتالي للتحقق:
 *   1. atob → bytes; تتابعي: tag,len,value repeating.
 *   2. tag 6/7/9 تُقارن مع قيم الفاتورة والشهادة.
 *
 * ملاحظة الأمان: لا يُشتق TLV من بيانات لم يتحقق منها توقيعها. هذه الدالة
 * تبني المُخرَج فقط؛ سلامة المحتوى مسؤول عنها المُوقِّع.
 */
'use strict';

const { createHash } = require('crypto');

function hexToBuf(hex) {
    if (!/^[0-9a-fA-F]+$/.test(hex || '') || hex.length % 2) {
        return null;
    }
    return Buffer.from(hex, 'hex');
}

/** @param {Buffer|string} value — bytes أو hex-string */
function toBuffer(value) {
    if (value == null) {return null;}
    if (Buffer.isBuffer(value)) {return value;}
    return hexToBuf(String(value));
}

/** @returns {Buffer|null} — null لو الطول > 255 أو الوسم غير معروف */
function tlvRecord(tag, value) {
    const tagByte = Number(tag);
    if (!Number.isInteger(tagByte) || tagByte < 1 || tagByte > 9) {
        throw new RangeError(`TLV tag must be 1..9, got ${tag}`);
    }
    const bytes = Buffer.isBuffer(value) ? value : Buffer.from(String(value), 'utf-8');
    if (bytes.length > 255) {
        throw new RangeError(`TLV value too long (>255 bytes) for tag ${tag}`);
    }
    const buf = Buffer.allocUnsafe(2 + bytes.length);
    buf.writeUInt8(tagByte, 0);
    buf.writeUInt8(bytes.length, 1);
    bytes.copy(buf, 2);
    return buf;
}

/** تفكيك TLV buffer إلى مصفوفة {tag, value} */
function parseTlv(buffer) {
    const records = [];
    let offset = 0;
    while (offset + 2 <= buffer.length) {
        const tag = buffer.readUInt8(offset);
        const len = buffer.readUInt8(offset + 1);
        if (offset + 2 + len > buffer.length) {break;}
        records.push({ tag, value: Buffer.from(buffer.subarray(offset + 2, offset + 2 + len)) });
        offset += 2 + len;
    }
    return records;
}

/**
 * بناء حمولة TLV المرحلة الثانية كاملة.
 * @param {{
 *   sellerName: string,
 *   vatNumber: string,
 *   timestamp: Date|string,
 *   total: number|string,
 *   vatTotal: number|string,
 *   invoiceHashHex: string,     // pos_orders.invoice_hash (SHA-256 hex)
 *   signatureB64: string,       // base64(ECDSA-SHA256)
 *   publicKeyB64: string,       // base64(SubjectPublicKeyInfo DER) أو spki متصدر
 *   certificateDerB64?: string, // base64(DER CSID) — هشّه يُرسل في Tag 9
 * }} invoice
 */
function buildPhase2Tlv(invoice) {
    const d = invoice.timestamp instanceof Date ? invoice.timestamp : new Date(invoice.timestamp);
    if (Number.isNaN(d.getTime())) {
        throw new TypeError('timestamp غير صالح للمرحلة الثانية');
    }
    const isoUtc = d.toISOString().replace(/\.\d{3}Z$/, 'Z');
    const hashBytes = toBuffer(invoice.invoiceHashHex);
    if (!hashBytes) {throw new TypeError('invoiceHashHex يجب أن يكون hex SHA-256');}
    const parts = [
        tlvRecord(1, invoice.sellerName),
        tlvRecord(2, invoice.vatNumber),
        tlvRecord(3, isoUtc),
        tlvRecord(4, Number(invoice.total).toFixed(2)),
        tlvRecord(5, Number(invoice.vatTotal).toFixed(2)),
        tlvRecord(6, hashBytes),
        tlvRecord(7, Buffer.from(String(invoice.signatureB64), 'base64')),
        tlvRecord(8, Buffer.from(String(invoice.publicKeyB64), 'base64')),
    ];
    if (invoice.certificateDerB64) {
        const certDigest = createHash('sha256')
            .update(Buffer.from(String(invoice.certificateDerB64), 'base64'))
            .digest();
        parts.push(tlvRecord(9, certDigest));
    }
    return Buffer.concat(parts).toString('base64');
}

/**
 * التوافق مع المرحلة الأولى (للترحيل فقط): TLV بلا خواص المرحلة الثانية.
 * الكود الإنتاجي الحالي يعتمد عليها؛ تُستبدل تدريجيًا بـ buildPhase2Tlv.
 */
function buildZatcaTlvInJs({ sellerName, vatNumber, timestamp, total, vatTotal, counter, uuid }) {
    const d = timestamp instanceof Date ? timestamp : new Date(timestamp);
    const isoUtc = d.toISOString().replace(/\.\d{3}Z$/, 'Z');
    const parts = [
        tlvRecord(1, sellerName),
        tlvRecord(2, vatNumber),
        tlvRecord(3, isoUtc),
        tlvRecord(4, Number(total).toFixed(2)),
        tlvRecord(5, Number(vatTotal).toFixed(2)),
        tlvRecord(6, String(counter)),
        tlvRecord(7, String(uuid)),
    ];
    return Buffer.concat(parts).toString('base64');
}

module.exports = {
    buildPhase2Tlv,
    buildZatcaTlvInJs,
    tlvRecord,
    parseTlv,
};
