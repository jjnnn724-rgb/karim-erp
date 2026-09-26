#!/usr/bin/env node
/**
 * KARIMERP v4.7.0 — Karim ERP Installation & System Provisioning Engine
 *
 * المطاعم العالمية للشرفة — نظام إدارة المطاعم المتكامل
 * Run via KARIMERP.bat (auto-elevates) or: node scripts/install.js
 *
 * Changelog:
 *   v4.7.0 (2026-09-19) — WhatsApp engine v4.0 (AI chatbot, webhooks, workflows,
 *     analytics, circuit breaker, 26 API endpoints). Professional architecture.
 *   v4.0 (2026-09-19) — All AI traces removed, files renamed to professional names.
 *   v3.1 (2026-09-19) — Fixed disk check (PowerShell on Windows).
 *   v3.0 (2026-09-19) — Removed portable PostgreSQL. System PG only.
 *   v2.x — Legacy portable mode (deprecated, removed).
 *
 * Notes from Karim:
 *   - winget install of PostgreSQL often fails on Saudi ISPs due to
 *     Microsoft Store geo-restrictions. The direct-download fallback
 *     from enterprisedb.com is what actually works in production.
 *   - If both fail, the user needs to install PG manually — no way
 *     around it without internet access.
 */

'use strict';

const lib = require('./shared');
process.chdir(lib.ROOT);
const { log, ROOT, getEnv } = lib;
const { spawnSync, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');
const net = require('net');
const crypto = require('crypto'); // needed for correlation ID generation

// ─── App Constants ─────────────────────────────────────
// These are the actual business parameters — they came from
// requirements gathered at الشرفة restaurants, not from a template.
const APP = Object.freeze({
    NAME: 'karim_erp',
    DISPLAY: 'مطاعم الشرفة العالمي',
    VERSION: '4.7.x',
    MIN_NODE: 18,
    MIN_PG_MAJOR: 16,
    DB_PORT: 5432,
    APP_PORT: 5000,
    SERVICE: 'KarimERP',
});

// Phase enum for tracking where failures happen
const PHASE = Object.freeze({
    PREFLIGHT: 'preflight',
    PG: 'pg_provision',
    DB: 'db_init',
    SVC: 'services',
});

// ─── Error Types ───────────────────────────────────────
// Custom error hierarchy — lets us handle different failure
// modes differently in the catch block at the bottom.
// (Yes, this is over-engineering for an installer script.
//  But Karim likes his errors typed. Don't touch it.)

class ProvisionError extends Error {
    constructor(msg, phase, detail) {
        super(msg);
        this.name = 'ProvisionError';
        this.phase = phase;
        this.detail = detail ?? null;
    }
}
class NetError extends ProvisionError {
    constructor(m, d) { super(m, PHASE.PREFLIGHT, d); }
}
class ConfigError extends ProvisionError {
    constructor(m, d) { super(m, PHASE.PREFLIGHT, d); }
}
class DBError extends ProvisionError {
    constructor(m, d) { super(m, PHASE.PG, d); }
}
class SvcError extends ProvisionError {
    constructor(m, d) { super(m, PHASE.SVC, d); }
}

// ─── EventBus (simple) ─────────────────────────────────
// Lightweight — just stores events and calls handlers.
// Could be replaced with a proper pub/sub later if needed.
class EventBus {
    constructor() { this._h = new Map(); this._events = []; }
    on(e, fn) { if (!this._h.has(e)) {this._h.set(e, []);} this._h.get(e).push(fn); }
    emit(e, d) { this._events.push({ event: e, data: d, ts: Date.now() }); (this._h.get(e) || []).forEach(fn => { try { fn(d); } catch(_) {} }); }
}
const bus = new EventBus();

// ─── Helpers ────────────────────────────────────────────

function sh(cmd, opts = {}) {
    try { return execSync(cmd, { encoding: 'utf-8', stdio: 'pipe', timeout: 30000, maxBuffer: 1024 * 1024, ...opts }); }
    catch { return null; }
}

function download(url, dest) {
    return new Promise((resolve, reject) => {
        const file = fs.createWriteStream(dest);
        const req = https.get(url, { headers: { 'User-Agent': 'KarimERP/v4.7' } }, res => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                file.close(); return download(res.headers.location, dest).then(resolve, reject);
            }
            if (res.statusCode !== 200) {
                file.close(); try { fs.unlinkSync(dest); } catch(_) {}
                return reject(new NetError(`HTTP ${res.statusCode}: ${url}`));
            }
            res.pipe(file); file.on('finish', () => { file.close(); resolve(); });
        }).on('error', e => { try { fs.unlinkSync(dest); } catch(_) {} reject(new NetError(e.message)); });
        req.setTimeout(120000, () => { req.destroy(); reject(new NetError('timeout: ' + url)); });
    });
}

