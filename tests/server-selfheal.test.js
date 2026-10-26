/**
 * server-selfheal.test.js — عقد «السيرفر ما يقفلش لوحده» (طلب المالك 2026-10-19)
 * ═══════════════════════════════════════════════════════════════════════
 * يحرس ثلاثة دروع:
 *   1) الأخطاء العابرة (قطع PostgreSQL/الشبكة) تُمتَصّ ولا تُسقط الخادم.
 *   2) EADDRINUSE عند إعادة التشغيل يُعاد المحاولة عليه لا يقتل العملية.
 *   3) المراقب (watchdog) ينتظر تحرّر المنفذ قبل التشغيل ويعيد الصحة.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const SHIELDS = read('backend/errors/error-handler.js');
const POOL = read('backend/shared-pool.js');
const SERVER = read('backend/server.js');
const WATCHDOG = read('scripts/watchdog.js');
const SERVE = read('scripts/serve.js');

const { isTransientInfraError } = require('../backend/errors/error-handler');

describe('امتصاص الأخطاء العابرة — لا إسقاط للخادم', () => {
    test('تُصنَّف أخطاء القاعدة/الشبكة العابرة صحيحًا', () => {
        expect(isTransientInfraError({ code: 'ECONNRESET' })).toBe(true);
        expect(isTransientInfraError({ code: '57P01' })).toBe(true);
        expect(isTransientInfraError(new Error('Connection terminated unexpectedly'))).toBe(true);
        expect(isTransientInfraError(new Error('Connection terminated due to connection timeout'))).toBe(true);
        expect(isTransientInfraError(new Error('terminating connection due to idle-in-transaction timeout'))).toBe(true);
        expect(isTransientInfraError(new Error('socket hang up'))).toBe(true);
    });

    test('الأخطاء البرمجية الحقيقية لا تُصنَّف عابرة (تُعيد التشغيل)', () => {
        expect(isTransientInfraError(new Error('syntax error at or near "SELEC"'))).toBe(false);
        expect(isTransientInfraError({ code: '23505' })).toBe(false);
        expect(isTransientInfraError(new Error('listen EADDRINUSE: address already in use 0.0.0.0:5000'))).toBe(false);
        expect(isTransientInfraError(undefined)).toBe(false);
    });

    test('الدِّرع يمتصّ العابر قبل سطر إعادة التشغيل (والسطر القاتل يبقى للحقيقي)', () => {
        expect(SHIELDS).toContain('isTransientInfraError');
        expect(SHIELDS).toContain('transient_rejection_absorbed');
        expect(SHIELDS).toContain('transient_exception_absorbed');
        // العقد القديم محفوظ: الحقيقي وحده يمر لسطر الإيقاف المُتحكَّم فيه.
        expect(SHIELDS).toMatch(/if \(exitOnFatal\) \{triggerFatalShutdown\(1, (?:err|appErr), onFatal, shutdownTimeoutMs\);\}/);
        // سقف الأمان ضد سيل العابر.
        expect(SHIELDS).toContain('noteTransientBurst');
        expect(SHIELDS).toContain('TRANSIENT_BURST_MAX');
    });

    test('كل عميل في الـpool له مستمع error (وإلا صار uncaughtException قاتلًا)', () => {
        expect(POOL).toMatch(/p\.on\('connect',[\s\S]*?client\.on\('error'/);
    });
});

describe('منفذ مشغول (EADDRINUSE) — إعادة محاولة لا سقوط', () => {
    test('الخادم يعيد المحاولة بتدرّج ويسقط فقط عند نفادها', () => {
        expect(SERVER).toContain("err.code === 'EADDRINUSE'");
        expect(SERVER).toContain('MAX_LISTEN_ATTEMPTS');
        expect(SERVER).toContain('listen_retry');
        expect(SERVER).toMatch(/setTimeout\(\(\) => httpServer\.listen\(PORT, '0\.0\.0\.0'\), waitMs\)/);
    });

    test('الإقلاع الكامل انتقل إلى مستمع listening واحد (لا يُشغَّل مرتين)', () => {
        expect(SERVER).toContain("httpServer.on('listening'");
        expect(SERVER).toContain('async function onServerListening() {');
        expect(SERVER).not.toMatch(/httpServer\.listen\(PORT, '0\.0\.0\.0', async/);
    });
});

describe('المراقب والمُشغِّل — إعادة تشغيل تلقائية نظيفة', () => {
    test('watchdog ينتظر تحرّر المنفذ قبل تشغيل الخدمة', () => {
        expect(WATCHDOG).toContain('async function waitPortFree(');
        expect(WATCHDOG).toMatch(/waitPortFree\(5000, 45000\)/);
        expect(WATCHDOG).toContain('port-free:');
    });

    test('watchdog يمنح الإقلاع الكامل وقتًا كافيًا ليعود سليمًا', () => {
        expect(WATCHDOG).toMatch(/for \(let i = 0; i < 20 && !healthy; i\+\+\)/);
        expect(WATCHDOG).toContain('erp_after');
    });

    test('serve.js يكتب سجل إعادة التشغيل فعلًا ويصفّر العدّاد بعد استقرار', () => {
        expect(SERVE).toMatch(/backendLogStream = fs\.createWriteStream\(/);
        expect(SERVE).toContain('server.log');
        expect(SERVE).toMatch(/Date\.now\(\) - backendStartedAt > 60000\) \{backendRestarts = 0;\}/);
    });
});
