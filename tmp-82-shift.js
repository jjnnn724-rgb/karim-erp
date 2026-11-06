'use strict';
/* قراءة فقط: مطابقة نمط 14:00→02:00 تحت الرقم 82 بصفوف حضور حقيقية. */
const { pool } = require('./backend/shared-pool');

(async () => {
    const shift = await pool.query(
        `SELECT e."employeeId", e.name, e.status, a.date, a."checkIn" AS in_t, a."checkOut" AS out_t,
                a.source, LEFT(a.notes, 70) AS notes, a.checkin_inferred AS ci, a.checkout_inferred AS co
           FROM attendance a
           JOIN employees e ON e.id = a."employeeId"
          WHERE a.date BETWEEN '2026-09-22' AND '2026-10-03'
            AND (LEFT(a."checkIn", 2) IN ('13','14') OR LEFT(a."checkOut", 2) IN ('01','02'))
          ORDER BY e."employeeId", a.date`);
    console.log(`== حضور: دخول ~14:00 أو خروج ~02:00 (${shift.rowCount}) ==`);
    console.table(shift.rows);

    const pat = await pool.query(
        `SELECT l."deviceUserId", COALESCE(e."employeeId", '— يتيمة —') AS emp,
                COUNT(*)::int AS n,
                COUNT(*) FILTER (WHERE TO_CHAR(l."attendanceTime",'HH24') IN ('13','14'))::int AS at14,
                COUNT(*) FILTER (WHERE TO_CHAR(l."attendanceTime",'HH24') IN ('01','02'))::int AS at02
           FROM attendance_logs l
           LEFT JOIN employees e ON e.id = l."employeeId"
          WHERE l."attendanceTime" BETWEEN TIMESTAMP '2026-09-22 12:00' AND TIMESTAMP '2026-10-03 12:00'
          GROUP BY 1, 2
         HAVING COUNT(*) FILTER (WHERE TO_CHAR(l."attendanceTime",'HH24') IN ('13','14','01','02')) >= 4
          ORDER BY at14 DESC, at02 DESC LIMIT 20`);
    console.log('== تكرار البصمات عند 13–14 أو 01–02 ==');
    console.table(pat.rows);
    await pool.end();
})().catch((e) => { console.log('ERR ' + e.message); process.exit(1); });
