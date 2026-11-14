/**
 * pos-reports.js — تقارير المطعم الاحترافية (قابلة للطباعة بورقة رسمية)
 * ═══════════════════════════════════════════════════════════════════════════════
 * ثلاثة تقارير تغطي طلب المالك:
 *   1) تقرير قسم: إيرادات القسم وأوردراته وعدد الفواتير ومتوسط الفاتورة والضريبة
 *      والخصومات وتقسيم طرق الدفع — لأي قسم وفترة.
 *   2) تقرير صنف: إيراد الصنف وكميته المباعة ومتوسط سعره وعدد فواتيره — لأي صنف وفترة.
 *   3) تقرير المخزن: كل حركة سحب/إضافة بكمية وقيمة وسببها — لأي فترة (وصنف اختياري).
 *
 * مصادر الحقيقة:
 *   • المبيعات: ys_mirror_orders (مرآة YaraSoft) + خطوطها في العمود lines (JSON).
 *   • الإيراد per قسم: revenues (deptId) — وهو المرجع المحاسبي في النظام.
 *   • المخزن: inventory_ledger (quantity_delta / total_cost / reason / business_date).
 *
 * كل تقرير له مسار JSON (للشاشة) ومسار HTML رسمي (للطباعة: لوجو + ترويسة +
 * جداول + خانات توقيع) — الورقة المطبوعة هي نفسها المعروضة على الشاشة.
 */
'use strict';

const express = require('express');
const { pool } = require('./db-pool');
const { jwtAuth } = require('./jwt-middleware');
const { logger } = require('../logger');

const router = express.Router();
const REPORT_ROLES = ['admin', 'manager', 'accountant'];

function requireReportRole(...roles) {
    return (req, res, next) => {
        const role = String(req.user?.role ?? '');
        if (!roles.includes(role)) {
            return res.status(403).json({ error: 'FORBIDDEN', message: 'التقارير المالية محصورة على الإداري والمحاسب' });
        }
        return next();
    };
}

const esc = (value) => String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const money = (value) => Number(value || 0).toFixed(2);
const num = (value) => Number(value || 0).toFixed(3).replace(/\.000$/, '');

function range(req) {
    const today = new Date();
    const from = String(req.query.from || '').match(/^\d{4}-\d{2}-\d{2}$/) ? String(req.query.from) : null;
    const to = String(req.query.to || '').match(/^\d{4}-\d{2}-\d{2}$/) ? String(req.query.to) : null;
    const fallbackFrom = new Date(today.getTime() - 30 * 86400000).toISOString().slice(0, 10);
    return {
        from: from || fallbackFrom,
        to: to || today.toISOString().slice(0, 10),
    };
}

/** خريطة القسم ↔ أرقام الكاشير (المصدر: جدول dept_cashier_links). */
async function cashierDeptMap() {
    const res = await pool.query('SELECT dept_code, cashier_no FROM dept_cashier_links');
    const map = new Map();
    for (const row of res.rows) {
        const dept = String(row.dept_code || '').trim();
        const no = String(row.cashier_no || '').trim();
        if (!dept || !no) { continue; }
        if (!map.has(dept)) { map.set(dept, []); }
        map.get(dept).push(no);
    }
    return map;
}

