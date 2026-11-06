'use strict';
/* قراءة فقط: تصنيف كل بديل معرف بصمة (deviceUserIdAlt) بالدليل من سجل الجهاز. */
const { pool } = require('./backend/shared-pool');

const norm = (s) => String(s || '').replace(/[^\p{L}\p{N}]+/gu, '').trim().toLowerCase();

(async () => {
    const dev = (await pool.query(`SELECT * FROM attendance_devices WHERE enabled = TRUE ORDER BY id LIMIT 1`)).rows[0];
    const roster = (await pool.query(
        `SELECT uid, "userId", name FROM zk_device_users WHERE "deviceId" = $1`, [dev.id]
    )).rows;
    const emps = (await pool.query(
        `SELECT id, "employeeId", name, "deviceUserId", "deviceUserIdAlt", status
           FROM employees WHERE "deviceUserId" IS NOT NULL AND "deviceUserId" <> '' ORDER BY id`
    )).rows;

    const byUid = new Map();
    const byUserId = new Map();
    for (const r of roster) {
        const u = String(r.uid), x = String(r.userId || '').trim();
        if (!byUid.has(u)) {byUid.set(u, []);}
        byUid.get(u).push(r);
        if (x && !byUserId.has(x)) {byUserId.set(x, []);}
        if (x) {byUserId.get(x).push(r);}
    }

    // أي قيم معرفات تحمل بصمات خام فعليًا، ولمن نُسبت؟
    const punchCounts = (await pool.query(
        `SELECT "deviceUserId" AS v, count(*) c,
                count(*) FILTER (WHERE "employeeId" IS NULL) AS orphan
           FROM attendance_logs GROUP BY 1`
    )).rows;
    const pcount = new Map(punchCounts.map((r) => [String(r.v), r]));

    const cat = {};
    const rows = [];
    for (const e of emps) {
        const v = String(e.deviceUserId).trim();
        const uRecs = byUid.get(v) || [];
        const xRecs = byUserId.get(v) || [];
        // المرشحون = سجلات الجهاز التي يُحتمل أن تكون لهذا الشخص
        const cand = [...new Set([...uRecs, ...xRecs])];
        const nameMatch = cand.filter((r) => r.name && norm(r.name) === norm(e.name));
        const pick = nameMatch.length === 1 ? nameMatch[0]
            : cand.length === 1 ? cand[0] : null;

        let kind, counterpart = null;
        if (!cand.length) {kind = 'NO_RECORD';}
        else if (!nameMatch.length && cand.length > 1) {kind = 'AMBIGUOUS_NO_NAME';}
        else if (nameMatch.length > 1) {kind = 'AMBIGUOUS_SAME_NAME';}
        else if (!nameMatch.length && cand.length === 1) {kind = 'PROVEN_BY_SINGLE';}
        else {kind = 'PROVEN_BY_NAME';}

        if (pick) {
            const viaUid = String(pick.uid) === v;
            const viaX = String(pick.userId || '').trim() === v;
            counterpart = viaUid && !viaX ? String(pick.userId || '').trim()
                : viaX && !viaUid ? String(pick.uid)
                : null; // uid == userId == v ⇒ لا بديل
        }

        const alt = String(e.deviceUserIdAlt || '').trim();
        // هل البديل الحالي يملكه موظف آخر كمعرّف أساسي؟ (لغم الإسناد)
        const stolen = alt && emps.some((o) => o.id !== e.id && String(o.deviceUserId).trim() === alt);
        const altOwn = alt && pick && (String(pick.uid) === alt || String(pick.userId || '').trim() === alt);
        const altHasPunch = alt ? (pcount.get(alt) || {}).c || 0 : 0;
        const altOrphan = alt ? (pcount.get(alt) || {}).orphan || 0 : 0;

        let verdict;
        if (kind.startsWith('AMBIGUOUS') || kind === 'NO_RECORD') {verdict = kind;}
        else if (!counterpart) {verdict = alt ? 'ALT_NO_NEED' : 'OK_NO_ALT_NEEDED';}
        else if (alt === counterpart) {verdict = 'OK_CORRECT';}
        else if (!alt) {verdict = 'MISSING_PROVEN';}
        else if (stolen) {verdict = 'BAD_ALT_STOLEN';}
        else {verdict = 'BAD_ALT_OTHER';}
        cat[verdict] = (cat[verdict] || 0) + 1;
        rows.push({
            id: e.id, emp: e.employeeId, name: e.name, status: e.status,
            v, alt, counterpart, verdict, kind,
            punchPrimary: (pcount.get(v) || {}).c || 0,
            punchAlt: altHasPunch, altOrphan, altOwn,
            devName: pick ? pick.name : cand.map((r) => `${r.name}(uid=${r.uid}/id=${r.userId})`).join(' | '),
        });
    }
    console.log('=== التوزيع ===');
    console.log(JSON.stringify(cat, null, 2));
    console.log('\n=== المشكلات (BAD/MISSING) ===');
    for (const r of rows.filter((x) => /^(BAD_|MISSING_)/.test(x.verdict))) {
        console.log(`${r.emp} id=${r.id} ${r.name} | v=${r.v} alt=${r.alt || '—'} دليل=${r.counterpart || '—'} ⇒ ${r.verdict} | بصمات(v)=${r.punchPrimary} بصمات(alt)=${r.punchAlt} يتيمة(alt)=${r.altOrphan} | جهاز: ${r.devName}`);
    }
    console.log('\n=== الغامض/بلا سجل ===');
    for (const r of rows.filter((x) => /AMBIGUOUS|NO_RECORD/.test(x.verdict))) {
        console.log(`${r.emp} id=${r.id} ${r.name} | v=${r.v} alt=${r.alt || '—'} ⇒ ${r.verdict} | بصمات(v)=${r.punchPrimary} | جهاز: ${r.devName}`);
    }
    console.log('\n=== سليم ===');
    console.log(rows.filter((x) => /^OK_/.test(x.verdict)).length + ' موظفًا بديلُه مطابقٌ للدليل');
    await pool.end();
})().catch((e) => { console.error('FAIL: ' + (e && e.message)); process.exit(1); });
