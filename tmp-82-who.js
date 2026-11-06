'use strict';
/* قراءة فقط: من يملك بصمات userId '82'؟ مطابقة دقيقة بصفوف الحضور. */
const { pool } = require('./backend/shared-pool');

(async () => {
    const T = (v) => (v instanceof Date ? v : new Date(String(v)));
    const fmt = (v) => { const d = T(v); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };

    const raw = await pool.query(
        `SELECT l."attendanceTime", l."employeeId" IS NOT NULL AS mapped, e."employeeId" AS emp
           FROM attendance_logs l LEFT JOIN employees e ON e.id = l."employeeId"
          WHERE l."deviceUserId" = '82' ORDER BY 1`);
    console.log('== كل بصمات userId=82 (29) ==');
    for (const r of raw.rows) console.log(`${fmt(r.attendanceTime)}  ${r.mapped ? '→ ' + r.emp : '→ يتيمة'}`);

    for (const no of ['EMP-082', '92']) {
        const p = await pool.query(
            `SELECT l."deviceUserId", COUNT(*)::int AS n, MIN(l."attendanceTime")::date AS f, MAX(l."attendanceTime")::date AS l
               FROM attendance_logs l JOIN employees e ON e.id = l."employeeId"
              WHERE e."employeeId" = $1 GROUP BY 1 ORDER BY n DESC`, [no]);
        console.log(`== بصمات ${no} حسب deviceUserId ==`);
        console.table(p.rows.map((r) => ({ id: r.deviceUserId, n: r.n, from: fmt(r.f), to: fmt(r.l) })));
        const a = await pool.query(
            `SELECT a.date, a."checkIn", a."checkOut", a.source, a.notes
               FROM attendance a JOIN employees e ON e.id = a."employeeId"
              WHERE e."employeeId" = $1 AND a.date BETWEEN '2026-09-14' AND '2026-10-03' ORDER BY a.date`, [no]);
        console.log(`== حضور ${no} 09-14..10-03 (${a.rowCount}) ==`);
        for (const r of a.rows) console.log(`${r.date} ${r.checkIn || '—'}/${r.checkOut || '—'} [${r.source}] ${String(r.notes || '').slice(0, 55)}`);
    }

    const acc = await pool.query(
        `SELECT d.uid, d."userId", d.name, d.punches::int AS n, d."lastSeenAt"
           FROM zk_device_users d
          WHERE d."userId" IN ('82','96','97','98','185') OR d.uid IN (82,96,97,98,185)
          ORDER BY d.uid`);
    console.log('== حسابات الجهاز ==');
    console.table(acc.rows);
    await pool.end();
})().catch((e) => { console.log('ERR ' + e.message); process.exit(1); });
