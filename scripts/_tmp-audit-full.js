'use strict';
/* مؤقت: تدقيق شامل قراءة-only لكل جدول attendance:
 *  (A) قيمة (checkIn/checkOut) بلا بصمة خام في ±25 دقيقة
 *  (B) بصمة خامة استُخدمت لأكثر من قيمة (استخدام مزدوج)
 * المخرجات: قوائم ids + counts فقط — لا كتابة. */
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

    // أحجام أولًا
    const sz = await db.query(`SELECT
        (SELECT count(*) FROM attendance) AS att,
        (SELECT count(*) FROM attendance_logs) AS logs,
        (SELECT count(*) FROM punch_attempts WHERE decision='accepted') AS attempts`);
    console.log('SIZES:', JSON.stringify(sz.rows[0]));

    // كل الصفوف التي لها قيمة واحدة على الأقل
    const att = (await db.query(
        `SELECT id, "employeeId", date, "checkIn", "checkOut"
           FROM attendance WHERE "checkIn" IS NOT NULL OR "checkOut" IS NOT NULL`)).rows;
    // كل البصمات الخام
    const logs = (await db.query(
        `SELECT "employeeId", "attendanceTime" AS at FROM attendance_logs WHERE "employeeId" IS NOT NULL`)).rows;
    const attempts = (await db.query(
        `SELECT "employee_id" AS "employeeId", "attempted_at" AS at FROM punch_attempts
          WHERE decision='accepted' AND "employee_id" IS NOT NULL`)).rows;

    // مطابقة بالبحث الثنائي بعد الترتيب
    const byEmp = new Map();
    for (const p of [...logs, ...attempts]) {
        const k = String(p.employeeId);
        if (!byEmp.has(k)) byEmp.set(k, []);
        byEmp.get(k).push(p.at.getTime());
    }
    for (const arr of byEmp.values()) arr.sort((a, b) => a - b);

    function punchesNear(empId, dateStr, hhmm) {
        const arr = byEmp.get(String(empId));
        if (!arr) return [];
        const [h, m] = hhmm.split(':').map(Number);
        const [y, mo, d] = dateStr.split('-').map(Number);
        const hits = [];
        for (const off of [0, 1]) {
            const center = Date.UTC(y, mo - 1, d) + off * 86400000 + (h * 60 + m) * 60000 - TZ;
            // بحث خطي من موضع مناسب
            for (const t of arr) {
                if (t >= center - RADIUS && t <= center + RADIUS) hits.push(t);
                else if (t > center + RADIUS) break;
            }
        }
        return hits;
    }

    const unbacked = [];       // (A)
    const usage = new Map();   // (B) punchTime -> [{row, field}]
    for (const r of att) {
        for (const field of ['checkIn', 'checkOut']) {
            const v = r[field];
            if (!v) continue;
            const hits = punchesNear(r.employeeId, r.date, v);
            if (hits.length === 0) { unbacked.push({ ...r, field, value: v }); continue; }
            const t = hits[0];
            if (!usage.has(t)) usage.set(t, []);
            usage.get(t).push({ id: r.id, emp: r.employeeId, date: r.date, field, value: v });
        }
    }

    const doubleUsed = [...usage.entries()].filter(([, v]) => v.length > 1);

    console.log(`\n(A) قيم بلا بصمة خام: ${unbacked.length}`);
    for (const u of unbacked) console.log(`  ${u.date} emp=${u.emp} ${u.field}=${u.value} row=${u.id}`);

    console.log(`\n(B) بصمات استُخدمت لأكثر من قيمة: ${doubleUsed.length}`);
    for (const [t, uses] of doubleUsed) {
        const iso = new Date(t + TZ).toISOString().replace('T', ' ').slice(0, 16);
        console.log(`  punch=${iso}Riyadh -> ${uses.map((u) => `${u.date}.${u.field}=${u.value}(row ${u.id})`).join('  |  ')}`);
    }

    await db.end();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
