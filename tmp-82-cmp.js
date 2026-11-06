'use strict';
const { pool } = require('./backend/shared-pool');
(async () => {
  for (const no of ['EMP-081', 'EMP-082']) {
    const a = await pool.query(`SELECT a.date, a."checkIn", a."checkOut", a.source, LEFT(a.notes,45) AS notes
      FROM attendance a JOIN employees e ON e.id=a."employeeId"
      WHERE e."employeeId"=$1 AND a.date BETWEEN '2026-08-20' AND '2026-10-12' ORDER BY a.date`, [no]);
    console.log(`== ${no} حضور 08-20..10-12 (${a.rowCount}) ==`);
    for (const r of a.rows) console.log(`${r.date} ${r.checkIn||'—'}/${r.checkOut||'—'} [${r.source}] ${r.notes||''}`);
    const p = await pool.query(`SELECT l."deviceUserId", COUNT(*)::int AS n, MIN(l."attendanceTime")::date f, MAX(l."attendanceTime")::date l2
      FROM attendance_logs l JOIN employees e ON e.id=l."employeeId" WHERE e."employeeId"=$1
      AND l."attendanceTime" BETWEEN '2026-08-20' AND '2026-10-12' GROUP BY 1 ORDER BY n DESC`, [no]);
    console.log(`-- بصمات ${no} في النافذة --`); console.table(p.rows);
  }
  const sh = await pool.query(`SELECT "employeeId", name, shift, shiftStart, shiftEnd, department, status FROM employees
    WHERE "employeeId" IN ('EMP-081','EMP-082','92')`);
  console.log('== المناوبات =='); console.table(sh.rows);
  await pool.end();
})().catch(e => { console.log('ERR ' + e.message); process.exit(1); });
