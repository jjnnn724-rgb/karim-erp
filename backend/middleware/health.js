/**
 * health.js — Enterprise Health Check Endpoints
 * ────────────────────────────────────────────────────────────────────────────
 * Kubernetes / Docker / Load Balancer style probes:
 *
 *   GET /api/health/live      — Liveness:  is the process up? (always 200 if server listening)
 *   GET /api/health/ready     — Readiness: can we serve traffic? checks DB / Redis / disk
 *   GET /api/health/startup   — Startup:   done with boot sequence? (prevents LB hammering)
 *   GET /api/health           — Full report (unauthenticated, safe fields only)
 *   GET /api/health/verbose   — Full report + component durations (JWT admin)
 *
 * Guarantees:
 *   • Never 2xx when DB is down (k8s removes the pod from rotation)
 *   • Tracks degraded components (warn state: HTTP 200 with `status:"degraded"`)
 *   • Times out individual checks (max 2s each, total < 5s)
 *   • Exposes Prometheus-style `component` granularity for alerts
 *   • Adds build info + uptime + memory to help ops debug production
 */

'use strict';

const os = require('os');
const path = require('path');
const fs = require('fs');
const { logger } = require('../logger');
const { ForbiddenError } = require('../errors/app-error');

// ─── Runtime state mutated by server boot ──────────────────
const BOOT_STATE = {
    startedAt:   null,
    initialized: false,      // flipped true when server.listen() callback fires
    readyChecks: [],         // registered async () => {ok, name, error?}
};

// ─── Package version (cached) ──────────────────────────────
let packageInfo = null;
function getPackageInfo() {
    if (packageInfo) {return packageInfo;}
    try {
        const pkg = require(path.join(__dirname, '..', '..', 'package.json'));
        packageInfo = { name: pkg.name, version: pkg.version, commit: (process.env.GIT_COMMIT || '').slice(0, 8) || null };
    } catch {
        packageInfo = { name: 'karim-erp', version: '0.0.0', commit: null };
    }
    return packageInfo;
}

// ─── Disk usage helper (Windows-safe, native APIs only) ────
function diskUsageSync(dir) {
    const measure = (d) => {
        const stats = fs.statfsSync ? fs.statfsSync(d) : null;
        if (stats) {
            const total = BigInt(stats.blocks) * BigInt(stats.bsize);
            const free  = BigInt(stats.bavail) * BigInt(stats.bsize);
            const used = total - free;
            return {
                totalBytes: Number(total),
                freeBytes:  Number(free),
                usedBytes:  Number(used),
                usedPct:    total > 0 ? Number(used) / Number(total) : 0,
                ok:         true,
            };
        }
        // Best-effort fallback via OS-specific commands (only read totals)
        return { total: null, free: null, used: null, ok: true };
    };
    try {
        return measure(dir);
    } catch (e) {
        // The measured dir may legitimately be absent (moved/archived while the
        // app runs) — the volume it lives on is what we actually report.
        try {
            return measure(path.parse(path.resolve(dir)).root);
        } catch (e2) {
            return { ok: false, error: e2.message };
        }
    }
}

// ─── Built-in checkers ─────────────────────────────────────
// Cache the last DB check result for 5 seconds so that a burst of health
// checks (e.g. 240 concurrent from a load test) does NOT hammer the pool.
// The first request probes; the rest read from cache. Under normal ops a
// health poll every 10–30s is still real-time enough for k8s readiness.
let _dbCheckCache = null; // { result, expiresAt }
let _dbCheckPending = null; // single-flight: concurrent storms share one probe
const DB_CHECK_CACHE_MS = 5000;

async function checkDatabase(pool) {
    const t0 = Date.now();
    const now = t0;
    if (_dbCheckCache && _dbCheckCache.expiresAt > now) {
        return { ..._dbCheckCache.result, cached: true };
    }
    // Single-flight: if a probe is already running, await it instead of
    // firing another SELECT 1 into a saturated pool (240 concurrent health
    // checks used to pile 240 timed-out queries on the pool).
    if (_dbCheckPending) {
        try {
            const shared = await _dbCheckPending;
            return { ...shared, cached: true, durationMs: Date.now() - t0 };
        } catch {
            // fall through to a fresh probe below
        }
    }
    _dbCheckPending = (async () => {
        try {
            const { rows } = await Promise.race([
                pool.query('SELECT 1 AS ok'),
                new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 5000)),
            ]);
            const result = {
                component: 'database',
                status: 'ok',
                durationMs: Date.now() - t0,
                details: { rows: rows?.[0]?.ok ?? null },
            };
            _dbCheckCache = { result, expiresAt: Date.now() + DB_CHECK_CACHE_MS };
            return result;
        } catch (e) {
            const result = {
                component: 'database',
                status: 'fail',
                durationMs: Date.now() - t0,
                error: e.message,
            };
            // Cache failures too (shorter) so a pool-starvation burst doesn't
            // pile 240 timed-out queries on top of an already-stressed pool.
            _dbCheckCache = { result, expiresAt: Date.now() + 2000 };
            return result;
        } finally {
            _dbCheckPending = null;
        }
    })();
    return _dbCheckPending;
}

