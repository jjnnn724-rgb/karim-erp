const {pool} = require('./backend/shared-pool');

(async () => {
  try {
    console.log('Checking inventory_locations...');
    const loc = await pool.query("SELECT id, code, name_ar FROM inventory_locations WHERE code = 'MAIN-WAREHOUSE'");
    if (!loc.rows.length) {
      console.log('MAIN-WAREHOUSE NOT FOUND in inventory_locations');
      const all = await pool.query("SELECT id, code, name_ar FROM inventory_locations");
      console.log('All locations:', all.rows.length);
      all.rows.forEach(l => console.log('  ', l.id, l.code, l.name_ar));
      return;
    }
    const locationId = loc.rows[0].id;
    console.log('Location:', locationId, loc.rows[0].code, loc.rows[0].name_ar);

    console.log('Checking inventory_location_balances for location', locationId, '...');
    const bal = await pool.query("SELECT ilb.inventory_id, i.name, ilb.on_hand, ilb.reserved FROM inventory_location_balances ilb JOIN inventory i ON i.id = ilb.inventory_id WHERE ilb.location_id = $1", [locationId]);
    console.log('Existing balances:', bal.rows.length);
    bal.rows.forEach(b => console.log('  ', b.name, 'on_hand:', b.on_hand, 'reserved:', b.reserved));

    console.log('Checking inventory items with qty > 0...');
    const invs = await pool.query("SELECT id, name, unit, qty FROM inventory WHERE qty > 0 ORDER BY name");
    console.log('Inventory items:', invs.rows.length);
    let synced = 0;
    for (const inv of invs.rows) {
      const existing = bal.rows.find(b => b.inventory_id === inv.id);
      if (!existing) {
        await pool.query(
          "INSERT INTO inventory_location_balances (inventory_id, location_id, on_hand, reserved) VALUES ($1, $2, $3, 0) ON CONFLICT (inventory_id, location_id) DO UPDATE SET on_hand = $3, reserved = 0",
          [inv.id, locationId, Number(inv.qty)]
        );
        console.log('  SYNCED:', inv.name, 'qty:', inv.qty);
        synced++;
      } else {
        const diff = Math.abs(Number(inv.qty) - Number(existing.on_hand));
        if (diff > 0.01) {
          await pool.query(
            "UPDATE inventory_location_balances SET on_hand = $1, reserved = 0 WHERE inventory_id = $2 AND location_id = $3",
            [Number(inv.qty), inv.id, locationId]
          );
          console.log('  UPDATED:', inv.name, 'qty:', inv.qty, 'old:', existing.on_hand);
          synced++;
        }
      }
    }
    console.log('Synced/updated:', synced, 'items');
    console.log('Done');
  } catch (e) {
    console.log('ERROR:', e.message);
  }
})();
