'use strict';
/**
 * attendance-governance-scheduler.js — سلسلة الحوكمة داخل السستم نفسه
 * كل ٣٠ دقيقة على :١٨ و:٤٨ بتوقيت الرياض (نفس إيقاع مهمة ويندوز القديمة):
 *   ١. المطابق     reconcile-portal-punches.js — يربط بصمات البوابة المقبولة بالحضور
 *   ٢. إغلاق قديم  zk-close-stale.js           — يغلق أيامًا منسية (idempotent)
 *   ٣. إعادة بناء  attendance-rebuild-sessions.js --days=1 --apply
 *                  — تعيد حساب أمس+اليوم من البصمات الخام؛ لا تكتب إلا عند اختلاف.
 * كل خطوة في عملية ابن مستقلة (نفس السكربتات المُختبَرة، عزل كامل لاتصالات
 * قاعدة البيانات)، ومهلة قصوى ٢٠ دقيقة للخطوة، وحارس تداخل بين الدورات.
 * البوابة: GOVERNANCE_SCHEDULER=1 — مطفأة افتراضيًا حتى لا يتضاعف التشغيل.
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const SCRIPTS_DIR = path.join(__dirname, '..', 'scripts');
const LOG_FILE = path.join(__dirname, '..', 'logs', 'governance-scheduler.log');
const STEP_TIMEOUT_MS = 20 * 60 * 1000;
// لحظية (2026-11-03): الدورة قابلة للضبط بلا كود عبر GOVERNANCE_CYCLE_MS
// (الحد الأدنى دقيقة). الافتراضي ٣٠ دقيقة كما كان.
const CYCLE_INTERVAL_MS = (() => {
    const v = Number(process.env.GOVERNANCE_CYCLE_MS);
    return Number.isFinite(v) && v >= 60000 ? v : 30 * 60 * 1000;
})();

const CHAIN = [
    { file: 'reconcile-portal-punches.js', args: [], label: 'مطابق' },
    { file: 'zk-close-stale.js', args: [], label: 'إغلاق قديم' },
    { file: 'attendance-rebuild-sessions.js', args: ['--days=1', '--apply'], label: 'إعادة بناء' },
];

let running = false;
let lastRun = null;
let intervalTimer = null;

function log(line) {
    if (process.env.JEST_WORKER_ID) {return;}
    try { fs.appendFileSync(LOG_FILE, `[${new Date().toISOString()}] ${line}\n`); } catch (_) {}
}

function tailLines(text, n = 4) {
    return String(text || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean).slice(-n);
}

function runStep(file, args) {
    return new Promise((resolve) => {
        const child = spawn(process.execPath, [path.join(SCRIPTS_DIR, file), ...args], {
            windowsHide: true,
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        let out = '';
        child.stdout.on('data', (d) => { out += d; });
        child.stderr.on('data', (d) => { out += d; });
        const killer = setTimeout(() => {
            child.kill();
            resolve({ file, exit: 'timeout', out });
        }, STEP_TIMEOUT_MS);
        child.on('error', (e) => {
            clearTimeout(killer);
            resolve({ file, exit: 'spawn-error', out: String(e.message) });
        });
        child.on('exit', (code) => {
            clearTimeout(killer);
            resolve({ file, exit: code, out });
        });
    });
}

async function cycle() {
    if (running) {return { skipped: true, reason: 'previous cycle still running' };}
    running = true;
    const results = [];
    for (const step of CHAIN) {
        const r = await runStep(step.file, step.args);
        results.push({ file: r.file, exit: r.exit, tail: tailLines(r.out) });
        log(`${step.label} (${r.file}) exit=${r.exit} :: ${tailLines(r.out).join(' | ')}`);
    }
    lastRun = { at: new Date().toISOString(), results };
    running = false;
    return { skipped: false, lastRun };
}

function riyadhWallMinutes(now = new Date()) {
    const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Riyadh', hour: '2-digit', minute: '2-digit', hour12: false,
    }).formatToParts(now);
    const h = Number(parts.find((p) => p.type === 'hour').value) % 24;
    const m = Number(parts.find((p) => p.type === 'minute').value);
    return h * 60 + m;
}

function nextDelayMs(now = new Date()) {
    const m = riyadhWallMinutes(now) % 60;
    const next = [18, 48].find((s) => s > m) ?? 18 + 60;
    return (next - m) * 60 * 1000;
}

function startGovernanceScheduler() {
    if (process.env.GOVERNANCE_SCHEDULER !== '1') {return null;}
    if (intervalTimer) {return intervalTimer;}
    const delay = nextDelayMs();
    const arm = () => {
        intervalTimer = setInterval(() => { cycle().catch((e) => log('cycle error: ' + e.message)); }, CYCLE_INTERVAL_MS);
        if (typeof intervalTimer.unref === 'function') {intervalTimer.unref();}
        log(`scheduler armed — first cycle running now, then every 30 min on :18/:48 Riyadh`);
        cycle().catch((e) => log('cycle error: ' + e.message));
    };
    const boot = setTimeout(arm, delay);
    if (typeof boot.unref === 'function') {boot.unref();}
    return boot;
}

function register(app) {
    const { jwtAuth, requireRole } = require('./cashier-module/jwt-middleware');
    app.get('/api/ops/governance-scheduler/status', jwtAuth, requireRole('admin'), (req, res) => {
        res.json({
            enabled: process.env.GOVERNANCE_SCHEDULER === '1',
            timerArmed: Boolean(intervalTimer),
            running,
            lastRun,
            chain: CHAIN.map((c) => `${c.file}${c.args.length ? ' ' + c.args.join(' ') : ''}`),
        });
    });
}

module.exports = { startGovernanceScheduler, cycle, nextDelayMs, riyadhWallMinutes, register, CHAIN };