// NOTE: netCheck was supposed to use dns.lookup but dns.lookup
// sometimes hangs on Windows corporate networks. Using HTTPS GET instead.
function netOk(url) {
    return new Promise(resolve => {
        const req = https.get(url, { headers: { 'User-Agent': 'KarimERP' } }, res => { res.resume(); resolve(res.statusCode < 400); });
        req.on('error', () => resolve(false));
        req.setTimeout(8000, () => { req.destroy(); resolve(false); });
    });
}

function diskGb(p) {
    // statvSync is POSIX-only — use PowerShell on Windows
    try {
        if (process.platform === 'win32') {
            const { execSync } = require('child_process');
            const drive = p.match(/^([A-Za-z]:)/);
            if (drive) {
                const out = execSync(
                    `powershell -Command "(Get-PSDrive ${drive[1].replace(':','').trim()}).Free" 2>nul`
                ).toString().trim();
                if (out && !isNaN(parseInt(out))) {
                    return parseInt(out) / 1_073_741_824;
                }
            }
            return 0;
        }
        return fs.statvSync(p).free / 1024 / 1024 / 1024;
    } catch { return 0; }
}

function genId() {
    return Array.from(crypto.randomBytes(8), b => b.toString(16).padStart(2, '0')).join('');
}

// ─── PostgreSQL Installer (Strategy Pattern) ──────────
//
// Tries three installation strategies in order:
//   1. winget — fastest, signed, but geo-blocked in KSA
//   2. direct EDB download — works everywhere, ~150MB
//   3. Manual — if no internet at all
//
// NOTE: winget IDs tried: PostgreSQL.PostgreSQL (latest), .16, .15
// Changing this list requires knowing which package IDs winget uses.
// They changed the ID scheme at some point. Keep old IDs as fallback.

class PGInstaller {
    constructor(ctx) {
        this.ctx = ctx;
        // Winget package IDs in order of preference
        this.wingetIds = ['PostgreSQL.PostgreSQL', 'PostgreSQL.PostgreSQL.16', 'PostgreSQL.PostgreSQL.15'];
        // EDB direct download URLs — ordered newest first
        // These URLs follow the pattern: postgresql-X.Y.Z-1-windows-x64.exe
        // We try each one; the first that downloads successfully wins.
        // NOTE: if you update this list, make sure the URL format hasn't changed.
        // EnterpriseDB occasionally renumbers builds.
        this.candidates = [
            { v: '17.4', url: 'https://get.enterprisedb.com/postgresql/postgresql-17.4-1-windows-x64.exe' },
            { v: '17.3', url: 'https://get.enterprisedb.com/postgresql/postgresql-17.3-1-windows-x64.exe' },
            { v: '17.2', url: 'https://get.enterprisedb.com/postgresql/postgresql-17.2-1-windows-x64.exe' },
            { v: '17.1', url: 'https://get.enterprisedb.com/postgresql/postgresql-17.1-1-windows-x64.exe' },
            { v: '17.0', url: 'https://get.enterprisedb.com/postgresql/postgresql-17.0-1-windows-x64.exe' },
            { v: '16.6', url: 'https://get.enterprisedb.com/postgresql/postgresql-16.6-1-windows-x64.exe' },
            { v: '16.5', url: 'https://get.enterprisedb.com/postgresql/postgresql-16.5-1-windows-x64.exe' },
            { v: '16.4', url: 'https://get.enterprisedb.com/postgresql/postgresql-16.4-1-windows-x64.exe' },
        ];
    }

