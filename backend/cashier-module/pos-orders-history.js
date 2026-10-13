/**
 * pos-orders-history.js — Professional Order History + Reprint API
 * ────────────────────────────────────────────────────────────────────────────
 * Provides:
 *   GET  /api/pos/orders              — paginated list with search/filter
 *   GET  /api/pos/orders/stats/today  — today's dashboard stats
 *   GET  /api/pos/orders/:id          — full invoice detail (items + payments)
 *   GET  /api/pos/orders/:id/receipt-html — browser-printable HTML receipt
 *   POST /api/pos/orders/:id/reprint  — queue reprint on thermal printer
 *   POST /api/pos/orders/:id/void     — void an invoice
 *
 * All queries target pos_orders, pos_order_items, pos_invoice_payments,
 * pos_departments, and pos_pending_prints — the real POS tables.
 */
const express = require('express');
const { logger } = require('../logger');
const { pool } = require('../shared-pool');
const { jwtAuth, requireRole } = require('./jwt-middleware');
const { generalLimiter, crudLimiter } = require('../rate-limiter');
const { buildEscPosReceipt } = require('./escpos-printer');
const { postInventoryLedgerEntry } = require('../inventory-ledger');
const { convertQuantity } = require('../unit-conversion');
const QRCode = require('qrcode');

const router = express.Router();

// ─── GET /api/pos/orders — paginated searchable order list ──────────
router.get('/', jwtAuth, generalLimiter, async (req, res) => {
    try {
        const { page: pageRaw, limit: limitRaw, date_from, date_to, department_id, cashier_id, session_id, status, search, sort: sortRaw, order: orderRaw } = req.query;
        const page = Math.max(1, parseInt(pageRaw) || 1);
        const limit = Math.min(100, Math.max(1, parseInt(limitRaw) || 20));
        let sort = sortRaw || 'created_at';
        let order = (orderRaw || 'DESC').toUpperCase();
        
        // Whitelist sort columns
        const allowedSort = ['created_at', 'total_amount', 'invoice_counter', 'status', 'id'];
        if (!allowedSort.includes(sort)) {sort = 'created_at';}
        if (!['ASC', 'DESC'].includes(order)) {order = 'DESC';}
        
        const conditions = [];
        const params = [];
        let paramIdx = 1;
        
        if (date_from) {
            conditions.push(`po.created_at >= $${paramIdx++}::date`);
            params.push(date_from);
        }
        if (date_to) {
            conditions.push(`po.created_at < ($${paramIdx++}::date + INTERVAL '1 day')`);
            params.push(date_to);
        }
        if (department_id) {
            conditions.push(`po.department_id = $${paramIdx++}::bigint`);
            params.push(department_id);
        }
        if (cashier_id) {
            conditions.push(`po.cashier_id = $${paramIdx++}::bigint`);
            params.push(cashier_id);
        }
        if (session_id) {
            conditions.push(`po.session_id = ${paramIdx++}::bigint`);
            params.push(session_id);
        }
        if (status) {
            conditions.push(`po.status = $${paramIdx++}`);
            params.push(status);
        }
        if (search) {
            conditions.push(`(
                po.invoice_counter::text ILIKE $${paramIdx}
                OR po.invoice_uuid::text ILIKE $${paramIdx}
                OR pd.name_ar ILIKE $${paramIdx}
                OR u.name ILIKE $${paramIdx}
            )`);
            params.push(`%${search}%`);
            paramIdx++;
        }
        
        const where = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

        // PERF-5: count + data are independent → run them in parallel (saves a full round-trip)
        const offset = (page - 1) * limit;
        const [countRes, dataRes] = await Promise.all([
            pool.query(
                `SELECT COUNT(*) as total
                 FROM pos_orders po
                 LEFT JOIN pos_departments pd ON po.department_id = pd.id
                 LEFT JOIN users u ON po.cashier_id = u.id
                 ${where}`,
                params
            ),
            pool.query(
                `SELECT
                po.id, po.invoice_counter, po.invoice_uuid,
                po.status, po.subtotal, po.discount_total, po.tax_total, po.total_amount,
                po.currency_code, po.notes, po.void_reason,
                po.created_at, po.updated_at,
                pd.name_ar AS department_name, pd.name_en AS department_name_en,
                u.name AS cashier_name, po.cashier_id, po.session_id,
                (SELECT COUNT(*) FROM pos_order_items poi WHERE poi.order_id = po.id) AS item_count,
                (SELECT jsonb_agg(jsonb_build_object('method', pip.method, 'amount', pip.amount))
                 FROM pos_invoice_payments pip WHERE pip.order_id = po.id) AS payments
             FROM pos_orders po
             LEFT JOIN pos_departments pd ON po.department_id = pd.id
             LEFT JOIN users u ON po.cashier_id = u.id
             ${where}
             ORDER BY po.${sort} ${order}
             LIMIT $${paramIdx++} OFFSET $${paramIdx++}`,
                [...params, limit, offset]
            ),
        ]);
        const total = parseInt(countRes.rows[0].total, 10);
        const totalPages = Math.ceil(total / limit);
        
        res.json({
            data: dataRes.rows,
            pagination: { page, limit, total, totalPages }
        });
    } catch (err) {
        logger.error({ err: err.message }, '[pos-orders] GET / failed');
        res.status(500).json({ error: 'INTERNAL', message: err.message });
    }
});

