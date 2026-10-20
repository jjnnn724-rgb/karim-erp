#!/usr/bin/env node
/**
 * verify-env — Pre-flight checker for ANY operation
 * ════════════════════════════════════════════
 *
 * 🚀 قبل تشغيل أي شيء (serve/setup/deploy) → شغّل ده أولًا.
 *
 * يعمل قبل npm install — zero dependencies.
 * يفحص:
 *   1. Node.js version (>= 18)
 *   2. وجود ملفات المشروع الأساسية (package.json, backend/server.js, .env.example)
 *   3. .env موجود + مقارنته مع .env.example للتأكد من عدم وجود مفاتيح مفقودة
 *   4. صحة المسارات المطلقة داخل .env + إصلاحها تلقائيًا (--fix)
 *   5. مساحة القرص الحر (warn < 500MB)
 *   6. البورتات المطلوبة (PORT, DB_PORT)
 *   7. اتصال PostgreSQL (لو .env متكامل)
 *   8. node_modules و core deps موجودة (express/pg/dotenv/socket.io/zod/bullmq)
 *   9. صحة سكربتات package.json
 *
 * Usage:
 *   node scripts/verify-env.js                 # فحص فقط
 *   node scripts/verify-env.js --fix           # إصلاح تلقائي للمسارات + المجلدات
 *   node scripts/verify-env.js --json          # خروج بصيغة JSON
 */

'use strict';

const path = require('node:path');
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');

const SCRIPT_DIR = __dirname;
const ROOT = path.resolve(SCRIPT_DIR, '..');
const PATHS = {
    ROOT,
    ENV_FILE: path.join(ROOT, '.env'),
    ENV_EXAMPLE: path.join(ROOT, '.env.example'),
    PACKAGE_JSON: path.join(ROOT, 'package.json'),
    SERVER_JS: path.join(ROOT, 'backend', 'server.js'),
    BACKUPS_DIR: path.join(ROOT, 'database', 'backups'),
    LOGS_DIR: path.join(ROOT, 'logs'),
    NODE_MODULES: path.join(ROOT, 'node_modules'),
};

const IS_WIN = process.platform === 'win32';

// ─── Tiny colored logger (zero dep) ──────────
const RESET = '\x1b[0m';
const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const BOLD = '\x1b[1m';
function ts() { return new Date().toLocaleTimeString('en-US', { hour12: false }); }
function logOk(m) { process.stdout.write(`${GREEN}[${ts()}]${RESET}  ${GREEN}OK${RESET}    ${m}\n`); }
function logWarn(m) { process.stdout.write(`${YELLOW}[${ts()}]${RESET}  ${YELLOW}WARN${RESET}  ${m}\n`); }
function logErr(m) { process.stderr.write(`${RED}[${ts()}]${RESET} ${RED}ERR${RESET}   ${m}\n`); }
function logStep(m) { process.stdout.write(`${CYAN}[${ts()}]${RESET}  ${BOLD}STEP${RESET}  ${m}\n`); }
function logInfo(m) { process.stdout.write(`         ${m}\n`); }
function logHeader(m) {
    const bar = '═'.repeat(62);
    process.stdout.write(`\n${BOLD}${YELLOW}${bar}\n  ${m}\n${bar}${RESET}\n\n`);
}

const JSON_OUT = process.argv.includes('--json');
const FIX = process.argv.includes('--fix');
const REPORT = { checks: [], warnings: [], errors: [], fixed: [] };

function add(kind, id, message, extra = null, didFix = false) {
    const ok = kind !== 'error';
    REPORT.checks.push({ id, kind, message, extra, ok });
    if (kind === 'ok') {logOk(message);}
    if (kind === 'warn') {
        REPORT.warnings.push({ id, message, extra });
        if (didFix) { REPORT.fixed.push({ id, message, extra }); logWarn(`[FIXED] ${message}`); }
        else {logWarn(message);}
    }
    if (kind === 'error') { logErr(message); REPORT.errors.push({ id, message, extra }); }
}

function loadEnvFile(filePath) {
    const env = {};
    if (!fs.existsSync(filePath)) {return env;}
    const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
    for (const line of lines) {
        const t = line.trim();
        if (!t || t.startsWith('#') || !t.includes('=')) {continue;}
        const idx = t.indexOf('=');
        const k = t.slice(0, idx).trim();
        let v = t.slice(idx + 1).trim();
        if (v.startsWith('"') && v.endsWith('"')) {v = v.slice(1, -1);}
        if (v.startsWith("'") && v.endsWith("'")) {v = v.slice(1, -1);}
        env[k] = v;
    }
    return env;
}

