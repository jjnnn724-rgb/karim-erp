'use strict';
/**
 * attendance-repair-emp084-2026-11-03.js — إصلاح بصمة EMP-084 (محمد المخلافي)
 * ═══════════════════════════════════════════════════════════════════════════
 * طلب المالك (2026-11-03): «دوامه 16:45 و١٢ ساعة» و«خلينا في شهر 11 — مش
 * عايز أي خطأ من تاريخ 1».
 *
 * ما يفعله (نوفمبر وحده):
 *   1. يثبّت ورديته 16:45 / 12 ساعة (employees + employee_shift_history من
 *      2026-10-17 حيث بدأت الخلايا الوهمية 09:00/04:30/05:10).
 *   2. يغلق 2026-11-02 بالبصمة الحقيقية: محاولة البوابة المقبولة
 *      2026-11-03T03:23Z = 06:23 بتوقيت الرياض (كانت قد كُتبت دخولًا ليوم ٣
 *      لأن الصف المفتوح من يوم وردية سابق لا يُغلق تلقائيًا — سياسة المالك:
 *      لا انصراف مُختلَق، لكن البصمة الموجودة دليلٌ لا اختلاق).
 *   3. يحذف صفّ 2026-11-03 الوهمي (لا بصمة له غير البصمة نفسها) — قبل بصمة
 *      المساء كي لا يُقرأ الصف المفتوح انصرافًا.
 *
 * كل تغيير يُكتب في attendance_edit_log (recordAttendanceEdit) — بلا حذف صامت.
 * التشغيل:
 *   node scripts/attendance-repair-emp084-2026-11-03.js            (تجريبي)
 *   node scripts/attendance-repair-emp084-2026-11-03.js --apply
 */
const { pool } = require('../backend/shared-pool');
const { recordAttendanceEdit } = require('../backend/attendance-governance');

const EMP = 84;
const SHIFT_START = '16:45';
const SHIFT_KARIM = 12;
const DAY_OFF = 1;
const HISTORY_FROM = '2026-10-17';
const OUT_DAY = '2026-11-02';
const OUT_TIME = '06:23';
const PHANTOM_DAY = '2026-11-03';
const ACTOR = { name: 'إصلاح آلي — قرار المالك 2026-11-03', role: 'admin' };
const REASON = 'تصحيح نوفمبر: وردية 16:45/12س + إغلاق ٢ نوفمبر ببصمة البوابة 06:23 وحذف صف ٣ نوفمبر الوهمي';

const toMin = (t) => {
    const m = String(t || '').match(/^(\d{1,2}):(\d{2})$/);
    return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};
const mins = (a, b) => {
    const x = toMin(a), y = toMin(b);
    if (x == null || y == null) {return null;}
    return Math.max(0, (y - x) + (y < x ? 1440 : 0));
};

