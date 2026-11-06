'use strict';
/* قراءة فقط: أيِّ namespace يرسله الجهاز فعلًا؟ uid خالص (ليس أساسيًّا لأحد) هل تحته بصمات؟ */
const { pool } = require('./backend/shared-pool');

(async () => {
    const dev = (await pool.query(`SELECT * FROM attendance_devices WHERE enabled = TRUE ORDER BY id LIMIT 1`)).rows[0];
    const devices = (await pool.query(`SELECT id, name, enabled FROM attendance_devices ORDER BY id`)).rows;
    console.log('الأجهزة: ' + JSON.stringify(devices));

    const roster = (await pool.query(
        `SELECT uid, "userId", name FROM zk_device_users WHERE "deviceId" = $1`, [dev.id]
    )).rows;
    const emps = (await pool.query(
        `SELECT id, "employeeId", name, "deviceUserId", "deviceUserIdAlt"
           FROM employees WHERE "deviceUserId" IS NOT NULL AND "deviceUserId" <> ''`
    )).rows;
    const primary = new Set(emps.map((e) => String(e.deviceUserId).trim()));
    const primaryOwner = new Map(emps.map((e) => [String(e.deviceUserId).trim(), e.employeeId]));

    // كل قيمة معرف عليها بصمات + كم منها نُسبت لموظف + لمن نُسبت غالبًا
    const p = (await pool.query(
        `SELECT "deviceUserId" AS v, count(*) c, count("employeeId") matched
           FROM attendance_logs GROUP BY 1`
    )).rows;
    const info = new Map(p.map((r) => [String(r.v), r]));

    // القيم التي هي uid عند شخصٍ ولیست userId عند أحد في السجل ولا أساسیّة لموظف
    const userIdsInRoster = new Set(roster.map((r) => String(r.userId || '').trim()));
    const uidPure = [];
    const uidShared = [];
    for (const r of roster) {
        const u = String(r.uid);
        if (u === String(r.userId || '').trim()) {continue;}
        const rec = info.get(u) || {c: 0, matched: 0};
        const asUserId = userIdsInRoster.has(u);
        const asPrimary = primary.has(u);
        (asUserId || asPrimary ? uidShared : uidPure).push({u, name: r.name, c: Number(rec.c), matched: Number(rec.matched), owner: primaryOwner.get(u) || '—', asUserId});
    }
    const pureWithPunch = uidPure.filter((x) => x.c > 0);
    console.log(`\nقيَم uid لا يملكها أحد كمعرّف أساسي/userId في السجل: ${uidPure.length} — عليها بصمات: ${pureWithPunch.length}`);
    for (const x of pureWithPunch.slice(0, 20)) {console.log(`  uid=${x.u} (${x.name}) بصمات=${x.c} نُسبت=${x.matched}`);}
    console.log(`\nقيَم uid مشتركة (تشبه معرّف جارٍ): ${uidShared.length}`);
    const ex = uidShared.filter((x) => x.c > 0).slice(0, 8);
    for (const x of ex) {console.log(`  uid=${x.u} (${x.name}) بصمات=${x.c} نُسبت=${x.matched} أساسيّة لـ${x.owner}`);}

    // الدليل الحاسم: بصمات تحت uid الموظف نفسه حين لا يكون أساسيًا لأحد (مقارنة بالشift)
    const q = await pool.query(
        `SELECT count(*) FILTER (WHERE "employeeId" IS NULL) AS orphan, count(*) AS total
           FROM attendance_logs`
    );
    console.log(`\nإجمالي البصمات الخام: ${q.rows[0].total} · يتيمة (بلا موظف): ${q.rows[0].orphan}`);

    // هل لموظّفَين بصمات تحت نفس القيمة؟ (لا، القيد يمنع) — بديل: توزيع قيم alt الحالي
    const altVals = emps.filter((e) => e.deviceUserIdAlt).map((e) => String(e.deviceUserIdAlt).trim());
    const claimedByPrimary = altVals.filter((v) => primary.has(v)).length;
    const altIsOwnUid = altVals.filter((v) => {
        const e = emps.find((x) => String(x.deviceUserIdAlt || '').trim() === v);
        return e && roster.some((r) => String(r.uid) === v && String(r.userId || '').trim() === String(e.deviceUserId).trim());
    }).length;
    console.log(`\nالبدائل المضبوطة: ${altVals.length} · منها يساوي معرّفًا أساسيًّا لموظف آخر: ${claimedByPrimary} · منها يساوي uid سجلّ صاحبها: ${altIsOwnUid}`);
    await pool.end();
})().catch((e) => { console.error('FAIL: ' + (e && e.message)); process.exit(1); });
