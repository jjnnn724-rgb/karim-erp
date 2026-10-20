#!/usr/bin/env node
/**
 * serve — Start the full Karim ERP system
 * ────────────────────────────────────────────────────────────────────────────
 *   1. Ensure PG is running (start if needed)
 *   2. Start Express backend (foreground, with live logs)
 *   3. Open browser automatically
 *   4. Ctrl+C → graceful shutdown (stop backend + PG)
 *
 * Usage: node scripts/serve.js
 */
const lib = require('./shared');
// Ensure we are in the project root
process.chdir(lib.ROOT);

// شهادة HTTPS تلقائية لهذا الجهاز (اسم الجهاز + كل عناوين الشبكة) قبل تشغيل HTTPS
try { require('./lan-cert').ensure(); } catch (_) {}
const { log, ROOT, isPortInUse, getEnv, httpReq } = lib;
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

// ─── Environment Pre-Flight Sanity Check (آلية وقائية عند النقل) ───
// عند نقل المشروع على جهاز جديد: تشغيل فحص سريع للبيئة قبل بدء الخادم
// لا يمنع التشغيل (لن يُكسر تجربة المستخدم) لكنه يقدم تحذيرات واضحة لو هناك مشاكل
(function runEnvironmentPreflight() {
    try {
        const verifyScript = path.join(ROOT, 'scripts', 'verify-env.js');
        if (!fs.existsSync(verifyScript)) {return;}
        const r = spawnSync(process.execPath, [verifyScript, '--silent-warnings'], {
            cwd: ROOT, encoding: 'utf-8', timeout: 15000, shell: process.platform === 'win32',
        });
        if (r.status !== 0 && r.stdout) {
            // نجح فحص ولكن به تحذيرات — نعرض ملخص مختصر فقط
            const summary = (r.stdout || '').split('\n').filter(l =>
                /WARN|FAIL|خطأ|يجب|مفقود|فارغ/.test(l)
            ).slice(0, 6);
            if (summary.length) {
                console.log('\x1b[33m%s\x1b[0m',
                    '\n⚠  تحذير: تم اكتشاف بعض مشاكل البيئة عند تشغيل فحص سريع:');
                summary.forEach(s => console.log('   ' + s));
                console.log('\x1b[36m%s\x1b[0m',
                    '   → لإصلاحها تلقائياً: npm run verify:fix  أو  node scripts/deploy-machine.mjs\n');
            }
        }
    } catch (_) { /* لا نفشل إذا كان الفحص نفسه يحتوي على خطأ — استمر التشغيل العادي */ }
})();

let backendProcess = null;
const pgStartedByUs = false;
// إحياء ذاتي: سقوط الخادم ≠ توقف النظام — إعادة تشغيل تلقائية مع سجل ملف
let launcherStopping = false;
let backendRestarts = 0;
let backendStartedAt = 0;
const MAX_BACKEND_RESTARTS = 50;
const BACKEND_RESTART_DELAY_MS = 3000;
// FIX 2026-10-19: كان `null` ثابتًا فلا يُكتب سجل إعادة التشغيل أبدًا.
let backendLogStream = null;
try {
    fs.mkdirSync(path.join(ROOT, 'logs'), { recursive: true });
    backendLogStream = fs.createWriteStream(path.join(ROOT, 'logs', 'server.log'), { flags: 'a' });
    backendLogStream.on('error', () => { backendLogStream = null; });
} catch (_) { backendLogStream = null; }

function noteBackend(text) {
    const line = `[${new Date().toISOString()}] ${text}\n`;
    try { if (backendLogStream) {backendLogStream.write(line);} } catch (_) {}
}

function getLocalIp() {
    const nets = os.networkInterfaces();
    for (const name of Object.keys(nets)) {
        for (const net of nets[name]) {
            if (net.family === 'IPv4' && !net.internal) {
                if (net.address.startsWith('192.168.') || net.address.startsWith('10.') || net.address.startsWith('172.')) {
                    return net.address;
                }
            }
        }
    }
    return 'localhost';
}

