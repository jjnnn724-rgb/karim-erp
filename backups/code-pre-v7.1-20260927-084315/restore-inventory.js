// Restore inventory + location_balances from known data
// Data from background process (2026-09-22 21:02:44) + UI screenshot
// Columns: id, name, category, unit, qty, avgCost, minQty, shelfId, weight, barcode, external_code
// NO status column in inventory table
// id must be explicit (no sequence/default)
const { pool } = require('./backend/shared-pool.js');

const items = [
  { id: 101, name: 'أرز',      category: 'حبوب',  minQty: 5,  qty: 105, unit: 'kg',     avgCost: 3.50, shelfId: 1 },
  { id: 102, name: 'ارز مصري',  category: 'عام',   minQty: 0,  qty: 100, unit: 'كيلوجرام', avgCost: 10,   shelfId: 1 },
  { id: 103, name: 'دجاغ',     category: 'لحوم',  minQty: 10, qty: 60,  unit: 'كجم',    avgCost: 25,   shelfId: 1 },
  { id: 104, name: 'زيت نخيل', category: 'زيوت',  minQty: 30, qty: 35,  unit: 'لتر',    avgCost: 8,    shelfId: 1 },
  { id: 105, name: 'سكر',      category: 'عام',   minQty: 10, qty: 30,  unit: 'قطعة',   avgCost: 20,   shelfId: 1 },
  { id: 106, name: 'ماشروم',    category: 'عام',   minQty: 5,  qty: 30,  unit: 'قطعة',   avgCost: 10,   shelfId: 1 },
];

async function main() {
  try {
    await pool.query('DELETE FROM inventory_location_balances');
    await pool.query('DELETE FROM inventory');

    console.log('Inserting inventory...');
    for (const item of items) {
      const r = await pool.query(
        `INSERT INTO inventory (id, name, category, "minQty", qty, "avgCost", unit, "shelfId")
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id, name, qty, "minQty"`,
        [item.id, item.name, item.category, item.minQty, item.qty, item.avgCost, item.unit, item.shelfId]
      );
      const inv = r.rows[0];
      console.log(`  + ${inv.name}: id=${inv.id} qty=${inv.qty} minQty=${inv.minQty}`);

      await pool.query(
        `INSERT INTO inventory_location_balances (inventory_id, location_id, on_hand, reserved)
         VALUES ($1, 1, $2, 0)`,
        [inv.id, inv.qty]
      );
    }

    // Verify
    const invCheck = await pool.query(
      `SELECT i.name, i.qty, i."minQty", bl.on_hand, bl.reserved
       FROM inventory i
       JOIN inventory_location_balances bl ON bl.inventory_id = i.id
       ORDER BY i.name`
    );
    console.log('\n=== VERIFY ===');
    console.log(`Total: ${invCheck.rows.length} items`);
    for (const r of invCheck.rows) {
      console.log(`  ${r.name}: qty=${r.qty} minQty=${r.minQty} on_hand=${r.on_hand} reserved=${r.reserved}`);
    }

    console.log('\n✓ Inventory restored');
    process.exit(0);
  } catch (e) {
    console.error('✗ Error:', e.message);
    console.error(e.stack);
    process.exit(1);
  }
}

main();
