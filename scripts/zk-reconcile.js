'use strict';
const { pool } = require('../backend/shared-pool');
const { AttendanceEngine } = require('../backend/attendance-engine');

(async () => {
    const eng = new AttendanceEngine();
    const r = await eng.reconcileAttendance({ sinceDays: 12 });
    console.log('RECONCILE=' + JSON.stringify(r).slice(0, 800));
    await pool.end();
    process.exit(0);
})().catch((e) => { console.error('FAIL:' + (e && e.message)); process.exit(1); });
