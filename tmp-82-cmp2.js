'use strict';
const { pool } = require('./backend/shared-pool');
const fmt = (v) => { const d = new Date(v); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`; };
(async () => {
  const q = await pool.query(`SELECT "attendanceTime" FROM attendance_logs
    WHERE "deviceUserId"='96' AND "attendanceTime" BETWEEN '2026-09-05 00:00' AND '2026-10-10 00:00' ORDER BY 1`);
  console.log(`== بصمات userId=96 (عارف) 09-05..10-09 (${q.rowCount}) ==`);
  for (const r of q.rows) console.log(fmt(r.attendanceTime));
  const orph = await pool.query(`SELECT "attendanceTime" FROM attendance_logs
    WHERE "deviceUserId"='82' AND "attendanceTime" BETWEEN '2026-09-05 00:00' AND '2026-10-10 00:00' ORDER BY 1`);
  console.log(`== بصمات userId=82 في النافذة نفسها (${orph.rowCount}) ==`);
  const merged = new Map();
  for (const r of q.rows) { const k = fmt(r.attendanceTime).slice(0,10); (merged[k] ||= []).push('96 ' + fmt(r.attendanceTime).slice(11)); }
  for (const r of orph.rows) { const k = fmt(r.attendanceTime).slice(0,10); (merged[k] ||= []).push('82 ' + fmt(r.attendanceTime).slice(11)); }
  console.log('== بالأيام (96 مقابل 82) ==');
  for (const k of [...merged.keys()].sort()) console.log(k + ' | ' + merged[k].sort().join('  '));
  await pool.end();
})().catch(e => { console.log('ERR ' + e.message); process.exit(1); });
