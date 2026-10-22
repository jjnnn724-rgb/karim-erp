/**
 * inventory-inquiry.js — محرك الاستعلامات: ما دخل، وما في المخزن، وما انصرف، وما بيع، والتكلفة
 * ════════════════════════════════════════════════════════════════════════════════
 * سياسة المالك 2026-10-19: «أعرف أي صنف دخل من الفواتير وكم عدده، واللي في المخزن
 * واللي تم صرفه، وقائمة أخرى أعرف أي صنف كم منه اتبع، وتفاصيل كل شيء… كم الكوست
 * العام وكم كوست أي قسم». القراءة للمدير والسو-شيف فقط.
 *
 * THREE DOORS — ALL GET, ALL READ-ONLY (this file never writes and never posts)
 *   /api/inventory-inquiry/items?from&to&dept&q&cat&only&sort&dir&limit&offset
 *   /api/inventory-inquiry/item/:id?from&to
 *   /api/inventory-inquiry/departments?from&to
 *
 * WHY THE LEDGER IS THE ONLY AUTHORITY FOR MOVEMENTS
 *   `inventory_ledger` is the immutable book (021_inventory_ledger_locations.sql:27),
 *   `quantity_delta` is signed — positive enters, negative leaves, and zero is
 *   forbidden by CHECK (:38,:58). `inventory.qty` is a projection that
 *   inventory-ledger.js:131-136 recomputes from `inventory_location_balances`
 *   after every posting, so on-hand is read from the balances (scoped per
 *   department) and falls back to the projection only when no scope is set.
 *   The legacy `inventoryTx` rows are NOT used here: they are a parallel
 *   narrative of the same events, and a second authority is what this rewrite
 *   exists to remove.
 *
 * HOW EACH NUMBER IS DEFINED — copied from the server's own postings, invented
 * by nobody:
 *   qtyInPurchases  net signed sum of the purchase reference family. A void
 *                   posts transaction_type='reversal' with reference_type
 *                   'purchase_invoice_void' and a NEGATIVE delta
 *                   (warehouse-routes.js:2800-2803), and an edit posts
 *                   'purchase_invoice_edit_reversal' before re-adding (:2320-2323),
 *                   so the signed sum is the true net received — not the gross.
 *   qtyInOther      positive deltas of the inbound types that are not purchases:
 *                   opening_balance, transfer_in, production_output, return
 *                   (a kitchen/direct return posts 'return' positive into the
 *                   main store — warehouse-routes.js:1253 and :1411).
 *   qtyOutDispatch  negative deltas whose reference_type='dispatch' — the
 *                   same filter as GET /warehouse/issued-totals (:2969-2977).
 *   qtyOutSale      negative deltas of transaction_type='sale_consumption',
 *                   which complete-sale.js:707-720 posts per recipe ingredient
 *                   when a POS order is completed.
 *   qtyOutProduction/Transfer/Waste  the remaining outbound types by name.
 *   qtyNet          every delta in the window — what actually happened to the
 *                   stock. It is deliberately shown beside the buckets because
 *                   the buckets do not sum to it: reversals sit inside
 *                   qtyInPurchases as negatives, and a transfer_in at one
 *                   location is a transfer_out at another.
 *   purchaseCost    signed cost of the same purchase family (total_cost is
 *                   posted as abs(delta)×unit_cost — inventory-ledger.js:110 —
 *                   so a void must be subtracted, not added).
 *   onHand          inventory_location_balances.on_hand for the scoped
 *                   department, or inventory.qty when no department is scoped.
 *   stockValue      onHand × inventory."avgCost" (weighted average maintained
 *                   by the warehouse routes at posting time).
 *
 * TWO SOLD NUMBERS, NEVER ONE BLENDED NUMBER
 *   pos:     exact relational join — pos_order_items → pos_orders (status
 *            'issued'|'reported') → pos_products.legacy_inventory_id → inventory.id.
 *            This is a fact.
 *   yara:    the YaraSoft mirror has no inventory id; its lines are JSONB text
 *            (ys_mirror_orders.lines with name/qty/total/vat — 071:7-21). The
 *            only join available is the normalized Arabic name, which is
 *            exactly how the existing /yara-reports/wh-vs-pos door matches
 *            (yara-reports.js:1003-1012 and :1046-1063). normName below is that
 *            function copied verbatim so the two doors can never disagree.
 *            Because a name match is not a fact, the payload states
 *            `matched:false` per row and `yara.matched/unmatched` totals in meta.
 *            The UI must never add the two columns together.
 *
 * DEPARTMENT COST, WITH THE DOUBLE-COUNTING TRAP STATED
 *   Dispatches auto-write expense rows carrying adjustmentType='dispatch'
 *   (server.js:2316 deletes exactly that family). So a department's cost is
 *   reported as two separate figures — issuedCost from the ledger at weighted
 *   cost, and operating expenses excluding the stock/count families the backend
 *   already excludes everywhere else (accounting-routes.js:590,
 *   daily-report-service.js:56, manager-briefing.js:49, inventory-control-routes.js:368)
 *   — and `costTotal` is the sum of THOSE TWO, never of all expense rows.
 *
 * HONESTY
 *   Empty range → empty rows and stated totals, never zeros dressed as facts.
 *   A malformed date, an inverted range or a range wider than 93 days is
 *   rejected locally with the same codes the yara doors use (INVALID_RANGE /
 *   RANGE_TOO_WIDE) before any SQL runs. Nothing here invents a date, an item
 *   or a number.
 */
'use strict';

const express = require('express');
const { pool } = require('./shared-pool');
const { jwtAuth } = require('./cashier-module/jwt-middleware');
const { requireRoleOrPerm } = require('./permissions');
const { logger } = require('./logger');

const router = express.Router();

