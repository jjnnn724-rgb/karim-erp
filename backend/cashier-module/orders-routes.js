/**
 * orders-routes.js — REST endpoints for the relational `orders` table
 * ────────────────────────────────────────────────────────────────────────────
 * Implements GET/POST/PUT/DELETE for /api/orders, plus a separate
 * endpoint for line items. Replaces the app_state JSON blob for orders.
 *
 * Flexible invoice policy:
 *   order_items.product_id and order_items.inventory_id are BOTH nullable.
 *   The frontend may submit items whose name is free-text and whose
 *   product_id is null — they will be inserted as ad-hoc line items
 *   WITHOUT touching inventory stock.
 *
 *   If `auto_create_inventory` is set to true in the request body AND
 *   the item has a name but no inventory_id, the server will create a
 *   new inventory row (qty=0) and link it back — useful for restaurants
 *   that sell items that should later be tracked.
 */
const express = require('express');
const { logger } = require('../logger');
const { pool } = require('../shared-pool');
const { jwtAuth, requireRole } = require('./jwt-middleware');
const { parsePaginationParams, buildPaginatedQuery } = require('../pagination');
const { generalLimiter, crudLimiter } = require('../rate-limiter');

const router = express.Router();

function generateOrderId() {
    return Date.now() + Math.floor(Math.random() * 9999);
}

function generateOrderNumber() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const rand = Math.floor(Math.random() * 99999).toString().padStart(5, '0');
    return `ORD-${y}${m}${day}-${rand}`;
}

// ─── تدقيق أمني جولة 2: تحقق مالي لطلبات المطعم ─────────
// POST/PUT /api/orders كانا يقبلان كميات وأسعاراً وإجماليات سالبة
// (data-integrity/تلاعب مالي) وpayment_status قيمة حرة. الواجهة
// لا تستدعي هذا المسار إطلاقاً (POS الحقيقي عبر /api/sales/complete
// الذي يتحقق بدقة) — فالتشديد هنا آمن تماماً.
const ORDER_PAYMENT_STATUSES = Object.freeze(['unpaid', 'partial', 'paid', 'refunded']);
const ORDER_NUMERIC_FIELDS = ['subtotal', 'discount', 'tax', 'total'];

function validateOrderPayload(body, { withItems } = {}) {
    const b = body || {};
    const errors = [];
    const moneyIsClean = (v) => v === undefined || (Number.isFinite(Number(v)) && Number(v) >= 0);
    for (const f of ORDER_NUMERIC_FIELDS) {
        if (!moneyIsClean(b[f])) {errors.push(`${f} must be a finite number ≥ 0.`);}
    }
    if (b.payment_status !== undefined && b.payment_status !== null && !ORDER_PAYMENT_STATUSES.includes(String(b.payment_status))) {
        errors.push(`payment_status must be one of: ${ORDER_PAYMENT_STATUSES.join(', ')}.`);
    }
    if (withItems || Array.isArray(b.items)) {
        const items = Array.isArray(b.items) ? b.items : [];
        items.forEach((item, i) => {
            const qty = item?.quantity;
            if (qty !== undefined && (!Number.isFinite(Number(qty)) || Number(qty) <= 0)) {
                errors.push(`items[${i}].quantity must be a finite number > 0.`);
            }
            const price = item?.unit_price;
            if (price !== undefined && (!Number.isFinite(Number(price)) || Number(price) < 0)) {
                errors.push(`items[${i}].unit_price must be a finite number ≥ 0.`);
            }
            const discount = item?.discount;
            if (discount !== undefined && (!Number.isFinite(Number(discount)) || Number(discount) < 0)) {
                errors.push(`items[${i}].discount must be a finite number ≥ 0.`);
            }
            const lineTotal = item?.total;
            if (lineTotal !== undefined && (!Number.isFinite(Number(lineTotal)) || Number(lineTotal) < 0)) {
                errors.push(`items[${i}].total must be a finite number ≥ 0.`);
            }
        });
    }
    return { ok: errors.length === 0, errors };
}

