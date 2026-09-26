#!/usr/bin/env node
/**
 * database/scripts/backup.js — Create database backup (pg_dump)
 * Usage: node database/scripts/backup.js [output_file]
 */
const lib = require('../../scripts/shared');
// Ensure we are in the project root
process.chdir(lib.ROOT);
const { log, BACKUPS_DIR, getEnv, getPgBinary } = lib;
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function writeStatus(backupDir, payload) {
    fs.writeFileSync(path.join(backupDir, 'daily-backup-status.json'), JSON.stringify({
        timestamp: new Date().toISOString(),
        ...payload,
    }, null, 2), 'utf8');
}

function secureBackupDirectory(backupDir) {
    if (!lib.IS_WIN) return;
    try {
        // Admins/SYSTEM كامل + Users تعديل (بدونه النسخ اللاحقة تفشل بصلاحيات عادية)
        spawnSync('icacls', [backupDir, '/inheritance:r', '/grant:r', 'Administrators:(OI)(CI)F', 'SYSTEM:(OI)(CI)F', 'BUILTIN\\Users:(OI)(CI)M'], { stdio: 'ignore', windowsHide: true });
    } catch (_) {
        log.warn('تعذر ضبط ACL لمجلد النسخ؛ راجع صلاحيات ProgramData يدويًا.');
    }
}

function main() {
    log.header('PostgreSQL — Backup');

    const backupDir = path.resolve(process.env.KARIM_BACKUP_DIR || BACKUPS_DIR);
    const retention = Math.max(7, Math.min(365, Number(process.env.KARIM_BACKUP_RETENTION || 30)) || 30);
    const pgDump = process.env.KARIM_PG_DUMP_PATH || getPgBinary('pg_dump');
    if (!pgDump) {
        throw new Error('pg_dump binary not found');
    }

    lib.ensureDir(backupDir);
    secureBackupDirectory(backupDir);

    const dbHost = getEnv('DB_HOST', 'localhost');
    const dbPort = getEnv('DB_PORT', '5432');
    const dbUser = getEnv('DB_USER', 'postgres');
    const dbName = getEnv('DB_NAME', 'karim_erp');
    const dbPassword = getEnv('DB_PASSWORD');

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const outputFile = process.argv[2] || path.join(backupDir, `karim-${dbName}-${timestamp}.sql`);
    lib.ensureDir(path.dirname(path.resolve(outputFile)));
    // حارس مساحة القرص: لا نسخ والمتبقي أقل من 500MB (نسخة ناقصة أسوأ من لا نسخة)
    try {
        if (typeof fs.statfsSync === 'function') {
            const freeMB = fs.statfsSync(path.dirname(path.resolve(outputFile))).bfree * fs.statfsSync(path.dirname(path.resolve(outputFile))).bsize / 1048576;
            if (freeMB < 500) throw new Error(`مساحة القرص الحرة ${freeMB.toFixed(0)}MB أقل من 500MB — أفرغ مساحة ثم أعد المحاولة`);
        }
    } catch (e) {
        if (e.message.includes('مساحة القرص')) throw e;
    }

    log.info(`قاعدة البيانات: ${dbName}`);
    log.info(`الملف: ${outputFile}`);

    // On Linux: set LD_LIBRARY_PATH
    const env = { ...process.env, PGPASSWORD: dbPassword };
    const pgBinDir = (() => { try { return path.dirname(pgDump || ''); } catch (_) { return ''; } })();
    const libDir = pgBinDir ? path.join(pgBinDir, 'lib') : '';
    if (fs.existsSync(libDir) && !lib.IS_WIN) {
        env.LD_LIBRARY_PATH = (env.LD_LIBRARY_PATH || '') + ':' + libDir;
    }

    const result = spawnSync(pgDump, [
        '-h', dbHost, '-p', dbPort, '-U', dbUser,
        '-d', dbName, '-F', 'p', '-f', outputFile,
    ], { stdio: 'inherit', env, timeout: 300000 });

    if (result.status !== 0) {
        throw new Error('فشل النسخ الاحتياطي');
    }

    // ─── Portability guard ──────────────────────────────────────────────
    // pg_dump from a newer major (17.x) emits `SET transaction_timeout = 0;`
    // which older servers (e.g. the bundled PostgreSQL 16.4) REJECT at
    // restore time with "unrecognized configuration parameter". A backup
    // that its own pipeline cannot restore is not a backup — strip
    // version-specific statements so the dump stays portable to the
    // exact server version deployed here.
    try {
        const raw = fs.readFileSync(outputFile, 'utf8');
        const sanitized = raw
            .split('\n')
            .filter(line => !/^SET transaction_timeout\b/.test(line))
            .join('\n');
        if (sanitized !== raw) {
            fs.writeFileSync(outputFile, sanitized, 'utf8');
            log.info('تم تعقيم النسخة من عبارات خاصة بإصدار أحدث (transaction_timeout) لضمان قابلية الاسترجاع');
        }
    } catch (e) {
        log.warn(`تعذر تعقيم ملف النسخة (متابعة كما هو): ${e.message}`);
    }

    const size = fs.statSync(outputFile).size;
    if (!size) throw new Error('تم إنشاء ملف نسخة احتياطية فارغ؛ أُوقف الحفظ');
    const digest = crypto.createHash('sha256').update(fs.readFileSync(outputFile)).digest('hex');
    fs.writeFileSync(`${outputFile}.sha256`, `${digest}  ${path.basename(outputFile)}\n`, 'utf8');
    const sizeStr = size < 1048576 ? `${(size/1024).toFixed(1)}KB` : `${(size/1048576).toFixed(1)}MB`;
    log.ok(`تم النسخ الاحتياطي: ${sizeStr}`);
    log.info(`SHA-256: ${digest}`);

    // Clean old backups (keep last N) — في مجلد ملف الإخراج نفسه، والفشل هنا
    // غير قاتل (النسخة نفسها سليمة وموقعة).
    let retained = 1;
    try {
        const scanDir = path.dirname(path.resolve(outputFile));
        const backups = fs.readdirSync(scanDir)
            .filter(f => f.endsWith('.sql'))
            .map(f => ({ name: f, path: path.join(scanDir, f), mtime: fs.statSync(path.join(scanDir, f)).mtime }))
            .sort((a, b) => b.mtime - a.mtime);
        retained = Math.min(backups.length, retention);
        if (backups.length > retention) {
            for (const old of backups.slice(retention)) {
                try { fs.unlinkSync(old.path); } catch (_) {}
                try { fs.unlinkSync(`${old.path}.sha256`); } catch (_) {}
            }
            log.info(`تم حذف ${backups.length - retention} نسخة قديمة`);
        }
    } catch (e) {
        log.warn(`تعذر تنظيف النسخ القديمة (غير قاتل): ${e.message}`);
    }
    const statusPayload = { ok: true, file: path.basename(outputFile), bytes: size, sha256: digest, retained };
    try {
        writeStatus(backupDir, statusPayload);
    } catch (_) {
        try { writeStatus(path.dirname(path.resolve(outputFile)), statusPayload); }
        catch (_) { log.warn('تعذر كتابة ملف الحالة (غير قاتل)'); }
    }
    return { outputFile, size, digest };
}

try {
    main();
} catch (error) {
    const backupDir = path.resolve(process.env.KARIM_BACKUP_DIR || BACKUPS_DIR);
    try { lib.ensureDir(backupDir); writeStatus(backupDir, { ok: false, error: error.message }); } catch (_) {}
    log.error(error.message);
    process.exit(1);
}
