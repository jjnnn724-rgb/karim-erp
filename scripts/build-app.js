#!/usr/bin/env node
/**
 * karim — مدير دورة حياة نظام مطاعم الشرفه العالمي (Task 30)
 * ────────────────────────────────────────────────────────────────────────────
 * أوامر:
 *   karim start    تهيئة ناقصة (PG + القاعدة + الترحيلات) ثم تشغيل منفصل للخادم وانتظار الصحة (40 ثانية)
 *   karim stop     إيقاف رشيق للخادم (SIGTERM → SIGKILL بعد المهلة) — قاعدة البيانات تبقى تعمل
 *   karim restart  إيقاف ثم تشغيل
 *   karim status   حالة الخادم: PID + الصحة + الإصدار + حالة قاعدة البيانات (checks.database)
 *   karim logs     آخر 50 سطرًا من السجل (و karim logs -f للمتابعة الحية)
 *
 * ضمانات:
 *   - idempotent: التشغيل على نظام يعمل لا يبدأ نسخة ثانية.
 *   - detached بـ PID جديد (حيلة pg_ctl daemonize): العملية الوسيطة تلد الخادم
 *     بمعرف جديد غير مسجل لجلسة الطرفية، فيبقى حيًا بعد انتهاء الأمر.
 *   - لا يحذف قاعدة بيانات ولا ينفذ reset — الترحيلات آمنة للتكرار.
 */