function saveEnv(envObj, basePath) {
    const existing = fs.existsSync(basePath) ? loadEnvFile(basePath) : {};
    const merged = Object.assign({}, existing, envObj);
    const lines = [];
    for (const [k, v] of Object.entries(merged)) {lines.push(`${k}=${v}`);}
    fs.writeFileSync(basePath, lines.join('\n') + '\n', 'utf8');
}

function hasEnoughDiskSpace(atPath, minMB = 500) {
    try {
        if (typeof fs.statfsSync === 'function') {
            const st = fs.statfsSync(atPath);
            const freeBytes = Number(st.bavail) * Number(st.bsize);
            return { ok: freeBytes >= minMB * 1024 * 1024, freeMB: Math.floor(freeBytes / 1048576) };
        }
        return { ok: true, freeMB: null };
    } catch { return { ok: true, freeMB: null }; }
}

function portFree(port, host = '127.0.0.1') {
    const net = require('node:net');
    return new Promise((resolve) => {
        const s = new net.Socket();
        s.setTimeout(1500);
        s.once('connect', () => { s.destroy(); resolve(false); });
        s.once('error', () => resolve(true));
        s.once('timeout', () => { s.destroy(); resolve(true); });
        s.connect(Number(port), host);
    });
}

function checkPgConnection({ host, port, user, password, dbName }) {
    let psql;
    try { const r = require(path.join(SCRIPT_DIR, 'db-resolver')); psql = r.getPgBinary('psql'); }
    catch { psql = IS_WIN ? 'psql.exe' : 'psql'; }
    if (!psql) {psql = IS_WIN ? 'psql.exe' : 'psql';}
    try {
        const r = spawnSync(psql, [
            '-h', host, '-p', String(port), '-U', user, '-d', dbName || 'postgres',
            '-tAc', 'SELECT 1;'
        ], { encoding: 'utf8', timeout: 8000, env: Object.assign({}, process.env, { PGPASSWORD: password || '' }) });
        return { ok: r.status === 0, details: (r.stderr || r.stdout || '').split('\n')[0] };
    } catch (e) { return { ok: false, details: e.message }; }
}

