process.env.ATTENDANCE_SHIFT_DAY_MODE = 'off';

const { AttendanceSyncEngine } = require('./backend/zkteco/engine');
const { pool } = require('./backend/shared-pool');

(async () => {
  const device = {
    id: 1,
    name: 'بصمه العمل',
    ipAddress: '192.168.1.202',
    port: 4370,
    commKey: 0,
    enabled: true,
    syncIntervalSeconds: 30,
  };

  try {
    const engine = new AttendanceSyncEngine();
    const result = await engine.syncDevice(device, { force: true });
    console.log('SYNC_RESULT', JSON.stringify(result, null, 2));

    const count = await pool.query("SELECT COUNT(*)::int AS cnt FROM attendance WHERE date = '2026-09-23'");
    console.log('DAY23_COUNT', JSON.stringify(count.rows[0], null, 2));

    const detail = await pool.query(`SELECT id, "employeeId", date, "checkIn", "checkOut", "workMinutes", source FROM attendance WHERE date = '2026-09-23' ORDER BY id LIMIT 20`);
    console.log('DAY23_ROWS', JSON.stringify(detail.rows, null, 2));
  } catch (err) {
    console.error('SYNC_ERROR', err && err.stack ? err.stack : err);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
