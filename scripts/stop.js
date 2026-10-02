#!/usr/bin/env node
/**
 * scripts/stop.js — Stop backend + PostgreSQL
 * Usage: node scripts/stop.js
 */
const lib = require('./shared');
// Ensure we are in the project root
process.chdir(lib.ROOT);
const { log, getEnv, httpReq } = lib;
const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

async function main() {
    log.header('Karim ERP — Stop');

    // 1. Stop backend (try health endpoint first to confirm it's ours)
    const port = parseInt(getEnv('PORT', '5000'), 10);
    const inUse = await lib.isPortInUse(port);
    if (inUse) {
        log.step('إيقاف الخادم...');
        // Find and kill node processes running backend/server.js
        if (lib.IS_WIN) {
            spawnSync('taskkill', ['/F', '/IM', 'node.exe', '/FI', 'WINDOWTITLE eq *backend*'], { stdio: 'ignore' });
            // wmic was removed from Windows 11 24H2+ — use PowerShell/CIM instead
            const findResult = spawnSync('powershell', ['-NoProfile', '-Command',
                "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { $_.CommandLine -like '*backend*server.js*' } | ForEach-Object { $_.ProcessId }"],
                { encoding: 'utf-8' });
            if (findResult.status === 0 && findResult.stdout) {
                const pids = findResult.stdout.split(/\s+/).filter(p => /^\d+$/.test(p.trim()));
                for (const pid of pids) {
                    spawnSync('taskkill', ['/F', '/PID', pid], { stdio: 'ignore' });
                    log.ok(`تم إيقاف العملية ${pid}`);
                }
            }
            // CORRECTNESS: مشرف serve.js لو نجا كان يعيد تشغيل السيرفر فورًا
            // ويتعطل الإيقاف كله — نقتله بنفس الاستهداف (عمليات هذا المشروع فقط).
            const supResult = spawnSync('powershell', ['-NoProfile', '-Command',
                "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { $_.CommandLine -like '*scripts*serve.js*' } | ForEach-Object { $_.ProcessId }"],
                { encoding: 'utf-8' });
            if (supResult.status === 0 && supResult.stdout) {
                const supPids = supResult.stdout.split(/\s+/).filter(p => /^\d+$/.test(p.trim()));
                for (const pid of supPids) {
                    spawnSync('taskkill', ['/F', '/PID', pid], { stdio: 'ignore' });
                    log.ok(`تم إيقاف المشرف ${pid}`);
                }
            }
        } else {
            // Linux/Mac: pkill by pattern
            spawnSync('pkill', ['-f', 'backend/server.js'], { stdio: 'ignore' });
            spawnSync('pkill', ['-f', 'scripts/serve.js'], { stdio: 'ignore' });
            log.ok('تم إيقاف الخادم');
        }
    } else {
        log.ok('الخادم غير مشغل');
    }

    // 2. Stop PostgreSQL
    log.step('إيقاف PostgreSQL...');
    const stopScript = path.join(__dirname, '..', 'database', 'scripts', 'stop-pg.js');
    if (fs.existsSync(stopScript)) {
        const result = spawnSync(process.execPath, [stopScript], {
            stdio: 'inherit', timeout: 30000,
            env: { ...process.env, DB_PASSWORD: getEnv('DB_PASSWORD') },
        });
        if (result.status === 0) {
            log.ok('تم إيقاف PostgreSQL');
        } else {
            log.warn('PostgreSQL قد لا تكون مشغّلة');
        }
    } else {
        log.warn('سكربت إيقاف PostgreSQL غير موجود');
    }

    log.ok('تم الإيقاف');
    process.exit(0);
}

main().catch((err) => {
    log.error(`خطأ: ${err.message}`);
    process.exit(1);
});
