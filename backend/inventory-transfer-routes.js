const express = require('express');
const { pool } = require('./shared-pool');
const { jwtAuth, requireRole } = require('./cashier-module/jwt-middleware');
const { postInventoryLedgerEntry } = require('./inventory-ledger');
const router = express.Router();
const routerWriteRoles = ['admin', 'manager', 'warehouse', 'kitchen'];
const approvalRoles = ['admin', 'manager', 'warehouse'];

router.get('/intelligence/overview', jwtAuth, requireRole('admin', 'manager', 'warehouse', 'auditor', 'accountant'), async (req, res) => {
  try {
    const [balances, lowStock, transfers, variances, sales] = await Promise.all([
      pool.query(`SELECT l.code location_code, l.name_ar location_name, i.id inventory_id, i.name item_name, i.unit,
                         b.on_hand, b.reserved, b.in_transit, b.quarantined, b.expired,
                         (b.on_hand - b.reserved) AS available, COALESCE(i."avgCost",0) AS avg_cost
                    FROM inventory_location_balances b
                    JOIN inventory i ON i.id=b.inventory_id
                    JOIN inventory_locations l ON l.id=b.location_id
                   WHERE b.on_hand <> 0 OR b.reserved <> 0 OR b.in_transit <> 0
                   ORDER BY l.name_ar, i.name LIMIT 500`),
      pool.query(`SELECT id, name, unit, qty, "minQty" min_qty, "avgCost" avg_cost,
                         ("minQty" - qty) shortage_qty, ("minQty" - qty) * "avgCost" shortage_value
                    FROM inventory WHERE COALESCE(qty,0) <= COALESCE("minQty",0)
                   ORDER BY shortage_value DESC NULLS LAST, name LIMIT 100`),
      pool.query(`SELECT t.id, t.transfer_number, t.status, t.requested_at,
                         sl.name_ar source_location, dl.name_ar destination_location,
                         COUNT(ti.id)::int item_count,
                         COALESCE(SUM(ti.variance_qty * ti.unit_cost),0) variance_value
                    FROM inventory_transfers t
                    JOIN inventory_locations sl ON sl.id=t.source_location_id
                    JOIN inventory_locations dl ON dl.id=t.destination_location_id
                    LEFT JOIN inventory_transfer_items ti ON ti.transfer_id=t.id
                   WHERE t.status NOT IN ('received','reconciled','cancelled','rejected','reversed')
                   GROUP BY t.id, sl.name_ar, dl.name_ar
                   ORDER BY t.created_at DESC LIMIT 100`),
      pool.query(`SELECT audit_number, status, warehouse_scope, total_items, total_variance_value, created_at, approved_at
                    FROM inventory_audits WHERE total_variance_value <> 0 OR status IN ('submitted','draft')
                   ORDER BY created_at DESC LIMIT 50`),
      pool.query(`SELECT oi.product_id, oi.product_name, SUM(oi.quantity)::numeric quantity,
                         SUM(oi.line_total)::numeric revenue
                    FROM pos_order_items oi
                    JOIN pos_orders o ON o.id=oi.order_id
                   WHERE o.status IN ('issued','reported') AND o.created_at::date=CURRENT_DATE
                   GROUP BY oi.product_id, oi.product_name
                   ORDER BY quantity DESC, revenue DESC LIMIT 200`),
    ]);
    const totalAvailableValue = balances.rows.reduce((sum, row) => sum + (Number(row.available) * Number(row.avg_cost || 0)), 0);
    res.json({ generated_at: new Date().toISOString(), kpis: {
      locations: new Set(balances.rows.map(x => x.location_code)).size,
      tracked_items: new Set(balances.rows.map(x => x.inventory_id)).size,
      critical_items: lowStock.rows.length,
      open_transfers: transfers.rows.length,
      audit_attention: variances.rows.length,
      sold_skus_today: sales.rows.length,
    }, balances: balances.rows, low_stock: lowStock.rows, open_transfers: transfers.rows, audit_attention: variances.rows, sales_by_item_today: sales.rows, total_available_value: totalAvailableValue });
  } catch (e) { res.status(500).json({ error: 'INTELLIGENCE_OVERVIEW_FAILED', message: 'تعذر تحميل ملخص الذكاء المخزني' }); }
});

