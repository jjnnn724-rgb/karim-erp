#!/usr/bin/env node
/**
 * database/scripts/run-migration.js — Run pending migrations
 * ────────────────────────────────────────────────────────────────────────────
 * Usage:
 *   node database/scripts/run-migration.js                    # all pending
 *   node database/scripts/run-migration.js 003_cashier.sql    # specific file
 */
const lib = require('../../scripts/shared');
// Ensure we are in the project root
process.chdir(lib.ROOT);
const { log, MIGRATIONS_DIR, MIGRATION_LOCK, DATA_DIR, getEnv, psqlFile, shouldApplyMigration, isDemoMigration, isDemoMode } = lib;
const fs = require('fs');
const path = require('path');

function main() {
    log.header('PostgreSQL — Migrations');

    if (!fs.existsSync(MIGRATIONS_DIR)) {
        log.error(`مجلد migrations غير موجود: ${MIGRATIONS_DIR}`);
        process.exit(1);
    }

    const dbName = getEnv('DB_NAME', 'karim_erp');
    const targetFile = process.argv[2];

    let pending;
    if (targetFile) {
        pending = [path.basename(targetFile)];
    } else {
        const all = fs.readdirSync(MIGRATIONS_DIR).filter(f => f.endsWith('.sql')).sort();
        let applied = [];
        if (fs.existsSync(MIGRATION_LOCK)) {
            try { applied = JSON.parse(fs.readFileSync(MIGRATION_LOCK, 'utf-8')); } catch (_) {}
        }
        pending = all.filter(f => !applied.includes(f) && shouldApplyMigration(f));
        const skippedDemo = all.filter(f => !applied.includes(f) && !shouldApplyMigration(f));
        skippedDemo.forEach(f => log.info(`تخطي بيانات الديمو في الإنتاج: ${f}`));
    }

    if (pending.length === 0) {
        log.ok('لا migrations بانتظار التطبيق');
        return;
    }

    log.info(`${pending.length} migration بانتظار التطبيق`);

    let applied = [];
    if (fs.existsSync(MIGRATION_LOCK)) {
        try { applied = JSON.parse(fs.readFileSync(MIGRATION_LOCK, 'utf-8')); } catch (_) {}
    }

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

        const errors = (result.stderr || '').split('\n').filter(l => l.includes('ERROR')).slice(0, 3);
        if (result.status === 0 || errors.length === 0 || errors.every(e => e.includes('already exists'))) {
            if (!applied.includes(file)) applied.push(file);
            try { fs.mkdirSync(path.dirname(MIGRATION_LOCK), { recursive: true }); } catch (_) {}
            fs.writeFileSync(MIGRATION_LOCK, JSON.stringify(applied, null, 2), 'utf-8');
            log.ok(`✓ ${file}`);
            success++;
        } else {
            log.warn(`✗ ${file}`);
            for (const e of errors) log.warn(`    ${e}`);
            // Do not mark failed migrations as applied; retry after the cause is fixed.
            failed++;
        }
    }

    log.plain('');
    log.ok(`نجح: ${success} | فشل: ${failed}`);
    process.exit(failed > 0 ? 1 : 0);
}

main();
