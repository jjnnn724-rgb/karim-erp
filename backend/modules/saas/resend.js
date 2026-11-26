'use strict';
/**
 * saas/resend — محول بريد Resend (DEC-004). بلا مفتاح ⇒ وضع test محلي بلا شبكة.
 * المفتاح يُحقن من env وقت النشر فقط، لا يُكتب في الكود.
 */
const TEST_MODE = () => !process.env.RESEND_API_KEY || process.env.RESEND_TEST_MODE === '1';

async function sendVerificationEmail(email, code) {
    if (TEST_MODE()) {
        return { ok: true, provider: 'resend-test', to: email, code };
    }
    const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            from: process.env.RESEND_FROM || 'KARIM ERP <onboarding@karim-erp.local>',
            to: [email],
            subject: 'KARIM ERP — رمز التحقق',
            text: `رمز التحقق الخاص بك: ${code}`,
        }),
    });
    if (!res.ok) {
        throw Object.assign(new Error(`RESEND_${res.status}`), { code: 'RESEND_FAILED', status: res.status });
    }
    return { ok: true, provider: 'resend' };
}

module.exports = { sendVerificationEmail, TEST_MODE };
