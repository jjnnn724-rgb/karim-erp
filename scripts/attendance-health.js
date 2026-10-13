'use strict';
/* attendance-health.js — فحص يومي لصحة البصمة والحضور: الجهاز، البصمات اليتيمة، الخروج الناقص.
 * يُشغَّل بمهمة مجدولة يوميًا 07:30. أي مشكلة تُسجَّل في logs/attendance-health.log للمراجعة. */
const fs = require('fs');
const path = require('path');
const { pool } = require('../backend/shared-pool');

const LOGF = path.join(__dirname, '..', 'logs', 'attendance-health.log');
function log(line) {
    const s = `[${new Date().toISOString()}] ${line}\n`;
    fs.appendFileSync(LOGF, s);
    console.log(line);
}

(async () => {
    const problems = [];
    // 1) الجهاز: آخر مزامنة خلال 10 دقائق؟
    const dev = (await pool.query(`SELECT id, name, status, "lastSyncAt", "lastError" FROM attendance_devices WHERE enabled = TRUE ORDER BY id LIMIT 1`)).rows[0];
    if (!dev) { problems.push('NO_ENABLED_DEVICE'); }
    else {
        const ageMin = dev.lastSyncAt ? (Date.now() - new Date(dev.lastSyncAt).getTime()) / 60000 : 9999;
        if (ageMin > 10) { problems.push(`DEVICE_STALE:${dev.name}:lastSync=${dev.lastSyncAt}`); }
    }
    // 2) بصمات يتيمة آخر 24 ساعة
    const orph = (await pool.query(`SELECT "deviceUserId", count(*) AS c FROM attendance_logs WHERE "employeeId" IS NULL AND "attendanceTime" >= NOW() - INTERVAL '24 hours' GROUP BY 1 ORDER BY 2 DESC LIMIT 10`)).rows;
    for (const o of orph) { problems.push(`ORPHAN_PUNCHES:deviceUserId=${o.deviceUserId}:count=${o.c}`); }
    // 3) خروج ناقص ليوم أمس
    const miss = (await pool.query(`SELECT count(*)::int AS c FROM attendance WHERE date = to_char(NOW() - INTERVAL '1 day', 'YYYY-MM-DD') AND "checkIn" IS NOT NULL AND "checkOut" IS NULL`)).rows[0].c;
    if (miss > 0) { problems.push(`MISSING_CHECKOUT_YESTERDAY:${miss}`); }
    // 4) ربط مزدوج غامض (نفس الرقم uid لشخص وuserId لآخر مع اسمين حقيقيين) — يُكتشف عبر zk-id-sync
    // 11) رؤساء أقسام بأكواد يتيمة (لا تطابق أي قسم تشغيلي ولا HR — شاشة بيضاء عند الدخول)
    // 9) دخول == خروج (بصمة مفردة سُجّلت طرفين — يجب أن تكون صفرًا بعد إصلاح الاسترداد)
    try {
        const orph = (await pool.query(
            `SELECT u.username FROM users u WHERE u.role = 'dept_head' AND u.dept_code IS NOT NULL AND u.dept_code <> ''
             AND NOT EXISTS (SELECT 1 FROM unnest(string_to_array(u.dept_code, ',')) c
               WHERE LOWER(TRIM(c)) IN (SELECT LOWER(code) FROM departments UNION SELECT LOWER(code) FROM "hrDepartments")) LIMIT 10`
        )).rows;
        for (const o of orph) { problems.push(`ORPHAN_DEPT_HEAD:${o.username}`); }
    } catch (_) {}
    const same = (await pool.query(`SELECT count(*)::int AS c FROM attendance WHERE date >= to_char(NOW() - INTERVAL '7 days', 'YYYY-MM-DD') AND "checkIn" IS NOT NULL AND "checkIn" = "checkOut"`)).rows[0].c;
    if (same > 0) { problems.push(`INOUT_SAME:${same}`); }
    // 5) صفوف مفتوحة مكررة لنفس الموظف (تسرب منطقي)
    const dup = (await pool.query(`SELECT "employeeId", count(*) AS c FROM attendance WHERE "checkOut" IS NULL AND "checkInAt" >= NOW() - INTERVAL '3 days' GROUP BY 1 HAVING count(*) > 1 LIMIT 5`)).rows;
    for (const d of dup) { problems.push(`DUP_OPEN_ROWS:emp=${d.employeeId}:count=${d.c}`); }
    // 6) خروج قبل دخول أو دقائق سالبة (فساد بيانات)
    const bad = (await pool.query(`SELECT count(*)::int AS c FROM attendance WHERE date >= to_char(NOW() - INTERVAL '7 days', 'YYYY-MM-DD') AND (("checkOutAt" IS NOT NULL AND "checkInAt" IS NOT NULL AND "checkOutAt" < "checkInAt") OR "workMinutes" < 0)`)).rows[0].c;
    if (bad > 0) { problems.push(`TIME_CORRUPT:${bad}`); }
    // 7) نسبة المستنتج آخر 7 أيام (مؤشر انضباط — تنبيه فوق 15%)
    const inf = (await pool.query(`SELECT count(*)::int AS t, COUNT(*) FILTER (WHERE checkout_inferred = TRUE)::int AS i FROM attendance WHERE date >= to_char(NOW() - INTERVAL '7 days', 'YYYY-MM-DD') AND "checkIn" IS NOT NULL`)).rows[0];
    if (inf.t > 0 && (inf.i / inf.t) > 0.15) { problems.push(`HIGH_INFERRED:${inf.i}/${inf.t}`); }
    // 10) خط أساس شاذ في المدة فقط (بداية الدوام المتغيرة شرعية وتُحل بتاريخها؛
    // المدة المسمومة هي ما يفسد حساب العجز — كما حدث مع إسحاق)
    try {
        const base = (await pool.query(
            `WITH d AS (
               SELECT a."employeeId",
                 (EXTRACT(HOUR FROM a."checkOut"::time)*60 - EXTRACT(HOUR FROM a."checkIn"::time)*60
                  + CASE WHEN a."checkOut"::time < a."checkIn"::time THEN 1440 ELSE 0 END) AS w
               FROM attendance a WHERE a.date >= to_char(NOW() - INTERVAL '30 days', 'YYYY-MM-DD')
                 AND a."checkIn" ~ ':' AND a."checkOut" ~ ':' AND NOT COALESCE(a.on_leave, false)
             ), m AS (SELECT "employeeId", percentile_cont(0.5) WITHIN GROUP (ORDER BY w)::int AS med
                      FROM d GROUP BY 1 HAVING count(*) >= 5)
             SELECT e.name FROM employees e
             JOIN employee_shift_history h ON h.employee_id = e.id AND h.effective_from = DATE '2000-01-01'
             JOIN m ON m."employeeId" = e.id
             WHERE e.status = 'active'
               AND e.shift_karim IS DISTINCT FROM h.shift_karim
               AND ABS(m.med - ROUND(e.shift_karim*60)) <= 60 LIMIT 10`
        )).rows;
        for (const b of base) { problems.push(`BASE_MISMATCH:${b.name}`); }
    } catch (_) {}
    try {
        const drift = (await pool.query(
            `WITH d AS (
               SELECT a."employeeId",
                 (EXTRACT(HOUR FROM a."checkOut"::time)*60 + EXTRACT(MINUTE FROM a."checkOut"::time)
                - EXTRACT(HOUR FROM a."checkIn"::time)*60 - EXTRACT(MINUTE FROM a."checkIn"::time)
                + CASE WHEN a."checkOut"::time < a."checkIn"::time THEN 1440 ELSE 0 END) AS worked_min
               FROM attendance a
               WHERE a.date >= to_char(NOW() - INTERVAL '30 days', 'YYYY-MM-DD')
                 AND a."checkIn" ~ '^([01]?[0-9]|2[0-3]):[0-5][0-9]$' AND a."checkOut" ~ '^([01]?[0-9]|2[0-3]):[0-5][0-9]$'
                 AND NOT COALESCE(a.on_leave, false)
             ), m AS (
               SELECT "employeeId", count(*) AS n, percentile_cont(0.5) WITHIN GROUP (ORDER BY worked_min)::int AS med
               FROM d GROUP BY 1 HAVING count(*) >= 5
             )
             SELECT e.name, m.med, ROUND(e.shift_karim*60)::int AS card_min
             FROM m JOIN employees e ON e.id = m."employeeId"
             WHERE ABS(m.med - ROUND(e.shift_karim*60)) > 60 AND e.status = 'active' LIMIT 20`
        )).rows;
        for (const r of drift) { problems.push(`CARD_DRIFT:${r.name}:pattern=${r.med}m:card=${r.card_min}m`); }
        // الفاعل: آخر من غيّر البطاقة (من السجل التاريخي) — أي ارتكاس قادم مسمّى بصاحبه
        try {
            const actors = (await pool.query(
                `SELECT h.employee_id, h.created_by, u.username, h.created_at FROM employee_shift_history h
                 LEFT JOIN users u ON u.id = h.created_by
                 WHERE h.employee_id IN (SELECT m."employeeId" FROM (
                   SELECT d."employeeId" FROM (SELECT a."employeeId",
                     (EXTRACT(HOUR FROM a."checkOut"::time)*60 - EXTRACT(HOUR FROM a."checkIn"::time)*60
                      + CASE WHEN a."checkOut"::time < a."checkIn"::time THEN 1440 ELSE 0 END) AS w
                     FROM attendance a WHERE a.date >= to_char(NOW() - INTERVAL '30 days', 'YYYY-MM-DD')
                     AND a."checkIn" ~ ':' AND a."checkOut" ~ ':' AND NOT COALESCE(a.on_leave, false)) d
                   GROUP BY 1) m)
                 ORDER BY h.created_at DESC LIMIT 5`
            )).rows;
            for (const a of actors) { problems.push(`CARD_ACTOR:emp=${a.employee_id}:by=${a.username || a.created_by || '?'}:at=${a.created_at}`); }
        } catch (_) {}
    } catch (e) { problems.push('DRIFT_CHECK_FAILED:' + String((e && e.message) || e).slice(0, 80)); }
    if (!problems.length) { log('OK: device fresh, no orphans, no missing checkouts'); }
    else { for (const p of problems) { log('PROBLEM: ' + p); } }
    await pool.end();
    process.exit(problems.length ? 2 : 0);
})().catch((e) => { log('ERROR: ' + (e && e.message)); process.exit(1); });
