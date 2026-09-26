#!/usr/bin/env node
/**
 * scripts/status.js — Check system status
 * Usage: node scripts/status.js
 */
const lib = require('./shared');
// Ensure we are in the project root
process.chdir(lib.ROOT);
const { log, getEnv, httpReq, isPgRunning, isPortInUse } = lib;

async function main() {
    log.header('Karim ERP — Status');

    const port = parseInt(getEnv('PORT', '5000'), 10);
    const dbHost = getEnv('DB_HOST', 'localhost');
    const dbPort = getEnv('DB_PORT', '5432');
    const dbUser = getEnv('DB_USER', 'postgres');
    const dbPassword = getEnv('DB_PASSWORD');

    // ─── Backend ───────────────────────────────────
    log.step('الخادم (Express)');
    const backendInUse = await isPortInUse(port);
    if (backendInUse) {
        const health = await httpReq('GET', '/api/health');
        if (health.status === 200 && health.json) {
            log.ok(`يعمل على المنفذ ${port}`);
            const db = health.json.checks?.database;
            if (db) {
                log.plain(`    DB: ${db.status} (${db.latency})`);
            }
            log.plain(`    متصل: ${health.json.checks?.realtime?.connectedClients || 0} جهاز`);
            log.plain(`    ذاكرة: ${health.json.checks?.memory?.rss}`);
        } else {
            log.warn(`المنفذ ${port} مشغول لكن الخادم لا يستجيب`);
        }
    } else {
        log.warn(`متوقف (المنفذ ${port} حر)`);
    }

    // ─── PostgreSQL ────────────────────────────────
    log.step(`PostgreSQL (وضع: ${getEnv('DB_MODE', 'auto')})`);
    try {
        const { spawnSync } = require('child_process');
        const probe = spawnSync(lib.getPgBinary('psql'), ['-h', dbHost, '-p', String(dbPort), '-U', dbUser, '-d', 'postgres', '-tAc', 'SHOW data_directory'], {
            encoding: 'utf-8', timeout: 8000, env: { ...process.env, PGPASSWORD: dbPassword || '' },
        });
        const dir = String(probe.stdout || '').trim();
        if (probe.status === 0 && dir) {
            const isPortable = dir.replace(/\//g, '\\').toLowerCase() === String(lib.DATA_DIR).replace(/\//g, '\\').toLowerCase();
            log.plain(`    المصدر: ${isPortable ? 'المحمولة (database/data)' : 'المثبتة على النظام'}`);
            if (!isPortable) {log.plain(`    data_directory: ${dir}`);}
        }
    } catch (_) {}
    if (isPgRunning(dbHost, dbPort, dbUser, dbPassword)) {
        log.ok(`يعمل على ${dbHost}:${dbPort}`);
        try {
            const version = lib.psql('SELECT version();', 'postgres');
            if (version) {log.plain(`    ${version.split('\n')[0]}`);}
        } catch (_) {}
        try {
            const dbCount = lib.psql(`SELECT count(*) FROM pg_database WHERE datname='${getEnv('DB_NAME', 'karim_erp')}';`, 'postgres');
            if (dbCount && dbCount.includes('1')) {
                log.ok(`قاعدة البيانات "${getEnv('DB_NAME', 'karim_erp')}" موجودة`);
                const tableCount = lib.psql(`SELECT count(*) FROM information_schema.tables WHERE table_schema='public';`, getEnv('DB_NAME', 'karim_erp'));
                log.plain(`    الجداول: ${tableCount}`);
            }
        } catch (e) {
            log.warn(`تعذر فحص قاعدة البيانات: ${e.message}`);
        }
    } else {
        log.warn(`متوقف (${dbHost}:${dbPort})`);
    }

    // ─── Files ────────────────────────────────────
    log.step('الملفات');
    const fs = require('fs');
    const path = require('path');
    const checks = [
        ['.env', path.join(lib.ROOT, '.env')],
        ['node_modules', lib.NODE_MODULES],
        ['PG binaries', path.join(lib.BIN_DIR, 'bin')],
        ['data directory', lib.DATA_DIR],
        ['migrations', lib.MIGRATIONS_DIR],
    ];
    for (const [name, p] of checks) {
        if (fs.existsSync(p)) {
            log.ok(`${name} ✓`);
        } else {
            log.warn(`${name} ✗ (${p})`);
        }
    }

    log.plain('');
    process.exit(0);
}

main().catch((err) => {
    log.error(`خطأ: ${err.message}`);
    process.exit(1);
});
