#!/usr/bin/env node
/**
 * machine-bundle — Karim ERP machine migration v1.0
 * ─────────────────────────────────────────────────────────
 * ينقل المشروع لجهاز آخر بدون إعادة خطوات الواتساب والبصمة:
 *
 *   على الجهاز القديم:  node scripts/machine-bundle.js export [--include-media]
 *     → ينتج karim-bundle-YYYYMMDD-HHmmss.zip فيه:
 *       - config/tables.sql  (wa_* + attendance_devices + sync_state)
 *       - config/env.snapshot (.env كامل — ملكك، انقله بأمان)
 *       - files/whatsapp-sessions/ (جلسة واتساب — تعمل غالبًا بدون إعادة QR)
 *       - files/whatsapp-backups/
 *       - manifest.json
 *
 *   على الجهاز الجديد:
 *     1) SETUP-SMART.bat (يثبت ويهيئ القاعدة)
 *     2) node scripts/machine-bundle.js import <bundle.zip>
 *     3) عدّل DB_PASSWORD في .env حسب باسورد postgres الجديد (إن لزم)
 *     4) RUN-KARIM-HIDDEN.vbs — وعدّل IP البصمة من صفحة الأجهزة (IP الشبكة يتغير)
 *
 * ملاحظات صريحة:
 * - جلسة واتساب المنقولة تعمل في الغالب كرفيق مُعرّف مسبقًا؛ إن طلب واتساب
 *   تحققًا جديدًا ستحتاج مسح QR مرة واحدة فقط (القواعد والإعدادات محفوظة).
 * - IP البصمة خاص بشبكة المكان — عدّله من الواجهة بعد النقل.
 */
'use strict';

const lib = require('./shared');
process.chdir(lib.ROOT);
const { log, ROOT } = lib;
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

const PORTABLE_TABLES = [
  'wa_settings',
  'wa_rules',
  'wa_chat_settings',
  'wa_templates',
  'wa_workflows',
  'wa_webhooks',
  'attendance_devices',
  'device_sync_state',
];

function pgEnv() {
  return {
    ...process.env,
    PGPASSWORD: lib.getEnv('DB_PASSWORD', ''),
    PGCONNECT_TIMEOUT: '10',
  };
}
function dbArgs() {
  return ['-h', lib.getEnv('DB_HOST', '127.0.0.1'), '-p', lib.getEnv('DB_PORT', '5432'),
    '-U', lib.getEnv('DB_USER', 'postgres'), '-d', lib.getEnv('DB_NAME', 'karim_erp')];
}

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function copyDir(src, dest) {
  if (!fs.existsSync(src)) {return 0;}
  fs.mkdirSync(dest, { recursive: true });
  let n = 0;
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name);
    const d = path.join(dest, e.name);
    if (e.isDirectory()) {n += copyDir(s, d);}
    else { fs.copyFileSync(s, d); n++; }
  }
  return n;
}

function zipDir(srcDir, outZip) {
  if (lib.IS_WIN) {
    const r = spawnSync('powershell', ['-NoProfile', '-Command',
      `Compress-Archive -Path '${srcDir}\\*' -DestinationPath '${outZip}' -Force`],
      { encoding: 'utf-8', timeout: 300000 });
    if (r.status !== 0) {throw new Error('Compress-Archive failed: ' + (r.stderr || '').slice(0, 200));}
  } else {
    const r = spawnSync('zip', ['-qr', outZip, '.'], { cwd: srcDir, encoding: 'utf-8', timeout: 300000 });
    if (r.status !== 0) {throw new Error('zip failed');}
  }
}

function unzipFile(zip, destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  if (lib.IS_WIN) {
    const r = spawnSync('powershell', ['-NoProfile', '-Command',
      `Expand-Archive -Path '${zip}' -DestinationPath '${destDir}' -Force`],
      { encoding: 'utf-8', timeout: 300000 });
    if (r.status !== 0) {throw new Error('Expand-Archive failed');}
  } else {
    const r = spawnSync('unzip', ['-q', '-o', zip, '-d', destDir], { encoding: 'utf-8', timeout: 300000 });
    if (r.status !== 0) {throw new Error('unzip failed');}
  }
}

