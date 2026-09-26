const { v4: uuidv4 } = require('uuid');

const ALLOWED_TYPES = new Set([
  'opening_balance', 'purchase_receipt', 'transfer_out', 'transfer_in',
  'sale_consumption', 'production_consumption', 'production_output', 'waste',
  'return', 'adjustment', 'count_correction', 'reversal', 'receiving_variance',
  'other_approved_movement',
]);

function asNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Posts one immutable inventory movement and updates its balance projection.
 * Callers must already be inside a transaction. The function locks the balance
 * row, rejects negative stock by default, and writes a ledger entry with a
 * correlation/idempotency context.
 */
/**
 * Posts one immutable inventory movement and updates its balance projection.
 * Callers must already be inside a transaction. The function locks the balance
 * row, rejects negative stock by default, and writes a ledger entry with a
 * correlation/idempotency context.
 * 
 * Supports Catch Weight: when input.catchWeightQty is provided, it stores the
 * actual weight (in kg) separately from the packaging quantity.
 */
async function postInventoryLedgerEntry(client, input = {}) {
  const transactionType = String(input.transactionType || 'other_approved_movement');
  if (!ALLOWED_TYPES.has(transactionType)) {throw new Error(`INVALID_LEDGER_TRANSACTION_TYPE:${transactionType}`);}
  const inventoryId = Number(input.inventoryId);
  const locationId = Number(input.locationId);
  const delta = Number(input.quantityDelta);
  if (!Number.isInteger(inventoryId) || inventoryId <= 0) {throw new Error('INVALID_LEDGER_INVENTORY_ID');}
  if (!Number.isInteger(locationId) || locationId <= 0) {throw new Error('INVALID_LEDGER_LOCATION_ID');}
  if (!Number.isFinite(delta) || delta === 0) {throw new Error('INVALID_LEDGER_QUANTITY_DELTA');}

  const idempotencyKey = input.idempotencyKey ? String(input.idempotencyKey) : null;
  if (idempotencyKey) {
    const existing = await client.query('SELECT * FROM inventory_ledger WHERE idempotency_key = $1 FOR UPDATE', [idempotencyKey]);
    if (existing.rows.length) {return { ledger: existing.rows[0], replay: true };}
  }


  const item = await client.query(
    'SELECT id, name, unit, qty, COALESCE("avgCost", 0) AS avg_cost FROM inventory WHERE id = $1 FOR UPDATE',
    [inventoryId]
  );
  if (!item.rows.length) {throw new Error('INVENTORY_ITEM_NOT_FOUND');}
  const location = await client.query('SELECT id, negative_stock_policy FROM inventory_locations WHERE id = $1 AND active = true FOR SHARE', [locationId]);
  if (!location.rows.length) {throw new Error('INVENTORY_LOCATION_NOT_FOUND');}

  const balanceCount = await client.query('SELECT COUNT(*)::int AS count FROM inventory_location_balances WHERE inventory_id = $1', [inventoryId]);
  const isLegacyUnseeded = Number(balanceCount.rows[0]?.count || 0) === 0;
  const openingOnHand = isLegacyUnseeded ? asNumber(item.rows[0].qty) : 0;
  await client.query(
    `INSERT INTO inventory_location_balances (inventory_id, location_id, on_hand)
     VALUES ($1, $2, $3) ON CONFLICT (inventory_id, location_id) DO NOTHING`,
    [inventoryId, locationId, openingOnHand]
  );
  const balance = await client.query(
    `SELECT * FROM inventory_location_balances
      WHERE inventory_id = $1 AND location_id = $2 FOR UPDATE`,
    [inventoryId, locationId]
  );
  const current = asNumber(balance.rows[0].on_hand);
  const next = Number((current + delta).toFixed(4));
  if (next < 0 && location.rows[0].negative_stock_policy === 'deny') {
    const error = new Error('INSUFFICIENT_STOCK');
    error.code = 'INSUFFICIENT_STOCK';
    error.available = current;
    error.requested = Math.abs(delta);
    throw error;
  }

  const unitCost = asNumber(input.unitCost, asNumber(item.rows[0].avg_cost));
  const transactionId = input.transactionId || uuidv4();
  const correlationId = input.correlationId || uuidv4();
  const metadata = input.metadata && typeof input.metadata === 'object' ? input.metadata : {};
  
  // Catch weight fields
  const catchWeightQty = input.catchWeightQty !== undefined ? Number(input.catchWeightQty) : null;
  const catchWeightUnit = input.catchWeightUnit || null;
  
  // سباق التكرار (نقرتان متزامنتان): الفحص-ثم-الإدخال قد يتسابق — القيد الفريد
  // inventory_ledger_idempotency_unique هو الحكم النهائي، ونحوّل التعارض إلى replay نظيف
  let ledger;
  try {
    ledger = await client.query(
      `INSERT INTO inventory_ledger
        (transaction_id, transaction_type, inventory_id, location_id, quantity_delta,
         unit, unit_cost, total_cost, batch_id, lot_number, expiry_date,
         source_location_id, destination_location_id, reference_type, reference_id,
         business_date, shift_id, user_id, correlation_id, idempotency_key, reason, metadata,
         catch_weight_qty, catch_weight_unit)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24)
        RETURNING *`,
      [transactionId, transactionType, inventoryId, locationId, delta, input.unit || item.rows[0].unit || 'وحدة',
        unitCost, Number((Math.abs(delta) * unitCost).toFixed(4)), input.batchId || null,
        input.lotNumber || null, input.expiryDate || null, input.sourceLocationId || null,
        input.destinationLocationId || null, input.referenceType || null, input.referenceId || null,
        input.businessDate || new Date().toISOString().slice(0, 10), input.shiftId || null,
        input.userId || null, correlationId, idempotencyKey, input.reason || transactionType, JSON.stringify(metadata),
        catchWeightQty, catchWeightUnit]
    );
  } catch (insertError) {
    if (insertError && insertError.code === '23505' && idempotencyKey) {
      const raced = await client.query('SELECT * FROM inventory_ledger WHERE idempotency_key = $1', [idempotencyKey]);
      if (raced.rows.length) {return { ledger: raced.rows[0], replay: true };}
    }
    throw insertError;
  }

  await client.query(
    `UPDATE inventory_location_balances
        SET on_hand = $3, updated_at = CURRENT_TIMESTAMP
      WHERE inventory_id = $1 AND location_id = $2`,
    [inventoryId, locationId, next]
  );
  await client.query(
    `UPDATE inventory
        SET qty = COALESCE((SELECT SUM(on_hand) FROM inventory_location_balances WHERE inventory_id = $1), 0)
      WHERE id = $1`,
    [inventoryId]
  );
  return { ledger: ledger.rows[0], replay: false, balanceBefore: current, balanceAfter: next };
}

module.exports = { postInventoryLedgerEntry, ALLOWED_TYPES };