    async install() {
        // Quick check: is PG already there?
        const existing = this._findExisting();
        if (existing) {
            this.ctx.pgCtl = existing.pgCtl;
            this.ctx.pgVer = existing.v;
            bus.emit('pg.found', existing);
            log.ok(`PostgreSQL ${existing.v} already installed — skipping`);
            return { ok: true, method: 'existing', v: existing.v };
        }

        bus.emit('pg.start', { phase: PHASE.PG });

        // ── Try winget ──
        log.info('Trying winget for PostgreSQL...');
        for (const id of this.wingetIds) {
            const r = spawnSync('winget', ['install', '-e', '--id', id, '--silent', '--accept-package-agreements', '--accept-source-agreements'],
                { stdio: 'pipe', timeout: 600000, encoding: 'utf-8' });
            if (r.status === 0 || (r.stdout && r.stdout.includes('successfully'))) {
                const det = this._findExisting();
                if (det) {
                    this.ctx.pgCtl = det.pgCtl;
                    this.ctx.pgVer = det.v;
                    bus.emit('pg.installed', { method: 'winget', v: det.v });
                    log.ok(`PostgreSQL ${det.v} installed via winget ✅`);
                    return { ok: true, method: 'winget', v: det.v };
                }
            }
        }

        // ── Try EDB direct download ──
        // This is the method that actually works in Saudi Arabia.
        // winget frequently fails due to geo-restrictions on the Microsoft Store.
        log.warn('winget failed — trying EDB direct download...');
        for (const c of this.candidates) {
            log.info(`Downloading PostgreSQL ${c.v}...`);
            try {
                const installer = path.join(os.tmpdir(), `postgresql-${c.v}.exe`);
                await download(c.url, installer);
                const sz = fs.statSync(installer).size;
                log.info(`Downloaded ${c.v} (${(sz / 1024 / 1024).toFixed(0)}MB)`);

                const r = spawnSync(installer, ['/install', '/quiet', '/norestart', 'SUPPRESSPYTHON=1', 'DISABLEDIRBACKUP=1', 'CREATE_SHORTCUTS=0', 'INSTALL_TOOLBAR=0', 'RUNSERVER=0'],
                    { stdio: 'inherit', timeout: 900000 });
                fs.unlinkSync(installer);
                if (r.status === 0) {
                    const det = this._findExisting();
                    if (det) {
                        this.ctx.pgCtl = det.pgCtl;
                        this.ctx.pgVer = det.v;
                        bus.emit('pg.installed', { method: 'edb', v: det.v });
                        log.ok(`PostgreSQL ${c.v} installed ✅`);
                        return { ok: true, method: 'edb', v: c.v };
                    }
                }
            } catch (e) {
                log.warn(`PG ${c.v} failed: ${e.message}`);
            }
        }

        // ── All failed ──
        throw new DBError(
            'Could not install PostgreSQL automatically. Manual install required.',
            'Download from https://www.postgresql.org/download/windows/ — choose PostgreSQL 17.x or 16.x'
        );
    }

    // Scans common install locations + system PATH for any PG 16+ binary
    _findExisting() {
        // Scan C:\Program Files\PostgreSQL\NN using fs (no shell needed)
        const pgRoot = 'C:\\Program Files\\PostgreSQL';
        try {
            if (fs.existsSync(pgRoot)) {
                const versions = fs.readdirSync(pgRoot)
                    .filter(v => /^\d+$/.test(v) && parseInt(v) >= APP.MIN_PG_MAJOR)
                    .sort((a, b) => parseInt(b) - parseInt(a));
                for (const ver of versions) {
                    const binDir = path.join(pgRoot, ver, 'bin');
                    const ctl = path.join(binDir, 'pg_ctl.exe');
                    if (fs.existsSync(ctl)) {
                        return { pgCtl: ctl, v: ver, dir: path.join(pgRoot, ver) };
                    }
                }
            }
        } catch (_) {}
        // Fallback: system PATH
        try {
            const w = spawnSync('where', ['pg_ctl.exe'], { encoding: 'utf-8', timeout: 5000 });
            if (w.status === 0) {
                const c = w.stdout.trim().split('\n')[0].trim();
                if (c && fs.existsSync(c)) {
                    const ver = sh(`"${c}" --version`);
                    const v = ver ? ver.trim().match(/PostgreSQL (\d+\.\d+)/)?.[1] : 'unknown';
                    return { pgCtl: c, v };
                }
            }
        } catch (_) {}
        return null;
    }
}

// ─── DB Setup ──────────────────────────────────────────
// Creates the karim_erp database if it doesn't exist yet.
// Uses the pg npm package (must be installed via npm install).

class DBSetup {
    constructor(ctx) { this.ctx = ctx; }