async function ensurePgRunning() {
    const dbHost = getEnv('DB_HOST', 'localhost');
    const dbUser = getEnv('DB_USER', 'postgres');
    const dbPassword = getEnv('DB_PASSWORD');

    // 1) المنفذ المحفوظ أولاً (سريع)
    const dbPort = getEnv('DB_PORT', '5432');
    if (dbPassword && lib.isPgRunning(dbHost, dbPort, dbUser, dbPassword)) {
        log.ok('PostgreSQL يعمل');
        return true;
    }
    // 2) الحل الذكي الموحد: إقلاع خدمة متوقفة + تجربة كل المنافذ + تثبيت المنفذ الصحيح
    try {
        const resolver = require('./db-resolver');
        const r = resolver.resolveDatabase({ autostart: true });
        if (r.ok) {
            if (String(r.port) !== String(dbPort)) {
                resolver.persistPort(String(r.port));
                try { process.env.DB_PORT = String(r.port); } catch (_) {}
            }
            log.ok(`PostgreSQL يعمل على ${r.host}:${r.port}${r.service ? ` (${r.service})` : ''}`);
            return true;
        }
        if (!dbPassword) {
            log.error('DB_PASSWORD فارغ في .env — ضع كلمة مرور postgres الحقيقية ثم أعد التشغيل');
            log.error('أو شغّل المعالج الذكي: node scripts/smart-install.js');
            return false;
        }
        log.error(resolver.diagnoseArabic(r));
        log.error('بعد الإصلاح أعد: node scripts/serve.js');
        return false;
    } catch (_) {
        // v3.0: System PG only — cannot start portable
        // PostgreSQL must be installed and running as a service
        log.error('PostgreSQL غير يعمل — تأكد من تثبيت أحدث PostgreSQL على النظام');
        log.error('المعالج الذكي: node scripts/smart-install.js (يكتشف ويثبّت ويصلّح تلقائياً)');
        log.error('يدوي: services.msc ← تشغيل خدمة PostgreSQL');
        log.error('تحميل: https://www.postgresql.org/download/windows/');
        return false;
    }
}

async function checkBackendRunning() {
    const port = getEnv('PORT', '5000');
    if (await isPortInUse(parseInt(port, 10))) {
        // Check if it's our backend
        const health = await httpReq('GET', '/api/health');
        if (health.status === 200 || health.status === 503) {
            log.warn(`الخادم يعمل بالفعل على المنفذ ${port}`);
            log.warn('أوقفه أولاً أو استخدم منفذ آخر (PORT=xxxx في .env)');
            return true;
        }
    }
    return false;
}

function startBackend() {
    const serverPath = path.join(ROOT, 'backend', 'server.js');
    if (!fs.existsSync(serverPath)) {
        log.error(`backend/server.js غير موجود: ${serverPath}`);
        return false;
    }

    log.step('بدء خادم Express...');
    // استخدم inherit للتوافق مع Windows — السجلات ستظهر في الكونسول
    const childStdio = 'inherit';
    backendProcess = spawn(process.execPath, [serverPath], {
        stdio: childStdio,
        cwd: ROOT,
        env: { ...process.env, DB_PASSWORD: getEnv('DB_PASSWORD') },
    });
    backendStartedAt = Date.now();

    backendProcess.on('error', (err) => {
        log.error(`فشل بدء الخادم: ${err.message}`);
        noteBackend(`SPAWN_ERROR: ${err.message}`);
    });

    backendProcess.on('exit', (code, signal) => {
        if (launcherStopping) {return;}
        const reason = signal ? `signal=${signal}` : `code=${code}`;
        // EADDRINUSE الذكي: لو هناك خادم سليم يستجيب فعلًا فنحن النسخة الزائدة —
        // انسحاب هادئ بدل 50 محاولة فاشلة تشوّش السجل
        (async () => {
            if (code !== 0) {
                let health = { status: 0 };
                try { health = await httpReq('GET', '/api/health'); } catch (_) {}
                if (health.status === 200) {
                    log.warn('نسخة أخرى تخدم المنفذ بنجاح — انسحاب بدون إعادة تشغيل');
                    noteBackend('STAND_DOWN: healthy instance already serving, launcher exiting');
                    process.exit(0);
                    return;
                }
            }
            if (code === 0) {return;} // إيقاف طبيعي — لا إعادة
            // تشغيلٌ مستقر > 60 ثانية يُصفّر عدّاد الإحياء (وإلا امتلأ عبر الأيام)
            if (backendStartedAt && Date.now() - backendStartedAt > 60000) {backendRestarts = 0;}
            log.warn(`الخادم توقف (${reason}) — إعادة تشغيل تلقائية...`);
            noteBackend(`BACKEND_EXIT ${reason} — auto-restart ${backendRestarts + 1}/${MAX_BACKEND_RESTARTS}`);
            if (backendRestarts >= MAX_BACKEND_RESTARTS) {
                log.error('تجاوز حد إعادة التشغيل — راجع logs/server.log');
                noteBackend('RESTART_LIMIT_REACHED — giving up');
                return;
            }
            backendRestarts++;
            setTimeout(() => { if (!launcherStopping) {startBackend();} }, BACKEND_RESTART_DELAY_MS);
        })().catch((e) => log.error(`خطأ في معالج إعادة التشغيل: ${e.message}`));
    });

    return true;
}