const path = require('path');
const fs = require('fs');
const { spawn, spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const LOGS_DIR = path.join(ROOT, 'logs');
const PID_FILE = path.join(LOGS_DIR, 'karim-backend.pid');
const LOG_FILE = path.join(LOGS_DIR, 'karim-server.out');
const SERVER_SCRIPT = path.join(ROOT, 'backend', 'server.js');
const START_PG_SCRIPT = path.join(ROOT, 'database', 'scripts', 'start-pg.js');
const HEALTH_WAIT_SECONDS = 40;
const STOP_WAIT_SECONDS = 15;

// Task 36 (التسليم): العاملون الخلفيون — يُولَدون بولادة منفصلة مثل الخادم
// (حيلة PID الجديد) ليبقوا أحياءً بعد انتهاء الأمر، ويُوقفون قبل الخادم.
const WORKERS = [
    {
        name: 'print-worker',
        script: path.join(ROOT, 'backend', 'cashier-module', 'print-worker.js'),
        pidFile: path.join(LOGS_DIR, 'print-worker.pid'),
        logFile: path.join(LOGS_DIR, 'print-worker.out'),
    },
    {
        name: 'zatca-worker',
        script: path.join(ROOT, 'backend', 'cashier-module', 'zatca-worker.js'),
        pidFile: path.join(LOGS_DIR, 'zatca-worker.pid'),
        logFile: path.join(LOGS_DIR, 'zatca-worker.out'),
    },
];

const lib = require('./shared');
const { log, getEnv, httpReq } = lib;

function pidAlive(pid) {
    if (!pid || !Number.isFinite(Number(pid))) {return false;}
    try { process.kill(Number(pid), 0); return true; } catch (error) {
        return error.code === 'EPERM';
    }
}

function readPid() {
    try { return Number(fs.readFileSync(PID_FILE, 'utf-8').trim()); } catch (_) { return null; }
}

function writePid(pid) {
    fs.mkdirSync(LOGS_DIR, { recursive: true });
    fs.writeFileSync(PID_FILE, String(pid), 'utf-8');
}

function removePidFile() {
    try { fs.unlinkSync(PID_FILE); } catch (_) {}
}

async function health(timeoutMs = 3000) {
    // httpReq في lib يملك مهلة 10 ثوانٍ ثابتة — نلفها بمهلة أقصر للفحص السريع
    const result = await Promise.race([
        httpReq('GET', '/api/health'),
        new Promise(resolve => setTimeout(() => resolve({ status: 0, error: 'timeout' }), timeoutMs)),
    ]);
    return result;
}

function serverPort() {
    return process.env.PORT || getEnv('PORT', '5000');
}

async function isRunning() {
    const pid = readPid();
    const ok = await health();
    if (ok.status === 200) {return { running: true, pid: pidAlive(pid) ? pid : null, health: ok.json };}
    return { running: false, pid: pidAlive(pid) ? pid : null, health: ok };
}

// ─── وضع الولادة المنفصلة: عملية وسيطة بمعرف جديد تلد الخادم ثم تختفي ───────
function spawnServerDetached() {
    fs.mkdirSync(LOGS_DIR, { recursive: true });
    const out = fs.openSync(LOG_FILE, 'a');
    const child = spawn(process.execPath, [SERVER_SCRIPT], {
        cwd: ROOT,
        detached: true,
        stdio: ['ignore', out, out],
        env: { ...process.env },
    });
    child.unref();
    writePid(child.pid);
    return child.pid;
}

function readPidFrom(pidFile) {
    try { return Number(fs.readFileSync(pidFile, 'utf-8').trim()); } catch (_) { return null; }
}

function writePidTo(pidFile, pid) {
    fs.mkdirSync(LOGS_DIR, { recursive: true });
    fs.writeFileSync(pidFile, String(pid), 'utf-8');
}

function removePidFileAt(pidFile) {
    try { fs.unlinkSync(pidFile); } catch (_) {}
}

/** ولادة عامل منفصلة: عملية وسيطة بمعرف جديد تلد العامل ثم تختفي (درس Task 32) */
function spawnWorkerDetached(worker) {
    const intermediate = spawn(process.execPath, [__filename, '__spawn_worker__', worker.script, worker.pidFile, worker.logFile], {
        cwd: ROOT,
        detached: true,
        stdio: 'ignore',
        env: { ...process.env },
    });
    intermediate.unref();
}

async function startWorkers() {
    for (const worker of WORKERS) {
        const existing = readPidFrom(worker.pidFile);
        if (pidAlive(existing)) {
            log.ok(`العامل ${worker.name} يعمل بالفعل (PID ${existing}) — لا تشغيل مزدوج`);
            continue;
        }
        removePidFileAt(worker.pidFile);
        spawnWorkerDetached(worker);
        await new Promise((r) => setTimeout(r, 800));
        const pid = readPidFrom(worker.pidFile);
        if (pidAlive(pid)) {log.ok(`العامل ${worker.name} يعمل (PID ${pid})`);}
        else {log.warn(`العامل ${worker.name} لم يُسجّل PID — راجع ${worker.logFile}`);}
    }
}

async function stopWorkers() {
    for (const worker of WORKERS) {
        const pid = readPidFrom(worker.pidFile);
        if (!pidAlive(pid)) { removePidFileAt(worker.pidFile); continue; }
        try { process.kill(pid, 'SIGTERM'); } catch (_) {}
        const deadline = Date.now() + 5000;
        while (Date.now() < deadline && pidAlive(pid)) {await new Promise((r) => setTimeout(r, 300));}
        if (pidAlive(pid)) { try { process.kill(pid, 'SIGKILL'); } catch (_) {} await new Promise((r) => setTimeout(r, 500)); }
        removePidFileAt(worker.pidFile);
        log.ok(`العامل ${worker.name} متوقف`);
    }
}

async function workersStatusLines() {
    for (const worker of WORKERS) {
        const pid = readPidFrom(worker.pidFile);
        const alive = pidAlive(pid);
        log.plain(`العامل ${worker.name}: ${alive ? `يعمل (PID ${pid})` : 'متوقف'} — سجل: ${path.basename(worker.logFile)}`);
    }
}

async function cmdStart() {
    log.header('karim — تشغيل النظام');
    const state = await isRunning();
    if (state.running) {
        const version = state.health?.version || '؟';
        log.ok(`النظام يعمل بالفعل (v${version} على المنفذ ${serverPort()}) — لا تشغيل مزدوج`);
        return 0;
    }
    if (state.pid) {
        log.warn(`ملف PID يشير لعملية حية (${state.pid}) بلا استجابة صحة — تنظيف المرجع`);
    }
    removePidFile();

    // 1) قاعدة البيانات: تشغيل PG + ضمان القاعدة + تطبيق الترحيلات المعلقة
    if (!fs.existsSync(START_PG_SCRIPT)) {
        log.error(`سكربت قاعدة البيانات غير موجود: ${START_PG_SCRIPT}`);
        return 1;
    }
    log.step('تهيئة PostgreSQL والترحيلات');
    const pg = spawnSync(process.execPath, [START_PG_SCRIPT], { cwd: ROOT, stdio: 'inherit', timeout: 180000 });
    if (pg.status !== 0) {
        log.error('فشل تهيئة PostgreSQL أو تطبيق الترحيلات');
        return 1;
    }

    // 2) الولادة المنفصلة بمعرف جديد (يبقى حيًا بعد انتهاء هذا الأمر)
    const intermediate = spawn(process.execPath, [__filename, '__spawn_server__'], {
        cwd: ROOT,
        detached: true,
        stdio: 'ignore',
        env: { ...process.env },
    });
    intermediate.unref();

    // 3) انتظار الصحة حتى 40 ثانية
    log.step(`انتظار صحة الخادم على المنفذ ${serverPort()} (حتى ${HEALTH_WAIT_SECONDS} ثانية)`);
    const deadline = Date.now() + HEALTH_WAIT_SECONDS * 1000;
    let last = { status: 0 };
    while (Date.now() < deadline) {
        await new Promise(r => setTimeout(r, 1000));
        last = await health(2000);
        if (last.status === 200 || last.status === 503) {break;}
    }
    if (last.status === 200) {
        const db = last.json?.checks?.database;
        const latency = typeof db?.latency === 'string' ? db.latency : `${db?.latency ?? '؟'}ms`;
        log.ok(`النظام يعمل: v${last.json?.version || '؟'} — قاعدة البيانات ${db?.status || '؟'} (${latency}) — PID ${readPid()}`);
        log.step('تشغيل العاملين الخلفيين (الطباعة + ZATCA)');
        await startWorkers();
        log.plain(`الواجهة: http://localhost:${serverPort()}/app/pos.html`);
        return 0;
    }
    if (last.status === 503) {
        log.warn('الخادم يستجيب لكن قاعدة البيانات غير جاهزة (503) — راجع karim status');
        return 1;
    }
    log.error(`الخادم لم يستجب خلال ${HEALTH_WAIT_SECONDS} ثانية — السجل: karim logs`);
    return 1;
}

async function cmdStop() {
    log.header('karim — إيقاف النظام');
    // العاملون أولًا (يفصلون عن الخادم كي لا يعيدوا المطالبة بمهام أثناء الإيقاف)
    await stopWorkers();
    const pid = readPid();
    if (!pidAlive(pid)) {
        removePidFile();
        const ok = await health(2000);
        if (ok.status === 200) {
            log.warn('خادم يستجيب بلا ملف PID (تشغيل خارجي؟) — لم أوقف شيئًا');
            return 1;
        }
        log.ok('الخادم متوقف بالفعل');
        return 0;
    }
    log.step(`إيقاف رشيق للعملية ${pid} (SIGTERM)`);
    try { process.kill(pid, 'SIGTERM'); } catch (_) {}
    const deadline = Date.now() + STOP_WAIT_SECONDS * 1000;
    while (Date.now() < deadline && pidAlive(pid)) {
        await new Promise(r => setTimeout(r, 500));
    }
    if (pidAlive(pid)) {
        log.warn('لم ينطفئ بالرشيق — SIGKILL');
        try { process.kill(pid, 'SIGKILL'); } catch (_) {}
        await new Promise(r => setTimeout(r, 1000));
    }
    removePidFile();
    if (pidAlive(pid)) {
        log.error(`فشل إيقاف العملية ${pid}`);
        return 1;
    }
    log.ok('الخادم متوقف — قاعدة البيانات تبقى تعمل (بياناتك آمنة)');
    return 0;
}

async function cmdStatus() {
    const pid = readPid();
    const state = await isRunning();
    if (state.running) {
        const h = state.health || {};
        const db = h.checks?.database || {};
        const latency = typeof db.latency === 'string' ? db.latency : `${db.latency ?? '؟'}ms`;
        log.ok(`يعمل: PID ${state.pid || 'خارجي'} — v${h.version || '؟'} — uptime ${Math.round(h.uptime || 0)}s`);
        log.plain(`قاعدة البيانات: ${db.status || '؟'} (${latency})`);
        await workersStatusLines();
        return 0;
    }
    log.warn(pidAlive(pid) ? `العملية ${pid} حية لكن بلا استجابة صحة` : 'متوقف');
    return 3;
}

function cmdLogs() {
    if (!fs.existsSync(LOG_FILE)) {
        log.warn('لا سجل بعد — شغل النظام أولًا: karim start');
        return 0;
    }
    const follow = process.argv.slice(3).includes('-f');
    const child = spawnSync('tail', follow ? ['-n', '50', '-f', LOG_FILE] : ['-n', '50', LOG_FILE], { stdio: 'inherit' });
    return child.status || 0;
}

async function main() {
    const command = String(process.argv[2] || '').toLowerCase();
    // وضع الولادة الداخلية: تُستدعى من cmdStart كعملية وسيطة بمعرف جديد
    if (command === '__spawn_server__') {
        spawnServerDetached();
        setTimeout(() => process.exit(0), 200);
        return;
    }
    // ولادة عامل منفصلة: [script, pidFile, logFile] من العملية الوسيطة
    if (command === '__spawn_worker__') {
        const [script, pidFile, logFile] = process.argv.slice(3);
        fs.mkdirSync(LOGS_DIR, { recursive: true });
        const out = fs.openSync(logFile, 'a');
        const child = spawn(process.execPath, [script], {
            cwd: ROOT,
            detached: true,
            stdio: ['ignore', out, out],
            env: { ...process.env },
        });
        child.unref();
        writePidTo(pidFile, child.pid);
        setTimeout(() => process.exit(0), 200);
        return;
    }
    let code = 0;
    if (command === 'start') {code = await cmdStart();}
    else if (command === 'stop') {code = await cmdStop();}
    else if (command === 'restart') { await cmdStop(); code = await cmdStart(); }
    else if (command === 'status') {code = await cmdStatus();}
    else if (command === 'logs') {code = cmdLogs();}
    else {
        console.log('الاستخدام: karim [start|stop|restart|status|logs [-f]]');
        code = command ? 1 : 0;
    }
    process.exit(code);
}

main().catch((error) => {
    console.error('[karim] خطأ غير متوقع:', error.message || error);
    process.exit(1);
});
