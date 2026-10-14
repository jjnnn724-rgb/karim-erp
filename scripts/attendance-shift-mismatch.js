'use strict';
/* attendance-shift-mismatch.js — كاشف تناقض إعداد الوردية (قراءة فقط، لا يكتب شيئًا).
 *
 * [DISC-1] الجذر الذي يكشفه: وردية معلنة لا تطابق الإيقاع الفعلي ⇒ shiftDateForEmployee
 * ينسب انصراف الفجر دخولًا لسطر اليوم التالي، فتُولَّد سطور «اقتران ذاتي» بصفر دقيقة
 * واستخدام مزدوج بين السطور. قبل إصلاح المحرك يجب معرفة أي الإعدادات كذبة.
 *
 * المنهج — ملاءمة نموذجية، لا تناوب جشع:
 *   التناوب الجشع (اقتران بصمة-بصمة) جُرِّب وتُخلِّي عنه: مع نمط بصمتين في اليوم يكون
 *   الطور غامضًا (يبدأ من أي بصمة)، وبصمة مفقودة واحدة تُزيح كل الاقترانات التالية —
 *   فكان يتّهم عمالًا إعدادُهم صحيح.
 *   فتور(نافذة) = نسبة البصمات الواقعة ضمن ±TOL دقيقة من أحد طرفي النافذة.
 *   نقارن فتور النافذة المعلنة بأفضل فتور على شبكة (بداية كل 30د × مدة 4…16س خطوة 30د)،
 *   وعند التعادل نفضّل النافذة الأقصر (تفسّر نفس السحب بأقل فرض).
 *
 * الاستدعاء: node scripts/attendance-shift-mismatch.js [أيام=14]
 * مخرجاته مقترح للإدارة فقط: تصحيح الوردية تعديل إعداد حي يؤثر على الاستيعاب الجديد.
 */
const path = require('path');
const { pool } = require('../backend/shared-pool');
const ae = require('../backend/attendance-engine');

const DAYS = Number(process.argv[2] || 14);
const TOL = 90;                       // دقائق سماح حول طرفي النافذة
const MIN_CLOUD = 10;                 // أقل سحب بصمات يُحكم عليه
const GAIN = 0.15;                    // الحد الأدنى لأثر التصحيح على نسبة البصمات
const START_DRIFT = 90;               // دقائق: انحراف بداية يُعد خطأ
const DUR_DRIFT = 150;                // دقائق: انحراف مدة يُعد خطأ

const T = (x) => ae.instantToWall(new Date(x));
const hhmm = (m) => {
    const n = ((m % 1440) + 1440) % 1440;
    return `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(Math.round(((n % 60) + 60) % 60)).padStart(2, '0')}`;
};
const hours = (m) => `${Math.round(m / 6) / 10}h`;
const cdist = (a, b) => {
    const d = Math.abs(((a % 1440) + 1440) % 1440 - ((b % 1440) + 1440) % 1440);
    return d > 720 ? 1440 - d : d;
};

function fit(cloud, start, dur) {
    if (!cloud.length) {return 0;}
    const ends = [((start % 1440) + 1440) % 1440, ((start + dur) % 1440 + 1440) % 1440];
    let hit = 0;
    for (const m of cloud) {
        if (ends.some((e) => cdist(m, e) <= TOL)) {hit++;}
    }
    return hit / cloud.length;
}

(async () => {
    const since = new Date(Date.now() - DAYS * 86400000).toISOString();
    const emps = (await pool.query(
        `SELECT id, "employeeId" AS code, name, shift_start, shift_karim
           FROM employees WHERE status IS NULL OR status <> 'inactive'`)).rows;
    const logs = (await pool.query(
        `SELECT "employeeId" AS eid, "attendanceTime" AS at
           FROM attendance_logs WHERE "attendanceTime" >= $1`, [since])).rows;

    const cloudBy = new Map();
    for (const l of logs) {
        const w = T(l.at);
        if (!cloudBy.has(l.eid)) {cloudBy.set(l.eid, []);}
        cloudBy.get(l.eid).push(w.hour * 60 + w.minute);
    }

    const rows = [];
    for (const e of emps) {
        const cloud = cloudBy.get(e.id) || [];
        if (cloud.length < MIN_CLOUD) {continue;}

        const [dh, dm] = String(e.shift_start || '09:00').split(':').map(Number);
        const s0 = dh * 60 + dm;
        const d0 = Math.round(Number(e.shift_karim || 8) * 60);
        const declaredFit = fit(cloud, s0, d0);

        let best = { S: s0, D: d0, f: declaredFit };
        for (let S = 0; S < 1440; S += 30) {
            for (let D = 240; D <= 960; D += 30) {
                const f = fit(cloud, S, D);
                if (f > best.f + 1e-9 || (Math.abs(f - best.f) <= 1e-9 && D < best.D)) {best = { S, D, f };}
            }
        }

        const dStart = cdist(best.S, s0);
        const dDur = Math.abs(best.D - d0);
        const gain = best.f - declaredFit;

        let verdict = 'متسق';
        const why = [];
        if (gain >= GAIN && (dStart > START_DRIFT || dDur > DUR_DRIFT)) {
            verdict = dStart > START_DRIFT && dDur > DUR_DRIFT ? 'مواعيد ومدة خاطئة'
                : (dStart > START_DRIFT ? 'بداية خاطئة' : 'مدة خاطئة');
            why.push(`فتور المُعلن ${Math.round(declaredFit * 100)}% مقابل ${hhmm(best.S)}+${hours(best.D)} يفسّر ${Math.round(best.f * 100)}%`);
        } else if (declaredFit < 0.55) {
            verdict = 'نافذة لا تفسّر السحب';
            why.push(`فقط ${Math.round(declaredFit * 100)}% من بصماته قرب طرفي النافذة المعلنة (الأفضل ${hhmm(best.S)}+${hours(best.D)} = ${Math.round(best.f * 100)}%)`);
        }
        rows.push({ code: e.code, name: e.name, cloud: cloud.length,
            declared: `${hhmm(s0)}+${hours(d0)}`, declaredFit, best, gain, verdict, why: why.join(' · ') });
    }

    const bad = rows.filter((r) => r.verdict !== 'متسق').sort((a, b) => b.gain - a.gain || a.declaredFit - b.declaredFit);
    console.log(`موظفون بسحب بصمات كافٍ: ${rows.length} · متسقون: ${rows.length - bad.length} · متناقضون: ${bad.length}\n`);
    console.log('=== إعدادات لا تفسّر الإيقاع الفعلي (مقترح إدارة — لا يُطبَّق آليًا) ===');
    for (const r of bad) {
        console.log(`  ${r.code} ${r.name}`);
        console.log(`     مُعلن ${r.declared} (فتور ${Math.round(r.declaredFit * 100)}%) · أفضل ${hhmm(r.best.S)}+${hours(r.best.D)} (فتور ${Math.round(r.best.f * 100)}%) · ${r.cloud} بصمة`);
        console.log(`     ⇒ ${r.verdict}: ${r.why}`);
    }
    console.log('\n=== أدنى فتور بين المتسقين (عينة 10) ===');
    for (const r of rows.filter((x) => x.verdict === 'متسق').sort((a, b) => a.declaredFit - b.declaredFit).slice(0, 10)) {
        console.log(`  ${r.code} ${r.name}: مُعلن ${r.declared} فتور ${Math.round(r.declaredFit * 100)}% · ${r.cloud} بصمة`);
    }
    await pool.end();
})().catch((e) => { console.log('FATAL ' + (e && e.stack || e)); process.exit(1); });
