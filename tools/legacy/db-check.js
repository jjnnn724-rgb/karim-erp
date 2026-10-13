const { Pool } = require('pg');
require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });
const pool = new Pool({
  user: process.env.DB_USER || 'postgres',
  host: process.env.DB_HOST || '127.0.0.1',
  database: process.env.DB_NAME || 'karim_erp',
  password: process.env.DB_PASSWORD,
  port: Number(process.env.DB_PORT) || 5432,
});
if (!pool.options.password) { console.error('DB_PASSWORD missing in .env'); process.exit(1); }

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