function openBrowser(url) {
    // KARIM_NO_BROWSER=1 للتشغيل الخلفي (سكريبت إعادة التشغيل المخفي) —
    // بدونها كل إعادة تشغيل خلفية تفتح تبويب متصفح جديد بلا داعٍ.
    if (process.env.KARIM_NO_BROWSER === '1') {return;}
    if (process.env.KARIMERP_NO_BROWSER === '1' || process.env.NO_BROWSER === '1') {
        log.plain(`  رابط النظام: ${url} — (فتح المتصفح معطّل)`);
        return;
    }
    try {
        const opener = lib.IS_WIN ? 'cmd.exe' : (lib.IS_MAC ? 'open' : 'xdg-open');
        const openerArgs = lib.IS_WIN ? ['/c', 'start', '""', url] : [url];
        const child = spawn(opener, openerArgs, { detached: true, stdio: 'ignore', windowsHide: true, shell: false });
        child.unref();
        log.ok(`رابط النظام: ${url}`);
    } catch (_) {
        log.warn(`لم يتمكن من فتح المتصفح تلقائياً — افتح: ${url}`);
    }
}

async function shutdown(signal) {
    if (shutdown.inProgress) {return;}
    shutdown.inProgress = true;
    launcherStopping = true; // منع الإحياء الذاتي أثناء الإيقاف المقصود
    log.plain('');
    log.step(`إيقاف النظام (${signal})...`);

    // Stop backend and wait briefly so its own graceful shutdown can drain DB/socket resources.
    if (backendProcess && !backendProcess.killed) {
        try {
            backendProcess.kill('SIGTERM');
            await new Promise(resolve => {
                const timer = setTimeout(resolve, 5000);
                backendProcess.once('exit', () => { clearTimeout(timer); resolve(); });
            });
            log.ok('تم إيقاف الخادم');
        } catch (_) {}
    }

    // Stop PG only when this launcher started it.
    if (pgStartedByUs) {
        try {
            const stopScript = path.join(ROOT, 'database', 'scripts', 'stop-pg.js');
            if (fs.existsSync(stopScript)) {
                spawnSync(process.execPath, [stopScript], { stdio: 'inherit', timeout: 30000 });
            }
        } catch (_) {}
    }

    log.ok('تم الإيقاف بنجاح');
    process.exit(0);
}

function runBootstrapDatabaseTasks() {
    const migrationScript = path.join(ROOT, 'database', 'scripts', 'run-migration.js');
    const passwordScript = path.join(ROOT, 'scripts', 'migrate-plaintext-passwords.js');
    log.step('تطبيق الترحيلات الإنتاجية قبل تشغيل الخادم...');
    const migration = spawnSync(process.execPath, [migrationScript], { stdio: 'inherit', cwd: ROOT, timeout: 180000, env: { ...process.env } });
    if (migration.status !== 0) {
        log.error('فشل تطبيق الترحيلات؛ تم إيقاف التشغيل لحماية البيانات.');
        return false;
    }
    log.step('التحقق من تشفير كلمات المرور...');
    const passwords = spawnSync(process.execPath, [passwordScript], { stdio: 'inherit', cwd: ROOT, timeout: 120000, env: { ...process.env } });
    if (passwords.status !== 0) {
        log.error('فشل التحقق من كلمات المرور؛ تم إيقاف التشغيل لحماية الحسابات.');
        return false;
    }
    return true;
}