function fail(res, status, error, message, extra = {}) { return res.status(status).json({ error, message, ...extra }); }
function number(value) { const n = Number(value); return Number.isFinite(n) ? n : NaN; }
function transferNumber() { return `TR-${new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14)}-${Math.floor(Math.random() * 900 + 100)}`; }
async function event(client, transferId, fromStatus, toStatus, userId, reason, metadata = {}) {
  await client.query(
    `INSERT INTO inventory_transfer_events (transfer_id, from_status, to_status, actor_user_id, reason, metadata)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [transferId, fromStatus || null, toStatus, userId || null, reason || null, JSON.stringify(metadata)]
  );
}

router.get('/transfers', jwtAuth, requireRole('admin', 'manager', 'warehouse', 'kitchen', 'auditor', 'accountant'), async (req, res) => {
  try {
    const params = [];
    const where = [];
    if (req.query.status) { params.push(String(req.query.status)); where.push(`t.status = $${params.length}`); }
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
    params.push(limit);
    const rows = await pool.query(
      `SELECT t.*, sl.code source_location_code, sl.name_ar source_location_name,
              dl.code destination_location_code, dl.name_ar destination_location_name,
              COALESCE(json_agg(json_build_object(
                'id', ti.id, 'inventory_id', ti.inventory_id, 'item_name', i.name,
                'unit', ti.unit, 'requested_qty', ti.requested_qty, 'reserved_qty', ti.reserved_qty,
                'dispatched_qty', ti.dispatched_qty, 'received_qty', ti.received_qty,
                'variance_qty', ti.variance_qty, 'unit_cost', ti.unit_cost,
                'catch_weight_enabled', COALESCE(i.catch_weight_enabled, false),
                'packaging_uom', ti.packaging_uom, 'catch_weight_uom', ti.catch_weight_uom,
                'requested_packaging_qty', ti.requested_packaging_qty,
                'reserved_packaging_qty', ti.reserved_packaging_qty,
                'dispatched_packaging_qty', ti.dispatched_packaging_qty,
                'received_packaging_qty', ti.received_packaging_qty
              ) ORDER BY i.name) FILTER (WHERE ti.id IS NOT NULL), '[]') AS items
         FROM inventory_transfers t
         JOIN inventory_locations sl ON sl.id = t.source_location_id
         JOIN inventory_locations dl ON dl.id = t.destination_location_id
         LEFT JOIN inventory_transfer_items ti ON ti.transfer_id = t.id
         LEFT JOIN inventory i ON i.id = ti.inventory_id
        ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        GROUP BY t.id, sl.id, dl.id
        ORDER BY t.created_at DESC LIMIT $${params.length}`,
      params
    );
    res.json(rows.rows);
  } catch (e) { res.status(500).json({ error: 'INTERNAL_ERROR', message: 'تعذر جلب قائمة التحويلات' }); }
});

router.post('/transfers', jwtAuth, requireRole(...routerWriteRoles), async (req, res) => {
  const source = Number(req.body?.source_location_id);
  const destination = Number(req.body?.destination_location_id);
  const rawItems = Array.isArray(req.body?.items) ? req.body.items : [];
  if (!Number.isInteger(source) || !Number.isInteger(destination) || source === destination || !rawItems.length) {return fail(res, 422, 'INVALID_TRANSFER', 'يجب تحديد موقع مصدر ووجهة وأصناف');}
  // Catch Weight: الكمية الأساسية بالكيلو (requested_qty) + عدد التعبئة اختياري (requested_packaging_qty)
  const items = new Map();
  for (const raw of rawItems) {
    const inventoryId = Number(raw.inventory_id);
    const qty = number(raw.requested_qty ?? raw.qty);
    const packagingQty = raw.requested_packaging_qty ?? raw.packaging_qty ?? null;
    const pkg = packagingQty === null || packagingQty === undefined || packagingQty === '' ? null : number(packagingQty);
    if (!Number.isInteger(inventoryId) || !Number.isFinite(qty) || qty <= 0) {return fail(res, 422, 'INVALID_TRANSFER_ITEM', 'بيانات الصنف أو الكمية غير صحيحة');}
    if (pkg !== null && (!Number.isFinite(pkg) || pkg < 0)) {return fail(res, 422, 'INVALID_TRANSFER_ITEM', 'عدد التعبئة (كرتون) غير صحيح');}
    const prev = items.get(inventoryId) || { qty: 0, packagingQty: null };
    items.set(inventoryId, {
      qty: prev.qty + qty,
      packagingQty: (prev.packagingQty || 0) + (pkg || 0) > 0 ? (prev.packagingQty || 0) + (pkg || 0) : (pkg !== null ? pkg : prev.packagingQty),
    });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const locations = await client.query('SELECT id FROM inventory_locations WHERE id = ANY($1::bigint[]) AND active = true FOR SHARE', [[source, destination]]);
    if (locations.rows.length !== 2) { await client.query('ROLLBACK'); return fail(res, 422, 'INVALID_LOCATION', 'الموقع المصدر أو الوجهة غير صالح'); }
    const transfer = (await client.query(
      `INSERT INTO inventory_transfers (transfer_number, status, source_location_id, destination_location_id, requested_by, notes)
       VALUES ($1,'requested',$2,$3,$4,$5) RETURNING *`,
      [transferNumber(), source, destination, req.user.id, req.body.notes || null]
    )).rows[0];
    for (const [inventoryId, entry] of items) {
      const item = (await client.query('SELECT id, name, unit, COALESCE("avgCost",0) avg_cost, COALESCE(catch_weight_enabled,false) catch_weight_enabled, packaging_uom, catch_weight_uom FROM inventory WHERE id=$1', [inventoryId])).rows[0];
      if (!item) { await client.query('ROLLBACK'); return fail(res, 422, 'INVENTORY_ITEM_NOT_FOUND', `الصنف ${inventoryId} غير موجود`); }
      await client.query(
        `INSERT INTO inventory_transfer_items (transfer_id, inventory_id, unit, requested_qty, unit_cost, packaging_uom, catch_weight_uom, requested_packaging_qty)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [transfer.id, inventoryId, item.unit || 'وحدة', entry.qty, item.avg_cost,
         item.catch_weight_enabled ? (item.packaging_uom || 'كرتون') : null,
         item.catch_weight_enabled ? (item.catch_weight_uom || 'kg') : null,
         item.catch_weight_enabled ? entry.packagingQty : null]
      );
    }
    await event(client, transfer.id, null, 'requested', req.user.id, 'إنشاء طلب تحويل');
    await client.query('COMMIT');
    res.status(201).json(transfer);
  } catch (e) { await client.query('ROLLBACK').catch(() => {}); res.status(500).json({ error: 'INTERNAL_ERROR', message: 'تعذر إنشاء طلب التحويل' }); }
  finally { client.release(); }
});

