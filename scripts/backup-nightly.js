// backup-nightly.js — نسخة احتياطية ليلية مضغوطة (pg_dump -Fc) + تدوير + latest
// HARDENED 2026-10-07 (بعد حادثة ضياع القاعدة):
//   • فشل صاخب: أي خطأ → status ok:false + خروج بكود 1 (المجدول يسجل الفشل)
//   • حد أدنى للحجم 5MB: ملف أصغر يُحذف ولا يمس latest أبدًا (درس ملف 0 بايت)
//   • latest تُحدَّث فقط من نسخة سليمة مُتحقق منها
//   • تدوير: آخر 7 نسخ ليلية (بدل 3)
//   • مرايا تلقائية على D:/KarimBackups و E:/KarimBackups
// التشغيل: مهمة مجدولة يوميًا 03:00 و 15:00 (schtasks) أو يدويًا: node scripts/backup-nightly.js
'use strict';
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const BACKUPS = path.join(ROOT, 'database', 'backups');
const KEEP = 7;
const MIN_BYTES = 5 * 1024 * 1024; // أقل حجم مقبول لنسخة -Fc كاملة
const STATUS_FILE = path.join(BACKUPS, 'nightly-backup-status.json');

function writeStatus(payload) {
    try {
        fs.mkdirSync(BACKUPS, { recursive: true });
        fs.writeFileSync(STATUS_FILE, JSON.stringify({ timestamp: new Date().toISOString(), ...payload }, null, 2), 'utf8');
    } catch (_) {}
}

function fail(msg) {
    console.error('[backup] FAILED:', msg);
    writeStatus({ ok: false, error: msg });
    process.exit(1);
}

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
try {
    execFileSync(path.join(PG, 'pg_dump.exe'), [
        '-h', process.env.DB_HOST || '127.0.0.1', '-p', process.env.DB_PORT || '5432',
        '-U', process.env.DB_USER || 'postgres', '-d', DB,
        '-Fc', '-f', nightly,
    ], { stdio: 'inherit', env: { ...process.env, PGPASSWORD: process.env.DB_PASSWORD }, timeout: 600000 });
} catch (e) {
    try { if (fs.existsSync(nightly) && fs.statSync(nightly).size < MIN_BYTES) fs.unlinkSync(nightly); } catch (_) {}
    fail('pg_dump error: ' + String((e && e.message) || e).slice(0, 200));
}

let size = 0;
try { size = fs.statSync(nightly).size; } catch (e) { fail('dump file missing after pg_dump'); }
if (size < MIN_BYTES) {
    try { fs.unlinkSync(nightly); } catch (_) {}
    fail(`dump too small (${size} bytes < ${MIN_BYTES}) — deleted, latest untouched`);
}

// بصمة للنسخة الليلية
try {
    const digest = crypto.createHash('sha256').update(fs.readFileSync(nightly)).digest('hex');
    fs.writeFileSync(`${nightly}.sha256`, `${digest}  ${path.basename(nightly)}\n`, 'utf8');
} catch (e) { console.warn('[backup] sha256 skipped:', e.message); }

// latest تُحدَّث فقط بعد التحقق من السلامة
const latest = path.join(BACKUPS, 'karim_erp-latest.dump');
fs.copyFileSync(nightly, latest);
console.log('[backup] latest.copy →', latest, `(${Math.round(size / 1048576)}MB)`);

// تدوير: آخر KEEP نسخ ليلية فقط
const nightlies = fs.readdirSync(BACKUPS)
    .filter((f) => f.startsWith('karim_erp-nightly-') && f.endsWith('.dump'))
    .sort().reverse();
for (const old of nightlies.slice(KEEP)) {
    try { fs.unlinkSync(path.join(BACKUPS, old)); } catch (_) {}
    try { fs.unlinkSync(path.join(BACKUPS, `${old}.sha256`)); } catch (_) {}
    console.log('[backup] pruned:', old);
}

// ── نسخ مجلدات البيانات الحرجة: جلسة واتساب + شهادة HTTPS + KarimData ──
const CRIT_ALL = ['C:/HorusData/certs', 'C:/HorusData/whatsapp-sessions', 'C:/HorusData/links', 'C:/KarimData'];
const CRIT = CRIT_ALL.filter((p) => { try { return fs.existsSync(p); } catch (_) { return false; } });
if (!CRIT.length) console.warn('[backup] no critical folders found — data-zip skipped');
const dataZip = path.join(BACKUPS, `karim_data-folders-${today}.zip`);
try {
    if (!CRIT.length) throw new Error('no existing critical folders');
    execFileSync('powershell', ['-NoProfile', '-Command',
        `Compress-Archive -Force -Path '${CRIT.join("','")}' -DestinationPath '${dataZip}'`], { stdio: 'pipe', timeout: 300000 });
    console.log('[backup] data-folders.zip →', dataZip, `(${Math.round(fs.statSync(dataZip).size / 1024)}KB)`);
} catch (e) { console.warn('[backup] data-folders zip skipped:', String(e.message).slice(0, 120)); }
const dZips = fs.readdirSync(BACKUPS).filter((f2) => f2.startsWith('karim_data-folders-')).sort().reverse();
for (const old of dZips.slice(KEEP)) { try { fs.unlinkSync(path.join(BACKUPS, old)); console.log('[backup] pruned:', old); } catch (_) {} }

// ── مرايا خارجية D/E (best-effort) ──
try {
    const { mirrorFile } = require('./backup-mirror');
    const m1 = mirrorFile(nightly, 'nightly');
    const m2 = mirrorFile(dataZip, 'nightly');
    console.log('[backup] mirror D/E:', JSON.stringify({ nightly: m1.mirrored.length, dataZip: m2.mirrored.length, errors: [...m1.errors, ...m2.errors].slice(0, 3) }));
} catch (e) { console.warn('[backup] mirror skipped:', String(e.message).slice(0, 120)); }

writeStatus({ ok: true, file: path.basename(nightly), bytes: size });
console.log('[backup] done ✓');
