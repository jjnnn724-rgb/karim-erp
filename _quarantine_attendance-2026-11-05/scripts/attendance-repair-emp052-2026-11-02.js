'use strict';
/**
 * attendance-repair-emp052-2026-11-02.js — تصحيح سطري EMP-052 (1–2 نوفمبر)
 * ═══════════════════════════════════════════════════════════════════════
 * بتوقيع المالك 2026-11-02: «إلغاء الاختلاق + توقيع 09:39 انصرافًا لسطر
 * 01/11». كل القيم هنا من لحظةٍ حقيقية مخزّنة، والتوقيت توقيت مكة المعتمد
 * (نفس ساعة بقية الشاشات):
 *   • 2026-11-01T14:21:51.110Z = 17:21 — دخوله (بوابة الجوال)
 *   • 2026-11-02T06:39:09.254Z = 09:39 — انصرافه الحقيقي (بوابة الجوال)
 *   • 2026-11-02T14:04:31.000Z = 17:04 — دخوله النهاردة (جهاز البصمة، state=0)
 *
 * قبل الإصلاح: سطر 01/11 مقفول بانصرافٍ مُختلَق 05:17 (checkout_inferred،
 * = الدخول + 12 ساعة بالمللي ثانية)، وسطر 02/11 دخوله 09:39 وانصرافه 17:04.
 * بعد الإصلاح: 01/11 دخول 17:21 → انصراف 09:39 = 977 د، و02/11 دخول 17:04
 * بلا انصراف (يتوقّع بصمته أو توقيعًا).
 *
 * تكراري وآمن: لا يكتب إلا إذا كان السطر لا يزال على حالة الاختلاق، ويسجّل
 * القديم والجديد في attendance_edit_log (action='punch-repair') قبل/بعد.
 */

const { pool } = require('../backend/shared-pool');
const { wallTime } = require('../backend/business-time');

const EMPLOYEE_ID = 52;
const IN_11 = '2026-11-01T14:21:51.110Z';
const OUT_11 = '2026-11-02T06:39:09.254Z';
const IN_12 = '2026-11-02T14:04:31.000Z';
const WORK_11 = Math.round((new Date(OUT_11) - new Date(IN_11)) / 60000);

const REASON = 'إصلاح 2026-11-02: انصراف 05:17 كان مختلَقًا من مدة الوردية (checkout_inferred)؛ '
    + 'البصمة الحقيقية لانصراف 01/11 هي 09:39 من بوابة الجوال، وبصمة 17:04 من الجهاز دخولٌ (state=0) لا انصراف.';

function stamp(value) {
    return `${wallTime(value)} (${String(value).slice(0, 19)}Z)`;
}

