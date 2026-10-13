'use strict';
/* attendance-backfill.js — إعادة معالجة البصمات الخام العالقة إلى جدول الحضور.
 *
 * المشكلة التي تعالجها: البصمة تُكتب في attendance_logs (خام، committed) ثم تفشل
 * معالجتها إلى صف في attendance (خطأ SQL / إسقاط الدورة / إعادة تشغيل السيرفر).
 * لأن الكتابة اليومية تجري للسجلات المُدرجة في الدورة نفسها فقط، تبقى تلك البصمات
 * عالقة للأبد ولا يستعيدها reconcile (الذي يزور صفوف الحضور الموجودة فقط).
 *
 * الآلية: fill-only ومتكرر الاستدعاء (idempotent).
 *   1) يجمع كل بصمة خام مرتبطة بموظف في آخر N يوم.
 *   2) يحسب «تاريخ الوردية» لكل بصمة بمنطق التطبيق نفسه (shiftDateForEmployee).
 *   3) يتجاهل أي (موظف، يوم) له صف حضور أصلًا — لا يلمس البيانات القائمة.
 *   4) يعيد تشغيل البصمات المتبقية زمنيًا تصاعديًا عبر engine.processPunch.
 *
 * الاستخدام:
 *   node scripts/attendance-backfill.js --dry-run --days=10
 *   node scripts/attendance-backfill.js --days=10
 */

const { pool } = require('../backend/shared-pool');
const {
    engine,
    instantToWall,
    shiftDateForEmployee,
} = require('../backend/attendance-engine');

function parseArgs(argv) {
    const out = { days: 10, dryRun: false, limit: 0 };
    for (const a of argv) {
        if (a === '--dry-run') {out.dryRun = true;}
        else if (a.startsWith('--days=')) {out.days = Number(a.slice(7)) || out.days;}
        else if (a.startsWith('--limit=')) {out.limit = Number(a.slice(8)) || 0;}
    }
    return out;
}

