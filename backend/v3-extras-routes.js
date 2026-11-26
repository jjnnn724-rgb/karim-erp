'use strict';

/**
 * v3-extras-routes.js — three guarded read/preview routers for v3 screens.
 * ===========================================================================
 * Mounted separately in server.js (different mount paths, different roles):
 *   /api/sales           -> quoteRouter      POST /quote
 *   /api/payroll-sheet   -> payrollRouter    GET  /
 *   /api/cashier-revenues-> revenueRouter    GET  /
 *
 * Contracts (read from the v3 sources, not invented):
 *   quote      v3/apps/web/src/lib/pos.ts             posQuoteSchema (~1129)
 *              v3/apps/web/src/lib/pos-pricing.ts     PosQuoteLike (~200)
 *              -> { quote:true, subtotal, discount_total, tax_total,
 *                   total_amount, line_items:[{ product_id, quantity,
 *                   unit_price, discount, vat_rate, line_total (NET),
 *                   vat_amount, line_total_incl }] }
 *   payroll    v3/apps/web/src/lib/payroll.ts         PayrollEmployee/PayrollRun/
 *              PayrollSheet/PayrollSheetSummary; command-center.ts fetchPayrollSheet
 *   revenues   v3/apps/web/src/lib/cashier-revenues.ts cashierRevenueSnapshotSchema
 *              -> { from, to, dept, total, entries, invoices,
 *                   cashiers:[{deptCode,displayAr,displayEn,source,total,entries,
 *                   invoices}], byDay:[{date,total,entries}] }
 *
 * Money rules: DB NUMERIC is delivered as a 2-decimal STRING (ADR-04) on the
 * payroll/revenue reads. The quote follows posQuoteSchema, whose numbers are
 * `z.number()` — so those fields are numbers produced by vat-engine's integer
 * money math, never copied from the client.
 *
 * All SQL uses $1-style parameters only. No user input is interpolated.
 */

const express = require('express');
const { pool } = require('./shared-pool');
const { logger } = require('./logger');
const { jwtAuth, requireRole } = require('./cashier-module/jwt-middleware');
const { computeInvoice, toMinor, VatBalanceError } = require('./cashier-module/vat-engine');

const QUOTE_ROLES = ['cashier', 'sous_chef', 'admin', 'owner', 'manager'];
const PAYROLL_ROLES = ['admin', 'owner', 'manager', 'accountant', 'hr'];
const REVENUE_ROLES = ['admin', 'owner', 'manager', 'accountant', 'auditor'];

const MAX_ITEMS = 200;
const MAX_PAYROLL_EMPLOYEES = 5000;
const MAX_PAYROLL_RUNS = 500;
const MAX_ADJUSTMENTS = 2000;
const MAX_REVENUE_DAYS = 400;

/* ─── Small shared helpers ───────────────────────────────────────────────── */

function fail(res, status, code, message, extra) {
    return res.status(status).json({ error: code, message, ...(extra || {}) });
}

/** Wrap an async handler so a rejected promise never reaches Express' HTML 500. */
function asyncHandler(fn) {
    return async (req, res) => {
        try {
            await fn(req, res);
        } catch (err) {
            logger.error(
                { err: err && err.message ? err.message : String(err), code: err && err.code, path: req.path },
                '[v3-extras] unhandled error'
            );
            if (!res.headersSent) {
                fail(res, 500, 'INTERNAL_ERROR', 'تعذر تنفيذ الطلب — حاول مجددًا');
            }
        }
    };
}

/** Integer minor units -> exact 2-decimal string (no float, no toFixed). */
function formatMinor(minor) {
    const n = Math.trunc(minor);
    const negative = n < 0;
    const abs = Math.abs(n);
    const whole = Math.floor(abs / 100);
    const cents = String(abs % 100).padStart(2, '0');
    return `${negative ? '-' : ''}${whole}.${cents}`;
}

