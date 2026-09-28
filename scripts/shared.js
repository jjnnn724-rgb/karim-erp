/**
 * shared — Shared utilities for Karim ERP
 * مطاعم الشرفة العالمي
 *
 * Single file imported by all scripts in the project.
 * Contains: paths, logger, env helpers, PostgreSQL binary resolution,
 * command execution, and common utilities.
 *
 * Usage:
 *   const { log, ROOT, getEnv, run, getPgBinary } = require('./shared');
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { execSync, spawn, spawnSync } = require('child_process');
const crypto = require('crypto');

// ─── .env ──────────────────────────────────────────
// Load .env if present. Falls back to system env vars.
// dotenv is optional — most production deploys use env vars directly.
try { require('dotenv').config({ path: path.join(__dirname, '..', '.env'), override: false }); }
catch (_) { /* dotenv optional */ }

// ─── Constants ─────────────────────────────────────
// Paths to key directories. These are referenced by
// many scripts so we keep them in one place.

const ROOT = path.resolve(__dirname, '..');
const DB_DIR = path.join(ROOT, 'database');
const DATA_DIR = path.join(DB_DIR, 'data');
const BACKUPS_DIR = path.join(DB_DIR, 'backups');
const MIGRATIONS_DIR = path.join(DB_DIR, 'migrations');
const NODE_MODULES = path.join(ROOT, 'node_modules');
const ENV_FILE = path.join(ROOT, '.env');
const ENV_EXAMPLE = path.join(ROOT, '.env.example');
const MIGRATION_LOCK = path.join(DATA_DIR, '.migrations_applied');

// Platform detection
const IS_WIN = process.platform === 'win32';
const IS_LINUX = process.platform === 'linux';
const IS_MAC = process.platform === 'darwin';
const EXE = IS_WIN ? '.exe' : '';

// Known business constants
// NOTE: These should match what's in the backend/models,
// otherwise you'll get mismatched validation errors.
// Last updated by Karim on 2026-09-19 to align with the
// Saudi tax office requirements.
const MIN_NODE_VERSION = 18;
const MIN_PG_MAJOR = 16;
const DEFAULT_DB_PORT = 5432;
const APP_PORT = 5000;

// ─── Logger ────────────────────────────────────────
// Simple colored logger. Not fancy — just enough to
// read the console output clearly during installs.
//
// Why not winston/bunyan? Because these are shell scripts,
// not servers. Adding a dependency for log formatting
// would bloat the install process.

const C = {
    g: '\x1b[90m', r: '\x1b[31m', gr: '\x1b[32m',
    y: '\x1b[33m', b: '\x1b[36m', bold: '\x1b[1m',
    reset: '\x1b[0m',
};
function ts() { return new Date().toLocaleTimeString('en-US', { hour12: false }); }

const log = {
    info(msg)  { console.log(`${C.g}[${ts()}]${C.reset} ${C.b}INFO${C.reset}  ${msg}`); },
    ok(msg)    { console.log(`${C.g}[${ts()}]${C.reset} ${C.gr}OK${C.reset}    ${C.gr}${msg}${C.reset}`); },
    warn(msg)  { console.log(`${C.g}[${ts()}]${C.reset} ${C.y}WARN${C.reset}  ${C.y}${msg}${C.reset}`); },
    error(msg) { console.log(`${C.g}[${ts()}]${C.reset} ${C.r}ERROR${C.reset} ${C.r}${msg}${C.reset}`); },
    step(msg)  { console.log(`${C.g}[${ts()}]${C.reset} ${C.b}STEP${C.reset}  ${C.bold}${msg}${C.reset}`); },
    header(msg) {
        console.log(`\n${C.b}${C.y}${'='.repeat(60)}`);
        console.log(`  ${msg}`);
        console.log(`${'='.repeat(60)}${C.reset}\n`);
    },
    divider() { console.log('═'.repeat(60)); },
    plain(msg) { console.log(msg); },
};

