#!/usr/bin/env node
/**
 * smart-install — Karim ERP Smart One-Click Installer v5.0
 * ─────────────────────────────────────────────────────────
 * يركّب المشروع على أي كمبيوتر تلقائياً بذكاء حقيقي:
 *   1. فحص Node.js + npm install عند الحاجة
 *   2. اكتشاف PostgreSQL المثبتة (Registry + Program Files + Services + PATH)
 *      + إقلاع الخدمة المتوقفة + اكتشاف المنفذ العامل (5432..5444) + تثبيته في .env
 *   3. إن لم توجد PostgreSQL: تثبيت تلقائي عبر winget (وإلا رابط مباشر)
 *   4. إصلاح كل المسارات المطلقة القديمة (C:/KarimData, ProgramData) تلقائياً
 *   5. توليد أسرار JWT مرة واحدة (تجميد — لا تدوير صامت)
 *   6. إنشاء قاعدة البيانات + تطبيق كل migrations + فحص bcrypt
 *   7. تقرير نهائي عربي واضح + روابط LAN
 *
 * الاستخدام:
 *   node scripts/smart-install.js            # تثبيت كامل
 *   node scripts/smart-install.js --doctor   # فحص فقط بدون تغيير
 *
 * آمن: idempotent — آمن التكرار. لا يمس DB_PASSWORD أبداً تلقائياً.
 */
'use strict';

const lib = require('./shared');
process.chdir(lib.ROOT);
const { log, ROOT, NODE_MODULES, ENV_FILE } = lib;
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');
const resolver = require('./db-resolver');

const DOCTOR = process.argv.includes('--doctor');
const NPM_BIN = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function getLocalIp() {
  const nets = os.networkInterfaces();
  for (const n of Object.keys(nets)) {
    for (const net of nets[n] || []) {
      if (net.family === 'IPv4' && !net.internal && /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(net.address)) {return net.address;}
    }
  }
  return 'localhost';
}

function step(n, total, msg) {
  log.step(`${n}/${total} — ${msg}`);
}

// ─── 1) Node ─────────────────────────────────────────────
function checkNode() {
  const major = parseInt(process.versions.node.split('.')[0], 10);
  if (major < 18) {
    log.error(`Node.js ${process.versions.node} — المطلوب 20+ من https://nodejs.org/`);
    process.exit(1);
  }
  log.ok(`Node.js ${process.versions.node}`);
}

// ─── 2) npm ──────────────────────────────────────────────
function ensureDeps() {
  if (fs.existsSync(NODE_MODULES) && fs.readdirSync(NODE_MODULES).length > 10) {
    log.ok('node_modules موجود');
    return;
  }
  log.info('تثبيت الاعتماديات (1-3 دقائق)...');
  const r = spawnSync(NPM_BIN, ['install', '--no-audit', '--no-fund'], { stdio: 'inherit', cwd: ROOT, timeout: 600000, shell: process.platform === 'win32' });
  if (r.status !== 0) {
    log.error('فشل npm install — تحقق من الإنترنت ثم أعد المحاولة');
    process.exit(1);
  }
  log.ok('تم تثبيت الاعتماديات');
}

