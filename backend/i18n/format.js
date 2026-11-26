'use strict';
/**
 * i18n/format.js — تنسيق محلي للأرقام/التواريخ/العملات (Stage 8 SaaS).
 * يعتمد على Intl المدمج في Node — بلا حزمة جديدة.
 * القيم تأتي من /api/i18n/config (lang, currency, timezone).
 */

const LOCALES = { ar: 'ar-EG', en: 'en-US' };

function localeOf(lang) {
    return LOCALES[String(lang || 'ar').toLowerCase().startsWith('en') ? 'en' : 'ar'];
}

/** العملة لا تُقرب: المبلغ يدخل كرقم أو BigInt بminor units. */
function formatMoney(amount, options = {}) {
    const currency = String(options.currency || 'SAR').toUpperCase();
    const digits = options.digits === 'arab' ? 'arab' : 'latn';
    const value = typeof amount === 'bigint' ? Number(amount) / 100 : Number(amount);
    if (!Number.isFinite(value)) {throw new Error('INVALID_AMOUNT');}
    return new Intl.NumberFormat(localeOf(options.lang), {
        style: 'currency', currency,
        minimumFractionDigits: 2, maximumFractionDigits: 2,
        numberingSystem: digits,
    }).format(value);
}

function formatNumber(value, options = {}) {
    const n = Number(value);
    if (!Number.isFinite(n)) {throw new Error('INVALID_NUMBER');}
    return new Intl.NumberFormat(localeOf(options.lang), {
        minimumFractionDigits: options.minimumFractionDigits ?? 0,
        maximumFractionDigits: options.maximumFractionDigits ?? 2,
        numberingSystem: options.digits === 'arab' ? 'arab' : 'latn',
    }).format(n);
}

function formatDate(date, options = {}) {
    const d = date instanceof Date ? date : new Date(date);
    if (Number.isNaN(d.getTime())) {throw new Error('INVALID_DATE');}
    return new Intl.DateTimeFormat(localeOf(options.lang), {
        year: 'numeric', month: '2-digit', day: '2-digit',
        timeZone: options.timezone || 'UTC',
        numberingSystem: options.digits === 'arab' ? 'arab' : 'latn',
    }).format(d);
}

function formatPercent(rate, options = {}) {
    const n = Number(rate);
    if (!Number.isFinite(n)) {throw new Error('INVALID_RATE');}
    return new Intl.NumberFormat(localeOf(options.lang), {
        style: 'percent', maximumFractionDigits: 2,
        numberingSystem: options.digits === 'arab' ? 'arab' : 'latn',
    }).format(n);
}

module.exports = { formatMoney, formatNumber, formatDate, formatPercent, localeOf };
