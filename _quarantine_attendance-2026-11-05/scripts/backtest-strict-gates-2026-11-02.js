'use strict';
/* scripts/backtest-strict-gates-2026-11-02.js
 * إعادة تشغيل البصومات المقبولة فعليًا (punch_attempts) تحت إعدادات أكثر صرامة،
 * قبل تفعيل أي شيء في الإنتاج. القراءة فقط: لا UPDATE ولا INSERT ولا إعادة تشغيل.
 *
 * المخرجات: كم بصمة مقبولة كانت سترفض، ولأي سبب، وبأي حدٍّ — حتى يختار المالك
 * العتبات من الدليل لا من التخمين (طلب 2026-11-02: «البصمة صارمة وحازمة، والوجه
 * حازم، والـGPS احترافي»).
 *
 * الاستخدام: node scripts/backtest-strict-gates.js [--from=YYYY-MM-DD] [--verbose]
 */
const { pool } = require('../backend/shared-pool');
const { resolvePunchSettings } = require('../backend/punch-portal-logic');

const arg = (name, dflt) => {
    const hit = process.argv.find(a => a.startsWith(`--${name}=`));
    return hit ? hit.slice(name.length + 3) : dflt;
};
const FROM = arg('from', '2026-08-01');
const VERBOSE = process.argv.includes('--verbose');

/** المرشَّحون الصارمون: كل صف = عتبات مقترحة تُقاس على نفس البيانات. */
const CANDIDATES = [
    { label: 'الحالي (خط الأساس)', acc: 50, age: 30, radius: 120, strictGeo: false, noSingleFix: false, minTrust: 0, face: 0.55, teleport: 250 },
    { label: 'صارم-أ: دقة 35م / عمر 25ث / نطاق 120', acc: 35, age: 25, radius: 120, strictGeo: false, noSingleFix: false, minTrust: 0, face: 0.45, teleport: 200 },
    { label: 'صارم-ب: دقة 30م / عمر 20ث / نطاق 110 / وجه 0.35', acc: 30, age: 20, radius: 110, strictGeo: false, noSingleFix: true, minTrust: 60, face: 0.35, teleport: 150 },
    { label: 'صارم-ج: دقة 25م / عمر 15ث / نطاق 100 / غموض مرفوض / وجه 0.30', acc: 25, age: 15, radius: 100, strictGeo: true, noSingleFix: true, minTrust: 90, face: 0.30, teleport: 120 },
];

/**
 * حكم إعادة التشغيل على عمود مخزَّن — بلا قراءات حسّاس خام (لم تُحفظ)،
 * وبأولوية نفس تسلسل evaluatePunch: الدقة ثم العمر ثم الواقعية ثم النطاق ثم الغموض ثم الجهاز ثم الوجه.
 * @param {any} row
 * @param {CANDIDATES[number]} c
 * @returns {string|null} كود الرفض أو null (مقبولة)
 */
function rejudge(row, c) {
    const acc = row.accuracy_m == null ? null : Number(row.accuracy_m);
    const age = row.fix_age_s == null ? null : Number(row.fix_age_s);
    const dist = row.distance_m == null ? null : Number(row.distance_m);
    const signals = String(row.trust_signals || '').split(',').filter(Boolean);
    const face = row.face_distance == null ? null : Number(row.face_distance);
    const tele = row.teleport_kmh == null ? null : Number(row.teleport_kmh);

    if (row.has_location === false) {return 'PUNCH_LOCATION_REQUIRED';}
    if (acc != null && (acc > c.acc || acc < 1)) {return 'PUNCH_LOCATION_WEAK_ACCURACY';}
    if (age != null && age > c.age) {return 'PUNCH_LOCATION_WEAK_STALE';}
    if (c.noSingleFix && signals.includes('SINGLE_FIX_FALLBACK')) {return 'PUNCH_LOCATION_WEAK_SINGLE_FIX';}
    if (c.minTrust > 0 && row.trust_score != null && Number(row.trust_score) < c.minTrust) {return 'PUNCH_TRUST_LOW';}
    if (dist != null && dist > c.radius) {return 'PUNCH_OUT_OF_RANGE';}
    if (c.strictGeo && dist != null && acc != null && dist + acc > c.radius + 10) {return 'PUNCH_LOCATION_AMBIGUOUS';}
    if (tele != null && tele > c.teleport) {return 'PUNCH_LOCATION_TELEPORT';}
    if (row.device_id == null) {return 'PUNCH_DEVICE_REQUIRED';}
    if (face != null && face > c.face) {return 'PUNCH_FACE_MISMATCH';}
    return null;
}

