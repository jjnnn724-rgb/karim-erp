#!/usr/bin/env node
/**
 * watchdog.js — Karim ERP Guardian (v4.7.0 Resilience)
 * ────────────────────────────────────────────────────────────────────────────
 * Supervises backend/server.js:
 *   • Auto-restart on crash with exponential backoff (1s → 30s)
 *   • Circuit breaker: 5 crashes within 3 minutes → 60s cooldown
 *   • Active health polling /api/health every 30s → force-restart after 3 failures
 *   • Memory guard: restart if RSS > 1536MB
 *   • PID lock (logs/watchdog.pid) — single guardian instance
 *   • Rotating logs (logs/watchdog-*.log, 5MB × 5)
 *   • Self-repair: re-installs node_modules if server module is missing
 *   • Scheduled SQL backups every KARIM_BACKUP_KARIM (0 = disabled)
 *
 * Core Node only — zero external dependencies.
 */
'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { shouldRestartChild } = require('../backend/supervisor-policy');

// ─── Configuration ──────────────────────────────────────────────────────────
const ROOT = path.join(__dirname, '..');
const LOG_DIR = path.join(ROOT, 'logs');
const PID_FILE = path.join(LOG_DIR, 'watchdog.pid');
const STATE_FILE = path.join(LOG_DIR, 'watchdog-state.json');
const SERVER_ENTRY = path.join(ROOT, 'backend', 'server.js');
const NODE_MODULES_MARK = path.join(ROOT, 'node_modules', '.package-lock.json');

const PORT = parseInt(process.env.KARIM_PORT || process.env.PORT || '5000', 10);
const HEALTH_PATH = '/api/health';
const POLL_MS = 30_000;           // health poll interval
const HEALTH_FAIL_RESTART = 3;    // consecutive failures → restart
const MEM_LIMIT_MB = 1536;        // RSS guard
const BACKOFF_MIN_MS = 1_000;
const BACKOFF_MAX_MS = 30_000;
const BREAKER_WINDOW_MS = 3 * 60_000;
const BREAKER_THRESHOLD = 5;
const BREAKER_COOLDOWN_MS = 60_000;
const BACKUP_KARIM = parseFloat(process.env.KARIM_BACKUP_KARIM === undefined ? '24' : process.env.KARIM_BACKUP_KARIM);
const LOG_MAX_BYTES = 5 * 1024 * 1024;
const LOG_FILES = 5;

// ─── Logging (rotating) ─────────────────────────────────────────────────────
let logStream = null;
let logIndex = 0;

function logFilePath(i) { return path.join(LOG_DIR, `watchdog-${i}.log`); }

function openLog() {
    // Find the next usable slot; rotate when the current file exceeds the cap.
    for (let i = 0; i < LOG_FILES; i++) {
        const p = logFilePath(i);
        try {
            const st = fs.existsSync(p) ? fs.statSync(p) : null;
            if (!st || st.size < LOG_MAX_BYTES) { logIndex = i; logStream = fs.createWriteStream(p, { flags: 'a' }); return; }
        } catch (_) { /* keep scanning */ }
    }
    logIndex = 0; // wrap: oldest slot gets truncated
    logStream = fs.createWriteStream(logFilePath(0), { flags: 'w' });
}

function ts() { return new Date().toISOString(); }

function log(level, msg) {
    const line = `[${ts()}] [${level}] ${msg}\n`;
    process.stdout.write(line);
    if (!logStream) {openLog();}
    if (logStream) {
        try { logStream.write(line); } catch (_) {}
    }
}

function info(msg) { log('INFO ', msg); }
function warn(msg) { log('WARN ', msg); }
function error(msg) { log('ERROR', msg); }

// ─── Single-instance lock ───────────────────────────────────────────────────
function acquireLock() {
    try {
        if (fs.existsSync(PID_FILE)) {
            const oldPid = parseInt(fs.readFileSync(PID_FILE, 'utf8').trim(), 10);
            if (oldPid && oldPid !== process.pid) {
                try {
                    process.kill(oldPid, 0); // throws if the process is gone
                    // No throw = the previous watchdog is STILL ALIVE. Falling
                    // through here let a second guardian start (double servers,
                    // EADDRINUSE crash loops) — the single-instance lock is void.
                    error(`Another watchdog appears alive (PID ${oldPid}). Exiting.`);
                    process.exit(1);
                } catch (e) {
                    if (e.code === 'ESRCH') { info(`Stale lock from PID ${oldPid} — taking over`); }
                    else { error(`Another watchdog appears alive (PID ${oldPid}). Exiting.`); process.exit(1); }
                }
            }
        }
    } catch (_) { /* corrupt pid file — replace */ }
    fs.writeFileSync(PID_FILE, String(process.pid), 'utf8');
}

function releaseLock() {
    try {
        const cur = parseInt(fs.readFileSync(PID_FILE, 'utf8').trim(), 10);
        if (cur === process.pid) {fs.unlinkSync(PID_FILE);}
    } catch (_) {}
}

