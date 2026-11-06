'use strict';
/* مؤقت: فحص صفوف حضور موظف بالاسم (قراءة فقط) */
require('dotenv').config();
const { Client } = require('pg');
(async () => {
    const c = new Client({
        host: process.env.DB_HOST || '127.0.0.1',
        port: Number(process.env.DB_PORT || 5432),
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME || 'karim_erp',
    });
    await c.connect();
    const name = process.argv[2] || 'المخلافي';
    const emps = await c.query(
        `SELECT id, "employeeId", name, "shift_start", "shift_karim", status, department
           FROM employees WHERE name ILIKE $1 ORDER BY id`, [`%${name}%`]);
    console.log('EMPLOYEES:', JSON.stringify(emps.rows, null, 2));
    for (const e of emps.rows) {
        const att = await c.query(
            `SELECT id, date, "checkIn", "checkOut", "checkInAt", "checkOutAt", "workMinutes",
                    late, early_leave, source, notes, on_leave, "checkin_inferred", "checkout_inferred"
               FROM attendance WHERE "employeeId" = $1
              ORDER BY date DESC LIMIT 40`, [e.id]);
        console.log(`\nATTENDANCE emp=${e.id} ${e.name} (rows=${att.rows.length}):`);
        for (const r of att.rows) {
            console.log([
                r.date,
                `in=${r.checkIn || '-'}`,
                `out=${r.checkOut || '-'}`,
                `wm=${r.workMinutes ?? '-'}`,
                `late=${r.late}`,
                `src=${r.source || '-'}`,
                `inf=${r.checkin_inferred || r.checkout_inferred ? `IN:${r.checkin_inferred}/OUT:${r.checkout_inferred}` : '-'}`,
                `notes=${(r.notes || '').slice(0, 90)}`,
            ].join(' | '));
        }
    }
    await c.end();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