// ═══════════════════════════════════════════════════════════════════════════
// 1) تقرير القسم
// ═══════════════════════════════════════════════════════════════════════════
async function departmentReport({ from, to, departmentId }) {
    const map = await cashierDeptMap();
    const deptFilter = departmentId ? Number(departmentId) : null;

    const deptRows = await pool.query(`
        SELECT p.id, p.code, p.name_ar, p.legacy_dept_code
          FROM pos_departments p
         WHERE p.is_active = true
           AND ($1::bigint IS NULL OR p.id = $1)
         ORDER BY p.sort_order, p.id`, [deptFilter]);

    // كل الأقسام المعروفة (لعرض اسم القسم في التقرير)
    const allDepts = await pool.query(`
        SELECT p.id, p.code, p.name_ar, p.legacy_dept_code
          FROM pos_departments p WHERE p.is_active = true ORDER BY p.sort_order, p.id`);

    const legacyById = new Map();
    for (const d of allDepts.rows) { legacyById.set(String(d.id), d); }

    // أرقام الكاشير لكل قسم (من dept_cashier_links)
    const cashiersByLegacy = new Map();
    for (const [dept, nos] of map.entries()) {
        cashiersByLegacy.set(dept, nos);
    }

    const sales = await pool.query(`
        SELECT o.cashier_no,
               count(*)::int AS invoices,
               round(sum(o.net)::numeric, 2) AS net,
               round(sum(o.total)::numeric, 2) AS total,
               round(sum(o.vat)::numeric, 2) AS vat,
               round(sum(o.discount)::numeric, 2) AS discount,
               round(sum(o.pay_cash)::numeric, 2) AS cash,
               round(sum(o.pay_network)::numeric, 2) AS card,
               round(sum(COALESCE(o.pay_mobile, 0) + COALESCE(o.pay_credit, 0))::numeric, 2) AS other
          FROM ys_mirror_orders o
         WHERE (o.doc_date AT TIME ZONE 'Asia/Riyadh')::date BETWEEN $1::date AND $2::date
         GROUP BY o.cashier_no`, [from, to]);

    const salesByCashier = new Map();
    for (const row of sales.rows) { salesByCashier.set(String(row.cashier_no), row); }

    // الإيراد المحاسبي لكل قسم (revenues."deptId" = كود القسم departments.code)
    const revenueRows = await pool.query(`
        SELECT r."deptId" AS dept_code, d.code AS code, d.name AS dept_name,
               round(sum(r.amount)::numeric, 2) AS amount, count(*)::int AS entries
          FROM revenues r
          LEFT JOIN departments d ON d.code = r."deptId"
         WHERE r.date BETWEEN $1 AND $2
         GROUP BY r."deptId", d.code, d.name
         ORDER BY sum(r.amount) DESC`, [from, to]);

    const revenueByCode = new Map();
    for (const row of revenueRows.rows) {
        revenueByCode.set(String(row.dept_code || '').toLowerCase(), row);
    }

    const rows = [];
    for (const dept of deptRows.rows) {
        const legacy = String(dept.legacy_dept_code || '').trim();
        const cashiers = cashiersByLegacy.get(legacy) || [];
        let invoices = 0; let net = 0; let total = 0; let vat = 0; let discount = 0;
        let cash = 0; let card = 0; let other = 0;
        for (const no of cashiers) {
            const s = salesByCashier.get(String(no));
            if (!s) { continue; }
            invoices += Number(s.invoices || 0);
            net += Number(s.net || 0);
            total += Number(s.total || 0);
            vat += Number(s.vat || 0);
            discount += Number(s.discount || 0);
            cash += Number(s.cash || 0);
            card += Number(s.card || 0);
            other += Number(s.other || 0);
        }
        const revenue = revenueByCode.get(legacy.toLowerCase());
        rows.push({
            department_id: String(dept.id),
            code: dept.code,
            name: dept.name_ar || dept.code,
            legacy_code: legacy,
            cashiers,
            invoices,
            net: money(net),
            total: money(total),
            vat: money(vat),
            discount: money(discount),
            cash: money(cash),
            card: money(card),
            other: money(other),
            average_ticket: invoices ? money(total / invoices) : '0.00',
            accounting_revenue: revenue ? money(revenue.amount) : '0.00',
            revenue_entries: revenue ? Number(revenue.entries || 0) : 0,
        });
    }

    const totals = rows.reduce((acc, r) => ({
        invoices: acc.invoices + r.invoices,
        net: acc.net + Number(r.net),
        total: acc.total + Number(r.total),
        vat: acc.vat + Number(r.vat),
        discount: acc.discount + Number(r.discount),
        cash: acc.cash + Number(r.cash),
        card: acc.card + Number(r.card),
        other: acc.other + Number(r.other),
    }), { invoices: 0, net: 0, total: 0, vat: 0, discount: 0, cash: 0, card: 0, other: 0 });
    totals.average_ticket = totals.invoices ? money(totals.total / totals.invoices) : '0.00';

    return { from, to, rows, totals };
}

