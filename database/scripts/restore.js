#!/usr/bin/env node
/**
 * database/scripts/restore.js — Restore database from backup (psql)
 * ────────────────────────────────────────────────────────────────────────────
 * Usage:
 *   node database/scripts/restore.js <backup_file.sql> [--target-db NAME] [--yes]
 * Verifies .sha256 sidecar when present, then restores with psql.
 * REFUSES to overwrite the production DB without --yes (safety).
 */
const lib = require('../../scripts/shared');
process.chdir(lib.ROOT);
const { log, getEnv, getPgBinary } = lib;
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function main() {
    const args = process.argv.slice(2).filter(a => !a.startsWith('--'));
    const flags = new Set(process.argv.slice(2).filter(a => a.startsWith('--')));
    const file = args[0];
    if (!file || !fs.existsSync(file)) {
        throw new Error('حدد ملف نسخة موجودًا: node database/scripts/restore.js <file.sql> [--target-db NAME] [--yes]');
    }
    let targetDb = getEnv('DB_NAME', 'karim_erp');
    const ti = process.argv.indexOf('--target-db');
    if (ti >= 0 && process.argv[ti + 1]) targetDb = process.argv[ti + 1];
    const isProd = targetDb === getEnv('DB_NAME', 'karim_erp');
    if (isProd && !flags.has('--yes')) {
        throw new Error('الاستعادة فوق قاعدة الإنتاج تتطلب --yes (تأكيد صريح)');
    }
    // تحقق البصمة إن وُجدت
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
    log.info(`استعادة إلى قاعدة: ${targetDb}`);
    const env = { ...process.env, PGPASSWORD: getEnv('DB_PASSWORD') };
    const result = spawnSync(psql, [
        '-h', getEnv('DB_HOST', 'localhost'), '-p', getEnv('DB_PORT', '5432'),
        '-U', getEnv('DB_USER', 'postgres'), '-d', targetDb,
        '-v', 'ON_ERROR_STOP=1', '-f', path.resolve(file),
    ], { stdio: 'inherit', env, timeout: 600000 });
    if (result.status !== 0) throw new Error('فشلت الاستعادة');
    log.ok('تمت الاستعادة بنجاح');
}

try { main(); }
catch (error) { log.error(error.message); process.exit(1); }
