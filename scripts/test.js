#!/usr/bin/env node
/**
 * scripts/test.js — Run all tests
 * ────────────────────────────────────────────────────────────────────────────
 *   1. Jest unit tests (252 checks)
 *   2. Smoke test (27 endpoint checks — requires backend running)
 *   3. Integration test (53 checks — requires backend + PG)
 *
 * Usage:
 *   node scripts/test.js           # all
 *   node scripts/test.js jest      # jest only
 *   node scripts/test.js smoke     # smoke only
 *   node scripts/test.js integration
 *   node scripts/test.js workflow
 */
const lib = require('./shared');
const { log, ROOT, httpReq } = lib;
const { spawnSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

// Ensure we're in the project root (in case invoked from elsewhere)
process.chdir(ROOT);

async function main() {
    const what = process.argv[2] || 'all';
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
        const health = await httpReq('GET', '/api/health');
        let backendStarted;

        if (health.status !== 200) {
            log.warn('الخادم لا يعمل — بدء مؤقت للاختبار...');
            const backendProc = spawn(process.execPath, [path.join(ROOT, 'backend', 'server.js')], {
                stdio: 'ignore', cwd: ROOT,
                env: { ...process.env, DB_PASSWORD: lib.getEnv('DB_PASSWORD') },
                detached: false,
            });
            backendStarted = true;

            // Wait for backend
            let ready = false;
            for (let i = 0; i < 30; i++) {
                await new Promise(r => setTimeout(r, 1000));
                const h = await httpReq('GET', '/api/health');
                if (h.status === 200) { ready = true; break; }
            }
            if (!ready) {
                log.error('تعذر بدء الخادم للاختبار');
                if (backendStarted) {backendProc.kill();}
                process.exit(1);
            }
            log.ok('الخادم جاهز');

            // Run tests
            if (what === 'all' || what === 'smoke') {
                if (await runScript('smoke-test.js', 'Smoke Test')) {totalPass++;} else {totalFail++;}
            }
            if (what === 'all' || what === 'integration') {
                if (await runScript('integration-test.js', 'Integration Test')) {totalPass++;} else {totalFail++;}
            }
            if (what === 'all' || what === 'integration' || what === 'workflow') {
                if (await runScript('test-signed-workflows.mjs', 'Signed Workflow Test')) {totalPass++;} else {totalFail++;}
            }

            // Stop backend
            backendProc.kill('SIGTERM');
            await new Promise(r => setTimeout(r, 2000));
        } else {
            log.ok('الخادم يعمل');
            if (what === 'all' || what === 'smoke') {
                if (await runScript('smoke-test.js', 'Smoke Test')) {totalPass++;} else {totalFail++;}
            }
            if (what === 'all' || what === 'integration') {
                if (await runScript('integration-test.js', 'Integration Test')) {totalPass++;} else {totalFail++;}
            }
            if (what === 'all' || what === 'integration' || what === 'workflow') {
                if (await runScript('test-signed-workflows.mjs', 'Signed Workflow Test')) {totalPass++;} else {totalFail++;}
            }
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

async function runScript(filename, label) {
    log.step(label);
    const filepath = path.join(ROOT, 'scripts', filename);
    if (!fs.existsSync(filepath)) {
        log.warn(`${filename} غير موجود`);
        return false;
    }
    const result = spawnSync(process.execPath, [filepath], {
        // 10 دقائق: سكربتات الفحص الحي قد تتأخر تحت حمل الإنتاج
        stdio: 'inherit', cwd: ROOT, timeout: 600000,
        env: { ...process.env, DB_PASSWORD: lib.getEnv('DB_PASSWORD') },
    });
    if (result.status === 0) {
        log.ok(`${label}: نجاح`);
    } else {
        log.error(`${label}: فشل`);
    }
    return result.status === 0;
}

main().catch((err) => {
    log.error(`خطأ: ${err.message}`);
    process.exit(1);
});
