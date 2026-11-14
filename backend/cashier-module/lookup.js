/**
 * cashier-module/lookup.js — «ابحث بكلمة»: شاورما · مشويات · كبسة · أي شيء
 * ═══════════════════════════════════════════════════════════════════════
 * طلب المالك: «عايز اطلع تقرير شاورما — كم تُسحبت من المخزن وكم مبيعاتها»
 * «وأي شيء فيه كلمة مشويات» — «مش عايز السستم عقيم».
 *
 * الإجابة: بحث حر في النصوص الفعلية:
 *   • مبيعات: ys_mirror_orders.lines[].name يحوي الكلمة
 *   • صرف: أصناف inventory.name فيها الكلمة (+ تحويلات/استلامات مخزن)
 *   • التكلفة مقابل الإيراد لتلك السلّة
 * أي كلمة — لا قائمة بيضاء ولا شيء مخزّن مسبقًا.
 */
'use strict';

const express = require('express');
const { pool } = require('./db-pool');
const { logger } = require('../logger');
const { jwtAuth } = require('./jwt-middleware');
const { asyncHandler } = require('../errors/error-handler');

const router = express.Router();

const isoDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''));
const kwEscape = (k) => String(k || '').replace(/[\\%_]/g, (c) => '\\' + c);
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const round2 = (v) => Math.round(num(v) * 100) / 100;
const money = (v) => round2(v);

const REPORT_ROLES = ['admin', 'manager', 'accountant'];

function requireReportRole(...roles) {
    return (req, res, next) => {
        const role = String((req.user && req.user.role) || '');
        if (!roles.includes(role)) {
            return res.status(403).json({ error: 'FORBIDDEN', message: 'هذا التقرير لمن يملك صلاحية التقارير فقط.' });
        }
        return next();
    };
}

function range(req) {
    const today = new Date();
    const from = isoDate(req.query.from) ? String(req.query.from) : new Date(today.getTime() - 29 * 86400000).toISOString().slice(0, 10);
    const to = isoDate(req.query.to) ? String(req.query.to) : today.toISOString().slice(0, 10);
    return { from, to };
}

/** مبيعات من خطوط الفواتير: أي صنف اسمه فيه الكلمة. */
function salesLookup(keyword, from, to) {
    return pool.query(`
        SELECT count(DISTINCT o.doc_no)::int AS invoices,
               count(*)::int AS lines,
               round(sum((x->>'qty')::numeric), 3) AS qty,
               round(sum((x->>'total')::numeric), 2) AS revenue
          FROM ys_mirror_orders o
          CROSS JOIN LATERAL jsonb_array_elements(o.lines) AS x
         WHERE (o.doc_date AT TIME ZONE 'Asia/Riyadh')::date BETWEEN $1::date AND $2::date
           AND (x->>'name') ILIKE $3 ESCAPE '\\'`, [from, to, `%${kwEscape(keyword)}%`]);
}

/** الأكثر مبيعًا في المطابقة. */
function topLookup(keyword, from, to) {
    return pool.query(`
        SELECT x->>'name' AS name,
               round(sum((x->>'qty')::numeric), 3) AS qty,
               round(sum((x->>'total')::numeric), 2) AS revenue,
               count(DISTINCT o.doc_no)::int AS invoices
          FROM ys_mirror_orders o
          CROSS JOIN LATERAL jsonb_array_elements(o.lines) AS x
         WHERE (o.doc_date AT TIME ZONE 'Asia/Riyadh')::date BETWEEN $1::date AND $2::date
           AND (x->>'name') ILIKE $3 ESCAPE '\\'
         GROUP BY x->>'name'
         ORDER BY sum((x->>'total')::numeric) DESC
         LIMIT 12`, [from, to, `%${kwEscape(keyword)}%`]);
}

