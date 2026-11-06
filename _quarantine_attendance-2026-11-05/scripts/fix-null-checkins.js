'use strict';
/**
 * fix-null-checkins.js — استرداد الدخول الناقص من سجل بصمات الجهاز
 * ═══════════════════════════════════════════════════════════════════════
 * الخطأ الذي أُصلح هنا (2026-11-02): النسخة القديمة بحثت عن بصمات اليوم
 * داخل «اليوم الميلادي» للصف فقط، ثم حذفت الصف إن لم تجد بصمة. الوردية
 * الليلية تبدأ مساءً وتنتهي فجر اليوم التالي، فتبدو صفوفها بلا بصمات
 * داخل يومها الميلادي → حُذفت صفوف حضورٍ سليمة من كشف الرواتب.
 *
 * القواعد الآن:
 *   1. البصمة تُنسب لـ«يوم الوردية» بنفس منطق المحرك (shift-day.js)،
 *      والبحث في نافذة ±١ يوم حول تاريخ الصف لا في يومه الميلادي.
 *   2. لا حذف إطلاقًا. الصف الذي لا تُسترد له بصمة يُعرض للمراجعة اليدوية؛
 *      فالحضور قد يكون يدويًا أو من بوابة الوجه لا من جهاز البصمة.
 *   3. تعبئة فقط: لا يُمسّ دخولٌ موجود ولا انصراف، ولا فترة محاسبية مقفلة.
 *   4. كل تعديل يترك سطر تدقيق في attendance_edit_log (من ومتى ولماذا).
 *
 * التشغيل:
 *   node scripts/fix-null-checkins.js --dry-run     (افتراضي: لا يُكتب شيء)
 *   node scripts/fix-null-checkins.js --apply
 */
const { pool } = require('../backend/shared-pool');
const proto = require('../backend/zkteco/protocol');
const {
    instantToWall, loadShiftHistoryMap, resolveShiftAt,
} = require('../backend/attendance-engine');
const { shiftDateForEmployee } = require('../backend/shift-day');
const { recordAttendanceEdit } = require('../backend/attendance-governance');
const { isPeriodClosed } = require('../backend/accounting-periods');

const IN_STATES = proto.CHECK_IN_STATES;
const REASON = 'استرداد دخول من سجل بصمات الجهاز — تدقيق بصمة';
const APPLY = process.argv.includes('--apply');
const DAY_MS = 24 * 60 * 60 * 1000;
const TZ = '+03:00';

/** نافذة ±١ يوم حول تاريخ الصف: دخول المساء السابق وانصراف فجر اليوم التالي. */
function rowWindow(dateStr) {
    const [y, m, d] = String(dateStr).split('-').map(Number);
    const start = new Date(Date.UTC(y, m - 1, d) - DAY_MS);
    const p = (n) => String(n).padStart(2, '0');
    const local = (dt) => `${dt.getUTCFullYear()}-${p(dt.getUTCMonth() + 1)}-${p(dt.getUTCDate())}T00:00:00${TZ}`;
    return [new Date(local(start)), new Date(local(new Date(start.getTime() + 3 * DAY_MS)))];
}