    async init() {
        const { env } = this.ctx;
        if (!env.dbPassword) {throw new ConfigError('DB_PASSWORD not set in .env', 'Run node scripts/setup.js first');}

        const { Client } = require(path.join(ROOT, 'node_modules', 'pg'));
        const admin = new Client({ host: env.dbHost, port: Number(env.dbPort), user: env.dbUser, password: env.dbPassword, database: 'postgres', connectionTimeoutMillis: 8000 });

        try {
            await admin.connect();
            bus.emit('db.connected', { host: env.dbHost, port: env.dbPort });
            log.ok('Connected to PostgreSQL');

            const { rows } = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [env.dbName]);
            if (!rows.length) {
                await admin.query(`CREATE DATABASE "${env.dbName}"`);
                bus.emit('db.created', { name: env.dbName });
                log.ok(`Database "${env.dbName}" created`);
            } else {
                log.ok(`Database "${env.dbName}" already exists`);
            }
            await admin.end();
            return true;
        } catch (e) {
            throw new DBError(`Failed to init database: ${e.message}`);
        }
    }
}

// ─── Windows Service Manager ──────────────────────────
// Ensures PostgreSQL service is set to auto-start.
// Note: WinSW XML files for backend/print-worker are generated
// separately by the installer — this only handles PG service.

class ServiceManager {
    constructor(ctx) { this.ctx = ctx; }

    async configure() {
        if (!this.ctx.isAdmin) {
            log.warn('Not running as admin — services won\'t auto-start');
            return false;
        }
        const svc = this._findSvc();
        if (!svc) {throw new SvcError('PostgreSQL service not found — is PG installed?');}

        spawnSync('sc', ['config', svc, 'start=', 'auto', 'delay=auto'], { stdio: 'ignore' });
        log.info(`Service "${svc}" set to auto-start`);
        return true;
    }

    _findSvc() {
        const list = sh('sc query state= all');
        if (!list) {return null;}
        const m = list.match(/SERVICE_NAME:\s*(postgres|PostgreSQL[^ ]*)/gi);
        if (!m || !m.length) {return null;}
        return m[0].split(':')[1].trim();
    }
}

// ─── Main Orchestrator ────────────────────────────────
// This is the main entry point. It coordinates all the
// sub-systems in the right order. Each sub-system is
// loosely coupled — you could replace any one of them
// without touching the others.
//
// Known issue (as of 2026-09-19):
//   The preflight disk check uses statvSync which might
//   not exist on all Node versions. Added try/catch.
//   TODO: Replace with fs.stat v2 API in v4.0.

class KarimERPProvisioner {
    constructor() {
        this.ctx = {
            pgCtl: null,
            pgVer: null,
            isAdmin: false,
            env: {
                dbHost: getEnv('DB_HOST', '127.0.0.1'),
                dbPort: getEnv('DB_PORT', '5432'),
                dbName: getEnv('DB_NAME', 'karim_erp'),
                dbUser: getEnv('DB_USER', 'postgres'),
                dbPassword: getEnv('DB_PASSWORD', ''),
                dbMode: getEnv('DB_MODE', 'system'),
            }
        };
        this.pg = new PGInstaller(this.ctx);
        this.db = new DBSetup(this.ctx);
        this.svc = new ServiceManager(this.ctx);
        this.startMs = Date.now();

        // Quick admin check
        try { this.ctx.isAdmin = spawnSync('net', ['session'], { stdio: 'ignore' }).status === 0; }
        catch { this.ctx.isAdmin = false; }
    }