/** pg NUMERIC -> money string "0.00"; never emits NaN/Infinity. */
function money(value) {
    if (value === null || value === undefined || value === '') {return '0.00';}
    try {
        return formatMinor(toMinor(value));
    } catch (_) {
        return '0.00';
    }
}

function isIsoDay(value) {
    const text = String(value == null ? '' : value).trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {return false;}
    const [year, month, day] = text.split('-').map(Number);
    if (month < 1 || month > 12 || day < 1 || day > 31) {return false;}
    const probe = new Date(Date.UTC(year, month - 1, day));
    return probe.getUTCFullYear() === year && probe.getUTCMonth() === month - 1 && probe.getUTCDate() === day;
}

function isIsoMonth(value) {
    const text = String(value == null ? '' : value).trim();
    return /^\d{4}-\d{2}$/.test(text) && Number(text.slice(5, 7)) >= 1 && Number(text.slice(5, 7)) <= 12;
}

/** Calendar month bounds, no timezone conversion (ADR-05). */
function monthBounds(month) {
    const year = Number(month.slice(0, 4));
    const mon = Number(month.slice(5, 7));
    const last = new Date(Date.UTC(year, mon, 0)).getUTCDate();
    return {
        from: `${month}-01`,
        to: `${month}-${String(last).padStart(2, '0')}`,
    };
}

function daysBetweenInclusive(from, to) {
    const a = Date.parse(`${from}T00:00:00Z`);
    const b = Date.parse(`${to}T00:00:00Z`);
    return Math.floor((b - a) / 86400000) + 1;
}