async function doExport(includeMedia) {
  const name = `karim-bundle-${stamp()}.zip`;
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'karim-bundle-'));
  const cfgDir = path.join(work, 'config');
  const filesDir = path.join(work, 'files');
  fs.mkdirSync(cfgDir, { recursive: true });
  log.step('1/4 — تصدير جداول الإعدادات');
  const pgDump = lib.getPgBinary('pg_dump');
  if (!pgDump) { log.error('pg_dump غير موجود'); process.exit(1); }
  const dumpFile = path.join(cfgDir, 'data.sql');
  const schemaFile = path.join(cfgDir, 'schema.sql');
  const tableArgs = [];
  for (const t of PORTABLE_TABLES) {tableArgs.push('-t', t);}
  const s = spawnSync(pgDump, [...dbArgs(), '--schema-only', '-f', schemaFile, ...tableArgs],
    { encoding: 'utf-8', timeout: 120000, env: pgEnv() });
  if (s.status !== 0) { log.error('schema dump فشل'); process.exit(1); }
  const args = [...dbArgs(), '--data-only', '--column-inserts', '-f', dumpFile, ...tableArgs];
  const r = spawnSync(pgDump, args, { encoding: 'utf-8', timeout: 120000, env: pgEnv() });
  if (r.status !== 0) { log.error('pg_dump فشل: ' + (r.stderr || '').slice(0, 300)); process.exit(1); }
  log.ok(`${PORTABLE_TABLES.length} جداول`);

  log.step('2/4 — نسخ .env والجلسات');
  fs.copyFileSync(path.join(ROOT, '.env'), path.join(cfgDir, 'env.snapshot'));
  const sessSrc = lib.getEnv('WHATSAPP_SESSION_DIR', 'C:/KarimData/whatsapp-sessions');
  const nSess = copyDir(sessSrc, path.join(filesDir, 'whatsapp-sessions'));
  const bakSrc = lib.getEnv('WHATSAPP_BACKUP_DIR', 'C:/KarimData/whatsapp-backups');
  const nBak = copyDir(bakSrc, path.join(filesDir, 'whatsapp-backups'));
  log.ok(`sessions=${nSess} backups=${nBak}`);
  let nMedia = 0;
  if (includeMedia) {
    nMedia = copyDir(lib.getEnv('WHATSAPP_MEDIA_DIR', 'C:/KarimData/whatsapp-media'), path.join(filesDir, 'whatsapp-media'));
  }
  log.ok(`media=${nMedia}${includeMedia ? '' : ' (تخطي — استخدم --include-media)'}`);

  log.step('3/4 — manifest');
  const manifest = {
    app: 'karim-erp', version: require('../package.json').version,
    createdAt: new Date().toISOString(), host: os.hostname(),
    db: { name: lib.getEnv('DB_NAME', 'karim_erp'), port: lib.getEnv('DB_PORT', '5432') },
    tables: PORTABLE_TABLES, sessions: nSess, backups: nBak, media: nMedia,
  };
  fs.writeFileSync(path.join(work, 'manifest.json'), JSON.stringify(manifest, null, 2));

  log.step('4/4 — ضغط');
  const outZip = path.join(ROOT, name);
  zipDir(work, outZip);
  fs.rmSync(work, { recursive: true, force: true });
  log.header('Export complete');
  log.plain(`  الملف: ${outZip}`);
  log.plain(`  انقله للجهاز الجديد ثم: node scripts/machine-bundle.js import ${name}`);
}

