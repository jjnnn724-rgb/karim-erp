'use strict';
/* مؤقت: تدقيق صارم قراءة-only:
 * (A) قيمة بلا أي بصمة في ±25 دقيقة
 * (B) ازدحام حقيقي: نفس البصمة هي الظهير الوحيد لقيمتين أو أكثر
 * (C) صفوف مكررة (نفس الموظف + نفس التاريخ)
 * البصمة لكل قيمة تُحسب كاملة (قد تكون للقيمة بصمتان فهما يحلّان الازدحام). */
require('dotenv').config();
const { Client } = require('pg');

const RADIUS = 25 * 60000;
const TZ = 3 * 3600 * 1000;

(async () => {
    const db = new Client({
        host: process.env.DB_HOST || '127.0.0.1',
        port: Number(process.env.DB_PORT || 5432),
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME || 'karim_erp',
    });
    await db.connect();

    const att = (await db.query(
        `SELECT id, "employeeId", date, "checkIn", "checkOut"
           FROM attendance WHERE "checkIn" IS NOT NULL OR "checkOut" IS NOT NULL`)).rows;
    const logs = (await db.query(
        `SELECT "employeeId", "attendanceTime" AS at FROM attendance_logs WHERE "employeeId" IS NOT NULL`)).rows;
    const attempts = (await db.query(
        `SELECT "employee_id" AS "employeeId", "attempted_at" AS at FROM punch_attempts
          WHERE decision='accepted' AND "employee_id" IS NOT NULL`)).rows;

    const byEmp = new Map();
    for (const p of [...logs, ...attempts]) {
        const k = String(p.employeeId);
        if (!byEmp.has(k)) byEmp.set(k, []);
        byEmp.get(k).push(p.at.getTime());
    }
    // دمج التسجيلات المتطابقة (<3 ثوانٍ — نفس الحدث في attendance_logs و punch_attempts)
    for (const [k, arr] of byEmp.entries()) {
        arr.sort((a, b) => a - b);
        const dedup = [];
        for (const t of arr) {
            if (dedup.length && t - dedup[dedup.length - 1] < 3000) continue;
            dedup.push(t);
        }
        byEmp.set(k, dedup);
    }

    function punchesNear(empId, dateStr, hhmm) {
        const arr = byEmp.get(String(empId));
        if (!arr) return [];
        const [h, m] = hhmm.split(':').map(Number);
        const [y, mo, d] = dateStr.split('-').map(Number);
        const hits = new Set();
        for (const off of [0, 1]) {
            const center = Date.UTC(y, mo - 1, d) + off * 86400000 + (h * 60 + m) * 60000 - TZ;
            for (const t of arr) {
                if (t >= center - RADIUS && t <= center + RADIUS) hits.add(t);
            }
        }
        return [...hits];
    }

    const values = []; // {id, emp, date, field, value, punches[]}
    for (const r of att) {
        for (const field of ['checkIn', 'checkOut']) {
            const v = r[field];
            if (!v) continue;
            values.push({ id: r.id, emp: r.employeeId, date: r.date, field, value: v, punches: punchesNear(r.employeeId, r.date, v) });
        }
    }

    // (A)
    const unbacked = values.filter((v) => v.punches.length === 0);

    // (B) ازدحام صارم: بصمة p ظهير وحيد لقيمتين+
    const soleByPunch = new Map(); // punchTs -> [value]
    for (const v of values) {
        if (v.punches.length === 1) {
            const t = v.punches[0];
            if (!soleByPunch.has(t)) soleByPunch.set(t, []);
            soleByPunch.get(t).push(v);
        }
    }
    const hardConflicts = [...soleByPunch.entries()].filter(([, vs]) => vs.length > 1);

    // (C) تكرار صفوف
    const dupq = await db.query(
        `SELECT "employeeId", date, count(*)::int AS n, array_agg(id) AS ids
           FROM attendance GROUP BY "employeeId", date HAVING count(*) > 1`);
    const dupes = dupq.rows;

    const fmt = (t) => new Date(t + TZ).toISOString().replace('T', ' ').slice(0, 16);

    console.log(`SIZES: rows=${att.length} values=${values.length} punches=${[...byEmp.values()].reduce((s, a) => s + a.length, 0)}`);
    console.log(`\n(A) قيم بلا بصمة إطلاقًا: ${unbacked.length}`);
    for (const v of unbacked) console.log(`  ${v.date} emp=${v.emp} ${v.field}=${v.value} row=${v.id}`);
    console.log(`\n(B) ازدحام صارم (بصمة وحيدة لقيمتين+): ${hardConflicts.length}`);
    for (const [t, vs] of hardConflicts) {
        console.log(`  punch=${fmt(t)}Riyadh <= ${vs.map((v) => `${v.date}.${v.field}=${v.value}(emp ${v.emp}, row ${v.id})`).join('  |  ')}`);
    }
    console.log(`\n(C) نفس الموظف+التاريخ في صفين أو أكثر: ${dupes.length}`);
    for (const d of dupes.slice(0, 40)) {
        console.log(`  emp=${d.employeeId} date=${d.date} n=${d.n} ids=${d.ids.join(',')}`);
    }
    if (dupes.length > 40) console.log(`  ... و${dupes.length - 40} مجموعة أخرى`);

    // (D) employeeId غير موجود في جدول employees
    const bad = await db.query(
        `SELECT a.id, a."employeeId", a.date, a."checkIn", a."checkOut"
           FROM attendance a LEFT JOIN employees e ON e.id = a."employeeId"
          WHERE e.id IS NULL`);
    console.log(`\n(D) صفوف بـ employeeId غير موجود في employees: ${bad.rows.length}`);
    for (const b of bad.rows) console.log(`  row=${b.id} emp=${b.employeeId} ${b.date} in=${b.checkIn || '-'} out=${b.checkOut || '-'}`);

    await db.end();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
