'use strict';
/* قراءة فقط: التحقق من استعلام /mappings الجديد مقابل القديم على الإنتاج. */
const { pool } = require('./backend/shared-pool');
const fs = require('fs');
const src = fs.readFileSync('backend/zkteco/routes.js', 'utf-8');
const sql = src.match(/WITH agg AS \([\s\S]*?ORDER BY e\.name`/)[0].replace(/`$/, '');

const OLD = `SELECT e.id, (SELECT COUNT(*)::int FROM attendance_logs l
    WHERE l."employeeId" = e.id
      AND l."attendanceTime" >= date_trunc('day', NOW() AT TIME ZONE 'Asia/Riyadh') AT TIME ZONE 'Asia/Riyadh') AS t
    FROM employees e`;

(async () => {
    const t0 = Date.now();
    const nw = await pool.query(sql);
    const tNew = Date.now() - t0;
    const old = await pool.query(OLD);
    const mapNew = new Map(nw.rows.map((r) => [r.id, Number(r.todayPunches)]));
    let diff = 0;
    for (const r of old.rows) {if (mapNew.get(r.id) !== Number(r.t)) {diff += 1;}}
    console.log(`صفوف=${nw.rowCount} · مجموع بصمات اليوم: جديد=${nw.rows.reduce((a, r) => a + Number(r.todayPunches), 0)} قديم=${old.rows.reduce((a, r) => a + Number(r.t), 0)} · صفوف مختلفة=${diff} · زمن=${tNew}ms`);
    const show = nw.rows.filter((r) => ['EMP-052', 'EMP-053', 'EMP-008', 'EMP-059'].includes(r.employeeId));
    console.log(JSON.stringify(show.map((r) => ({
        code: r.employeeId, v: r.deviceUserId, alt: r.deviceUserIdAlt, acct: r.deviceAccountName,
        acctUid: r.deviceUidOfAccount, altOwner: r.altOwnedBy, p30: r.punches30d, today: r.todayPunches,
    })), null, 1));
    console.log(`بدائل يملكها زميل حي = ${nw.rows.filter((r) => r.altOwnedBy).length} · مربوط بلا سجل جهاز = ${nw.rows.filter((r) => r.deviceUserId && !r.deviceUidOfAccount).length}`);
    console.log('أولا 5 بأخطر بديل: ' + nw.rows.filter((r) => r.altOwnedBy).slice(0, 5).map((r) => `${r.employeeId} alt=${r.deviceUserIdAlt}→${r.altOwnedBy}`).join(' | '));
    await pool.end();
})().catch((e) => { console.log('ERR ' + e.message); process.exit(1); });