async function doImport(zipPath) {
  const zip = path.resolve(zipPath);
  if (!fs.existsSync(zip)) { log.error('الملف غير موجود: ' + zip); process.exit(1); }
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'karim-restore-'));
  log.step('1/4 — فك الحزمة');
  unzipFile(zip, work);
  const manifest = JSON.parse(fs.readFileSync(path.join(work, 'manifest.json'), 'utf-8'));
  log.ok(`حزمة ${manifest.app} v${manifest.version} من ${manifest.host} بتاريخ ${manifest.createdAt}`);

  log.step('2/4 — تجهيز الهيكل ثم استعادة الجداول (TRUNCATE + تحميل)');
  const psql = lib.getPgBinary('psql');
  if (!psql) { log.error('psql غير موجود'); process.exit(1); }
  // الهيكل من الحزمة نفسها (يعمل على قاعدة فارغة تمامًا) — أخطاء "موجود" مقبولة
  spawnSync(psql, [...dbArgs(), '-f', path.join(work, 'config', 'schema.sql')],
    { encoding: 'utf-8', timeout: 120000, env: pgEnv() });
  const tables = manifest.tables.filter((t) => PORTABLE_TABLES.includes(t));
  const trunc = spawnSync(psql, [...dbArgs(), '-tAc',
    tables.map((t) => `TRUNCATE ${t} RESTART IDENTITY CASCADE;`).join(' ')],
    { encoding: 'utf-8', timeout: 60000, env: pgEnv() });
  if (trunc.status !== 0) { log.error('TRUNCATE فشل: ' + (trunc.stderr || '').slice(0, 200)); process.exit(1); }
  const load = spawnSync(psql, [...dbArgs(), '-v', 'ON_ERROR_STOP=1', '-f', path.join(work, 'config', 'data.sql')],
    { encoding: 'utf-8', timeout: 180000, env: pgEnv() });
  if (load.status !== 0) { log.error('تحميل الجداول فشل: ' + (load.stderr || '').slice(0, 300)); process.exit(1); }
  log.ok('الجداول مستعادة');

  log.step('3/4 — استعادة الملفات + .env');
  const sessDst = lib.getEnv('WHATSAPP_SESSION_DIR', 'C:/KarimData/whatsapp-sessions');
  const nSess = copyDir(path.join(work, 'files', 'whatsapp-sessions'), sessDst);
  const bakDst = lib.getEnv('WHATSAPP_BACKUP_DIR', 'C:/KarimData/whatsapp-backups');
  const nBak = copyDir(path.join(work, 'files', 'whatsapp-backups'), bakDst);
  copyDir(path.join(work, 'files', 'whatsapp-media'), lib.getEnv('WHATSAPP_MEDIA_DIR', 'C:/KarimData/whatsapp-media'));
  const envFile = path.join(ROOT, '.env');
  if (fs.existsSync(envFile)) {fs.copyFileSync(envFile, envFile + '.before-import');}
  fs.copyFileSync(path.join(work, 'config', 'env.snapshot'), envFile);
  log.ok(`sessions=${nSess} backups=${nBak} (.env القديم → .env.before-import)`);

  log.step('4/4 — تحقق أخير');
  const mg = spawnSync(process.execPath, [path.join(ROOT, 'database', 'scripts', 'run-migration.js')],
    { stdio: 'pipe', cwd: ROOT, timeout: 300000, env: { ...process.env } });
  fs.rmSync(work, { recursive: true, force: true });
  if (mg.status !== 0) { log.error('migrations فشلت'); process.exit(1); }
  log.header('Import complete');
  log.plain('  1) عدّل DB_PASSWORD في .env حسب باسورد postgres هذا الجهاز (إن اختلف)');
  log.plain('  2) عدّل IP البصمة من صفحة الأجهزة (IP الشبكة يختلف بين الأماكن)');
  log.plain('  3) شغّل: RUN-KARIM-HIDDEN.vbs — الواتساب يعمل غالبًا بدون QR جديد');
}

async function main() {
  const [cmd, arg] = process.argv.slice(2);
  if (cmd === 'export') {
    log.header('Karim ERP — Machine Bundle Export');
    await doExport(process.argv.includes('--include-media'));
  } else if (cmd === 'import') {
    log.header('Karim ERP — Machine Bundle Import');
    if (!arg) { log.error('حدد ملف الحزمة: node scripts/machine-bundle.js import <bundle.zip>'); process.exit(1); }
    await doImport(arg);
  } else {
    log.error('استخدام: export [--include-media] | import <bundle.zip>');
    process.exit(1);
  }
}
main().catch((e) => { log.error('خطأ فادح: ' + e.message); process.exit(1); });
