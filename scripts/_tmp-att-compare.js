'use strict';
/* مؤقت: مقارنة تفصيلية قراءة-only — بصمات موظف خام (attendance_logs + punch_attempts)
 * مقابل صفوف attendance في نطاق تاريخ. */
require('dotenv').config();
const { Client } = require('pg');

const emp = Number(process.argv[2] || 84);
const from = process.argv[3] || '2026-11-01';
const to = process.argv[4] || '2026-12-01';

(async () => {
    const db = new Client({
        host: process.env.DB_HOST || '127.0.0.1',
        port: Number(process.env.DB_PORT || 5432),
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME || 'karim_erp',
    });
    await db.connect();

    const e = (await db.query(`SELECT id, name, "shift_start", "shift_karim" FROM employees WHERE id=$1`, [emp])).rows[0];
    console.log(`EMP ${emp}: ${e.name} | shift ${e.shift_start} +${e.shift_karim}h`);

    console.log('\n--- attendance rows ---');
    const att = await db.query(
        `SELECT date, "checkIn", "checkOut", "workMinutes", source, notes
           FROM attendance WHERE "employeeId"=$1 AND date >= $2 AND date < $3 ORDER BY date`, [emp, from, to]);
    for (const r of att.rows) console.log(`${r.date} | in=${r.checkIn || '-'} out=${r.checkOut || '-'} wm=${r.workMinutes ?? '-'} | ${r.source} | ${(r.notes || '').slice(0, 100)}`);

    console.log('\n--- attendance_logs (device raw) ---');
    const logs = await db.query(
        `SELECT "attendanceTime", "punchState", source, "deviceId"
           FROM attendance_logs WHERE "employeeId"=$1
             AND "attendanceTime" >= $2 AND "attendanceTime" < $3
          ORDER BY "attendanceTime"`, [emp, new Date(Date.UTC(2026, 10, 1)), new Date(Date.UTC(2026, 11, 1))]);
    for (const r of logs.rows) console.log(`${r.attendanceTime.toISOString()} | state=${r.punchState} | ${r.source} | dev=${r.deviceId}`);

    console.log('\n--- punch_attempts (portal/camera accepted) ---');
    const att2 = await db.query(
        `SELECT "attempted_at", decision, "device_id"
           FROM punch_attempts WHERE "employee_id"=$1
             AND "attempted_at" >= $2 AND "attempted_at" < $3
          ORDER BY "attempted_at"`, [emp, new Date(Date.UTC(2026, 10, 1)), new Date(Date.UTC(2026, 11, 1))]);
    for (const r of att2.rows) console.log(`${r.attempted_at.toISOString()} | ${r.decision} | ${r.device_id}`);

    await db.end();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