// ─── GET /api/pos/orders/item-summary — item sales summary ─────────
// Returns only issued POS orders; cancelled invoices are excluded from actual sales.
router.get('/item-summary', jwtAuth, generalLimiter, async (req, res) => {
    try {
        const { date_from, date_to, department_id } = req.query;
        const conditions = ["po.status IN ('issued','reported')"];
        const productionFrom = date_from || '1900-01-01';
        const productionTo = date_to || '2999-12-31';
        const params = [productionFrom, productionTo];
        let idx = 3;
        if (date_from) { conditions.push(`po.created_at >= $${idx++}::date`); params.push(date_from); }
        if (date_to) { conditions.push(`po.created_at < ($${idx++}::date + INTERVAL '1 day')`); params.push(date_to); }
        if (department_id) { conditions.push(`po.department_id = $${idx++}::bigint`); params.push(department_id); }
        const where = conditions.join(' AND ');
        const result = await pool.query(`
            SELECT
                poi.product_id,
                poi.product_name,
                MAX(poi.product_barcode) AS product_barcode,
                COUNT(DISTINCT po.id)::int AS invoice_count,
                COALESCE(SUM(poi.quantity), 0) AS quantity_sold,
                COALESCE(SUM(poi.quantity * poi.unit_price), 0) AS gross_sales,
                COALESCE(SUM(poi.discount), 0) AS item_discount,
                COALESCE(SUM(poi.vat_amount), 0) AS tax_total,
                COALESCE(SUM(poi.line_total), 0) AS net_sales,
                STRING_AGG(DISTINCT pd.name_ar, '، ' ORDER BY pd.name_ar) AS departments,
                COALESCE((SELECT SUM(kpb.planned_qty) FROM kitchen_production_batches kpb WHERE kpb.product_id = poi.product_id AND kpb.status <> 'cancelled' AND kpb.created_at::date BETWEEN COALESCE($1::date, CURRENT_DATE) AND COALESCE($2::date, CURRENT_DATE)), 0) AS planned_qty,
                COALESCE((SELECT SUM(kpb.produced_qty) FROM kitchen_production_batches kpb WHERE kpb.product_id = poi.product_id AND kpb.status <> 'cancelled' AND kpb.created_at::date BETWEEN COALESCE($1::date, CURRENT_DATE) AND COALESCE($2::date, CURRENT_DATE)), 0) AS produced_qty
            FROM pos_order_items poi
            JOIN pos_orders po ON po.id = poi.order_id
            LEFT JOIN pos_departments pd ON pd.id = po.department_id
            WHERE ${where}
            GROUP BY poi.product_id, poi.product_name
            ORDER BY quantity_sold DESC, net_sales DESC, poi.product_name ASC
        `, params);
        const totals = result.rows.reduce((a, row) => ({
            invoice_count: a.invoice_count + Number(row.invoice_count || 0),
            quantity_sold: a.quantity_sold + Number(row.quantity_sold || 0),
            net_sales: a.net_sales + Number(row.net_sales || 0),
            tax_total: a.tax_total + Number(row.tax_total || 0)
        }), { invoice_count: 0, quantity_sold: 0, net_sales: 0, tax_total: 0 });
        const countWhere = where.replace(/\$(\d+)/g, (_, n) => `$${Number(n) - 2}`);
        const invoiceCount = await pool.query(`
            SELECT COUNT(*)::int AS count FROM pos_orders po WHERE ${countWhere}
        `, params.slice(2));
        totals.invoice_count = Number(invoiceCount.rows[0]?.count || 0);
        res.json({ data: result.rows, summary: totals, filters: { date_from: date_from || null, date_to: date_to || null, department_id: department_id || null } });
    } catch (err) {
        logger.error({ err: err.message }, '[pos-orders] item summary failed');
        res.status(500).json({ error: 'INTERNAL', message: err.message });
    }
});

// ─── GET /api/pos/orders/stats/today — dashboard statistics ────────
router.get('/stats/today', jwtAuth, generalLimiter, async (req, res) => {
    try {
        const stats = await pool.query(`
            SELECT
                COUNT(*)::int AS orders_count,
                COALESCE(SUM(total_amount) FILTER (WHERE status IN ('issued','reported')), 0) AS total_revenue,
                COALESCE(AVG(total_amount) FILTER (WHERE status IN ('issued','reported')), 0) AS avg_order_value,
                COUNT(*) FILTER (WHERE status = 'issued')::int AS issued_count,
                COUNT(*) FILTER (WHERE status = 'reported')::int AS reported_count,
                COUNT(*) FILTER (WHERE status = 'cancelled')::int AS voided_count,
                COALESCE(SUM(tax_total) FILTER (WHERE status IN ('issued','reported')), 0) AS total_tax,
                COALESCE(SUM(discount_total) FILTER (WHERE status IN ('issued','reported')), 0) AS total_discounts
            FROM pos_orders
            WHERE created_at::date = CURRENT_DATE
        `);
        
        // Department breakdown
        const deptBreakdown = await pool.query(`
            SELECT
                pd.name_ar AS department_name,
                COUNT(*)::int AS orders_count,
                COALESCE(SUM(po.total_amount), 0) AS total_revenue
            FROM pos_orders po
            JOIN pos_departments pd ON po.department_id = pd.id
            WHERE po.created_at::date = CURRENT_DATE AND po.status = 'issued'
            GROUP BY pd.id, pd.name_ar
            ORDER BY total_revenue DESC
        `);
        
        // Payment method breakdown — incoming money only; change 'out' rows
        // would otherwise be summed INTO the cash total (inflating it).
        const paymentBreakdown = await pool.query(`
            SELECT
                pip.method,
                COUNT(*)::int AS count,
                COALESCE(SUM(pip.amount), 0) AS total
            FROM pos_invoice_payments pip
            JOIN pos_orders po ON pip.order_id = po.id
            WHERE po.created_at::date = CURRENT_DATE AND po.status = 'issued' AND pip.direction = 'in'
            GROUP BY pip.method
            ORDER BY total DESC
        `);
        
        // Recent 5 orders
        const recent = await pool.query(`
            SELECT po.id, po.invoice_counter, po.total_amount, po.status, po.created_at,
                   pd.name_ar AS department_name, u.name AS cashier_name
            FROM pos_orders po
            LEFT JOIN pos_departments pd ON po.department_id = pd.id
            LEFT JOIN users u ON po.cashier_id = u.id
            WHERE po.created_at::date = CURRENT_DATE
            ORDER BY po.created_at DESC
            LIMIT 5
        `);
        
        res.json({
            date: new Date().toISOString().split('T')[0],
            summary: stats.rows[0],
            department_breakdown: deptBreakdown.rows,
            payment_breakdown: paymentBreakdown.rows,
            recent_orders: recent.rows
        });
    } catch (err) {
        logger.error({ err: err.message }, '[pos-orders] stats failed');
        res.status(500).json({ error: 'INTERNAL', message: err.message });
    }
});

