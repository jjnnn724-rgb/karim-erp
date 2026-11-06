'use strict';
const { pool } = require('./backend/shared-pool');
const f = (v) => (v instanceof Date ? v.toISOString().slice(0,19) : String(v));
(async () => {
  const q = await pool.query(`SELECT "deviceUserId", "employeeId" IS NOT NULL AS mapped, "syncedAt", COUNT(*)::int AS n,
      MIN("attendanceTime") AS a, MAX("attendanceTime") AS b
    FROM attendance_logs WHERE "deviceUserId" IN ('82','96','97','98')
      AND "attendanceTime" BETWEEN '2026-08-01' AND '2026-11-03'
    GROUP BY 1,2,3 ORDER BY 1,3`);
  console.log('== دفعات السحب حسب الرقم ==');
  for (const r of q.rows) console.log(`${r.deviceUserId} ${r.mapped?'مربوط':'يتيمة'} synced=${f(r["syncedAt"])} n=${r.n} من ${f(r.a)} إلى ${f(r.b)}`);

  const sh = await pool.query(`SELECT column_name FROM information_schema.columns WHERE table_name='employee_shift_history' ORDER BY ordinal_position`);
  console.log('== أعمدة employee_shift_history =='); console.log(sh.rows.map(r=>r.column_name).join(', '));
  const shq = await pool.query(`SELECT * FROM employee_shift_history ORDER BY 1 DESC LIMIT 10`);
  console.log(JSON.stringify(shq.rows, null, 1).slice(0, 1500));

  const ed = await pool.query(`SELECT column_name FROM information_schema.columns WHERE table_name='attendance_edit_log' ORDER BY ordinal_position`);
  console.log('== أعمدة attendance_edit_log =='); console.log(ed.rows.map(r=>r.column_name).join(', '));
  const edq = await pool.query(`SELECT * FROM attendance_edit_log WHERE "createdAt" >= '2026-09-01' ORDER BY "createdAt" LIMIT 15`);
  console.log('== عينات تعديل =='); console.log(JSON.stringify(edq.rows, null, 1).slice(0, 2000));
  await pool.end();
})().catch(e => { console.log('ERR ' + e.message); process.exit(1); });