// ─── Persisted state ────────────────────────────────────────────────────────
const state = {
    startedAt: ts(),
    restarts: 0,
    crashRestarts: 0,
    healthRestarts: 0,
    memRestarts: 0,
    lastCrash: null,
    lastRestart: null,
    childPid: null,
};
try { Object.assign(state, JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))); } catch (_) {}
function saveState() {
    try { fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf8'); } catch (_) {}
}

// ─── Child management ───────────────────────────────────────────────────────
let child = null;
let stopping = false;          // manual stop flag
let consecutiveHealthFails = 0;
let restartCountWindow = [];   // timestamps of recent restarts (circuit breaker)
let restartTimer = null;
let healthTimer = null;
const manualStopRequested = false;

function nodeModulesOk() {
    return fs.existsSync(NODE_MODULES_MARK) || fs.existsSync(path.join(ROOT, 'node_modules', 'express'));
}

function selfRepair() {
    if (nodeModulesOk()) {return;}
    warn('node_modules missing/broken — running self-repair (npm install --omit=dev)...');
    try {
        const { execSync } = require('child_process');
        execSync('npm install --omit=dev --no-audit --no-fund --ignore-scripts', {
            cwd: ROOT, stdio: 'ignore', timeout: 10 * 60_000,
        });
        info('Self-repair completed.');
    } catch (e) {
        error(`Self-repair failed: ${e.message}`);
    }
}

function killTree(pid) {
    if (!pid) {return;}
    try { process.kill(-pid, 'SIGKILL'); } catch (_) { /* not a group leader */ }
    try { process.kill(pid, 'SIGKILL'); } catch (_) {}
}

function startChild() {
    if (stopping) {return;}

    // Double-spawn guard: a pending scheduleRestart() timer plus an immediate
    // restartChild() call could both reach here — never spawn while a live
    // child (or a pending restart timer) exists.
    if (child && child.exitCode === null && !child.killed) {
        warn('startChild called while a live child exists — ignoring.');
        return;
    }
    if (restartTimer) { clearTimeout(restartTimer); restartTimer = null; }

    // Circuit breaker
    const now = Date.now();
    restartCountWindow = restartCountWindow.filter(t => now - t < BREAKER_WINDOW_MS);
    if (restartCountWindow.length >= BREAKER_THRESHOLD) {
        warn(`Circuit breaker OPEN: ${restartCountWindow.length} restarts in ${BREAKER_WINDOW_MS / 1000}s — cooling down ${BREAKER_COOLDOWN_MS / 1000}s`);
        setTimeout(() => { restartCountWindow = []; startChild(); }, BREAKER_COOLDOWN_MS);
        return;
    }

    selfRepair();

    info(`Starting server (attempt #${state.restarts + 1}) on port ${PORT}...`);
    child = spawn(process.execPath, [SERVER_ENTRY], {
        cwd: ROOT,
        env: { ...process.env, KARIM_SUPERVISED: '1', KARIM_PORT: String(PORT), PORT: String(PORT) },
        stdio: ['ignore', 'inherit', 'inherit'],
        detached: true,
    });
    state.childPid = child.pid;
    saveState();

    child.on('exit', (code, signal) => {
        state.childPid = null;
        child = null; // module-level ref must be cleared too — restartChild()
                      // checks it to decide whether to kill or spawn directly
        saveState();
        // Restart policy lives in backend/supervisor-policy.js (unit-tested).
        // A clean exit (code 0) that the supervisor never asked for is an
        // unexpected shutdown — the guardian must bring the service back.
        const decision = shouldRestartChild({ code, signal, stopping, manualStopRequested });
        if (!decision.restart) { info(`Child exited (${decision.reason}) — not restarting.`); return; }
        const reason = decision.reason === 'unexpected clean exit under supervision'
            ? 'clean exit (code 0) without supervisor stop'
            : decision.reason;
        state.lastCrash = `${ts()} (${reason})`;
        state.crashRestarts += 1;
        state.restarts += 1;
        state.lastRestart = ts();
        restartCountWindow.push(Date.now());
        saveState();
        error(`Server crashed (${reason}) — restarting with backoff...`);
        scheduleRestart();
    });
}

function scheduleRestart() {
    const attempt = restartCountWindow.length;
    const delay = Math.min(BACKOFF_MAX_MS, BACKOFF_MIN_MS * Math.pow(2, attempt));
    info(`Restart in ${delay}ms`);
    clearTimeout(restartTimer);
    restartTimer = setTimeout(startChild, delay);
}

function restartChild(reason) {
    if (stopping) {return;}
    state.restarts += 1;
    state.lastRestart = ts();
    // Health/memory-driven restarts must count toward the circuit breaker —
    // otherwise a hung server causes an endless kill/restart cycle that the
    // breaker never sees.
    restartCountWindow.push(Date.now());
    saveState();
    warn(`Forcing restart: ${reason}`);
    if (child && child.pid) {
        killTree(child.pid);
        // 'exit' handler will trigger scheduleRestart()
    } else {
        startChild();
    }
}

// ─── Health monitoring ──────────────────────────────────────────────────────
function pollHealth() {
    if (stopping) {return;}
    const req = http.get({ host: '127.0.0.1', port: PORT, path: HEALTH_PATH, timeout: 5_000 }, (res) => {
        if (res.statusCode === 200) {
            if (consecutiveHealthFails > 0) {info(`Health recovered after ${consecutiveHealthFails} failed poll(s)`);}
            consecutiveHealthFails = 0;
        } else {
            handleHealthFail(`HTTP ${res.statusCode}`);
        }
        res.resume();
    });
    req.on('timeout', () => { req.destroy(new Error('timeout')); });
    req.on('error', (e) => handleHealthFail(e.message));
}

function handleHealthFail(reason) {
    consecutiveHealthFails += 1;
    warn(`Health check failed (${consecutiveHealthFails}/${HEALTH_FAIL_RESTART}): ${reason}`);
    if (consecutiveHealthFails >= HEALTH_FAIL_RESTART) {
        consecutiveHealthFails = 0;
        state.healthRestarts += 1;
        saveState();
        restartChild(`${HEALTH_FAIL_RESTART} consecutive health failures`);
    }
}

// ─── Memory guard ───────────────────────────────────────────────────────────
function checkMemory() {
    if (!child || !child.pid) {return;}
    try {
        const statm = fs.readFileSync(`/proc/${child.pid}/statm`, 'utf8').split(' ');
        const rssPages = parseInt(statm[1], 10);
        const rssMb = Math.round((rssPages * osPageSize()) / (1024 * 1024));
        if (rssMb > MEM_LIMIT_MB) {
            state.memRestarts += 1;
            saveState();
            restartChild(`memory ${rssMb}MB > ${MEM_LIMIT_MB}MB`);
        }
    } catch (_) { /* process may be gone — exit handler covers it */ }
}

let pageSizeCache = null;
function osPageSize() {
    if (pageSizeCache === null) {
        try { pageSizeCache = require('os').pagesize ? require('os').pagesize() : 4096; }
        catch (_) { pageSizeCache = 4096; }
    }
    return pageSizeCache;
}

// ─── Scheduled backups ──────────────────────────────────────────────────────
let lastBackupAt = 0;
function scheduleBackups() {
    if (!BACKUP_KARIM || BACKUP_KARIM <= 0) { info('Scheduled backups disabled (KARIM_BACKUP_KARIM=0)'); return; }
    const intervalMs = BACKUP_KARIM * 3600_000;
    const tick = () => {
        if (Date.now() - lastBackupAt < intervalMs) {return;}
        lastBackupAt = Date.now();
        info('Running scheduled database backup...');
        try {
            const { execFileSync } = require('child_process');
            execFileSync(process.execPath, [path.join(ROOT, 'database', 'scripts', 'backup.js')], {
                cwd: ROOT, stdio: 'ignore', timeout: 10 * 60_000,
            });
            info('Scheduled backup finished.');
        } catch (e) {
            error(`Scheduled backup failed: ${e.message}`);
        }
    };
    // Read the last backup timestamp from backup status if available
    try {
        const st = JSON.parse(fs.readFileSync(path.join(ROOT, 'database', 'backups', 'daily-backup-status.json'), 'utf8'));
        if (st.timestamp) {lastBackupAt = new Date(st.timestamp).getTime() || 0;}
    } catch (_) {}
    tick(); // maybe an old backup is already stale
    setInterval(tick, Math.min(intervalMs, 30 * 60_000)).unref();
}

// ─── Lifecycle ──────────────────────────────────────────────────────────────
function shutdown(signal) {
    info(`Watchdog received ${signal} — stopping child and exiting.`);
    stopping = true;
    clearTimeout(restartTimer);
    clearInterval(healthTimer);
    if (child && child.pid) {killTree(child.pid);}
    saveState();
    setTimeout(() => { releaseLock(); process.exit(0); }, 500);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('uncaughtException', (e) => { error(`Watchdog uncaughtException: ${e.stack || e.message}`); });
process.on('unhandledRejection', (e) => { error(`Watchdog unhandledRejection: ${e && e.message ? e.message : e}`); });

// ─── Main ───────────────────────────────────────────────────────────────────
if (!fs.existsSync(SERVER_ENTRY)) {
    error(`Server entry not found: ${SERVER_ENTRY}`);
    process.exit(1);
}

try { fs.mkdirSync(LOG_DIR, { recursive: true }); } catch (_) {}
acquireLock();
openLog();
info(`═══════════════════════════════════════════════`);
info(`karim Guardian starting — watchdog PID ${process.pid}, port ${PORT}`);
info(`Restart counters — total:${state.restarts} crash:${state.crashRestarts} health:${state.healthRestarts} mem:${state.memRestarts}`);

startChild();
healthTimer = setInterval(pollHealth, POLL_MS);
setInterval(checkMemory, 20_000).unref();
scheduleBackups();
info('Guardian is armed: crash backoff + circuit breaker + health polling + memory guard + backups.');
