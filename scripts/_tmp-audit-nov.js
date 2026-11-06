'use strict';
/* مؤقت: تدقيق شامل قراءة-only — كل صفوف حضور في نطاق تاريخ:
 * هل checkIn / checkOut مسنودان بصمة حقيقية (attendance_logs أو punch_attempts)
 * خلال ±25 دقيقة؟ أي قيمة بلا بصمة = «بلا بصمة» (مرشح للكشف). */
require('dotenv').config();
const { Client } = require('pg');

const TZ = 3 * 3600 * 1000;
const from = process.argv[2] || '2026-11-01';
const to = process.argv[3] || '2026-12-01';
const RADIUS = 25 * 60000;

function candidates(dateStr, hhmm) {
    const [h, m] = hhmm.split(':').map(Number);
    const [y, mo, d] = dateStr.split('-').map(Number);
    const out = [];
    for (const off of [0, 1]) {
        out.push(Date.UTC(y, mo - 1, d) + off * 86400000 + (h * 60 + m) * 60000 - TZ);
    }
    return out;
}

(async () => {
    const db = new Client({
        host: process.env.DB_HOST || '127.0.0.1',
        port: Number(process.env.DB_PORT || 5432),
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME || 'karim_erp',
    });
    await db.connect();

    const rows = (await db.query(
        `SELECT a.id, a."employeeId", e.name, a.date, a."checkIn", a."checkOut", a.source, a.notes
           FROM attendance a JOIN employees e ON e.id = a."employeeId"
          WHERE a.date >= $1 AND a.date < $2
          ORDER BY a.date, a."employeeId"`, [from, to])).rows;
    console.log(`ROWS: ${rows.length} (${from} .. ${to})`);

    // نجمّع نافذة واحدة لكل موظف+قيمة لتسريع الفحص (batch)
    async function backed(employeeId, dateStr, hhmm) {
        for (const at of candidates(dateStr, hhmm)) {
            const f = new Date(at - RADIUS), t = new Date(at + RADIUS);
            const l = await db.query(
                `SELECT count(*)::int n FROM attendance_logs
                  WHERE "employeeId"=$1 AND "attendanceTime">=$2 AND "attendanceTime"<=$3`,
                [employeeId, f, t]);
            if (l.rows[0].n > 0) return 'attendance_logs';
            const p = await db.query(
                `SELECT count(*)::int n FROM punch_attempts
                  WHERE "employee_id"=$1 AND decision='accepted' AND "attempted_at">=$2 AND "attempted_at"<=$3`,
                [employeeId, f, t]);
            if (p.rows[0].n > 0) return 'punch_attempts';
        }
        return null;
    }

    const badIn = [], badOut = [];
    for (const r of rows) {
        if (r.checkIn && !(await backed(r.employeeId, r.date, r.checkIn))) badIn.push(r);
        if (r.checkOut && !(await backed(r.employeeId, r.date, r.checkOut))) badOut.push(r);
    }

    const dump = (label, arr, f) => {
        console.log(`\n=== ${label}: ${arr.length} ===`);
        for (const r of arr) {
            console.log(`${r.date} | emp=${r.employeeId} ${r.name} | ${f}=${f === 'IN' ? r.checkIn : r.checkOut} | src=${r.source} | ${(r.notes || '').slice(0, 80)}`);
        }
    };
    dump('دخول بلا بصمة', badIn, 'IN');
    dump('انصراف بلا بصمة', badOut, 'OUT');

    await db.end();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
