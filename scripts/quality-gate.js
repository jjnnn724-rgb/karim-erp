#!/usr/bin/env node
// quality-gate.js — بوابة الجودة الموحدة: أمر واحد يقيس المشروع كله بأرقام حقيقية.
// التشغيل: node scripts/quality-gate.js  (أي حد يشغلها يطلع نفس النتائج)
'use strict';
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const ROOT = path.join(__dirname, '..');
// شل مستقل: يضمن وجود git/df من أي بيئة تشغيل (cmd/bash).
process.env.PATH = ["C:\\Users\\RemoteHome\\AppData\\Local\\hermes\\git\\cmd", "C:\\Users\\RemoteHome\\AppData\\Local\\hermes\\git\\usr\\bin", "C:\\Users\\RemoteHome\\AppData\\Local\\hermes\\git\\bin", "C:\\Windows\\System32", process.env.PATH].join(";");
for (const line of fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m && process.env[m[1]] === undefined) {process.env[m[1]] = m[2];}
}
const results = [];
const gate = (name, pass, got) => { results.push({ name, pass, got: String(got).slice(0, 90) }); };

// 1) Git
let lastCommit;
try { lastCommit = execSync('git log -1 --format="%h %cd" --date=relative', { cwd: ROOT }).toString().trim(); gate('Git — تاريخ تغييرات موثق', true, lastCommit); }
catch (e) { gate('Git — تاريخ تغييرات موثق', false, e.message); }

// 2+3) قواعد البيانات: العزل + نظافة الإنتاج
const { Client } = require('pg');
(async () => {
    try {
        const isoDb = new Client({ host: process.env.DB_HOST || '127.0.0.1', port: process.env.DB_PORT || 5432, database: 'postgres', user: process.env.DB_USER, password: process.env.DB_PASSWORD });
        await isoDb.connect();
        const iso = (await isoDb.query("SELECT 1 FROM pg_database WHERE datname='karim_erp_test'")).rows.length === 1;
        gate('عزل الاختبار — قاعدة karim_erp_test معزولة', iso, iso ? 'موجودة' : 'غير موجودة (شغّل jest مرة)');
        await isoDb.end();
        const prod = new Client({ host: process.env.DB_HOST || '127.0.0.1', port: process.env.DB_PORT || 5432, database: process.env.DB_NAME || 'karim_erp', user: process.env.DB_USER, password: process.env.DB_PASSWORD });
        await prod.connect();
        const poll = (await prod.query(`SELECT COUNT(*)::int AS active FROM users
            WHERE active AND (username ~* '^(vault|pwrt|signed|e2e|test|iso|demo|qa|tmp|debug|fake|sample)' OR name ~* '^(PWRT|vault|test|اختبار|E2E)')`)).rows[0].active;
        gate('نظافة الإنتاج — صفر حسابات اختبار نشطة', poll === 0, `نشطة=${poll}`);
        await prod.end();
    } catch (e) { gate('قواعد البيانات', false, e.message); }

    // 4) النسخ الاحتياطي الليلي
    const latestPath = path.join(ROOT, 'database', 'backups', 'karim_erp-latest.dump');
    const hasDump = fs.existsSync(latestPath);
    const ageH = hasDump ? Math.round((Date.now() - fs.statSync(latestPath).mtimeMs) / 3600000) : 999;
    gate('نسخة احتياطية حديثة (أقل من 48 ساعة)', hasDump && ageH < 48, hasDump ? `عمرها ${ageH} ساعة` : 'مفقودة');
    let task = '';
    try { task = execSync('schtasks /query /tn "KarimERP-NightlyBackup"', { encoding: 'utf8' }); } catch (_) {}
    gate('مهمة النسخ الليلي مجدولة', task.includes('KarimERP-NightlyBackup'), task.includes('Ready') ? 'Ready — يوميًا 03:00' : 'غير مجدولة');

    // 5) بوابة الصمت
    const baseline = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts', 'silent-catch-baseline.json'), 'utf8'));
    let current = 0;
    const walk = (dir) => { for (const f of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, f.name); if (f.isDirectory()) { if (f.name !== 'node_modules') {walk(p);} continue; } if (f.name.endsWith('.js')) {current += (fs.readFileSync(p, 'utf8').match(/catch\s*\([^)]*\)\s*\{\s*\}/g) || []).length;} } };
    walk(path.join(ROOT, 'backend'));
    gate('صفر-صمت — لا كتل catch فارغة جديدة', current <= baseline.total, `الحالي=${current} / الأساس=${baseline.total}`);

    // 6) السيرفر حي
    let up = false;
    try { const r = await fetch('https://127.0.0.1:5000/api/attendance/portal/status'); up = (r.status === 401 || r.status === 200); } catch (_) {}
    gate('السيرفر حي ويستجيب', up, up ? 'HTTPS 5000 يستجيب' : 'لا استجابة');

    // 6ب) مجلدات البيانات الحرجة (جلسة واتساب + شهادة HTTPS)
    const dataZipPath = path.join(ROOT, 'database', 'backups', `karim_data-folders-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}.zip`);
    gate('نسخة مجلدات البيانات الحرجة (واتساب+شهادة) اليوم', fs.existsSync(dataZipPath), fs.existsSync(dataZipPath) ? 'موجودة اليوم ✓' : 'مفقودة');

    // 7) القرص
    let freeMB = -1;
    try { const df = execSync('df -k /c | tail -1').toString().trim().split(/\s+/); freeMB = Math.round(Number(df[3]) / 1024); } catch (_) {}
    gate('القرص — مساحة حرة ≥ 500MB', freeMB >= 500, `الحرة=${freeMB}MB`);

    const fails = results.filter((r) => !r.pass);
    console.log('\n════════ بوابة الجودة — Karim ERP ════════');
    for (const r of results) {console.log(`${r.pass ? '✅' : '❌'} ${r.name}  →  ${r.got}`);}
    console.log('==========================================');
    console.log(`النتيجة: ${results.length - fails.length}/${results.length} بوابة ناجحة`);
    process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error('فشل البوابة:', e.message); process.exit(1); });