// ─── GET /api/pos/orders/export — all filtered orders for printing ──
router.get('/export', jwtAuth, requireRole('admin', 'manager', 'cashier'), generalLimiter, async (req, res) => {
    try {
        const { date_from, date_to, department_id, cashier_id, session_id, status, search } = req.query;
        const conditions = [];
        const params = [];
        let idx = 1;
        if (date_from) { conditions.push(`po.created_at >= $${idx++}::date`); params.push(date_from); }
        if (date_to) { conditions.push(`po.created_at < ($${idx++}::date + INTERVAL '1 day')`); params.push(date_to); }
        if (department_id) { conditions.push(`po.department_id = $${idx++}::bigint`); params.push(department_id); }
        if (cashier_id) { conditions.push(`po.cashier_id = $${idx++}::bigint`); params.push(cashier_id); }
        if (session_id) { conditions.push(`po.session_id = $${idx++}`); params.push(session_id); }
        if (status) { conditions.push(`po.status = $${idx++}`); params.push(status); }
        if (search) {
            conditions.push(`(po.invoice_counter::text ILIKE $${idx} OR po.invoice_uuid::text ILIKE $${idx} OR pd.name_ar ILIKE $${idx} OR u.name ILIKE $${idx})`);
            params.push(`%${search}%`); idx++;
        }
        const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
        const result = await pool.query(`
            SELECT po.id, po.invoice_counter, po.status, po.subtotal, po.discount_total, po.tax_total, po.total_amount, po.created_at,
                   pd.name_ar AS department_name, u.name AS cashier_name,
                   COALESCE((SELECT jsonb_agg(jsonb_build_object('product_name', poi.product_name, 'quantity', poi.quantity, 'line_total', poi.line_total) ORDER BY poi.id)
                    FROM pos_order_items poi WHERE poi.order_id = po.id), '[]'::jsonb) AS items
            FROM pos_orders po
            LEFT JOIN pos_departments pd ON pd.id = po.department_id
            LEFT JOIN users u ON u.id = po.cashier_id
            ${where}
            ORDER BY po.created_at DESC, po.id DESC
        `, params);
        res.json({ data: result.rows, count: result.rows.length });
    } catch (err) {
        logger.error({ err: err.message }, '[pos-orders] export failed');
        res.status(500).json({ error: 'INTERNAL', message: err.message });
    }
});

// ─── GET /api/pos/orders/cashier-items — المباع تفصيلًا: كاشير × صنف × (قسم/شيفت) ──
// من باع ماذا، بكم، في أي شيفت/يوم: فواتير issued/reported فقط (الملغاة خارج المبيعات).
router.get('/cashier-items', jwtAuth, generalLimiter, async (req, res) => {
    try {
        const { date_from, date_to, department_id, cashier_id, session_id } = req.query;
        const conditions = ["po.status IN ('issued','reported')"];
        const params = [];
        let idx = 1;
        if (date_from) { conditions.push(`po.created_at >= $${idx++}::date`); params.push(date_from); }
        if (date_to) { conditions.push(`po.created_at < ($${idx++}::date + INTERVAL '1 day')`); params.push(date_to); }
        if (department_id) { conditions.push(`po.department_id = $${idx++}::bigint`); params.push(department_id); }
        if (cashier_id) { conditions.push(`po.cashier_id = $${idx++}::bigint`); params.push(cashier_id); }
        if (session_id) { conditions.push(`po.session_id = $${idx++}`); params.push(session_id); }
        const where = conditions.join(' AND ');
        const result = await pool.query(`
            SELECT
                u.id AS cashier_id,
                u.name AS cashier_name,
                po.session_id,
                pd.name_ar AS department_name,
                poi.product_id,
                poi.product_name,
                MAX(poi.product_barcode) AS product_barcode,
                COALESCE(AVG(poi.unit_price), 0) AS avg_unit_price,
                COUNT(DISTINCT po.id)::int AS invoice_count,
                COALESCE(SUM(poi.quantity), 0) AS quantity_sold,
                COALESCE(SUM(poi.quantity * poi.unit_price), 0) AS gross_sales,
                COALESCE(SUM(poi.discount), 0) AS item_discount,
                COALESCE(SUM(poi.vat_amount), 0) AS tax_total,
                COALESCE(SUM(poi.line_total), 0) AS net_sales
            FROM pos_order_items poi
            JOIN pos_orders po ON po.id = poi.order_id
            LEFT JOIN users u ON u.id = po.cashier_id
            LEFT JOIN pos_departments pd ON pd.id = po.department_id
            WHERE ${where}
            GROUP BY u.id, u.name, po.session_id, pd.name_ar, poi.product_id, poi.product_name
            ORDER BY u.name ASC NULLS LAST, net_sales DESC
        `, params);
        const totals = result.rows.reduce((a, row) => ({
            invoice_count: a.invoice_count + Number(row.invoice_count || 0),
            quantity_sold: a.quantity_sold + Number(row.quantity_sold || 0),
            net_sales: a.net_sales + Number(row.net_sales || 0),
            tax_total: a.tax_total + Number(row.tax_total || 0)
        }), { invoice_count: 0, quantity_sold: 0, net_sales: 0, tax_total: 0 });
        res.json({ data: result.rows, summary: totals, filters: {
            date_from: date_from || null, date_to: date_to || null,
            department_id: department_id || null, cashier_id: cashier_id || null,
            session_id: session_id || null,
        } });
    } catch (err) {
        logger.error({ err: err.message }, '[pos-orders] cashier-items failed');
        res.status(500).json({ error: 'INTERNAL', message: err.message });
    }
});

