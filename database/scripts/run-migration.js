#!/usr/bin/env node
/**
 * database/scripts/run-migration.js — Run pending migrations
 * ────────────────────────────────────────────────────────────────────────────
 * Usage:
 *   node database/scripts/run-migration.js                    # all pending
 *   node database/scripts/run-migration.js 003_cashier.sql    # specific file
 *   node database/scripts/run-migration.js --status            # read-only ledger check
 */
const lib = require('../../scripts/shared');
// Ensure we are in the project root
process.chdir(lib.ROOT);
const { log, MIGRATIONS_DIR, MIGRATION_LOCK, getEnv, psqlFile, shouldApplyMigration } = lib;
const fs = require('fs');
const path = require('path');
const {
    acquireMigrationLock,
    compareMigrationLedger,
    isMigrationApplied,
    normalizeMigrationVersions,
    readMigrationLedger,
} = require('./migration-lock');

// ─── FIX R5 (Enterprise 2026-10-03): التتبع المزدوج — ملف + جدول القاعدة ───
// كان التتبع في ملف .migrations_applied فقط (خارج القاعدة) — استرجاع نسخة
// على جهاز جديد يجعل المشغّل يظن كل شيء مطبقًا (دليل حي: drill 2026-10-03
// فاتت 092/093 بصمت). الآن: backfill للجدول من الملف عند كل تشغيل + تسجيل
// فوري في الجدول مع كل تطبيق (الملف يبقى للتوافق الخلفي).
async function main() {
    log.header('PostgreSQL — Migrations');

    if (!fs.existsSync(MIGRATIONS_DIR)) {
        log.error(`مجلد migrations غير موجود: ${MIGRATIONS_DIR}`);
        process.exitCode = 1;
        return;
    }

    const dbName = getEnv('DB_NAME', 'karim_erp');
    const migrationFiles = fs.readdirSync(MIGRATIONS_DIR)
        .filter((file) => file.endsWith('.sql'))
        .sort();
    if (process.argv[2] === '--status') {
        if (!String(process.env.DB_NAME || '').trim()) {
            log.error('فحص الحالة يتطلب DB_NAME صريحًا؛ لم يتم الاتصال بأي قاعدة.');
            process.exitCode = 2;
            return;
        }
        const appliedVersions = await readMigrationLedger({
            name: dbName,
            host: getEnv('DB_HOST', '127.0.0.1'),
            port: getEnv('DB_PORT', '5432'),
            user: getEnv('DB_USER', 'postgres'),
            password: getEnv('DB_PASSWORD', ''),
        });
        if (appliedVersions === null) {
            log.warn('جدول schema_migrations غير موجود؛ لم يُنشأ أي جدول ولم تُطبَّق ترحيلات.');
            log.warn('لا يمكن استنتاج حالة المخطط من غياب سجل الترحيلات وحده.');
            process.exitCode = 2;
            return;
        }

        const status = compareMigrationLedger(migrationFiles, appliedVersions);
        log.info(`ترحيلات مسجلة: ${status.applied.length}`);
        log.info(`ملفات غير مسجلة: ${status.pending.length}`);
        status.pending.forEach((file) => log.info(`غير مسجل: ${file}`));
        if (status.unknownApplied.length > 0) {
            log.warn(`إصدارات في السجل بلا ملفات ترحيل: ${status.unknownApplied.length}`);
            status.unknownApplied.forEach((version) => log.warn(`بلا ملف: ${version}`));
            process.exitCode = 1;
        }
        return;
    }

    let migrationLock;
    try {
        migrationLock = await acquireMigrationLock({
            name: dbName,
            host: getEnv('DB_HOST', '127.0.0.1'),
            port: getEnv('DB_PORT', '5432'),
            user: getEnv('DB_USER', 'postgres'),
            password: getEnv('DB_PASSWORD', ''),
        });
    } catch (error) {
        log.error(`تعذر حجز قفل الترحيلات: ${error.message}`);
        process.exitCode = 1;
        return;
    }

    try {
        await migrationLock.assertHealthy();
        await migrationLock.ensureLedger();

        // Backfill: keep the database migration table in sync with the legacy file.
        //
        // FIX (Enterprise 2026-10-21): القفل ملف واحد على مستوى المستودع بينما
        // القاعدة لكل بيئة — فكان هذا السطر يكتب في سجلّ هذه القاعدة كل
        // ترحيل في القفل، **دون أن يُنفَّذ SQL الخاص به في هذه القاعدة**.
        // النتيجة: ترحيل مُسجَّل كمنفَّذ بينما أثره غائب (اكتُشف على الإنتاج:
        // 104 مُسجَّل بينما أعمدته لم تُنشأ). القاعدة الآن:
        //   · سجلّ القاعدة الموجود = الحقيقة (لا backfill إطلاقًا).
        //   · السجلّ الفارغ + قاعدة فيها جداول = تثبيت ما سبق تطبيقه
        //     قبل وجود جدول السجل (حالة الاستعادة القديمة).
        //   · السجلّ الفارغ + قاعدة فارغة = قاعدة جديدة ⇒ تُطبَّق كل الترحيلات.
        const appliedBefore = await migrationLock.getAppliedMigrations();
        const userTables = await migrationLock.countUserTables();
        if (fs.existsSync(MIGRATION_LOCK) && appliedBefore.length === 0 && userTables > 0) {
            let fileApplied;
            try {
                fileApplied = JSON.parse(fs.readFileSync(MIGRATION_LOCK, 'utf-8'));
            } catch (error) {
                throw new Error(`Migration tracking file is invalid JSON: ${error.message}`, { cause: error });
            }
            if (!Array.isArray(fileApplied) || fileApplied.some((file) => typeof file !== 'string')) {
                throw new Error('Migration tracking file must contain an array of migration filenames.');
            }
            const knownApplied = normalizeMigrationVersions(fileApplied, migrationFiles);
            await migrationLock.recordAppliedMigrations(knownApplied);
            log.ok(`[R5] تثبيت سجلّ القاعدة من ملف القفل (${knownApplied.length} إدخالًا — قاعدة قائمة بلا سجل)`);
        } else if (appliedBefore.length > 0) {
            log.info(`[R5] سجلّ القاعدة هو المرجع (${appliedBefore.length} ترحيلًا) — لا تعديل من ملف القفل`);
        } else {
            log.info('[R5] قاعدة جديدة بلا سجل — ستُطبَّق كل الترحيلات');
        }
        await migrationLock.assertHealthy();
        let appliedFromDatabase = await migrationLock.getAppliedMigrations();
        const applied = [...new Set(appliedFromDatabase)];
        await migrationLock.assertHealthy();

        const targetFile = process.argv[2];

        let pending;
        if (targetFile) {
            pending = [path.basename(targetFile)].filter((file) => !isMigrationApplied(file, applied));
        } else {
            const all = migrationFiles.sort();
            pending = all.filter(f => !isMigrationApplied(f, applied) && shouldApplyMigration(f));
            const skippedDemo = all.filter(f => !isMigrationApplied(f, applied) && !shouldApplyMigration(f));
            skippedDemo.forEach(f => log.info(`تخطي بيانات الديمو في الإنتاج: ${f}`));
        }

        if (pending.length === 0) {
            log.ok('لا migrations بانتظار التطبيق');
            return;
        }

        log.info(`${pending.length} migration بانتظار التطبيق`);

        let success = 0;
        let failed = 0;

        for (const file of pending) {
            if (!shouldApplyMigration(file)) {
                log.info(`تخطي migration ديمو: ${file}`);
                continue;
            }
            const filepath = path.join(MIGRATIONS_DIR, file);
            if (!fs.existsSync(filepath)) {
                log.warn(`الملف غير موجود: ${file}`);
                failed++;
                continue;
            }

            log.info(`تطبيق: ${file}`);
            const result = psqlFile(filepath, dbName);
            await migrationLock.assertHealthy();

            const errors = (result.stderr || '').split('\n').filter(line => line.includes('ERROR')).slice(0, 3);
            if (result.status === 0) {
                await migrationLock.recordAppliedMigrations([file]);
                applied.push(file);
                appliedFromDatabase = [...new Set([...appliedFromDatabase, file])];
                await migrationLock.assertHealthy();
                fs.mkdirSync(path.dirname(MIGRATION_LOCK), { recursive: true });
                fs.writeFileSync(MIGRATION_LOCK, JSON.stringify(appliedFromDatabase, null, 2), 'utf-8');
                log.ok(`✓ ${file}`);
                success++;
            } else {
                log.warn(`✗ ${file}`);
                for (const errorLine of errors) {
                    log.warn(`    ${errorLine}`);
                }
                failed++;
            }
        }

        log.plain('');
        log.ok(`نجح: ${success} | فشل: ${failed}`);
        process.exitCode = failed > 0 ? 1 : 0;
    } finally {
        try {
            await migrationLock.release();
        } catch (error) {
            log.error(`تعذر تحرير قفل الترحيلات: ${error.message}`);
            process.exitCode = 1;
        }
    }
}

main().catch((error) => {
    log.error(`فشل مشغّل الترحيلات: ${error.message}`);
    process.exitCode = 1;
});