async function checkRedis(ioredis) {
    const t0 = Date.now();
    try {
        if (!ioredis) {return { component: 'redis', status: 'warn', durationMs: 0, error: 'not_configured' };}
        const pong = await Promise.race([
            ioredis.ping(),
            new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 2000)),
        ]);
        return { component: 'redis', status: 'ok', durationMs: Date.now() - t0, details: { pong } };
    } catch (e) {
        return { component: 'redis', status: 'fail', durationMs: Date.now() - t0, error: e.message };
    }
}

function checkDisk(dataDir) {
    const t0 = Date.now();
    const du = diskUsageSync(dataDir || __dirname);
    const status = !du.ok
        ? 'warn'
        : (du.usedPct > 0.97 ? 'fail' : (du.usedPct > 0.90 ? 'warn' : 'ok'));
    return {
        component: 'disk',
        status,
        durationMs: Date.now() - t0,
        details: {
            freeGB:  du.freeBytes  != null ? +(du.freeBytes  / 1073741824).toFixed(2) : null,
            totalGB: du.totalBytes != null ? +(du.totalBytes / 1073741824).toFixed(2) : null,
            usedPct: du.usedPct    != null ? +(du.usedPct * 100).toFixed(1) : null,
        },
        error: (status === 'warn' && du.usedPct != null && du.usedPct > 0.80) ? `Disk usage high: ${(du.usedPct*100).toFixed(1)}%`
             : (du.ok === false ? `Disk check failed: ${du.error || 'statfs unavailable'}` : null),
    };
}

function checkMemory() {
    const t0 = Date.now();
    const m = process.memoryUsage();
    const memTotal = os.totalmem();
    const memFree  = os.freemem();
    const systemPct = memTotal > 0 ? 1 - (memFree / memTotal) : 0;
    const rssMB = Math.round(m.rss / 1048576);
    const warnThreshold = parseInt(process.env.MEM_WARN_MB || '2500', 10);
    const status = rssMB > warnThreshold ? 'warn'
        : systemPct > 0.97 ? 'fail'
        : systemPct > 0.90 ? 'warn' : 'ok';
    return {
        component: 'memory',
        status,
        durationMs: Date.now() - t0,
        details: {
            rssMB,
            heapUsedMB:  Math.round(m.heapUsed  / 1048576),
            heapTotalMB: Math.round(m.heapTotal / 1048576),
            systemUsedPct: +(systemPct * 100).toFixed(1),
            systemFreeGB: +(memFree / 1073741824).toFixed(2),
        },
    };
}

// ─── Rollup a set of component checks into an overall status ─
function rollupStatus(checks) {
    let status = 'ok';
    for (const c of checks) {
        if (c.status === 'fail') { status = 'fail'; break; }
        if (c.status === 'warn') { status = 'warn'; }
    }
    return status;
}

function statusCodeFor(status) {
    if (status === 'fail') {return 503;}
    if (status === 'warn') {return 200;}
    return 200;
}

/**
 * Register additional readiness checks (e.g. ZATCA reachability, printer, external API).
 * Called from module init.
 */
function registerCheck(fn) {
    if (typeof fn === 'function') {BOOT_STATE.readyChecks.push(fn);}
}

function markBootComplete() {
    BOOT_STATE.startedAt   = Date.now();
    BOOT_STATE.initialized = true;
}

/**
 * Build the Express router. Pass in the initialized DB pool / optional Redis.
 */
