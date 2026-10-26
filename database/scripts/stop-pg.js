#!/usr/bin/env node
/**
 * database/scripts/stop-pg.js — Stop PostgreSQL server
 * Usage: node database/scripts/stop-pg.js
 */
const lib = require('../../scripts/shared');
// Ensure we are in the project root
process.chdir(lib.ROOT);
const { log, DATA_DIR, IS_WIN, getPgBinary } = lib;
const BIN_DIR = (() => { try { return path.dirname(getPgBinary('pg_ctl') || ''); } catch (_) { return ''; } })();
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function main() {
    log.header('PostgreSQL — Stop');

    const pgCtl = getPgBinary('pg_ctl');
    if (!pgCtl) {
        log.error('pg_ctl binary not found');
        process.exit(1);
    }

    if (!fs.existsSync(DATA_DIR)) {
        log.ok('مجلد البيانات غير موجود — لا شيء للإيقاف');
        return;
    }

    // On Linux: set LD_LIBRARY_PATH
    const stopEnv = { ...process.env };
    const libDir = path.join(BIN_DIR, 'lib');
    if (fs.existsSync(libDir) && !IS_WIN) {
        stopEnv.LD_LIBRARY_PATH = (stopEnv.LD_LIBRARY_PATH || '') + ':' + libDir;
    }

    const result = spawnSync(pgCtl, ['stop', '-D', DATA_DIR, '-w', '-t', '30'], {
        stdio: 'inherit', timeout: 60000, env: stopEnv,
    });

    if (result.status === 0) {
        log.ok('تم الإيقاف');
    } else {
        // Check if it was already stopped
        const status = spawnSync(pgCtl, ['status', '-D', DATA_DIR], { encoding: 'utf-8', env: stopEnv });
        if (status.stdout.includes('no server running') || status.stderr.includes('no server running')) {
            log.ok('PostgreSQL لم تكن مشغّلة');
        } else {
            log.warn('قد تكون PostgreSQL مشغّلة بعملية أخرى');
        }
    }
}

try { main(); } catch (e) { log.error(e.message); process.exit(1); }
