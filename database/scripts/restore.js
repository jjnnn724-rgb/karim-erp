#!/usr/bin/env node
/**
 * database/scripts/restore.js — Restore database from SQL or custom-format backup
 * ────────────────────────────────────────────────────────────────────────────
 * Usage:
 *   node database/scripts/restore.js <backup_file.sql|backup_file.dump> [--target-db NAME] [--yes] [--drop]
 *   node database/scripts/restore.js <backup_file.sql.kbak|backup_file.dump.gpg> [--target-db NAME] [--yes] [--drop]
 *
 * أوضاع التشغيل:
 *   1) عادي (بلا --drop): استعادة داخل قاعدة موجودة. فوق قاعدة الإنتاج تتطلب --yes.
 *   2) --drop: استعادة نظيفة — DROP DATABASE ثم CREATE ثم الاستعادة.
 *      اشتراطات إلزامية (عقد أمان):
 *        • --confirm-drop=<اسم-القاعدة> — يجب أن يطابق اسم القاعدة حرفيًا
 *          (كتابة الاسم = نية صريحة، الـ --yes وحدها لا تكفي).
 *        • نسخة احتياطية pre-restore- تلقائية (pg_dump) قبل أي DROP —
 *          فالاستعادة الفاشلة تبقى قابلة للاسترجاع.
 *        • نسخة pre-restore تُشفَّر ويُحذف الملف الصريح فورًا (لا نص صريح على القرص).
 * الأرشيفات المشفّرة (.kbak/.gpg): يُتحقق من بصمة النص المشفَّر، ثم يُفكّ التشفير
 * إلى ملف مؤقّت، ثم تُتحقق بصمة النسخة الصريحة إن وُجدت، ثم تتم الاستعادة،
 * ويُحذف الملف المؤقّت في كل الأحوال (بما فيها الفشل).
 * أمان عام: تحقق SHA-256 من ملف بصمة عند وجوده قبل لمس أي شيء.
 */
const lib = require('../../scripts/shared');
process.chdir(lib.ROOT);
const { log, getEnv, getPgBinary } = lib;
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const ENCRYPTED_EXT = /\.(kbak|gpg)$/i;

function isCustomDump(file) {
    const descriptor = fs.openSync(file, 'r');
    const signature = Buffer.alloc(5);
    try {
        return fs.readSync(descriptor, signature, 0, signature.length, 0) === signature.length
            && signature.toString('ascii') === 'PGDMP';
    } finally {
        fs.closeSync(descriptor);
    }
}

/** تحقق SHA-256 من ملف مقابل بصمة مخزونة بجانبه. */
function verifyChecksum(file, sidecarPath, required) {
    if (!fs.existsSync(sidecarPath)) {
        if (required) {
            throw new Error(`ملف البصمة مفقود: ${path.basename(sidecarPath)} — لا يمكن التحقق من سلامة الأرشيف`);
        }
        log.warn('لا يوجد ملف بصمة — متابعة بدون تحقق');
        return false;
    }
    const [expected] = fs.readFileSync(sidecarPath, 'utf8').trim().split(/\s+/);
    const actual = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    if (expected !== actual) throw new Error('بصمة SHA-256 غير متطابقة — الملف تالف أو عُبث به');
    log.ok('بصمة SHA-256 سليمة');
    return true;
}

