#!/usr/bin/env node
/**
 * karimerp — تشغيل احترافي كامل لنظام مطاعم الشرفة العالمي
 * ──────────────────────────────────────────────────────────
 * أمر واحد يشغّل كل شيء بذكاء:
 *   karimerp               تشغيل كامل (فحص + تثبيت PG إن لزم + تهيئة DB + بدء الخادم + فتح المتصفح)
 *   karimerp --check       فحص فقط بلا تشغيل
 *   karimerp --install     تثبيت شامل (Node/PG/خدمات) عبر install.js
 *   karimerp --no-browser  تشغيل كامل بلا فتح المتصفح (للخدمات/السيرفرات)
 *
 * يعتمد على: scripts/shared.js + database/scripts/start-pg.js + backend/server.js
 * آمن للتكرار — لا يمسح بيانات إن كانت موجودة.
 */
'use strict';
const lib = require('./shared');
process.chdir(lib.ROOT);
const { log, ROOT, getEnv, isPgRunning, DEFAULT_DB_PORT } = lib;
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ONLY_CHECK = process.argv.includes('--check');
const INSTALL_MODE = process.argv.includes('--install');

function needNode() {
  const v = process.versions.node.split('.').map(Number);
  if (v[0] < lib.MIN_NODE_VERSION) {
    log.error(`Node.js ${process.versions.node} قديم — مطلوب ${lib.MIN_NODE_VERSION}+ من https://nodejs.org`);
    process.exit(1);
  }
  log.ok(`Node.js ${process.versions.node}`);
}

function ensureEnv() {
  if (!fs.existsSync(lib.ENV_FILE)) {
    if (!lib.ensureEnvFile()) {process.exit(1);}
  }
  let txt = fs.readFileSync(lib.ENV_FILE, 'utf-8');
  let changed = false;
  const gen = (len = 48) => crypto.randomBytes(len).toString('hex');
  const fix = (key, cur) => {
    const re = new RegExp(`^${key}=.*$`, 'm');
    if (!cur || cur.length < 32 || cur.includes('replace-me') || cur.includes('karim_preview')) {
      const sec = gen();
      if (re.test(txt)) {txt = txt.replace(re, `${key}=${sec}`);}
      else {txt += `\n${key}=${sec}\n`;}
      changed = true;
      log.ok(`ولّد ${key}`);
    }
  };
  const mA = txt.match(/^JWT_ACCESS_SECRET=(.*)$/m);
  const mR = txt.match(/^JWT_REFRESH_SECRET=(.*)$/m);
  const mE = txt.match(/^EMPLOYEE_QR_SECRET=(.*)$/m);
  fix('JWT_ACCESS_SECRET', mA ? mA[1].trim() : '');
  fix('JWT_REFRESH_SECRET', mR ? mR[1].trim() : '');
  fix('EMPLOYEE_QR_SECRET', mE ? mE[1].trim() : '');
  if (!/^DB_PASSWORD=.*\S/m.test(txt)) {
    const pw = gen(24).slice(0, 32);
    txt = txt.replace(/^DB_PASSWORD=.*$/m, `DB_PASSWORD=${pw}`);
    if (!txt.includes('DB_PASSWORD=')) {txt += `\nDB_PASSWORD=${pw}\n`;}
    changed = true;
    log.ok('ولّد DB_PASSWORD');
  }
  if (changed) {fs.writeFileSync(lib.ENV_FILE, txt, 'utf-8');}
  // reload
  try { require('dotenv').config({ path: lib.ENV_FILE, override: true }); } catch (_) {}
}

function ensureNodeModules() {
  if (fs.existsSync(lib.NODE_MODULES) && fs.readdirSync(lib.NODE_MODULES).length > 5) {
    log.ok('node_modules جاهز');
    return;
  }
  log.step('تثبيت الاعتماديات (npm install)…');
  const r = spawnSync('npm', ['install', '--no-audit', '--no-fund'], { cwd: ROOT, stdio: 'inherit', timeout: 300000 });
  if (r.status !== 0) { log.error('فشل npm install'); process.exit(1); }
}

async function ensurePg() {
  const host = getEnv('DB_HOST', '127.0.0.1');
  const port = getEnv('DB_PORT', String(DEFAULT_DB_PORT));
  const user = getEnv('DB_USER', 'postgres');
  const pass = getEnv('DB_PASSWORD', '');
  
  if (isPgRunning(host, port, user, pass)) {
    log.ok(`PostgreSQL يعمل على ${host}:${port}`);
    return;
  }
  
  if (lib.isPgInstalled()) {
    log.ok('PostgreSQL مثبت');
    return;
  }
  
  log.warn('PostgreSQL غير مثبت — جارٍ التثبيت التلقائي…');
  const installer = path.join(ROOT, 'scripts', 'install.js');
  if (!fs.existsSync(installer)) { log.error('scripts/install.js غير موجود'); process.exit(1); }
  const r = spawnSync(process.execPath, [installer, '--offline'], { cwd: ROOT, stdio: 'inherit', timeout: 600000 });
  if (r.status !== 0 || !isPgRunning(host, port, user, pass)) { log.error('فشل تثبيت PostgreSQL — ثبّته يدويًا من postgresql.org'); process.exit(1); }
  log.ok('PostgreSQL ثُبّت بنجاح');
}

