const { pool } = require('./backend/shared-pool.js');
const { engine } = require('./backend/attendance-engine');

async function reprocessAugust() {
  console.log('🔄 بدء إعادة معالجة أغسطس 2026...\n');
  
  // Run reconcile with 60 days window to cover August
  const result = await engine.reconcileAttendance({ sinceDays: 60 });
  
  console.log('\n✅ نتيجة إعادة المعالجة:');
  console.log('  - سجلات مربوطة:', result.fixedLogs);
  console.log('  - صفوف مصلحة:', result.fixedRows);
  
  // Verify August now
  const r = await pool.query("SELECT COUNT(*) as cnt FROM attendance WHERE date LIKE '2026-08%'");
  console.log('\n📊 أغسطس بعد المعالجة:', r.rows[0].cnt, 'سجل');
  
  // Show sample
  const r2 = await pool.query("SELECT e.name, e.\"employeeId\", a.date, a.\"checkIn\", a.\"checkOut\", a.\"workMinutes\" FROM attendance a JOIN employees e ON e.id = a.\"employeeId\" WHERE a.date LIKE '2026-08%' ORDER BY a.date, e.name LIMIT 20");
  console.log('\n📋 عينة من سجلات أغسطس:');
  r2.rows.forEach(row => console.log(`  ${row.employeeId} | ${row.name} | ${row.date} | ${row.checkIn || '--'} | ${row.checkOut || '--'} | ${row.workMinutes || 0}min`));
  
  pool.end();
  process.exit(0);
}

reprocessAugust().catch(e => {
  console.error('❌ خطأ:', e.message);
  console.error(e.stack);
  process.exit(1);
});