/**
 * zatca-csr.js — Real PKCS#10 CSR generation for ZATCA (Fatoora) onboarding.
 * ────────────────────────────────────────────────────────────────────────────
 * Pure Node.js (crypto + hand-rolled DER encoder) — no openssl binary needed.
 *
 * ZATCA compliance CSR subject requirements (Fatoora portal):
 *   CN  (2.5.4.3)           = solution name
 *   O   (2.5.4.10)          = organization / solution name
 *   OU  (2.5.4.11)          = branch name
 *   SN  (2.5.4.5)           = "1-{VAT}" (standard invoices) or "2-{VAT}" (simplified)
 *   UID (0.9.2342.19200300.100.1.1) = taxpayer ID (CR/EID number)
 *   C   (2.5.4.6)           = "SA"
 *
 * Key: EC P-256 (prime256v1) — the curve ZATCA mandates for signing stamps.
 * Output: PEM CSR + PEM private key (PKCS#8) ready for the /compliance call.
 */

const crypto = require('crypto');

// ─── DER primitives ──────────────────────────────────────────────────────────
function derLen(len) {
    if (len < 0x80) {return Buffer.from([len]);}
    const bytes = [];
    let v = len;
    while (v > 0) { bytes.unshift(v & 0xff); v >>= 8; }
    return Buffer.concat([Buffer.from([0x80 | bytes.length]), Buffer.from(bytes)]);
}
function tlv(tag, content) {
    return Buffer.concat([Buffer.from([tag]), derLen(content.length), content]);
}
const SEQ  = (b) => tlv(0x30, b);
const SET  = (b) => tlv(0x31, b);
const INT  = (n) => {
    if (n === 0) {return tlv(0x02, Buffer.from([0]));}
    const hex = n.toString(16).padStart(2, '0');
    const raw = Buffer.from(hex.length % 2 ? '0' + hex : hex, 'hex');
    // Always positive INTEGER — prepend 0x00 if the high bit is set
    const body = (raw[0] & 0x80) ? Buffer.concat([Buffer.from([0]), raw]) : raw;
    return tlv(0x02, body);
};
const NULLBUF = () => Buffer.from([0x05, 0x00]);
const BITSTR = (b) => tlv(0x03, Buffer.concat([Buffer.from([0]), b]));
const UTF8  = (s) => tlv(0x0c, Buffer.from(s, 'utf8'));
const PRINT = (s) => tlv(0x13, Buffer.from(s, 'ascii'));

function oid(dotted) {
    const parts = dotted.split('.').map(Number);
    const first = parts[0] * 40 + parts[1];
    const bytes = [first];
    for (let i = 2; i < parts.length; i += 1) {
        let v = parts[i];
        const stack = [v & 0x7f];
        v >>= 7;
        while (v > 0) { stack.unshift(0x80 | (v & 0x7f)); v >>= 7; }
        bytes.push(...stack);
    }
    return tlv(0x06, Buffer.from(bytes));
}
const OID = {
    CN: '2.5.4.3', C: '2.5.4.6', O: '2.5.4.10', OU: '2.5.4.11', SN: '2.5.4.5',
    UID: '0.9.2342.19200300.100.1.1',
    EC_PUBKEY: '1.2.840.10045.2.1',
    PRIME256V1: '1.2.840.10045.3.1.7',
    ECDSA_SHA256: '1.2.840.10045.4.3.2',
};

// ─── PKCS#10 assembly ────────────────────────────────────────────────────────
function rdn(oidDotted, value, { printable = false } = {}) {
    // RelativeDistinguishedName = SET OF AttributeTypeAndValue
    return SET(SEQ(Buffer.concat([oid(oidDotted), printable ? PRINT(value) : UTF8(value)])));
}

function buildSubjectPkInfo(publicKey) {
    // Uncompressed EC point: 0x04 || X || Y
    const rawJwk = publicKey.export({ format: 'jwk' });
    const x = Buffer.from(rawJwk.x, 'base64url');
    const y = Buffer.from(rawJwk.y, 'base64url');
    const point = Buffer.concat([Buffer.from([0x04]), x, y]);
    const algorithm = SEQ(Buffer.concat([oid(OID.EC_PUBKEY), oid(OID.PRIME256V1)]));
    return SEQ(Buffer.concat([algorithm, BITSTR(point)]));
}

function generateZatcaCsr({
    vatNumber,           // 15-digit VAT registration number
    commonName,          // solution name
    organizationName,    // taxpayer organization name
    organizationalUnit,  // branch name
    uid,                 // taxpayer CR / Eid number
    invoiceType = 'standard', // 'standard' → 1-{VAT}, 'simplified' → 2-{VAT}
    country = 'SA',
}) {
    const vat = String(vatNumber || '').trim();
    if (!/^\d{15}$/.test(vat)) {
        throw Object.assign(new Error('الرقم الضريبي يجب أن يكون 15 رقمًا'), { code: 'INVALID_VAT' });
    }
    const cn = String(commonName || organizationName || 'Karim ERP').trim();
    const sn = `${invoiceType === 'simplified' ? 2 : 1}-${vat}`;
    const o = String(organizationName || cn).trim();
    const ou = String(organizationalUnit || o).trim();
    const uidVal = String(uid || vat).trim();

    const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });

    const subject = SEQ(Buffer.concat([
        rdn(OID.C, country, { printable: true }),
        rdn(OID.SN, sn),
        rdn(OID.O, o),
        rdn(OID.OU, ou),
        rdn(OID.UID, uidVal),
        rdn(OID.CN, cn),
    ]));

    const certReqInfo = SEQ(Buffer.concat([
        INT(0),                     // version 0
        subject,
        buildSubjectPkInfo(publicKey),
        tlv(0xA0, Buffer.alloc(0)), // attributes [0] IMPLICIT — empty
    ]));

    const signatureAlgorithm = SEQ(Buffer.concat([oid(OID.ECDSA_SHA256), NULLBUF()]));
    const signer = crypto.createSign('SHA256');
    signer.update(certReqInfo);
    signer.end();
    const sigDer = signer.sign(privateKey); // DER ECDSA-Sig-Value
    const csr = SEQ(Buffer.concat([certReqInfo, signatureAlgorithm, BITSTR(sigDer)]));

    return {
        csrPem: `-----BEGIN CERTIFICATE REQUEST-----\n${csr.toString('base64').replace(/(.{64})/g, '$1\n').replace(/\n$/, '')}\n-----END CERTIFICATE REQUEST-----\n`,
        privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
        publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
        subject: { CN: cn, SN: sn, O: o, OU: ou, UID: uidVal, C: country },
    };
}

module.exports = { generateZatcaCsr };
