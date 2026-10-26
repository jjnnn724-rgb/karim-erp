require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { Pool } = require('pg');
const pool = new Pool({
  host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 5432),
  database: process.env.DB_NAME, user: process.env.DB_USER, password: process.env.DB_PASSWORD,
});
(async () => {
  const it = (await pool.query(`SELECT id, name, qty, unit FROM inventory WHERE LOWER(name)=LOWER($1)`, ['ملح ناعم 50 كيلو-كيس'])).rows[0];
  console.log(`الصنف: #${it.id} «${it.name}» qty(الإجمالي)=${it.qty} ${it.unit}`);
  const bals = (await pool.query(
    `SELECT l.code, l.name_ar, b.on_hand FROM inventory_location_balances b LEFT JOIN inventory_locations l ON l.id=b.location_id WHERE b.inventory_id=$1 ORDER BY b.location_id`, [it.id])).rows;
  for (const b of bals) {console.log(`  ${b.code} «${b.name_ar}»: ${b.on_hand}`);}
  const led = (await pool.query(
    `SELECT transaction_type, location_id, quantity_delta, reference_type, reason, created_at FROM inventory_ledger WHERE inventory_id=$1 ORDER BY created_at`, [it.id])).rows;
  console.log('--- الدفتر ---');
  for (const r of led) {console.log(`  ${r.created_at.toISOString().slice(5, 16).replace('T', ' ')} ${r.transaction_type} loc#${r.location_id} ${r.quantity_delta} — ${(r.reason || '').slice(0, 60)}`);}
})().catch(e => { console.error('ERR', e.message); process.exitCode = 1; }).finally(() => pool.end());