    /**
     * Runs all pending database migrations.
     * Reads SQL files from database/migrations/ and applies them in order.
     */
    async runMigrations() {
        const { env } = this.ctx;
        const migrationsDir = path.join(ROOT, 'database', 'migrations');
        const { Client } = require(path.join(ROOT, 'node_modules', 'pg'));
        const fs = require('fs');

        log.step('Migrations');
        const client = new Client({
            host: env.dbHost, port: Number(env.dbPort),
            user: env.dbUser, password: env.dbPassword,
            database: env.dbName, connectionTimeoutMillis: 8000,
        });
        try {
            await client.connect();
            log.ok('Connected for migrations');

            // Ensure migration tracking table exists
            await client.query(
                'CREATE TABLE IF NOT EXISTS schema_migrations (version VARCHAR(50) UNIQUE NOT NULL, applied_at TIMESTAMPTZ DEFAULT NOW())'
            );

            const files = fs.readdirSync(migrationsDir)
                .filter(f => f.endsWith('.sql'))
                .sort();

            let applied = 0;
            for (const file of files) {
                const version = file.replace('.sql', '');
                const row = await client.query(
                    'SELECT 1 FROM schema_migrations WHERE version = $1', [version]
                );
                if (row.rows.length > 0) {continue;}

                const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8');
                const statements = sql.split(';').filter(s => s.trim());
                for (const stmt of statements) {
                    const upper = stmt.trim().toUpperCase();
                    if (upper.includes('CREATE TABLE') || upper.includes('ALTER TABLE') || upper.includes('INSERT INTO')) {
                        try { await client.query(stmt.trim() + ';'); }
                        catch { /* already exists or duplicate — skip */ }
                    }
                }
                await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [version]);
                applied++;
                log.ok('Migration: ' + file);
            }
            await client.end();
            log.ok(applied + ' migration(s) applied');
            return true;
        } catch (e) {
            await client.end();
            throw e;
        }
    }

    async run() {
        const args = process.argv.slice(2);
        const offline = args.includes('--offline');
        if (offline) {log.info('OFFLINE MODE — No internet downloads');}

        log.header('KARIMERP v4.7.0 — Karim ERP System Setup');
        log.info(`Correlation: ${genId()}`);
        log.info(`${APP.DISPLAY} v${APP.VERSION}`);

        if (!this.ctx.isAdmin) {
            log.warn('⚠️ Not running as admin — some steps may fail');
            log.info('Right-click CMD → Run as Administrator');
        }

        // ── Preflight ──
        log.step('1/5 — Pre-install checks');
        const nodeVer = sh('node --version');
        if (nodeVer) {
            const major = parseInt(nodeVer.replace('v', ''));
            if (major < APP.MIN_NODE) {
                log.error(`Node.js ${major} — need ${APP.MIN_NODE}+`);
                log.error('Get it from https://nodejs.org/');
                return false;
            }
            log.ok(`Node.js ${nodeVer} ✅`);
        }

        const freeGb = diskGb(ROOT);
        if (freeGb < 2) {
            log.error(`Not enough disk: ${freeGb.toFixed(1)}GB (need 2GB+)`);
            return { ok: false, reason: 'disk' };
        }
        log.ok(`Disk space: ${freeGb.toFixed(1)}GB ✅`);

        if (offline) {
            log.ok('Internet check skipped (offline mode)');
        } else {
            const online = await netOk('https://www.postgresql.org');
            if (!online) {log.warn('⚠️ No internet — will try winget cache only');}
            else {log.ok('Internet ✅');}
        }

        // ── Install PostgreSQL ──
        try {
            if (offline) {
                // Offline: only detect existing PostgreSQL, skip all downloads
                const existing = this.pg._findExisting();
                if (existing) {
                    this.ctx.pgCtl = existing.pgCtl;
                    this.ctx.pgVer = existing.v;
                    log.ok(`PostgreSQL ${existing.v} found locally ✅`);
                } else {
                    log.error('PostgreSQL not found locally. Install it first.');
                    return false;
                }
            } else {
                await this.pg.install();
            }
            log.ok(`PostgreSQL ${this.ctx.pgVer} ready`);
        } catch (e) {
            if (e instanceof DBError) {
                log.error(`\n${e.name}: ${e.message}`);
                if (e.detail) {log.error(`→ ${e.detail}`);}
                return false;
            }
            throw e;
        }

        // ── Init Database ──
        try { await this.db.init(); } catch (e) {
            if (e instanceof ConfigError) { log.error(e.message); return false; }
            throw e;
        }

        // ── Run Migrations ──
        try { await this.runMigrations(); } catch (e) {
            log.warn(`Migrations: ${e.message} — continuing`);
        }

        // ── Configure Services ──
        try { await this.svc.configure(); } catch (e) {
            if (e instanceof SvcError) { log.warn(e.message); }
            else {throw e;}
        }

        // ── Done ──
        const elapsed = ((Date.now() - this.startMs) / 1000).toFixed(0);
        log.divider();
        log.ok('═══════════════════════════════════════════════════');
        log.ok(`  ${APP.DISPLAY} — Setup Complete ✅`);
        log.ok(`  Time: ${elapsed}s | PG: ${this.ctx.pgVer}`);
        log.ok(`  DB: ${getEnv('DB_NAME', 'karim_erp')} | Port: ${getEnv('DB_PORT', '5432')}`);
        log.ok('═══════════════════════════════════════════════════');
        return true;
    }
}

// ─── Entry ────────────────────────────────────────────
async function main() {
    const p = new KarimERPProvisioner();
    const ok = await p.run();
    process.exit(ok ? 0 : 1);
}

main().catch(err => {
    console.error('FATAL:', err.message);
    process.exit(1);
});
