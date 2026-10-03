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

// ─── FIX R5 (Enterprise 2026-10-03): التتبع المزدوج — ملف + جدول القاعدة ───
// كان التتبع في ملف .migrations_applied فقط (خارج القاعدة) — استرجاع نسخة
// على جهاز جديد يجعل المشغّل يظن كل شيء مطبقًا (دليل حي: drill 2026-10-03
// فاتت 092/093 بصمت). الآن: backfill للجدول من الملف عند كل تشغيل + تسجيل
// فوري في الجدول مع كل تطبيق (الملف يبقى للتوافق الخلفي).
function recordAppliedInDb(dbName, files) {
    const list = (files || []).filter(Boolean);
    if (!list.length) { return true; }
    const values = list.map(f => `('${String(f).replace(/'/g, "''")}')`).join(', ');
    const sql = `INSERT INTO public.schema_migrations (version) VALUES ${values} ON CONFLICT (version) DO NOTHING;`;
    const tmp = path.join(DATA_DIR, `.record-applied.tmp.sql`);
    try {
        fs.mkdirSync(path.dirname(tmp), { recursive: true });
        fs.writeFileSync(tmp, sql, 'utf-8');
        const r = psqlFile(tmp, dbName);
        return r.status === 0;
    } catch (e) {
        log.warn(`[R5] تعذر تسجيل التتبع في القاعدة (غير قاتل): ${e.message}`);
        return false;
    } finally {
        try { fs.unlinkSync(tmp); } catch (_) {}
    }
}

function main() {
    log.header('PostgreSQL — Migrations');

    if (!fs.existsSync(MIGRATIONS_DIR)) {
        log.error(`مجلد migrations غير موجود: ${MIGRATIONS_DIR}`);
        process.exit(1);
    }

    const dbName = getEnv('DB_NAME', 'karim_erp');

    // Backfill: كل أسماء الملفات المسجلة بالملف تُكتب في جدول القاعدة (idempotent)
    try {
        if (fs.existsSync(MIGRATION_LOCK)) {
            const fileApplied = JSON.parse(fs.readFileSync(MIGRATION_LOCK, 'utf-8'));
            if (Array.isArray(fileApplied) && fileApplied.length) {
                if (recordAppliedInDb(dbName, fileApplied)) {
                    log.ok(`[R5] تتبع القاعدة متزامن مع الملف (${fileApplied.length} إدخالًا)`);
                } else {
                    log.warn('[R5] backfill تتبع القاعدة لم يكتمل — راجع schema_migrations');
                }
            }
        }
    } catch (_) { /* غير قاتل */ }

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
            recordAppliedInDb(dbName, [file]); // FIX R5: تتبع مزدوج — القاعدة أيضًا
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