// ─── GET /api/orders — paginated list ────────────────────
router.get('/', jwtAuth, generalLimiter, async (req, res) => {
    try {
        const allowedSort = ['id', 'order_number', 'status', 'created_at', 'updated_at', 'total', 'department_code'];
        const pagination = parsePaginationParams(req.query, allowedSort);
        const { dataQuery, countQuery, params } = buildPaginatedQuery('orders', pagination);

        const [dataResult, countResult] = await Promise.all([
            pool.query(dataQuery, params),
            pool.query(countQuery),
        ]);

        const total = parseInt(countResult.rows[0].total, 10);
        const totalPages = Math.ceil(total / pagination.limit);

        res.set({
            'X-Total-Count': total,
            'X-Total-Pages': totalPages,
            'X-Current-Page': pagination.page,
            'Access-Control-Expose-Headers': 'X-Total-Count,X-Total-Pages,X-Current-Page',
        });

        res.json({
            data: dataResult.rows,
            pagination: {
                page: pagination.page,
                limit: pagination.limit,
                total,
                totalPages,
                hasNextPage: pagination.page < totalPages,
                hasPrevPage: pagination.page > 1,
            },
        });
    } catch (err) {
        logger.error({ err: err.message }, '[orders] GET / failed');
        res.status(500).json({ error: 'INTERNAL', message: err.message });
    }
});

// ─── GET /api/orders/:id — single order with items ───────
router.get('/:id', jwtAuth, async (req, res) => {
    try {
        const orderRes = await pool.query('SELECT * FROM orders WHERE id = $1', [req.params.id]);
        if (orderRes.rows.length === 0) {return res.status(404).json({ error: 'NOT_FOUND' });}

        const itemsRes = await pool.query(
            'SELECT * FROM order_items WHERE order_id = $1 ORDER BY id ASC',
            [req.params.id]
        );

        res.json({ ...orderRes.rows[0], items: itemsRes.rows });
    } catch (err) {
        logger.error({ err: err.message }, '[orders] GET /:id failed');
        res.status(500).json({ error: 'INTERNAL', message: err.message });
    }
});

// ─── POST /api/orders — create order (flexible invoice) ──
/**
 * Body:
 *   {
 *     table_id?, department_code?, status?, type?, customer_name?, customer_phone?,
 *     notes?, subtotal, discount, tax, total, payment_method?, payment_status?,
 *     cashier_id?, waiter_name?,
 *     items: [
 *       { product_name, product_id?, inventory_id?, quantity, unit_price, discount?, total, notes? }
 *     ],
 *     auto_create_inventory?: boolean  // if true, ad-hoc items create a new inventory row
 *   }
 */
router.post('/', jwtAuth, crudLimiter, async (req, res) => {
    const client = await pool.connect();
    try {
        const b = req.body || {};
        if (!Array.isArray(b.items) || b.items.length === 0) {
            return res.status(400).json({ error: 'INVALID_PAYLOAD', message: 'Order must contain at least one item.' });
        }
        const payloadCheck = validateOrderPayload(b, { withItems: true });
        if (!payloadCheck.ok) {
            return res.status(422).json({ error: 'INVALID_ORDER_NUMERICS', message: 'Order contains invalid numeric or payment fields.', details: payloadCheck.errors });
        }

        const orderId = b.id || generateOrderId();
        const orderNumber = b.order_number || generateOrderNumber();

        await client.query('BEGIN');

        // 1. Insert order
        await client.query(`
            INSERT INTO orders (
                id, order_number, table_id, department_code, status, type,
                customer_name, customer_phone, notes,
                subtotal, discount, tax, total,
                payment_method, payment_status, cashier_id, waiter_name
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
        `, [
            orderId, orderNumber, b.table_id || null, b.department_code || null,
            b.status || 'open', b.type || 'dine_in',
            b.customer_name || null, b.customer_phone || null, b.notes || null,
            b.subtotal || 0, b.discount || 0, b.tax || 0, b.total || 0,
            b.payment_method || null, b.payment_status || 'unpaid',
            b.cashier_id || null, b.waiter_name || null,
        ]);

        // 2. Insert items + handle inventory
        const itemRows = [];
        for (const item of b.items) {
            if (!item.product_name || typeof item.product_name !== 'string' || item.product_name.trim() === '') {
                throw new Error('Each item must have a non-empty product_name.');
            }

            let inventoryId = item.inventory_id || null;

            // Flexible invoice: if no inventory link AND auto_create_inventory is true,
            // create a new inventory row (qty=0) and link it back.
            if (!inventoryId && b.auto_create_inventory === true) {
                const inv = await client.query(`
                    INSERT INTO inventory (id, name, category, unit, qty, "avgCost", "minQty", weight)
                    VALUES ($1, $2, 'منتجات', 'وحدة', 0, $3, 0, 0)
                    RETURNING id
                `, [generateOrderId(), item.product_name, item.unit_price || 0]);
                inventoryId = inv.rows[0].id;
            }

            const itemId = generateOrderId();
            const r = await client.query(`
                INSERT INTO order_items (
                    id, order_id, product_name, product_id, inventory_id,
                    quantity, unit_price, discount, total, notes
                ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
                RETURNING *
            `, [
                itemId, orderId, item.product_name,
                item.product_id || null, inventoryId,
                item.quantity || 1, item.unit_price || 0, item.discount || 0,
                item.total || 0, item.notes || null,
            ]);
            itemRows.push(r.rows[0]);
        }

        await client.query('COMMIT');

        logger.info({ orderId, items: itemRows.length }, '[orders] created');
        res.status(201).json({
            id: orderId,
            order_number: orderNumber,
            items: itemRows,
        });
    } catch (err) {
        await client.query('ROLLBACK');
        logger.error({ err: err.message }, '[orders] POST / failed');
        res.status(500).json({ error: 'INTERNAL', message: err.message });
    } finally {
        client.release();
    }
});

