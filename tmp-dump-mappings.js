'use strict';
/* قراءة فقط: يصدّر حمولة /zkteco/mappings الحقيقية (بشكلها الجديد) إلى مجلد الـharness. */
const { pool } = require('./backend/shared-pool');
const fs = require('fs');
const src = fs.readFileSync('backend/zkteco/routes.js', 'utf-8');
const sql = src.match(/WITH agg AS \([\s\S]*?ORDER BY e\.name`/)[0].replace(/`$/, '');
const OUT = 'C:/Users/DELL/AppData/Local/Temp/karim-v2-harness/harness-zkmap-data.json';

(async () => {
    const employees = (await pool.query(sql)).rows;
    const unmapped = (await pool.query(
        `SELECT l."deviceId", l."deviceUserId", COUNT(*)::int AS punches, MAX(l."attendanceTime") AS "lastPunch"
           FROM attendance_logs l WHERE l."employeeId" IS NULL
          GROUP BY l."deviceId", l."deviceUserId" ORDER BY punches DESC LIMIT 100`
    )).rows;
    fs.writeFileSync(OUT, JSON.stringify({ employees, unmapped }), 'utf-8');
    console.log(`مكتوب ${OUT}: موظفون=${employees.length} غير مربوط=${unmapped.length} بدائل_خطرة=${employees.filter((r) => r.altOwnedBy).length}`);
    await pool.end();
})().catch((e) => { console.log('ERR ' + e.message); process.exit(1); });
