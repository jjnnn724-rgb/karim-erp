'use strict';

/**
 * totp.js — TOTP (RFC 6238) وHOTP (RFC 4226) بلا اعتماديات خارجية.
 * ────────────────────────────────────────────────────────────────────────────
 * لماذا يدويًا: إضافة مكتبة أخرى إلى مسار المصادقة تعني مساحة هجوم جديدة
 * وتحديثًا أمنيًا دائمًا. كل ما نحتاجه HMAC-SHA1 + Base32 + عدّاد زمني،
 * وكلها في `crypto` المدمج. الدالة `verify` هي الوحيدة المسموح لها بلمس
 * رمز المستخدم، وتعيد `step` كي يستطيع المستدعي رفض إعادة الاستعمال.
 */

const crypto = require('crypto');

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const STEP_SECONDS = 30;
const DIGITS = 6;
const DEFAULT_WINDOW = 1; // ±30 ثانية لتسامح ساعة الجهاز

function generateSecret(bytes = 20) {
    return base32Encode(crypto.randomBytes(bytes));
}

function base32Encode(buf) {
    let bits = 0;
    let value = 0;
    let out = '';
    for (const byte of buf) {
        value = (value << 8) | byte;
        bits += 8;
        while (bits >= 5) {
            out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
            bits -= 5;
        }
    }
    if (bits > 0) {out += BASE32_ALPHABET[(value << (5 - bits)) & 31];}
    return out;
}

function base32Decode(str) {
    const clean = String(str || '').toUpperCase().replace(/[=\s-]/g, '');
    let bits = 0;
    let value = 0;
    const out = [];
    for (const ch of clean) {
        const idx = BASE32_ALPHABET.indexOf(ch);
        if (idx === -1) {throw new Error('INVALID_BASE32');}
        value = (value << 5) | idx;
        bits += 5;
        if (bits >= 8) {
            out.push((value >>> (bits - 8)) & 255);
            bits -= 8;
        }
    }
    return Buffer.from(out);
}

function hotp(secret, counter, digits = DIGITS) {
    const key = Buffer.isBuffer(secret) ? secret : base32Decode(secret);
    const counterBuf = Buffer.alloc(8);
    counterBuf.writeBigUInt64BE(BigInt(counter));
    const digest = crypto.createHmac('sha1', key).update(counterBuf).digest();
    const offset = digest[digest.length - 1] & 0x0f;
    const binary = ((digest[offset] & 0x7f) << 24)
        | ((digest[offset + 1] & 0xff) << 16)
        | ((digest[offset + 2] & 0xff) << 8)
        | (digest[offset + 3] & 0xff);
    return String(binary % (10 ** digits)).padStart(digits, '0');
}

function stepAt(ms = Date.now(), stepSeconds = STEP_SECONDS) {
    return Math.floor(ms / 1000 / stepSeconds);
}

function totp(secret, { at = Date.now(), stepSeconds = STEP_SECONDS, digits = DIGITS } = {}) {
    return hotp(secret, stepAt(at, stepSeconds), digits);
}

/**
 * يتحقق من رمز 6 أرقام ويعيد {ok, step}. أي رمز ليس 6 أرقام يُرفض قبل
 * HMAC. المقارنة بزمن ثابت حتى لا يسرّب توقيت الرفض أي معلومة.
 * @returns {{ok: boolean, step?: number, reason?: string}}
 */
function verify(secret, token, {
    at = Date.now(),
    stepSeconds = STEP_SECONDS,
    window = DEFAULT_WINDOW,
    digits = DIGITS,
    minStep = null,
} = {}) {
    const code = String(token || '').replace(/\s/g, '');
    if (!new RegExp(`^\\d{${digits}}$`).test(code)) {return { ok: false, reason: 'FORMAT' };}
    const current = stepAt(at, stepSeconds);
    const codeBuf = Buffer.from(code);
    for (let delta = -window; delta <= window; delta++) {
        const step = current + delta;
        if (step < 0) {continue;}
        const candidate = Buffer.from(hotp(secret, step, digits));
        if (candidate.length === codeBuf.length && crypto.timingSafeEqual(candidate, codeBuf)) {
            if (minStep != null && step <= minStep) {return { ok: false, reason: 'REPLAY' };}
            return { ok: true, step };
        }
    }
    return { ok: false, reason: 'MISMATCH' };
}

function otpauthURI({ secret, account, issuer = 'Karim ERP', digits = DIGITS, stepSeconds = STEP_SECONDS }) {
    const label = `${issuer}:${account}`;
    const params = new URLSearchParams({
        secret: String(secret),
        issuer,
        algorithm: 'SHA1',
        digits: String(digits),
        period: String(stepSeconds),
    });
    return `otpauth://totp/${encodeURIComponent(label)}?${params.toString()}`;
}

const RECOVERY_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // بلا I/O/0/1 المتشابهة

function generateRecoveryCodes(count = 8, groups = 2, groupLength = 5) {
    const codes = [];
    for (let i = 0; i < count; i++) {
        let raw = '';
        for (let j = 0; j < groups * groupLength; j++) {
            raw += RECOVERY_ALPHABET[crypto.randomInt(RECOVERY_ALPHABET.length)];
        }
        codes.push(raw.match(new RegExp(`.{1,${groupLength}}`, 'g')).join('-'));
    }
    return codes;
}

function normalizeRecoveryCode(code) {
    return String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function hashRecoveryCode(code, userId) {
    return crypto.createHash('sha256')
        .update(`mfa-recovery|${userId}|${normalizeRecoveryCode(code)}`)
        .digest('hex');
}

module.exports = {
    BASE32_ALPHABET,
    STEP_SECONDS,
    DIGITS,
    generateSecret,
    base32Encode,
    base32Decode,
    hotp,
    totp,
    verify,
    otpauthURI,
    generateRecoveryCodes,
    normalizeRecoveryCode,
    hashRecoveryCode,
};