// ─── GET /api/pos/orders/:id — full invoice detail ────────────────
router.get('/:id', jwtAuth, async (req, res) => {
    try {
        const { id } = req.params;
        
        const orderRes = await pool.query(`
            SELECT po.*, pd.name_ar AS department_name, pd.name_en AS department_name_en,
                   COALESCE(NULLIF(pd.vat_number, ''), zs.vat_number) AS vat_number,
                   u.name AS cashier_name
            FROM pos_orders po
            LEFT JOIN pos_departments pd ON po.department_id = pd.id
            LEFT JOIN users u ON po.cashier_id = u.id
            CROSS JOIN LATERAL (SELECT vat_number FROM zatca_settings WHERE id = 1) zs
            WHERE po.id = $1
        `, [id]);
        
        if (orderRes.rows.length === 0) {
            return res.status(404).json({ error: 'NOT_FOUND', message: 'الفاتورة غير موجودة' });
        }
        
        const order = orderRes.rows[0];
        
        // Get line items
        const itemsRes = await pool.query(`
            SELECT * FROM pos_order_items WHERE order_id = $1 ORDER BY id ASC
        `, [id]);
        
        // Get payments
        const paymentsRes = await pool.query(`
            SELECT * FROM pos_invoice_payments WHERE order_id = $1 ORDER BY id ASC
        `, [id]);
        
        // Get pending print jobs
        const printsRes = await pool.query(`
            SELECT id, status, attempts, NULL::timestamptz AS last_attempt_at, completed_at, last_error
            FROM pos_pending_prints WHERE order_id = $1 ORDER BY id DESC
        `, [id]);
        
        res.json({
            ...order,
            items: itemsRes.rows,
            payments: paymentsRes.rows,
            print_jobs: printsRes.rows
        });
    } catch (err) {
        logger.error({ err: err.message }, '[pos-orders] GET /:id failed');
        res.status(500).json({ error: 'INTERNAL', message: err.message });
    }
});

