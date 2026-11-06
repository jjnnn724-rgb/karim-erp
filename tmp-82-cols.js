'use strict';
const { pool } = require('./backend/shared-pool');
(async () => {
  const t = await pool.query(`SELECT column_name, data_type FROM information_schema.columns WHERE table_name='attendance' ORDER BY ordinal_position`);
  console.table(t.rows);
  const s = await pool.query(`SELECT "employeeId", date, "checkIn", "checkOut", source, notes, "checkinInferred", "checkoutInferred" FROM attendance WHERE date BETWEEN '2026-09-25' AND '2026-09-30' ORDER BY date, "employeeId" LIMIT 12`);
  console.table(s.rows);
  await pool.end();
})().catch(e => { console.log('ERR ' + e.message); process.exit(1); });