// ─── Environment helpers ───────────────────────────
function loadEnv() {
    if (!fs.existsSync(ENV_FILE)) {return {};}
    const lines = fs.readFileSync(ENV_FILE, 'utf-8').split('\n');
    const env = {};
    for (const line of lines) {
        const t = line.trim();
        if (!t || t.startsWith('#')) {continue;}
        const idx = t.indexOf('=');
        if (idx === -1) {continue;}
        const k = t.slice(0, idx).trim();
        const v = t.slice(idx + 1).trim().replace(/^["']|["']$/g, '');
        env[k] = v;
    }
    return env;
}

function getEnv(key, fallback = '') {
        // Professional priority: system env first (Docker/Service/Electron injection),
        // then .env file, then fallback. Backward-compat with legacy KARIM_* names.
        if (process.env[key] !== undefined && process.env[key] !== '') {return process.env[key];}
        const envFile = loadEnv();
        if (envFile[key] !== undefined && envFile[key] !== '') {return envFile[key];}
        // Legacy aliases (one release cycle): pre-v5 HORUS_* -> KARIM_*
        const legacyMap = { KARIM_MIGRATION_MODE: 'HORUS_MIGRATION_MODE', KARIM_BACKUP_DIR: 'HORUS_BACKUP_DIR', KARIM_BACKUP_RETENTION: 'HORUS_BACKUP_RETENTION', KARIM_DATA_DIR: 'HORUS_DATA_DIR' };
        if (legacyMap[key]) {
            if (process.env[legacyMap[key]]) {return process.env[legacyMap[key]];}
            if (envFile[legacyMap[key]]) {return envFile[legacyMap[key]];}
        }
        if (key === 'DB_PORT' && process.env.PG_PORT) {return process.env.PG_PORT;}
        if (key === 'DB_PORT' && envFile.PG_PORT) {return envFile.PG_PORT;}
        return fallback;
    }

// ─── PostgreSQL helpers ────────────────────────────
// Finds pg_ctl / psql binaries in system PostgreSQL installations.
// Only checks system PG — the portable mode was removed in v3.0
// because it caused too many issues with data corruption on Windows.

function getPgBinary(name) {
    // Unified smart resolution — delegates to db-resolver (Registry + dirs + PATH).
    try {
        const resolver = require('./db-resolver');
        const found = resolver.getPgBinary(name);
        if (found) {return found;}
    } catch (_) {}
    if (IS_WIN) {
        // Fallback: Check common PostgreSQL install locations, newest first
        try {
            for (const root of ['C:\\Program Files\\PostgreSQL', 'C:\\Program Files (x86)\\PostgreSQL', 'C:\\PostgreSQL']) {
                if (!fs.existsSync(root)) {continue;}
                const versions = fs.readdirSync(root).filter(v => /^\d+/.test(v)).sort((a,b) => parseInt(b,10)-parseInt(a,10));
                for (const ver of versions) {
                    const p = path.join(root, ver, 'bin', name + EXE);
                    if (fs.existsSync(p)) {return p;}
                }
            }
        } catch (_) {}
        // Try system PATH
        try {
            const w = spawnSync('where', [name], { encoding: 'utf-8' });
            if (w.status === 0) {
                const found = w.stdout.trim().split('\n')[0].trim();
                if (found && !found.includes(DB_DIR)) {return found;}
            }
        } catch (_) {}
    } else {
        // Linux/Mac
        try {
            if (fs.existsSync('/usr/lib/postgresql')) {
                for (const v of fs.readdirSync('/usr/lib/postgresql').sort().reverse()) {
                    const p = path.join('/usr/lib/postgresql', v, 'bin', name);
                    if (fs.existsSync(p)) {return p;}
                }
            }
        } catch (_) {}
        try {
            const w = spawnSync('which', [name], { encoding: 'utf-8', timeout: 5000 });
            if (w.status === 0) {
                const found = w.stdout.trim().split('\n')[0].trim();
                if (found && !found.includes(DB_DIR)) {return found;}
            }
        } catch (_) {}
    }
    return null;
}

function isPgInstalled() {
    if (getPgBinary('psql')) {return true;}
    try { if (spawnSync('where', ['psql'], { encoding: 'utf-8' }).status === 0) {return true;} } catch (_) {}
    try { if (spawnSync('which', ['psql'], { encoding: 'utf-8', timeout: 5000 }).status === 0) {return true;} } catch (_) {}
    return false;
}

function isPgRunning(host, port, user, password) {
    const psql = getPgBinary('psql');
    if (!psql) {return false;}
    try {
        const env = { ...process.env, PGPASSWORD: password || '' };
        const r = spawnSync(psql, ['-h', host, '-p', String(port), '-U', user, '-d', 'postgres', '-tAc', 'SELECT 1'],
            { encoding: 'utf-8', timeout: 5000, env });
        return r.status === 0 && (r.stdout || '').trim() === '1';
    } catch (_) { return false; }
}

// ─── Migration guard ───────────────────────────────
// Prevent demo seed data from running in production.
// This is important because the demo seed has test data
// that would corrupt real restaurant records.
const DEMO_MIGRATIONS = new Set(['006_demo_seed.sql']);
function isDemoMigration(f) { return DEMO_MIGRATIONS.has(path.basename(String(f || ''))); }
function isDemoMode() {
    // KARIM_ primary; HORUS_ legacy for old .env files (one release cycle)
    const v = String(getEnv('KARIM_MIGRATION_MODE', '') || process.env.HORUS_MIGRATION_MODE || '');
    if (v) {return v.toLowerCase() === 'demo';}
    return false;
}
function shouldApplyMigration(f) { return isDemoMode() || !isDemoMigration(f); }

// ─── Secret generation ─────────────────────────────
// Generates cryptographically secure random strings for JWT secrets
// and database passwords. Uses Node's crypto module (built-in).
function ensureEnvFile() {
    if (fs.existsSync(ENV_FILE)) {return true;}
    if (!fs.existsSync(ENV_EXAMPLE)) { log.error('.env.example not found — project may be corrupt'); return false; }
    fs.copyFileSync(ENV_EXAMPLE, ENV_FILE);
    log.ok('Created .env from .env.example');
    return true;
}

function genSecret(len = 48) { return crypto.randomBytes(len).toString('hex'); }
// Backward-compat alias: setup.js used lib.generateSecret (bug) — keep working.
function generateSecret(len = 48) { return genSecret(len); }
// Legacy portable path (removed in v3.0) — kept as constant so old
// references like lib.BIN_DIR don't crash with undefined.
const BIN_DIR = path.join(ROOT, 'database', 'bin');

// ─── أسرار حقيقية فقط (عقد أمني): القيم العامة الوهمية تُرفض مهما طال طولها ───
const KNOWN_PLACEHOLDER_SECRETS = [
    'replace-me-with-a-long-random-secret-access-key-32chars-min',
    'replace-me-with-a-long-random-secret-refresh-key-32chars-min',
];
/** سر حقيقي؟ يرفض الناقص/القصير/<32/placeholder معروف/نمط replace-me */
function isRealSecret(value) {
    const v = String(value || '').trim();
    if (v.length < 32) {return false;}
    if (KNOWN_PLACEHOLDER_SECRETS.includes(v)) {return false;}
    if (/replace-me/i.test(v)) {return false;}
    return true;
}

function setupEnvSecrets() {
    if (!ensureEnvFile()) {return false;}
    let txt = fs.readFileSync(ENV_FILE, 'utf-8');
    let changed = false;
    const gen = (len = 48) => crypto.randomBytes(len).toString('hex');
    const fix = (key, cur) => {
        const re = new RegExp(`^${key}=.*$`, 'm');
        if (!isRealSecret(cur) || cur.includes('karim_preview')) {
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
    // PROFESSIONAL RULE: never silently invent a DB_PASSWORD — it will never
    // match the real postgres superuser password and guarantees
    // "password authentication failed" on every fresh machine.
    // If empty, leave it and let smart-install wizard ask the user.
    if (!/^DB_PASSWORD=.*\S/m.test(txt)) {
        log.warn('DB_PASSWORD فارغ — ضع كلمة مرور postgres الحقيقية في .env (لا توليد تلقائي)');
    }
    if (changed) {fs.writeFileSync(ENV_FILE, txt, 'utf-8');}
    try { require('dotenv').config({ path: ENV_FILE, override: false }); } catch (_) {}
    return true;
}

// ─── Command execution ─────────────────────────────
// Synchronous spawn with timeout. Returns { stdout, stderr, status }.
// Throws on non-zero exit (unless allowFailure is true).
function run(cmd, args, opts = {}) {
    const { timeout = 60000, env = process.env, cwd = ROOT, silent = false } = opts;
    if (!silent) {log.info(`$ ${cmd} ${args.join(' ')}`);}
    const result = spawnSync(cmd, args, { encoding: 'utf-8', timeout, env, cwd });
    if (result.error) {throw new Error(`Failed to run ${cmd}: ${result.error.message}`);}
    if (result.status !== 0 && !opts.allowFailure) {
        throw new Error(`${cmd} exited ${result.status}\n${result.stderr || ''}\n${result.stdout || ''}`);
    }
    return { stdout: result.stdout || '', stderr: result.stderr || '', status: result.status };
}

// Async version — wraps spawn() in a Promise for .then() chains.
function runAsync(cmd, args, opts = {}) {
    const { timeout = 60000, env = process.env, cwd = ROOT } = opts;
    return new Promise((resolve, reject) => {
        const proc = spawn(cmd, args, { env, cwd });
        let out = '', err = '';
        proc.stdout.on('data', d => out += d);
        proc.stderr.on('data', d => err += d);
        const timer = setTimeout(() => { proc.kill('SIGTERM'); reject(new Error('timeout: ' + cmd)); }, timeout);
        proc.on('close', code => { clearTimeout(timer); code === 0 ? resolve({ stdout: out, stderr: err, status: code }) : reject(new Error(`${cmd} exited ${code}`)); });
        proc.on('error', err => { clearTimeout(timer); reject(err); });
    });
}

// ─── File helpers ──────────────────────────────────
function ensureDir(dir) {
    if (!fs.existsSync(dir)) {fs.mkdirSync(dir, { recursive: true });}
}
function rmrf(dir) {
    if (fs.existsSync(dir)) {fs.rmSync(dir, { recursive: true, force: true });}
}

// ─── HTTP/HTTPS helper ───────────────────────────────────
// Detects SSL certificates and uses HTTPS automatically
function httpReq(method, path, data, opts = {}) {
    const { host = '127.0.0.1', port = process.env.PORT || 5000, timeout = 10000, useHttps = null } = opts;
    
    // Auto-detect HTTPS: use it if SSL_KEY and SSL_CERT are configured
    const sslKey = process.env.SSL_KEY;
    const sslCert = process.env.SSL_CERT;
    const shouldUseHttps = useHttps === null 
        ? Boolean(sslKey && sslCert) 
        : Boolean(useHttps);
    
    const protocol = shouldUseHttps ? require('https') : require('http');
    
    return new Promise((resolve, reject) => {
        const req = protocol.request({
            hostname: host,
            port: port,
            path: path,
            method: method,
            timeout: timeout,
            rejectUnauthorized: false, // Allow self-signed certs in development
        }, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => resolve({ status: res.statusCode, body, headers: res.headers }));
        });
        req.on('error', (e) => { 
            if (e.code === 'ECONNREFUSED') {
                reject(new Error('Connection refused - server may not be running'));
            } else {
                reject(e);
            }
        });
        req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
        if (data) { req.write(JSON.stringify(data)); }
        req.end();
    });
}

// ─── Port check ────────────────────────────────────
async function isPortInUse(port, host = '127.0.0.1') {
    return new Promise((resolve) => {
        const net = require('net');
        const socket = new net.Socket();
        socket.setTimeout(2000);
        socket.once('connect', () => { socket.destroy(); resolve(true); });
        socket.once('error', () => resolve(false));
        socket.once('timeout', () => { socket.destroy(); resolve(false); });
        socket.connect(port, host);
    });
}

// ─── اكتشاف منفذ PostgreSQL العامل ────────────────────
// يجرب منفذ .env أولًا ثم الشائعة — يرجع أول منفذ يصادق فعليًا أو null.
// هذا ما يجعل Setup يعمل على أي جهاز مهما كان منفذ بوستجريس.
function detectDbPort() {
    // Smart path: unified resolver (Registry + services + autostart + wide ports)
    try {
        const resolver = require('./db-resolver');
        const r = resolver.resolveDatabase({ autostart: true });
        if (r.ok) {return String(r.port);}
    } catch (_) {}
    // Fallback: classic probe over expanded port list
    const host = getEnv('DB_HOST', '127.0.0.1');
    const user = getEnv('DB_USER', 'postgres');
    const password = getEnv('DB_PASSWORD', '');
    const preferred = String(getEnv('DB_PORT', '')).trim();
    const candidates = [];
    if (preferred) {candidates.push(preferred);}
    for (const p of ['5432', '5433', '5434', '5435', '5436', '5444']) {
        if (!candidates.includes(p)) {candidates.push(p);}
    }
    for (const port of candidates) {
        try {
            if (isPgRunning(host, port, user, password)) {return String(port);}
        } catch (_) {}
    }
    return null;
}

// ─── psql helpers ──────────────────────────────────
// psql(): single query returning stdout (db.js imports this — was missing and crashed).
function psql(query, dbName = 'postgres', opts = {}) {
    const psqlBin = getPgBinary('psql');
    if (!psqlBin) {throw new Error('psql not found — ثبّت PostgreSQL أولاً');}
    const host = getEnv('DB_HOST', '127.0.0.1');
    const port = getEnv('DB_PORT', '5432');
    const user = getEnv('DB_USER', 'postgres');
    const password = getEnv('DB_PASSWORD', '');
    const result = spawnSync(psqlBin, ['-h', host, '-p', String(port), '-U', user, '-d', dbName, '-tAc', query],
        { encoding: 'utf-8', timeout: 30000, env: { ...process.env, PGPASSWORD: password } });
    if (result.status !== 0 && !opts.allowFailure) {
        throw new Error(`psql failed: ${(result.stderr || '').split('\n')[0]}`);
    }
    return result.stdout || '';
}

// ─── psql helper ───────────────────────────────────
function psqlFile(sqlFile, dbName) {
    const psql = getPgBinary('psql');
    if (!psql) { throw new Error('psql not found'); }
    const host = getEnv('DB_HOST', '127.0.0.1');
    const port = getEnv('DB_PORT', '5432');
    const user = getEnv('DB_USER', 'postgres');
    const password = getEnv('DB_PASSWORD', '');
    const env = { ...process.env, PGPASSWORD: password };
    const result = spawnSync(psql, ['-h', host, '-p', String(port), '-U', user, '-d', dbName, '-f', sqlFile], { encoding: 'utf-8', timeout: 120000, env });
    return { status: result.status, stdout: result.stdout || '', stderr: result.stderr || '' };
}

// ─── Exports ───────────────────────────────────────
module.exports = {
    ROOT, DB_DIR, DATA_DIR, BACKUPS_DIR, MIGRATIONS_DIR, BIN_DIR,
    NODE_MODULES, ENV_FILE, ENV_EXAMPLE, MIGRATION_LOCK,
    IS_WIN, IS_LINUX, IS_MAC, EXE,
    MIN_NODE_VERSION, MIN_PG_MAJOR, DEFAULT_DB_PORT, APP_PORT,
    log, loadEnv, getEnv,
    getPgBinary, isPgInstalled, isPgRunning,
    isDemoMigration, isDemoMode, shouldApplyMigration,
    ensureEnvFile, genSecret, generateSecret, setupEnvSecrets,
    run, runAsync, ensureDir, rmrf,
    isPortInUse, httpReq, psql, psqlFile, detectDbPort,
    isRealSecret, KNOWN_PLACEHOLDER_SECRETS,
};
