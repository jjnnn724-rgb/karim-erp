'use strict';
/**
 * saas/email — محول تحقق البريد (DEC-004): Resend في الإنتاج، تسليم محلي في dev.
 * لا مفاتيح ولا مكالمات شبكية هنا.
 */
const crypto = require('crypto');

const delivered = new Map();

function createVerification(email) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || ''))) {
        throw Object.assign(new Error('INVALID_EMAIL'), { code: 'INVALID_EMAIL' });
    }
    const code = crypto.randomBytes(12).toString('hex');
    delivered.set(email, { code, createdAt: Date.now() });
    return { code, provider: process.env.RESEND_API_KEY ? 'resend' : 'local-dev' };
}

function verifyCode(email, code) {
    const rec = delivered.get(String(email));
    return Boolean(rec && rec.code === String(code));
}

module.exports = { createVerification, verifyCode };
