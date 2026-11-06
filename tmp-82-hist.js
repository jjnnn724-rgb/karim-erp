'use strict';
const { pool } = require('./backend/shared-pool');
const fmt = (v) => (v instanceof Date ? v.toISOString().slice(0,19).replace('T',' ') : String(v));
(async () => {
  const c = await pool.query(`SELECT column_name, data_type FROM information_schema.columns WHERE table_name='attendance_logs' ORDER BY ordinal_position`);
  console.log('== أعمدة attendance_logs =='); console.table(c.rows);
  const t = await pool.query(`SELECT table_name FROM information_schema.tables WHERE table_schema='public'
    AND (table_name ILIKE '%hist%' OR table_name ILIKE '%log%' OR table_name ILIKE '%audit%' OR table_name ILIKE '%device%') ORDER BY 1`);
  console.log('== جداول历史记录 =='); console.log(t.rows.map(r=>r.table_name).join(' · '));
  const s = await pool.query(`SELECT "attendanceTime", "employeeId", "deviceId", * FROM attendance_logs
    WHERE "deviceUserId"='82' ORDER BY "attendanceTime" LIMIT 2`);
  console.log('== عينة كاملة لسطرين تحت 82 =='); console.log(JSON.stringify(s.rows, null, 1));
  await pool.end();
})().catch(e => { console.log('ERR ' + e.message); process.exit(1); });
