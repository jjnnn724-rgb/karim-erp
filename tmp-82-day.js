'use strict';
const { pool } = require('./backend/shared-pool');
const fmt = (v) => { const d = new Date(v); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
(async () => {
  const d = await pool.query(`SELECT "attendanceTime"::date AS day, COUNT(*)::int AS n,
       COUNT(*) FILTER (WHERE "employeeId" IS NULL)::int AS orphan,
       COUNT(DISTINCT "deviceUserId")::int AS ids
    FROM attendance_logs WHERE "attendanceTime" >= '2026-09-15 00:00'
    GROUP BY 1 ORDER BY 1`);
  console.log('== حجم البصمات اليومي (كل الجهاز) ==');
  console.table(d.rows.map(r => ({ day: fmt(r.day), n: r.n, orphan: r.orphan, ids: r.ids })));
  const e82 = await pool.query(`SELECT a.date, a."checkIn", a."checkOut", a.source FROM attendance a
    JOIN employees e ON e.id=a."employeeId" WHERE e."employeeId"='EMP-082' AND a.date>='2026-09-01' ORDER BY a.date`);
  console.log(`== حضور EMP-082 منذ 09-01 (${e82.rowCount}) ==`);
  console.table(e82.rows);
  await pool.end();
})().catch(e => { console.log('ERR ' + e.message); process.exit(1); });