async function main() {
    log.header('مطاعم الشرفه العالمي — Starting');

    // First-run bootstrap: create .env and set secrets ONCE (frozen after).
    // Professional rule: JWT secrets are generated once and never rotated
    // silently on every boot (old code invalidated all sessions/QR on restart).
    if (!lib.ensureEnvFile()) {
        log.error('تعذر تهيئة ملف البيئة؛ لا يمكن تشغيل النظام بأمان');
        process.exit(1);
    }
    lib.setupEnvSecrets();
    // reload
    try { require('dotenv').config({ path: lib.ENV_FILE, override: false }); } catch (_) {}

    // Show network info — proto must match backend/server.js: HTTPS only when BOTH cert files exist
    const localIp = getLocalIp();
    const port = getEnv('PORT', '5000');
    const sslKey = getEnv('SSL_KEY', '');
    const sslCert = getEnv('SSL_CERT', '');
    const sslOn = Boolean(sslKey && sslCert && fs.existsSync(sslKey) && fs.existsSync(sslCert));
    const proto = sslOn ? 'https' : 'http';
    const localUrl = `${proto}://localhost:${port}/app/index.html`;
    const networkUrl = `${proto}://${localIp}:${port}/app/index.html`;

    log.plain('  روابط الاتصال:');
    log.plain(`    محلي:  ${localUrl}`);
    log.plain(`    شبكة:  ${networkUrl}`);
    log.plain('');

    // 1. Check if backend already running (with proper HTTPS support)
    if (await checkBackendRunning()) {
        log.plain('');
        log.warn('النظام يعمل بالفعل — افتح المتصفح على الرابط أعلاه');
        openBrowser(localUrl);
        // Keep process alive
        process.on('SIGINT', () => process.exit(0));
        process.on('SIGTERM', () => process.exit(0));
        return;
    }

    // Check for port conflict: port in use but health check failed
    const portInUse = await isPortInUse(port);
    if (portInUse) {
        log.warn(`المنفذ ${port} مستخدم من قبل عملية أخرى`);
        log.warn('حاول إيقاف الخدمة الحالية أولاً:');
        log.warn('  - Windows Services: services.msc ← إيقاف "Karim ERP Server"');
        log.warn('  - Or use: node scripts/stop.js');
        log.warn('  - أو غيّر المنفذ في .env: PORT=5001');
        log.warn('  - ثم أعد التشغيل');
    }

    // 2. Ensure PG running
    if (!await ensurePgRunning()) {
        log.error('تعذر تشغيل PostgreSQL — لا يمكن المتابعة');
        log.error('جرب: node scripts/setup.js');
        process.exit(1);
    }

    // 3. Apply migrations and password hardening before starting the API.
    if (!runBootstrapDatabaseTasks()) {process.exit(1);}

    // 4. Start backend
    if (!startBackend()) {
        process.exit(1);
    }

    // 5. Wait for backend to be ready
    log.step('انتظار جاهزية الخادم...');
    let ready = false;
    for (let i = 0; i < 30; i++) {
        await new Promise(r => setTimeout(r, 1000));
        try {
            const health = await httpReq('GET', '/api/health');
            if (health.status === 200) {
                ready = true;
                break;
            }
        } catch (_) {
            // Not ready yet, continue waiting
        }
    }

    if (!ready) {
        log.warn('الخادم لم يصبح جاهزاً خلال 30 ثانية — تحقق من السجل');
    } else {
        log.ok('الخادم جاهز');
    }

    // 6. Open browser
    openBrowser(localUrl);

    log.plain('');
    log.ok('النظام يعمل! اضغط Ctrl+C للإيقاف الآمن');
    log.plain('');

    // 7. Handle shutdown
    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
    log.error(`خطأ فادح: ${err.message}`);
    console.error(err.stack);
    process.exit(1);
});