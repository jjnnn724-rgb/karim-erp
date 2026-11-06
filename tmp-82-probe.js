'use strict';
/* قراءة فقط: مَن يملك بصمات deviceUserId='82'؟ */
const { pool } = require('./backend/shared-pool');

(async () => {
    const orph = await pool.query(
        `SELECT l."attendanceTime"::date AS d,
                TO_CHAR(MIN(l."attendanceTime"), 'HH24:MI') AS first_t,
                TO_CHAR(MAX(l."attendanceTime"), 'HH24:MI') AS last_t,
                COUNT(*)::int AS n
           FROM attendance_logs l
          WHERE l."deviceUserId" = '82' AND l."employeeId" IS NULL
          GROUP BY 1 ORDER BY 1`);
    console.log('== اليتيمة تحت 82 (يوم/أول/آخر/عدد) ==');
    console.table(orph.rows);

    const owns = await pool.query(
        `SELECT "employeeId", name, status, "deviceUserId", "deviceUserIdAlt"
           FROM employees
          WHERE "deviceUserId" IN ('82','185','97','98') OR "deviceUserIdAlt" IN ('82','185','97','98')
          ORDER BY "employeeId"`);
    console.log('== من يملك 82/185/97/98 الآن ==');
    console.table(owns.rows);

    const dev = await pool.query(
        `SELECT d."deviceId", d.uid, d."userId", d.name, d.enabled
           FROM zk_device_users d
          WHERE d."userId" IN ('82','185') OR d.uid::text IN ('82','185','97','98')
          ORDER BY d."deviceId", d.uid`);
    console.log('== حسابات الجهاز ذات الصلة ==');
    console.table(dev.rows);

    const cmp = await pool.query(
        `SELECT l."deviceUserId", (l."employeeId" IS NOT NULL) AS mapped, COUNT(*)::int AS n,
                MIN(l."attendanceTime")::date AS first_day, MAX(l."attendanceTime")::date AS last_day,
                string_agg(DISTINCT TO_CHAR(l."attendanceTime", 'HH24'), ',') AS hours
           FROM attendance_logs l
          WHERE l."deviceUserId" IN ('82','97','98','185')
          GROUP BY 1, 2 ORDER BY 1, 2 DESC`);
    console.log('== مقارنة أنماط الأرقام ==');
    console.table(cmp.rows);

    const tables = await pool.query(
        `SELECT table_name FROM information_schema.tables
          WHERE table_schema='public' AND (table_name ILIKE '%edit%' OR table_name ILIKE '%audit%'
             OR table_name ILIKE '%mapping%' OR table_name ILIKE '%history%' OR table_name ILIKE '%change%')
          ORDER BY 1`);
    console.log('== جداول محتملة لتاريخ الملكية ==');
    console.log(tables.rows.map((r) => r.table_name).join(' · '));

    await pool.end();
})().catch((e) => { console.log('ERR ' + e.message); process.exit(1); });