function dayAt(from, index) {
    const d = new Date(`${from}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + index);
    return d.toISOString().slice(0, 10);
}

/* ─── 1. POST /api/sales/quote ───────────────────────────────────────────── */

const quoteRouter = express.Router();

quoteRouter.post(
    '/quote',
    jwtAuth,
    requireRole(...QUOTE_ROLES),
    asyncHandler(async (req, res) => {
        const body = req.body && typeof req.body === 'object' ? req.body : {};
        const rawItems = Array.isArray(body.items) ? body.items : [];
        if (!rawItems.length) {return fail(res, 422, 'EMPTY_CART', 'أضف صنفًا واحدًا على الأقل.');}
        if (rawItems.length > MAX_ITEMS) {return fail(res, 422, 'TOO_MANY_ITEMS', `عدد الأصناف يتجاوز ${MAX_ITEMS}.`);}

        // Only identity + quantity + discount are accepted from the client.
        // Prices and VAT rates are ALWAYS re-read from pos_products below.
        const lines = [];
        for (let i = 0; i < rawItems.length; i += 1) {
            const it = rawItems[i];
            if (!it || typeof it !== 'object' || Array.isArray(it)) {
                return fail(res, 422, 'INVALID_ITEM', `items[${i}] غير صالح.`);
            }
            const productId = Number(it.product_id !== undefined ? it.product_id : it.productId);
            if (!Number.isSafeInteger(productId) || productId <= 0) {
                return fail(res, 422, 'INVALID_PRODUCT', `items[${i}].product_id غير صالح.`);
            }
            const quantity = Number(it.quantity !== undefined ? it.quantity : it.qty);
            if (!Number.isFinite(quantity) || quantity <= 0) {
                return fail(res, 422, 'INVALID_QUANTITY', `items[${i}].quantity يجب أن يكون أكبر من صفر.`);
            }
            const discount = it.discount === undefined || it.discount === null || it.discount === '' ? 0 : it.discount;
            let discountMinor;
            try {
                discountMinor = toMinor(discount);
            } catch (_) {
                return fail(res, 422, 'INVALID_DISCOUNT', `items[${i}].discount غير صالح.`);
            }
            if (discountMinor < 0) {
                return fail(res, 422, 'INVALID_DISCOUNT', `items[${i}].discount لا يمكن أن يكون سالبًا.`);
            }
            lines.push({ product_id: productId, quantity, discount, discountMinor, index: i });
        }

        const ids = [...new Set(lines.map((line) => line.product_id))];
        const found = await pool.query(
            `SELECT id, name_ar, price, vat_rate, is_active
               FROM pos_products WHERE id = ANY($1::bigint[])`,
            [ids]
        );
        const byId = new Map(found.rows.map((row) => [Number(row.id), row]));

        for (const line of lines) {
            const product = byId.get(line.product_id);
            if (!product) {return fail(res, 404, 'PRODUCT_NOT_FOUND', 'أحد الأصناف غير موجود.', { product_id: line.product_id });}
            if (!product.is_active) {return fail(res, 409, 'PRODUCT_INACTIVE', 'أحد الأصناف غير نشط.', { product_id: line.product_id });}
        }

        // Legacy NET catalog (same convention as /api/sales/complete and the
        // v3 cart estimate): line net = price*qty - discount, VAT added on top.
        const priced = lines.map((line) => {
            const product = byId.get(line.product_id);
            const storedRate = product.vat_rate;
            const vatRate = storedRate === null || storedRate === undefined || !Number.isFinite(Number(storedRate))
                ? 15
                : Number(storedRate);
            return {
                product_id: line.product_id,
                quantity: line.quantity,
                discount: line.discount,
                vat_rate: vatRate,
                unit_price_net: product.price,
            };
        });

        let totals;
        try {
            totals = computeInvoice({ lines: priced });
        } catch (err) {
            const code = err && err.code ? String(err.code) : 'QUOTE_FAILED';
            if (err instanceof VatBalanceError) {logger.error({ code, details: err.details }, '[quote] unbalanced preview rejected');}
            return fail(res, err instanceof VatBalanceError ? err.statusCode : 422, code, 'تعذر حساب المعاينة — راجع الأصناف والخصومات.');
        }

        // Guard twice: vat-engine asserts balance; pos.ts re-checks at 0.005.
        if (Math.abs(totals.subtotal + totals.tax_total - totals.total_amount) >= 0.005) {
            logger.error({ totals }, '[quote] balance guard failed after computeInvoice');
            return fail(res, 422, 'INVOICE_UNBALANCED', 'المعاينة غير متوازنة — لم تُرجع أي أرقام.');
        }

        // vat-engine's `line_total` is INCLUSIVE and `line_net` is NET, but
        // pos-pricing.ts's PosQuoteLine defines line_total as NET and adds a
        // separate line_total_incl. Map explicitly — do not swap them.
        const lineItems = totals.line_items.map((line, i) => ({
            product_id: lines[i].product_id,
            quantity: line.quantity,
            unit_price: line.unit_price,
            discount: line.discount,
            vat_rate: line.vat_rate,
            line_total: line.line_net,
            vat_amount: line.vat_amount,
            line_total_incl: line.line_total,
        }));

        return res.json({
            quote: true,
            subtotal: totals.subtotal,
            discount_total: totals.discount_total,
            tax_total: totals.tax_total,
            total_amount: totals.total_amount,
            line_items: lineItems,
        });
    })
);

/* ─── 2. GET /api/payroll-sheet ──────────────────────────────────────────── */

const payrollRouter = express.Router();

payrollRouter.get(
    '/',
    jwtAuth,
    requireRole(...PAYROLL_ROLES),
    asyncHandler(async (req, res) => {
        let month = String(req.query.month == null ? '' : req.query.month).trim();
        if (month && !isIsoMonth(month)) {return fail(res, 422, 'INVALID_MONTH', 'الشهر بصيغة YYYY-MM.');}
        if (!month) {
            const now = await pool.query(`SELECT TO_CHAR(NOW() AT TIME ZONE 'Asia/Riyadh', 'YYYY-MM') AS month`);
            month = String(now.rows[0] && now.rows[0].month ? now.rows[0].month : '').trim();
            if (!isIsoMonth(month)) {return fail(res, 500, 'INTERNAL_ERROR', 'تعذر تحديد الشهر الحالي.');}
        }
        const bounds = monthBounds(month);

        const [empRes, attRes, runRes, adjRes] = await Promise.all([
            pool.query(
                `SELECT id, name, "employeeId", department, position, status, salary
                   FROM employees WHERE status = 'active'
                  ORDER BY id ASC LIMIT $1`,
                [MAX_PAYROLL_EMPLOYEES]
            ),
            pool.query(
                `SELECT "employeeId", COUNT(*)::int AS days
                   FROM attendance
                  WHERE date >= $1 AND date <= $2
                    AND "checkIn" IS NOT NULL AND "checkIn" <> ''
                  GROUP BY "employeeId"`,
                [bounds.from, bounds.to]
            ),
            pool.query(
                `SELECT id, month, status, employee_count, total_basic, total_overtime,
                        total_bonuses, total_penalties, total_advances, total_net
                   FROM payroll_runs
                  WHERE month = $1
                  ORDER BY month DESC LIMIT $2`,
                [month, MAX_PAYROLL_RUNS]
            ),
            pool.query(
                `SELECT id, "employeeId", month, kind, amount, reason
                   FROM payroll_adjustments
                  WHERE month = $1
                  ORDER BY id DESC LIMIT $2`,
                [month, MAX_ADJUSTMENTS]
            ),
        ]);

        let shownMinor = 0;
        let shown = 0;
        let hidden = 0;
        const employees = empRes.rows.map((row) => {
            const rawSalary = row.salary;
            // NULL means the value is absent in the DB — keep it null (as the
            // payroll lib expects) instead of inventing a salary of 0.00.
            const salary = rawSalary === null || rawSalary === undefined ? null : money(rawSalary);
            if (salary === null) {hidden += 1;}
            else {
                try {shownMinor += toMinor(rawSalary);} catch (_) { /* money() already guarded */ }
                shown += 1;
            }
            return {
                id: String(row.id),
                employeeId: row.employeeId === null || row.employeeId === undefined || String(row.employeeId) === ''
                    ? String(row.id)
                    : String(row.employeeId),
                name: row.name ? String(row.name) : `#${String(row.id)}`,
                department: row.department === null || row.department === undefined ? null : String(row.department),
                position: row.position === null || row.position === undefined ? null : String(row.position),
                status: row.status === null || row.status === undefined ? null : String(row.status),
                salary,
            };
        });

        const monthDays = {};
        for (const row of attRes.rows) {
            monthDays[String(row.employeeId)] = Number(row.days) || 0;
        }
        // Array form for clients that cannot consume a Map-serialised object.
        const days = Object.keys(monthDays).map((employeeId) => ({ employeeId, days: monthDays[employeeId] }));

        const runs = runRes.rows.map((row) => ({
            id: String(row.id === null || row.id === undefined ? row.month : row.id),
            month: String(row.month),
            status: row.status === null || row.status === undefined ? null : String(row.status),
            employee_count: Number(row.employee_count) || 0,
            total_basic: money(row.total_basic),
            total_overtime: money(row.total_overtime),
            total_bonuses: money(row.total_bonuses),
            total_penalties: money(row.total_penalties),
            total_advances: money(row.total_advances),
            total_net: money(row.total_net),
        }));

        const adjustments = adjRes.rows.map((row) => ({
            id: String(row.id),
            employeeId: row.employeeId === null || row.employeeId === undefined ? null : String(row.employeeId),
            month: String(row.month),
            kind: row.kind === null || row.kind === undefined ? null : String(row.kind),
            amount: money(row.amount),
            reason: row.reason === null || row.reason === undefined ? null : String(row.reason),
        }));

        return res.json({
            month,
            employees,
            monthDays,
            days,
            runs,
            adjustments,
            summary: { total: formatMinor(shownMinor), shown, hidden },
        });
    })
);

