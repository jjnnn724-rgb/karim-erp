'use strict';
/* مؤقت: تدقيق قراءة-only لصفوف الحضور التي كُتبت فيها «تكملة» (اختلاق)
 * لكل صف: هل القيمة مسنودة بصمة حقيقية (attendance_logs / punch_attempts) أم لا؟
 * لا يكتب شيئًا — تقرير فقط. */
require('dotenv').config();
const { Client } = require('pg');

const MARKERS = [
    ['inferred_out', /مستنتج/],
    ['periodic_match', /المطابق الدوري/],
    ['late_face_create', /أُنشئ السجل متأخرًا/],
    ['face_confirmed', /بصمة دخول وجه مؤكدة/],
    ['session_rebuild', /إعادة بناء اليوم من البصمات الخام/],
    ['recovered_in', /دخول مسترد من سجل البصمات/],
    ['restored_row', /استعادة صفّ حضور من سجل بصمات الجهاز/],
];

const TZ = 3 * 3600 * 1000; // Asia/Riyadh
const pad = (n) => String(n).padStart(2, '0');

/** نافذة لحظات ممكنة لقيمة HH:MM على تاريخ (وتاريخ+1 للوردية الليلية) */
function candidateInstants(dateStr, hhmm) {
    const [h, m] = hhmm.split(':').map(Number);
    const out = [];
    for (const dayOffset of [0, 1]) {
        const [y, d, dd] = [dateStr.slice(0, 4), dateStr.slice(5, 7), dateStr.slice(8, 10)];
        const base = Date.UTC(Number(y), Number(d) - 1, Number(dd)) + dayOffset * 86400000;
        out.push(base + (h * 60 + m) * 60000 - TZ);
    }
    return out;
}

async function punchNear(db, employeeId, dateStr, hhmm, radiusMs = 25 * 60000) {
    const instants = candidateInstants(dateStr, hhmm);
    for (const at of instants) {
        const from = new Date(at - radiusMs);
        const to = new Date(at + radiusMs);
        const logs = await db.query(
            `SELECT count(*)::int AS n FROM attendance_logs
              WHERE "employeeId" = $1 AND "attendanceTime" >= $2 AND "attendanceTime" <= $3`,
            [employeeId, from, to]);
        if (logs.rows[0].n > 0) { return { backed: true, via: 'attendance_logs', n: logs.rows[0].n }; }
        const att = await db.query(
            `SELECT count(*)::int AS n FROM punch_attempts
              WHERE "employee_id" = $1 AND decision = 'accepted'
                AND "attempted_at" >= $2 AND "attempted_at" <= $3`,
            [employeeId, from, to]);
        if (att.rows[0].n > 0) { return { backed: true, via: 'punch_attempts', n: att.rows[0].n }; }
    }
    return { backed: false, via: null, n: 0 };
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

    const scope = process.argv[2] || 'all'; // 'all' | 'nov'

    // 1) عدّ الصفوف حسب العلامة
    const counts = {};
    const COUNT_SQL = {
        all: 'SELECT count(*)::int AS n FROM attendance WHERE notes ~ $1',
        nov: "SELECT count(*)::int AS n FROM attendance WHERE notes ~ $1 AND date >= '2026-11-01'",
    };
    for (const [key, re] of MARKERS) {
        // النمط وسيطة مربوطة، لا قالب نصّي: نفس الدلالة بلا مخالفة لبوابة sql-interp
        const r = await db.query(COUNT_SQL[scope] || COUNT_SQL.all, [re.source]);
        counts[key] = r.rows[0].n;
    }
    console.log('COUNTS(' + scope + '):', JSON.stringify(counts));

    // 2) الصفوف المرشحة للفحص: التكملة (مستنتج/مطابق دوري/إنشاء متأخر)
    const CANDIDATES_SQL = {
        all: `SELECT a.id, a."employeeId", e.name, a.date, a."checkIn", a."checkOut", a."workMinutes", a.notes
                 FROM attendance a
                 JOIN employees e ON e.id = a."employeeId"
                WHERE (a.notes ~ 'مستنتج' OR a.notes ~ 'المطابق الدوري' OR a.notes ~ 'أُنشئ السجل متأخرًا'
                       OR a.notes ~ 'بصمة دخول وجه مؤكدة')
                ORDER BY a.date DESC, a.id
                LIMIT 400`,
        nov: `SELECT a.id, a."employeeId", e.name, a.date, a."checkIn", a."checkOut", a."workMinutes", a.notes
                 FROM attendance a
                 JOIN employees e ON e.id = a."employeeId"
                WHERE (a.notes ~ 'مستنتج' OR a.notes ~ 'المطابق الدوري' OR a.notes ~ 'أُنشئ السجل متأخرًا'
                       OR a.notes ~ 'بصمة دخول وجه مؤكدة')
                  AND a.date >= '2026-11-01'
                ORDER BY a.date DESC, a.id
                LIMIT 400`,
    };
    const rows = (await db.query(CANDIDATES_SQL[scope] || CANDIDATES_SQL.all)).rows;

    console.log(`\nCANDIDATES: ${rows.length}`);
    const unbackedIn = [], unbackedOut = [], backedAll = [];
    for (const r of rows) {
        if (r.checkIn) {
            const v = await punchNear(db, r.employeeId, r.date, r.checkIn);
            if (!v.backed) { unbackedIn.push(r); } else { r._inVia = v.via; }
        }
        if (r.checkOut) {
            const v = await punchNear(db, r.employeeId, r.date, r.checkOut);
            if (!v.backed) { unbackedOut.push(r); } else { r._outVia = v.via; }
        }
        if (r.checkIn && r.checkOut && r._inVia && r._outVia) { backedAll.push(r); }
    }

    const show = (label, arr, field) => {
        console.log(`\n=== ${label}: ${arr.length} ===`);
        for (const r of arr.slice(0, 25)) {
            console.log(`${r.date} | emp=${r.employeeId} ${r.name} | in=${r.checkIn || '-'} out=${r.checkOut || '-'} | ${field} | ${(r.notes || '').slice(0, 70)}`);
        }
        if (arr.length > 25) { console.log(`... و${arr.length - 25} صفوف أخرى`); }
    };
    show('دخول بلا بصمة خام (اختلاق دخول)', unbackedIn, 'IN=UNBACKED');
    show('انصراف بلا بصمة خام (اختلاق انصراف)', unbackedOut, 'OUT=UNBACKED');
    console.log(`\nBACKED_BOTH: ${backedAll.length}`);

    // 3) ملخص إجمالي لصفوف نوفمبر التي فيها أي علامة تكملة
    const nov = await db.query(
        `SELECT count(*)::int AS n FROM attendance
          WHERE date >= '2026-11-01'
            AND (notes ~ 'مستنتج' OR notes ~ 'المطابق الدوري' OR notes ~ 'أُنشئ السجل متأخرًا'
                 OR notes ~ 'إعادة بناء اليوم' OR notes ~ 'بصمة دخول وجه مؤكدة')`);
    console.log(`\nNOV_MARKED_ROWS: ${nov.rows[0].n}`);

    await db.end();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
