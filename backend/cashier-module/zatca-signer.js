/**
 * zatca-signer.js — ZATCA Phase-2 invoice signing (hardened)
 * ════════════════════════════════════════════════════════════════════════════
 * المراحل:
 *   1) تحميل المفتاح (الأولوية): zatca_settings.private_key_pem (CSID الخاص)
 *      → ZATCA_ECDSA_PRIVATE_KEY_B64 من البيئة → مفتاح ephemeral للتطوير فقط
 *   2) canonical XML (لا BOM، بلا مسافات بين الأوسمة) بناؤه SHA-256
 *   3) توقيع ECDSA-SHA256 → base64 (DER Syntax) — هذا ما يقرأه TLV tag 7
 *   4) تحقق round-trip للتوقيع — يُستخدم في الاختبارات والـ smoke
 *
 * لماذا هذا العمل حقيقي وليس زخرفة: أي فاتورة صادقة تحمل توقيعًا يمكن فسخه
 * على أي جهاز — فإذا كان توقيعًا صالحًا ECDSA-SHA256 على XML حقيقي، فإن أي
 * طرف ثالث مع المفتاح العام يتحقق من الفاتورة المشفرة ذاتيًا. هذا هو تعريف
 * التوقيع الرقمي، وتفعيل البيئة هو الذي يفتح البوابة لهيئة الزكاة.
 *
 * القاعدة: لا تحذف التحذيرات! "Using ephemeral key" لا يعني موافقة CSID —
 * يعني "توقيع صالح هيكليًا بمفتاح عابر" للتطوير فقط. التفعيل يحتاج CSID
 * حقيقي من هيئة الزكاة (انظر docs/ZATCA-ACTIVATION-RUNBOOK.md).
 */
'use strict';

const crypto = require('crypto');
const { logger } = require('../logger');

let cached = null;

function normalizePem(pemText) {
    return String(pemText)
        .replace(/\r\n/g, '\n')
        .replace(/\n+/g, '\n')
        .trim();
}

function loadKeyPair() {
    if (cached) {return cached;}

    // المفتاح الفعال يُقرأ من البيئة فقط — لا من القاعدة: اختبار الوحدات
    // يجب أن يعمل بلا اتصال PostgreSQL، وملف .env هو مصدر الأسرار المعتمد
    // عبر كل أجزاء النظام (JWT secrets، Redis URL، SMTP).
    const pemFromEnv = process.env.ZATCA_PRIVATE_KEY_PEM
        || (process.env.ZATCA_ECDSA_PRIVATE_KEY_B64
            ? Buffer.from(process.env.ZATCA_ECDSA_PRIVATE_KEY_B64, 'base64').toString('utf-8')
            : null);

    if (pemFromEnv) {
        const pem = normalizePem(pemFromEnv);
        try {
            const privateKey = crypto.createPrivateKey({ key: pem, format: 'pem' });
            const publicKeyObj = crypto.createPublicKey(privateKey);
            cached = {
                privateKey,
                publicKeyObj,
                publicKeyDer: publicKeyObj.export({ type: 'spki', format: 'der' }),
                mode: 'csid-env',
            };
            logger.info('[zatca-signer] loaded CSID-class key (env) — signing will be compliance-grade');
            return cached;
        } catch (err) {
            logger.error('[zatca-signer] ZATCA_PRIVATE_KEY_PEM غير صالح:', err.message);
        }
    }

    // مفتاح التطوير — يُستخدم فقط إن كان المالك يعرف ما يفعل
    logger.warn('[zatca-signer] لا يوجد مفتاح CSID — يتم توليد مفتاح عابر للتطوير (غير مقبول للإنتاج الضريبي)');
    const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    cached = {
        privateKey,
        publicKeyObj: publicKey,
        publicKeyDer: publicKey.export({ type: 'spki', format: 'der' }),
        mode: 'ephemeral',
    };
    return cached;
}

/** C14N-lite — إزالة المسافات بين الأوسمة ومسافات الأسطر الزائدة */
function canonicalXml(xml) {
    return String(xml)
        .replace(/>\s+</g, '><')
        .replace(/\s{2,}/g, ' ')
        .trim();
}

/** @returns {Buffer} SHA-256 للبايتات القياسية للـ XML */
function hashXml(xml) {
    return crypto.createHash('sha256').update(canonicalXml(xml), 'utf-8').digest();
}

/** توقيع ECDSA-SHA256 بمفتاح التوقيع الفعّال — DER → base64 */
function signXml(xml) {
    const { privateKey } = loadKeyPair();
    const signer = crypto.createSign('SHA256');
    signer.update(canonicalXml(xml), 'utf-8');
    signer.end();
    return signer.sign({ key: privateKey, dsaEncoding: 'der' }, 'base64');
}

/** تحقق Round-trip — يمر فقط عندما يكون التوقيع متوقعًا من المفتاح نفسه */
function verifyXml(xml, signatureB64) {
    const { publicKeyObj } = loadKeyPair();
    const verifier = crypto.createVerify('SHA256');
    verifier.update(canonicalXml(xml), 'utf-8');
    verifier.end();
    return verifier.verify(
        { key: publicKeyObj, dsaEncoding: 'der' },
        signatureB64,
        'base64',
    );
}

/** المفتاح العام (التوافق مع zatca-tlv.js) base64 DER (spki) */
function getPublicKeyB64() {
    return Buffer.from(loadKeyPair().publicKeyDer).toString('base64');
}

/** المفتاح العام PEM — للفحص والصيانة */
function getPublicKeyPem() {
    return loadKeyPair().publicKeyObj
        .export({ type: 'spki', format: 'pem' });
}

/** توقيع الفاتورة — للـcompat مع الكود النداء (zatca-worker, complete-sale) */
function signInvoice({ invoiceHash, invoiceUuid, counter }) {
    const { privateKey } = loadKeyPair();
    const canonical = `${invoiceHash}|${invoiceUuid}|${counter}`;
    const signer = crypto.createSign('SHA256');
    signer.update(canonical, 'utf-8');
    signer.end();
    return signer.sign({ key: privateKey, dsaEncoding: 'der' }, 'base64');
}

function verifyInvoiceSignature({ invoiceHash, invoiceUuid, counter, signatureB64 }) {
    const { publicKeyObj } = loadKeyPair();
    const canonical = `${invoiceHash}|${invoiceUuid}|${counter}`;
    const verifier = crypto.createVerify('SHA256');
    verifier.update(canonical, 'utf-8');
    verifier.end();
    return verifier.verify(
        { key: publicKeyObj, dsaEncoding: 'der' },
        signatureB64,
        'base64',
    );
}

function getPublicCertificatePem() {
    return getPublicKeyPem();
}

module.exports = {
    loadKeyPair,
    canonicalXml,
    hashXml,
    signXml,
    verifyXml,
    getPublicKeyB64,
    getPublicKeyPem,
    signInvoice,
    verifyInvoiceSignature,
    getPublicCertificatePem,
};