(async function main() {
    if (!JSON_OUT) {logHeader('Karim ERP — Environment Pre-Flight Checker v1.0');}

    // 1) Node version
    logStep('1/9 — Node.js version');
    const nodeMaj = parseInt(process.versions.node.split('.')[0], 10);
    if (nodeMaj < 20) { add('error', 'E_NODE', `Node.js ${process.versions.node} — الحد الأدنى 20+ (ضع الإصدار من https://nodejs.org/)`); process.exit(1); }
    add('ok', 'E_NODE', `Node.js ${process.versions.node}`);

    // 2) Project files
    logStep('2/9 — ملفات المشروع الأساسية');
    const critical = [
        ['PACKAGE_JSON', PATHS.PACKAGE_JSON],
        ['SERVER_JS', PATHS.SERVER_JS],
        ['ENV_EXAMPLE', PATHS.ENV_EXAMPLE],
    ];
    for (const [id, p] of critical) {
        if (fs.existsSync(p)) {add('ok', id, `موجود: ${path.relative(ROOT, p)}`);}
        else {add('error', id, `الملف الأساسي مفقود: ${p}`);}
    }

    // 3) .env exists and compare to .env.example
    logStep('3/9 — ملف البيئة .env والمفاتيح المفقودة');
    const example = loadEnvFile(PATHS.ENV_EXAMPLE);
    const hasEnv = fs.existsSync(PATHS.ENV_FILE);
    let env;
    if (!hasEnv) {
        if (FIX) {
            fs.copyFileSync(PATHS.ENV_EXAMPLE, PATHS.ENV_FILE);
            add('warn', 'E_ENV', 'تم إنشاء .env من .env.example', null, true);
            env = loadEnvFile(PATHS.ENV_FILE);
        } else {
            add('error', 'E_ENV', 'ملف .env مفقود. شغّل: node scripts/verify-env.js --fix');
            env = {};
        }
    } else {
        env = loadEnvFile(PATHS.ENV_FILE);
        add('ok', 'E_ENV', 'ملف .env موجود');
    }

    const exampleKeys = Object.keys(example).filter(k => !k.startsWith('_'));
    const missingKeys = exampleKeys.filter(k => !(k in env));
    if (missingKeys.length) {
        const msg = `المفاتيح التالية في .env.example ومفقودة من .env: ${missingKeys.join(', ')}`;
        if (FIX) {
            for (const k of missingKeys) {env[k] = example[k];}
            saveEnv(env, PATHS.ENV_FILE);
            add('warn', 'E_ENV_MISSING', msg, missingKeys, true);
        } else {add('warn', 'E_ENV_MISSING', msg, missingKeys);}
    } else {add('ok', 'E_ENV_KEYS', 'كل مفاتيح .env.example موجودة');}

    // 4) Absolute path sanity in .env
    logStep('4/9 — صحة المسارات المطلقة داخل .env');
    const PATH_KEYS = [
        ['SSL_KEY', 'ssl', 'ssl-key.pem'],
        ['SSL_CERT', 'ssl', 'ssl-cert.pem'],
        ['WHATSAPP_SESSION_DIR', 'whatsapp', 'sessions'],
        ['WHATSAPP_LOG_DIR', 'whatsapp', 'logs'],
        ['YARASOFT_SHARE', 'yarasoft', 'share'],
        ['YARASOFT_ORACLE_STAGING', 'yarasoft', 'staging'],
        ['BACKUPS_DIR', 'backups', 'database'],
    ];
    let envChanged = false;
    for (const [key, cat, defaultName] of PATH_KEYS) {
        const raw = env[key];
        if (!raw) {continue;}
        let resolved;
        if (path.isAbsolute(raw)) {
            if (fs.existsSync(raw)) { resolved = raw; }
            else {
                const base = raw.split(/[\\/]/).filter(Boolean).pop() || defaultName;
                const localGuess = path.resolve(ROOT, cat, base);
                if (fs.existsSync(localGuess)) {resolved = localGuess;}
                else {
                    const programData = process.env.PROGRAMDATA || 'C:\\ProgramData';
                    const shared = path.join(programData, 'KarimERP', cat);
                    if (FIX) {
                        try { fs.mkdirSync(key.includes('SSL') ? path.dirname(shared) : shared, { recursive: true }); } catch {}
                        envChanged = true;
                        resolved = shared;
                    } else {resolved = raw;}
                }
            }
        } else { resolved = path.resolve(ROOT, raw); }
        if (FIX && env[key] !== resolved) { env[key] = resolved; envChanged = true; }
        if (!fs.existsSync(resolved)) {
            const msg = `مسار ${key} يشير إلى مكان غير موجود على هذا الجهاز: ${raw} → المقترح: ${resolved}`;
            if (FIX) {add('warn', 'E_PATH_' + key, msg, { old: raw, new: resolved }, true);}
            else {add('warn', 'E_PATH_' + key, msg);}
        } else {add('ok', 'E_PATH_' + key, `${key} صالح → ${resolved}`);}
    }
    for (const d of [PATHS.LOGS_DIR, PATHS.BACKUPS_DIR]) {
        try {
            if (!fs.existsSync(d)) {
                if (FIX) { fs.mkdirSync(d, { recursive: true }); add('ok', 'DIR_' + path.basename(d), `أنشئ المجلد: ${path.relative(ROOT, d)}`, null, true); }
                else {add('warn', 'DIR_' + path.basename(d), `المجلد مفقود: ${path.relative(ROOT, d)}`);}
            }
        } catch (_) {}
    }
    if (envChanged && FIX) { saveEnv(env, PATHS.ENV_FILE); add('ok', 'ENV_SAVED', 'تم تحديث .env بالمسارات المصححة'); }

    // 5) Disk space
    logStep('5/9 — مساحة القرص الصلب');
    const disk = hasEnoughDiskSpace(ROOT, 500);
    if (disk.ok) {add('ok', 'E_DISK', disk.freeMB !== null ? `مساحة متاحة: ${disk.freeMB} MB` : 'مساحة كافية (افتراض');}
    else {add('warn', 'E_DISK', `مساحة منخفضة: ${disk.freeMB}MB — الحد الأدنى 500MB — قد يتوقف قاعدة البيانات`);}

    // 6) Port availability
    logStep('6/9 — منافذ التشغيل');
    const httpPort = parseInt(env.PORT || process.env.PORT || 5000, 10);
    const dbPort = parseInt(env.DB_PORT || process.env.DB_PORT || 5432, 10);
    const httpFree = await portFree(httpPort);
    if (httpFree) {add('ok', 'E_PORT_HTTP', `المنفذ HTTP ${httpPort} حر`);}
    else {add('warn', 'E_PORT_HTTP', `المنفذ HTTP ${httpPort} مستخدم — غير PORT في .env أو أوقف العملية المشغلة`);}
    const dbFree = await portFree(dbPort);
    if (dbFree) {add('warn', 'E_PORT_DB', `المنفذ DB ${dbPort} حر — تأكد من تشغيل PostgreSQL قبل بدء الخادم`);}
    else {add('ok', 'E_PORT_DB', `المنفذ DB ${dbPort} مستخدم (غالبًا PostgreSQL شغالة)`);}

    // 7) PostgreSQL connection
    logStep('7/9 — اتصال قاعدة البيانات');
    if (env.DB_PASSWORD && env.DB_USER && !dbFree) {
        const pg = checkPgConnection({
            host: env.DB_HOST || 'localhost', port: dbPort,
            user: env.DB_USER || 'postgres', password: env.DB_PASSWORD, dbName: env.DB_NAME,
        });
        if (pg.ok) {add('ok', 'E_DB_CONN', `متصل بقاعدة البيانات بنجاح`);}
        else {add('warn', 'E_DB_CONN', `تعذر الاتصال بقاعدة البيانات: ${pg.details}`);}
    } else {add('warn', 'E_DB_CONN', `تخطي فحص قاعدة البيانات (بيانات الاعتماد ناقصة أو المنفذ غير مستخدم)`);}

    // 8) node_modules sanity
    logStep('8/9 — الاعتماديات (node_modules)');
    if (fs.existsSync(PATHS.NODE_MODULES)) {
        const required = ['express', 'pg', 'dotenv', 'socket.io', 'zod', 'bullmq'];
        const missing = required.filter(p => !fs.existsSync(path.join(PATHS.NODE_MODULES, p)));
        if (!missing.length) {add('ok', 'E_MODULES', `الاعتماديات الأساسية ${required.length}/${required.length} موجودة`);}
        else {add('warn', 'E_MODULES', `المفقودة: ${missing.join(', ')} — شغّل: npm install`);}
    } else {add('warn', 'E_MODULES', `node_modules غير موجود — شغّل: npm install`);}

    // 9) Package scripts
    logStep('9/9 — صحة سكربتات package.json');
    try {
        const pkg = JSON.parse(fs.readFileSync(PATHS.PACKAGE_JSON, 'utf8'));
        const scripts = Object.keys(pkg.scripts || {});
        const need = ['start', 'test', 'smoke', 'setup', 'doctor', 'migrate', 'backup'];
        const miss = need.filter(s => !scripts.includes(s));
        if (!miss.length) {add('ok', 'E_PKG', `كل السكربتات المطلوبة موجودة في package.json`);}
        else {add('warn', 'E_PKG', `السكربتات الناقصة من package.json: ${miss.join(', ')}`);}
    } catch (e) { add('error', 'E_PKG', `package.json تالف: ${e.message}`); }

    // Final summary
    const sumOk = REPORT.checks.filter(c => c.ok).length;
    const sumWarn = REPORT.warnings.length;
    const sumErr = REPORT.errors.length;
    if (!JSON_OUT) {
        logHeader('النتيجة النهائية');
        logInfo(`✅ ناجح:     ${sumOk}`);
        logInfo(`⚠️  تحذيرات:  ${sumWarn}`);
        logInfo(`❌ أخطاء:    ${sumErr}`);
        logInfo('');
        if (!FIX && sumWarn > 0) {logInfo('💡 لإصلاح المسارات والمجلدات تلقائياً:  node scripts/verify-env.js --fix');}
        if (sumErr > 0) {logInfo('❌ قم بإزالة الأخطاء أولاً ثم أعد التشغيل');}
        logInfo('');
    } else {
        process.stdout.write(JSON.stringify({ ok: sumErr === 0, summary: { ok: sumOk, warn: sumWarn, error: sumErr }, ...REPORT }, null, 2) + '\n');
    }
    process.exit(sumErr === 0 ? 0 : 2);
})().catch(e => { console.error(e.stack || e); process.exit(1); });