async function startPgIfNeeded() {
  const host = getEnv('DB_HOST', '127.0.0.1');
  const port = getEnv('DB_PORT', String(DEFAULT_DB_PORT));
  const user = getEnv('DB_USER', 'postgres');
  const pass = getEnv('DB_PASSWORD', '');
  if (isPgRunning(host, port, user, pass)) {
    log.ok(`PostgreSQL يعمل ${host}:${port}`);
    return;
  }
  log.step('بدء PostgreSQL…');
  const startPg = path.join(ROOT, 'database', 'scripts', 'start-pg.js');
  const r = spawnSync(process.execPath, [startPg], { cwd: ROOT, stdio: 'inherit', timeout: 180000, env: { ...process.env, PGPASSWORD: pass } });
  if (r.status !== 0) { log.error('فشل بدء PostgreSQL — راجع database/data/server.log'); process.exit(1); }
  for (let i = 0; i < 10; i++) {
    await new Promise(r => setTimeout(r, 1000));
    if (isPgRunning(host, port, user, pass)) { log.ok('PostgreSQL جاهز'); return; }
  }
  log.error('PostgreSQL لم يبدأ خلال 10 ثوانٍ');
  process.exit(1);
}

function runMigrations() {
  log.step('تطبيق الترحيلات + تشفير كلمات المرور…');
  const mig = spawnSync(process.execPath, [path.join(ROOT, 'database', 'scripts', 'run-migration.js')], { cwd: ROOT, stdio: 'inherit', timeout: 180000 });
  if (mig.status !== 0) { log.error('فشل الترحيلات — أُوقف التشغيل لحماية البيانات'); process.exit(1); }
  const pw = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'migrate-plaintext-passwords.js')], { cwd: ROOT, stdio: 'inherit', timeout: 120000 });
  if (pw.status !== 0) { log.error('فشل تشفير كلمات المرور'); process.exit(1); }
}

async function main() {
  log.header('karimerp — تشغيل احترافي كامل');
  needNode();
  ensureEnv();
  if (ONLY_CHECK) {
    log.step('فحص فقط — بلا تشغيل');
    const host = getEnv('DB_HOST', '127.0.0.1');
    const port = getEnv('DB_PORT', String(DEFAULT_DB_PORT));
    const user = getEnv('DB_USER', 'postgres');
    const pass = getEnv('DB_PASSWORD', '');
    const pgRunning = isPgRunning(host, port, user, pass);
    const checks = [
      ['.env', fs.existsSync(lib.ENV_FILE)],
      ['node_modules', fs.existsSync(lib.NODE_MODULES)],
      ['PostgreSQL', pgRunning],
      ['migrations', fs.existsSync(lib.MIGRATIONS_DIR)],
    ];
    for (const [n, ok] of checks) {log[ok ? 'ok' : 'warn'](`${n}: ${ok ? '✓' : '✗'}`);}
    process.exit(checks.every(c => c[1]) ? 0 : 1);
  }
  if (INSTALL_MODE) {
    const inst = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'install.js')], { cwd: ROOT, stdio: 'inherit', timeout: 600000 });
    process.exit(inst.status || 0);
  }
  ensureNodeModules();
  await ensurePg();
  await startPgIfNeeded();
  runMigrations();

  // تفويض التشغيل الكامل لـ serve.js (إدارة الخادم + إعادة التشغيل التلقائي + فتح المتصفح)
  // --no-browser لمنع فتح المتصفح (مثلاً عند التشغيل كخدمة)
  log.step('بدء الخادم (serve.js)…');
  const serve = path.join(ROOT, 'scripts', 'serve.js');
  const noBrowser = process.argv.includes('--no-browser');
  const child = spawn(process.execPath, [serve], { cwd: ROOT, stdio: 'inherit', env: { ...process.env, ...(noBrowser ? { KARIMERP_NO_BROWSER: '1' } : {}) } });
  child.on('exit', code => process.exit(code || 0));
  process.on('SIGINT', () => { try { child.kill('SIGTERM'); } catch (_) {} });
  process.on('SIGTERM', () => { try { child.kill('SIGTERM'); } catch (_) {} });
}

main().catch(e => { log.error(e.message); console.error(e.stack); process.exit(1); });