async function main() {
    const apply = process.argv.includes('--apply');
    console.log(`[EMP-084] ${apply ? 'تطبيق' : 'تجريبي (لم يُكتب شيء)'}`);

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const emp = (await client.query(
            'SELECT id, name, "shift_start", "shift_karim", "day_off" FROM employees WHERE id = $1 FOR UPDATE',
            [EMP]
        )).rows[0];
        if (!emp) {throw new Error('الموظف غير موجود');}
        console.log('الموظف:', emp.id, emp.name, '· الحالي:', emp.shift_start, emp.shift_karim);

        const hist = (await client.query(
            `SELECT id, shift_start, shift_karim, day_off, effective_from::text AS eff
               FROM employee_shift_history
              WHERE employee_id = $1 AND effective_from >= $2::date
              ORDER BY effective_from`,
            [EMP, HISTORY_FROM]
        )).rows;
        console.log(`سجل الورديات من ${HISTORY_FROM}:`);
        for (const h of hist) {console.log(`  ${h.eff} → ${h.shift_start}/${h.shift_karim} (يوم راحة ${h.day_off})`);}

        const nov2 = (await client.query(
            `SELECT * FROM attendance WHERE "employeeId" = $1 AND date = $2`,
            [EMP, OUT_DAY]
        )).rows[0];
        const nov3 = (await client.query(
            `SELECT * FROM attendance WHERE "employeeId" = $1 AND date = $2`,
            [EMP, PHANTOM_DAY]
        )).rows[0];
        console.log('٢ نوفمبر:', nov2 ? `${nov2.checkIn} → ${nov2.checkOut}` : '(لا صف)');
        console.log('٣ نوفمبر:', nov3 ? `${nov3.checkIn} → ${nov3.checkOut} (${nov3.source})` : '(لا صف)');

        if (nov3 && nov3.checkOut) {
            console.log('⚠ صف ٣ نوفمبر مغلق بانصراف حقيقي — لن يُحذف.');
        }

        if (!apply) {
            console.log('[EMP-084] تجريبي — أضف --apply للتنفيذ.');
            await client.query('ROLLBACK');
            return;
        }

        // (1) الوردية الثابتة
        await client.query(
            'UPDATE employees SET "shift_start" = $2, "shift_karim" = $3, "day_off" = $4 WHERE id = $1',
            [EMP, SHIFT_START, SHIFT_KARIM, DAY_OFF]
        );
        const fixed = await client.query(
            `UPDATE employee_shift_history SET shift_start = $2, shift_karim = $3
              WHERE employee_id = $1 AND effective_from >= $4::date AND shift_start IS DISTINCT FROM $2
              RETURNING id`,
            [EMP, SHIFT_START, SHIFT_KARIM, HISTORY_FROM]
        );
        console.log(`سجل الورديات: صُحّح ${fixed.rowCount} صفًّا إلى ${SHIFT_START}/${SHIFT_KARIM}`);

        // (2) إغلاق ٢ نوفمبر بالبصمة الحقيقية
        if (nov2 && !nov2.checkOut && nov2.checkIn) {
            const worked = mins(nov2.checkIn, OUT_TIME);
            await client.query(
                `UPDATE attendance
                    SET "checkOut" = $3::text,
                        "checkOutAt" = (($4::date)::timestamp + ($3::text)::time) AT TIME ZONE 'Asia/Riyadh',
                        "workMinutes" = $5,
                        "checkout_inferred" = FALSE,
                        "early_leave" = FALSE,
                        late = $6,
                        notes = COALESCE(notes, '') ||
                          ' | انصراف مُثبت ببصمة البوابة 2026-11-03 06:23 — صُحّح بقرار المالك (وردية 16:45/12س)'
                  WHERE id = $1 AND "employeeId" = $2`,
                [nov2.id, EMP, OUT_TIME, OUT_DAY, worked, toMin(nov2.checkIn) > toMin(SHIFT_START)]
            );
            await recordAttendanceEdit({
                action: 'update', before: nov2,
                after: { ...nov2, checkOut: OUT_TIME, workMinutes: worked },
                actor: ACTOR, source: 'repair', reason: REASON,
            });
            console.log(`٢ نوفمبر: أُغلق ${nov2.checkIn} → ${OUT_TIME} (${worked} دقيقة)`);
        }

        // (2ب) ١ نوفمبر: انصراف 05:18 بعد نهاية وردية 16:45 + 12 ساعة (04:45)
        // — لا تبكير. العلم كُتب وقت البصمة بوردية 09:00 الوهمية.
        const nov1 = (await client.query(
            `SELECT * FROM attendance WHERE "employeeId" = $1 AND date = '2026-11-01'`,
            [EMP]
        )).rows[0];
        if (nov1 && nov1.checkOut && nov1.early_leave === true
            && Number(nov1.workMinutes) >= SHIFT_KARIM * 60) {
            await client.query(
                `UPDATE attendance SET early_leave = FALSE WHERE id = $1 AND "employeeId" = $2`,
                [nov1.id, EMP]
            );
            await recordAttendanceEdit({
                action: 'update', before: nov1,
                after: { ...nov1, early_leave: false },
                actor: ACTOR, source: 'repair',
                reason: REASON + ' — انصراف 05:18 بعد نهاية الوردية، لا تبكير',
            });
            console.log(`١ نوفمبر: أُلغي علم التبكير (${nov1.workMinutes} دقيقة > 720)`);
        }

        // (3) حذف صف ٣ نوفمبر الوهمي (لا بصمة له غير بصمة الانصراف نفسها)
        if (nov3 && !nov3.checkOut && nov3.checkIn === OUT_TIME) {
            await recordAttendanceEdit({
                action: 'delete', before: nov3, actor: ACTOR, source: 'repair',
                reason: REASON + ' — الصف كان تكرارًا لبصمة الانصراف نفسها',
            });
            await client.query('DELETE FROM attendance WHERE id = $1 AND "employeeId" = $2', [nov3.id, EMP]);
            console.log('٣ نوفمبر: حُذف الصف الوهمي (سُجّل في attendance_edit_log)');
        } else if (nov3) {
            console.log('٣ نوفمبر: تُرك كما هو (له دليل مستقل).');
        }

        await client.query('COMMIT');
        console.log('[EMP-084] تم.');
    } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        throw e;
    } finally {
        client.release();
        await pool.end();
    }
}

main().catch((e) => { console.error('FAIL:', e.message); process.exit(1); });