// ═══════════════════════════════════════════════════════════════════════════
// 2) تقرير الصنف
// ═══════════════════════════════════════════════════════════════════════════
async function productReport({ from, to, productCode, productName }) {
    const params = [from, to];
    const filters = [];
    if (productCode) { params.push(productCode); filters.push(`lower(l->>'code') = lower($${params.length})`); }
    if (productName) { params.push(productName); filters.push(`lower(l->>'name') LIKE lower($${params.length})`); }
    const where = filters.length ? `AND ${filters.join(' AND ')}` : '';

    const rows = await pool.query(`
        SELECT l->>'code' AS code, l->>'name' AS name,
               round(sum((l->>'qty')::numeric), 3) AS qty,
               round(sum((l->>'total')::numeric), 2) AS revenue,
               round(sum((l->>'vat')::numeric), 2) AS vat,
               round(sum((l->>'discount')::numeric), 2) AS discount,
               count(DISTINCT o.doc_no)::int AS invoices,
               count(*)::int AS lines
          FROM ys_mirror_orders o
          CROSS JOIN LATERAL jsonb_array_elements(o.lines::jsonb) AS l
         WHERE (o.doc_date AT TIME ZONE 'Asia/Riyadh')::date BETWEEN $1::date AND $2::date
           ${where}
         GROUP BY l->>'code', l->>'name'
         ORDER BY sum((l->>'total')::numeric) DESC
         LIMIT 500`, params);

    const daily = await pool.query(`
        SELECT (o.doc_date AT TIME ZONE 'Asia/Riyadh')::date AS day,
               round(sum((l->>'total')::numeric), 2) AS revenue,
               round(sum((l->>'qty')::numeric), 3) AS qty
          FROM ys_mirror_orders o
          CROSS JOIN LATERAL jsonb_array_elements(o.lines::jsonb) AS l
         WHERE (o.doc_date AT TIME ZONE 'Asia/Riyadh')::date BETWEEN $1::date AND $2::date
           ${where}
         GROUP BY 1 ORDER BY 1`, params);

    const list = rows.rows.map((r) => ({
        code: r.code,
        name: r.name,
        qty: num(r.qty),
        revenue: money(r.revenue),
        vat: money(r.vat),
        discount: money(r.discount),
        invoices: Number(r.invoices || 0),
        average_price: Number(r.qty) > 0 ? money(Number(r.revenue) / Number(r.qty)) : '0.00',
    }));

    const totals = list.reduce((acc, r) => ({
        qty: acc.qty + Number(r.qty),
        revenue: acc.revenue + Number(r.revenue),
        vat: acc.vat + Number(r.vat),
        discount: acc.discount + Number(r.discount),
        invoices: acc.invoices + r.invoices,
    }), { qty: 0, revenue: 0, vat: 0, discount: 0, invoices: 0 });
    totals.average_price = totals.qty > 0 ? money(totals.revenue / totals.qty) : '0.00';

    return {
        from, to,
        rows: list,
        daily: daily.rows.map((d) => ({ day: String(d.day).slice(0, 10), revenue: money(d.revenue), qty: num(d.qty) })),
        totals: { qty: num(totals.qty), revenue: money(totals.revenue), vat: money(totals.vat), discount: money(totals.discount), invoices: totals.invoices, average_price: totals.average_price },
    };
}

