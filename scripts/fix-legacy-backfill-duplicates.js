// إصلاح بيانات: عكس قيود «تسوية استلام إذن صرف سابق» المكررة
// (كلها مكررات — الاستلام الحي سجل قيده بالفعل) داخل معاملة واحدة + تحقق نهائي
const { pool } = require('../backend/shared-pool');
const { postInventoryLedgerEntry } = require('../backend/inventory-ledger');
(async () => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const dup = await client.query(`
      SELECT b.id, b.inventory_id, b.quantity_delta, b.unit, b.unit_cost,
             b.reference_id AS dispatch_id, b.catch_weight_qty, b.catch_weight_unit, b.location_id
      FROM inventory_ledger b
      WHERE b.reference_type='dispatch_receipt'
        AND b.transaction_type='transfer_in'
        AND COALESCE(b.metadata->>'legacy_backfill','false') = 'true'
        AND EXISTS (
          SELECT 1 FROM inventory_ledger live
          WHERE live.reference_type='dispatch_receipt'
            AND live.reference_id = b.reference_id
            AND live.inventory_id = b.inventory_id
            AND live.transaction_type='transfer_in'
            AND COALESCE(live.metadata->>'legacy_backfill','false') <> 'true'
        )
        AND NOT EXISTS (
          SELECT 1 FROM inventory_ledger fix
          WHERE fix.reference_type='legacy_backfill_correction'
            AND fix.reference_id = b.id::text
        )
      ORDER BY b.id`);
    console.log('DUPLICATES_TO_REVERSE=' + dup.rows.length);
    let fixed = 0;
    for (const r of dup.rows) {
      const correction = await postInventoryLedgerEntry(client, {
        transactionType: 'reversal',
        inventoryId: Number(r.inventory_id),
        locationId: Number(r.location_id),
        quantityDelta: -Number(r.quantity_delta),
        unit: r.unit || 'وحدة',
        unitCost: Number(r.unit_cost) || 0,
        referenceType: 'legacy_backfill_correction',
        referenceId: String(r.id),
        idempotencyKey: `legacy-backfill-fix:${r.id}`,
        reason: `تصحيح تكرار تسوية استلام إذن صرف سابق #${r.dispatch_id} — عكس قيد مزدوج`,
        metadata: { corrects_ledger_id: r.id, dispatch_id: r.dispatch_id, legacy_backfill_fix: true },
        catchWeightQty: r.catch_weight_qty != null ? -Number(r.catch_weight_qty) : null,
        catchWeightUnit: r.catch_weight_unit || null,
      });
      if (!correction.replay) { fixed++; }
    }
    await client.query('COMMIT');
    console.log('REVERSED=' + fixed);
    // تحقق نهائي: الأرز + أي تكرار متبقٍ
    const rice = await pool.query("SELECT name, qty FROM inventory WHERE name LIKE '%رز%' ORDER BY name");
    console.log('=== RICE AFTER FIX ===');
    for (const i of rice.rows) { console.log(i.name.slice(0, 45), '-> qty=' + i.qty); }
    const remain = await client.query(`
      SELECT COUNT(*)::int AS n FROM inventory_ledger b
      WHERE b.reference_type='dispatch_receipt'
        AND b.transaction_type='transfer_in'
        AND COALESCE(b.metadata->>'legacy_backfill','false') = 'true'
        AND EXISTS (
          SELECT 1 FROM inventory_ledger live
          WHERE live.reference_type='dispatch_receipt'
            AND live.reference_id = b.reference_id
            AND live.inventory_id = b.inventory_id
            AND live.transaction_type='transfer_in'
            AND COALESCE(live.metadata->>'legacy_backfill','false') <> 'true'
        )
        AND NOT EXISTS (
          SELECT 1 FROM inventory_ledger fix
          WHERE fix.reference_type='legacy_backfill_correction'
            AND fix.reference_id = b.id::text
        )`);
    console.log('REMAINING_DUPLICATES=' + remain.rows[0].n);
    // تطابق عام: inventory.qty مقابل مجموع أرصدة المواقع
    const mismatch = await client.query(`
      SELECT COUNT(*)::int AS n FROM inventory i
      WHERE i.qty <> COALESCE((SELECT SUM(on_hand) FROM inventory_location_balances b WHERE b.inventory_id = i.id), 0)`);
    console.log('GLOBAL_VS_LOCATIONS_MISMATCH=' + mismatch.rows[0].n);
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('ERR', e.message);
  } finally {
    client.release();
    await pool.end();
  }
})();