/** سياسة المالك: المدير والسو-شيف. أي غيرهما يُرفض 403 من الخادم لا من المتصفح. */
const READ_ROLES = ['admin', 'sous_chef'];
const READ_PERM = 'inventory-inquiry.view';

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_SPAN_DAYS = 93;

/** عائلة مراجع فاتورة الشراء — الاستلام وعكوسه جميعًا (انظر أعلى الملف). */
const PURCHASE_REFS = `('purchase_invoice','purchase_invoice_void','purchase_invoice_edit','purchase_invoice_edit_reversal')`;

/** عائلات المصروفات المخزنية/الجردية التي تُستثنى من «التشغيلي» في كل الخادم. */
const STOCK_EXPENSE_TYPES = `('dispatch','dispatch_return','transfer','receipt','stock_transfer','inventory_transfer','kitchen_return','count_correction')`;

/** يوم الرياض بصيغة YYYY-MM-DD — نفس مولّد الواجهات الأخرى (yara-reports.js:30). */
function riyadhDay(offsetDays = 0) {
    const ms = Date.now() + offsetDays * 86400000;
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));
}

/** مرآة حرفية لـ normName في yara-reports.js:1005-1012 — تطبيع الأسماء العربي. */
function normName(s) {
    return String(s || '')
        .replace(/[\u064B-\u065F\u0670\u0640]/g, '')
        .replace(/[أإآٱ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي')
        .replace(/^ال/, '').replace(/^وال/, '').replace(/^بال/, '').replace(/^فال/, '')
        .replace(/\s+/g, ' ').trim().toLowerCase();
}

function n(v) {
    const x = Number(v);
    return Number.isFinite(x) ? x : 0;
}

function round(v, digits = 2) {
    const p = 10 ** digits;
    return Math.round(n(v) * p) / p;
}

function fail(res, status, code, message) {
    return res.status(status).json({ ok: false, error: code, message });
}

/**
 * بوابة المدى — نفس أكواد الأبواب الموجودة.
 * @returns {{ok:boolean, from?:string, to?:string, code?:string, message?:string}}
 */
function readRange(query) {
    const from = DAY_RE.test(String(query.from || '')) ? String(query.from) : riyadhDay(-29);
    const to = DAY_RE.test(String(query.to || '')) ? String(query.to) : riyadhDay(0);
    if (from > to) {return { ok: false, code: 'INVALID_RANGE', message: 'المدى معكوس — «من» بعد «إلى»' };}
    const span = Math.round((new Date(`${to}T12:00:00Z`) - new Date(`${from}T12:00:00Z`)) / 86400000) + 1;
    if (span > MAX_SPAN_DAYS) {return { ok: false, code: 'RANGE_TOO_WIDE', message: `الحد الأقصى ${MAX_SPAN_DAYS} يومًا — طُلب ${span} يومًا` };}
    return { ok: true, from, to, span };
}

const text = (v, max = 60) => String(v == null ? '' : v).trim().slice(0, max);

/**
 * LEFT(date,10) هو نمط الربط مع الجداول التي تحفظ التاريخ نصًا
 * (dispatches/expenses/revenues: date VARCHAR(50) — 001_schema.sql:101,111,163)
 * كما يفعله daily-report-service.js:56 حرفيًا.
 */
const dayOf = (col) => `LEFT(COALESCE(${col},''),10)`;

/**
 * حدود يوم الرياض كـ timestamptz: `$1::date` وحدها تُقرأ بالتوقيت الافتراضي
 * للجلسة (UTC غالبًا) فتُزيح مبيعات الكاشيرية يومًا كاملًا مقارنة بالدفتر.
 * التعبير ثابت لا يعتمد على العمود، فيبقى الاستعلام sargable على
 * idx_pos_orders_created_at — وهو نفس هدف daily-report-service.js:19-23.
 */
const tzDayStart = (param) => `(((${param})::date)::timestamp AT TIME ZONE 'Asia/Riyadh')`;
const tzDayEnd = (param) => `(((${param})::date + 1)::timestamp AT TIME ZONE 'Asia/Riyadh')`;

/** عدد من سطر JSONB بلا إسقاط للاستعلام كله: القياس على النمط ثم التحويل. */
const numOf = (key) => `COALESCE(CASE WHEN l->>'${key}' ~ '^[-+]?[0-9.]+$' THEN (l->>'${key}')::numeric ELSE 0 END, 0)::float`;

/**
 * CTE واحدة تُبنى مرة وتُستخدم للصفوف وللمجاميع معًا — فلا يوجد انقسام
 * بين «ما أراه في الجدول» و«ما أراه في البطاقة».
 * $1 from · $2 to · $3 dept (أو NULL)
 */
function ledgerCtes() {
    return `
        WITH led AS (
            SELECT l.inventory_id AS item_id,
                   COALESCE(SUM(l.quantity_delta)     FILTER (WHERE l.reference_type IN ${PURCHASE_REFS}), 0)::float AS qty_in_purchases,
                   COALESCE(SUM(CASE WHEN l.quantity_delta > 0 THEN l.quantity_delta ELSE 0 END)
                            FILTER (WHERE l.transaction_type IN ('opening_balance','transfer_in','production_output','return')), 0)::float AS qty_in_other,
                   COALESCE(SUM(CASE WHEN l.quantity_delta > 0 THEN l.quantity_delta ELSE 0 END), 0)::float AS qty_in_total,
                   COALESCE(SUM(CASE WHEN l.quantity_delta < 0 THEN -l.quantity_delta ELSE 0 END), 0)::float AS qty_out_total,
                   COALESCE(SUM(-l.quantity_delta) FILTER (WHERE l.reference_type='dispatch' AND l.quantity_delta < 0), 0)::float AS qty_out_dispatch,
                   COALESCE(SUM(-l.quantity_delta) FILTER (WHERE l.transaction_type='sale_consumption'), 0)::float AS qty_out_sale,
                   COALESCE(SUM(-l.quantity_delta) FILTER (WHERE l.transaction_type='production_consumption'), 0)::float AS qty_out_production,
                   COALESCE(SUM(-l.quantity_delta) FILTER (WHERE l.transaction_type='transfer_out'), 0)::float AS qty_out_transfer,
                   COALESCE(SUM(-l.quantity_delta) FILTER (WHERE l.transaction_type='waste'), 0)::float AS qty_out_waste,
                   COALESCE(SUM(l.quantity_delta), 0)::float AS qty_net,
                   COALESCE(SUM(CASE WHEN l.quantity_delta > 0 THEN l.total_cost ELSE -l.total_cost END)
                            FILTER (WHERE l.reference_type IN ${PURCHASE_REFS}), 0)::float AS purchase_cost,
                   COALESCE(SUM(CASE WHEN l.quantity_delta < 0 THEN -l.total_cost ELSE 0 END), 0)::float AS out_cost,
                   MIN(l.expiry_date) FILTER (WHERE l.expiry_date IS NOT NULL)::date AS nearest_expiry,
                   COUNT(*)::int AS movements
            FROM inventory_ledger l
            LEFT JOIN inventory_locations loc ON loc.id = l.location_id
            WHERE l.business_date BETWEEN $1::date AND $2::date
              AND ($3::text IS NULL OR loc.department_code = $3)
            GROUP BY l.inventory_id
        ),
        bal AS (
            SELECT b.inventory_id AS item_id, COALESCE(SUM(b.on_hand), 0)::float AS on_hand_scoped
            FROM inventory_location_balances b
            LEFT JOIN inventory_locations loc ON loc.id = b.location_id
            WHERE $3::text IS NULL OR loc.department_code = $3
            GROUP BY b.inventory_id
        ),
        pos AS (
            SELECT pp.legacy_inventory_id AS item_id,
                   COALESCE(SUM(poi.quantity), 0)::float AS qty_sold_pos,
                   COALESCE(SUM(poi.line_total), 0)::float AS revenue_pos,
                   COUNT(DISTINCT poi.order_id)::int AS orders_pos
            FROM pos_order_items poi
            JOIN pos_orders po ON po.id = poi.order_id AND po.status IN ('issued','reported')
            JOIN pos_products pp ON pp.id = poi.product_id AND pp.legacy_inventory_id IS NOT NULL
            WHERE po.created_at >= ${tzDayStart('$1')} AND po.created_at < ${tzDayEnd('$2')}
              AND ($3::text IS NULL OR po.department_id IN (
                    SELECT pd.id FROM pos_departments pd WHERE pd.legacy_dept_code = $3))
            GROUP BY pp.legacy_inventory_id
        )`;
}

/** أعمدة الصنف نفسها للصفوف وللمجاميع — مصدر واحد للتسمية. */
const ITEM_SELECT = `
            i.id AS item_id,
            i.name AS item_name,
            COALESCE(i.category, '') AS category,
            COALESCE(i.unit, '') AS unit,
            COALESCE(i.barcode, '') AS barcode,
            COALESCE(i."minQty", 0)::float AS min_qty,
            COALESCE(i."avgCost", 0)::float AS avg_cost,
            CASE WHEN $3::text IS NULL THEN COALESCE(i.qty, 0)::float
                 ELSE COALESCE(bal.on_hand_scoped, 0)::float END AS on_hand,
            COALESCE(led.qty_in_purchases, 0)::float AS qty_in_purchases,
            COALESCE(led.qty_in_other, 0)::float AS qty_in_other,
            COALESCE(led.qty_in_total, 0)::float AS qty_in_total,
            COALESCE(led.qty_out_total, 0)::float AS qty_out_total,
            COALESCE(led.qty_out_dispatch, 0)::float AS qty_out_dispatch,
            COALESCE(led.qty_out_sale, 0)::float AS qty_out_sale,
            COALESCE(led.qty_out_production, 0)::float AS qty_out_production,
            COALESCE(led.qty_out_transfer, 0)::float AS qty_out_transfer,
            COALESCE(led.qty_out_waste, 0)::float AS qty_out_waste,
            COALESCE(led.qty_net, 0)::float AS qty_net,
            COALESCE(led.purchase_cost, 0)::float AS purchase_cost,
            COALESCE(led.out_cost, 0)::float AS out_cost,
            COALESCE(led.movements, 0)::int AS movements,
            COALESCE(pos.qty_sold_pos, 0)::float AS qty_sold_pos,
            COALESCE(pos.revenue_pos, 0)::float AS revenue_pos,
            COALESCE(pos.orders_pos, 0)::int AS orders_pos,
            led.nearest_expiry AS nearest_expiry`;

/** الوسائط الثابتة قبل المرشّحات: $1 من · $2 إلى · $3 قسم */
const BASE_PARAMS = 3;

/** مرشّح البحث/التصنيف/الحالة — نص واحد يُستخدم في الاستعلامين. */
function itemFilter(query) {
    let sql = '';
    const params = [];
    const next = (v) => {params.push(v);return `$${BASE_PARAMS + params.length}`;};
    const q = text(query.q, 80);
    if (q) {
        const like = next(`%${q}%`);
        // الباركود يُطابق حرفيًا بقيمة خام مستقلة — وإلا قورن بنمط LIKE فلم يطابق أبدًا.
        sql += ` AND (i.name ILIKE ${like} OR COALESCE(i.category,'') ILIKE ${like} OR COALESCE(i.barcode,'') = ${next(q)})`;
    }
    const cat = text(query.cat, 80);
    if (cat && cat !== 'all') {sql += ` AND COALESCE(i.category,'') = ${next(cat)}`;}
    const only = text(query.only, 16);
    if (only === 'moved') {
        sql += ` AND COALESCE(led.movements, 0) > 0`;
    } else if (only === 'active') {
        sql += ` AND (COALESCE(led.movements, 0) > 0 OR COALESCE(i.qty,0) <> 0 OR COALESCE(pos.qty_sold_pos,0) > 0)`;
    } else if (only === 'low') {
        sql += ` AND COALESCE(i."minQty",0) > 0 AND (CASE WHEN $3::text IS NULL THEN COALESCE(i.qty,0) ELSE COALESCE(bal.on_hand_scoped,0) END) <= COALESCE(i."minQty",0)`;
    } else if (only === 'expired') {
        sql += ` AND led.nearest_expiry IS NOT NULL AND led.nearest_expiry < CURRENT_DATE`;
    }
    return { sql, params };
}

const SORT_COLS = Object.freeze({
    name: 'i.name', onHand: 'on_hand', qtyIn: 'qty_in_purchases', qtyOut: 'qty_out_total',
    sold: 'qty_sold_pos', value: 'stock_value', cost: 'purchase_cost', movements: 'movements',
    expiry: 'nearest_expiry',
});

/**
 * GET /api/inventory-inquiry/items
 * قائمة الأصناف: ما دخل من الفواتير، ما بال مخزن القسم، ما انصرف، ما بيع، والتكلفة.
 */
router.get('/items', jwtAuth, requireRoleOrPerm(READ_ROLES, READ_PERM), async (req, res) => {
    const range = readRange(req.query);
    if (!range.ok) {return fail(res, 422, range.code, range.message);}
    const dept = text(req.query.dept, 50) || null;
    const limit = Math.min(500, Math.max(10, n(req.query.limit) || 100));
    const offset = Math.max(0, Math.floor(n(req.query.offset)));
    const sortKey = SORT_COLS[text(req.query.sort, 20)] ? text(req.query.sort, 20) : 'movements';
    const dir = String(req.query.dir || '').toLowerCase() === 'asc' ? 'ASC' : 'DESC';

    try {
        // itemFilter يبني أرقام الوسائط فوق الثلاثة الثابتة مباشرة (BASE_PARAMS)
        const { sql: filterSql, params: filterParams } = itemFilter(req.query);
        const params = [range.from, range.to, dept, ...filterParams];

        const rowsQ = await pool.query(`${ledgerCtes()}
            SELECT ${ITEM_SELECT},
                   (CASE WHEN $3::text IS NULL THEN COALESCE(i.qty,0) ELSE COALESCE(bal.on_hand_scoped,0) END
                    * COALESCE(i."avgCost",0))::float AS stock_value
            FROM inventory i
            LEFT JOIN led ON led.item_id = i.id
            LEFT JOIN bal ON bal.item_id = i.id
            LEFT JOIN pos ON pos.item_id = i.id
            WHERE 1=1${filterSql}
            ORDER BY ${SORT_COLS[sortKey]} ${dir} NULLS LAST, i.name ASC
            LIMIT ${limit} OFFSET ${offset}`, params);

        const totalsQ = await pool.query(`${ledgerCtes()}
            SELECT COUNT(*)::int AS items,
                   COALESCE(SUM(CASE WHEN $3::text IS NULL THEN COALESCE(i.qty,0) ELSE COALESCE(bal.on_hand_scoped,0) END
                        * COALESCE(i."avgCost",0)), 0)::float AS stock_value,
                   COALESCE(SUM(COALESCE(led.qty_in_purchases,0)),0)::float AS qty_in_purchases,
                   COALESCE(SUM(COALESCE(led.qty_in_other,0)),0)::float AS qty_in_other,
                   COALESCE(SUM(COALESCE(led.qty_out_total,0)),0)::float AS qty_out_total,
                   COALESCE(SUM(COALESCE(led.qty_out_dispatch,0)),0)::float AS qty_out_dispatch,
                   COALESCE(SUM(COALESCE(led.qty_out_sale,0)),0)::float AS qty_out_sale,
                   COALESCE(SUM(COALESCE(led.purchase_cost,0)),0)::float AS purchase_cost,
                   COALESCE(SUM(COALESCE(led.out_cost,0)),0)::float AS out_cost,
                   COALESCE(SUM(COALESCE(pos.qty_sold_pos,0)),0)::float AS qty_sold_pos,
                   COALESCE(SUM(COALESCE(pos.revenue_pos,0)),0)::float AS revenue_pos
            FROM inventory i
            LEFT JOIN led ON led.item_id = i.id
            LEFT JOIN bal ON bal.item_id = i.id
            LEFT JOIN pos ON pos.item_id = i.id
            WHERE 1=1${filterSql}`, params);

        // مرآة يارا: لا معرّف صنف في السطور، فالربط بالاسم المطبَّع وحده —
        // نفس قاعدة /yara-reports/wh-vs-pos، ومُعلَّن كتقريب لا كحقيقة.
        // SRF على حقل قد لا يكون مصفوفة يسقط الاستعلام كله، فيُمرَّر عبر
        // CASE يساوي '[]' حين لا يكون array؛ والأرقام تُقرأ بعد فحص نمطي.
        const mirror = await pool.query(
            `SELECT l->>'name' AS name,
                    COALESCE(SUM(${numOf('qty')}), 0)::float AS qty,
                    COALESCE(SUM(${numOf('total')}), 0)::float AS net,
                    COUNT(DISTINCT o.doc_no)::int AS invoices
               FROM ys_mirror_orders o
               CROSS JOIN LATERAL jsonb_array_elements(
                   CASE WHEN jsonb_typeof(o.lines) = 'array' THEN o.lines ELSE '[]'::jsonb END) l
              WHERE o.doc_date BETWEEN $1::date AND $2::date
              GROUP BY 1 ORDER BY qty DESC LIMIT 4000`,
            [range.from, range.to]).catch((error) => {
                logger.warn('[inventory_inquiry] مرآة يارا غير متاحة: ' + String(error.message).slice(0, 100));
                return { rows: [] };
            });

        const yara = new Map();
        let yaraQtyTotal = 0;
        for (const m of mirror.rows) {
            const key = normName(m.name);
            if (!key) {continue;}
            const bucket = yara.get(key) || { qty: 0, net: 0, invoices: 0, name: m.name };
            bucket.qty += n(m.qty); bucket.net += n(m.net); bucket.invoices += n(m.invoices);
            yara.set(key, bucket);
            yaraQtyTotal += n(m.qty);
        }

        const rows = rowsQ.rows.map((r) => {
            const hit = yara.get(normName(r.item_name)) || null;
            return {
                itemId: Number(r.item_id),
                itemName: r.item_name,
                category: r.category,
                unit: r.unit,
                barcode: r.barcode,
                minQty: round(r.min_qty, 3),
                avgCost: round(r.avg_cost),
                onHand: round(r.on_hand, 3),
                qtyInPurchases: round(r.qty_in_purchases, 3),
                qtyInOther: round(r.qty_in_other, 3),
                qtyInTotal: round(r.qty_in_total, 3),
                qtyOutTotal: round(r.qty_out_total, 3),
                qtyOutDispatch: round(r.qty_out_dispatch, 3),
                qtyOutSale: round(r.qty_out_sale, 3),
                qtyOutProduction: round(r.qty_out_production, 3),
                qtyOutTransfer: round(r.qty_out_transfer, 3),
                qtyOutWaste: round(r.qty_out_waste, 3),
                qtyNet: round(r.qty_net, 3),
                purchaseCost: round(r.purchase_cost),
                outCost: round(r.out_cost),
                stockValue: round(r.stock_value),
                movements: r.movements,
                soldPos: round(r.qty_sold_pos, 3),
                revenuePos: round(r.revenue_pos),
                ordersPos: r.orders_pos,
                soldYara: hit ? round(hit.qty, 3) : 0,
                yaraMatched: !!hit,
                nearestExpiry: r.nearest_expiry ? String(r.nearest_expiry).slice(0, 10) : null,
            };
        });

        const matched = rows.filter((r) => r.yaraMatched);
        const t = totalsQ.rows[0] || {};
        res.json({
            ok: true,
            from: range.from, to: range.to, spanDays: range.span,
            dept,
            rows,
            totals: {
                items: t.items || 0,
                stockValue: round(t.stock_value),
                qtyInPurchases: round(t.qty_in_purchases, 3),
                qtyInOther: round(t.qty_in_other, 3),
                qtyOutTotal: round(t.qty_out_total, 3),
                qtyOutDispatch: round(t.qty_out_dispatch, 3),
                qtyOutSale: round(t.qty_out_sale, 3),
                purchaseCost: round(t.purchase_cost),
                outCost: round(t.out_cost),
                qtySoldPos: round(t.qty_sold_pos, 3),
                revenuePos: round(t.revenue_pos),
            },
            meta: {
                source: { movements: 'inventory_ledger', onHand: dept ? 'inventory_location_balances (scoped)' : 'inventory.qty', soldPos: 'pos_order_items', soldYara: 'ys_mirror_orders.lines' },
                yara: {
                    scope: 'مطابقة بالاسم المطبَّع فقط — ليست حقيقة مُرمَّزة',
                    linesScanned: mirror.rows.length,
                    qtyTotal: round(yaraQtyTotal, 3),
                    qtyMatched: round(matched.reduce((s, r) => s + r.soldYara, 0), 3),
                    unmatchedItems: rows.length - matched.length,
                },
                // لا يُمزج الرقميان أبدًا: POS بالهوية، يارا بالاسم.
                soldRule: 'qtySoldPos و soldYara مصدران مختلفان — لا يُجمعان في رقم واحد',
                reversalRule: 'qtyInPurchases صافي يشمل عكوس الإلغاء والتعديل الموقَّعة بالسالب',
            },
        });
    } catch (error) {
        logger.error('[inventory_inquiry_items]', error);
        return fail(res, 500, 'INQUIRY_ITEMS_FAILED', 'تعذّر تجميع حركة الأصناف: ' + String(error.message).slice(0, 120));
    }
});

/**
 * GET /api/inventory-inquiry/item/:id?from&to
 * ملف الصنف: حقائقه، كاردكس برصيد جاري حقيقي، فواتير دخوله، الأقسام التي صرفته،
 * مبيعاته، ودُفَعات الصلاحية.
 */
router.get('/item/:id', jwtAuth, requireRoleOrPerm(READ_ROLES, READ_PERM), async (req, res) => {
    const itemId = Math.floor(n(req.params.id));
    if (!(itemId > 0)) {return fail(res, 422, 'INVALID_ITEM_ID', 'معرّف الصنف مطلوب رقمًا موجبًا');}
    const range = readRange(req.query);
    if (!range.ok) {return fail(res, 422, range.code, range.message);}

    try {
        const factsQ = pool.query(
            `SELECT i.id, i.name, COALESCE(i.category,'') AS category, COALESCE(i.unit,'') AS unit,
                    COALESCE(i.barcode,'') AS barcode, COALESCE(i.qty,0)::float AS qty,
                    COALESCE(i."avgCost",0)::float AS avg_cost, COALESCE(i."minQty",0)::float AS min_qty,
                    i."shelfId"::text AS shelf_id,
                    COALESCE((SELECT s.name FROM shelves s WHERE s.id = i."shelfId"),'') AS shelf_name,
                    SUM(b.on_hand)::float AS balance_sum
               FROM inventory i
               LEFT JOIN inventory_location_balances b ON b.inventory_id = i.id
              WHERE i.id = $1
              GROUP BY i.id`, [itemId]);

        // الرصيد الجاري يُحسب من كامل التاريخ ثم تُعرض نافذة فقط — وإلا كان
        // «الرصيد» في أول سطر معروض رقمًا من فراغ.
        const cardexQ = pool.query(
            `WITH ranked AS (
                SELECT l.business_date, l.created_at, l.transaction_type, l.reference_type, l.reference_id,
                       l.quantity_delta::float AS delta, l.unit_cost::float AS unit_cost, l.total_cost::float AS total_cost,
                       l.expiry_date, l.lot_number, COALESCE(l.reason,'') AS reason, l.user_id,
                       loc.code AS location_code, loc.name_ar AS location_name, loc.department_code,
                       SUM(l.quantity_delta) OVER (ORDER BY l.business_date, l.created_at, l.id)::float AS running_qty
                FROM inventory_ledger l
                LEFT JOIN inventory_locations loc ON loc.id = l.location_id
                WHERE l.inventory_id = $1
             )
             SELECT * FROM ranked
              WHERE business_date BETWEEN $2::date AND $3::date
              ORDER BY business_date DESC, created_at DESC
              LIMIT 400`, [itemId, range.from, range.to]);

        const deptsQ = pool.query(
            `SELECT COALESCE(loc.department_code,'') AS dept_code,
                    COALESCE(d.name, loc.name_ar, loc.code, '(بلا قسم)') AS dept_name,
                    COALESCE(SUM(-l.quantity_delta),0)::float AS qty,
                    COALESCE(SUM(-l.total_cost),0)::float AS cost,
                    COUNT(DISTINCT l.reference_id)::int AS docs
               FROM inventory_ledger l
               LEFT JOIN inventory_locations loc ON loc.id = l.location_id
               LEFT JOIN departments d ON d.code = loc.department_code
              WHERE l.inventory_id = $1 AND l.quantity_delta < 0
                AND l.business_date BETWEEN $2::date AND $3::date
              GROUP BY 1, 2 ORDER BY qty DESC LIMIT 60`, [itemId, range.from, range.to]);

        // فواتير الشراء التي أدخلت هذا الصنف: القيد في الدفتر هو المصدر، لا سطر
        // JSONB. سطور «purchaseInvoices» لا تحمل معرّف صنف إطلاقًا — الخادم يربطها
        // بالاسم المطبَّع (warehouse-routes.js:2354-2356)، بينما referenceId يحمل
        // رقم الفاتورة نصيًا في الاستلام والإلغاء والتعديل (:1952، :2803، :2381).
        // فالكمية والتكلفة تُقرآن من القيد، ويُرفق رأس الفاتورة بالمعرّف.
        const invoicesQ = pool.query(
            `SELECT l.reference_id, p."invoiceNumber", ${dayOf('p.date')} AS day,
                    COALESCE(p."supplierName",'') AS supplier_name,
                    COALESCE(p."totalAmount",0)::float AS invoice_total,
                    COALESCE(p."paymentMethod"::text,'') AS payment_method,
                    l.transaction_type, l.reference_type,
                    l.quantity_delta::float AS qty, l.unit_cost::float AS unit_cost,
                    l.total_cost::float AS line_total, l.business_date,
                    COALESCE(l.expiry_date::text,'') AS expiry_date,
                    COALESCE(l.lot_number,'') AS lot_number, COALESCE(l.reason,'') AS reason
               FROM inventory_ledger l
               JOIN "purchaseInvoices" p ON p.id = l.reference_id::bigint
              WHERE l.inventory_id = $1
                AND l.reference_type IN ${PURCHASE_REFS}
                AND l.reference_id ~ '^[0-9]+$'
                AND l.business_date BETWEEN $2::date AND $3::date
              ORDER BY l.business_date DESC, l.created_at DESC LIMIT 200`, [itemId, range.from, range.to]);

        const batchesQ = pool.query(
            `SELECT expiry_date, lot_number, COALESCE(SUM(quantity_delta),0)::float AS qty,
                    COUNT(*)::int AS postings
               FROM inventory_ledger
              WHERE inventory_id = $1 AND (expiry_date IS NOT NULL OR lot_number IS NOT NULL)
                AND business_date BETWEEN $2::date AND $3::date
              GROUP BY 1, 2 ORDER BY expiry_date NULLS LAST LIMIT 120`, [itemId, range.from, range.to]);

        const salesQ = pool.query(
            `SELECT po.id AS order_id, (po.created_at AT TIME ZONE 'Asia/Riyadh')::date AS day, COALESCE(pd.name_ar,'') AS dept,
                    COALESCE(u.name, '') AS cashier,
                    poi.quantity::float AS qty, poi.unit_price::float AS unit_price,
                    poi.line_total::float AS line_total
               FROM pos_order_items poi
               JOIN pos_orders po ON po.id = poi.order_id AND po.status IN ('issued','reported')
               JOIN pos_products pp ON pp.id = poi.product_id
               LEFT JOIN pos_departments pd ON pd.id = po.department_id
               LEFT JOIN users u ON u.id = po.cashier_id
              WHERE pp.legacy_inventory_id = $1
                AND po.created_at >= ${tzDayStart('$2')} AND po.created_at < ${tzDayEnd('$3')}
              ORDER BY po.created_at DESC LIMIT 200`, [itemId, range.from, range.to]).catch(() => ({ rows: [] }));

        const [factsR, cardexR, deptsR, invoicesR, batchesR, salesR] = await Promise.all(
            [factsQ, cardexQ, deptsQ, invoicesQ, batchesQ, salesQ]);

        const facts = factsR.rows[0];
        if (!facts) {return fail(res, 404, 'ITEM_NOT_FOUND', 'الصنف غير موجود في المخزون');}

        const invoiceQty = round(invoicesR.rows.reduce((s, r) => s + n(r.qty), 0), 3);
        // total_cost في الدفتر abs(delta)×unit_cost دائمًا (inventory-ledger.js:110)،
        // فقيود العكس تحمل تكلفة موجبة بكمية سالبة: الإشاري هنا هو الصافي.
        const signedCost = (r) => (n(r.qty) < 0 ? -n(r.line_total) : n(r.line_total));
        const invoiceCost = round(invoicesR.rows.reduce((s, r) => s + signedCost(r), 0));
        const soldPosQty = round(salesR.rows.reduce((s, r) => s + n(r.qty), 0), 3);
        const soldPosNet = round(salesR.rows.reduce((s, r) => s + n(r.line_total), 0));

        res.json({
            ok: true,
            from: range.from, to: range.to, spanDays: range.span,
            item: {
                id: Number(facts.id), name: facts.name, category: facts.category, unit: facts.unit,
                barcode: facts.barcode, shelf: facts.shelf_name || facts.shelf_id || '',
                qty: round(facts.qty, 3), balanceSum: round(facts.balance_sum, 3),
                minQty: round(facts.min_qty, 3), avgCost: round(facts.avg_cost),
                stockValue: round(n(facts.qty) * n(facts.avg_cost)),
                lowStock: n(facts.min_qty) > 0 && n(facts.qty) <= n(facts.min_qty),
            },
            cardex: cardexR.rows.map((r) => ({
                date: String(r.business_date).slice(0, 10),
                at: r.created_at,
                type: r.transaction_type,
                referenceType: r.reference_type,
                referenceId: r.reference_id,
                delta: round(r.delta, 3),
                runningQty: round(r.running_qty, 3),
                unitCost: round(r.unit_cost),
                totalCost: round(r.total_cost),
                expiryDate: r.expiry_date ? String(r.expiry_date).slice(0, 10) : null,
                lot: r.lot_number || '',
                location: r.location_name || r.location_code || '',
                deptCode: r.department_code || '',
                reason: r.reason,
                userId: r.user_id,
            })),
            purchases: {
                invoices: invoicesR.rows.map((r) => ({
                    invoiceId: Number(r.reference_id), invoiceNumber: r.invoiceNumber || '', day: r.day,
                    supplier: r.supplier_name || '', invoiceTotal: round(r.invoice_total),
                    paymentMethod: r.payment_method || '',
                    transactionType: r.transaction_type, referenceType: r.reference_type,
                    qty: round(n(r.qty), 3), unitCost: round(r.unit_cost),
                    lineTotal: round(signedCost(r)),
                    expiryDate: r.expiry_date || '', lot: r.lot_number || '',
                    reason: r.reason || '',
                })),
                qty: invoiceQty, cost: invoiceCost,
                note: 'قيود الدفتر بعائلتها (استلام/إلغاء/تعديل) — qty و lineTotal صافٍ مُوقَّع: السالب هو العكس، لأن total_cost يُقيَّد موجبًا دائمًا (inventory-ledger.js:110)',
            },
            departments: deptsR.rows.map((r) => ({
                deptCode: r.dept_code, deptName: r.dept_name, qty: round(r.qty, 3),
                cost: round(r.cost), docs: r.docs,
            })),
            batches: batchesR.rows.map((r) => ({
                expiryDate: r.expiry_date ? String(r.expiry_date).slice(0, 10) : null,
                lot: r.lot_number || '', qty: round(r.qty, 3), postings: r.postings,
                expired: !!r.expiry_date && new Date(String(r.expiry_date).slice(0, 10)) < new Date(riyadhDay() + 'T00:00:00Z'),
            })),
            sales: {
                pos: soldPosQty, net: soldPosNet, orders: salesR.rows.length,
                lines: salesR.rows.map((r) => ({
                    orderId: String(r.order_id), day: String(r.day).slice(0, 10), dept: r.dept,
                    cashier: r.cashier, qty: round(r.qty, 3), unitPrice: round(r.unit_price), lineTotal: round(r.line_total),
                })),
                note: 'المبيع هنا من أسطر POS المُربوطة بالمعرّف — رقم لا اسم؛ مرآة المبيعات تُقرأ من /items ولا تُخلط به',
            },
        });
    } catch (error) {
        logger.error('[inventory_inquiry_item]', error);
        return fail(res, 500, 'INQUIRY_ITEM_FAILED', 'تعذّر بناء ملف الصنف: ' + String(error.message).slice(0, 120));
    }
});

/**
 * GET /api/inventory-inquiry/departments?from&to
 * تكلفة كل قسم والكوست العام: ما صرفه الدفتر للقسم + مصروفه التشغيلي (بلا ازدواج).
 */
router.get('/departments', jwtAuth, requireRoleOrPerm(READ_ROLES, READ_PERM), async (req, res) => {
    const range = readRange(req.query);
    if (!range.ok) {return fail(res, 422, range.code, range.message);}

    try {
        const issuedQ = pool.query(
            `SELECT loc.department_code AS code,
                    COALESCE(SUM(-l.quantity_delta),0)::float AS qty,
                    COALESCE(SUM(-l.total_cost),0)::float AS cost,
                    COUNT(DISTINCT l.inventory_id)::int AS items,
                    COUNT(*)::int AS movements
               FROM inventory_ledger l
               JOIN inventory_locations loc ON loc.id = l.location_id
              WHERE l.quantity_delta < 0 AND loc.department_code IS NOT NULL
                AND l.business_date BETWEEN $1::date AND $2::date
              GROUP BY 1`, [range.from, range.to]);

        const expQ = pool.query(
            `SELECT "deptId" AS code,
                    COALESCE(SUM(amount) FILTER (WHERE COALESCE("adjustmentType",'') NOT IN ${STOCK_EXPENSE_TYPES}), 0)::float AS operating,
                    COALESCE(SUM(amount) FILTER (WHERE COALESCE("adjustmentType",'') IN ('dispatch','dispatch_return','transfer','receipt','stock_transfer','inventory_transfer','kitchen_return')), 0)::float AS stock,
                    COALESCE(SUM(amount) FILTER (WHERE COALESCE("adjustmentType",'') = 'count_correction'), 0)::float AS count_adj,
                    COALESCE(SUM(amount), 0)::float AS all_total,
                    COUNT(*)::int AS rows_count
               FROM expenses
              WHERE ${dayOf('date')} BETWEEN $1 AND $2
              GROUP BY 1`, [range.from, range.to]);

        const revQ = pool.query(
            `SELECT "deptId" AS code, COALESCE(SUM(amount),0)::float AS manual, COUNT(*)::int AS rows_count
               FROM revenues
              WHERE ${dayOf('date')} BETWEEN $1 AND $2
                AND "deptId" != 'ys_b4_ext'
              GROUP BY 1`, [range.from, range.to]);

        const posRevQ = pool.query(
            `SELECT pd.legacy_dept_code AS code,
                    COALESCE(SUM(po.total_amount),0)::float AS pos_net,
                    COUNT(*)::int AS orders
               FROM pos_orders po
               JOIN pos_departments pd ON pd.id = po.department_id
              WHERE po.status IN ('issued','reported') AND pd.legacy_dept_code IS NOT NULL
                AND po.created_at >= ${tzDayStart('$1')} AND po.created_at < ${tzDayEnd('$2')}
              GROUP BY 1`, [range.from, range.to]);

        const deptsQ = pool.query(
            `SELECT d.code, d.name, COALESCE(d.color,'') AS color, COALESCE(d.icon,'') AS icon,
                    COALESCE(d.parent_code,'') AS parent_code
               FROM departments d ORDER BY d.name`);

        const stockValueQ = pool.query(
            `SELECT COALESCE(SUM(COALESCE(i.qty,0) * COALESCE(i."avgCost",0)),0)::float AS stock_value,
                    COUNT(*)::int AS items,
                    COALESCE(SUM(CASE WHEN COALESCE(i.qty,0) <= 0 THEN 1 ELSE 0 END),0)::int AS zero_items
               FROM inventory i`);

        const map = (rows) => {
            const out = new Map();
            for (const r of rows) {out.set(String(r.code || ''), r);}
            return out;
        };
        const issued = map(issuedQ.rows), exp = map(expQ.rows), rev = map(revQ.rows), posRev = map(posRevQ.rows);

        const rows = deptsQ.rows.map((d) => {
            const iss = issued.get(d.code) || {};
            const ex = exp.get(d.code) || {};
            const rv = rev.get(d.code) || {};
            const pr = posRev.get(d.code) || {};
            const issuedCost = round(iss.cost);
            const operating = round(ex.operating);
            return {
                code: d.code, name: d.name, color: d.color, icon: d.icon, parentCode: d.parent_code,
                issuedQty: round(iss.qty, 3), issuedCost, issuedItems: iss.items || 0, issuedMovements: iss.movements || 0,
                expenseOperating: operating,
                expenseStock: round(ex.stock),
                expenseCountAdj: round(ex.count_adj),
                expenseAll: round(ex.all_total),
                // بلا ازدواج: تكلفة الصرف من الدفتر + التشغيلي فقط (سطور المخزون
                // التلقائية هي نفس أحداث الدفتر، جمعها يضاعف الرقم).
                costTotal: round(issuedCost + operating),
                doubleCountGuard: 'سطور expenses المخزنية غير محسوبة في costTotal لأنها نفس قيود الدفتر',
                revenueManual: round(rv.manual),
                revenuePos: round(pr.pos_net),
                posOrders: pr.orders || 0,
                expensesRows: ex.rows_count || 0,
            };
        });

        const sum = (k) => round(rows.reduce((s, r) => s + n(r[k]), 0));
        const sv = stockValueQ.rows[0] || {};
        // أرقام بلا قسم معروف: حركة في دفتر بموقع قسمه ليس في جدول departments،
        // أو مصروف بـ deptId غير موجود. تُعلن ولا تُختفى من الإجمالي.
        const known = new Set(deptsQ.rows.map((d) => String(d.code || '')));
        const orphanSum = (q, key) => round(q.rows
            .filter((x) => !known.has(String(x.code || '')))
            .reduce((s, x) => s + n(x[key]), 0));
        const unattributed = {
            issuedCost: orphanSum(issuedQ, 'cost'),
            issuedQty: round(orphanSum(issuedQ, 'qty'), 3),
            expenseOperating: orphanSum(expQ, 'operating'),
        };

        res.json({
            ok: true,
            from: range.from, to: range.to, spanDays: range.span,
            rows,
            totals: {
                departments: rows.length,
                issuedCost: sum('issuedCost'),
                issuedQty: round(rows.reduce((s, r) => s + r.issuedQty, 0), 3),
                expenseOperating: sum('expenseOperating'),
                expenseStock: sum('expenseStock'),
                costTotal: sum('costTotal'),
                revenueManual: sum('revenueManual'),
                revenuePos: sum('revenuePos'),
                stockValue: round(sv.stock_value),
                stockItems: sv.items || 0,
                zeroStockItems: sv.zero_items || 0,
            },
            unattributed,
            meta: {
                basis: 'تكلفة القسم = تكلفة ما انصرف له من الدفتر بسعر التكلفة + مصروفه التشغيلي. سطور expenses المخزنية والجردية مستثناة من costTotal (نفس الاستثناء في accounting-routes.js:590 وdaily-report-service.js:56).',
                stockValueSource: 'inventory.qty × inventory.avgCost لكل الأصناف (غير مقيّد بالمدى)',
                purchaseCostScope: 'كوست المشتريات في المدى يُقرأ من /items ولا يُنسب لقسم — الاستلام يذهب للمخزن الرئيسي',
            },
        });
    } catch (error) {
        logger.error('[inventory_inquiry_departments]', error);
        return fail(res, 500, 'INQUIRY_DEPARTMENTS_FAILED', 'تعذّر تجميع تكاليف الأقسام: ' + String(error.message).slice(0, 120));
    }
});

module.exports = { router, READ_ROLES, READ_PERM, normName, readRange, riyadhDay };