// ─── GET /api/pos/orders/:id/receipt-html — browser-printable receipt ──
router.get('/:id/receipt-html', jwtAuth, requireRole('admin', 'manager', 'cashier'), async (req, res) => {
    try {
        const { id } = req.params;
        
        const orderRes = await pool.query(`
            SELECT po.*, pd.name_ar AS department_name, pd.name_en AS department_name_en,
                   COALESCE(NULLIF(pd.vat_number, ''), zs.vat_number) AS vat_number, pd.location AS address, NULL::text AS phone,
                   pd.code AS department_code,
                   u.name AS cashier_name
            FROM pos_orders po
            LEFT JOIN pos_departments pd ON po.department_id = pd.id
            LEFT JOIN users u ON po.cashier_id = u.id
            CROSS JOIN LATERAL (SELECT vat_number FROM zatca_settings WHERE id = 1) zs
            WHERE po.id = $1
        `, [id]);
        
        if (orderRes.rows.length === 0) {
            return res.status(404).json({ error: 'NOT_FOUND' });
        }
        
        const order = orderRes.rows[0];
        
        const itemsRes = await pool.query(
            `SELECT * FROM pos_order_items WHERE order_id = $1 ORDER BY id ASC`, [id]
        );
        const paymentsRes = await pool.query(
            `SELECT * FROM pos_invoice_payments WHERE order_id = $1 ORDER BY id ASC`, [id]
        );
        
        const items = itemsRes.rows;
        const payments = paymentsRes.rows;
        // Open-buffet department → persons-oriented receipt (guest tiers),
        // not the menu-item layout
        const isBuffet = order.department_code === 'erp_open_buffet';
        const personsTotal = items.reduce((s, it) => s + (Number(it.quantity) || 0), 0);
        // ar-SA defaults to the Islamic (Umm al-Qura) calendar — force the
        // Gregorian calendar so receipts show the expected civil date
        const date = new Date(order.created_at).toLocaleString('ar-SA-u-ca-gregory', { timeZone: 'Asia/Riyadh' });
        const logoUrl = '/app/assets/karim-logo.png';

        // Change/refund rows (direction='out') are money LEAVING the drawer —
        // they must render as "الباقي", never as an incoming payment.
        const inPayments = payments.filter(p => p.direction === 'in');
        const changeGiven = payments.filter(p => p.direction === 'out' && p.payer_info?.reason === 'change')
            .reduce((s, p) => s + Number(p.amount), 0);
        const distinctVatRates = [...new Set(items.map(it => Number(it.vat_rate)).filter(v => Number.isFinite(v) && v > 0))];
        const vatLabel = distinctVatRates.length === 1 ? `الضريبة (${distinctVatRates[0]}%)` : 'الضريبة';
        
        // qr_payload is base64 of the raw TLV byte string, NOT of a PNG image.
        // Rendering it into <img src="data:image/png;base64,..."> produced a
        // broken image and no scannable ZATCA QR. Re-encode the TLV payload
        // into a real scannable QR PNG with the bundled qrcode package.
        let qrImageDataUrl = null;
        if (order.qr_payload) {
            try { qrImageDataUrl = await QRCode.toDataURL(order.qr_payload, { errorCorrectionLevel: 'M', margin: 1, width: 240 }); }
            catch (qrErr) { logger.error({ err: qrErr.message }, '[pos-orders] QR render failed'); }
        }
        
        const html = `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>فاتورة #${order.invoice_counter}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Cairo', 'Segoe UI', Tahoma, sans-serif; font-size: 13px; color: #1a1a1a; max-width: 80mm; margin: 0 auto; padding: 8px; }
  .center { text-align: center; }
  .left { text-align: left; }
  .bold { font-weight: 800; }
  .header { margin-bottom: 8px; border-bottom: 1px dashed #999; padding-bottom: 6px; }
  .brand-logo { width: 58px; height: 58px; object-fit: contain; background: #fff; border: 1px solid #d4a843; border-radius: 9px; padding: 4px; margin-bottom: 4px; }
  .header h2 { font-size: 16px; margin-bottom: 2px; }
  .header .sub { font-size: 11px; color: #666; }
  .divider { border-top: 1px dashed #999; margin: 6px 0; }
  .row { display: flex; justify-content: space-between; margin: 2px 0; }
  .row .label { color: #555; }
  .item-row { margin: 4px 0; }
  .item-row .name { font-weight: 600; }
  .item-row .detail { display: flex; justify-content: space-between; font-size: 12px; color: #555; }
  .total-row { font-size: 16px; font-weight: 900; margin-top: 4px; }
  .payment-row { font-size: 11px; color: #444; }
  .footer { margin-top: 10px; text-align: center; font-size: 11px; color: #888; border-top: 1px dashed #999; padding-top: 6px; }
  .void-stamp { color: #e74c3c; font-size: 24px; font-weight: 900; border: 3px solid #e74c3c; padding: 4px 12px; display: inline-block; transform: rotate(-15deg); opacity: 0.6; margin: 10px 0; }
  .qr-section { text-align: center; margin: 8px 0; }
  .qr-section img { width: 100px; height: 100px; }
  .buffet-banner { background: #f5f0e6; border: 1.5px solid #d4a843; border-radius: 8px; padding: 6px; margin: 8px 0; font-size: 15px; font-weight: 900; color: #7a5c14; }
  .buffet-persons { width: 100%; border-collapse: collapse; margin: 6px 0; }
  .buffet-persons th, .buffet-persons td { border-bottom: 1px dashed #bbb; padding: 4px 2px; font-size: 12px; text-align: right; }
  .buffet-persons th { background: #f5f0e6; color: #7a5c14; font-size: 11px; }
  .buffet-persons td.c, .buffet-persons th.c { text-align: center; }
  .persons-total { font-size: 16px; font-weight: 900; color: #7a5c14; background: #f5f0e6; border-radius: 8px; padding: 6px 10px; margin: 6px 0; }
  @media print { body { margin: 0; padding: 4px; } }
</style>
</head>
<body>
<div class="header center">
  <img class="brand-logo" src="${logoUrl}" alt="مطاعم الشرفه العالمي">
  <h2>${escHtml(order.department_name || 'مطاعم الشرفه العالمي')}</h2>
  <div class="sub">${escHtml(order.department_name_en || '')}</div>
  ${order.vat_number ? `<div class="sub">الرقم الضريبي: ${escHtml(order.vat_number)}</div>` : ''}
  <div class="sub">${date}</div>
</div>

<div class="row"><span class="label">فاتورة #</span><span class="bold">${order.invoice_counter}</span></div>
<div class="row"><span class="label">الكاشير:</span><span>${escHtml(order.cashier_name || '—')}</span></div>
<div class="divider"></div>

${isBuffet ? `
<div class="buffet-banner center">🍽 البوفيه المفتوح — Open Buffet</div>
${order.notes ? `<div class="row"><span class="label">العائلة / المناسبة:</span><span class="bold">${escHtml(order.notes)}</span></div>` : ''}
<table class="buffet-persons">
  <thead><tr><th>الفئة</th><th class="c">عدد الأشخاص</th><th class="c">سعر الفرد</th><th>المجموع</th></tr></thead>
  <tbody>
  ${items.map(it => `
    <tr>
      <td>${escHtml(it.product_name)}</td>
      <td class="c bold">${Number(it.quantity)} فرد</td>
      <td class="c">${Number(it.unit_price) > 0 ? Number(it.unit_price).toFixed(2) : 'مجاناً (ضيافة)'}</td>
      <td>${Number(it.line_total).toFixed(2)} ر.س</td>
    </tr>`).join('')}
  </tbody>
</table>
<div class="row persons-total"><span>إجمالي عدد الأشخاص</span><span>${personsTotal} فرد</span></div>
` : `
${items.map(it => `
<div class="item-row">
  <div class="name">${escHtml(it.product_name)}</div>
  <div class="detail">
    <span>${Number(it.quantity)} × ${Number(it.unit_price).toFixed(2)}</span>
    <span>${Number(it.line_total).toFixed(2)} ر.س</span>
  </div>
  ${Number(it.discount) > 0 ? `<div class="detail"><span>خصم</span><span>-${Number(it.discount).toFixed(2)}</span></div>` : ''}
</div>
`).join('')}
`}

<div class="divider"></div>
<div class="row"><span>المجموع</span><span>${Number(order.subtotal).toFixed(2)}</span></div>
${Number(order.discount_total) > 0 ? `<div class="row"><span>الخصم</span><span>-${Number(order.discount_total).toFixed(2)}</span></div>` : ''}
<div class="row"><span>${vatLabel}</span><span>${Number(order.tax_total).toFixed(2)}</span></div>
<div class="divider"></div>
<div class="row total-row"><span>الإجمالي</span><span>${Number(order.total_amount).toFixed(2)} ر.س</span></div>

${inPayments.length > 0 ? `
<div class="divider"></div>
<div class="bold" style="margin-bottom:4px">الدفع:</div>
${inPayments.map(p => `
<div class="payment-row row">
  <span>${p.method === 'cash' ? '💵 نقدي' : p.method === 'card' ? '💳 بطاقة' : p.method === 'wallet' ? '📱 محفظة' : escHtml(p.method)}</span>
  <span>${Number(p.amount).toFixed(2)}</span>
</div>
`).join('')}
${changeGiven > 0 ? `<div class="payment-row row bold"><span>الباقي للعميل</span><span>-${changeGiven.toFixed(2)}</span></div>` : ''}
` : ''}

${order.qr_payload && qrImageDataUrl ? `
<div class="qr-section">
  <img src="${qrImageDataUrl}" alt="ZATCA QR" style="width:80px;height:80px">
  <div style="font-size:9px;color:#888">ZATCA QR</div>
</div>
` : ''}

${order.status === 'cancelled' ? `<div class="center"><div class="void-stamp">ملغاة</div></div>` : ''}
</body></html>`;

        // Return JSON { html } — the shared frontend api() helper always parses
        // JSON, so sending raw text/html made the print window render
        // "[object Object]" instead of the receipt.
        res.json({ html });
    } catch (err) {
        logger.error({ err: err.message }, '[pos-orders] receipt-html failed');
        res.status(500).json({ error: 'INTERNAL', message: err.message });
    }
});

