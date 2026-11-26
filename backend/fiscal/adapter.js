'use strict';
/**
 * fiscal/adapter.js — واجهة موحّدة لإرسال الفواتير إلى أي جهة ضريبية.
 *
 * لا كود خاص بأي دولة هنا. كل محوّل (zatca، eta، ...) يسجّل نفسه ثم
 * يُستدعى عبر `submitInvoice(invoice, { country, provider })`.
 * هذه طبقة preparation فقط: لا ترسل أي شيء فعليًا، ولا تملك مفاتيح.
 */

const providers = new Map();

class FiscalProviderNotFoundError extends Error {
    constructor(country) {
        super(`FISCAL_PROVIDER_NOT_FOUND: ${country}`);
        this.name = 'FiscalProviderNotFoundError';
        this.code = 'FISCAL_PROVIDER_NOT_FOUND';
    }
}

function registerProvider(country, provider) {
    if (!country || typeof country !== 'string') {throw new Error('INVALID_COUNTRY');}
    if (!provider || typeof provider.submitInvoice !== 'function') {throw new Error('INVALID_PROVIDER');}
    providers.set(country.toUpperCase(), provider);
    return () => providers.delete(country.toUpperCase());
}

function getProvider(country) {
    const provider = providers.get(String(country || '').toUpperCase());
    if (!provider) {throw new FiscalProviderNotFoundError(country);}
    return provider;
}

/**
 * @returns {Promise<{status:string, uuid:string, qr:string}>}
 */
async function submitInvoice(invoice, options = {}) {
    const provider = options.provider || getProvider(options.country);
    return provider.submitInvoice(invoice, options);
}

module.exports = {
    registerProvider, getProvider, submitInvoice,
    FiscalProviderNotFoundError,
    listProviders: () => [...providers.keys()],
};
