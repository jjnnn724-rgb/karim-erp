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
  fs.writeFileSync(
    path.join(backupDir, 'daily-backup-status.json'),
    JSON.stringify(
      {
        timestamp: new Date().toISOString(),
        ...payload,
      },
      null,
      2
    ),
    'utf8'
  );
}

function secureBackupDirectory(backupDir) {
  if (!lib.IS_WIN) return;
  try {
    // H-3 (تدقيق 2026-10-23): إزالة منح Users العام (M) — بلا إعادة ضبط كاملة
    // (/inheritance:r) حتى لا تُمحى منحة حساب مهمة النسخ (DELL) المطبقة لمرة
    // واحدة. المهمة المجدولة تعمل بحساب DELL التفاعلي.
    const runAs = String(process.env.USERNAME || '').trim();
    const grants = ['Administrators:(OI)(CI)F', 'SYSTEM:(OI)(CI)F'];
    if (runAs && !/^(SYSTEM|ADMINISTRATOR)$/i.test(runAs)) {
      grants.push(`${runAs}:(OI)(CI)M`);
    }
    spawnSync('icacls', [backupDir, '/remove:g', 'BUILTIN\\Users', '/grant:r', ...grants], {
      stdio: 'ignore',
      windowsHide: true,
    });
  } catch (_) {
    log.warn('تعذر ضبط ACL لمجلد النسخ؛ راجع صلاحيات ProgramData يدويًا.');
  }
}

