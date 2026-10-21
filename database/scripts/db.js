#!/usr/bin/env node
/**
 * database/db.js — PostgreSQL System Mode Only (v3.1)
 * ════════════════════════════════════════════════════════════════
 * هذا السكريبت يدعم PostgreSQL النظامي فقط — لا يوجد وضع محمول.
 * PostgreSQL يُثبّت على الجهاز عبر KARIMERP أو يدوياً.
 *
 * الاستخدام:
 *   node database/db.js
 *
 * الوضع الوحيد: DB_MODE=system (افتراضي)
 * ─────────────────────────────────────────────────────────────────
 */
const lib = require('../../scripts/shared');
process.chdir(lib.ROOT);
const { log, DATA_DIR, getEnv, isPgRunning, psql } = lib;
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const net = require('net');

// ─── Helpers ────────────────────────────────────────────────
function tcpProbe(host, port, timeoutMs = 1500) {
    return new Promise((resolve) => {
        const tester = net.createConnection({ port: Number(port), host });
        tester.on('connect', () => { tester.end(); resolve(true); });
        tester.on('error', () => resolve(false));
        setTimeout(() => { try { tester.destroy(); } catch (_) {} resolve(false); }, timeoutMs);
    });
}

function findSystemPgCtl() {
    const found = [];
    const push = (p) => { if (p && fs.existsSync(p) && !found.includes(p)) found.push(p); };
    try {
        if (lib.IS_WIN) {
            for (const root of ['C:\\Program Files\\PostgreSQL', 'C:\\Program Files (x86)\\PostgreSQL']) {
                if (!fs.existsSync(root)) continue;
                for (const ver of fs.readdirSync(root).sort().reverse()) {
                    push(path.join(root, ver, 'bin', 'pg_ctl.exe'));
                }
            }
            const where = spawnSync('where', ['pg_ctl.exe'], { encoding: 'utf-8', timeout: 5000 });
            if (where.status === 0) {
                for (const line of String(where.stdout || '').split('\n')) {
                    const p = line.trim();
                    if (p && !p.startsWith(lib.BIN_DIR)) push(p);
                }
            }
        } else {
            if (fs.existsSync('/usr/lib/postgresql')) {
                for (const ver of fs.readdirSync('/usr/lib/postgresql').sort().reverse()) {
                    push(path.join('/usr/lib/postgresql', ver, 'bin', 'pg_ctl'));
                }
            }
            const which = spawnSync('which', ['pg_ctl'], { encoding: 'utf-8', timeout: 5000 });
            if (which.status === 0) {
                const p = String(which.stdout || '').split('\n')[0].trim();
                if (p && !p.startsWith(lib.BIN_DIR)) push(p);
            }
        }
    } catch (_) {}
    return found.length ? found[0] : null;
}

function findSystemService() {
    if (!lib.IS_WIN) return null;
    try {
        const r = spawnSync('sc', ['query', 'type=', 'service', 'state=', 'all'], { encoding: 'utf-8', timeout: 10000 });
        const names = [...String(r.stdout || '').matchAll(/SERVICE_NAME:\s*(postgresql[^\r\n]*)/gi)].map(m => m[1].trim());
        return names.length ? names.sort().reverse()[0] : null;
    } catch (_) { return null; }
}

function windowsServiceState(svc) {
    try {
        const r = spawnSync('sc', ['query', svc], { encoding: 'utf-8', timeout: 8000 });
        const out = String(r.stdout || '');
        const m = out.match(/STATE\s*:\s*\d+\s+(\w+)/);
        return m ? m[1] : null;
    } catch (_) { return null; }
}

function ensureSystemService(svc) {
    if (!svc) return false;
    if (windowsServiceState(svc) === 'RUNNING') return true;
    try {
        const r = spawnSync('sc', ['start', svc], { encoding: 'utf-8', timeout: 30000 });
        return r.status === 0 || /START_PENDING|RUNNING/i.test(String(r.stdout || '') + String(r.stderr || ''));
    } catch (_) { return false; }
}

