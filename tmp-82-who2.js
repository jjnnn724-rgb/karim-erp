'use strict';
/* قراءة فقط: هل بصمات 09-16..09-21 تحت '82' لعبد السلام فعلًا؟ ومَن توقف بعد 10-02؟ */
const { pool } = require('./backend/shared-pool');
const fmt = (v) => { const d = new Date(v); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };

(async () => {
    const p97 = await pool.query(
        `SELECT "attendanceTime" FROM attendance_logs
          WHERE "deviceUserId" = '97' AND "attendanceTime" BETWEEN '2026-09-14 00:00' AND '2026-09-23 00:00'
          ORDER BY 1`);
    console.log(`== بصمات Abdalsla (userId 97) 09-14..09-22 (${p97.rowCount}) ==`);
    for (const r of p97.rows) console.log(fmt(r.attendanceTime));

    // مَن آخر بصمة له في نافذة 09-28..10-06 ثم صمت؟
    const van = await pool.query(
        `SELECT e."employeeId", e.name, e.status, e."deviceUserId",
                MAX(l."attendanceTime") AS last_punch, COUNT(*)::int AS n
           FROM employees e LEFT JOIN attendance_logs l ON l."employeeId" = e.id
          WHERE e.status = 'active'
          GROUP BY e.id, 1, 2, 3, 4
         HAVING MAX(l."attendanceTime") BETWEEN '2026-09-28 00:00' AND '2026-10-08 23:59'
          ORDER BY last_punch DESC`);
    console.log(`== موظف نشط آخر بصمته بين 09-28 و10-08 (${van.rowCount}) ==`);
    for (const r of van.rows) console.log(`${r.employeeId} ${r.name} id=${r.deviceUserId} آخر=${fmt(r.last_punch)} n=${r.n}`);

    // حضور بلا بصمة مطابقة في النافذة: مَن سجل بوابة/يدويًا 09-23..10-02؟
    const man = await pool.query(
        `SELECT e."employeeId", e.name, a.date, a."checkIn", a."checkOut", a.source
           FROM attendance a JOIN employees e ON e.id = a."employeeId"
          WHERE a.date BETWEEN '2026-09-23' AND '2026-10-02' AND a.source <> 'device'
          ORDER BY e."employeeId", a.date`);
    console.log(`== حضور غير جهازي 09-23..10-02 (${man.rowCount}) ==`);
    console.table(man.rows.slice(0, 40));
    await pool.end();
})().catch((e) => { console.log('ERR ' + e.message); process.exit(1); });
