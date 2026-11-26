'use strict';
/**
 * saas/billing — آلة حالة الاشتراك (DEC-004): trial 14d → active → grace 7d → suspended.
 * لا حذف بيانات عند فشل الدفع — تغيير حالة فقط. Stripe test mode يُحقن لاحقًا.
 */
const TRIAL_DAYS = 14;
const GRACE_DAYS = 7;

function newTrial(now = new Date()) {
    const end = new Date(now.getTime() + TRIAL_DAYS * 86400000);
    return { status: 'trial', trialEndsAt: end.toISOString(), graceEndsAt: null };
}

function advance(state, event, now = new Date()) {
    const s = { ...state };
    if (event === 'trial_end') {
        if (s.status !== 'trial') {return s;}
        s.status = 'grace';
        s.graceEndsAt = new Date(now.getTime() + GRACE_DAYS * 86400000).toISOString();
    } else if (event === 'payment_ok') {
        s.status = 'active';
        s.graceEndsAt = null;
    } else if (event === 'payment_failed') {
        if (s.status === 'active') {
            s.status = 'grace';
            s.graceEndsAt = new Date(now.getTime() + GRACE_DAYS * 86400000).toISOString();
        }
        // لا حذف بيانات في كل الحالات
    } else if (event === 'grace_end') {
        if (s.status === 'grace') {s.status = 'suspended';}
    } else {
        throw Object.assign(new Error('UNKNOWN_EVENT'), { code: 'UNKNOWN_EVENT' });
    }
    return s;
}

function invoiceFor(plan, cents, status = 'pending') {
    if (!plan || !Number.isInteger(cents) || cents < 0) {throw new Error('INVALID_INVOICE');}
    return { plan, amountCents: cents, status };
}

module.exports = { TRIAL_DAYS, GRACE_DAYS, newTrial, advance, invoiceFor };