// ─── POST /api/pos/orders/:id/reprint — queue thermal reprint ──────
router.post('/:id/reprint', jwtAuth, requireRole('admin', 'manager', 'cashier'), crudLimiter, async (req, res) => {
    const client = await pool.connect();
    try {
        const { id } = req.params;
        
        // Get order with items + payments
        const orderRes = await client.query(`
            SELECT po.*, pd.name_ar, pd.name_en,
                   COALESCE(NULLIF(pd.vat_number, ''), zs.vat_number) AS vat_number, pd.code AS department_code,
                   u.name AS cashier_name
            FROM pos_orders po
            LEFT JOIN pos_departments pd ON po.department_id = pd.id
            LEFT JOIN users u ON po.cashier_id = u.id
            CROSS JOIN LATERAL (SELECT vat_number FROM zatca_settings WHERE id = 1) zs
            WHERE po.id = $1
        `, [id]);
        
        if (orderRes.rows.length === 0) {
            return res.status(404).json({ error: 'NOT_FOUND' });
        }
        
        const order = orderRes.rows[0];
        
        const itemsRes = await client.query(
            `SELECT * FROM pos_order_items WHERE order_id = $1`, [id]
        );
        const paymentsRes = await client.query(
            `SELECT * FROM pos_invoice_payments WHERE order_id = $1`, [id]
        );
        
        // Find an online printer (first registered printer)
        const printerRes = await client.query(
            `SELECT * FROM pos_printers WHERE is_online = true ORDER BY id LIMIT 1`
        );
        
        // pos_printers.id is VARCHAR and no row '1' exists — falling back to the
        // literal 1 doomed reprint jobs to 'abandoned'. Fail explicitly instead.
        if (!printerRes.rows[0]) {
            return res.status(409).json({ error: 'NO_PRINTER_ONLINE', message: 'لا توجد طابعة متصلة — تحقق من حالة الطابعات ثم أعد المحاولة' });
        }
        const printerId = printerRes.rows[0].id;
        
        // Generate ESC/POS binary receipt — buffet orders print guest tiers
        // with PERSON counts instead of the menu-item table
        const payload = await buildEscPosReceipt({
            order,
            items: itemsRes.rows,
            payments: paymentsRes.rows.filter(p => p.direction === 'in'),
            qrPayload: order.qr_payload || '',
            department: { 
                name_ar: order.name_ar || 'مطاعم الشرفه العالمي', 
                name_en: order.name_en, 
                vat_number: order.vat_number 
            },
            cashier: { name: order.cashier_name || '' },
            buffet: order.department_code === 'erp_open_buffet',
            // Only incoming rows are money received — change/refund 'out' rows
            // must not inflate the printed paid amount.
            paid: paymentsRes.rows.filter(p => p.direction === 'in').reduce((s, p) => s + Number(p.amount), 0),
            change: paymentsRes.rows.filter(p => p.direction === 'out' && p.payer_info?.reason === 'change').reduce((s, p) => s + Number(p.amount), 0)
        });
        
        // Insert into print queue
        await client.query(`
            INSERT INTO pos_pending_prints (order_id, printer_id, payload, status)
            VALUES ($1, $2, $3, 'pending')
        `, [id, printerId, payload]);
        
        logger.info({ orderId: id }, '[pos-orders] reprint queued');
        res.json({ 
            message: 'تم إرسال أمر الطباعة', 
            printer_id: printerId,
            order_id: id 
        });
    } catch (err) {
        logger.error({ err: err.message }, '[pos-orders] reprint failed');
        res.status(500).json({ error: 'INTERNAL', message: err.message });
    } finally {
        client.release();
    }
});

