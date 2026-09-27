const path = require('path');
const { Client } = require('pg');
(async () => {
  const c = new Client({ host: '127.0.0.1', port: 5432, user: 'postgres', password: 'Kimo20177', database: 'karim_erp' });
  await c.connect();
  // sample linked logs after the gap
  const sample = (await c.query(
    "SELECT id, \"deviceUserId\", \"employeeId\", \"attendanceTime\", \"punchState\" FROM attendance_logs WHERE \"attendanceTime\" >= '2026-09-22' AND \"employeeId\" IS NOT NULL LIMIT 3"
  )).rows;
  console.log('samples:', JSON.stringify(sample, null, 1));
  for (const s of sample) {
    const emp = (await c.query('SELECT id, name, shift_start, shift_karim FROM employees WHERE id = $1', [s.employeeId])).rows;
    console.log('employee', s.employeeId, '→ found:', emp.length, emp[0] ? (emp[0].name + ' shift=' + emp[0].shift_start) : '');
  }
  await c.end();

  // now call processPunch directly through the attendance engine (same code path as the sync)
  const { AttendanceEngine } = require(path.resolve(__dirname, '../../../backend/attendance-engine.js'));
  const eng = new AttendanceEngine({ io: null });
  const s0 = sample[0];
  if (s0) {
    try {
      const r = await eng.processPunch({
        employeeId: s0.employeeId,
        punchState: s0.punchState,
        instant: new Date(s0.attendanceTime),
        wall: null,
        device: { id: 1, name: 'بصمه العمل' },
        source: 'device',
      });
      console.log('processPunch result:', JSON.stringify(r).slice(0, 300));
    } catch (e) {
      console.log('processPunch THREW:', e.message);
      console.log(e.stack.split('\n').slice(1, 4).join('\n'));
    }
  }
  process.exit(0);
})().catch(e => { console.error('ERR:', e.message); process.exit(1); });