async function main() {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const rows = await client.query(
            `SELECT id, date, "checkIn","checkOut","checkInAt","checkOutAt","workMinutes",notes,
                    COALESCE(checkout_inferred,false) AS inferred
               FROM attendance WHERE "employeeId" = $1 AND date IN ('2026-11-01','2026-11-02') FOR UPDATE`,
            [EMPLOYEE_ID]
        );
        const byDate = new Map(rows.rows.map(r => [String(r.date), r]));
        const r1 = byDate.get('2026-11-01'), r2 = byDate.get('2026-11-02');
        if (!r1 || !r2) {throw new Error('سطور 01/11 أو 02/11 غير موجودة — لا إصلاح');}
        console.log('BEFORE', JSON.stringify({
            d1: { id: r1.id, in: r1.checkIn, out: r1.checkOut, inferred: r1.inferred, work: r1.workMinutes },
            d2: { id: r2.id, in: r2.checkIn, out: r2.checkOut, work: r2.workMinutes },
        }));

        const needs1 = r1.inferred || r1.checkOut !== wallTime(OUT_11);
        const needs2 = r2.checkIn !== wallTime(IN_12) || r2.checkOut !== null;

        if (!needs1 && !needs2) {
            console.log('ALREADY-REPAIRED — لا كتابة');
            await client.query('ROLLBACK');
            return;
        }

        if (needs1) {
            await client.query(
                `UPDATE attendance
                    SET "checkIn" = $2, "checkInAt" = $3, "checkOut" = $4, "checkOutAt" = $5,
                        "workMinutes" = $6, checkout_inferred = false,
                        notes = COALESCE(notes,'') || $7
                  WHERE id = $1`,
                [r1.id, wallTime(IN_11), new Date(IN_11), wallTime(OUT_11), new Date(OUT_11), WORK_11,
                    ` | تصحيح بتوقيع مسؤول: انصراف 01/11 = ${stamp(OUT_11)} بدل انصرافٍ مستنتج`]
            );
            await client.query(
                `INSERT INTO attendance_edit_log ("attendanceId","employeeId",action,"changedFields",reason,"actorName","actorRole",source)
                 VALUES ($1,$2,'punch-repair',$3,$4,'Qoder agent بأمر المالك','repair-script','sql-repair')`,
                [r1.id, EMPLOYEE_ID, JSON.stringify({
                    before: { checkIn: r1.checkIn, checkOut: r1.checkOut, checkOutAt: r1.checkOutAt, workMinutes: r1.workMinutes, checkout_inferred: r1.inferred },
                    after: { checkIn: wallTime(IN_11), checkOut: wallTime(OUT_11), checkOutAt: OUT_11, workMinutes: WORK_11, checkout_inferred: false },
                }), REASON]
            );
        }

        if (needs2) {
            await client.query(
                `UPDATE attendance
                    SET "checkIn" = $2, "checkInAt" = $3, "checkOut" = NULL, "checkOutAt" = NULL,
                        "workMinutes" = NULL, early_leave = false, checkout_inferred = false,
                        notes = COALESCE(notes,'') || $4
                  WHERE id = $1`,
                [r2.id, wallTime(IN_12), new Date(IN_12),
                    ` | تصحيح بتوقيع مسؤول: 17:04 بصمة دخول من الجهاز (state=0) — بلا انصراف حتى الآن`]
            );
            await client.query(
                `INSERT INTO attendance_edit_log ("attendanceId","employeeId",action,"changedFields",reason,"actorName","actorRole",source)
                 VALUES ($1,$2,'punch-repair',$3,$4,'Qoder agent بأمر المالك','repair-script','sql-repair')`,
                [r2.id, EMPLOYEE_ID, JSON.stringify({
                    before: { checkIn: r2.checkIn, checkOut: r2.checkOut, checkOutAt: r2.checkOutAt, workMinutes: r2.workMinutes, early_leave: r2.early_leave },
                    after: { checkIn: wallTime(IN_12), checkOut: null, checkOutAt: null, workMinutes: null, early_leave: false },
                }), REASON]
            );
        }

        const after = await client.query(
            `SELECT date,"checkIn","checkOut","checkInAt","checkOutAt","workMinutes",COALESCE(checkout_inferred,false) inferred
               FROM attendance WHERE "employeeId"=$1 AND date IN ('2026-11-01','2026-11-02') ORDER BY date`,
            [EMPLOYEE_ID]
        );
        console.log('AFTER');
        for (const r of after.rows) {
            console.log(` ${r.date} | in ${r.checkIn} (${String(r.checkInAt).slice(0, 24)}) | out ${r.checkOut || '—'} (${r.checkOutAt ? String(r.checkOutAt).slice(0, 24) : '—'}) | ${r.workMinutes ?? '—'} د | inferred=${r.inferred}`);
        }
        await client.query('COMMIT');
        console.log(`COMMITTED — انصراف 01/11 = ${wallTime(OUT_11)} (${WORK_11} د)`);
    } catch (e) {
        await client.query('ROLLBACK');
        console.error('ROLLED BACK:', e.message);
        process.exitCode = 1;
    } finally {
        client.release();
    }
}

main().finally(() => pool.end());