const { stripVersionSpecificStatements } = require('./sanitize-sql');

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
      const freeMB =
        (fs.statfsSync(path.dirname(path.resolve(outputFile))).bfree *
          fs.statfsSync(path.dirname(path.resolve(outputFile))).bsize) /
        1048576;
      if (freeMB < 500)
        throw new Error(`مساحة القرص الحرة ${freeMB.toFixed(0)}MB أقل من 500MB — أفرغ مساحة ثم أعد المحاولة`);
    }
  } catch (e) {
    if (e.message.includes('مساحة القرص')) throw e;
  }

  log.info(`قاعدة البيانات: ${dbName}`);
  log.info(`الملف: ${outputFile}`);

  // On Linux: set LD_LIBRARY_PATH
  const env = { ...process.env, PGPASSWORD: dbPassword };
  const pgBinDir = (() => {
    try {
      return path.dirname(pgDump || '');
    } catch (_) {
      return '';
    }
  })();
  const libDir = pgBinDir ? path.join(pgBinDir, 'lib') : '';
  if (fs.existsSync(libDir) && !lib.IS_WIN) {
    env.LD_LIBRARY_PATH = (env.LD_LIBRARY_PATH || '') + ':' + libDir;
  }

  const result = spawnSync(
    pgDump,
    ['-h', dbHost, '-p', dbPort, '-U', dbUser, '-d', dbName, '-F', 'p', '-f', `${outputFile}.partial`],
    { stdio: 'inherit', env, timeout: 300000 }
  );

  if (result.status !== 0) {
    try {
      fs.unlinkSync(`${outputFile}.partial`);
    } catch (_) {}
    throw new Error('فشل النسخ الاحتياطي');
  }
  // لا نص صريح على القرص إلا أثناء النسخ: يُكتب في .partial ثم يُعاد تسميته
  try {
    fs.renameSync(`${outputFile}.partial`, outputFile);
  } catch (e) {
    try {
      fs.unlinkSync(`${outputFile}.partial`);
    } catch (_) {}
    throw new Error(`تعذر اعتماد ملف النسخة: ${e.message}`);
  }

  // ─── Portability guard ──────────────────────────────────────────────
  // pg_dump from a newer major (17.x) emits `SET transaction_timeout = 0;`
  // which older servers (e.g. the bundled PostgreSQL 16.4) REJECT at
  // restore time with "unrecognized configuration parameter". A backup
  // that its own pipeline cannot restore is not a backup — strip
  // version-specific statements so the dump stays portable to the
  // exact server version deployed here.
  try {
    const { stripped } = stripVersionSpecificStatements(outputFile);
    if (stripped) {
      log.info(
        `تم تعقيم النسخة: حُذفت ${stripped} عبارة خاصة بإصدار أحدث (transaction_timeout) لضمان قابلية الاسترجاع`
      );
    }
  } catch (e) {
    // فشل حقيقي لا تحذير: الاسترجاع يعمل بـ ON_ERROR_STOP=1 (restore.js)،
    // فعبارة واحدة غير معروفة تُسقط الاسترجاع كله. والمتابعة كانت تعني
    // تشفير النسخة ثم حذف النص الصريح — أي إتلاف النسخة الوحيدة القابلة
    // للإصلاح. النص الصريح يبقى على القرص ويمكن تعقيمه يدويًا.
    throw new Error(`تعذر تعقيم النسخة من عبارات الإصدار الأحدث — أُوقف الحفظ والنسخة الصريحة باقية: ${e.message}`);
  }

  const size = fs.statSync(outputFile).size;
  if (!size) throw new Error('تم إنشاء ملف نسخة احتياطية فارغ؛ أُوقف الحفظ');
  const { sha256File } = require('../../scripts/backup-mirror');
  const digest = sha256File(outputFile);
  fs.writeFileSync(`${outputFile}.sha256`, `${digest}  ${path.basename(outputFile)}\n`, 'utf8');
  const sizeStr = size < 1048576 ? `${(size / 1024).toFixed(1)}KB` : `${(size / 1048576).toFixed(1)}MB`;
  log.ok(`تم النسخ الاحتياطي: ${sizeStr}`);
  log.info(`SHA-256: ${digest}`);

  // ─── مرايا خارجية D/E مشفرة فقط (HARDENED 2026-10-07) ───
  // best-effort: فشل المرايا لا يُفشل النسخة الأساسية.
  let offsite = { ok: false, errors: [] };
  let encryptedFile = null;
  try {
    const { encryptBackupFile, mirrorFile } = require('../../scripts/backup-mirror');
    encryptedFile = encryptBackupFile(outputFile);
    const m = mirrorFile(encryptedFile, 'full');
    offsite = { ok: m.ok, errors: m.errors };
    if (m.mirrored.length) log.ok(`مرايا خارجية: ${m.mirrored.length} نسخة`);
    m.errors.slice(0, 2).forEach(e => log.warn(`مرايا: ${e}`));
  } catch (e) {
    offsite = { ok: false, errors: [e.message] };
    log.warn(`تعذر المرايا الخارجية (غير قاتل): ${e.message}`);
  }

  // ─── لا نص صريح على القرص: يُحذف بعد نجاح التشفير فقط ───
  // فشل التشفير ⇒ يبقى النص الصريح (لا تُفقد بيانات ولا يُحذف بلا بديل).
  let plaintextRemoved = false;
  if (encryptedFile && fs.existsSync(encryptedFile) && fs.statSync(encryptedFile).size > 0) {
    try {
      fs.unlinkSync(outputFile);
      plaintextRemoved = true;
      log.ok(`حُذفت النسخة الصريحة من القرص (المشفّرة: ${path.basename(encryptedFile)})`);
    } catch (e) {
      log.warn(`تعذر حذف النسخة الصريحة (${outputFile}): ${e.message}`);
    }
  } else {
    log.warn('لم يكتمل التشفير — النسخة الصريحة باقية على القرص (لا تُحذف بلا بديل)');
  }

  // Clean old backups (keep last N) — في مجلد ملف الإخراج نفسه، والفشل هنا
  // غير قاتل (النسخة نفسها سليمة وموقعة).
  let retained = 1;
  try {
    const { collectBackupGroups, pruneBackupGroups, sqlBase } = require('../../scripts/backup-retention');
    const scanDir = path.dirname(path.resolve(outputFile));
    const groups = collectBackupGroups(scanDir, sqlBase);
    retained = Math.min(groups.length, retention);
    if (groups.length > retention) {
      const removed = pruneBackupGroups(scanDir, groups, retention);
      log.info(`تم حذف ${removed.length} نسخة قديمة`);
    }
  } catch (e) {
    log.warn(`تعذر تنظيف النسخ القديمة (غير قاتل): ${e.message}`);
  }
  const statusPayload = {
    ok: true,
    file: path.basename(outputFile),
    encrypted: encryptedFile ? path.basename(encryptedFile) : null,
    plaintextRemoved,
    bytes: size,
    sha256: digest,
    retained,
    offsite,
  };
  try {
    writeStatus(backupDir, statusPayload);
  } catch (_) {
    try {
      writeStatus(path.dirname(path.resolve(outputFile)), statusPayload);
    } catch (_) {
      log.warn('تعذر كتابة ملف الحالة (غير قاتل)');
    }
  }
  return { outputFile, size, digest };
}

try {
  main();
} catch (error) {
  const backupDir = path.resolve(process.env.KARIM_BACKUP_DIR || BACKUPS_DIR);
  try {
    lib.ensureDir(backupDir);
    writeStatus(backupDir, { ok: false, error: error.message });
  } catch (_) {}
  log.error(error.message);
  process.exit(1);
}
