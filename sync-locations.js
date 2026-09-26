const {pool} = require('./backend/shared-pool');

(async () => {
  try {
    // Get main warehouse location
    const loc = await pool.query("SELECT id, name FROM inventory_locations WHERE code = 'MAIN-WAREHOUSE'");
    if (!loc.rows.length) {
      console.log('MAIN-WAREHOUSE not found');
      return;
    }
    const locationId = loc.rows[0].id;
    console.log('Main warehouse location:', locationId, loc.rows[0].name);

    // Get all inventory items with qty > 0
    const invs = await pool.query('SELECT id, name, unit, qty FROM inventory WHERE qty > 0');
    console.log('Inventory items with qty:', invs.rows.length);

    // For each item, sync location balance from inventory.qty
    for (const inv of invs.rows) {
      await pool.query(
        `INSERT INTO inventory_location_balances (inventory_id, location_id, on_hand, reserved)
         VALUES (\$1, \$2, \$3, 0)
         ON CONFLICT (inventory_id, location_id) DO UPDATE SET on_hand = \$3, reserved = 0`,
        [inv.id, locationId, Number(inv.qty)]
      );
      console.log(inv.name, '→', inv.qty, '→ location balance synced');
    }
    console.log('Done - all location balances synced');
  } catch (e) {
    console.log('ERROR:', e.message);
  }
})();
