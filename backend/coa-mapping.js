'use strict';

/**
 * coa-mapping.js — Mapping resolver for "module.operation → account_code".
 * ────────────────────────────────────────────────────────────────────────────
 * الهدف (Phase 3 hook): بدل ثوابت حسابات متناثرة في 40+ موضع، تقرأ الوحدات
 * من جدول account_mapping (يُنشأ في 134_coa_foundation.sql) مع fallback آمن
 * للثوابت القديمة إن الجدول غير مطبق — سلوك اليوم لا يتغير حتى يطبّق المالك
 * الترحيل ويبدأ ربط الوحدات وحدة وحدة.
 *
 * قاعدة التشغيل: أي خطأ في القراءة (جدول مفقود/خطأ اتصال/صف غائب) ⇒ الرجوع
 * إلى الثوابت القديمة — لا يكسر البيع ولا الترحيل أبدًا.
 *
 * @module coa-mapping
 */

// الثوابت القديمة كما هي في الكود (2026-11 — راجع ACCOUNT_MAPPING_AUDIT.md).
// تُستخدم كـ fallback فقط. لا تُعدَّل هنا — أي تغيير دائم يكون في account_mapping.
const LEGACY_MAPPING = Object.freeze({
    'sales_pos.pos_sale.cash_account': '1000',
    'sales_pos.pos_sale.bank_account': '1010',
    'sales_pos.pos_sale.revenue_account': '4000',
    'sales_pos.pos_sale.vat_output_account': '2100',
    'sales_pos.pos_sale.cogs_account': '5000',
    'sales_pos.pos_sale.inventory_account': '1200',
    'sales_pos.void.cash_account': '1000',
    'sales_pos.void.bank_account': '1010',
    'sales_pos.void.revenue_account': '4000',
    'sales_pos.void.vat_output_account': '2100',
    'sales_pos.void.cogs_account': '5000',
    'sales_pos.void.inventory_account': '1200',
    'purchases.purchase_invoice.vat_input_account': '1150',
    'purchases.purchase_invoice.payable_account': '2000',
    'purchases.purchase_invoice.inventory_account': '1200',
    'purchases.purchase_opening.inventory_account': '1200',
    'purchases.purchase_opening.equity_account': '3000',
    'procurement.supplier_payment.payable_account': '2000',
    'procurement.supplier_payment.cash_account': '1000',
    'procurement.supplier_payment.bank_account': '1010',
    'payroll.payroll_run.expense_account': '6000',
    'payroll.payroll_run.payable_account': '2200',
    'assets.depreciation_run.expense_account': '6600',
    'assets.depreciation_run.accumulated_account': '1520',
    'yarasoft.gl_bridge.cash_account': '1000',
    'yarasoft.gl_bridge.revenue_account': '4000',
    'yarasoft.prebooks.equity_account': '3100',
    'inventory.dispatch_load.revenue_account': '4000',
    'inventory.dispatch_load.cogs_account': '5000',
    'inventory.dispatch_unload.revenue_account': '4000',
    'inventory.dispatch_unload.cogs_account': '5000',
    'inventory.stock_dispatch.cogs_account': '5000',
    'inventory.stock_dispatch.inventory_account': '1200',
    'inventory.stock_return.cogs_account': '5000',
    'inventory.stock_return.inventory_account': '1200',
    'dept_transfer.factory_settlement.revenue_account': '4000',
    'dept_transfer.factory_settlement.expense_account': '5000',
    'dept_transfer.inventory_transfer.cost_account': '5000',
    'dept_transfer.factory_variance_close.revenue_account': '4000',
    'dept_transfer.factory_variance_close.expense_account': '5000',
    'tax.vat_return.payable_account': '2100',
    'tax.vat_return.recoverable_account': '1150',
});

/** مفتاح موحد: module.operation.role */
const keyOf = (module, operation, role) => `${String(module || '').trim()}.${String(operation || '').trim()}.${String(role || '').trim()}`;

