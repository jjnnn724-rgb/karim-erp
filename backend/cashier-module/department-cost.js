/**
 * cashier-module/department-cost.js — «وضع القسم» + «تحليل الفطار»
 * ═══════════════════════════════════════════════════════════════════════════
 * طلب المالك: «أ.. قسم، واستعلم عن كمية البضاعة المسحوبة من المخزن في فترة —
 * عالمي وعالي الاحتراف — كل شيء بالجرام — من خلال أذونات الصرف الفعلية».
 *
 * ثم: «عايز أعرف وضع الافطار — تكلفته — هو بيستخدم بيض وفول وعدس ودقيق وحمص…
 * مقابل إيرادات كاشير 3 — في تقرير رسمي للطباعة».
 *
 * القواعد:
 *   • «كل شيء بالجرام»: للأصناف بوحدة كيلو/جرام/طن — الكمية بالجرام.
 *     للأصناف المُعبأة (كرتون/كيس/علبة): وحدة العبوة كما هي — لا فبركة لأوزان.
 *   • الأرقام من أذونات الصرف الفعلية فقط: inventory_ledger ↔ dispatches
 *     (reference_id = 'DIS-' + dispatches.id) — تغطية 100%.
 *   • تعريفات سلال المكونات صريحة (IDs) — لا تقريب بالكلمات (لا «بيض» داخل «أبيض»).
 *   • النسب «مكونات الفطار / الإيراد» — مواد فقط، بلا راتب أو إيجار أو مرافق.
 */
'use strict';

const express = require('express');
const { pool } = require('./db-pool');
const { logger } = require('../logger');
const { jwtAuth } = require('./jwt-middleware');
const { asyncHandler } = require('../errors/error-handler');

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
const router = express.Router();

const isoDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''));
const range = (req) => ({
    from: isoDate(req.query.from) ? String(req.query.from) : new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10),
    to: isoDate(req.query.to) ? String(req.query.to) : new Date().toISOString().slice(0, 10),
});
const num = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
};
const round2 = (v) => Math.round(num(v) * 100) / 100;
const money = (v) => round2(v);

/** يحوّل الكمية إلى جرامات لو الوحدة كيلو/جرام/طن — غير ذلك null (وحدة العبوة). */
function gramsOf(qty, unit) {
    const u = String(unit || '').trim();
    if (/^(كيلو|kg|kg\.|كجم)$/i.test(u)) { return Math.round(num(qty) * 1000); }
    if (/^(جرام|g|gm|gram)$/i.test(u)) { return Math.round(num(qty)); }
    if (/^(طن|ton|t)$/i.test(u)) { return Math.round(num(qty) * 1_000_000); }
    return null;
}

/* ───────────────────────── تعريفات الفطار ───────────────────────── */

const BREAKFAST_BASKET = [
    { group: 'بيض', ids: [1791136472853144, 1791136473717576] },
    { group: 'فول', ids: [1791136472827130, 1791136473415426] },
    { group: 'عدس', ids: [1791136473726578, 1791136473744584] },
    { group: 'دقيق', ids: [1791136473100276, 1791136473096274] },
    { group: 'حمص', ids: [1791136473521476] },
    { group: 'شوفان', ids: [1791136473196326] },
    { group: 'نقانق', ids: [1791136472945196] },
    { group: 'فاصوليا', ids: [1791136472642026, 1791136472653032, 1791136472876158] },
    { group: 'عسل', ids: [1791136473244348, 1791291892938] },
    { group: 'تمر', ids: [1791136473638538, 1791136473271360] },
    { group: 'مطبق', ids: [1791136473609522, 1793271255419, 1791136472856146, 1791653577854] },
    { group: 'ناجتس', ids: [1791136473695564] },
    { group: 'قشطة', ids: [1791468433228, 1791136473533482] },
    { group: 'مكسرات', ids: [1791136472689052, 1791136473582508, 1791136473107280, 1791136473513472, 1791136473103278] },
];
const BREAKFAST_IDS = BREAKFAST_BASKET.flatMap((g) => g.ids);

