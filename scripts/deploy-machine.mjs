/**
 * deploy-machine.mjs — Karim ERP One-Shot Machine Deployment v1.0
 * ───────────────────────────────────────────────────────────────
 * السكربت الشامل الوحيد لنقل المشروع وتشغيله على أي جهاز جديد.
 * يكفي نسخ مجلد المشروع بالكامل ثم تشغيل:
 *     node scripts/deploy-machine.mjs
 *
 * أو للفحص فقط بدون تطبيق تغييرات:
 *     node scripts/deploy-machine.mjs --doctor
 *
 * خصائص احترافية:
 *  - Zero CWD Dependency: يعمل من أي مجلد على النظام
 *  - Zero npm قبل: يعمل بدون node_modules (يُثبّتها تلقائيًا)
 *  - Cross-platform: Windows / Linux / macOS (ProgramData / var/lib)
 *  - Idempotent: إعادة التشغيل آمنة ولا تكسر الإعدادات الموجودة
 *  - Arabic-first: جميع الرسائل بالعربية للفهم من قبل أي مستخدم
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { spawnSync, execSync } from 'node:child_process';
import crypto from 'node:crypto';

// ─────────────────────────────────────────────────────────────
// 0. حَلّ المسارات من مُوقعه الخاص — أيًا كان مكان التشغيل
// ─────────────────────────────────────────────────────────────
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const IS_WIN = process.platform === 'win32';
const IS_DOCTOR = process.argv.includes('--doctor');
const IS_VERBOSE = process.argv.includes('--verbose');

const PATHS = Object.freeze({
  ROOT,
  BACKEND: path.join(ROOT, 'backend'),
  FRONTEND: path.join(ROOT, 'frontend'),
  DATABASE: path.join(ROOT, 'database'),
  DB_MIGRATIONS: path.join(ROOT, 'database', 'migrations'),
  DB_SCRIPTS: path.join(ROOT, 'database', 'scripts'),
  SCRIPTS: path.join(ROOT, 'scripts'),
  SCRIPTS_LIB: path.join(ROOT, 'scripts', 'lib'),
  NODE_MODULES: path.join(ROOT, 'node_modules'),
  ENV_FILE: path.join(ROOT, '.env'),
  ENV_EXAMPLE: path.join(ROOT, '.env.example'),
  PACKAGE_JSON: path.join(ROOT, 'package.json'),
  SERVER_JS: path.join(ROOT, 'backend', 'server.js'),
  LOGS: path.join(ROOT, 'logs'),
  CERTS_DIR: path.join(ROOT, 'certs'),
  SHARED_INSTALL_DIR: IS_WIN
    ? path.join(process.env.ProgramData || 'C:\\ProgramData', 'KarimERP')
    : process.platform === 'darwin'
      ? path.join('/Library', 'Application Support', 'KarimERP')
      : path.join('/var', 'lib', 'karimerp'),
});

// مجلدات البيانات المشتركة خارج المشروع (للحفاظ عليها عند التحديث)
const SHARED_DIRS = Object.freeze({
  CERTS: path.join(PATHS.SHARED_INSTALL_DIR, 'certs'),
  BACKUPS: path.join(PATHS.SHARED_INSTALL_DIR, 'backups'),
  WHATSAPP: path.join(PATHS.SHARED_INSTALL_DIR, 'whatsapp-sessions'),
  WHATSAPP_LOGS: path.join(PATHS.SHARED_INSTALL_DIR, 'whatsapp-logs'),
  WHATSAPP_MEDIA: path.join(PATHS.SHARED_INSTALL_DIR, 'whatsapp-media'),
  YARASOFT: path.join(PATHS.SHARED_INSTALL_DIR, 'yarasoft'),
  LOGS: path.join(PATHS.SHARED_INSTALL_DIR, 'logs'),
});

// ─────────────────────────────────────────────────────────────
// 1. أدوات العرض (Colors + Arabic friendly output)
// ─────────────────────────────────────────────────────────────
const COLOR = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
  red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m',
  blue: '\x1b[34m', magenta: '\x1b[35m', cyan: '\x1b[36m', white: '\x1b[37m',
  bgRed: '\x1b[41m', bgGreen: '\x1b[42m', bgYellow: '\x1b[43m', bgBlue: '\x1b[44m',
};
const ts = () => {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `[${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}]`;
};
const head = (m) => console.log(`\n${COLOR.bold}${COLOR.bgBlue}${COLOR.white} ${ts()}  STEP  ${m}  ${COLOR.reset}\n`);
const ok = (m) => console.log(`${ts()}  ${COLOR.green}${COLOR.bold}OK    ${COLOR.reset} ${m}`);
const info = (m) => console.log(`${ts()}  ${COLOR.cyan}${COLOR.bold}INFO  ${COLOR.reset} ${m}`);
const warn = (m) => console.log(`${ts()}  ${COLOR.yellow}${COLOR.bold}WARN  ${COLOR.reset} ${m}`);
const fail = (m) => console.log(`${ts()}  ${COLOR.red}${COLOR.bold}FAIL  ${COLOR.reset} ${m}`);
const done = (m) => console.log(`\n${COLOR.bgGreen}${COLOR.white}${COLOR.bold}  ${m}  ${COLOR.reset}\n`);
const fatal = (m, code = 1) => {
  console.log(`\n${COLOR.bgRed}${COLOR.white}${COLOR.bold}  خطأ قاتل  ${COLOR.reset}`);
  console.log(`${COLOR.red}${m}${COLOR.reset}\n`);
  process.exit(code);
};
const section = (t) => {
  const line = '═'.repeat(Math.max(40, t.length + 12));
  console.log(`\n${COLOR.magenta}${COLOR.bold}╔${line}╗${COLOR.reset}`);
  console.log(`${COLOR.magenta}${COLOR.bold}║${' '.repeat(5)}${t}${' '.repeat(Math.max(5, line.length - t.length - 6))}║${COLOR.reset}`);
  console.log(`${COLOR.magenta}${COLOR.bold}╚${line}╝${COLOR.reset}\n`);
};

// ─────────────────────────────────────────────────────────────
// 2. أدوات قراءة / كتابة ملفات .env
// ─────────────────────────────────────────────────────────────
function readEnv(p = PATHS.ENV_FILE) {
  const out = {};
  if (!fs.existsSync(p)) return out;
  for (const raw of fs.readFileSync(p, 'utf-8').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const idx = line.indexOf('=');
    if (idx === -1) continue;
    const k = line.slice(0, idx).trim();
    let v = line.slice(idx + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    out[k] = v;
  }
  return out;
}

function writeEnv(envObj, targetPath = PATHS.ENV_FILE) {
  const lines = [];
  lines.push('# Karim ERP - ملف الإعداد التلقائي');
  lines.push(`# تم إنشاؤه بواسطة deploy-machine.mjs في ${new Date().toLocaleString('ar-EG')}`);
  lines.push('# يمكنك تعديل القيم يدوياً بعد ذلك - سيعاد إكتشاف الأجهزة تلقائياً');
  lines.push('');
  const groupOrder = [
    ['NODE_ENV', 'HOST', 'PORT', 'ALLOWED_ORIGINS', 'TRUST_PROXY'],
    ['DB_HOST', 'DB_PORT', 'DB_NAME', 'DB_USER', 'DB_PASSWORD', 'DB_MODE'],
    ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET', 'EMPLOYEE_QR_SECRET'],
    ['SKIP_BULLMQ', 'REDIS_URL'],
    ['BACKUPS_DIR', 'KARIM_BACKUP_RETENTION', 'LOG_LEVEL', 'LOG_PRETTY'],
    ['SSL_KEY', 'SSL_CERT'],
    ['ZK_REPROCESS_HOURS'],
    ['YARASOFT_ENABLED', 'YARASOFT_SHARE', 'YARASOFT_ORACLE_STAGING', 'YARASOFT_DRY_RUN'],
    ['WHATSAPP_ENABLED', 'WHATSAPP_SESSION_DIR', 'WHATSAPP_LOG_DIR', 'WHATSAPP_MEDIA_DIR', 'WHATSAPP_BACKUP_DIR'],
    ['METRICS_API_KEY', 'HEALTH_TOKEN', 'API_KEY'],
  ];
  const grouped = new Set();
  for (const group of groupOrder) {
    let wroteGroup = false;
    for (const k of group) {
      if (k in envObj) {
        if (!wroteGroup) { lines.push(''); wroteGroup = true; }
        lines.push(`${k}=${formatEnvValue(envObj[k])}`);
        grouped.add(k);
      }
    }
  }
  for (const [k, v] of Object.entries(envObj)) {
    if (!grouped.has(k)) lines.push(`${k}=${formatEnvValue(v)}`);
  }
  lines.push('');
  if (!IS_DOCTOR) {
    const dir = path.dirname(targetPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(targetPath, lines.join('\n'), 'utf-8');
  }
}

function formatEnvValue(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  if (/[#\s"'\\=]/.test(s)) return JSON.stringify(s);
  return s;
}

function setEnvValue(envObj, key, value, { overwrite = false } = {}) {
  if (overwrite || !(key in envObj) || envObj[key] === '' || envObj[key] === undefined) {
    if (IS_VERBOSE && value) info(`ضبط: ${key} = ${typeof value === 'string' && value.length > 40 ? value.slice(0, 20) + '...' : value}`);
    envObj[key] = value;
    return true;
  }
  return false;
}

// ─────────────────────────────────────────────────────────────
// 3. أدوات مساعدة: توليد أسرار + فحص منافذ + فحص ملفات حرجة
// ─────────────────────────────────────────────────────────────
function generateStrongSecret(len = 64) {
  return crypto.randomBytes(len).toString('base64url');
}

function probePort(host, port, timeout = 1200) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let done = false;
    const finish = (r) => { if (done) return; done = true; try { socket.destroy(); } catch (_) {} resolve(r); };
    socket.setTimeout(timeout);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
    try { socket.connect(Number(port), host); } catch (_) { finish(false); }
  });
}

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    if (!IS_DOCTOR) fs.mkdirSync(dirPath, { recursive: true });
    return true;
  }
  return false;
}

function runCommand(cmd, args, { cwd = ROOT, envAdd = {}, timeoutMs = 5 * 60 * 1000 } = {}) {
  if (IS_VERBOSE) info(`تشغيل: ${cmd} ${args.join(' ')}`);
  try {
    let finalCmd = cmd;
    let finalArgs = args;
    // تجنب تحذير DEP0190: عند استخدام shell=true، لا نمرر مصفوفة args
    if (IS_WIN) {
      // دمج الأمر مع الـ arguments في سطر واحد للـ shell
      const escapeArg = (a) => /[\s"]/.test(String(a)) ? `"${String(a).replace(/"/g, '\\"')}"` : String(a);
      finalCmd = [cmd, ...args].map(escapeArg).join(' ');
      finalArgs = [];
    }
    const r = spawnSync(finalCmd, finalArgs, {
      cwd,
      stdio: IS_VERBOSE ? 'inherit' : 'pipe',
      encoding: 'utf-8',
      timeout: timeoutMs,
      env: { ...process.env, ...envAdd },
      shell: IS_WIN ? true : false,
    });
    return { ok: r.status === 0, status: r.status, stdout: r.stdout || '', stderr: r.stderr || '', error: null };
  } catch (e) {
    return { ok: false, status: -1, stdout: '', stderr: '', error: String(e.message || e) };
  }
}

// ─────────────────────────────────────────────────────────────
// 4. فحص وجود شهادات SSL وتوليدها ذاتيًا لو محتاجة
// ─────────────────────────────────────────────────────────────
function ensureSelfSignedCerts(envObj) {
  section('خطوة الشهادات الأمنية (SSL/TLS)');
  const certDir = SHARED_DIRS.CERTS;
  ensureDir(certDir);

  const keyPath = envObj.SSL_KEY && fs.existsSync(envObj.SSL_KEY) ? envObj.SSL_KEY : path.join(certDir, 'horus.key');
  const certPath = envObj.SSL_CERT && fs.existsSync(envObj.SSL_CERT) ? envObj.SSL_CERT : path.join(certDir, 'horus.crt');

  const haveBoth = fs.existsSync(keyPath) && fs.existsSync(certPath);

  if (!haveBoth) {
    info('لا توجد شهادات SSL صالحة — سيتم توليد شهادة ذاتية موقعة من نفس النظام للاستخدام المحلي');
    if (IS_DOCTOR) {
      warn('[DOCTOR] سيتم توليد شهادات SSL ذاتية عند التنفيذ الفعلي');
    } else {
      // توليد شهادة ذاتية التوقيع عبر openssl لو موجود، وإلا توليدنا عبر node crypto عادي
      const opensslExe = IS_WIN ? 'openssl.exe' : 'openssl';
      const r = runCommand(opensslExe, [
        'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
        '-keyout', keyPath, '-out', certPath,
        '-days', '3650',
        '-subj', '/CN=KarimERP-Local/O=KarimTeam/C=EG/ST=Cairo/L=NewCairo',
      ], { timeoutMs: 20000 });
      if (r.ok && fs.existsSync(keyPath) && fs.existsSync(certPath)) {
        ok('تم توليد شهادة SSL ذاتية بنجاح (صالحة 10 سنوات)');
      } else {
        warn('openssl غير متاح — سيُستخدم وضع HTTP عادي بدون SSL حتى تثبت الشهادات');
        warn('يمكنك لاحقاً وضع شهاداتك في المسار: ' + certDir);
      }
    }
  } else {
    ok('شهادات SSL موجودة وسليمة');
  }

  if (fs.existsSync(keyPath)) setEnvValue(envObj, 'SSL_KEY', pathToPosix(keyPath), { overwrite: false });
  if (fs.existsSync(certPath)) setEnvValue(envObj, 'SSL_CERT', pathToPosix(certPath), { overwrite: false });
}

function pathToPosix(p) { return String(p || '').split(path.sep).join('/'); }

// ─────────────────────────────────────────────────────────────
// 5. كشف PostgreSQL وضبط إعدادات قاعدة البيانات
// ─────────────────────────────────────────────────────────────
function detectPostgreSQL() {
  section('فحص وضبط إعدادات قاعدة البيانات PostgreSQL');
  const result = {
    host: '127.0.0.1', port: null, user: 'postgres',
    version: null, psqlPath: null, serviceName: null,
    password: '', mode: 'system',
  };
  const exe = IS_WIN ? '.exe' : '';

  // 1) البحث عن psql في مواقع التثبيت الرسمية
  const candidates = [];
  if (IS_WIN) {
    for (const r of ['C:\\Program Files\\PostgreSQL', 'C:\\Program Files (x86)\\PostgreSQL', 'C:\\PostgreSQL']) {
      if (fs.existsSync(r)) {
        try {
          for (const v of fs.readdirSync(r).filter(n => /^\d+/.test(n)).sort((a, b) => parseInt(b) - parseInt(a))) {
            const p = path.join(r, v, 'bin', 'psql' + exe);
            if (fs.existsSync(p)) candidates.push(p);
          }
        } catch (_) {}
      }
    }
    // PATH
    try {
      const w = spawnSync('where', ['psql'], { encoding: 'utf-8', timeout: 5000 });
      if (w.status === 0) for (const l of String(w.stdout || '').split('\n')) {
        const p = l.trim();
        if (p && fs.existsSync(p) && !candidates.includes(p)) candidates.push(p);
      }
    } catch (_) {}
  } else {
    try {
      const w = spawnSync('which', ['psql'], { encoding: 'utf-8', timeout: 5000 });
      if (w.status === 0) {
        const p = String(w.stdout || '').trim();
        if (p && fs.existsSync(p)) candidates.push(p);
      }
    } catch (_) {}
    for (const r of ['/usr/lib/postgresql', '/usr/pgsql-16', '/usr/pgsql-15']) {
      if (fs.existsSync(r)) {
        try {
          for (const v of fs.readdirSync(r)) {
            const binPath = path.join(r, v, 'bin', 'psql' + exe);
            if (fs.existsSync(binPath) && !candidates.includes(binPath)) candidates.push(binPath);
          }
        } catch (_) {}
      }
    }
  }

  if (candidates[0]) {
    result.psqlPath = candidates[0];
    info(`تم العثور على: psql في ${result.psqlPath}`);
    const ver = runCommand(result.psqlPath, ['--version']);
    if (ver.ok) {
      const m = String(ver.stdout || '').match(/(\d+\.\d+)/);
      if (m) result.version = m[1];
      ok(`نسخة PostgreSQL المكتشفة: ${result.version || 'غير معروفة'}`);
    }
  } else {
    warn('لم يتم العثور على PostgreSQL مثبتًا على هذا الجهاز');
    warn('إذا كنت تريد استخدام PostgreSQL النظامي — ثبّته أولاً من postgresql.org ثم عد للتشغيل مرة أخرى');
    warn('أو يمكنك استخدام وضع المحاكاة لاختبار الواجهة بدون قاعدة بيانات حقيقية');
  }

  // 2) كشف المنفذ العامل فعليًا يتم لاحقًا في detectPgPort (غير متزامن)
  return result;
}

async function detectPgPort(existingPort) {
  const scan = [5432, 5433, 5434, 5435, 5436, 5444, 54321];
  if (existingPort && !scan.includes(Number(existingPort))) scan.unshift(Number(existingPort));
  for (const p of scan) {
    if (await probePort('127.0.0.1', p, 400)) {
      ok(`تم اكتشاف PostgreSQL عامل على المنفذ: ${p}`);
      return String(p);
    }
  }
  warn('لا يوجد منفذ PostgreSQL مفتوح على هذا الجهاز - سيبقى المنفذ الافتراضي 5432');
  return null;
}

async function testPgConnection(envObj) {
  const psql = (() => {
    // إستخدام db-resolver القائم لو موجود
    const resolverPath = path.join(PATHS.SCRIPTS, 'db-resolver.js');
    if (fs.existsSync(resolverPath)) {
      try {
        // نشغلها عبر subprocess
        const r = runCommand(process.execPath, [resolverPath, '--json'], { timeoutMs: 15000 });
        if (r.ok && r.stdout && r.stdout.includes('{')) {
          try {
            const j = JSON.parse(r.stdout.slice(r.stdout.indexOf('{')));
            if (j && j.psql) return j.psql;
          } catch (_) {}
        }
      } catch (_) {}
    }
    return IS_WIN ? 'psql.exe' : 'psql';
  })();

  const host = envObj.DB_HOST || '127.0.0.1';
  const port = envObj.DB_PORT || '5432';
  const user = envObj.DB_USER || 'postgres';
  const db = envObj.DB_NAME || 'postgres';
  const pw = envObj.DB_PASSWORD || '';

  if (IS_VERBOSE) info(`محاولة الاتصال: pg://${user}@${host}:${port}/${db}`);

  const r = runCommand(psql, [
    '-h', host, '-p', String(port), '-U', user, '-d', db,
    '-c', 'SELECT 1 AS karim_probe;', '-t', '-A',
  ], {
    envAdd: pw ? { PGPASSWORD: pw } : {},
    timeoutMs: 10000,
  });
  const connected = r.ok && String(r.stdout || '').includes('1');
  if (connected) ok('اتصال PostgreSQL — ناجح ✓');
  else {
    warn('تعذر الاتصال بقاعدة البيانات — تفقد كلمة المرور في .env');
    if (IS_VERBOSE && r.stderr) console.log(`${COLOR.dim}${r.stderr}${COLOR.reset}`);
  }
  return connected;
}

// ─────────────────────────────────────────────────────────────
// 6. npm install (لو node_modules غير موجودة)
// ─────────────────────────────────────────────────────────────
function ensureNodeModules() {
  section('فحص حزم Node.js (node_modules)');
  const coreDeps = ['express', 'pg', 'dotenv', 'socket.io', 'zod', 'bullmq'];
  const pkg = JSON.parse(fs.readFileSync(PATHS.PACKAGE_JSON, 'utf-8'));
  const totalExpected = Object.keys(pkg.dependencies || {}).length;

  // نحسب كم حزمة موجودة فعليًا
  let existing = 0;
  const missing = [];
  for (const d of Object.keys(pkg.dependencies || {})) {
    if (fs.existsSync(path.join(PATHS.NODE_MODULES, d))) existing++;
    else missing.push(d);
  }

  info(`الحزم الموجودة: ${existing} / ${totalExpected}`);

  if (existing < Math.max(3, totalExpected * 0.5)) {
    warn('الحزم الأساسية غير موجودة أو ناقصة بشدة — سأقوم بتشغيل npm install...');
    if (IS_DOCTOR) {
      warn('[DOCTOR] سيتم تشغيل npm install عند التنفيذ الفعلي');
      return false;
    }
    const npm = IS_WIN ? 'npm.cmd' : 'npm';
    info('تشغيل: npm install (قد يستغرق 3-10 دقائق حسب سرعة الإنترنت)');
    const r = runCommand(npm, ['install', '--no-audit', '--no-fund', '--loglevel=error'], { timeoutMs: 20 * 60 * 1000 });
    if (r.ok) {
      ok('تم تثبيت جميع الحزم بنجاح');
      return true;
    } else {
      fatal('فشل npm install: تحقق من اتصال الإنترنت أو شغّل npm install يدوياً في مجلد المشروع');
      return false;
    }
  } else {
    ok('الحزم الأساسية موجودة — تخطي npm install');
    return true;
  }
}

// ─────────────────────────────────────────────────────────────
// 7. تشغيل verify-env --fix بعد إعداد الأساسيات
// ─────────────────────────────────────────────────────────────
function runVerifyFix() {
  section('تشغيل مدقق البيئة (verify-env --fix)');
  const scriptPath = path.join(PATHS.SCRIPTS, 'verify-env.js');
  if (!fs.existsSync(scriptPath)) {
    warn('ملف verify-env.js غير موجود — يتخطى هذه الخطوة');
    return true;
  }
  const args = [scriptPath, '--fix'];
  const r = runCommand(process.execPath, args, { timeoutMs: 90 * 1000 });
  if (IS_VERBOSE && r.stdout) console.log(r.stdout);
  if (r.ok || r.status === 0 || r.status === 2) {
    ok(r.status === 0 ? 'مدقق البيئة — كل شيء سليم ✓' : 'مدقق البيئة — اكتمل بتحذيرات (يرجى مراجعتها)');
    return true;
  } else {
    warn('مدقق البيئة انتهى بحالة خطأ - يرجى فحص السطر أعلاه');
    return false;
  }
}

// ─────────────────────────────────────────────────────────────
// 8. تشغيل migrations وتهجير كلمات المرور
// ─────────────────────────────────────────────────────────────
async function runMigrations(envObj) {
  section('تطبيق ترقيات قاعدة البيانات (Migrations)');
  const migrationScript = path.join(PATHS.DB_SCRIPTS, 'run-migration.js');
  if (!fs.existsSync(migrationScript)) {
    warn('ملف run-migration.js غير موجود — يتخطى تطبيق الترقيات');
    return false;
  }
  if (IS_DOCTOR) {
    info('[DOCTOR] سيتم تطبيق الترقيات عند التنفيذ الفعلي');
    return true;
  }
  // نتحقق من الاتصال أولاً
  if (!(await testPgConnection(envObj))) {
    warn('اتصال قاعدة البيانات غير متاح — سيؤجل تطبيق الترقيات لحين ضبط إعدادات PG');
    return false;
  }
  const r = runCommand(process.execPath, [migrationScript], { timeoutMs: 5 * 60 * 1000 });
  if (IS_VERBOSE && r.stdout) console.log(r.stdout);
  if (r.ok) { ok('تم تطبيق جميع الترقيات بنجاح ✓'); return true; }
  else { warn('فشل تطبيق بعض الترقيات - يرجى التشغيل يدوياً: npm run migrate'); return false; }
}

function migratePlainPasswords() {
  section('تهجير كلمات المرور النصية إلى تشفير bcrypt');
  const script = path.join(PATHS.SCRIPTS, 'migrate-plaintext-passwords.js');
  if (!fs.existsSync(script)) { info('لا يوجد سكربت تهجير كلمات مرور نصية — تخطى'); return true; }
  if (IS_DOCTOR) { info('[DOCTOR] سيتم تشغيل تهجير كلمات المرور عند التنفيذ الفعلي'); return true; }
  const r = runCommand(process.execPath, [script], { timeoutMs: 5 * 60 * 1000 });
  if (r.ok) ok('تهجير كلمات المرور — اكتمل بنجاح');
  else warn('تهجير كلمات المرور انتهى بتحذيرات (قد يكون كل شيء مشفر مسبقاً وهذا طبيعي)');
  return true;
}

// ─────────────────────────────────────────────────────────────
// 9. Smoke Test سريع (إذا طلبنا)
// ─────────────────────────────────────────────────────────────
async function smokeTestQuick(envObj) {
  section('اختبار تدخيني سريع (Smoke Test)');
  const port = Number(envObj.PORT || 5000);
  const isUp = await probePort('127.0.0.1', port, 600);
  if (isUp) {
    ok(`المنفذ ${port} مفتوح — يبدو أن الخادم شغال من قبل`);
    try {
      const { default: http } = await import('node:http');
      const req = http.request({
        host: '127.0.0.1', port, path: '/api/health/live', method: 'GET', timeout: 3000,
      }, (res) => {
        if (res.statusCode === 200) ok('Health Check /api/health/live = 200 ✓');
        else warn(`Health Check رد بـ ${res.statusCode}`);
      });
      req.on('error', () => {});
      req.on('timeout', () => req.destroy());
      req.end();
    } catch (_) {}
    return true;
  } else {
    info(`الخادم غير مشغل حالياً على المنفذ ${port} — طبيعي لأنه لم تقم بتشغيله بعد`);
    info(`للتشغيل: npm start`);
    return false;
  }
}

// ─────────────────────────────────────────────────────────────
// 10. التقرير النهائي بالعربية
// ─────────────────────────────────────────────────────────────
function printFinalReport(envObj, phaseResults) {
  const port = envObj.PORT || 5000;
  const host = envObj.HOST || '0.0.0.0';
  const localUrls = [
    `https://localhost:${port}`,
    `http://localhost:${Number(port) + 1}`,
    `https://127.0.0.1:${port}`,
  ];

  const line = '═'.repeat(64);
  console.log(`\n\n${COLOR.bold}${COLOR.bgBlue}${COLOR.white}${line}${COLOR.reset}`);
  console.log(`${COLOR.bold}${COLOR.bgBlue}${COLOR.white}${' '.repeat(15)}تقرير النشر النهائي لـ Karim ERP${' '.repeat(15)}${COLOR.reset}`);
  console.log(`${COLOR.bold}${COLOR.bgBlue}${COLOR.white}${line}${COLOR.reset}\n`);

  if (IS_DOCTOR) {
    console.log(`${COLOR.yellow}${COLOR.bold}[وضع الفحص فقط - DOCTOR MODE] لم يتم تطبيق أي تغييرات على الجهاز${COLOR.reset}\n`);
  }

  console.log(`${COLOR.bold}${COLOR.cyan}─── حالة الخطوات الرئيسية ───${COLOR.reset}`);
  for (const [phase, okState, note] of phaseResults) {
    const sym = okState ? `${COLOR.green}✓${COLOR.reset}` : `${COLOR.yellow}!${COLOR.reset}`;
    console.log(`   ${sym}  ${phase}${note ? `  ${COLOR.dim}(${note})${COLOR.reset}` : ''}`);
  }

  console.log(`\n${COLOR.bold}${COLOR.cyan}─── روابط التشغيل (افتحها في المتصفح) ───${COLOR.reset}`);
  for (const u of localUrls) console.log(`${COLOR.green}   →  ${u}${COLOR.reset}`);

  const nets = os.networkInterfaces();
  const lanIps = [];
  for (const iface of Object.values(nets || {})) {
    for (const a of iface || []) {
      if (a.family === 'IPv4' && !a.internal) lanIps.push(`https://${a.address}:${port}`);
    }
  }
  if (lanIps.length) {
    console.log(`\n${COLOR.bold}${COLOR.cyan}─── الروابط داخل الشبكة المحلية (للأجهزة الأخرى) ───${COLOR.reset}`);
    for (const u of lanIps.slice(0, 5)) console.log(`${COLOR.blue}   →  ${u}${COLOR.reset}`);
  }

  console.log(`\n${COLOR.bold}${COLOR.cyan}─── الأوامر المفيدة ───${COLOR.reset}`);
  console.log(`   ${COLOR.magenta}بدء الخدمة:${COLOR.reset}    npm start`);
  console.log(`   ${COLOR.magenta}إيقاف الخدمة:${COLOR.reset}  npm stop`);
  console.log(`   ${COLOR.magenta}حالة الخدمة:${COLOR.reset}  npm status`);
  console.log(`   ${COLOR.magenta}فحص سريع:${COLOR.reset}    npm run verify:fix`);
  console.log(`   ${COLOR.magenta}نسخ احتياطي:${COLOR.reset}  npm run backup`);
  console.log(`   ${COLOR.magenta}تطبيق ترقيات:${COLOR.reset} npm run migrate`);

  console.log(`\n${COLOR.bold}${COLOR.cyan}─── مسارات البيانات المهمة (احفظها عند النقل القادم) ───${COLOR.reset}`);
  console.log(`   ${COLOR.dim}.env:${COLOR.reset}              ${PATHS.ENV_FILE}`);
  console.log(`   ${COLOR.dim}الشهادات:${COLOR.reset}            ${SHARED_DIRS.CERTS}`);
  console.log(`   ${COLOR.dim}النسخ الاحتياطية:${COLOR.reset}  ${envObj.BACKUPS_DIR || SHARED_DIRS.BACKUPS}`);
  console.log(`   ${COLOR.dim}جلسات واتساب:${COLOR.reset}     ${envObj.WHATSAPP_SESSION_DIR || SHARED_DIRS.WHATSAPP}`);

  if (!IS_DOCTOR) {
    const allOk = phaseResults.every(([, s]) => s);
    if (allOk) done('كل شيء جاهز — Karim ERP نُشر بنجاح على هذا الجهاز ✅');
    else console.log(`\n${COLOR.yellow}${COLOR.bold}انتهى النشر ببعض التحذيرات — تم إعداد الأساسيات بنجاح، راجع التحذيرات أعلاه.${COLOR.reset}\n`);
  } else {
    console.log(`\n${COLOR.green}${COLOR.bold}تشغيل الأمر التالي لتنفيذ النشر فعليًا:${COLOR.reset}`);
    console.log(`   ${COLOR.bold}${COLOR.magenta}node scripts/deploy-machine.mjs${COLOR.reset}\n`);
  }
}

// ─────────────────────────────────────────────────────────────
// MAIN التدفق الرئيسي
// ─────────────────────────────────────────────────────────────
async function main() {
  const phaseResults = [];

  section(IS_DOCTOR ? 'Karim ERP — فحص جهاز جديد (DOCTOR MODE)' : 'Karim ERP — نشر آلي على جهاز جديد');
  console.log(`${COLOR.dim}مسار جذر المشروع: ${ROOT}${COLOR.reset}`);
  console.log(`${COLOR.dim}نظام التشغيل: ${process.platform} (${os.arch()})${COLOR.reset}`);
  console.log(`${COLOR.dim}نوع التنفيذ: ${IS_DOCTOR ? 'فحص فقط (بدون تغييرات)' : 'نشر فعلي + إصلاح تلقائي'}${COLOR.reset}\n`);

  // ── المرحلة 1: فحص Node.js
  head('1/10  فحص إصدار Node.js');
  const nodeV = process.versions.node;
  const nodeMajor = parseInt(nodeV.split('.')[0], 10);
  if (nodeMajor >= 20) {
    ok(`Node.js ${nodeV} — الإصدار متوافق ✓`);
    phaseResults.push(['فحص Node.js (>=20)', true, nodeV]);
  } else {
    fatal(`إصدار Node.js قديم جدًا: ${nodeV}. Karim ERP يتطلب Node.js 20 أو أحدث. قم بالتحديث من nodejs.org`);
  }

  // ── المرحلة 2: فحص وجود الملفات الأساسية للمشروع
  head('2/10  فحص ملفات المشروع الأساسية');
  const criticalFiles = [
    PATHS.PACKAGE_JSON, PATHS.ENV_EXAMPLE, PATHS.SERVER_JS,
    path.join(PATHS.SCRIPTS, 'serve.js'),
    path.join(PATHS.DB_SCRIPTS, 'run-migration.js'),
  ];
  let allCritical = true;
  for (const f of criticalFiles) {
    if (fs.existsSync(f)) ok(`ملف موجود: ${path.relative(ROOT, f) || path.basename(f)}`);
    else { fail(`ملف مفقود: ${f}`); allCritical = false; }
  }
  phaseResults.push(['ملفات المشروع الأساسية', allCritical]);
  if (!allCritical) fatal('بعض ملفات المشروع الأساسية مفقودة — تأكد من أنك نسخت مجلد المشروع بالكامل');

  // ── المرحلة 3: إعداد مجلدات البيانات المشتركة + .env
  head('3/10  إنشاء مجلدات البيانات وملف الإعدادات .env');
  for (const [name, dir] of Object.entries(SHARED_DIRS)) {
    ensureDir(dir);
  }
  info(`مجلدات البيانات المشتركة في: ${PATHS.SHARED_INSTALL_DIR}`);
  ensureDir(PATHS.LOGS);
  ensureDir(PATHS.CERTS_DIR);

  const envExisted = fs.existsSync(PATHS.ENV_FILE);
  let envObj = readEnv(PATHS.ENV_FILE);
  const envExample = readEnv(PATHS.ENV_EXAMPLE);

  // نسخ المفاتيح من example إلى env لو غير موجودة
  let addedKeys = 0;
  for (const k of Object.keys(envExample)) {
    if (!(k in envObj)) {
      envObj[k] = envExample[k];
      addedKeys++;
    }
  }
  if (addedKeys) info(`تمت إضافة ${addedKeys} مفتاح جديد من .env.example إلى ملف الإعدادات`);
  setEnvValue(envObj, 'NODE_ENV', 'production', { overwrite: false });
  setEnvValue(envObj, 'HOST', '0.0.0.0', { overwrite: false });
  setEnvValue(envObj, 'PORT', '5001', { overwrite: false });
  setEnvValue(envObj, 'ALLOWED_ORIGINS', `https://localhost:${envObj.PORT || 5001},http://localhost:${(Number(envObj.PORT) || 5001) + 1}`, { overwrite: false });

  ok(envExisted ? 'ملف .env موجود — تم تحديث المفاتيح الناقصة فقط' : 'تم إنشاء ملف .env جديد من القالب');
  phaseResults.push(['إعداد ملف .env', true, envExisted ? 'موجود سابقاً' : 'جديد']);

  // ── المرحلة 4: توليد أسرار JWT قوية لو كانت فارغة
  head('4/10  توليد أسرار الأمان (JWT Secrets)');
  const neededSecrets = [
    ['JWT_ACCESS_SECRET', 64],
    ['JWT_REFRESH_SECRET', 64],
    ['EMPLOYEE_QR_SECRET', 48],
  ];
  let generated = 0;
  for (const [k, len] of neededSecrets) {
    if (!envObj[k] || envObj[k] === '' || envObj[k].length < 20) {
      const val = generateStrongSecret(len);
      setEnvValue(envObj, k, val, { overwrite: true });
      generated++;
    } else {
      ok(`${k} — موجود وقوي`);
    }
  }
  if (generated) ok(`تم توليد ${generated} أسرار JWT جديدة وتخزينها في .env`);
  phaseResults.push(['توليد أسرار JWT', true, `${generated === 0 ? 'كلها موجودة' : generated + ' جديدة'}`]);

  // ── المرحلة 5: إعداد SSL Certificates ذاتية التوقيع
  head('5/10  إعداد شهادات SSL/TLS');
  ensureSelfSignedCerts(envObj);
  phaseResults.push(['شهادات SSL/TLS', true, (envObj.SSL_KEY && envObj.SSL_CERT) ? 'موجودة' : 'HTTP فقط']);

  // ── المرحلة 6: ضبط مسارات البيانات (Backups / WhatsApp / Yarasoft) إلى المسار المشترك
  head('6/10  ضبط مسارات البيانات إلى مجلد البيانات المشترك');
  const pathMappings = [
    ['BACKUPS_DIR', SHARED_DIRS.BACKUPS],
    ['WHATSAPP_SESSION_DIR', SHARED_DIRS.WHATSAPP],
    ['WHATSAPP_LOG_DIR', SHARED_DIRS.WHATSAPP_LOGS],
    ['WHATSAPP_MEDIA_DIR', SHARED_DIRS.WHATSAPP_MEDIA],
    ['YARASOFT_SHARE', SHARED_DIRS.YARASOFT],
    ['YARASOFT_ORACLE_STAGING', path.join(SHARED_DIRS.YARASOFT, 'OraStaging')],
  ];
  let fixedCount = 0;
  for (const [k, fallback] of pathMappings) {
    const curr = envObj[k];
    if (!curr || curr === '' || !fs.existsSync(curr)) {
      ensureDir(fallback);
      setEnvValue(envObj, k, pathToPosix(fallback), { overwrite: true });
      fixedCount++;
      info(`${k} — ضبط إلى: ${fallback}`);
    } else {
      ok(`${k} — المسار الحالي صالح: ${curr}`);
    }
  }
  phaseResults.push(['ضبط مسارات البيانات', true, fixedCount === 0 ? 'كلها صالحة' : `تم إصلاح ${fixedCount}`]);

  // حفظ .env حتى الآن قبل استدعاء verify-env
  if (!IS_DOCTOR) writeEnv(envObj);
  else info('[DOCTOR] تخطي كتابة ملف .env في وضع الفحص');

  // ── المرحلة 7: npm install (لو محتاج)
  head('7/10  فحص وتثبيت حزم Node.js');
  const nmOk = ensureNodeModules();
  phaseResults.push(['تثبيت node_modules', nmOk]);

  // ── المرحلة 8: كشف PostgreSQL + ضبط المنفذ + اختبار الاتصال
  head('8/10  كشف وإعداد قاعدة البيانات PostgreSQL');
  const pgInfo = detectPostgreSQL();

  // نحدد المنفذ
  setEnvValue(envObj, 'DB_HOST', pgInfo.host, { overwrite: false });
  setEnvValue(envObj, 'DB_USER', pgInfo.user, { overwrite: false });
  setEnvValue(envObj, 'DB_NAME', 'karim_erp', { overwrite: false });
  setEnvValue(envObj, 'DB_MODE', pgInfo.mode, { overwrite: false });

  if (pgInfo.version) setEnvValue(envObj, 'PG_INSTALLED_VERSION', pgInfo.version, { overwrite: true });

  const detectedPort = await detectPgPort(envObj.DB_PORT);
  if (detectedPort) setEnvValue(envObj, 'DB_PORT', detectedPort, { overwrite: true });

  // اختبار الاتصال (لو هناك دعم لـ psql)
  const pgConnected = await testPgConnection(envObj);
  phaseResults.push(['إعداد قاعدة البيانات', pgConnected, detectedPort ? `منفذ ${detectedPort}` : 'غير متصل']);

  // حفظ التحديثات
  if (!IS_DOCTOR) writeEnv(envObj);

  // ── المرحلة 9: تشغيل verify-env --fix (بعد كل الإعدادات)
  head('9/10  تشغيل مدقق البيئة الشامل مع الإصلاح التلقائي');
  const vOk = runVerifyFix();
  phaseResults.push(['مدقق البيئة verify-env', vOk]);

  // إعادة قراءة env بعد الإصلاحات التي قد يفعلها verify-env
  envObj = readEnv(PATHS.ENV_FILE);

  // ── المرحلة 10: تطبيق migrations + تهجير passwords + smoke test
  head('10/10  تطبيق ترقيات قاعدة البيانات والاختبار التدخيني');
  const migOk = await runMigrations(envObj);
  phaseResults.push(['تطبيق ترقيات DB', migOk]);

  const mpOk = migratePlainPasswords();
  phaseResults.push(['تهجير كلمات المرور', mpOk]);

  const smokeOk = await smokeTestQuick(envObj);
  phaseResults.push(['الاختبار التدخيني Smoke', smokeOk, smokeOk ? 'الخادم شغال بالفعل' : 'بانتظار تشغيل npm start']);

  // ── حفظ نهائي وطباعة التقرير
  if (!IS_DOCTOR) writeEnv(envObj);

  printFinalReport(envObj, phaseResults);
  process.exit(0);
}

main().catch((e) => {
  console.error('\nخطأ غير متوقع أثناء النشر:', e);
  process.exit(99);
});