function createHealthRouter({ pool, redis, dataDir } = {}) {
    const express = require('express');
    const router = express.Router();

    async function runAllChecks() {
        const checks = [];
        checks.push(checkMemory());
        checks.push(checkDisk(dataDir));
        if (pool)  {checks.push(await checkDatabase(pool));}
        if (redis) {checks.push(await checkRedis(redis));}

        // Extra user-registered checks (with timeout per-check)
        for (const fn of BOOT_STATE.readyChecks) {
            try {
                const result = await Promise.race([
                    Promise.resolve(fn()),
                    new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 3000)),
                ]);
                if (result) {checks.push(result);}
            } catch (e) {
                checks.push({
                    component: fn.name || 'custom_check',
                    status: 'warn',
                    error: e.message,
                });
            }
        }
        return checks;
    }

    function baseReport(checks) {
        const pkg = getPackageInfo();
        const uptimeMs = BOOT_STATE.startedAt ? Date.now() - BOOT_STATE.startedAt : null;
        return {
            status: rollupStatus(checks),
            timestamp: new Date().toISOString(),
            boot: {
                initialized: BOOT_STATE.initialized,
                startedAt:   BOOT_STATE.startedAt ? new Date(BOOT_STATE.startedAt).toISOString() : null,
                uptimeMs,
                uptime: uptimeMs != null ? formatUptime(uptimeMs) : null,
            },
            app: {
                name:    pkg.name,
                version: pkg.version,
                commit:  pkg.commit,
                env:     process.env.NODE_ENV || 'development',
                pid:     process.pid,
            },
            host: {
                hostname:   os.hostname(),
                platform:   os.platform(),
                arch:       os.arch(),
                cpus:       os.cpus().length,
                nodeVersion: process.version,
            },
            checks,
        };
    }

    // ──────────────────────────────────────────────────
    // /live — always 200 unless the process is dead
    // (the fact the request was answered means it's live)
    // ──────────────────────────────────────────────────
    router.get('/live', (_req, res) => {
        res.status(200).json({ status: 'ok', timestamp: new Date().toISOString(), pid: process.pid });
    });

    // ──────────────────────────────────────────────────
    // /startup — boot sequence finished?
    // Prevents LB from routing until we're ready
    // ──────────────────────────────────────────────────
    router.get('/startup', (_req, res) => {
        if (!BOOT_STATE.initialized) {
            return res.status(503).json({ status: 'fail', reason: 'boot_in_progress', checkedAt: new Date().toISOString() });
        }
        res.status(200).json({ status: 'ok', bootMs: Date.now() - BOOT_STATE.startedAt });
    });

    // ──────────────────────────────────────────────────
    // /ready — pass / fail for serving traffic
    // Database, outbox publisher, or websocket listener failure is
    // critical (503). Memory/disk stay warnings (still usable).
    // TASK 8: a stalled publisher or deaf socket must remove the
    // node from rotation, not just warn.
    // ──────────────────────────────────────────────────
    router.get('/ready', async (req, res) => {
        const checks = await runAllChecks();
        const criticalFail = checks.some(c => (c.component === 'database' || c.component === 'outbox' || c.component === 'websocket') && c.status === 'fail');
        const status = criticalFail ? 'fail' : rollupStatus(checks) === 'fail' ? 'warn' : 'ok';
        const code = statusCodeFor(status);
        res.status(code).json({
            status,
            code,
            checkedAt: new Date().toISOString(),
            critical: checks.map(({ component, status, durationMs }) => ({ component, status, durationMs })),
        });
    });

    // ──────────────────────────────────────────────────
    // /health — public summary (safe, no sensitive info)
    // Only DB failure returns 503 (k8s removes pod). Memory/disk
    // warnings return 200 so the server stays in rotation.
    // ──────────────────────────────────────────────────
    router.get('/', async (_req, res) => {
        const checks = await runAllChecks();
        const report = baseReport(checks);
        delete report.checks;               // hide full details
        report.components = checks.map(({ component, status, durationMs }) => ({ component, status, durationMs }));
        // Only DB failure is critical enough to return 503.
        const dbFail = checks.some(c => c.component === 'database' && c.status === 'fail');
        res.status(dbFail ? 503 : 200).json(report);
    });

    // ──────────────────────────────────────────────────
    // /health/verbose — admin-only full diagnostic
    // ──────────────────────────────────────────────────
    router.get('/verbose', async (req, res, next) => {
        // FIX 2026-10-11 (C9): use req.connection.remoteAddress (actual TCP peer)
        // not req.ip — with trust proxy=1, req.ip is spoofable via X-Forwarded-For.
        // Also accept ::ffff:127.0.0.1 (IPv4-mapped IPv6).
        const peerAddr = req.connection?.remoteAddress || '';
        const isLocal = peerAddr === '127.0.0.1' || peerAddr === '::1' || peerAddr === '::ffff:127.0.0.1';
        const tokenOk = req.headers['x-health-token'] && req.headers['x-health-token'] === (process.env.HEALTH_TOKEN || '');
        const adminRole = req.user?.role === 'admin' || req.user?.role === 'owner';
        if (!isLocal && !tokenOk && !adminRole) {
            return next(new ForbiddenError('عرض تقرير الصحة المفصّل'));
        }
        const checks = await runAllChecks();
        const report = baseReport(checks);
        report.loadAvg = os.loadavg();
        report.network = Object.entries(os.networkInterfaces())
            .filter(([n]) => !['Loopback Pseudo-Interface 1', 'lo'].includes(n))
            .map(([name, addrs]) => ({
                name,
                addresses: addrs.filter(a => a.family === 'IPv4').map(a => a.address),
            }));
        res.status(statusCodeFor(report.status)).json(report);
    });

    return router;
}

function formatUptime(ms) {
    const s  = Math.floor(ms / 1000);
    const d  = Math.floor(s / 86400);
    const h  = Math.floor((s % 86400) / 3600);
    const m  = Math.floor((s % 3600) / 60);
    const ss = s % 60;
    return `${d}d ${h}h ${m}m ${ss}s`;
}

module.exports = {
    createHealthRouter,
    registerCheck,
    markBootComplete,
};