(async () => {
    const settingsRows = await pool.query(`SELECT key, value FROM punch_settings`);
    const live = resolvePunchSettings(settingsRows.rows);
    console.log('=== الإعدادات الحية (غير معدّلة) ===');
    console.log(`نطاق=${live.radiusMeters}م دقة≤${live.maxAccuracyM}م عمر≤${live.maxFixAgeS}ث `
        + `متعدد=${live.multiFixRequired} صارم=${live.strictGeofence} تخطٍّ ذاتي=${live.deviceAutoRebind} `
        + `وجه v1=${live.faceThreshold} v2=${live.faceV2Threshold} تنقل≤${live.maxTeleportKmh}كم/س `
        + `إحداثيات=${live.lat},${live.lng}`);

    const attempts = await pool.query(
        `SELECT a.id, a.employee_id, e.name, a.attempted_at, a.decision, a.reject_code,
                a.accuracy_m, a.fix_age_s, a.distance_m, a.face_distance, a.trust_score,
                a.trust_signals, a.teleport_kmh, a.has_location, a.device_id, a.engine_result
           FROM punch_attempts a
           LEFT JOIN employees e ON e.id = a.employee_id
          WHERE a.attempted_at >= $1
          ORDER BY a.attempted_at ASC`,
        [FROM]);

    const accepted = attempts.rows.filter(r => r.decision === 'accepted');
    const rejected = attempts.rows.filter(r => r.decision === 'rejected');
    console.log(`\n=== العينة: ${accepted.length} مقبولة / ${rejected.length} مرفوضة منذ ${FROM} ===`);

    // توزيع القياسات الحقيقية — أساس اختيار العتبات
    const pct = (vals, q) => {
        const s = vals.filter(v => Number.isFinite(v)).sort((a, b) => a - b);
        if (!s.length) {return null;}
        return s[Math.min(s.length - 1, Math.floor(q * (s.length - 1)))];
    };
    const stats = (label, get, rows = accepted) => {
        const v = rows.map(get);
        const f = v.filter(x => x != null && Number.isFinite(Number(x))).map(Number);
        if (!f.length) { console.log(`${label.padEnd(22)} بلا بيانات`); return; }
        console.log(`${label.padEnd(22)} p50=${pct(f, 0.5)} p90=${pct(f, 0.9)} p95=${pct(f, 0.95)} max=${Math.max(...f)} min=${Math.min(...f)} (n=${f.length})`);
    };
    console.log('\n=== توزيع المقبول فعليًا ===');
    stats('الدقة (م)', r => r.accuracy_m);
    stats('عمر القراءة (ث)', r => r.fix_age_s);
    stats('المسافة من المطعم (م)', r => r.distance_m);
    stats('مسافة الوجه', r => r.face_distance);
    stats('درجة الواقعية', r => r.trust_score);
    stats('التنقل (كم/س)', r => r.teleport_kmh);

    const sigCounts = {};
    for (const r of accepted) {
        for (const s of String(r.trust_signals || '').split(',').filter(Boolean)) {sigCounts[s] = (sigCounts[s] || 0) + 1;}
    }
    console.log('\nإشارات الواقعية في المقبولة:', JSON.stringify(sigCounts));

    // مسار classification التخميني — كم بصمة مقبولة اعتمدت على حدس المحرك القديم
    const guessReasons = { محايد: 0, تجاوز_زر: 0, override: 0, ثقة_0_7: 0 };
    for (const r of accepted) {
        const d = r.engine_result && r.engine_result.decision;
        if (!d) {continue;}
        const reason = String(d.reason || '');
        if (reason.includes('وقت محايد')) {guessReasons['محايد']++;}
        if (reason.includes('زر الجهاز يُتجاهل')) {guessReasons['تجاوز_زر']++;}
        if (d.override === true) {guessReasons['override']++;}
        if (Number(d.confidence) <= 0.7) {guessReasons['ثقة_0_7']++;}
    }
    console.log('المقبولة التي اعتمدت على حدس التصنيف:', JSON.stringify(guessReasons));

    // إعادة الحكم تحت كل مرشح
    console.log('\n=== إعادة التشغيل على المقبولة ===');
    for (const c of CANDIDATES) {
        const flipped = [];
        for (const r of accepted) {
            const code = rejudge(r, c);
            if (code) {flipped.push({ r, code });}
        }
        const byCode = {};
        for (const f of flipped) {byCode[f.code] = (byCode[f.code] || 0) + 1;}
        const emps = {};
        for (const f of flipped) {emps[`${f.r.employee_id} ${f.r.name || ''}`] = (emps[`${f.r.employee_id} ${f.r.name || ''}`] || 0) + 1;}
        const worst = Object.entries(emps).sort((a, b) => b[1] - a[1]).slice(0, 5);
        const rate = accepted.length ? Math.round((flipped.length / accepted.length) * 100) : 0;
        console.log(`\n${c.label}`);
        console.log(`  كانت سترفض: ${flipped.length}/${accepted.length} (${rate}%)  |  بالأكواد: ${JSON.stringify(byCode)}`);
        console.log(`  أكثر الموظفين تضررًا: ${worst.map(([k, v]) => `${k}=${v}`).join(', ') || '—'}`);
        if (VERBOSE) {
            for (const f of flipped.slice(0, 40)) {
                console.log(`    #${f.r.id} ${f.r.employee_id} ${f.r.name} ${f.r.attempted_at.toISOString()} → ${f.code} (دقة=${f.r.accuracy_m} عمر=${f.r.fix_age_s} مسافة=${f.r.distance_m} وجه=${f.r.face_distance})`);
            }
        }
    }

    // اقتراح العتبات من الدليل مباشرة
    const accs = accepted.map(r => Number(r.accuracy_m)).filter(Number.isFinite);
    const ages = accepted.map(r => Number(r.fix_age_s)).filter(Number.isFinite);
    const dists = accepted.map(r => Number(r.distance_m)).filter(Number.isFinite);
    const faces = accepted.map(r => Number(r.face_distance)).filter(Number.isFinite);
    console.log('\n=== عتبات مقترحة من الدليل (p95 للمقبولة + هامش) ===');
    console.log(`  max_accuracy_m : ${Math.ceil(pct(accs, 0.95))}   (كان ${live.maxAccuracyM})`);
    console.log(`  max_fix_age_s  : ${Math.ceil(pct(ages, 0.95))}   (كان ${live.maxFixAgeS})`);
    console.log(`  radius_meters  : ${Math.ceil(pct(dists, 0.95) / 10) * 10}   (كان ${live.radiusMeters})`);
    console.log(`  face_threshold : ${pct(faces, 0.95)}   (كان ${live.faceThreshold}) — ملاحظة: المطابقات الحقيقية كلها ≤ ${Math.max(...faces)}`);
    console.log('\nلا شيء فُعِّل أو غُيِّر. القرارات للمراجعة فقط.');
    await pool.end();
    process.exit(0);
})().catch(e => { console.error('FAIL: ' + e.message); process.exit(1); });
