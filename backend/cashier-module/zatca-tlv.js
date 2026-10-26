/**
 * zatca-tlv.js — ZATCA Phase-2 QR TLV payload builder (JS port)
 * ────────────────────────────────────────────────────────────────────────────
 * Mirror of the SQL function fn_pos_build_zatca_tlv().
 * Tag layout (ZATCA Phase-2 Simplified):
 *   1 = Seller Name, 2 = VAT Number, 3 = Timestamp (UTC ISO),
 *   4 = Total (with VAT), 5 = VAT Total, 6 = Invoice Counter, 7 = Invoice UUID
 * Each TLV record = [1 byte tag][1 byte length][N bytes UTF-8 value]
 */

function tlvRecord(tag, value) {
    const valueBytes = Buffer.from(String(value), 'utf-8');
    if (valueBytes.length > 255) {
        throw new Error(`TLV value too long (>255 bytes) for tag ${tag}`);
    }
    const buf = Buffer.allocUnsafe(2 + valueBytes.length);
    buf.writeUInt8(tag, 0);
    buf.writeUInt8(valueBytes.length, 1);
    valueBytes.copy(buf, 2);
    return buf;
}

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

module.exports = { buildZatcaTlvInJs, tlvRecord };