// ─── POST /api/pos/orders/:id/void — void an invoice ───────────────
router.post('/:id/void', jwtAuth, requireRole('admin', 'manager'), crudLimiter, async (req, res) => {
    const client = await pool.connect();
    try {
        const { id } = req.params;
        const { reason } = req.body || {};
        await client.query('BEGIN');
        const orderRes = await client.query(`SELECT * FROM pos_orders WHERE id = $1 FOR UPDATE`, [id]);
        if (!orderRes.rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'NOT_FOUND' }); }
        const order = orderRes.rows[0];
        if (order.status === 'cancelled') { await client.query('ROLLBACK'); return res.status(409).json({ error: 'ALREADY_CANCELLED', message: 'الفاتورة ملغاة بالفعل' }); }
        const items = (await client.query(`SELECT * FROM pos_order_items WHERE order_id = $1 ORDER BY id`, [id])).rows;
        // Resolve the SAME consumption location the sale used — including the
        // kitchen_policies override (the sale consumed from the kitchen, so the
        // reversal must return stock there, not to the department/main default).
        const locationRes = await client.query(
            `SELECT COALESCE(kp.kitchen_location_id, pd.location_id, main.id) AS location_id
               FROM pos_departments pd
               LEFT JOIN inventory_locations main ON main.code = 'MAIN-WAREHOUSE'
               LEFT JOIN kitchen_policies kp ON kp.department_id = pd.id
              WHERE pd.id = $1`,
            [order.department_id]
        );
        const reversalLocationId = Number(locationRes.rows[0]?.location_id || 0);
        if (!reversalLocationId) { await client.query('ROLLBACK'); return res.status(409).json({ error: 'INVENTORY_LOCATION_NOT_CONFIGURED' }); }
        let restoredQty = 0;
        for (const item of items) {
            // Same BOM selection as complete-sale: active recipe version first,
            // legacy pos_product_ingredients only as fallback. Reversing from the
            // legacy table alone restored the wrong quantities (or nothing).
            const ingredients = (await client.query(`
                WITH active_bom AS (
                     SELECT rv.product_id, rvi.inventory_id,
                            rvi.quantity_per_yield AS quantity_per_unit,
                            rvi.waste_percent, rvi.unit
                       FROM pos_recipe_versions rv
                       JOIN pos_recipe_version_ingredients rvi ON rvi.recipe_version_id = rv.id
                      WHERE rv.status = 'active'
                        AND rv.effective_from <= CURRENT_TIMESTAMP
                        AND (rv.effective_to IS NULL OR rv.effective_to > CURRENT_TIMESTAMP)
                        AND rv.product_id = $1::bigint
                ), legacy_bom AS (
                     SELECT pi.product_id, pi.inventory_id, pi.quantity_per_unit,
                            pi.waste_percent, pi.unit
                       FROM pos_product_ingredients pi
                      WHERE pi.product_id = $1::bigint
                        AND NOT EXISTS (SELECT 1 FROM active_bom a WHERE a.product_id = pi.product_id)
                ), selected_bom AS (
                     SELECT * FROM active_bom
                     UNION ALL
                     SELECT * FROM legacy_bom
                )
                SELECT b.inventory_id, b.quantity_per_unit, b.unit, b.waste_percent,
                       i.unit AS inventory_unit, i.weight AS inventory_weight
                  FROM selected_bom b
                  JOIN inventory i ON i.id = b.inventory_id
            `, [item.product_id])).rows;
            if (ingredients.length) {
                for (const ing of ingredients) {
                    let inventoryQty;
                    try { inventoryQty = convertQuantity(Number(ing.quantity_per_unit), ing.unit, ing.inventory_unit, { inventoryWeight: Number(ing.inventory_weight || 0) }); }
                    catch (_) { await client.query('ROLLBACK'); return res.status(422).json({ error: 'INCOMPATIBLE_RECIPE_UNITS', message: 'وحدات الوصفة والمخزن غير متوافقة' }); }
                    const qty = Number(item.quantity) * inventoryQty * (1 + Number(ing.waste_percent || 0) / 100);
                    const posted = await postInventoryLedgerEntry(client, {
                        transactionType: 'reversal',
                        inventoryId: Number(ing.inventory_id),
                        locationId: reversalLocationId,
                        quantityDelta: qty,
                        referenceType: 'pos_void',
                        referenceId: id,
                        userId: req.user.id,
                        idempotencyKey: `void:${id}:item:${item.id}:inventory:${ing.inventory_id}`,
                        reason: reason || 'عكس استهلاك مكونات الفاتورة الملغاة',
                        metadata: { original_order_id: id, product_id: item.product_id, location_id: reversalLocationId },
                    });
                    restoredQty += qty;
                    await client.query(`INSERT INTO pos_stock_movements (product_id, order_id, quantity_delta, balance_after, reason, performed_by, metadata) VALUES ($1,$2,$3,$4,'sale_void_refund',$5,$6)`, [item.product_id, id, qty, posted.balanceAfter, req.user.id, JSON.stringify({ inventory_id: ing.inventory_id, ledger_id: posted.ledger.id, location_id: reversalLocationId })]);
                }
            } else {
                // Non-recipe menu items do not carry POS stock. There is no stock balance to reverse.
            }
        }
        // Refund exactly what the SALE was worth — not what was paid. For an
        // overpaid cash ticket (100 paid / 90 total) refunding the paid rows
        // verbatim posted 100 out of the drawer for a 90 sale, permanently
        // skewing the shift's expected cash by the change amount.
        const payments = (await client.query(`SELECT method, amount, currency, reference, payer_info FROM pos_invoice_payments WHERE order_id = $1 AND direction = 'in' ORDER BY id`, [id])).rows;
        let refundRemaining = Number(order.total_amount) || 0;
        for (const payment of payments) {
            const refundAmount = Math.min(Number(payment.amount), Math.max(0, refundRemaining));
            if (refundAmount <= 0) {break;}
            await client.query(`INSERT INTO pos_invoice_payments (order_id, method, amount, direction, currency, reference, payer_info) VALUES ($1,$2,$3,'out',$4,$5,$6)`, [id, payment.method, refundAmount, payment.currency || 'SAR', `REFUND-${order.invoice_counter}`, JSON.stringify({ original: payment.payer_info || {}, reason: reason || 'إلغاء الفاتورة' })]);
            refundRemaining = Number((refundRemaining - refundAmount).toFixed(2));
        }
        const refundTotal = Number((Number(order.total_amount) || 0) - refundRemaining);
        await client.query(`UPDATE pos_orders SET status='cancelled', voided_at=CURRENT_TIMESTAMP, voided_by=$2, void_reason=$3, updated_at=CURRENT_TIMESTAMP WHERE id=$1`, [id, req.user.id, reason || 'إلغاء بواسطة المدير']);
        const revNote = `[VOID] عكس فاتورة #${order.invoice_counter}${reason ? ' — ' + reason : ''}`;
        const dept = (await client.query(`SELECT legacy_dept_code FROM pos_departments WHERE id=$1`, [order.department_id])).rows[0];
        if (dept?.legacy_dept_code) {await client.query(`INSERT INTO revenues (id, "deptId", source, amount, date, notes) VALUES ($1,$2,'POS_VOID',-CAST($3 AS numeric),CURRENT_DATE,$4)`, [Date.now() * 1000 + require('crypto').randomInt(0, 1000), dept.legacy_dept_code, order.total_amount, revNote]);}
        // ROOT FIX 2026-10-02: الإلغاء كان يعكس المخزون والإيرادات التشغيلية
        // ويترك قيد البيع حيًا في الأستاذ — يُرحّل قيد عكسي موثق فقط إن وُجد
        // قيد بيع أصلي (pos_sale posted) مع صيانة قفل الفترة المالية.
        const periodClosed = (await client.query(
            `SELECT 1 FROM accounting_periods WHERE period = to_char(CURRENT_DATE,'YYYY-MM') AND closed = true LIMIT 1`)).rows[0];
        const saleJe = periodClosed ? { rows: [] } : (await client.query(
            `SELECT id FROM journal_entries WHERE source_type='pos_sale' AND source_id=$1 AND status='posted' LIMIT 1`, [String(id)])).rows[0];
        await client.query('COMMIT');
        if (saleJe) {
            try {
                const t = Number(order.total_amount) || 0;
                const tax = Number(order.tax_total) || 0;
                const rev = Math.max(0, Math.round((t - tax) * 100) / 100);
                const lines = [{ account_code: '4000', debit: rev, credit: 0, memo: `عكس مبيعات فاتورة #${order.invoice_counter}` }];
                if (tax > 0) {lines.push({ account_code: '2100', debit: tax, credit: 0, memo: 'عكس ضريبة الفاتورة' });}
                lines.push({ account_code: '1000', debit: 0, credit: t, memo: 'رد التحصيل — إلغاء فاتورة' });
                const { postJournal } = require('../accounting-routes');
                await postJournal(pool, {
                    date: new Date().toISOString().slice(0, 10),
                    memo: `إلغاء فاتورة كاشير #${order.invoice_counter}${reason ? ' — ' + reason : ''}`,
                    source_type: 'pos_void',
                    source_id: String(id),
                    lines,
                });
                logger.info(`[LEDGER] قيد عكس إلغاء الفاتورة #${order.invoice_counter} مُرحّل`);
            } catch (jeErr) { logger.warn('[pos_void_ledger] best-effort skipped:', jeErr.message); }
        } else if (periodClosed) {
            logger.warn(`[pos-orders] إلغاء الفاتورة #${order.invoice_counter} في شهر مالي مقفل — لا قيد عكسي (راجع المالية)`);
        }
        logger.info({ orderId: id, userId: req.user.id, restoredQty }, '[pos-orders] voided and reversed');
        res.json({ message: 'تم إلغاء الفاتورة واسترجاع المخزون والمدفوعات', order_id: id, status: 'cancelled', restored_quantity: restoredQty, refund_total: refundTotal, reversal_note: revNote });
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        logger.error({ err: err.message }, '[pos-orders] void failed');
        res.status(500).json({ error: 'INTERNAL', message: err.message });
    } finally { client.release(); }
});

function escHtml(s) {
    if (!s) {return '';}
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

module.exports = router;