/** تحميل إعدادات الوردية لكل موظف — نفس مصدر المحرك */
async function loadMapping() {
    const { rows } = await pool.query(
        'SELECT id, shift_start, shift_karim FROM employees'
    );
    const byId = new Map();
    for (const r of rows) {
        byId.set(r.id, {
            shiftStart: /^\d{1,2}:\d{2}$/.test(String(r.shift_start || '')) ? String(r.shift_start) : '09:00',
            shiftKarim: Number(r.shift_karim) > 0 ? Number(r.shift_karim) : 10,
        });
    }
    return byId;
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    console.log(`[BACKFILL] أيام=${args.days} تشغيل_تجريبي=${args.dryRun}`);

    const mapping = await loadMapping();

    // 1) كل البصمات الخام المرتبطة بموظف في النافذة
    const logs = (await pool.query(
        `SELECT id, "employeeId", "attendanceTime", "punchState"
           FROM attendance_logs
          WHERE "employeeId" IS NOT NULL
            AND "attendanceTime" >= NOW() - ($1 || ' days')::interval
          ORDER BY "attendanceTime" ASC`,
        [args.days]
    )).rows;
    console.log(`[BACKFILL] بصمات خام في النافذة: ${logs.length}`);

    // 2) حساب تاريخ الوردية لكل بصمة + تجميعها
    const groups = new Map(); // key `${emp}|${shiftDate}` -> logs[]
    for (const l of logs) {
        const instant = new Date(l.attendanceTime);
        const wall = instantToWall(instant);
        const shift = mapping.get(l.employeeId) || { shiftStart: '09:00', shiftKarim: 10 };
        const shiftDate = shiftDateForEmployee(wall.date, wall.hour, {
            shift_start: shift.shiftStart, shift_karim: shift.shiftKarim,
        });
        if (!shiftDate) {continue;}
        const key = `${l.employeeId}|${shiftDate}`;
        if (!groups.has(key)) {groups.set(key, []);}
        groups.get(key).push({ ...l, instant, wall });
    }
    console.log(`[BACKFILL] أزواج (موظف، يوم وردية): ${groups.size}`);

    // 3) استبعاد الأزواج التي لديها صف حضور أصلًا — لا نلمس البيانات القائمة
    const keys = [...groups.keys()];
    const existing = new Set();
    const CHUNK = 500;
    for (let i = 0; i < keys.length; i += CHUNK) {
        const slice = keys.slice(i, i + CHUNK);
        const empIds = [], dates = [];
        for (const k of slice) {
            const [e, d] = k.split('|');
            empIds.push(Number(e));
            dates.push(d);
        }
        const r = await pool.query(
            `SELECT DISTINCT "employeeId", date FROM attendance
              WHERE ("employeeId", date) IN (SELECT * FROM UNNEST($1::bigint[], $2::varchar[]))`,
            [empIds, dates]
        );
        for (const row of r.rows) {existing.add(`${row.employeeId}|${row.date}`);}
    }
    const todo = keys.filter(k => !existing.has(k));
    const stuckPunches = todo.reduce((n, k) => n + groups.get(k).length, 0);
    console.log(`[BACKFILL] أزواج مكتملة تُترك كما هي: ${keys.length - todo.length}`);
    console.log(`[BACKFILL] أزواج ناقصة تحتاج إعادة معالجة: ${todo.length} (بصمات: ${stuckPunches})`);

    if (todo.length === 0) {
        console.log('[BACKFILL] لا توجد فجوات — كل البصمات مترابطة بصفوف حضور. ✅');
        await pool.end();
        return;
    }

    const sample = todo.slice(0, 12).map(k => {
        const [e, d] = k.split('|');
        const g = groups.get(k);
        return `  موظف ${e} — يوم ${d} — ${g.length} بصمة (${g[0].wall.time} … ${g[g.length - 1].wall.time})`;
    });
    console.log('[BACKFILL] عيّنة من الفجوات:');
    for (const s of sample) {console.log(s);}

    if (args.dryRun) {
        console.log('[BACKFILL] وضع تجريبي — لم يُكتب أي شيء.');
        await pool.end();
        return;
    }

    // 4) إعادة التشغيل زمنيًا تصاعديًا — نفس مسار الإنتاج (fill-only)
    let processed = 0, failed = 0;
    const failures = [];
    const ordered = todo.slice(args.limit || undefined);
    for (const key of ordered) {
        const group = groups.get(key).sort((a, b) => a.instant - b.instant);
        for (const l of group) {
            try {
                await engine.processPunch({
                    employeeId: l.employeeId,
                    punchState: l.punchState,
                    instant: l.instant,
                    wall: l.wall,
                    device: null,
                    source: 'device',
                });
                processed += 1;
            } catch (e) {
                failed += 1;
                if (failures.length < 5) {failures.push(`emp=${l.employeeId} @${l.wall.date} ${l.wall.time}: ${e.message}`);}
            }
        }
    }

    console.log(`[BACKFILL] انتهى — معالجة ${processed} بصمة، فشل ${failed}`);
    for (const f of failures) {console.log('  فشل: ' + f);}

    // 5) التحقق النهائي
    const after = (await pool.query(
        `SELECT COUNT(*)::int AS n FROM (
            SELECT l."employeeId", l."attendanceTime"
              FROM attendance_logs l
             WHERE l."employeeId" IS NOT NULL
               AND l."attendanceTime" >= NOW() - ($1 || ' days')::interval
             GROUP BY 1, 2) x`,
        [args.days]
    )).rows[0].n;
    const stillMissing = [];
    for (const key of todo) {
        const [e, d] = key.split('|');
        const r = await pool.query(
            'SELECT 1 FROM attendance WHERE "employeeId" = $1 AND date = $2 LIMIT 1', [Number(e), d]);
        if (!r.rows[0]) {stillMissing.push(key);}
    }
    console.log(`[BACKFILL] التحقق: أزواج ما زالت بلا صف حضور: ${stillMissing.length}`);
    if (stillMissing.length) {
        console.log('  (أزواج بلا أي بصمة دخول قابلة للاسترجاع — تحتاج مراجعة يدوية)');
        for (const k of stillMissing.slice(0, 10)) {console.log('   ' + k);}
    }
    console.log(`[BACKFILL] إجمالي البصمات الخام المترابطة في النافذة: ${after}`);

    await pool.end();
}

main().catch((e) => {
    console.error('[BACKFILL] خطأ: ' + (e && e.message));
    process.exit(1);
});
