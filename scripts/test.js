#!/usr/bin/env node
/**
 * scripts/test.js — Run all tests
 * ────────────────────────────────────────────────────────────────────────────
 *   1. Jest unit tests (252 checks)
 *   2. Smoke test (requires explicit isolated database and test-server URL)
 *   3. Integration test (requires explicit isolated database and test-server URL)
 *
 * Usage:
 *   node scripts/test.js           # Jest only (safe default)
 *   node scripts/test.js all       # Jest + isolated smoke + integration (explicit opt-in)
 *   node scripts/test.js jest      # jest only
 *   node scripts/test.js smoke     # smoke only (isolated test server required)
 *   node scripts/test.js integration # integration only (isolated test DB required)
 *   node scripts/test.js workflow
 */
const lib = require('./shared');
const { log, ROOT, httpReq, isPortInUse } = lib;
const { spawnSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

// Ensure we're in the project root (in case invoked from elsewhere)
process.chdir(ROOT);

async function main() {
    const what = process.argv[2] || 'jest';
    const runsServerTests = ['all', 'smoke', 'integration', 'workflow'].includes(what);
    const testServer = runsServerTests ? assertSafeTestTarget() : null;
    if (runsServerTests && await isPortInUse(testServer.port, testServer.host)) {
        throw new Error(`Refusing to run tests: port ${testServer.port} already has a listener. Stop it so tests cannot touch an unrelated server.`);
    }
    log.header('Karim ERP — Tests');

    let totalPass = 0;
    let totalFail = 0;

    // ─── Jest ──────────────────────────────────────
    if (what === 'all' || what === 'jest') {
        log.step('Jest Unit Tests');
        // Windows-first project: npx is npx.cmd there — spawning it without a
        // shell fails with ENOENT, so 'npm test' never worked on the primary
        // target platform. Prefer the local jest binary directly.
        const jestBin = require.resolve('jest/bin/jest');
        const result = spawnSync(process.execPath, [jestBin, 'tests/', '--silent', '--runInBand', '--forceExit'], {
            // 15 دقيقة: تشغيل runInBand على آلة إنتاج مشغولة (بصمة/واتساب/Oracle) قد يتجاوز 5 دقائق
            stdio: 'inherit', cwd: ROOT, timeout: 900000,
            env: { ...process.env, NODE_ENV: 'test' },
        });
        if (result.status === 0) {
            log.ok('Jest: نجاح');
            totalPass++;
        } else {
            log.error('Jest: فشل');
            totalFail++;
        }
    }

    // ─── Smoke / Integration (require backend) ─────
    if (what === 'all' || what === 'smoke' || what === 'integration' || what === 'workflow') {
        log.step('فحص الخادم');
        const backendProc = spawn(process.execPath, [path.join(ROOT, 'backend', 'server.js')], {
            stdio: 'ignore', cwd: ROOT,
            env: {
                ...process.env,
                NODE_ENV: 'test',
                PORT: String(testServer.port),
                DB_PASSWORD: lib.getEnv('DB_PASSWORD'),
            },
            detached: false,
        });
        try {
            let ready = false;
            for (let i = 0; i < 30; i++) {
                await new Promise(r => setTimeout(r, 1000));
                try {
                    const health = await httpReq('GET', '/api/health', null, testServer.requestOptions);
                    if (health.status === 200) { ready = true; break; }
                } catch (_) {}
                if (backendProc.exitCode !== null) { break; }
            }
            if (!ready) { throw new Error('تعذر بدء الخادم المعزول للاختبار.'); }
            log.ok('الخادم الاختباري المعزول جاهز');

            if (what === 'all' || what === 'smoke') {
                if (await runScript('smoke-test.js', 'Smoke Test', testServer.port)) {totalPass++;} else {totalFail++;}
            }
            if (what === 'all' || what === 'integration') {
                if (await runScript('integration-test.js', 'Integration Test', testServer.port)) {totalPass++;} else {totalFail++;}
            }
            if (what === 'all' || what === 'integration' || what === 'workflow') {
                if (await runScript('test-signed-workflows.mjs', 'Signed Workflow Test', testServer.port)) {totalPass++;} else {totalFail++;}
            }
        } finally {
            if (backendProc.exitCode === null) { backendProc.kill('SIGTERM'); }
            await new Promise(r => setTimeout(r, 2000));
        }
    }

    log.plain('');
    log.header('Test Summary');
    // COLORS كان غير معرّف على log — استخدم ثوابت ANSI المحلية بدل الاعتماد على shared.js
    const COLORS = { green: '\x1b[32m', red: '\x1b[31m', reset: '\x1b[0m' };
    log.plain(`  نجاح: ${COLORS.green}${totalPass}${COLORS.reset}`);
    log.plain(`  فشل: ${totalFail > 0 ? COLORS.red : ''}${totalFail}${COLORS.reset}`);
    process.exit(totalFail > 0 ? 1 : 0);
}

async function runScript(filename, label, port) {
    log.step(label);
    const filepath = path.join(ROOT, 'scripts', filename);
    if (!fs.existsSync(filepath)) {
        log.warn(`${filename} غير موجود`);
        return false;
    }
    const result = spawnSync(process.execPath, [filepath], {
        // 10 دقائق: سكربتات الفحص الحي قد تتأخر تحت حمل الإنتاج
        stdio: 'inherit', cwd: ROOT, timeout: 600000,
        env: {
            ...process.env,
            NODE_ENV: 'test',
            PORT: String(port),
            DB_PASSWORD: lib.getEnv('DB_PASSWORD'),
        },
    });
    if (result.status === 0) {
        log.ok(`${label}: نجاح`);
    } else {
        log.error(`${label}: فشل`);
    }
    return result.status === 0;
}

function assertSafeTestTarget() {
    const allowedHosts = new Set(['localhost', '127.0.0.1', '::1']);
    let target;
    try {
        target = new URL(process.env.KARIM_TEST_BASE_URL);
    } catch (cause) {
        throw new Error('Set KARIM_TEST_BASE_URL to an explicit loopback test-server URL.', { cause });
    }
    const databaseHost = String(process.env.DB_HOST || '127.0.0.1').toLowerCase();
    if (process.env.NODE_ENV === 'production'
        || process.env.DB_NAME !== 'karim_erp_test'
        || process.env.KARIM_TEST_DB_NAME !== 'karim_erp_test'
        || process.env.KARIM_TEST_DB_ISOLATED !== '1'
        || !allowedHosts.has(databaseHost)
        || !allowedHosts.has(target.hostname)
        || !target.port
        || !['http:', 'https:'].includes(target.protocol)) {
        throw new Error('Server tests require an explicitly isolated karim_erp_test database and loopback test server.');
    }
    return {
        host: target.hostname,
        port: Number(target.port),
        requestOptions: {
            host: target.hostname,
            port: Number(target.port),
            useHttps: target.protocol === 'https:',
        },
    };
}

main().catch((err) => {
    log.error(`خطأ: ${err.message}`);
    process.exit(1);
});