function authErrorKind(stderr) {
    const s = String(stderr || '');
    if (/password authentication failed/i.test(s)) return 'password';
    if (/role .* does not exist/i.test(s)) return 'role';
    if (/connection refused|could not connect/i.test(s)) return 'refused';
    return 'other';
}

function probeSystemAuth(pgCtlDir, dbHost, dbPort, dbUser, dbPassword) {
    const psqlSys = path.join(pgCtlDir, lib.IS_WIN ? 'psql.exe' : 'psql');
    const bin = fs.existsSync(psqlSys) ? psqlSys : getPgBinary('psql');
    if (!bin) return { ok: false, kind: 'no-binary' };
    const r = spawnSync(bin, ['-h', dbHost, '-p', String(dbPort), '-U', dbUser, '-d', 'postgres', '-tAc', 'SELECT 1'], {
        encoding: 'utf-8', timeout: 8000, env: { ...process.env, PGPASSWORD: dbPassword || '' },
    });
    if (r.status === 0 && String(r.stdout || '').trim() === '1') return { ok: true, kind: null, bin };
    return { ok: false, kind: authErrorKind(r.stderr), bin };
}

// ─── Shared: create DB ──────────────────────────────────
function ensureDatabase(psqlBin, psqlEnv, dbHost, dbPort, dbUser, dbName) {
    log.step(`التأكد من وجود قاعدة البيانات "${dbName}"`);
    const exists = psql(`SELECT 1 FROM pg_database WHERE datname='${dbName}';`, 'postgres', { allowFailure: true });
    if (exists && exists.includes('1')) { log.ok(`قاعدة "${dbName}" موجودة`); return; }
    log.info(`إنشاء قاعدة "${dbName}"...`);
    const result = spawnSync(psqlBin, ['-h', dbHost, '-p', String(dbPort), '-U', dbUser, '-d', 'postgres', '-c', `CREATE DATABASE "${dbName}";`], {
        stdio: 'inherit', env: psqlEnv,
    });
    if (result.status !== 0) {
        log.error(`فشل إنشاء قاعدة "${dbName}"`);
        process.exit(1);
    }
    log.ok('تم الإنشاء');
}

// ─── Shared: apply migrations ────────────────────────────
function applyMigrations() {
    log.step('تطبيق migrations');
    const migrationScript = path.join(__dirname, 'run-migration.js');
    const result = spawnSync(process.execPath, [migrationScript], {
        cwd: lib.ROOT,
        encoding: 'utf-8',
        stdio: 'inherit',
        timeout: 1800000,
        env: process.env,
    });
    if (result.error) {
        throw new Error(`Migration runner could not complete: ${result.error.message}`);
    }
    if (result.status !== 0) {
        throw new Error(`Migration runner failed with exit status ${result.status === null ? 'unknown' : result.status}${result.signal ? ` (signal ${result.signal})` : ''}.`);
    }
    log.ok('تم تطبيق migrations');
}

