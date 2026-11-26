'use strict';
/**
 * zatca/queue — طابور فواتير محلي (preparation) عندما لا توجد بيانات اعتماد.
 * لا اتصال شبكي. يُفرَّغ صراحةً عند توفر إعدادات المستأجر.
 */
const pending = new Map();

function enqueue(invoice) {
    const uuid = String(invoice?.uuid || invoice?.id || '');
    if (!uuid) {throw new Error('INVOICE_UUID_REQUIRED');}
    if (!pending.has(uuid)) {
        pending.set(uuid, { uuid, invoice, status: 'pending', queuedAt: new Date().toISOString() });
    }
    return pending.get(uuid);
}

function list() {
    return [...pending.values()];
}

function remove(uuid) {
    return pending.delete(String(uuid));
}

function clear() {
    pending.clear();
}

module.exports = { enqueue, list, remove, clear };
