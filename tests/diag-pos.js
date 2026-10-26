require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { Pool } = require('pg');
const pool = new Pool({
  host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 5432),
  database: process.env.DB_NAME, user: process.env.DB_USER, password: process.env.DB_PASSWORD,
});
(async () => {
  const c = (await pool.query(`SELECT column_name FROM information_schema.columns WHERE table_name='pos_products' ORDER BY ordinal_position`)).rows.map(r => r.column_name);
  console.log('أعمدة pos_products:', c.join(', '));
  const d = (await pool.query(`SELECT id, name_ar FROM pos_departments ORDER BY id`)).rows;
  console.log('الأقسام:', JSON.stringify(d));
  const n = (await pool.query(`SELECT COUNT(*)::int AS c FROM pos_products`)).rows[0].c;
  console.log('عدد الأصناف الحالي:', n);
  const sample = (await pool.query(`SELECT * FROM pos_products LIMIT 2`)).rows;
  for (const s of sample) {console.log('نموذج:', JSON.stringify(s).slice(0, 500));}
})().catch(e => { console.error('ERR', e.message); process.exitCode = 1; }).finally(() => pool.end());