/**
 * يستنتج الطبيعة الافتراضية من نوع الحساب (للترحيل 134 backfill).
 * لا تستخدمها بعد الترحيل — normal_balance عمود مثبّت.
 * @param {string} type
 * @returns {'debit'|'credit'|null}
 */
function deriveNormalBalance(type) {
    const t = String(type || '').trim().toLowerCase();
    if (t === 'asset' || t === 'cogs' || t === 'expense') {return 'debit';}
    if (t === 'liability' || t === 'equity' || t === 'revenue') {return 'credit';}
    return null;
}

/**
 * يقرأ الحساب من account_mapping؛ عند أي غياب/خطأ يرجع الثابت القديم.
 * @param {{query:(sql:string,params?:any[])=>Promise<{rows:any[]}>}} db — pool أو client
 * @param {string} module   e.g. 'sales_pos'
 * @param {string} operation e.g. 'pos_sale'
 * @param {string} role     e.g. 'revenue_account'
 * @returns {Promise<string|null>}
 */
async function getMappedAccount(db, module, operation, role) {
    const key = keyOf(module, operation, role);
    try {
        if (db && typeof db.query === 'function') {
            const r = await db.query(
                `SELECT account_code
                   FROM account_mapping
                  WHERE module = $1 AND operation = $2 AND role = $3 AND active = TRUE
                  LIMIT 1`,
                [String(module), String(operation), String(role)]
            );
            const code = r && r.rows && r.rows[0] && r.rows[0].account_code;
            if (code) {return String(code);}
        }
    } catch (e) {
        // 42P01 = relation does not exist (134 لم تُطبق بعد) — فشل هادي إلى الثوابت.
        // 42703 = عمود غير موجود — نفس السياسة. أي خطأ آخر: نكتب تحذيرًا ونكمل بالثابت.
        if (e && (e.code === '42P01' || e.code === '42703')) {return LEGACY_MAPPING[key] || null;}
        if (typeof console !== 'undefined' && console.warn) {
            console.warn(`[coa-mapping] تعذر قراءة account_mapping لـ ${key} — أُستخدم الثابت القديم (${e && e.message ? e.message : e})`);
        }
    }
    return LEGACY_MAPPING[key] || null;
}

/**
 * يحل عدة أدوار في استعلام واحد (قيد واحد = قراءة واحدة) — كل دور غائب عن
 * الجدول أو أي خطأ قراءة يُبقي قيمته الافتراضية الممرَّرة (الثوابت القديمة).
 * الشكل: resolveAccounts(pool, 'sales_pos', 'pos_sale', { cash_account: '1000', … }).
 * @param {{query:(sql:string,params?:any[])=>Promise<{rows:any[]}>}} db — pool أو client
 * @param {string} module
 * @param {string} operation
 * @param {Record<string,string>} defaults
 * @returns {Promise<Record<string,string>>}
 */
async function resolveAccounts(db, module, operation, defaults = {}) {
    const out = Object.assign({}, defaults);
    const roles = Object.keys(defaults);
    if (!roles.length) {return out;}
    try {
        if (db && typeof db.query === 'function') {
            const r = await db.query(
                `SELECT role, account_code
                   FROM account_mapping
                  WHERE module = $1 AND operation = $2 AND active = TRUE
                    AND role = ANY($3::text[])`,
                [String(module), String(operation), roles]
            );
            for (const row of (r && r.rows) || []) {
                if (row && row.role && row.account_code && Object.prototype.hasOwnProperty.call(out, row.role)) {
                    out[row.role] = String(row.account_code);
                }
            }
        }
    } catch (e) {
        // نفس سياسة getMappedAccount: 134 غير مطبقة ⇒ صمت كامل على الثوابت.
        if (!(e && (e.code === '42P01' || e.code === '42703'))) {
            if (typeof console !== 'undefined' && console.warn) {
                console.warn(`[coa-mapping] تعذر قراءة account_mapping لـ ${module}.${operation} — أُستخدمت الثوابت (${e && e.message ? e.message : e})`);
            }
        }
    }
    return out;
}

module.exports = { getMappedAccount, resolveAccounts, deriveNormalBalance, LEGACY_MAPPING, keyOf };
