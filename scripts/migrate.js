#!/usr/bin/env node
/**
 * migrate — مطاعم الشرفة العالمي v3.1
 *
 * أوامر التشغيل:
 *   node scripts/migrate.js setup       تهيئة PostgreSQL النظامي (winget) + القاعدة + الترحيلات وكلمات المرور
 *   node scripts/migrate.js start       تهيئة ناقصة إن وجدت ثم تشغيل منفصل للخادم على LAN
 *   node scripts/migrate.js build-exe   بناء NSIS EXE ونسخة Portable
 *   node scripts/migrate.js client      فتح واجهة العميل على عنوان خادم LAN
 *
 * v3.0 — PostgreSQL نظامي فقط (لا محمولة)
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn, spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const isWin = process.platform === 'win32';
const nodeBin = process.execPath;
const npmBin = isWin ? 'npm.cmd' : 'npm';
const command = String(process.argv[2] || 'start').toLowerCase();
const args = process.argv.slice(3);

function log(message) { console.log(`[migrate] ${message}`); }
function fail(message, code = 1) { console.error(`[migrate] خطأ: ${message}`); process.exit(code); }
function runNode(script, extra = []) {
  const result = spawnSync(nodeBin, [path.join(ROOT, script), ...extra], { cwd: ROOT, stdio: 'inherit', env: { ...process.env } });
  if (result.status !== 0) {fail(`فشل تنفيذ ${script}`);}
}
function runNpm(script, extra = []) {
  const result = spawnSync(npmBin, ['run', script, ...extra], { cwd: ROOT, stdio: 'inherit', env: { ...process.env } });
  if (result.status !== 0) {fail(`فشل تنفيذ npm run ${script}`);}
}
function localIp() {
  for (const interfaces of Object.values(os.networkInterfaces())) {
    for (const item of interfaces || []) {
      if (item.family === 'IPv4' && !item.internal && /^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.)/.test(item.address)) {return item.address;}
    }
  }
  return 'localhost';
}
function ensureProjectFiles() {
  for (const file of ['package.json', 'scripts/setup.js', 'backend/server.js', 'database/migrations']) {
    if (!fs.existsSync(path.join(ROOT, file))) {fail(`ملف المشروع غير موجود: ${file}`);}
  }
}
function setup() {
  ensureProjectFiles();
  log('بدء التهيئة الآمنة: PostgreSQL النظامي + لا محمولة');
  runNode('scripts/setup.js');
  log('اكتملت تهيئة PostgreSQL النظامي والقاعدة والترحيلات وتشفير كلمات المرور.');
}
function start() {
  setup();
  const port = process.env.PORT || '5000';
  log(`تشغيل الخادم على كل واجهات الشبكة: http://0.0.0.0:${port}`);
  log(`رابط أجهزة الموظفين: http://${localIp()}:${port}/app/pos.html`);
  runNode('scripts/serve.js');
}
function buildExe() {
  ensureProjectFiles();
  log('فحص الاعتماديات قبل بناء EXE.');
  const install = spawnSync(npmBin, ['install', '--no-audit', '--no-fund'], { cwd: ROOT, stdio: 'inherit', env: { ...process.env } });
  if (install.status !== 0) {fail('فشل تثبيت الاعتماديات اللازمة للبناء.');}
  log('بناء نسخة Windows NSIS ونسخة Portable نظيفة.');
  runNpm('electron:build:nsis');
  runNpm('electron:build:portable');
  log('تم البناء. ابحث عن الملفات داخل مجلد release.');
}
function client() {
  const host = args[0] || process.env.KARIM_SERVER_HOST || localIp();
  const port = process.env.PORT || '5000';
  const url = `http://${host}:${port}/app/pos.html`;
  log(`رابط عميل الشبكة: ${url}`);
  const opener = isWin ? 'cmd.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  const openerArgs = isWin ? ['/c', 'start', '""', url] : [url];
  spawn(opener, openerArgs, { cwd: ROOT, detached: true, stdio: 'ignore', shell: false, windowsHide: true }).unref();
}

try {
  if (command === 'setup') {setup();}
  else if (command === 'start' || command === 'server') {start();}
  else if (command === 'build-exe' || command === 'exe') {buildExe();}
  else if (command === 'client') {client();}
  else {
    console.log('الاستخدام: node scripts/migrate.js [setup|start|build-exe|client [SERVER_IP]]');
    process.exit(0);
  }
} catch (error) {
  fail(error.message || String(error));
}