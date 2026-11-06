'use strict';
const { pool } = require('./backend/shared-pool');
(async () => {
  // مَن نمطه 14:00 دخول / 02:00 انصراف في أكتوبر؟ وكم يومًا غاب عن 09-16..10-02؟
  const q = await pool.query(`
    WITH night AS (
      SELECT a."employeeId", COUNT(*)::int AS n_oct,
             MIN(a."checkIn") AS min_in, MAX(a."checkIn") AS max_in
        FROM attendance a WHERE a.date BETWEEN '2026-10-03' AND '2026-11-02'
          AND LEFT(a."checkIn",2) IN ('13','14') AND LEFT(a."checkOut",2) IN ('01','02','23')
        GROUP BY 1 HAVING COUNT(*) >= 3),
    sep AS (
      SELECT a."employeeId", COUNT(*)::int AS n_sep
        FROM attendance a WHERE a.date BETWEEN '2026-09-16' AND '2026-10-02' GROUP BY 1)
    SELECT e."employeeId", e.name, e.status, e."deviceUserId", e."deviceUserIdAlt",
           n.n_oct, COALESCE(s.n_sep,0) AS n_sep, n.min_in, n.max_in
      FROM night n JOIN employees e ON e.id=n."employeeId"
      LEFT JOIN sep s ON s."employeeId"=e.id
      ORDER BY COALESCE(s.n_sep,0), n.n_oct DESC`);
  console.log(`== مرشحون لنمط 14:00→02:00 (${q.rowCount}) ==`);
  console.table(q.rows);

  // من له حضور 09-16..10-02 بصفر أيام وهو نشط؟
  await pool.end();
})().catch(e => { console.log('ERR ' + e.message); process.exit(1); });