/* ───────────────────────── استعلامات ───────────────────────── */

/** الأقسام من أذونات الصرف (الاسم والكود + عدد الأذونات). */
function departmentsQuery() {
    return pool.query(`SELECT "deptName" AS dept, "deptCode" AS code,
                              count(*)::int AS requests,
                              count(*) FILTER (WHERE status = 'received' OR status = 'partially_received')::int AS received
                         FROM dispatches
                        GROUP BY 1, 2 ORDER BY count(*) DESC LIMIT 60`);
}

/** أصناف المسحوبة من المخزن للقسم في الفترة (من الحركات الفعلية). */
function issuesQuery(dept, from, to) {
    return pool.query(`
        SELECT l.inventory_id AS item_id, i.name AS item_name, i.unit AS unit,
               i.category AS category,
               round(sum(abs(l.quantity_delta))::numeric, 4) AS qty,
               round(sum(abs(l.total_cost))::numeric, 2) AS cost,
               count(*)::int AS moves,
               count(DISTINCT d.id)::int AS dispatches
          FROM inventory_ledger l
          JOIN inventory i ON i.id = l.inventory_id
          JOIN dispatches d ON d.id = replace(l.reference_id, 'DIS-', '')::bigint
         WHERE l.reference_type IN ('dispatch') AND l.quantity_delta < 0
           AND l.business_date::date BETWEEN $1::date AND $2::date
           AND d."deptName" = $3
         GROUP BY l.inventory_id, i.name, i.unit, i.category
         ORDER BY sum(abs(l.total_cost)) DESC NULLS LAST`, [from, to, dept]);
}

/** طلبات الخضار الطازج للمطبخ في الفترة (بيانات — بلا تسعير). */
function vegRequestsQuery(from, to) {
    return pool.query(`
        SELECT count(*)::int AS requests,
               round(COALESCE(sum(items_count), 0)::numeric, 0) AS items_count,
               sum((SELECT COALESCE(sum((it->>'qty')::numeric), 0) FROM jsonb_array_elements(items) AS it WHERE it->>'unit' = 'كجم'))::numeric AS qty_kg
          FROM veg_requests
         WHERE department = 'مطبخ'
           AND created_at::date BETWEEN $1::date AND $2::date`, [from, to]);
}

