/**
 * backend/posting-matrix-engine.js — Centralized Enterprise Posting Engine
 * ═══════════════════════════════════════════════════════════════════════════
 * Single Source of Truth for mapping operational business events into atomic,
 * balanced, idempotent General Ledger entries via postJournal.
 *
 * Rules enforced:
 *   1. Zero floating point: round2 applied to all halalas.
 *   2. Strict balance: Σ Debit === Σ Credit.
 *   3. Immutable & Idempotent: Every event has a distinct (source_type, source_id).
 *   4. Closed-period protected: Rejected if period is closed.
 *   5. Subledger-ready: Attaches cost centers and customer/vendor dimensions.
 */
'use strict';

const { postJournal } = require('./accounting-routes');

function round2(val) {
    return Math.round((Number(val) || 0) * 100) / 100;
}

/**
 * 1. POS Cash Sale (بيوع الكاشير النقدية)
 */
async function postPosCashSale(pool, { orderId, date, netAmount, vatAmount, costAmount, costCenter, createdBy }) {
    const net = round2(netAmount);
    const vat = round2(vatAmount);
    const gross = round2(net + vat);
    const cogs = round2(costAmount);

    const lines = [
        { account_code: '1000', debit: gross, credit: 0, memo: `تحصيل نقدي — فاتورة #${orderId}`, cost_center_code: costCenter },
        { account_code: '4000', debit: 0, credit: net, memo: `إيراد مبيعات — فاتورة #${orderId}`, cost_center_code: costCenter },
    ];
    if (vat > 0) {
        lines.push({ account_code: '2100', debit: 0, credit: vat, memo: `ضريبة مخرجات — فاتورة #${orderId}`, cost_center_code: costCenter });
    }
    if (cogs > 0) {
        lines.push({ account_code: '5000', debit: cogs, credit: 0, memo: `تكلفة وجبات — فاتورة #${orderId}`, cost_center_code: costCenter });
        lines.push({ account_code: '1200', debit: 0, credit: cogs, memo: `صرف مخزون مبيعات — فاتورة #${orderId}`, cost_center_code: costCenter });
    }

    return await postJournal(pool, {
        date,
        memo: `مبيعات كاشير نقدية #${orderId}`,
        source_type: 'pos_sale',
        source_id: String(orderId),
        lines,
        created_by: createdBy || null,
    });
}

/**
 * 2. POS Card/Mada Sale (بيوع الكاشير عبر الشبكة ومدى)
 */
async function postPosCardSale(pool, { orderId, date, netAmount, vatAmount, costAmount, costCenter, createdBy }) {
    const net = round2(netAmount);
    const vat = round2(vatAmount);
    const gross = round2(net + vat);
    const cogs = round2(costAmount);

    const lines = [
        { account_code: '1010', debit: gross, credit: 0, memo: `تحصيل شبكة/مدى — فاتورة #${orderId}`, cost_center_code: costCenter },
        { account_code: '4000', debit: 0, credit: net, memo: `إيراد مبيعات — فاتورة #${orderId}`, cost_center_code: costCenter },
    ];
    if (vat > 0) {
        lines.push({ account_code: '2100', debit: 0, credit: vat, memo: `ضريبة مخرجات — فاتورة #${orderId}`, cost_center_code: costCenter });
    }
    if (cogs > 0) {
        lines.push({ account_code: '5000', debit: cogs, credit: 0, memo: `تكلفة وجبات — فاتورة #${orderId}`, cost_center_code: costCenter });
        lines.push({ account_code: '1200', debit: 0, credit: cogs, memo: `صرف مخزون مبيعات — فاتورة #${orderId}`, cost_center_code: costCenter });
    }

    return await postJournal(pool, {
        date,
        memo: `مبيعات كاشير شبكة/مدى #${orderId}`,
        source_type: 'pos_card_sale',
        source_id: String(orderId),
        lines,
        created_by: createdBy || null,
    });
}

/**
 * 3. Delivery Platform Sale (مبيعات تطبيقات التوصيل — جاهز، هنقرستيشن...)
 * Gross revenue to 4030/4000, Platform Commission to 6420, AR receivable held in 1310.
 */
