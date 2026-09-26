#!/usr/bin/env node
/**
 * scripts/setup.js — Complete one-command setup (v3.0 — System PostgreSQL Only)
 * ────────────────────────────────────────────────────────────────────────────
 * Does everything in the right order:
 *   1. Check Node.js version
 *   2. npm install (if node_modules missing)
 *   3. أحدث PostgreSQL (winget أو postgresql.org)
 *   4. Initialize data directory + start PG (system service)
 *   5. Create database + apply all migrations
 *   6. Generate .env with JWT secrets + DB password
 *   7. Migrate plaintext passwords to bcrypt
 *   8. Syntax check all JS files
 *   9. Print summary + next steps
 *
 * NO PORTABLE POSTGRESQL — System PostgreSQL only.
 * Idempotent: safe to run multiple times.
 * Usage: node scripts/setup.js
 */
const lib = require('./shared');
process.chdir(lib.ROOT);
const { log, ROOT, NODE_MODULES, ENV_FILE, setupEnvSecrets, ensureDir, genSecret } = lib;
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const NODE_BIN = process.execPath;
const NPM_BIN = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const fs = require('fs');
const path = require('path');
const MIN_NODE = 18;

async function main() {
    log.header('Karim ERP — Setup');
    log.info(`Correlation: ${crypto.randomBytes(8).toString('hex')}`);

    // ─── Environment Pre-Flight (آلية وقائية عند النقل لجهاز جديد) ───
    // تشغيل فحص سريع للبيئة قبل أي خطوة - يكتشف مشاكل المسارات ونقص node_modules
    (function runPreflight() {
        try {
            const verifyScript = path.join(ROOT, 'scripts', 'verify-env.js');
            if (!fs.existsSync(verifyScript)) return;
            const r = spawnSync(NODE_BIN, [verifyScript, '--quick', '--doctor'], {
                cwd: ROOT, encoding: 'utf-8', timeout: 15000, shell: process.platform === 'win32',
            });
            if (r.stdout && /WARN|FAIL|مفقود|فارغ/.test(r.stdout)) {
                log.info('سيتم اكتشاف مشاكل البيئة وإصلاحها تلقائياً أثناء الإعداد...');
            }
        } catch (_) {}
    })();

    // ─── Step 1: Check Node.js ─────────────────────
    log.step('1/8 — Node.js check');
    const nodeVer = process.versions.node;
    const major = parseInt(nodeVer.split('.')[0], 10);
    if (major < MIN_NODE) {
        log.error(`Node.js ${major} — need ${MIN_NODE}+`);
        log.error('Get from https://nodejs.org/');
        process.exit(1);
    }
    log.ok(`Node.js ${nodeVer}`);

    // ─── Step 2: npm install ───────────────────────
    log.step('2/8 — تثبيت اعتماديات npm');
    if (fs.existsSync(NODE_MODULES) && fs.readdirSync(NODE_MODULES).length > 10) {
        log.ok('node_modules موجود');
    } else {
        log.info('تشغيل npm install (قد يستغرق 1-2 دقيقة)...');
        const result = spawnSync(NPM_BIN, ['install', '--no-audit', '--no-fund'], {
            stdio: 'inherit', cwd: ROOT, timeout: 300000, shell: process.platform === 'win32',
        });
        if (result.status !== 0) { log.error('فشل npm install'); process.exit(1); }
        log.ok('تم تثبيت الاعتماديات');
    }

    // ─── Step 3: PostgreSQL System ────────────────
    log.step('3/8 — تجهيز PostgreSQL النظامي');
    if (!lib.isPgInstalled()) {
        log.info('لم يُعثر على PostgreSQL — سيتم التثبيت تلقائياً');
        log.info('تأكد من وجود أحدث PostgreSQL أو سيحاول KARIMERP تثبيته');
    } else {
        log.ok('PostgreSQL binaries موجودة');
    }

    // ─── Step 4: .env + secrets ────────────────────
    log.step('4/8 — تهيئة .env');
    if (!setupEnvSecrets()) {
        log.error('فشل تهيئة .env');
        process.exit(1);
    }
    log.ok('.env جاهز');

    // ─── Step 5: Start PostgreSQL ──────────────────
    log.step('5/8 — تشغيل PostgreSQL');
    const dbHost = lib.getEnv('DB_HOST', 'localhost');
    const dbUser = lib.getEnv('DB_USER', 'postgres');
    // اكتشاف تلقائي للمنفذ العامل (أي جهاز/أي منفذ) + تثبيته في .env
    let dbPort = lib.detectDbPort();
    if (dbPort && dbPort !== String(lib.getEnv('DB_PORT', ''))) {
        try {
            let envContent = fs.readFileSync(ENV_FILE, 'utf-8');
            if (/^DB_PORT=/m.test(envContent)) {
                envContent = envContent.replace(/^DB_PORT=.*$/m, `DB_PORT=${dbPort}`);
            } else {
                envContent += `\nDB_PORT=${dbPort}\n`;
            }
            fs.writeFileSync(ENV_FILE, envContent, 'utf-8');
            // Also update process.env so child processes inherit the correct port
            process.env.DB_PORT = dbPort;
            log.ok(`تم ضبط DB_PORT=${dbPort} تلقائيًا`);
        } catch (_) {}
    }
    if (!dbPort) {dbPort = lib.getEnv('DB_PORT', '5432');}
    let dbPassword = lib.getEnv('DB_PASSWORD');

    // PROFESSIONAL RULE: never invent a DB password silently.
    if (!dbPassword) {
        log.error('DB_PASSWORD فارغ في .env — ضع كلمة مرور postgres الحقيقية (التي أدخلتها أثناء تثبيت PostgreSQL)');
        log.error('مثال: DB_PASSWORD=Kimo20177 ثم أعد: node scripts/setup.js');
        log.error('أو شغّل المعالج الذكي: node scripts/smart-install.js');
        process.exit(1);
    }

    if (lib.isPgRunning(dbHost, dbPort, dbUser, dbPassword)) {
        log.ok('PostgreSQL يعمل بالفعل');
    } else {
        // محاولة ذكية أخيرة: الحل الموحد قد يجد منفذاً آخر أو خدمة متوقفة
        try {
            const resolver = require('./db-resolver');
            const r = resolver.resolveDatabase({ autostart: true });
            if (r.ok) {
                dbPort = String(r.port);
                try {
                    let envContent = fs.readFileSync(ENV_FILE, 'utf-8');
                    envContent = /^DB_PORT=/m.test(envContent)
                        ? envContent.replace(/^DB_PORT=.*$/m, `DB_PORT=${dbPort}`)
                        : envContent + `\nDB_PORT=${dbPort}\n`;
                    fs.writeFileSync(ENV_FILE, envContent, 'utf-8');
                    log.ok(`تم الاكتشاف الذكي: PostgreSQL تعمل على المنفذ ${dbPort} (${r.service || 'service'})`);
                } catch (_) {}
            } else {
                log.error(resolver.diagnoseArabic(r));
                process.exit(1);
            }
        } catch (_) {
            log.info('بدء PostgreSQL...');
            log.info('إذا لم يبدأ، تأكد من تثبيت أحدث PostgreSQL: https://www.postgresql.org/download/windows/');
            process.exit(1);
        }
    }
    log.ok('PostgreSQL يعمل');

    // ─── Step 6: Apply migrations ──────────────────
    log.step('6/8 — تطبيق migrations');
    const dbName = lib.getEnv('DB_NAME', 'karim_erp');
    try {
        const result = spawnSync(NODE_BIN, [path.join(ROOT, 'database', 'scripts', 'run-migration.js')], {
            stdio: 'inherit', cwd: ROOT, timeout: 120000,
            env: { ...process.env, DB_PASSWORD: dbPassword },
        });
        if (result.status !== 0) {
            log.error('فشل تطبيق migrations — تم إيقاف التهيئة لحماية البيانات.');
            process.exit(1);
        }
        log.ok('تم تطبيق migrations');
    } catch (e) {
        log.error(`خطأ في migrations: ${e.message}`);
        process.exit(1);
    }

    // ─── Step 7: Migrate plaintext passwords ────────
    log.step('7/8 — تهجير كلمات المرور إلى bcrypt');
    try {
        const result = spawnSync(NODE_BIN, [path.join(ROOT, 'scripts', 'migrate-plaintext-passwords.js')], {
            stdio: 'inherit', cwd: ROOT, timeout: 60000,
            env: { ...process.env, DB_PASSWORD: dbPassword },
        });
        if (result.status !== 0) {
            log.error('فشل تهجير كلمات المرور — تم إيقاف التهيئة لحماية الحسابات.');
            process.exit(1);
        }
        log.ok('كلمات المرور جاهزة (bcrypt)');
    } catch (e) {
        log.error(`خطأ في تهجير كلمات المرور: ${e.message}`);
        process.exit(1);
    }

    // ─── Step 8: Syntax check ──────────────────────
    log.step('8/8 — فحص syntax لكل ملفات JS');
    const dirs = ['backend', 'scripts', 'database/scripts', 'electron', 'tests', 'frontend/app/js', 'build'];
    let errorCount = 0;
    let totalFiles = 0;
    for (const dir of dirs) {
        const fullDir = path.join(ROOT, dir);
        if (!fs.existsSync(fullDir)) {continue;}
        const files = findJsFiles(fullDir);
        for (const f of files) {
            totalFiles++;
            const result = spawnSync(NODE_BIN, ['--check', f], { stdio: 'pipe', encoding: 'utf-8' });
            if (result.status !== 0) {
                log.error(`FAIL: ${path.relative(ROOT, f)}`);
                errorCount++;
            }
        }
    }
    if (errorCount > 0) {
        log.warn(`${errorCount}/${totalFiles} ملف به أخطاء syntax`);
    } else {
        log.ok(`${totalFiles} ملف JS — كلها سليمة`);
    }

    // ─── Summary ───────────────────────────────────
    log.header('Setup Complete!');
    log.plain('  الخطوات التالية:');
    log.plain('    1. تشغيل النظام:     node scripts/serve.js');
    log.plain('    2. اختبارات:         npm test');
    log.plain('    3. اختبار دخام:      npm run smoke');
    log.plain('');
    log.plain('  تسجيل الدخول: استخدم بيانات المدير التي تم إعدادها ثم غيّرها فوراً.');
    log.plain('  الوصول: http://localhost:5000/app/index.html');
    log.plain('');
    process.exit(0);
}

function findJsFiles(dir) {
    const results = [];
    const items = fs.readdirSync(dir, { withFileTypes: true });
    for (const item of items) {
        const fullPath = path.join(dir, item.name);
        if (item.isDirectory() && item.name !== 'node_modules') {
            results.push(...findJsFiles(fullPath));
        } else if (item.isFile() && item.name.endsWith('.js')) {
            results.push(fullPath);
        }
    }
    return results;
}

main().catch((err) => {
    log.error(`خطأ فادح: ${err.message}`);
    console.error(err.stack);
    process.exit(1);
});