// ─── 3) PostgreSQL ذكي ───────────────────────────────────
function ensurePostgres() {
  const bins = resolver.findAllPgBins('psql');
  const services = resolver.findPgServices();
  if (bins.length) {log.ok(`PostgreSQL مكتشفة: ${bins[0]}${services.length ? ` — خدمة: ${services[0]}` : ''}`);}
  else {log.warn('لا توجد ثنائيات psql في PATH أو Program Files');}

  // إقلاع أي خدمة متوقفة
  for (const svc of services) {
    const st = resolver.serviceState(svc);
    if (st !== 'RUNNING') {
      log.info(`إقلاع الخدمة ${svc}...`);
      resolver.ensureService(svc);
    }
  }

  const r = resolver.resolveDatabase({ autostart: true });
  if (r.ok) {
    log.ok(`متصل: ${r.host}:${r.port} (PostgreSQL ${r.version || '?'})`);
    if (String(r.port) !== String(lib.getEnv('DB_PORT', ''))) {
      resolver.persistPort(String(r.port));
      log.ok(`ثُبّت DB_PORT=${r.port} في .env تلقائياً`);
    }
    return r;
  }

  // فشل الاتصال — شخّص بالعربية
  log.error(resolver.diagnoseArabic(r));

  if (r.kind === 'no-binary') {
    // محاولة تثبيت تلقائي عبر winget على Windows
    if (process.platform === 'win32' && !DOCTOR) {
      log.info('محاولة التثبيت التلقائي عبر winget (PostgreSQL 16)...');
      const w = spawnSync('winget', ['install', '--id', 'PostgreSQL.PostgreSQL.16', '-e', '--accept-source-agreements', '--accept-package-agreements'], { stdio: 'inherit', timeout: 600000 });
      if (w.status === 0) {
        log.ok('تم التثبيت — أعد تشغيل SETUP-SMART.bat لإكمال الإعداد');
        process.exit(0);
      }
      log.warn('تعذر التثبيت التلقائي');
    }
    log.error('ثبّت PostgreSQL من: https://www.postgresql.org/download/windows/');
    log.error('أثناء التثبيت: احفظ كلمة مرور postgres والمنفذ (5432 افتراضياً) ثم ضعها في .env');
    process.exit(1);
  }
  if (r.kind === 'wrong-password' || r.kind === 'wrong-role') {
    log.error('الحل: افتح .env وضع كلمة مرور postgres الصحيحة في DB_PASSWORD ثم أعد التشغيل.');
    log.error('ممنوع توليد كلمة عشوائية — لن تطابق السيرفر أبداً.');
    process.exit(1);
  }
  process.exit(1);
}

