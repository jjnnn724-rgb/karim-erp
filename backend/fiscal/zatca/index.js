'use strict';
/** مزوّد ZATCA — يركّب المكوّنات دون أي اتصال أو مفتاح. */
const { buildUblInvoice } = require('./xml-builder');
const { buildQrTlv } = require('./qr');
const { computePih } = require('./pih');
const { submitInvoice, submitOrQueue, flush, hasCredentials } = require('./submit');
const queue = require('./queue');

module.exports = {
    country: 'SA',
    buildUblInvoice,
    buildQrTlv,
    computePih,
    submitInvoice,
    submitOrQueue,
    flush,
    hasCredentials,
    queue,
};
