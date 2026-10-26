const { pool } = require('./backend/shared-pool.js');
const { AttendanceSyncEngine } = require('./backend/zkteco/engine');
const { shiftDateFor, prevDay } = require('./backend/shift-day');

async function forceSyncAugust() {
  console.log('🔄 تشغيل مزامنة قسرية لأغسطس 2026...\n');
  
  const syncEngine = new AttendanceSyncEngine();
  
  // Get the device
  const { rows: devices } = await pool.query('SELECT * FROM attendance_devices WHERE enabled = true');
  if (!devices.length) {
    console.log('❌ لا توجد أجهزة مفعلة');
    process.exit(1);
  }
  
  const device = devices[0];
  console.log('📟 الجهاز:', device.name, device.ipAddress);
  
  // Temporarily move checkpoint back to before August
  console.log('\n⏪ تحريك نقطة التفتيش لبداية أغسطس...');
  await pool.query(
    `UPDATE device_sync_state SET "lastRecordTime" = $1 WHERE "deviceId" = $2`,
    ['2026-08-01T00:00:00Z', device.id]
  );
  
  // Also need to clear attendance for August to avoid duplicates
  console.log('🧹 تنظيف سجلات أغسطس الحالية...');
  await pool.query(`DELETE FROM attendance WHERE date LIKE '2026-08-%'`);
  
  // Run sync for this device
  console.log('\n🔄 تشغيل المزامنة...');
  const result = await syncEngine.syncDevice(device, { force: true });
  
  console.log('\n✅ نتيجة المزامنة:');
  console.log('  - مقروء:', result.read);
  console.log('  - جديد:', result.inserted);
  console.log('  - حضور مكتوب:', result.writeBacks);
  
  // Verify
  const r = await pool.query("SELECT COUNT(*) as cnt FROM attendance WHERE date LIKE '2026-08%'");
  console.log('\n📊 أغسطس بعد المزامنة:', r.rows[0].cnt, 'سجل');
  
  // Show stats
  const r2 = await pool.query(
    `SELECT e.name, e."employeeId", COUNT(a.id) as days, COUNT(a."checkOut") as complete
     FROM employees e LEFT JOIN attendance a ON a."employeeId" = e.id AND a.date LIKE '2026-08-%'
     WHERE e.status = 'active'
     GROUP BY e.id HAVING COUNT(a.id) > 0
     ORDER BY days DESC LIMIT 20`
  );
  console.log('\n📋 أعلى الموظفين حضوراً في أغسطس:');
  r2.rows.forEach(row => console.log(`  ${row.employeeId} | ${row.name} | ${row.days} يوم | ${row.complete} مكتمل`));
  
  pool.end();
  process.exit(0);
}

forceSyncAugust().catch(e => {
  console.error('❌ خطأ:', e.message);
  console.error(e.stack);
  process.exit(1);
});