function main() {
    const argv = process.argv.slice(2);
    const args = argv.filter(a => !a.startsWith('--'));
    const flags = new Set(argv.filter(a => a.startsWith('--') && !a.includes('=')));
    const file = args[0];
    if (!file || !fs.existsSync(file)) {
        throw new Error('حدد ملف نسخة موجودًا بصيغة SQL أو PostgreSQL custom أو أرشيف مشفّر: node database/scripts/restore.js <file.sql|file.dump|file.sql.kbak|file.dump.gpg> [--target-db NAME] [--yes] [--drop]');
    }
    if (fs.statSync(file).size === 0) {
        throw new Error('ملف النسخة الاحتياطية فارغ؛ أُلغيت الاستعادة');
    }
    let targetDb = getEnv('DB_NAME', 'karim_erp');
    const ti = argv.indexOf('--target-db');
    if (ti >= 0 && argv[ti + 1]) targetDb = argv[ti + 1];
    if (!/^[A-Za-z0-9][A-Za-z0-9_$.-]{0,62}$/.test(targetDb)) {
        throw new Error('اسم قاعدة البيانات غير صالح؛ استخدم من 1 إلى 63 حرفًا/رقمًا أو _ $ . - ويجب أن يبدأ بحرف أو رقم');
    }
    const isProd = process.env.NODE_ENV === 'production'
        || targetDb === 'karim_erp'
        || targetDb === getEnv('DB_NAME', 'karim_erp');
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

    // ── الأرشيف المشفَّر: تحقق من النص المشفَّر ثم فك التشفير إلى ملف مؤقّت ──
    let restoreFile = file;
    let tempFile = null;
    try {
        if (ENCRYPTED_EXT.test(file)) {
            verifyChecksum(file, `${file}.sha256`, true);
            const { decryptBackupFile } = require('../../scripts/backup-mirror');
            tempFile = path.join(os.tmpdir(), `karim-restore-${Date.now()}-${process.pid}.tmp`);
            log.info('فك تشفير الأرشيف إلى ملف مؤقّت…');
            decryptBackupFile(file, tempFile);
            restoreFile = tempFile;
            // بصمة النسخة الصريحة (إن وُجدت) — تثبت أن فك التشفير أنتج النسخة الأصلية
            verifyChecksum(restoreFile, `${file.replace(/\.(kbak|gpg)$/i, '')}.sha256`, false);
        } else {
            verifyChecksum(file, `${file}.sha256`, false);
        }

        runRestore(restoreFile, targetDb, dropMode);
    } finally {
        if (tempFile) {
            try { fs.unlinkSync(tempFile); } catch (_) {}
            log.info('حُذف الملف المؤقّت بعد الاستعادة');
        }
    }
}

function runRestore(file, targetDb, dropMode) {
    const customDump = isCustomDump(file);
    const psql = process.env.KARIM_PSQL_PATH || getPgBinary('psql');
    if (!customDump && !psql) throw new Error('psql binary not found');
    const pgRestore = process.env.KARIM_PG_RESTORE_PATH || getPgBinary('pg_restore');
    if (customDump && !pgRestore) throw new Error('pg_restore binary not found');
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
        // لا نص صريح على القرص: تُشفَّر النسخة ثم يُحذف الملف الصريح
        try {
            const { encryptBackupFile } = require('../../scripts/backup-mirror');
            const encrypted = encryptBackupFile(preRestorePath);
            fs.unlinkSync(preRestorePath);
            log.ok(`نسخة pre-restore مشفّرة: ${path.basename(encrypted)} (حُذف الملف الصريح)`);
        } catch (e) {
            log.warn(`تعذر تشفير نسخة pre-restore (بقيت صريحة): ${e.message}`);
        }

        log.info(`DROP DATABASE IF EXISTS ${targetDb} ثم إنشاؤها من جديد…`);
        const drop = spawnSync(psql, [
            '-h', host, '-p', port, '-U', user, '-d', 'postgres',
            '-v', 'ON_ERROR_STOP=1',
            '-c', `DROP DATABASE IF EXISTS "${targetDb.replace(/"/g, '""')}";`,
            '-c', `CREATE DATABASE "${targetDb.replace(/"/g, '""')}";`,
        ], { stdio: 'inherit', env, timeout: 120000 });
        if (drop.status !== 0) throw new Error('فشل DROP/CREATE — راجع الاتصال بصلاحية postgres');
    }

    log.info(`استعادة إلى قاعدة: ${targetDb}`);
    const result = customDump
        ? spawnSync(pgRestore, [
            '--exit-on-error', '-h', host, '-p', port,
            '-U', user, '-d', targetDb, path.resolve(file),
        ], { stdio: 'inherit', env, timeout: 600000 })
        : spawnSync(psql, [
            '-h', host, '-p', port,
            '-U', user, '-d', targetDb,
            '-v', 'ON_ERROR_STOP=1', '-f', path.resolve(file),
        ], { stdio: 'inherit', env, timeout: 600000 });
    if (result.status !== 0) throw new Error('فشلت الاستعادة');
    log.ok('تمت الاستعادة بنجاح');
}

if (require.main === module) {
    try { main(); }
    catch (error) { log.error(error.message); process.exit(1); }
}

module.exports = { isCustomDump, verifyChecksum, ENCRYPTED_EXT };
