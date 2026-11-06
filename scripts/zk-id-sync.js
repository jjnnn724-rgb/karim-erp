'use strict';
/* zk-id-sync.js — مزامنة معرفي البصمة (uid + userId) لكل موظف + إصلاح السجلات اليتيمة.
 *
 * قاعدة العمل (أُثبتت من البيانات الحيّة 2026-11-02):
 *   حسابُ الموظف على الجهاز = السطر الذي `userId` منه هو معرّفُه الأساسي.
 *   التيّارُ القادم من الجهاز يحمل userId دائمًا، لا uid — دليل: 30 قيمة uid
 *   لا يملكها أيُّ موظفٍ كمعرّفٍ أساسي وصلت تحتها 0 بصمة من أصل 55,989.
 *
 * لذلك البديلُ (deviceUserIdAlt) لا يُكتب إلا إذا كان:
 *   1. uid سجلّ الموظف نفسه (لا رقم جارٍ)، و
 *   2. غيرَ مملوكٍ معرّفًا أساسيًّا لموظفٍ آخر حيّ على نفس الجهاز.
 * والشرطُ الثاني هو الإصلاح الجذري: الجهازُ أعاد الترقيم فجعل uid كلِّ موظفٍ
 * ≈ userId جاره، فالبديلُ «المُشتقَّ بالاسم» كان يطابق رقم زميلٍ حيّ، وأيُّ
 * بصمةٍ يتيمةٍ تحت ذلك الرقم تُختم باسم الخطأ في ترقيع هذا السكربت نفسه.
 * فالسكربتُ الآن يُفرِغ البدائلَ الخطِرة بدل أن يكتبها.
 *
 * يُشغَّل يدويًا بعد أي تسجيل بصمة جديدة، وضمن الفحص اليومي. */
const { pool } = require('../backend/shared-pool');
const { attendanceEngine } = require('../backend/zkteco');

(async () => {
    const dev = (await pool.query(`SELECT * FROM attendance_devices WHERE enabled = TRUE ORDER BY id LIMIT 1`)).rows[0];
    if (!dev) { throw new Error('no enabled device'); }
    const probe = await attendanceEngine.probeDevice(dev);
    const pairs = probe.users || [];
    const emp = (await pool.query(`SELECT id, name, "deviceUserId", "deviceUserIdAlt" FROM employees WHERE "deviceUserId" IS NOT NULL AND "deviceUserId" <> ''`)).rows;

    // من يملك كلَّ معرّف أساسي؟ (إن شاركه موظّفان فالبديلُ والترقيعُ كلاهما محظور)
    const primaryOwners = new Map();
    for (const e of emp) {
        const k = String(e.deviceUserId).trim();
        if (!primaryOwners.has(k)) {primaryOwners.set(k, []);}
        primaryOwners.get(k).push(e.id);
    }

    let altSet = 0, altCleared = 0, repaired = 0;
    const ambiguous = [];
    for (const e of emp) {
        const v = String(e.deviceUserId).trim();
        const stored = String(e.deviceUserIdAlt || '').trim();
        const ownRows = pairs.filter((u) => String(u.userId == null ? '' : u.userId).trim() === v);

        let safeAlt = '';
        if (ownRows.length > 1) {
            ambiguous.push({ emp: e.id, name: e.name, linkedAs: v, why: 'multiple device rows for this userId' });
        } else if (ownRows.length === 1) {
            const uid = String(ownRows[0].uid).trim();
            const owners = primaryOwners.get(uid) || [];
            if (uid !== v && !owners.some((id) => id !== e.id)) {safeAlt = uid;}
            else if (uid !== v && owners.some((id) => id !== e.id)) {
                ambiguous.push({ emp: e.id, name: e.name, linkedAs: v, why: `uid ${uid} is another employee's primary` });
            }
        } else {
            ambiguous.push({ emp: e.id, name: e.name, linkedAs: v, why: 'no device row with this userId' });
        }

        // البدائل القديمة المكتوبة بقاعدة «الاسم يغلب NN-» كانت تنسب رقم الجار؛
        // تُفرَغ هنا فلا يبقىclaimٌ على بصمات زميلٍ حيّ.
        if (safeAlt !== stored) {
            await pool.query(
                `UPDATE employees SET "deviceUserIdAlt" = NULLIF($2, '') WHERE id = $1`,
                [e.id, safeAlt]
            );
            if (safeAlt) {altSet += 1;} else {altCleared += 1;}
        }

        // ترقيع البصمات اليتيمة (آخر 30 يوم) — بالمعرّف الأساسي وبالبديل الآمن فقط
        if ((primaryOwners.get(v) || []).length > 1) {
            ambiguous.push({ emp: e.id, name: e.name, linkedAs: v, why: 'primary shared by 2+ employees — orphan repair skipped' });
            continue;
        }
        const ids = safeAlt ? [v, safeAlt] : [v];
        const r = await pool.query(
            `UPDATE attendance_logs SET "employeeId" = $1 WHERE "employeeId" IS NULL
             AND "deviceUserId" = ANY($2) AND "attendanceTime" >= NOW() - INTERVAL '30 days'`,
            [e.id, ids]
        );
        repaired += r.rowCount || 0;
    }
    // بصمات يتيمة باقية (معرف غير مربوط بأي موظف) — للمراجعة
    const left = (await pool.query(`SELECT "deviceUserId", count(*) AS c FROM attendance_logs WHERE "employeeId" IS NULL AND "attendanceTime" >= NOW() - INTERVAL '7 days' GROUP BY 1 ORDER BY 2 DESC LIMIT 10`)).rows;
    console.log(JSON.stringify({ deviceUsers: pairs.length, employees: emp.length, altSet, altCleared, repaired, stillOrphan: left, ambiguous: ambiguous.slice(0, 20), ambiguousCount: ambiguous.length }));
    await pool.end();
    process.exit(0);
})().catch((e) => { console.error('FAIL:' + (e && e.message)); process.exit(1); });