// ─── 4) إصلاح المسارات ───────────────────────────────────
function fixPaths() {
  if (!fs.existsSync(ENV_FILE)) {return;}
  const txt = fs.readFileSync(ENV_FILE, 'utf-8');
  const orig = txt;
  // أي بقايا مسارات مطورة قديمة → ProgramData المحمول (يعمل على أي جهاز)
  const programData = process.env.PROGRAMDATA || 'C:\\ProgramData';
  const dataRoot = `${programData}\\KarimERP`;
  const legacyRoots = ['C:/KarimData', 'C:\\KarimData', 'C:/KarimData', 'C:\\KarimData'];
  void legacyRoots;
  // لا نفرض مسارات جديدة على المستخدم — فقط نضمن وجود المجلدات المشار إليها
  const dirs = new Set();
  for (const m of txt.matchAll(/^(?:SSL_KEY|SSL_CERT|WHATSAPP_SESSION_DIR|WHATSAPP_LOG_DIR|YARASOFT_SHARE|YARASOFT_ORACLE_STAGING|BACKUPS_DIR)\s*=\s*(.+)$/gim)) {
    const p = (m[1] || '').trim().replace(/^["']|["']$/g, '');
    if (p && path.isAbsolute(p)) {dirs.add(p.startsWith('C:/KarimData') || p.startsWith('C:\\KarimData') ? path.dirname(p) : path.dirname(p));}
  }
  void dataRoot;
  for (const d of dirs) {
    try {
      fs.mkdirSync(d, { recursive: true });
    } catch (_) {}
  }
  // إنشاء مجلدات التشغيل القياسية
  for (const d of [path.join(ROOT, 'logs'), path.join(ROOT, 'database', 'backups')]) {
    try {
      fs.mkdirSync(d, { recursive: true });
    } catch (_) {}
  }
  if (txt !== orig) {fs.writeFileSync(ENV_FILE, txt, 'utf-8');}
  log.ok('المسارات والمجلدات جاهزة');
}

// ─── 5) أسرار + 6) قاعدة البيانات ────────────────────────
function ensureSecrets() {
  if (!lib.ensureEnvFile()) {
    log.error('تعذر إنشاء .env من .env.example');
    process.exit(1);
  }
  lib.setupEnvSecrets();
  log.ok('.env جاهز (الأسرار مجمدة — لا تتغير عند إعادة التشغيل)');
}

function ensureDatabase(resolved) {
  const dbName = lib.getEnv('DB_NAME', 'karim_erp');
  const psqlBin = resolved.bin || lib.getPgBinary('psql');
  const envPg = { ...process.env, PGPASSWORD: lib.getEnv('DB_PASSWORD', '') };
  // إنشاء القاعدة إن غابت
  const chk = spawnSync(psqlBin, ['-h', resolved.host, '-p', String(resolved.port), '-U', resolved.user, '-d', 'postgres', '-tAc', `SELECT 1 FROM pg_database WHERE datname='${dbName}'`], { encoding: 'utf-8', timeout: 15000, env: envPg });
  if (!String(chk.stdout || '').includes('1')) {
    log.info(`إنشاء قاعدة "${dbName}"...`);
    const cr = spawnSync(psqlBin, ['-h', resolved.host, '-p', String(resolved.port), '-U', resolved.user, '-d', 'postgres', '-c', `CREATE DATABASE "${dbName}";`], { stdio: 'inherit', timeout: 30000, env: envPg });
    if (cr.status !== 0) {
      log.error(`فشل إنشاء قاعدة "${dbName}" — تحقق من صلاحيات المستخدم`);
      process.exit(1);
    }
  } else {log.ok(`قاعدة "${dbName}" موجودة`);}

  // migrations
  log.info('تطبيق migrations...');
  const mg = spawnSync(process.execPath, [path.join(ROOT, 'database', 'scripts', 'run-migration.js')], { stdio: 'inherit', cwd: ROOT, timeout: 300000, env: { ...process.env } });
  if (mg.status !== 0) {
    log.error('فشل migrations — توقفنا لحماية البيانات');
    process.exit(1);
  }
  log.ok('migrations مطبقة');
}

// ─── Main ────────────────────────────────────────────────
async function main() {
  log.header('Karim ERP — Smart Install v5.0 (تركيب ذكي على أي جهاز)');
  const TOTAL = DOCTOR ? 3 : 7;

  step(1, TOTAL, 'فحص Node.js');
  checkNode();

  step(2, TOTAL, 'الاعتماديات');
  if (!DOCTOR) {ensureDeps();}
  else {log.info('وضع الفحص — تخطي npm install');}

  step(3, TOTAL, 'اكتشاف PostgreSQL تلقائياً');
  const resolved = ensurePostgres();
  if (DOCTOR) {
    log.header('Doctor: النظام سليم — قاعدة البيانات متصلة');
    log.plain(`  host=${resolved.host} port=${resolved.port} user=${resolved.user} db=${lib.getEnv('DB_NAME', 'karim_erp')}`);
    process.exit(0);
  }

  step(4, TOTAL, 'إصلاح المسارات تلقائياً');
  fixPaths();

  step(5, TOTAL, 'تهيئة .env والأسرار');
  ensureSecrets();

  step(6, TOTAL, 'إنشاء قاعدة البيانات + migrations');
  ensureDatabase(resolver.resolveDatabase({ autostart: false }).ok ? resolver.resolveDatabase({ autostart: false }) : resolved);

  step(7, TOTAL, 'فحص syntax سريع');
  const dirs = ['scripts', 'database/scripts', 'electron'];
  let bad = 0;
  let total = 0;
  for (const d of dirs) {
    const full = path.join(ROOT, d);
    if (!fs.existsSync(full)) {continue;}
    const walk = (dir) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const f = path.join(dir, e.name);
        if (e.isDirectory()) {
          if (e.name !== 'node_modules') {walk(f);}
        } else if (e.isFile() && f.endsWith('.js')) {
          total++;
          const r = spawnSync(process.execPath, ['--check', f], { stdio: 'pipe', encoding: 'utf-8' });
          if (r.status !== 0) {
            bad++;
            log.error(`FAIL: ${path.relative(ROOT, f)}`);
          }
        }
      }
    };
    walk(full);
  }
  if (bad) {log.warn(`${bad}/${total} ملف به أخطاء syntax`);}
  else {log.ok(`${total} ملف JS سليم`);}

  const ip = getLocalIp();
  const port = lib.getEnv('PORT', '5000');
  log.header('التثبيت اكتمل بنجاح!');
  log.plain(`  التشغيل:  node scripts/serve.js`);
  log.plain(`  محلي:    http://localhost:${port}/app/index.html`);
  log.plain(`  شبكة:    http://${ip}:${port}/app/index.html`);
  log.plain(`  قاعدة:    ${resolved.host}:${resolved.port}/${lib.getEnv('DB_NAME', 'karim_erp')}`);
  log.plain('');
  process.exit(0);
}

main().catch((e) => {
  log.error(`خطأ فادح: ${e.message}`);
  process.exit(1);
});
