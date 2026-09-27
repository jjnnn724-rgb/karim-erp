const { Client } = require('pg');
(async () => {
  const c = new Client({ host: '127.0.0.1', port: 5432, user: 'postgres', password: 'Kimo20177', database: 'karim_erp' });
  await c.connect();
  const before = (await c.query('SELECT count(*)::int n FROM attendance_logs')).rows[0].n;
  // delete: punches after Sep 21 (the unmapped-era gap) + any never-linked punches
  const d = await c.query("DELETE FROM attendance_logs WHERE \"attendanceTime\" >= '2026-09-22' OR \"employeeId\" IS NULL");
  console.log('raw punches deleted:', d.rowCount, '(was', before + ')');
  // reset the device sync bookmark to just before the gap so the engine re-reads them
  await c.query("UPDATE device_sync_state SET \"lastRecordTime\"='2026-09-21T23:59:00.000Z', \"totalRead\"=0, \"totalNew\"=0 WHERE \"deviceId\"=1");
  console.log('device_sync_state bookmark reset to 2026-09-21T23:59');
  await c.end();
})().catch(e => { console.error('ERR:', e.message); process.exit(1); });
