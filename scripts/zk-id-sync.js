'use strict';
/* zk-id-sync.js — مزامنة معرفي البصمة (uid + userId) لكل موظف + إصلاح السجلات اليتيمة.
 * جهاز ZKTeco يرسل أحيانًا uid وأحيانًا userId لنفس الشخص — العمود البديل يمنع ضياع أي بصمة.
 * يُشغَّل يدويًا بعد أي تسجيل بصمة جديدة، وضمن الفحص اليومي. */
const { pool } = require('../backend/shared-pool');
const { attendanceEngine } = require('../backend/zkteco');

(async () => {
    const dev = (await pool.query(`SELECT * FROM attendance_devices WHERE enabled = TRUE ORDER BY id LIMIT 1`)).rows[0];
    if (!dev) { throw new Error('no enabled device'); }
    const probe = await attendanceEngine.probeDevice(dev);
    const pairs = probe.users || [];
    const byUid = new Map(pairs.map((u) => [String(u.uid), u]));
    const byUserId = new Map(pairs.map((u) => [String(u.userId), u]));
    const emp = (await pool.query(`SELECT id, name, "deviceUserId", "deviceUserIdAlt" FROM employees WHERE "deviceUserId" IS NOT NULL AND "deviceUserId" <> ''`)).rows;
    let altSet = 0, repaired = 0;
    for (const e of emp) {
        const v = String(e.deviceUserId).trim();
        // الاسم الحقيقي يغلب «NN-رقم» (تسجيل بلا اسم) عند التضارب بين uid وuserId
        const isPlaceholder = (n) => /^NN-\d+$/i.test(String(n || '').trim());
        const uByUid = byUid.get(v);
        const uByUserId = byUserId.get(v);
        let alt = null;
        if (uByUid && uByUserId && uByUid.uid !== uByUserId.uid) {
            const pick = !isPlaceholder(uByUserId.name) && isPlaceholder(uByUid.name) ? uByUserId
                : !isPlaceholder(uByUid.name) && isPlaceholder(uByUserId.name) ? uByUid : null;
            if (!pick) {
                if (!e.deviceUserIdAlt) { console.log(`AMBIGUOUS emp=${e.id} ${e.name} linkedAs=${v} — manual review`); }
            }
            else if (String(pick.uid) !== v) { alt = String(pick.uid); }
            else if (String(pick.userId) !== v) { alt = String(pick.userId); }
        }
        else if (uByUid && String(uByUid.userId) !== v) { alt = String(uByUid.userId); }
        else if (uByUserId && String(uByUserId.uid) !== v) { alt = String(uByUserId.uid); }
        if (alt && alt !== String(e.deviceUserIdAlt || '')) {
            await pool.query(`UPDATE employees SET "deviceUserIdAlt" = $2 WHERE id = $1`, [e.id, alt]);
            altSet++;
        }
        // إصلاح بصمات يتيمة (آخر 30 يوم) تطابق الأساسي أو البديل
        const ids = alt ? [v, alt] : [v];
        const r = await pool.query(
            `UPDATE attendance_logs SET "employeeId" = $1 WHERE "employeeId" IS NULL
             AND "deviceUserId" = ANY($2) AND "attendanceTime" >= NOW() - INTERVAL '30 days'`,
            [e.id, ids]
        );
        repaired += r.rowCount || 0;
    }
    // بصمات يتيمة باقية (معرف غير مربوط بأي موظف) — للمراجعة
    const left = (await pool.query(`SELECT "deviceUserId", count(*) AS c FROM attendance_logs WHERE "employeeId" IS NULL AND "attendanceTime" >= NOW() - INTERVAL '7 days' GROUP BY 1 ORDER BY 2 DESC LIMIT 10`)).rows;
    console.log(JSON.stringify({ deviceUsers: pairs.length, employees: emp.length, altSet, repaired, stillOrphan: left }));
    await pool.end();
    process.exit(0);
})().catch((e) => { console.error('FAIL:' + (e && e.message)); process.exit(1); });
