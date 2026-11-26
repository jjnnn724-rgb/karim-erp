'use strict';
/**
 * zatca/submit.js — إرسال فاتورة إلى ZATCA (preparation).
 * بلا بيانات اعتماد ⇒ يُرفض صراحةً ولا يُحاول أي اتصال.
 * مع بيانات اعتماد في وضع sandbox ⇒ نتيجة مُحاكاة تحمل UUID/QR (لا طلب حقيقي).
 */
const crypto = require('crypto');
const queue = require('./queue');

class FiscalSubmissionBlocked extends Error {
    constructor() {
        super('FISCAL_SUBMISSION_BLOCKED: ZATCA sandbox/CSID credentials are required — no submission attempted');
        this.name = 'FiscalSubmissionBlocked';
        this.code = 'FISCAL_SUBMISSION_BLOCKED';
    }
}

function hasCredentials(options = {}) {
    const c = options.credentials || {};
    return Boolean(c.csid && (c.privateKey || c.key) && c.sandbox === true);
}

/** الفاتورة تُوضع في الطابور أولًا عند غياب الاعتماد — بلا إرسال. */
function submitOrQueue(invoice, options = {}) {
    if (!hasCredentials(options)) {
        const row = queue.enqueue(invoice);
        return { status: 'pending', uuid: row.uuid, queued: true, submitted: false };
    }
    const uuid = String(invoice?.uuid || invoice?.id);
    return {
        status: 'submitted',
        uuid,
        qr: crypto.createHash('sha256').update(uuid).digest('base64'),
        sandbox: true,
        queued: false,
        submitted: true,
    };
}

/** يُستدعى فقط بعد إضافة الاعتماد: يُفرغ الطابور ويُرسل (sandbox stub). */
async function flush(submitFn, options = {}) {
    if (!hasCredentials(options)) {throw new FiscalSubmissionBlocked();}
    const out = [];
    for (const row of queue.list()) {
        out.push(await submitFn(row.invoice, options));
        queue.remove(row.uuid);
    }
    return out;
}

async function submitInvoice(_invoice, _options = {}) {
    throw new FiscalSubmissionBlocked();
}

module.exports = { submitInvoice, submitOrQueue, flush, hasCredentials, FiscalSubmissionBlocked };
