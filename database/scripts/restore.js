#!/usr/bin/env node
/**
 * database/scripts/restore.js — Restore database from backup (psql)
 * ────────────────────────────────────────────────────────────────────────────
 * Usage:
 *   node database/scripts/restore.js <backup_file.sql> [--target-db NAME] [--yes] [--drop]
 *
 * أوضاع التشغيل:
 *   1) عادي (بلا --drop): استعادة داخل قاعدة موجودة. فوق قاعدة الإنتاج تتطلب --yes.
 *   2) --drop: استعادة نظيفة — DROP DATABASE ثم CREATE ثم الاستعادة.
 *      اشتراطات إلزامية (عقد أمان):
 *        • --confirm-drop=<اسم-القاعدة> — يجب أن يطابق اسم القاعدة حرفيًا
 *          (كتابة الاسم = نية صريحة، الـ --yes وحدها لا تكفي).
 *        • نسخة احتياطية pre-restore- تلقائية (pg_dump) قبل أي DROP —
 *          فالاستعادة الفاشلة تبقى قابلة للاسترجاع.
 * أمان عام: تحقق SHA-256 من ملف بصمة عند وجوده قبل لمس أي شيء.
 */
const lib = require('../../scripts/shared');
process.chdir(lib.ROOT);
const { log, getEnv, getPgBinary } = lib;
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function main() {
    const argv = process.argv.slice(2);
    const args = argv.filter(a => !a.startsWith('--'));
    const flags = new Set(argv.filter(a => a.startsWith('--') && !a.includes('=')));
    const file = args[0];
    if (!file || !fs.existsSync(file)) {
        throw new Error('حدد ملف نسخة موجودًا: node database/scripts/restore.js <file.sql> [--target-db NAME] [--yes] [--drop]');
    }
    let targetDb = getEnv('DB_NAME', 'karim_erp');
    const ti = argv.indexOf('--target-db');
    if (ti >= 0 && argv[ti + 1]) targetDb = argv[ti + 1];
    const isProd = targetDb === getEnv('DB_NAME', 'karim_erp');
    const dropMode = flags.has('--drop');

    // تأكيد مدمّر صريح ومطابق: --confirm-drop=<اسم-القاعدة> يجب أن يطابق حرفيًا
    const confirmArg = argv.find(a => a.startsWith('--confirm-drop='));
    if (dropMode) {
        const typed = confirmArg ? confirmArg.slice('--confirm-drop='.length).trim() : '';
        if (typed !== targetDb) {
            throw new Error(`تم رفض العملية: الاستعادة النظيفة (DROP) تتطلب --confirm-drop=${targetDb} مطابقًا لاسم القاعدة حرفيًا`);
        }
    } else if (isProd && !flags.has('--yes')) {
        throw new Error('الاستعادة فوق قاعدة الإنتاج تتطلب --yes (تأكيد صريح)');
    }

    // تحقق البصمة إن وُجدت — قبل أي كتابة
    const sidecar = `${file}.sha256`;
    if (fs.existsSync(sidecar)) {
        const [expected] = fs.readFileSync(sidecar, 'utf8').trim().split(/\s+/);
        const actual = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
        if (expected !== actual) throw new Error('بصمة SHA-256 غير متطابقة — الملف تالف أو عُبث به');
        log.ok('بصمة SHA-256 سليمة');
    } else {
        log.warn('لا يوجد ملف بصمة — متابعة بدون تحقق');
    }

    const psql = process.env.KARIM_PSQL_PATH || getPgBinary('psql');
    if (!psql) throw new Error('psql binary not found');
    const pgDumpBin = process.env.KARIM_PG_DUMP_PATH || getPgBinary('pg_dump');
    const env = { ...process.env, PGPASSWORD: getEnv('DB_PASSWORD') };
    const host = getEnv('DB_HOST', 'localhost');
    const port = getEnv('DB_PORT', '5432');
    const user = getEnv('DB_USER', 'postgres');

    // ── وضع الاستعادة النظيفة: نسخة pre-restore قبل أي DROP ──
    if (dropMode) {
        if (!pgDumpBin) throw new Error('pg_dump غير موجود — لا يمكن أخذ نسخة pre-restore؛ أُلغيت العملية');
        lib.ensureDir(lib.BACKUPS_DIR);
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        const preRestorePath = path.join(lib.BACKUPS_DIR, `pre-restore-${targetDb}-${stamp}.sql`);
        log.info(`أخذ نسخة pre-restore إلى: ${preRestorePath}`);
        const dump = spawnSync(pgDumpBin, [
            '-h', host, '-p', port, '-U', user, '-d', targetDb,
            '-f', preRestorePath,
        ], { stdio: 'inherit', env, timeout: 600000 });
        if (dump.status !== 0) throw new Error('فشل أخذ نسخة pre-restore — أُلغيت الاستعادة (لم يُلمس شيء)');
        log.ok('نسخة pre-restore جاهزة');

        log.info(`DROP DATABASE IF EXISTS ${targetDb} ثم إنشاؤها من جديد…`);
        const drop = spawnSync(psql, [
            '-h', host, '-p', port, '-U', user, '-d', 'postgres',
            '-v', 'ON_ERROR_STOP=1',
            '-c', `DROP DATABASE IF EXISTS "${targetDb}";`,
            '-c', `CREATE DATABASE "${targetDb}";`,
        ], { stdio: 'inherit', env, timeout: 120000 });
        if (drop.status !== 0) throw new Error('فشل DROP/CREATE — راجع الاتصال بصلاحية postgres');
    }

    log.info(`استعادة إلى قاعدة: ${targetDb}`);
    const result = spawnSync(psql, [
        '-h', host, '-p', port,
        '-U', user, '-d', targetDb,
        '-v', 'ON_ERROR_STOP=1', '-f', path.resolve(file),
    ], { stdio: 'inherit', env, timeout: 600000 });
    if (result.status !== 0) throw new Error('فشلت الاستعادة');
    log.ok('تمت الاستعادة بنجاح');
}

try { main(); }
catch (error) { log.error(error.message); process.exit(1); }