/** حركات أصناف الفطار في الفترة عبر أذونات المطبخ. */
function breakfastIssuesQuery(from, to) {
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
           AND d."deptName" = 'المطبخ'
           AND l.inventory_id = ANY($3::bigint[])
         GROUP BY l.inventory_id, i.name, i.unit
         ORDER BY sum(abs(l.total_cost)) DESC NULLS LAST`, [from, to, BREAKFAST_IDS]);
}

/** إيراد الفطار: كاشير 3 من سجل الإيرادات + YaraSoft (للاطلاع). */
function breakfastRevenueQuery(from, to) {
    return Promise.all([
        pool.query(`SELECT round(sum(amount)::numeric, 2) AS revenue, count(*)::int AS entries
                      FROM revenues
                     WHERE source = 'كاشير 3' AND date BETWEEN $1 AND $2`, [from, to]),
        pool.query(`SELECT round(sum(total)::numeric, 2) AS revenue, count(*)::int AS invoices
                      FROM ys_mirror_orders
                     WHERE cashier_no = '3' AND (doc_date AT TIME ZONE 'Asia/Riyadh')::date BETWEEN $1::date AND $2::date`, [from, to]),
    ]).catch((e) => { throw e; });
}

const prevRange = (from, to) => {
    const f = Date.parse(`${from}T00:00:00Z`);
    const t = Date.parse(`${to}T00:00:00Z`);
    const days = Math.max(1, Math.round((t - f) / 86400000) + 1);
    const prevTo = new Date(f - 86400000).toISOString().slice(0, 10);
    const prevFrom = new Date(Date.parse(prevTo + 'T00:00:00Z') - (days - 1) * 86400000).toISOString().slice(0, 10);
    return { prevFrom, prevTo };
};

/* ───────────────────────── المسارات ───────────────────────── */

/** قائمة الأقسام من أذونات الصرف (لاختيار القسم). */
router.get('/reports/issue-departments', jwtAuth, requireReportRole(...REPORT_ROLES), asyncHandler(async (req, res) => {
    const r = await departmentsQuery();
    res.json({ departments: r.rows.map((row) => ({ dept: row.dept, code: row.code, requests: row.requests, received: row.received })) });
}));

/** وضع القسم: كل ما سُحب من المخزن لهذا القسم في الفترة — بالجرام. */
router.get('/reports/department-issues', jwtAuth, requireReportRole(...REPORT_ROLES), asyncHandler(async (req, res) => {
    const { from, to } = range(req);
    const dept = String(req.query.dept || '').trim();
    if (!dept) {return res.status(422).json({ error: 'DEPT_REQUIRED', message: 'اختر القسم أولًا.' });}
    if (dept.length > 120) {return res.status(422).json({ error: 'DEPT_INVALID', message: 'اسم القسم طويل.' });}

    const [items, veg] = await Promise.all([
        issuesQuery(dept, from, to),
        dept === 'المطبخ' ? vegRequestsQuery(from, to).catch(() => ({ rows: [] })) : Promise.resolve({ rows: [] }),
    ]);

    const rows = items.rows.map((r) => ({
        item_id: String(r.item_id),
        name: r.item_name,
        unit: r.unit,
        category: r.category,
        qty: num(r.qty),
        grams: gramsOf(r.qty, r.unit),
        cost: money(r.cost),
        moves: num(r.moves),
        dispatches: num(r.dispatches),
    }));
    const totalCost = round2(rows.reduce((s, r) => s + r.cost, 0));
    for (const r of rows) {r.share = totalCost > 0 ? round2((r.cost / totalCost) * 100) : 0;}
    const totalGrams = rows.reduce((s, r) => s + (r.grams || 0), 0);
    const weightRows = rows.filter((r) => r.grams !== null).length;

    res.json({
        department: dept,
        from, to,
        totals: {
            items: rows.length,
            moves: rows.reduce((s, r) => s + r.moves, 0),
            dispatches: rows.length ? Math.max(...rows.map((r) => r.dispatches)) : 0,
            cost: totalCost,
            grams: totalGrams,
            weight_items: weightRows,
            packed_items: rows.length - weightRows,
        },
        items: rows,
        veg: veg.rows && veg.rows[0] ? { requests: num(veg.rows[0].requests), items_count: num(veg.rows[0].items_count), qty_kg: num(veg.rows[0].qty_kg) } : null,
    });
}));

/** تحليل الفطار: تكلفة مكوّناته من أذونات المطبخ ÷ إيرادات كاشير 3. */
router.get('/reports/breakfast-cost', jwtAuth, requireReportRole(...REPORT_ROLES), asyncHandler(async (req, res) => {
    const { from, to } = range(req);
    const { prevFrom, prevTo } = prevRange(from, to);

    const [issues, [curRev, curYs], [prevRevQ, prevYsQ], veg] = await Promise.all([
        breakfastIssuesQuery(from, to).catch((e) => { logger.error({ err: { message: e.message } }, '[dept-cost] breakfast issues failed'); return { rows: [] }; }),
        breakfastRevenueQuery(from, to).catch(() => [{ rows: [{ revenue: '0.00', entries: 0 }] }, { rows: [{ revenue: '0.00', invoices: 0 }] }]),
        breakfastRevenueQuery(prevFrom, prevTo).catch(() => [{ rows: [{ revenue: '0.00', entries: 0 }] }, { rows: [{ revenue: '0.00', invoices: 0 }] }]),
        vegRequestsQuery(from, to).catch(() => ({ rows: [] })),
    ]);

    const byId = new Map(issues.rows.map((r) => [String(r.item_id), r]));
    const groups = BREAKFAST_BASKET.map((g) => {
        const gItems = g.ids.map((id) => {
            const r = byId.get(String(id));
            return r
                ? { item_id: String(r.item_id), name: r.item_name, unit: r.unit, qty: num(r.qty), grams: gramsOf(r.qty, r.unit), cost: money(r.cost), moves: num(r.moves) }
                : null;
        }).filter(Boolean);
        const groupCost = round2(gItems.reduce((s, it) => s + it.cost, 0));
        const groupQtyKg = gItems.reduce((s, it) => s + (it.grams ? it.grams / 1000 : 0), 0);
        return { group: g.group, items: gItems, cost: groupCost, kg: round2(groupQtyKg) };
    }).filter((g) => g.items.length);

    const totalCost = round2(groups.reduce((s, g) => s + g.cost, 0));
    for (const g of groups) {g.share = totalCost > 0 ? round2((g.cost / totalCost) * 100) : 0;}

    const rev = num(curRev.rows[0] && curRev.rows[0].revenue);
    const prevRev = num(prevRevQ.rows[0] && prevRevQ.rows[0].revenue);
    const ysRev = num(curYs.rows[0] && curYs.rows[0].revenue);
    const pct = rev > 0 ? round2((totalCost / rev) * 100) : 0;
    const deltaPct = prevRev > 0 ? round2(((rev - prevRev) / prevRev) * 100) : 0;
    const verdict = pct >= 30
        ? { tone: 'danger', text: 'مكلف — راجع أسعار التوريد والموردين الحاليين' }
        : pct >= 20 ? { tone: 'warning', text: 'مقبول لكن في حدّ المسموح به' }
            : pct >= 10 ? { tone: 'success', text: 'ممتاز — هامش مريح' }
                : { tone: 'info', text: 'ممتاز جدًا — أو تسريب مواد خارج القنوات' };

    res.json({
        from, to, previous: { from: prevFrom, to: prevTo },
        revenue: money(rev),
        revenue_entries: num(curRev.rows[0] && curRev.rows[0].entries),
        revenue_ys: money(ysRev),
        previous_revenue: money(prevRev),
        revenue_delta_pct: deltaPct,
        total_cost: totalCost,
        cost_pct: pct,
        verdict,
        groups,
        top_items: issues.rows.slice(0, 12).map((r) => ({
            item_id: String(r.item_id), name: r.item_name, unit: r.unit,
            qty: num(r.qty), grams: gramsOf(r.qty, r.unit), cost: money(r.cost),
        })),
        veg: {
            requests: num(veg.rows[0] && veg.rows[0].requests),
            items_count: num(veg.rows[0] && veg.rows[0].items_count),
            qty_kg: num(veg.rows[0] && veg.rows[0].qty_kg),
        },
        notes: [
            prevRev > 0 ? 'الفترة السابقة متاحة — تمت المقارنة بكامل الفترة السابقة.' : 'الفترة السابقة لا تحتوي بيانات كاشير 3 (تبدأ 2026-10-15) — لا توجد مقارنة متاحة.',
            'الإيراد المحتسب: كاشير 3 (الافطار) — سجل الإيرادات المحاسبي.',
            'التكلفة: مكونات الفطار الفعلية من أذونات صرف المطبخ (مواد فقط: بدون راتب أو إيجار أو مرافق).',
            'كل شيء بالجرام للأصناف الموزونة (كيلو/جرام/طن)؛ الأصناف المُعبأة وحدة العبوة كما هي.',
            'الخضار الطازجة واردة للمطبخ من طلبات الخضار — بلا تسعير مسجل — غير محتسبة في التكلفة.',
            'لا يوجد صنف «لحم مفروم» مسجّل في المخزن — إن كان يُطلب للفطار فهو غير محسوب هنا.',
        ],
    });
}));

module.exports = { router, BREAKFAST_BASKET, gramsOf, prevRange };
