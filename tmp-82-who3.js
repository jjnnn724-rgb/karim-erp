'use strict';
const { pool } = require('./backend/shared-pool');
const fmt = (v) => { const d = new Date(v); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`; };
(async () => {
  const q = await pool.query(`SELECT "attendanceTime" FROM attendance_logs
    WHERE "deviceUserId"='97' AND "attendanceTime" BETWEEN '2026-09-10 00:00' AND '2026-10-06 00:00' ORDER BY 1`);
  console.log(`== بصمات userId=97 (حساب Abdalsla) 09-10..10-05 (${q.rowCount}) ==`);
  for (const r of q.rows) console.log(fmt(r.attendanceTime));
  const g = await pool.query(`SELECT "attendanceTime"::date AS d, COUNT(*)::int AS n FROM attendance_logs
    WHERE "deviceUserId"='97' AND "attendanceTime" BETWEEN '2026-09-10 00:00' AND '2026-10-31 00:00' GROUP BY 1 ORDER BY 1`);
  console.log('== توزيعها اليومي =='); console.table(g.rows.map(r=>({d:fmt(r.d),n:r.n})));
  await pool.end();
})().catch(e => { console.log('ERR ' + e.message); process.exit(1); });