async function main() {
    console.log(`[CHECK-IN] الوضع: ${APPLY ? 'تطبيق' : 'تجريبي (لم يُكتب شيء)'}`);

    const bad = (await pool.query(`
        SELECT id, "employeeId", date, "checkIn", "checkOut", "checkOutAt", notes
          FROM attendance
         WHERE "checkIn" IS NULL AND "checkOut" IS NOT NULL
         ORDER BY date`)).rows;
    console.log(`[CHECK-IN] صفوف بلا دخول ولها انصراف: ${bad.length}`);
    if (!bad.length) { await pool.end(); return; }

    const empIds = [...new Set(bad.map((r) => Number(r.employeeId)).filter(Number.isInteger))];
    const empRows = (await pool.query(
        `SELECT id, shift_start, shift_karim FROM employees WHERE id = ANY($1::bigint[])`,
        [empIds]
    )).rows;
    const base = new Map(empRows.map((r) => [Number(r.id), {
        shift_start: r.shift_start || null,
        shift_karim: Number(r.shift_karim) > 0 ? Number(r.shift_karim) : 10,
    }]));
    const histMap = await loadShiftHistoryMap(empIds, bad[bad.length - 1].date);

    let fixed = 0, review = 0, closed = 0, failed = 0;
    for (const row of bad) {
        const empId = Number(row.employeeId);
        const [from, to] = rowWindow(row.date);
        const logs = (await pool.query(
            `SELECT "attendanceTime" AS at, "punchState" AS st
               FROM attendance_logs
              WHERE "employeeId" = $1 AND "attendanceTime" >= $2 AND "attendanceTime" < $3
              ORDER BY "attendanceTime"`,
            [row.employeeId, from, to]
        )).rows;

        /* لا تُقارَن البصمة بتاريخها الميلادي: نحسب يوم ورديتها أولًا. */
        const b = base.get(empId) || null;
        const dayPunches = logs.filter((l) => {
            const wall = instantToWall(new Date(l.at));
            const sh = resolveShiftAt(histMap.get(String(empId)) || [], wall.date, b);
            return shiftDateForEmployee(wall.date, wall.hour, {
                shift_start: sh?.shift_start, shift_karim: sh?.shift_karim,
            }) === row.date;
        });

        const checkOutAt = new Date(row.checkOutAt);
        const inPunch = dayPunches.find((l) =>
            IN_STATES.has(Number(l.st)) && new Date(l.at) < checkOutAt
        );

        if (!inPunch) {
            review += 1;
            console.log(`  REVIEW: emp=${row.employeeId} ${row.date} — لا بصمة دخول لهذا اليوم (${dayPunches.length} بصمة بالنافذة). يُترك للمراجعة، لا حذف.`);
            continue;
        }

        const inTime = new Date(inPunch.at);
        const wall = instantToWall(inTime);
        const minutes = Math.max(0, Math.round((checkOutAt - inTime) / 60000));

        if (!APPLY) {
            console.log(`  DRY: emp=${row.employeeId} ${row.date} → دخول ${wall.time} (انصراف ${row.checkOut})`);
            continue;
        }
        if (await isPeriodClosed(String(row.date).slice(0, 7))) {
            closed += 1;
            console.log(`  CLOSED: emp=${row.employeeId} ${row.date} — الفترة مقفلة، تُرك.`);
            continue;
        }

        try {
            const before = (await pool.query('SELECT * FROM attendance WHERE id = $1', [row.id])).rows[0];
            await pool.query(
                `UPDATE attendance
                    SET "checkIn" = $1, "checkInAt" = $2, "workMinutes" = $3,
                        notes = COALESCE(notes, '') || ' | ' || $4
                  WHERE id = $5 AND "checkIn" IS NULL`,
                [wall.time, inTime, minutes, REASON, row.id]
            );
            const after = (await pool.query('SELECT * FROM attendance WHERE id = $1', [row.id])).rows[0];
            await recordAttendanceEdit({
                action: 'update', before, after,
                actor: { id: null, name: 'مِصلح تدقيق البصمة', role: 'system' },
                source: 'reconciliation', reason: REASON,
            });
            fixed += 1;
            console.log(`  FIXED: emp=${row.employeeId} ${row.date} دخول=${wall.time} انصراف=${row.checkOut}`);
        } catch (e) {
            failed += 1;
            console.log(`  FAILED: emp=${row.employeeId} ${row.date} — ${e && e.message}`);
        }
    }

    console.log(`[CHECK-IN] أُصلح=${fixed} · للمراجعة=${review} · فترة مقفلة=${closed} · فشل=${failed} · محذوف=0`);
    if (!APPLY) { console.log('[CHECK-IN] وضع تجريبي — أضف --apply للتنفيذ.'); }
    await pool.end();
}

main().catch((e) => { console.error('[CHECK-IN] خطأ: ' + (e && e.message)); process.exit(1); });
