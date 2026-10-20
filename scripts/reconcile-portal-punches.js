// reconcile-portal-punches.js — مطابقة البصمات المقبولة مع سجل الحضور
// HARDENED 2026-10-07: بصمات وجه مقبولة (ثقة 100) ضاعت من سجل الحضور أيام
// 3-6 أكتوبر (صفوف قديمة/ناقصة) — هذا المسخّن يملأ الفجوات فقط:
//   • صف ناقص + بصمة مقبولة بنفس اليوم = تعبئة الدخول (لا مساس بأي قيمة موجودة)
//   • لا صف أصلًا = إنشاء صف دخول من البصمة
//   • لا يعدّل انصرافًا ولا يعيد كتابة أي شيء — آمن على التكرار
// التشغيل: مهمة مجدولة كل 30 دقيقة + يدويًا: node scripts/reconcile-portal-punches.js
'use strict';
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const ROOT = path.join(__dirname, '..');
for (const line of fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m) {process.env[m[1]] = m[2];}
}
const pad = n => String(n).padStart(2, '0');
const wallOf = (d) => {
    const p = {};
    for (const x of new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(d)) {p[x.type] = x.value;}
    return { date: `${p.year}-${p.month}-${p.day}`, time: `${pad(Number(p.hour) % 24)}:${p.minute}` };
};

(async () => {
    const pg = new Pool({
        host: process.env.DB_HOST || '127.0.0.1', port: Number(process.env.DB_PORT) || 5432,
        database: process.env.DB_NAME || 'karim_erp', user: process.env.DB_USER || 'postgres',
        password: process.env.DB_PASSWORD,
    });
    const atts = (await pg.query(
        `SELECT id, employee_id, attempted_at, trust_score, engine_result FROM punch_attempts
          WHERE decision = 'accepted' AND attempted_at >= NOW() - INTERVAL '3 days'
          ORDER BY attempted_at`)).rows;
    let filled = 0, created = 0, ok = 0, skippedOut = 0;
    for (const a of atts) {
        if (!a.employee_id) {continue;}
        // حارس 2026-10-11: بصمة خروج أغلقت صف أمس — لا تُنشأ صف دخول لليوم الجديد
        // (المصنع الذكي يغلق صف أمس ثم هذا المسخّن يفتح صف شبح لليوم — نفس البصمة!)
        let engineAction = null;
        try { engineAction = a.engine_result?.action || null; } catch (_) {}
        if (engineAction === 'check_out') { skippedOut++; continue; }
        const instant = new Date(a.attempted_at);
        const w = wallOf(instant);
        const rows = (await pg.query(
            `SELECT id, "checkIn", "checkOut" FROM attendance WHERE "employeeId"::text = $1 AND date = $2 ORDER BY id LIMIT 3`,
            [String(a.employee_id), w.date])).rows;
        if (!rows.length) {
            const nid = Date.now() * 1000 + Math.floor(Math.random() * 900);
            await pg.query(
                `INSERT INTO attendance (id, "employeeId", date, "checkIn", "checkInAt", source, notes)
                 VALUES ($1,$2,$3,$4,$5,'portal','بصمة وجه مقبولة — أُنشئ تلقائيًا بالمطابق الدوري') ON CONFLICT (id) DO NOTHING`,
                [nid, String(a.employee_id), w.date, w.time, instant.toISOString()]);
            created++;
        } else {
            const row = rows[0];
            if (!row.checkIn) {
                await pg.query(
                    `UPDATE attendance SET "checkIn" = $2, "checkInAt" = $3,
                     notes = COALESCE(notes,'') || ' | بصمة وجه مقبولة — عُبئ الدخول تلقائيًا بالمطابق الدوري'
                     WHERE id = $1 AND "checkIn" IS NULL`,
                    [row.id, w.time, instant.toISOString()]);
                filled++;
            } else { ok++; }
        }
    }
    console.log(JSON.stringify({ checked: atts.length, filled, created, ok, skippedOut }));
    await pg.end();
})().catch(e => { console.error('RECONCILE_FAILED:', e.message); process.exit(1); });
