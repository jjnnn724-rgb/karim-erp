'use strict';
/**
 * saas/stripe — محول دفع Stripe test mode (DEC-004). بلا مفتاح ⇒ intent محلي حتمي بلا شبكة.
 * لا تُحذف بيانات عند فشل الدفع — يُعاد كائن failed فقط (انظر billing.js).
 */
const crypto = require('crypto');

const TEST_MODE = () => !process.env.STRIPE_SECRET_KEY || process.env.STRIPE_TEST_MODE === '1';

async function createPaymentIntent(amountCents, metadata = {}) {
    if (!Number.isInteger(amountCents) || amountCents < 0) {throw new Error('INVALID_AMOUNT');}
    if (TEST_MODE()) {
        return {
            id: `pi_test_${crypto.createHash('sha256').update(`${amountCents}:${JSON.stringify(metadata)}`).digest('hex').slice(0, 16)}`,
            status: 'succeeded',
            provider: 'stripe-test',
            amount: amountCents,
        };
    }
    const body = new URLSearchParams({
        amount: String(amountCents), currency: 'sar', 'metadata[tenant]': String(metadata.tenantId || ''),
    });
    const res = await fetch('https://api.stripe.com/v1/payment_intents', {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: body.toString(),
    });
    if (!res.ok) {throw Object.assign(new Error(`STRIPE_${res.status}`), { code: 'STRIPE_FAILED' });}
    return res.json();
}

module.exports = { createPaymentIntent, TEST_MODE };