/* ─── 3. GET /api/cashier-revenues ───────────────────────────────────────── */

const revenueRouter = express.Router();

revenueRouter.get(
    '/',
    jwtAuth,
    requireRole(...REVENUE_ROLES),
    asyncHandler(async (req, res) => {
        const from = String(req.query.from == null ? '' : req.query.from).trim();
        const to = String(req.query.to == null ? '' : req.query.to).trim();
        if (!isIsoDay(from) || !isIsoDay(to)) {
            return fail(res, 422, 'INVALID_DATE_RANGE', 'التاريخ بصيغة YYYY-MM-DD.');
        }
        if (Date.parse(`${from}T00:00:00Z`) > Date.parse(`${to}T00:00:00Z`)) {
            return fail(res, 422, 'INVALID_DATE_RANGE', 'التاريخ "من" يجب ألا يكون بعد "إلى".');
        }
        const span = daysBetweenInclusive(from, to);
        if (span > MAX_REVENUE_DAYS) {
            return fail(res, 422, 'DATE_RANGE_TOO_LARGE', `المدى الأقصى ${MAX_REVENUE_DAYS} يومًا.`);
        }
        const deptRaw = req.query.dept == null ? '' : String(req.query.dept).trim();
        const dept = deptRaw ? deptRaw.slice(0, 100) : null;

        const [cashierRes, dayRes] = await Promise.all([
            pool.query(
                `SELECT "deptId" AS dept_code,
                        COALESCE(MAX(source), '') AS source,
                        SUM(amount) AS total,
                        COUNT(*)::int AS entries,
                        COUNT(DISTINCT COALESCE("external_ref", "pos_order_id"::text))::int AS invoices
                   FROM revenues
                  WHERE date >= $1 AND date <= $2 AND ($3::text IS NULL OR "deptId" = $3)
                  GROUP BY "deptId"
                  ORDER BY total DESC NULLS LAST, "deptId" ASC`,
                [from, to, dept]
            ),
            pool.query(
                `SELECT date, SUM(amount) AS total, COUNT(*)::int AS entries
                   FROM revenues
                  WHERE date >= $1 AND date <= $2 AND ($3::text IS NULL OR "deptId" = $3)
                  GROUP BY date
                  ORDER BY date ASC`,
                [from, to, dept]
            ),
        ]);

        const codes = cashierRes.rows.map((row) => String(row.dept_code == null ? '' : row.dept_code)).filter(Boolean);
        const deptNames = new Map();
        if (codes.length) {
            const nameRes = await pool.query(
                'SELECT code, name FROM departments WHERE code = ANY($1::text[])',
                [codes]
            );
            for (const row of nameRes.rows) {deptNames.set(String(row.code), String(row.name || ''));}
        }

        const cashiers = cashierRes.rows.map((row) => {
            const deptCode = String(row.dept_code == null ? '' : row.dept_code);
            const source = row.source ? String(row.source) : null;
            const displayAr = deptNames.get(deptCode) || source || deptCode || 'غير محدد';
            // No name_en column exists on departments; only the well-known
            // cashier code pattern has an honest English label.
            const match = /^ys_cc_(\d+)$/i.exec(deptCode);
            const displayEn = match ? `Cashier ${match[1]}` : null;
            return {
                deptCode,
                displayAr,
                displayEn,
                source,
                total: money(row.total),
                entries: Number(row.entries) || 0,
                invoices: Number(row.invoices) || 0,
            };
        });

        const dayMap = new Map();
        for (const row of dayRes.rows) {
            dayMap.set(String(row.date).slice(0, 10), { total: money(row.total), entries: Number(row.entries) || 0 });
        }
        const byDay = [];
        for (let i = 0; i < span; i += 1) {
            const date = dayAt(from, i);
            const found = dayMap.get(date);
            byDay.push({ date, total: found ? found.total : '0.00', entries: found ? found.entries : 0 });
        }

        let totalMinor = 0;
        let entries = 0;
        let invoices = 0;
        for (const row of cashiers) {
            try {totalMinor += toMinor(row.total);} catch (_) { /* money() already guarded */ }
            entries += row.entries;
            invoices += row.invoices;
        }

        return res.json({
            from,
            to,
            dept,
            total: formatMinor(totalMinor),
            entries,
            invoices,
            cashiers,
            byDay,
        });
    })
);

module.exports = { quoteRouter, payrollRouter, revenueRouter };
