/**
 * zatca-signer.js — ECDSA P-256 digital signature for ZATCA Phase-2 invoices
 * ────────────────────────────────────────────────────────────────────────────
 * Signs: SHA-256( invoice_hash || invoice_uuid || counter )
 * Output: Base64(DER-encoded ECDSA-Sig-Value)
 *
 * Production: store private key in HSM/KMS, never in env.
 * Dev fallback: ephemeral keypair (NOT for production).
 */

const crypto = require('crypto');

const { logger } = require("../logger");
let cachedKeyPair = null;

function loadKeyPair() {
    if (cachedKeyPair) {return cachedKeyPair;}
    const privKeyB64 = process.env.ZATCA_ECDSA_PRIVATE_KEY_B64;
    if (privKeyB64) {
        const pem = Buffer.from(privKeyB64, 'base64').toString('utf-8');
        cachedKeyPair = { privateKey: crypto.createPrivateKey({ key: pem, format: 'pem' }) };
        cachedKeyPair.publicKey = crypto.createPublicKey(cachedKeyPair.privateKey).export({ type: 'spki', format: 'pem' });
    } else {
        logger.warn('⚠ [zatca-signer] ZATCA_ECDSA_PRIVATE_KEY_B64 not set — generating ephemeral ECDSA P-256 key. NOT FOR PRODUCTION.');
        cachedKeyPair = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    }
    return cachedKeyPair;
}

function signInvoice({ invoiceHash, invoiceUuid, counter }) {
    const kp = loadKeyPair();
    const canonical = `${invoiceHash}|${invoiceUuid}|${counter}`;
    const signer = crypto.createSign('SHA256');
    signer.update(canonical, 'utf-8');
    signer.end();
    return signer.sign(kp.privateKey, 'base64');
}

function verifyInvoiceSignature({ invoiceHash, invoiceUuid, counter, signatureB64 }) {
    const kp = loadKeyPair();
    const canonical = `${invoiceHash}|${invoiceUuid}|${counter}`;
    const verifier = crypto.createVerify('SHA256');
    verifier.update(canonical, 'utf-8');
    verifier.end();
    return verifier.verify(kp.publicKey, signatureB64, 'base64');
}

function getPublicCertificatePem() {
    return loadKeyPair().publicKey;
}

module.exports = { signInvoice, verifyInvoiceSignature, getPublicCertificatePem, loadKeyPair };