// ─── System Mode (ONLY MODE) ─────────────────────────────
async function runSystem() {
    log.header('PostgreSQL — System Mode (v3.0)');

    const dbHost = getEnv('DB_HOST', 'localhost');
    let dbPort = getEnv('DB_PORT', '5432');
    const dbUser = getEnv('DB_USER', 'postgres');
    const dbName = getEnv('DB_NAME', 'karim_erp');
    let dbPassword = getEnv('DB_PASSWORD');

    // Smart auto-fix: resolver finds the real working port/service first
    try {
        const resolver = require('../../scripts/db-resolver');
        const r = resolver.resolveDatabase({ autostart: true });
        if (r.ok && String(r.port) !== String(dbPort)) {
            dbPort = String(r.port);
            resolver.persistPort(dbPort);
            log.ok(`اكتشاف ذكي: المنفذ العامل ${dbPort} (${r.service || 'service'})`);
        }
    } catch (_) {}

    // Find pg_ctl
    const sysCtl = findSystemPgCtl();
    if (!sysCtl) {
        log.error('لم يُعثر على PostgreSQL مثبتة على النظام');
        log.error('تأكد من تثبيت أحدث PostgreSQL من: https://www.postgresql.org/download/windows/');
        log.error('أو شغّل المعالج الذكي: node scripts/smart-install.js');
        process.exit(1);
    }
    log.ok(`PostgreSQL المثبتة: ${sysCtl}`);

    // Check if service exists and start it
    const svc = findSystemService();
    if (svc) {
        const started = ensureSystemService(svc);
        log.plain(`    الخدمة: ${svc} — ${windowsServiceState(svc) || (started ? 'بدأت' : 'تعذر التأكد')}`);
    }

    // Wait for server to be ready
    log.step('انتظار جاهزية PostgreSQL...');
    const deadline = Date.now() + 30000;
    let ready = false;
    while (Date.now() < deadline) {
        await new Promise(r => setTimeout(r, 1000));
        if (await tcpProbe(dbHost === 'localhost' ? '127.0.0.1' : dbHost, dbPort)) {
            ready = true;
            break;
        }
    }
    if (!ready) {
        log.error(`PostgreSQL لا تستمع على ${dbHost}:${dbPort}`);
        log.error('تأكد من تشغيل الخدمة: services.msc → PostgreSQL');
        process.exit(1);
    }

    // Verify credentials
    if (!dbPassword) {
        log.error('DB_PASSWORD فارغ — ضع كلمة مرور postgres في .env');
        process.exit(1);
    }
    const probe = probeSystemAuth(path.dirname(sysCtl), dbHost, dbPort, dbUser, dbPassword);
    if (!probe.ok) {
        if (probe.kind === 'password' || probe.kind === 'role') {
            log.error('تعذر الدخول للمثبتة: بيانات الاعتماد مرفوضة');
            log.error('ضع كلمة مرور postgres الصحيحة في DB_PASSWORD داخل .env');
        } else {
            log.error(`تعذر الاتصال بالمثبتة (${probe.kind})`);
        }
        process.exit(1);
    }
    log.ok(`متصلة بالمثبتة على ${dbHost}:${dbPort}`);

    // Ensure database and apply migrations
    const psqlEnv = { ...process.env, PGPASSWORD: dbPassword };
    ensureDatabase(probe.bin, psqlEnv, dbHost, dbPort, dbUser, dbName);
    applyMigrations();

    // Warn if portable is also running
    try {
        const portableCtl = path.join(lib.BIN_DIR, 'bin', lib.IS_WIN ? 'pg_ctl.exe' : 'pg_ctl');
        if (fs.existsSync(portableCtl)) {
            const st = spawnSync(portableCtl, ['status', '-D', DATA_DIR], { encoding: 'utf-8', timeout: 8000 });
            if (/server is running/i.test(String(st.stdout || ''))) {
                log.warn('⚠️  المحمولة تعمل أيضاً بالتوازي — أوقفها (stop-pg.js) لمنع انقسام البيانات');
            }
        }
    } catch (_) {}

    log.plain('');
    log.ok(`PostgreSQL جاهز (النظام) — ${dbHost}:${dbPort}/${dbName}`);
    log.plain(`  الاتصال: host=${dbHost} port=${dbPort} user=${dbUser} db=${dbName}`);
}

// ─── Main ──────────────────────────────────────────────────
async function main() {
    const dbMode = String(getEnv('DB_MODE', 'system')).toLowerCase();

    // V3.0: Only system mode — portable removed
    if (dbMode !== 'system') {
        log.warn(`DB_MODE="${dbMode}" غير مدعوم — استخدام system`);
        process.env.DB_MODE = 'system';
    }

    await runSystem();
}

main().catch((err) => {
    log.error(`خطأ: ${err.message}`);
    console.error(err.stack);
    process.exit(1);
});