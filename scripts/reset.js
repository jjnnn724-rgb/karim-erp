#!/usr/bin/env node
/**
 * scripts/reset.js — Reset database (DESTRUCTIVE)
 * ────────────────────────────────────────────────────────────────────────────
 * Stops PG → deletes data dir → re-initializes → applies migrations
 * Usage: node scripts/reset.js [--force]
 */
const lib = require('./shared');
// Ensure we are in the project root
process.chdir(lib.ROOT);
const { log, DATA_DIR, MIGRATION_LOCK, getEnv } = lib;
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

async function main() {
    log.header('Karim ERP — Reset Database');

    // Confirm
    const force = process.argv.includes('--force') || process.argv.includes('-y');
    if (!force) {
        log.warn('⚠️  سيتم حذف كل البيانات وإعادة إنشاء قاعدة البيانات');
        log.warn('   هذه العملية لا يمكن التراجع عنها!');
        log.plain('');
        process.stdout.write('هل أنت متأكد؟ اكتب "RESET" للتأكيد: ');
        const answer = await new Promise(resolve => {
            process.stdin.setEncoding('utf-8');
            process.stdin.once('data', (data) => resolve(data.trim()));
        });
        if (answer !== 'RESET') {
            log.warn('تم الإلغاء');
            process.exit(0);
        }
    }

    // 1. Stop PG
    log.step('1/4 — إيقاف PostgreSQL');
    const stopScript = path.join(__dirname, '..', 'database', 'scripts', 'stop-pg.js');
    if (fs.existsSync(stopScript)) {
        spawnSync(process.execPath, [stopScript], { stdio: 'inherit', timeout: 30000 });
    }

    // 2. Delete data directory
    log.step('2/4 — حذف مجلد البيانات');
    if (fs.existsSync(DATA_DIR)) {
        fs.rmSync(DATA_DIR, { recursive: true, force: true });
        log.ok('تم الحذف');
    } else {
        log.ok('المجلد غير موجود');
    }
    if (fs.existsSync(MIGRATION_LOCK)) {
        fs.unlinkSync(MIGRATION_LOCK);
    }

    // 3. Re-initialize + start PG + apply migrations
    log.step('3/4 — إعادة التهيئة');
    const result = spawnSync(process.execPath, [path.join(__dirname, 'setup.js')], {
        stdio: 'inherit', cwd: lib.ROOT, timeout: 300000,
        env: { ...process.env, DB_PASSWORD: getEnv('DB_PASSWORD') },
    });

    if (result.status !== 0) {
        log.error('فشل إعادة التهيئة');
        process.exit(1);
    }

    log.ok('تمت إعادة التعيين بنجاح');
    log.plain('');
    log.plain('  استخدم بيانات المدير التي تم إعدادها، ثم غيّر كلمة المرور الافتراضية قبل التشغيل الفعلي.');
    process.exit(0);
}

main().catch((err) => {
    log.error(`خطأ: ${err.message}`);
    process.exit(1);
});
