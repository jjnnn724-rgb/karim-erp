'use strict';
/**
 * POS service — المنطق النقي لحساب الباقي النقدي (A3.3).
 * نُقل من cashier-module/complete-sale.js بنفس السلوك (بما فيه round2cash).
 */
const round2cash = (n) => Math.round((Number(n) || 0) * 100) / 100;

function computeCashChange(payments, totalAmount) {
    const list = Array.isArray(payments) ? payments : [];
    const total = round2cash(totalAmount);
    const cashIn = round2cash(list
        .filter((p) => String(p && p.method).toLowerCase() === 'cash')
        .reduce((s, p) => s + Number(p.amount || 0), 0));
    const nonCashIn = round2cash(list
        .filter((p) => String(p && p.method).toLowerCase() !== 'cash')
        .reduce((s, p) => s + Number(p.amount || 0), 0));
    const cashNeeded = Math.max(0, round2cash(total - nonCashIn));
    const cashApplied = Math.min(cashIn, cashNeeded);
    return {
        cashChange: round2cash(cashIn - cashApplied),
        cashIn,
        nonCashIn,
        nonCashOverpayment: round2cash(Math.max(0, round2cash(nonCashIn - total))),
    };
}

module.exports = { round2cash, computeCashChange };