// ═══════════════════════════════════════════════════════════════════════════
// 3) تقرير حركة المخزن
// ═══════════════════════════════════════════════════════════════════════════
async function inventoryReport({ from, to, itemId, search }) {
    const params = [from, to];
    const filters = [];
    if (itemId) { params.push(itemId); filters.push(`l.inventory_id::text = $${params.length}`); }
    if (search) { params.push(search); filters.push(`(i.name LIKE $${params.length} OR i.category LIKE $${params.length})`); }
    const where = filters.length ? `AND ${filters.join(' AND ')}` : '';

    const rows = await pool.query(`
        SELECT l.id, l.business_date, l.transaction_type, l.reference_type, l.reason,
               l.quantity_delta, l.unit, l.unit_cost, l.total_cost,
               i.id AS item_id, i.name AS item_name, i.category AS item_category, i.unit AS item_unit
          FROM inventory_ledger l
          LEFT JOIN inventory i ON i.id = l.inventory_id
         WHERE (l.business_date AT TIME ZONE 'Asia/Riyadh')::date BETWEEN $1::date AND $2::date
           ${where}
         ORDER BY l.business_date DESC, l.id DESC
         LIMIT 500`, params);

    const list = rows.rows.map((r) => ({
        id: r.id,
        date: String(r.business_date || '').slice(0, 10),
        type: r.transaction_type,
        reference_type: r.reference_type,
        reason: r.reason,
        item_id: r.item_id,
        item_name: r.item_name,
        item_category: r.item_category,
        unit: r.unit || r.item_unit || '',
        quantity: num(r.quantity_delta),
        direction: Number(r.quantity_delta) >= 0 ? 'in' : 'out',
        unit_cost: money(r.unit_cost),
        value: money(r.total_cost),
    }));

    const totals = list.reduce((acc, r) => ({
        in_qty: acc.in_qty + (r.direction === 'in' ? Number(r.quantity) : 0),
        out_qty: acc.out_qty + (r.direction === 'out' ? Math.abs(Number(r.quantity)) : 0),
        in_value: acc.in_value + (r.direction === 'in' ? Number(r.value) : 0),
        out_value: acc.out_value + (r.direction === 'out' ? Math.abs(Number(r.value)) : 0),
        movements: acc.movements + 1,
    }), { in_qty: 0, out_qty: 0, in_value: 0, out_value: 0, movements: 0 });

    return {
        from, to, rows: list,
        totals: {
            in_qty: num(totals.in_qty), out_qty: num(totals.out_qty),
            in_value: money(totals.in_value), out_value: money(totals.out_value),
            movements: totals.movements,
        },
    };
}

// ═══════════════════════════════════════════════════════════════════════════
// المسارات
// ═══════════════════════════════════════════════════════════════════════════
router.get('/reports/department', jwtAuth, requireReportRole(...REPORT_ROLES), async (req, res) => {
    try {
        const { from, to } = range(req);
        const departmentId = req.query.department_id ? Number(req.query.department_id) : null;
        const data = await departmentReport({ from, to, departmentId });
        res.json(data);
    } catch (err) {
        logger.error('[pos/reports] department failed', err);
        res.status(500).json({ error: 'REPORT_FAILED', message: 'تعذر إعداد تقرير الأقسام' });
    }
});

router.get('/reports/product', jwtAuth, requireReportRole(...REPORT_ROLES), async (req, res) => {
    try {
        const { from, to } = range(req);
        const data = await productReport({
            from, to,
            productCode: req.query.product_code ? String(req.query.product_code) : null,
            productName: req.query.product_name ? String(req.query.product_name) : null,
        });
        res.json(data);
    } catch (err) {
        logger.error('[pos/reports] product failed', err);
        res.status(500).json({ error: 'REPORT_FAILED', message: 'تعذر إعداد تقرير الأصناف' });
    }
});

router.get('/reports/inventory', jwtAuth, requireReportRole(...REPORT_ROLES), async (req, res) => {
    try {
        const { from, to } = range(req);
        const data = await inventoryReport({
            from, to,
            itemId: req.query.item_id ? String(req.query.item_id) : null,
            search: req.query.search ? String(req.query.search) : null,
        });
        res.json(data);
    } catch (err) {
        logger.error('[pos/reports] inventory failed', err);
        res.status(500).json({ error: 'REPORT_FAILED', message: 'تعذر إعداد تقرير المخزن' });
    }
});

module.exports = { router, departmentReport, productReport, inventoryReport };
