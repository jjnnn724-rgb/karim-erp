'use strict';
/* قراءة فقط: البديل الصحيح = uid السجل الذي userId فيه = معرف الموظف الأساسي. */
const { pool } = require('./backend/shared-pool');

(async () => {
    const dev = (await pool.query(`SELECT * FROM attendance_devices WHERE enabled = TRUE ORDER BY id LIMIT 1`)).rows[0];
    const roster = (await pool.query(
        `SELECT uid, "userId", name FROM zk_device_users WHERE "deviceId" = $1 ORDER BY uid`, [dev.id]
    )).rows;
    const emps = (await pool.query(
        `SELECT id, "employeeId", name, "deviceUserId", "deviceUserIdAlt", status
           FROM employees WHERE "deviceUserId" IS NOT NULL AND "deviceUserId" <> '' ORDER BY id`
    )).rows;
    const punches = (await pool.query(
        `SELECT "deviceUserId" AS v, count(*) AS c,
                count(*) FILTER (WHERE "employeeId" IS NULL) AS orphan
           FROM attendance_logs GROUP BY 1`
    )).rows;
    const pc = new Map(punches.map((r) => [String(r.v), r]));
    const C = (v) => (v ? (pc.get(String(v)) || {}).c || 0 : 0);

    // فحص الفرضية: هل userId فريد في سجل الجهاز؟
    const dupUserId = {};
    for (const r of roster) {const k = String(r.userId || '').trim(); if (k) {dupUserId[k] = (dupUserId[k] || 0) + 1;}}
    const collided = Object.entries(dupUserId).filter(([, n]) => n > 1);
    console.log(`سجل الجهاز: ${roster.length} سطر · معرّفات userId مكررة: ${collided.length ? JSON.stringify(collided) : 'لا شيء'}`);

    let ok = 0, wrong = 0, noneed = 0, noOwn = 0;
    const fixes = [];
    for (const e of emps) {
        const v = String(e.deviceUserId).trim();
        const own = roster.filter((r) => String(r.userId || '').trim() === v);
        const asUid = roster.filter((r) => String(r.uid) === v);
        const alt = String(e.deviceUserIdAlt || '').trim();
        if (own.length !== 1) {
            noOwn += 1;
            console.log(`بلا سجل وحيد: ${e.employeeId} v=${v} مطابقات(userId)=${own.length} مطابقات(uid)=${asUid.length} alt=${alt || '—'} | ${own.map((r) => `${r.name}/uid=${r.uid}`).join(' , ')}`);
            continue;
        }
        const proven = String(own[0].uid);
        if (proven === v) {noneed += 1; if (alt) {console.log(`بلا حاجة وبديل موجود: ${e.employeeId} v=${v} alt=${alt}`);}}
        else if (alt === proven) {ok += 1;}
        else {
            wrong += 1;
            fixes.push({ emp: e.employeeId, id: e.id, name: e.name, v, alt, proven, devName: own[0].name });
        }
    }
    console.log(`\nمطابق للدليل=${ok} · مخالف=${wrong} · لا يحتاج=${noneed} · بلا سجل وحيد=${noOwn}`);

    console.log('\n=== المخالفين: البديل الحالي لمن؟ وكم بصمة تحته؟ ===');
    const byV = new Map(emps.map((e) => [String(e.deviceUserId).trim(), e]));
    for (const f of fixes) {
        const ownerOfAlt = byV.get(f.alt);
        const ownerOfProven = byV.get(f.proven);
        console.log(
            `${f.emp} id=${f.id} ${f.name} | v=${f.v}(${C(f.v)} بصمة) alt=${f.alt || '—'}` +
            `(بصمات=${C(f.alt)}، يتيمة=${(pc.get(f.alt) || {}).orphan || 0}${ownerOfAlt ? `، أساسيّ لـ${ownerOfAlt.employeeId}` : ''})` +
            ` ⇒ الدليل=${f.proven}(بصمات=${C(f.proven)}${ownerOfProven ? `، أساسيّ لـ${ownerOfProven.employeeId}` : ''}) جهاز:${f.devName}`
        );
    }

    // هل تصل البصمات فعلًا تحت namespace الـ uid؟ (مدى فائدة البديل أصلًا)
    const uidOnly = roster.filter((r) => C(r.uid) > 0 && String(r.uid) !== String(r.userId || '').trim());
    console.log(`\nأسطر سجل where بصمات تحت uid != userId: ${uidOnly.length}`);
    for (const r of uidOnly.slice(0, 12)) {console.log(`  uid=${r.uid} (${C(r.uid)} بصمة) userId=${r.userId} name=${r.name}`);}
    await pool.end();
})().catch((e) => { console.error('FAIL: ' + (e && e.message)); process.exit(1); });