async function postDeliveryPlatformSale(pool, { orderId, platformName, date, grossSale, commission, vatAmount, costCenter, createdBy }) {
    const gross = round2(grossSale);
    const comm = round2(commission);
    const vat = round2(vatAmount);
    const netRevenue = round2(gross - vat);
    const netReceivable = round2(gross - comm);

    const lines = [
        { account_code: '1310', debit: netReceivable, credit: 0, memo: `مستحق وسيط توصيل (${platformName}) #${orderId}`, cost_center_code: costCenter },
        { account_code: '6420', debit: comm, credit: 0, memo: `عمولة تطبيق توصيل (${platformName}) #${orderId}`, cost_center_code: costCenter },
        { account_code: '4030', debit: 0, credit: netRevenue, memo: `إيراد مبيعات توصيل — #${orderId}`, cost_center_code: costCenter },
    ];
    if (vat > 0) {
        lines.push({ account_code: '2100', debit: 0, credit: vat, memo: `ضريبة مخرجات توصيل #${orderId}`, cost_center_code: costCenter });
    }

    return await postJournal(pool, {
        date,
        memo: `مبيعات تطبيق توصيل (${platformName}) #${orderId}`,
        source_type: 'delivery_sale',
        source_id: String(orderId),
        lines,
        created_by: createdBy || null,
    });
}

/**
 * 4. Factory Department Production Transfer (تسوية تحويلات المصنع بسعر القائمة)
 * As decreed: Factory cost center credited (Revenue 4050/4000), Outlet debited (Expense/COGS 5000).
 */
async function postFactoryTransfer(pool, { transferId, date, totalValue, factoryDept, outletDept, memoText, createdBy }) {
    const val = round2(totalValue);

    const lines = [
        { account_code: '5000', debit: val, credit: 0, memo: `تحميل تحويل مصنع خارجي — ${memoText || ''}`, cost_center_code: outletDept },
        { account_code: '4000', debit: 0, credit: val, memo: `إيراد تسوية إنتاج مصنع — ${memoText || ''}`, cost_center_code: factoryDept },
    ];

    return await postJournal(pool, {
        date,
        memo: `تسوية تحويل مصنع إنتاجي #${transferId}`,
        source_type: 'factory_transfer',
        source_id: String(transferId),
        lines,
        created_by: createdBy || null,
    });
}

/**
 * 5. Purchase Invoice (فاتورة مشتريات مورد)
 */
async function postPurchaseInvoice(pool, { invoiceId, supplierName, date, netAmount, vatAmount, costCenter, createdBy }) {
    const net = round2(netAmount);
    const vat = round2(vatAmount);
    const gross = round2(net + vat);

    const lines = [
        { account_code: '1200', debit: net, credit: 0, memo: `مخزون مشتريات — ${supplierName}`, cost_center_code: costCenter },
    ];
    if (vat > 0) {
        lines.push({ account_code: '1150', debit: vat, credit: 0, memo: `ضريبة مدخلات مشتريات — ${supplierName}`, cost_center_code: costCenter });
    }
    lines.push({ account_code: '2000', debit: 0, credit: gross, memo: `مستحق مورد — ${supplierName}`, cost_center_code: costCenter });

    return await postJournal(pool, {
        date,
        memo: `فاتورة شراء #${invoiceId} (${supplierName})`,
        source_type: 'purchase_invoice',
        source_id: String(invoiceId),
        lines,
        created_by: createdBy || null,
    });
}

/**
 * 6. Inventory Waste & Spoilage (هدر وتالف تشغيلي)
 */
async function postWasteAdjustment(pool, { wasteId, date, totalCost, costCenter, reason, createdBy }) {
    const cost = round2(totalCost);

    const lines = [
        { account_code: '5300', debit: cost, credit: 0, memo: `هدر وتالف مخزون — ${reason || ''}`, cost_center_code: costCenter },
        { account_code: '1200', debit: 0, credit: cost, memo: `تخفيض مخزون تالف — ${reason || ''}`, cost_center_code: costCenter },
    ];

    return await postJournal(pool, {
        date,
        memo: `إثبات هدر وتالف مخزني #${wasteId}`,
        source_type: 'inventory_waste',
        source_id: String(wasteId),
        lines,
        created_by: createdBy || null,
    });
}

/**
 * 7. Fixed Assets Monthly Depreciation (إهلاك الأصول الثابتة)
 */
async function postMonthlyDepreciation(pool, { periodMonth, date, totalDepreciation, costCenter, createdBy }) {
    const dep = round2(totalDepreciation);

    const lines = [
        { account_code: '6600', debit: dep, credit: 0, memo: `إهلاك أصول شهر ${periodMonth}`, cost_center_code: costCenter },
        { account_code: '1520', debit: 0, credit: dep, memo: `مجمع إهلاك أصول شهر ${periodMonth}`, cost_center_code: costCenter },
    ];

    return await postJournal(pool, {
        date,
        memo: `قيد إهلاك الأصول الثابتة لشهر ${periodMonth}`,
        source_type: 'asset_depreciation',
        source_id: String(periodMonth),
        lines,
        created_by: createdBy || null,
    });
}

module.exports = {
    round2,
    postPosCashSale,
    postPosCardSale,
    postDeliveryPlatformSale,
    postFactoryTransfer,
    postPurchaseInvoice,
    postWasteAdjustment,
    postMonthlyDepreciation,
};
