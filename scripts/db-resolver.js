/**
 * db-resolver — Karim ERP Smart Database Resolver v5.0
 * ─────────────────────────────────────────────────────────────
 * العقل الذكي للنظام: يكتشف تلقائياً أي PostgreSQL مثبتة على الجهاز،
 * يحدد المنفذ العامل فعلياً، يقلع الخدمة المتوقفة، ويوحد كل المسارات.
 *
 * يعمل على: Windows (Program Files + Registry + Services + PATH)
 *            Linux   (/usr/lib/postgresql + pg_lsclusters + PATH)
 *
 * الاستخدام:
 *   const { resolveDatabase, KARIM_PORTS } = require('./db-resolver');
 *   const cfg = resolveDatabase({ password: '...' }); // {host,port,user,bin,service,version}
 *
 * مبادئ احترافية:
 *  - process.env أولاً ثم .env (عكس الخطأ القديم)
 *  - لا توليد عشوائي لكلمة المرور بصمت أبداً
 *  - اكتشاف موسع للمنافذ: 5432..5444 + أي DB_PORT مخصص
 *  - كشف النسخ عبر Registry + مجلدات + PATH + Services
 *  - رسائل عربية مصنفة قابلة للفهم من غير المبرمج
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const ENV_FILE = path.join(ROOT, '.env');
const IS_WIN = process.platform === 'win32';

// كل المنافذ الشائعة لـ PostgreSQL / EDB
const KARIM_PORTS = ['5432', '5433', '5434', '5435', '5436', '5444'];

// ─── قراءة .env ──────────────────────────────────────────
function readEnvFile() {
  const out = {};
  try {
    if (!fs.existsSync(ENV_FILE)) return out;
    for (const line of fs.readFileSync(ENV_FILE, 'utf-8').split('\n')) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      const i = t.indexOf('=');
      if (i === -1) continue;
      out[t.slice(0, i).trim()] = t.slice(i + 1).trim().replace(/^["']|["']$/g, '');
    }
  } catch (_) {}
  return out;
}

// الأولوية الصحيحة: بيئة النظام أولاً (Docker/Service/Electron) ثم ملف .env ثم الافتراضي
function env(key, fallback = '') {
  if (process.env[key] !== undefined && process.env[key] !== '') return process.env[key];
  const f = readEnvFile();
  if (f[key] !== undefined && f[key] !== '') return f[key];
  // Pre-v5 backward compat: HORUS_* -> KARIM_* (one release cycle)
  const legacyMap = { KARIM_MIGRATION_MODE: 'HORUS_MIGRATION_MODE', KARIM_BACKUP_DIR: 'HORUS_BACKUP_DIR', KARIM_BACKUP_RETENTION: 'HORUS_BACKUP_RETENTION', KARIM_DATA_DIR: 'HORUS_DATA_DIR' };
  if (legacyMap[key]) {
    if (process.env[legacyMap[key]]) return process.env[legacyMap[key]];
    if (f[legacyMap[key]]) return f[legacyMap[key]];
  }
  return fallback;
}

// ─── اكتشاف ثنائيات PostgreSQL ───────────────────────────
function findAllPgBins(tool = 'psql') {
  const found = [];
  const push = (p) => {
    try {
      if (p && fs.existsSync(p) && !found.includes(p)) found.push(p);
    } catch (_) {}
  };
  const exe = IS_WIN ? '.exe' : '';
  if (IS_WIN) {
    // 1) مجلدات التثبيت الرسمية — الأحدث أولاً
    for (const root of ['C:\\Program Files\\PostgreSQL', 'C:\\Program Files (x86)\\PostgreSQL', 'C:\\PostgreSQL']) {
      try {
        if (!fs.existsSync(root)) continue;
        const vers = fs.readdirSync(root).filter((v) => /^\d+/.test(v)).sort((a, b) => parseInt(b, 10) - parseInt(a, 10));
        for (const v of vers) push(path.join(root, v, 'bin', tool + exe));
      } catch (_) {}
    }
    // 2) Registry — أدق مصدر لنسخ EDB
    try {
      const r = spawnSync('reg', ['query', 'HKLM\\SOFTWARE\\PostgreSQL\\Installations', '/s'], { encoding: 'utf-8', timeout: 8000 });
      if (r.status === 0) {
        for (const m of String(r.stdout || '').matchAll(/Base\s+Directory\s+REG_SZ\s+([^\r\n]+)/gi)) {
          push(path.join(m[1].trim(), 'bin', tool + exe));
        }
      }
    } catch (_) {}
    // 3) PATH
    try {
      const w = spawnSync('where', [tool], { encoding: 'utf-8', timeout: 5000 });
      if (w.status === 0) {
        for (const line of String(w.stdout || '').split('\n')) {
          const p = line.trim();
          if (p && p.toLowerCase().endsWith(tool.toLowerCase() + exe)) push(p);
        }
      }
    } catch (_) {}
  } else {
    try {
      if (fs.existsSync('/usr/lib/postgresql')) {
        for (const v of fs.readdirSync('/usr/lib/postgresql').sort().reverse()) push(path.join('/usr/lib/postgresql', v, 'bin', tool));
      }
    } catch (_) {}
    try {
      const w = spawnSync('which', ['-a', tool], { encoding: 'utf-8', timeout: 5000 });
      if (w.status === 0) for (const l of String(w.stdout || '').split('\n')) push(l.trim());
    } catch (_) {}
    try {
      const ls = spawnSync('pg_lsclusters', [], { encoding: 'utf-8', timeout: 5000 });
      if (ls.status === 0) {
        for (const m of String(ls.stdout || '').matchAll(/(\d+)\s+(\w+)\s+(\d+)\s+\w+\s+\S+\s+(\S+)/g)) {
          push(`/usr/lib/postgresql/${m[1]}/bin/${tool}`);
        }
      }
    } catch (_) {}
  }
  return found;
}

function getPgBinary(name = 'psql') {
  const all = findAllPgBins(name);
  return all.length ? all[0] : null;
}

// ─── خدمات Windows ──────────────────────────────────────
function findPgServices() {
  if (!IS_WIN) return [];
  try {
    const r = spawnSync('sc', ['query', 'type=', 'service', 'state=', 'all'], { encoding: 'utf-8', timeout: 10000 });
    const names = [...String(r.stdout || '').matchAll(/SERVICE_NAME:\s*(postgresql[^\r\n]*)/gi)].map((m) => m[1].trim());
    // الأحدث أولاً (postgresql-x64-18 قبل 16)
    return names.sort().reverse();
  } catch (_) {
    return [];
  }
}

function serviceState(svc) {
  try {
    const r = spawnSync('sc', ['query', svc], { encoding: 'utf-8', timeout: 8000 });
    const m = String(r.stdout || '').match(/STATE\s*:\s*\d+\s+(\w+)/);
    return m ? m[1] : null;
  } catch (_) {
    return null;
  }
}

function ensureService(svc) {
  if (!svc) return false;
  if (serviceState(svc) === 'RUNNING') return true;
  try {
    const r = spawnSync('sc', ['start', svc], { encoding: 'utf-8', timeout: 30000 });
    const out = String(r.stdout || '') + String(r.stderr || '');
    return r.status === 0 || /START_PENDING|RUNNING/i.test(out);
  } catch (_) {
    return false;
  }
}

// ─── فحص الاتصال ────────────────────────────────────────
function tryAuth(host, port, user, password, bin) {
  const psql = bin || getPgBinary('psql');
  if (!psql) return { ok: false, kind: 'no-binary' };
  try {
    const r = spawnSync(psql, ['-h', host, '-p', String(port), '-U', user, '-d', 'postgres', '-tAc', 'SELECT 1'], {
      encoding: 'utf-8',
      timeout: 6000,
      env: { ...process.env, PGPASSWORD: password || '' },
    });
    if (r.status === 0 && String(r.stdout || '').trim() === '1') return { ok: true, kind: null, bin: psql };
    const s = String(r.stderr || '');
    if (/password authentication failed/i.test(s)) return { ok: false, kind: 'wrong-password', bin: psql };
    if (/role .* does not exist/i.test(s)) return { ok: false, kind: 'wrong-role', bin: psql };
    if (/connection refused|could not connect|timeout expired/i.test(s)) return { ok: false, kind: 'refused', bin: psql };
    if (/database .* does not exist/i.test(s)) return { ok: true, kind: null, bin: psql };
    return { ok: false, kind: 'other', bin: psql, detail: s.split('\n')[0] };
  } catch (_) {
    return { ok: false, kind: 'refused', bin: psql };
  }
}

// ─── الدالة الرئيسية: الحل الذكي الموحد ─────────────────
function resolveDatabase(opts = {}) {
  const host = opts.host || env('DB_HOST', '127.0.0.1');
  const user = opts.user || env('DB_USER', 'postgres');
  const password = opts.password !== undefined ? opts.password : env('DB_PASSWORD', '');
  const dbName = opts.dbName || env('DB_NAME', 'karim_erp');
  const preferred = String(opts.port || env('DB_PORT', '') || env('PG_PORT', '')).trim();

  const candidates = [];
  if (preferred) candidates.push(preferred);
  for (const p of KARIM_PORTS) if (!candidates.includes(p)) candidates.push(p);

  const bins = findAllPgBins('psql');
  const services = findPgServices();

  // محاولة إقلاع أي خدمة متوقفة قبل الفحص (ذكاء حقيقي)
  if (opts.autostart !== false) {
    for (const svc of services) {
      if (serviceState(svc) !== 'RUNNING') {
        try {
          ensureService(svc);
        } catch (_) {}
      }
    }
  }

  let lastKind = 'no-binary';
  for (const port of candidates) {
    for (const bin of bins.length ? bins : [null]) {
      const r = tryAuth(host, port, user, password, bin);
      if (r.ok) {
        return {
          ok: true,
          host,
          port: String(port),
          user,
          dbName,
          bin: r.bin,
          service: services[0] || null,
          version: detectMajor(r.bin),
        };
      }
      lastKind = r.kind;
      // كلمة المرور خاطئة على هذا المنفذ = لا فائدة من تجربة ثنائي آخر لنفس المنفذ
      if (r.kind === 'wrong-password' || r.kind === 'wrong-role') break;
    }
    // لو الرفض من الشبكة جرّب المنفذ التالي فوراً
  }

  return { ok: false, host, user, dbName, port: preferred || '5432', kind: lastKind, bins, services, triedPorts: candidates };
}

function detectMajor(psqlBin) {
  try {
    if (!psqlBin) return null;
    const r = spawnSync(psqlBin, ['--version'], { encoding: 'utf-8', timeout: 5000 });
    const m = String(r.stdout || '').match(/(\d+)\./);
    return m ? parseInt(m[1], 10) : null;
  } catch (_) {
    return null;
  }
}

// رسالة عربية مصنفة حسب نوع الفشل — يفهمها غير المبرمج
function diagnoseArabic(result) {
  switch (result.kind) {
    case 'no-binary':
      return 'لم يتم العثور على PostgreSQL مثبتة. ثبّتها من https://www.postgresql.org/download/windows/ ثم أعد تشغيل SETUP-SMART.bat';
    case 'wrong-password':
      return 'كلمة مرور قاعدة البيانات (DB_PASSWORD في .env) لا تطابق كلمة مرور postgres الحقيقية. ضع الكلمة الصحيحة التي أدخلتها أثناء تثبيت PostgreSQL ثم أعد المحاولة — لا تولّد كلمة عشوائية.';
    case 'wrong-role':
      return `المستخدم "${result.user}" غير موجود في PostgreSQL. أنشئه أو استخدم postgres الافتراضي.`;
    case 'refused':
      return `PostgreSQL لا تستمع على ${result.host} (جرّبنا: ${result.triedPorts.join(', ')}). شغّل الخدمة من services.msc ← postgresql-x64-* ← Start ثم أعد المحاولة.`;
    default:
      return 'تعذر الاتصال بقاعدة البيانات. راجع logs/server.log للتفاصيل.';
  }
}

// كتابة القيم المكتشفة في .env (المنفذ فقط — كلمة المرور لا تُمس أبداً تلقائياً)
function persistPort(port) {
  try {
    if (!fs.existsSync(ENV_FILE)) return false;
    let txt = fs.readFileSync(ENV_FILE, 'utf-8');
    if (new RegExp(`^DB_PORT=${port}$`, 'm').test(txt)) return true;
    if (/^DB_PORT=.*$/m.test(txt)) txt = txt.replace(/^DB_PORT=.*$/m, `DB_PORT=${port}`);
    else txt += `\nDB_PORT=${port}\n`;
    fs.writeFileSync(ENV_FILE, txt, 'utf-8');
    return true;
  } catch (_) {
    return false;
  }
}

module.exports = {
  ROOT,
  ENV_FILE,
  KARIM_PORTS,
  env,
  readEnvFile,
  findAllPgBins,
  getPgBinary,
  findPgServices,
  serviceState,
  ensureService,
  tryAuth,
  resolveDatabase,
  diagnoseArabic,
  persistPort,
  detectMajor,
};
