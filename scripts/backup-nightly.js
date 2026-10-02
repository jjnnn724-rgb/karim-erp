// backup-nightly.js — نسخة احتياطية ليلية مضغوطة (pg_dump -Fc) + تدوير + latest
// ROOT FIX 2026-10-02: النسخ كانت يدوية والقرص امتلأ — هذه المهمة اليومية:
//   1) pg_dump -Fc كامل → database/backups/karim_erp-nightly-YYYYMMDD.dump
//   2) نسخة ثابتة karim_erp-latest.dump (تُستخدم أيضًا لاستنساخ قاعدة الاختبار)
//   3) تدوير: يحتفظ بآخر 3 نسخ ليلية فقط (حماية القرص)
// التشغيل: مهمة مجدولة يوميًا 03:00 (schtasks) أو يدويًا: node scripts/backup-nightly.js
'use strict';
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const BACKUPS = path.join(ROOT, 'database', 'backups');
const KEEP = 3;

for (const line of fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m) process.env[m[1]] = m[2];
}
const PG = 'C:/Program Files/PostgreSQL/18/bin';
const DB = process.env.DB_NAME || 'karim_erp';
const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');

fs.mkdirSync(BACKUPS, { recursive: true });
const nightly = path.join(BACKUPS, `karim_erp-nightly-${today}.dump`);
console.log('[backup] pg_dump →', nightly);
execFileSync(path.join(PG, 'pg_dump.exe'), [
    '-h', process.env.DB_HOST || '127.0.0.1', '-p', process.env.DB_PORT || '5432',
    '-U', process.env.DB_USER || 'postgres', '-d', DB,
    '-Fc', '-f', nightly,
], { stdio: 'inherit', env: { ...process.env, PGPASSWORD: process.env.DB_PASSWORD } });

const latest = path.join(BACKUPS, 'karim_erp-latest.dump');
fs.copyFileSync(nightly, latest);
console.log('[backup] latest.copy →', latest, `(${Math.round(fs.statSync(latest).size / 1048576)}MB)`);

// تدوير: آخر KEEP نسخ ليلية فقط
const nightlies = fs.readdirSync(BACKUPS)
    .filter((f) => f.startsWith('karim_erp-nightly-') && f.endsWith('.dump'))
    .sort().reverse();
for (const old of nightlies.slice(KEEP)) {
    fs.unlinkSync(path.join(BACKUPS, old));
    console.log('[backup] pruned:', old);
}

// ── نسخ مجلدات البيانات الحرجة: جلسة واتساب + شهادة HTTPS + KarimData ──
// (ROOT FIX 2026-10-02: كانت خارج أي نسخ احتياطي — ضياعها يعني مسح QR
//  وإعادة إصدار شهادة HTTPS). Yarasoft/ يستثنى (20GB staging قابلة للإعادة).
const CRIT = ['C:/HorusData/certs', 'C:/HorusData/whatsapp-sessions', 'C:/HorusData/links', 'C:/KarimData'];
const dataZip = path.join(BACKUPS, `karim_data-folders-${today}.zip`);
try {
    execFileSync('powershell', ['-NoProfile', '-Command',
        `Compress-Archive -Force -Path '${CRIT.join("','")}' -DestinationPath '${dataZip}'`], { stdio: 'pipe' });
    console.log('[backup] data-folders.zip →', dataZip, `(${Math.round(fs.statSync(dataZip).size / 1024)}KB)`);
} catch (e) { console.warn("[backup] data-folders zip skipped:", e.message); }
const dZips = fs.readdirSync(BACKUPS).filter((f2) => f2.startsWith("karim_data-folders-")).sort().reverse();
for (const old of dZips.slice(3)) { fs.unlinkSync(path.join(BACKUPS, old)); console.log("[backup] pruned:", old); }

console.log('[backup] done ✓');