// ─── PUT /api/orders/:id — update status/items ──────────
// Security audit 2026-09-03: هذا المسار يعدّل حقولاً مالية (total/subtotal/
// payment_status) ويستبدل بنود الطلب — لم يكن محمياً بأي دور (jwtAuth فقط)
// فكان أي مستخدم مصادق يستطيع التلاعب بفاتورة مكتملة. أُقفل على
// manager/admin (حذف الطلب كان محمياً بهما أصلاً).
router.put('/:id', jwtAuth, requireRole('manager', 'admin'), crudLimiter, async (req, res) => {
    const client = await pool.connect();
    try {
        const { id } = req.params;
        const b = req.body || {};
        const payloadCheck = validateOrderPayload(b);
        if (!payloadCheck.ok) {
            return res.status(422).json({ error: 'INVALID_ORDER_NUMERICS', message: 'Order contains invalid numeric or payment fields.', details: payloadCheck.errors });
        }
        await client.query('BEGIN');

        // Update order fields (excluding items)
        const updateFields = ['status', 'type', 'customer_name', 'customer_phone', 'notes',
                              'subtotal', 'discount', 'tax', 'total', 'payment_method',
                              'payment_status', 'waiter_name', 'table_id', 'department_code', 'closed_at'];
        const setClauses = [];
        const values = [];
        let i = 1;
        for (const f of updateFields) {
            if (b[f] !== undefined) {
                setClauses.push(`"${f}" = $${i++}`);
                values.push(b[f]);
            }
        }
        if (setClauses.length > 0) {
            values.push(id);
            await client.query(`UPDATE orders SET ${setClauses.join(', ')} WHERE id = $${i}`, values);
        }

        // If items are provided, replace them
        if (Array.isArray(b.items)) {
            await client.query('DELETE FROM order_items WHERE order_id = $1', [id]);
            for (const item of b.items) {
                const itemId = generateOrderId();
                await client.query(`
                    INSERT INTO order_items (
                        id, order_id, product_name, product_id, inventory_id,
                        quantity, unit_price, discount, total, notes
                    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
                `, [
                    itemId, id, item.product_name,
                    item.product_id || null, item.inventory_id || null,
                    item.quantity || 1, item.unit_price || 0, item.discount || 0,
                    item.total || 0, item.notes || null,
                ]);
            }
        }

        await client.query('COMMIT');
        const result = await pool.query('SELECT * FROM orders WHERE id = $1', [id]);
        if (result.rows.length === 0) {return res.status(404).json({ error: 'NOT_FOUND' });}
        res.json(result.rows[0]);
    } catch (err) {
        await client.query('ROLLBACK');
        logger.error({ err: err.message }, '[orders] PUT /:id failed');
        res.status(500).json({ error: 'INTERNAL', message: err.message });
    } finally {
        client.release();
    }
});

// ─── DELETE /api/orders/:id ──────────────────────────────
router.delete('/:id', jwtAuth, requireRole('admin', 'manager'), crudLimiter, async (req, res) => {
    try {
        const result = await pool.query('DELETE FROM orders WHERE id = $1 RETURNING id', [req.params.id]);
        if (result.rows.length === 0) {return res.status(404).json({ error: 'NOT_FOUND' });}
        res.json({ message: 'Order deleted', id: result.rows[0].id });
    } catch (err) {
        logger.error({ err: err.message }, '[orders] DELETE /:id failed');
        res.status(500).json({ error: 'INTERNAL', message: err.message });
    }
});

module.exports = router;
module.exports.validateOrderPayload = validateOrderPayload;
module.exports.ORDER_PAYMENT_STATUSES = ORDER_PAYMENT_STATUSES;