router.post('/transfers/:id/approve', jwtAuth, requireRole(...approvalRoles), async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const transfer = (await client.query('SELECT * FROM inventory_transfers WHERE id=$1 FOR UPDATE', [req.params.id])).rows[0];
    if (!transfer) { await client.query('ROLLBACK'); return fail(res, 404, 'TRANSFER_NOT_FOUND', 'التحويل غير موجود'); }
    if (!['requested'].includes(transfer.status)) { await client.query('ROLLBACK'); return fail(res, 409, 'INVALID_TRANSFER_STATE', 'حالة التحويل لا تسمح بالاعتماد'); }
    const items = (await client.query('SELECT * FROM inventory_transfer_items WHERE transfer_id=$1 FOR UPDATE', [transfer.id])).rows;
    const reservations = [];
    for (const item of items) {
      await client.query(`INSERT INTO inventory_location_balances (inventory_id, location_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [item.inventory_id, transfer.source_location_id]);
      const balance = (await client.query(`SELECT on_hand, reserved FROM inventory_location_balances WHERE inventory_id=$1 AND location_id=$2 FOR UPDATE`, [item.inventory_id, transfer.source_location_id])).rows[0];
      const available = Number(balance.on_hand) - Number(balance.reserved);
      const reserved = Math.min(Number(item.requested_qty), Math.max(0, available));
      if (reserved <= 0) { await client.query('ROLLBACK'); return fail(res, 409, 'INSUFFICIENT_AVAILABLE_STOCK', 'لا يوجد رصيد متاح للحجز', { inventory_id: item.inventory_id, available }); }
      await client.query(`UPDATE inventory_location_balances SET reserved=reserved+$3, updated_at=CURRENT_TIMESTAMP WHERE inventory_id=$1 AND location_id=$2`, [item.inventory_id, transfer.source_location_id, reserved]);
      // Catch Weight: الحجز بالكيلو؛ عدد الكراتين يتبع بنسبة المحجوز/المطلوب
      const reqPkg = item.requested_packaging_qty !== null && item.requested_packaging_qty !== undefined ? Number(item.requested_packaging_qty) : null;
      const reqKg = Number(item.requested_qty) || 0;
      const reservedPkg = (reqPkg !== null && Number.isFinite(reqPkg) && reqKg > 0)
        ? Number(((reqPkg * reserved) / reqKg).toFixed(3))
        : reqPkg;
      await client.query(`UPDATE inventory_transfer_items SET reserved_qty=$3, reserved_packaging_qty=$4, updated_at=CURRENT_TIMESTAMP WHERE id=$1 AND transfer_id=$2`, [item.id, transfer.id, reserved, reservedPkg]);
      reservations.push({ inventory_id: item.inventory_id, requested_qty: Number(item.requested_qty), reserved_qty: reserved, short_reserved: reserved < Number(item.requested_qty), reserved_packaging_qty: reservedPkg });
    }
    const next = 'reserved';
    await client.query(`UPDATE inventory_transfers SET status=$2, approved_by=$3, approved_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP WHERE id=$1`, [transfer.id, next, req.user.id]);
    await event(client, transfer.id, transfer.status, next, req.user.id, req.body.reason || 'اعتماد وحجز الكميات');
    await client.query('COMMIT');
    res.json({ transfer_id: transfer.id, status: next, reservations });
  } catch (e) { await client.query('ROLLBACK').catch(() => {}); res.status(e.code === 'INSUFFICIENT_STOCK' ? 409 : 500).json({ error: e.code || 'INTERNAL_ERROR', message: 'تعذر اعتماد التحويل وحجز الكميات' }); }
  finally { client.release(); }
});

router.post('/transfers/:id/dispatch', jwtAuth, requireRole(...routerWriteRoles), async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const transfer = (await client.query('SELECT * FROM inventory_transfers WHERE id=$1 FOR UPDATE', [req.params.id])).rows[0];
    if (!transfer) { await client.query('ROLLBACK'); return fail(res, 404, 'TRANSFER_NOT_FOUND', 'التحويل غير موجود'); }
    if (!['reserved', 'picking', 'picked'].includes(transfer.status)) { await client.query('ROLLBACK'); return fail(res, 409, 'INVALID_TRANSFER_STATE', 'يجب اعتماد التحويل وحجز الكمية أولاً'); }
    // NOTE: FOR UPDATE + LEFT JOIN = PG 0A000 — نبقي القفل على البنود فقط ونجلب أعلام Catch Weight باستعلام منفصل
    const items = (await client.query('SELECT * FROM inventory_transfer_items WHERE transfer_id=$1 FOR UPDATE', [transfer.id])).rows;
    const catchInfo = new Map((await client.query(
      `SELECT id, COALESCE(catch_weight_enabled,false) AS catch_weight_enabled, packaging_uom, catch_weight_uom
         FROM inventory WHERE id = ANY($1::bigint[])`,
      [items.map(i => i.inventory_id)]
    )).rows.map(r => [String(r.id), r]));
    for (const it of items) { Object.assign(it, { catch_weight_enabled: catchInfo.get(String(it.inventory_id))?.catch_weight_enabled || false }); }
    const dispatchItems = new Map((Array.isArray(req.body?.items) ? req.body.items : []).map(x => [String(x.inventory_id), x]));
    for (const item of items) {
      const override = dispatchItems.get(String(item.inventory_id));
      // Catch Weight: الوزن الفعلي المشحون قد يختلف عن المحجوز (وزن الميزان) + عدد كراتين فعلي
      const qty = override && override.dispatched_qty !== undefined && override.dispatched_qty !== null && override.dispatched_qty !== ''
        ? number(override.dispatched_qty) : Number(item.reserved_qty);
      if (!Number.isFinite(qty) || qty < 0 || qty > Number(item.reserved_qty)) { await client.query('ROLLBACK'); return fail(res, 422, 'INVALID_DISPATCHED_QTY', 'كمية الشحن غير صحيحة', { inventory_id: item.inventory_id }); }
      if (qty <= 0) {continue;}
      const pkgOverride = override && (override.dispatched_packaging_qty !== undefined && override.dispatched_packaging_qty !== null && override.dispatched_packaging_qty !== '')
        ? number(override.dispatched_packaging_qty) : (item.reserved_packaging_qty !== null && item.reserved_packaging_qty !== undefined ? Number(item.reserved_packaging_qty) : null);
      if (pkgOverride !== null && (!Number.isFinite(pkgOverride) || pkgOverride < 0)) { await client.query('ROLLBACK'); return fail(res, 422, 'INVALID_DISPATCHED_PACKAGING_QTY', 'عدد كراتين الشحن غير صحيح', { inventory_id: item.inventory_id }); }
      await postInventoryLedgerEntry(client, { transactionType: 'transfer_out', inventoryId: item.inventory_id, locationId: transfer.source_location_id, quantityDelta: -qty, sourceLocationId: transfer.source_location_id, destinationLocationId: transfer.destination_location_id, referenceType: 'inventory_transfer', referenceId: transfer.id, userId: req.user.id, idempotencyKey: `transfer:${transfer.id}:out:${item.inventory_id}`, reason: 'شحن تحويل مخزني', metadata: { transfer_id: transfer.id, dispatched_packaging_qty: pkgOverride },
        catchWeightQty: pkgOverride, catchWeightUnit: item.packaging_uom || null });
      // تحرير كامل الحجز (المشحون انتقل إلى in_transit، والفرق غير المشحون يعود متاحًا)
      await client.query(`UPDATE inventory_location_balances SET reserved=GREATEST(0::numeric,reserved-$3::numeric), updated_at=CURRENT_TIMESTAMP WHERE inventory_id=$1::bigint AND location_id=$2::bigint`, [item.inventory_id, transfer.source_location_id, Number(item.reserved_qty)]);
      await client.query(`INSERT INTO inventory_location_balances (inventory_id, location_id, in_transit) VALUES ($1::bigint,$2::bigint,$3::numeric)
                          ON CONFLICT (inventory_id, location_id) DO UPDATE SET in_transit=inventory_location_balances.in_transit+$3::numeric, updated_at=CURRENT_TIMESTAMP`, [item.inventory_id, transfer.destination_location_id, qty]);
      await client.query(`UPDATE inventory_transfer_items SET dispatched_qty=$2::numeric, dispatched_packaging_qty=$3, updated_at=CURRENT_TIMESTAMP WHERE id=$1::uuid`, [item.id, qty, pkgOverride]);
    }
    await client.query(`UPDATE inventory_transfers SET status='in_transit', dispatched_by=$2::bigint, dispatched_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP WHERE id=$1::uuid`, [transfer.id, req.user.id]);
    await event(client, transfer.id, transfer.status, 'in_transit', req.user.id, req.body.reason || 'إرسال التحويل');
    await client.query('COMMIT');
    res.json({ transfer_id: transfer.id, status: 'in_transit' });
  } catch (e) { await client.query('ROLLBACK').catch(() => {}); res.status(e.code === 'INSUFFICIENT_STOCK' ? 409 : 500).json({ error: e.code || 'INTERNAL_ERROR', message: 'تعذر شحن التحويل المخزني' }); }
  finally { client.release(); }
});

router.post('/transfers/:id/receive', jwtAuth, requireRole(...routerWriteRoles), async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const transfer = (await client.query('SELECT * FROM inventory_transfers WHERE id=$1 FOR UPDATE', [req.params.id])).rows[0];
    if (!transfer) { await client.query('ROLLBACK'); return fail(res, 404, 'TRANSFER_NOT_FOUND', 'التحويل غير موجود'); }
    if (!['in_transit', 'partially_received'].includes(transfer.status)) { await client.query('ROLLBACK'); return fail(res, 409, 'INVALID_TRANSFER_STATE', 'التحويل ليس في حالة استلام'); }
    const receivedItems = new Map((Array.isArray(req.body?.items) ? req.body.items : []).map(x => [String(x.inventory_id), x]));
    const items = (await client.query('SELECT * FROM inventory_transfer_items WHERE transfer_id=$1 FOR UPDATE', [transfer.id])).rows;
    let hasVariance = false;
    for (const item of items) {
      const raw = receivedItems.get(String(item.inventory_id));
      const qty = raw && raw.received_qty !== undefined && raw.received_qty !== null && raw.received_qty !== '' ? number(raw.received_qty) : Number(item.dispatched_qty);
      if (!Number.isFinite(qty) || qty < 0 || qty > Number(item.dispatched_qty)) { await client.query('ROLLBACK'); return fail(res, 422, 'INVALID_RECEIVED_QTY', 'كمية الاستلام غير صحيحة', { inventory_id: item.inventory_id }); }
      // Catch Weight: عدد الكراتين المستلم قد يختلف عن المشحون
      const recvPkg = raw && raw.received_packaging_qty !== undefined && raw.received_packaging_qty !== null && raw.received_packaging_qty !== ''
        ? number(raw.received_packaging_qty)
        : (item.dispatched_packaging_qty !== null && item.dispatched_packaging_qty !== undefined ? Number(item.dispatched_packaging_qty) : null);
      if (recvPkg !== null && (!Number.isFinite(recvPkg) || recvPkg < 0)) { await client.query('ROLLBACK'); return fail(res, 422, 'INVALID_RECEIVED_PACKAGING_QTY', 'عدد كراتين الاستلام غير صحيح', { inventory_id: item.inventory_id }); }
      const variance = Number((qty - Number(item.dispatched_qty)).toFixed(4));
      const dispPkg = item.dispatched_packaging_qty !== null && item.dispatched_packaging_qty !== undefined ? Number(item.dispatched_packaging_qty) : null;
      const pkgVariance = (recvPkg !== null && dispPkg !== null) ? Number((recvPkg - dispPkg).toFixed(3)) : null;
      if (variance !== 0 || (pkgVariance !== null && pkgVariance !== 0)) {hasVariance = true;}
      await postInventoryLedgerEntry(client, { transactionType: 'transfer_in', inventoryId: item.inventory_id, locationId: transfer.destination_location_id, quantityDelta: qty, sourceLocationId: transfer.source_location_id, destinationLocationId: transfer.destination_location_id, referenceType: 'inventory_transfer', referenceId: transfer.id, userId: req.user.id, idempotencyKey: `transfer:${transfer.id}:in:${item.inventory_id}`, reason: variance ? 'استلام تحويل مع فرق' : 'استلام تحويل مخزني', metadata: { transfer_id: transfer.id, variance_qty: variance, dispatched_packaging_qty: dispPkg, received_packaging_qty: recvPkg, packaging_variance_qty: pkgVariance },
        catchWeightQty: recvPkg, catchWeightUnit: item.packaging_uom || null });
      // in_transit was incremented at the DESTINATION on dispatch — clear it there too
      await client.query(`UPDATE inventory_location_balances SET in_transit=GREATEST(0,in_transit-$3), updated_at=CURRENT_TIMESTAMP WHERE inventory_id=$1 AND location_id=$2`, [item.inventory_id, transfer.destination_location_id, Number(item.dispatched_qty)]);
      await client.query(`UPDATE inventory_transfer_items SET received_qty=$2, received_packaging_qty=$3, variance_qty=$4, variance_reason=$5, updated_at=CURRENT_TIMESTAMP WHERE id=$1`, [item.id, qty, recvPkg, variance, variance ? (req.body.reason || 'فرق استلام يحتاج تسوية') : null]);
    }
    const next = hasVariance ? 'reconciliation_required' : 'received';
    await client.query(`UPDATE inventory_transfers SET status=$2, received_by=$3, received_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP WHERE id=$1`, [transfer.id, next, req.user.id]);
    await event(client, transfer.id, transfer.status, next, req.user.id, req.body.reason || 'تأكيد استلام التحويل', { has_variance: hasVariance });
    await client.query('COMMIT');
    res.json({ transfer_id: transfer.id, status: next, reconciliation_required: hasVariance });
  } catch (e) { await client.query('ROLLBACK').catch(() => {}); res.status(500).json({ error: e.code || 'INTERNAL_ERROR', message: 'تعذر استلام التحويل المخزني' }); }
  finally { client.release(); }
});

router.post('/transfers/:id/cancel', jwtAuth, requireRole(...approvalRoles), async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const transfer = (await client.query('SELECT * FROM inventory_transfers WHERE id=$1 FOR UPDATE', [req.params.id])).rows[0];
    if (!transfer) { await client.query('ROLLBACK'); return fail(res, 404, 'TRANSFER_NOT_FOUND', 'التحويل غير موجود'); }
    // الإلغاء قبل الشحن فقط — بعد الشحن البضاعة في الطريق ولا يجوز إسقاطها
    if (!['requested', 'reserved'].includes(transfer.status)) { await client.query('ROLLBACK'); return fail(res, 409, 'INVALID_TRANSFER_STATE', 'لا يمكن إلغاء تحويل تم شحنه — استلمه ثم سوّه'); }
    const items = (await client.query('SELECT * FROM inventory_transfer_items WHERE transfer_id=$1 FOR UPDATE', [transfer.id])).rows;
    // فك أي كميات محجوزة في المخزن المصدر
    for (const item of items) {
      const reserved = Number(item.reserved_qty) || 0;
      if (reserved > 0) {
        await client.query(`UPDATE inventory_location_balances SET reserved=GREATEST(0::numeric,reserved-$3::numeric), updated_at=CURRENT_TIMESTAMP WHERE inventory_id=$1 AND location_id=$2`, [item.inventory_id, transfer.source_location_id, reserved]);
      }
      await client.query(`UPDATE inventory_transfer_items SET reserved_qty=0, updated_at=CURRENT_TIMESTAMP WHERE id=$1`, [item.id]);
    }
    await client.query(`UPDATE inventory_transfers SET status='cancelled', updated_at=CURRENT_TIMESTAMP WHERE id=$1`, [transfer.id]);
    await event(client, transfer.id, transfer.status, 'cancelled', req.user.id, req.body.reason || 'إلغاء طلب التحويل');
    await client.query('COMMIT');
    res.json({ transfer_id: transfer.id, status: 'cancelled' });
  } catch (e) { await client.query('ROLLBACK').catch(() => {}); res.status(500).json({ error: 'INTERNAL_ERROR', message: 'تعذر إلغاء التحويل' }); }
  finally { client.release(); }
});

router.post('/transfers/:id/reconcile', jwtAuth, requireRole('admin', 'manager', 'warehouse'), async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const transfer = (await client.query('SELECT * FROM inventory_transfers WHERE id=$1 FOR UPDATE', [req.params.id])).rows[0];
    if (!transfer || transfer.status !== 'reconciliation_required') { await client.query('ROLLBACK'); return fail(res, 409, 'RECONCILIATION_NOT_REQUIRED', 'لا توجد تسوية مطلوبة'); }
    const reason = String(req.body?.reason || '').trim();
    if (reason.length < 10) { await client.query('ROLLBACK'); return fail(res, 422, 'REASON_REQUIRED', 'سبب التسوية يجب أن يكون واضحًا'); }
    await client.query(`UPDATE inventory_transfers SET status='reconciled', reconciled_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP, metadata=metadata || $2::jsonb WHERE id=$1`, [transfer.id, JSON.stringify({ reconciliation_reason: reason, reconciled_by: req.user.id })]);
    await event(client, transfer.id, transfer.status, 'reconciled', req.user.id, reason);
    await client.query('COMMIT');
    res.json({ transfer_id: transfer.id, status: 'reconciled' });
  } catch (e) { await client.query('ROLLBACK').catch(() => {}); res.status(500).json({ error: 'INTERNAL_ERROR', message: 'تعذر تسوية التحويل' }); }
  finally { client.release(); }
});

module.exports = { router };
