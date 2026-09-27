const { Pool } = require('pg');
const pool = new Pool({
  user: 'postgres',
  host: '127.0.0.1',
  database: 'karim_erp',
  password: 'Kimo20177',
  port: 5432,
});

(async () => {
  try {
    const attendance = await pool.query(`SELECT id, "employeeId", date, "checkIn", "checkOut", "workMinutes", source FROM attendance WHERE date = '2026-09-23' ORDER BY id LIMIT 20`);
    const logs = await pool.query(`SELECT id, "deviceUserId", "employeeId", "attendanceTime", "punchState" FROM attendance_logs WHERE "attendanceTime" >= '2026-09-23T00:00:00Z' AND "attendanceTime" < '2026-09-24T00:00:00Z' ORDER BY "attendanceTime" LIMIT 20`);
    console.log('ATTENDANCE_2026_09_23', JSON.stringify(attendance.rows, null, 2));
    console.log('LOGS_2026_09_23', JSON.stringify(logs.rows, null, 2));
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
})();