/** صرف المخزن الفعلي المباشر من أذونات الصرف (مطبخ/أقسام). */
function issuesLookup(keyword, from, to) {
    return pool.query(`
        SELECT l.inventory_id AS item_id, i.name AS item_name, i.unit AS unit,
               round(sum(abs(l.quantity_delta))::numeric, 4) AS qty,
               round(sum(abs(l.total_cost))::numeric, 2) AS cost,
               count(*)::int AS moves
          FROM inventory_ledger l
          JOIN inventory i ON i.id = l.inventory_id
          JOIN dispatches d ON d.id = replace(l.reference_id, 'DIS-', '')::bigint
         WHERE l.reference_type = 'dispatch' AND l.quantity_delta < 0
           AND l.business_date::date BETWEEN $1::date AND $2::date
           AND i.name ILIKE $3 ESCAPE '\\'
         GROUP BY l.inventory_id, i.name, i.unit
         ORDER BY sum(abs(l.total_cost)) DESC NULLS LAST
         LIMIT 12`, [from, to, `%${kwEscape(keyword)}%`]);
}

/** كل الأصناف في المخزن المطابقة للكلمة (للعرض فقط). */
function inventoryLookup(keyword) {
    return pool.query(`
        SELECT count(*)::int AS items,
               round(sum(COALESCE(qty, 0) * COALESCE("avgCost", 0))::numeric, 2) AS value
          FROM inventory
         WHERE name ILIKE $1 ESCAPE '\\'`, [`%${kwEscape(keyword)}%`]);
}

/** إجمالي إيرادات الفترة (للنسبة) — من ys المبيعات. */
function totalRevenue(from, to) {
    return pool.query(`SELECT round(sum(total)::numeric, 2) AS revenue FROM ys_mirror_orders
                        WHERE (doc_date AT TIME ZONE 'Asia/Riyadh')::date BETWEEN $1::date AND $2::date`, [from, to]);
}

router.get('/reports/lookup', jwtAuth, requireReportRole(...REPORT_ROLES), asyncHandler(async (req, res) => {
    const keyword = String(req.query.keyword || '').trim().slice(0, 60);
    if (!keyword || keyword.length < 2) {
        return res.status(400).json({ error: 'KEYWORD_REQUIRED', message: 'اكتب كلمة البحث (حرفان على الأقل).' });
    }
    const { from, to } = range(req);

    const [sales, top, issues, inv, total] = await Promise.all([
        salesLookup(keyword, from, to),
        topLookup(keyword, from, to),
        issuesLookup(keyword, from, to),
        inventoryLookup(keyword),
        totalRevenue(from, to),
    ]);

    const s = sales.rows[0] || { invoices: 0, lines: 0, qty: '0', revenue: '0.00' };
    const issuesList = issues.rows.map((r) => ({
        item_id: String(r.item_id),
        name: r.item_name,
        unit: r.unit,
        qty: num(r.qty),
        cost: money(r.cost),
        moves: num(r.moves),
    }));
    const issuesCost = round2(issuesList.reduce((s, it) => s + it.cost, 0));
    const invRow = inv.rows[0] || { items: 0, value: '0.00' };
    const totalRev = num(total.rows[0] && total.rows[0].revenue);

    res.json({
        keyword,
        from, to,
        sales: {
            invoices: num(s.invoices),
            lines: num(s.lines),
            qty: num(s.qty),
            revenue: money(s.revenue),
            share_of_revenue: totalRev > 0 ? round2((num(s.revenue) / totalRev) * 100) : 0,
        },
        sales_breakdown: top.rows.map((r) => ({
            name: r.name,
            qty: num(r.qty),
            revenue: money(r.revenue),
            invoices: num(r.invoices),
        })),
        issues: issuesList,
        issues_cost: issuesCost,
        inventory: {
            items: num(invRow.items),
            value: money(invRow.value),
        },
        notes: [
            'المبيعات: أي سطر فاتورة اسمه يحوي الكلمة — من ys_mirror_orders.',
            'الصرف: أي صنف مخزن اسمه يحوي الكلمة — من أذونات الصرف الفعلية.',
            'القيمة المخزنية: كل الأصناف المطابقة بمتوسط التكلفة.',
        ],
    });
}));

module.exports = { router };
