const { pool } = require('./backend/shared-pool.js');
const { engine, calculateTotalLateMinutes, shiftDateFor, prevDay, endInstantOf, isLate, isEarlyLeave, minutesBetween, IN_STATES, OUT_STATES, instantToWall } = require('./backend/attendance-engine');

async function processAugustLogs() {
  console.log('🔄 معالجة سجلات أغسطس 2026 من attendance_logs...\n');
  
  // Get employee mapping
  const mapping = await engine.loadEmployeeMapping();
  const matchNow = (d) => engine.matchUserToEmployee(d, mapping.byDeviceId, mapping.byEmployeeNo).employeeId;
  
  // Get all August logs with employeeId resolved
  const logs = (await pool.query(
    `SELECT l.*, e.id as emp_id, e.shift_start, e.shift_karim, e.auto_checkout, e.auto_lock
     FROM attendance_logs l
     JOIN employees e ON e.id = l."employeeId"
     WHERE l."attendanceTime" >= '2026-08-01' AND l."attendanceTime" < '2026-09-01'
       AND l."employeeId" IS NOT NULL
     ORDER BY l."attendanceTime"`
  )).rows;
  
  console.log(`📥 ${logs.length} سجل للمعالجة`);
  
  // Group by employee and shift date
  const byEmpDate = new Map();
  for (const log of logs) {
    if (!log.employeeId) continue;
    const wall = instantToWall(new Date(log.attendanceTime));
    const shiftDate = shiftDateFor(wall.date, wall.hour);
    const key = `${log.employeeId}|${shiftDate}`;
    if (!byEmpDate.has(key)) byEmpDate.set(key, { logs: [], empId: log.employeeId, shiftDate, shift: null });
    byEmpDate.get(key).logs.push({ ...log, wall });
  }
  
  // Enrich with shift info
  for (const [key, val] of byEmpDate) {
    val.shift = mapping.byId.get(val.empId) || { shiftStart: '09:00', shiftKarim: 10, autoCheckout: false, autoLock: false };
  }
  
  let created = 0, updated = 0;
  
  // Process each employee-day
  for (const [key, val] of byEmpDate) {
    const { empId, shiftDate, logs: dayLogs, shift } = val;
    const sStart = shift?.shiftStart || '09:00';
    const sHours = shift?.shiftKarim || 10;
    const autoCheckout = shift?.autoCheckout === true;
    const autoLock = shift?.autoLock === true;
    
    // Classify logs
    const ins = dayLogs.filter(l => IN_STATES.has(Number(l.punchState))).sort((a, b) => new Date(a.attendanceTime) - new Date(b.attendanceTime));
    const outs = dayLogs.filter(l => OUT_STATES.has(Number(l.punchState))).sort((a, b) => new Date(a.attendanceTime) - new Date(b.attendanceTime));
    
    // Check if attendance row exists
    const existing = await pool.query('SELECT * FROM attendance WHERE "employeeId" = $1 AND date = $2', [empId, shiftDate]);
    let row = existing.rows[0] || null;
    
    if (!row) {
      // Create new row
      const hasIn = ins.length > 0;
      const hasOut = outs.length > 0;
      
      if (hasIn || hasOut) {
        const id = Date.now() * 1000 + Math.floor(Math.random() * 1000);
        const checkIn = hasIn ? ins[0].wall.time : null;
        const checkOut = hasOut ? outs[outs.length - 1].wall.time : null;
        const checkInAt = hasIn ? new Date(ins[0].attendanceTime) : null;
        const checkOutAt = hasOut ? new Date(outs[outs.length - 1].attendanceTime) : null;
        const late = hasIn ? isLate(ins[0].wall.hour, ins[0].wall.minute, sStart, 9) : false;
        const early = hasOut ? isEarlyLeave(outs[outs.length - 1].wall.hour, outs[outs.length - 1].wall.minute, sStart, sHours) : false;
        
        let workMinutes = null;
        if (checkInAt && checkOutAt) {
          workMinutes = Math.max(0, Math.round((checkOutAt - checkInAt) / 60000));
        }
        
        await pool.query(
          `INSERT INTO attendance (id, "employeeId", date, "checkIn", "checkOut", late, early_leave, "checkInAt", "checkOutAt", "workMinutes", source, notes)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'device','من مزامنة أغسطس')`,
          [Date.now() * 1000 + Math.floor(Math.random() * 1000), empId, shiftDate, checkIn, checkOut, late, early, checkInAt, checkOutAt, workMinutes]
        );
        created++;
      }
    } else {
      // Update existing if missing data
      let changed = false;
      const updates = [];
      const params = [row.id];
      let paramIdx = 2;
      
      if (!row.checkIn && ins.length) {
        updates.push(`"checkIn" = $${paramIdx++}`); params.push(ins[0].wall.time);
        updates.push(`"checkInAt" = $${paramIdx++}`); params.push(new Date(ins[0].attendanceTime));
        updates.push(`late = $${paramIdx++}`); params.push(isLate(ins[0].wall.hour, ins[0].wall.minute, sStart, 9));
        updates.push(`checkin_inferred = false`); changed = true;
      }
      if (!row.checkOut && outs.length) {
        updates.push(`"checkOut" = $${paramIdx++}`); params.push(outs[outs.length - 1].wall.time);
        updates.push(`"checkOutAt" = $${paramIdx++}`); params.push(new Date(outs[outs.length - 1].attendanceTime));
        updates.push(`early_leave = $${paramIdx++}`); params.push(isEarlyLeave(outs[outs.length - 1].wall.hour, outs[outs.length - 1].wall.minute, sStart, sHours));
        updates.push(`checkout_inferred = false`); changed = true;
      }
      if (row.workMinutes == null && row.checkInAt && row.checkOutAt) {
        updates.push(`"workMinutes" = $${paramIdx++}`); params.push(minutesBetween(row.checkIn, row.checkOut, shiftDate));
        changed = true;
      }
      
      if (changed) {
        await pool.query(`UPDATE attendance SET ${updates.join(', ')} WHERE id = $1`, params);
        updated++;
      }
    }
  }
  
  console.log(`✅ تم: ${created} صف جديد، ${updated} صف محدث`);
  
  // Verify
  const r = await pool.query("SELECT COUNT(*) as cnt FROM attendance WHERE date LIKE '2026-08%'");
  console.log(`\n📊 أغسطس: ${r.rows[0].cnt} سجل`);
  
  // Stats
  const stats = await pool.query(
    `SELECT COUNT(DISTINCT "employeeId") as emps, COUNT(*) as days, COUNT("checkOut") as complete
     FROM attendance WHERE date LIKE '2026-08-%'`
  );
  console.log(`   موظفون: ${stats.rows[0].emps}, أيام: ${stats.rows[0].days}, مكتملة: ${stats.rows[0].complete}`);
  
  pool.end();
  process.exit(0);
}

processAugustLogs().catch(e => {
  console.error('❌ خطأ:', e.message);
  console.error(e.stack);
  process.exit(1);
});