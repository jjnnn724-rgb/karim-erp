#!/usr/bin/env node
/**
 * fortress — بوابة القلعة الموحدة: كل الحواجز بترتيب، فشل واحد = رفض كامل.
 * ════════════════════════════════════════════════════════════════════════════
 *   node scripts/fortress.js            → سريع+متوسط+نقي (pre-push، ~دقيقتان)
 *   node scripts/fortress.js --full     → + الحزمة الكاملة + v3 كامل (يتطلب قاعدة الاختبار المعزولة)
 *   node scripts/fortress.js --quick    → البوابات السريعة فقط (~30ث)
 *   node scripts/fortress.js --gate=NAME→ بوابة واحدة بالاسم
 * الفلسفة: لا كود يدخل إلا صح تمامًا ومتوافقًا. الحدود ratchet لا تُرفع لتخضير فشل.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const V3WEB = path.join(ROOT, 'v3', 'apps', 'web');
const args = process.argv.slice(2);
const FULL = args.includes('--full');
const QUICK = args.includes('--quick');
const ONLY = (args.find((a) => a.startsWith('--gate=')) || '').split('=')[1];

function run(name, cmd, cmdArgs, opts = {}) {
    const t0 = Date.now();
    const r = spawnSync(cmd, cmdArgs, { cwd: opts.cwd || ROOT, encoding: 'utf8', timeout: opts.timeout || 600000, maxBuffer: 64 * 1024 * 1024, env: opts.env || process.env, shell: false });
    const secs = ((Date.now() - t0) / 1000).toFixed(1);
    const ok = r.status === 0;
    console.log(`${ok ? '✓' : '✗'} ${name} (${secs}ث)`);
    if (!ok) {
        const out = ((r.stdout || '') + (r.stderr || '')).trim();
        console.log(out.split('\n').slice(-14).map((l) => '   ' + l).join('\n'));
    }
    return ok;
}
const node = process.execPath;
const S = (f) => path.join(ROOT, 'scripts', f);

// بيئة قاعدة الاختبار للحزمة الكاملة — تُقرأ برمجيًا ولا تُطبع أبدًا.
function testEnv() {
    const env = { ...process.env, NODE_ENV: 'test', CI: 'true', DB_HOST: '127.0.0.1', DB_NAME: 'karim_erp_test', KARIM_TEST_DB_NAME: 'karim_erp_test', KARIM_TEST_DB_ISOLATED: '1', SKIP_BULLMQ: 'true', WARMUP_ENABLED: 'false', WHATSAPP_ENABLED: 'false', PUSH_ENABLED: 'false', GOVERNANCE_SCHEDULER: 'false', YARASOFT_ENABLED: 'false', YARASOFT_ORACLE_ENABLED: 'false', KARIM_LAN_BEACON: 'false', LOG_LEVEL: 'error', ALLOWED_ORIGINS: 'http://127.0.0.1:5320' };
    try {
        for (const line of fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split('\n')) {
            const t = line.trim(); if (!t || t.startsWith('#')) {continue;}
            const i = t.indexOf('='); if (i < 0) {continue;}
            const k = t.slice(0, i).trim();
            if (['DB_USER', 'DB_PASSWORD', 'DB_PORT'].includes(k)) {env[k] = t.slice(i + 1).trim();}
        }
    } catch (_) { /* .env غير موجود — الحزمة الكاملة ستفشل برسالة واضحة */ }
    env.API_KEY = env.API_KEY || 'test-api-key-32-chars-minimum-length';
    env.JWT_ACCESS_SECRET = env.JWT_ACCESS_SECRET || 'test-jwt-secret-32-chars-minimum-length-for-testing';
    env.JWT_REFRESH_SECRET = env.JWT_REFRESH_SECRET || 'test-jwt-refresh-secret-32-chars-minimum-length';
    env.HEALTH_TOKEN = env.HEALTH_TOKEN || 'test-health-token-32-chars-minimum-length';
    return env;
}
function jestBin() {
    const direct = path.join(ROOT, 'node_modules', 'jest', 'bin', 'jest.js');
    if (fs.existsSync(direct)) {return direct;}
    const store = path.join(ROOT, 'node_modules', '.pnpm');
    const j = fs.readdirSync(store).find((d) => d.startsWith('jest@'));
    return path.join(store, j, 'node_modules', 'jest', 'bin', 'jest.js');
}

const gates = [];
const G = (name, fn) => gates.push({ name, fn });

// ── المرحلة 1: سريعة (ثوانٍ) ─────────────────────────────────────────────
G('secrets', () => run('الأسرار في المتتبع', node, [S('check-secrets.js')]));
G('migrations', () => run('عدم المساس بتاريخ الترحيلات', node, [S('migration-immutability.js')]));
G('frontend-version', () => run('اتساق إصدار الواجهة (cache-busting)', node, [S('frontend-version.js'), '--check']));
G('color', () => run('عقد ألوان التصميم', node, [S('design-color-audit.js')]));
G('docker', () => run('سلامة Docker', node, [S('check-docker.js')]));
G('handlers', () => run('معالجات inline', node, [S('audit-inline-handlers.js')]));
G('inline-scripts', () => run('سكربتات CSP inline', node, [S('audit-csp-inline-handlers.js'), '--check-inline-scripts']));
G('dispatch', () => run('عقد dispatch', node, [S('audit-csp-inline-handlers.js'), '--check-dispatch']));
if (!QUICK) {
    // ── المرحلة 2: متوسطة (~دقيقة) ───────────────────────────────────────
    G('lint', () => run('ESLint (حصص ratchet)', node, [S('lint-gate.js')]));
    G('type', () => run('أنواع الطبقة القديمة', node, [S('type-gate.js')]));
    G('security', () => run('بوابة الأمان (XSS/حقن)', node, [S('security-gate.js')]));
    G('jest-pure', () => run('اختبارات نقية (أمان/عقود)', node, [jestBin(), '--config', S('jest.pure.config.json'), '--silent', '--forceExit'], { timeout: 300000 }));
}
if (FULL) {
    // ── المرحلة 3: الكاملة (قاعدة الاختبار المعزولة إلزامية) ─────────────
    G('jest-full', () => run('حزمة Jest الكاملة (معزولة)', node, [jestBin(), 'tests/', '--silent', '--forceExit', '--maxWorkers=4'], { env: testEnv(), timeout: 1500000 }));
    G('v3-type', () => run('أنواع v3 (web+shared)', node, [path.join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc'), '--noEmit', '-p', 'tsconfig.json'], { cwd: V3WEB }));
    G('v3-test', () => run('اختبارات v3 (vitest)', node, [path.join(V3WEB, 'node_modules', 'vitest', 'vitest.mjs'), 'run'], { cwd: V3WEB, timeout: 900000 }));
    G('v3-biome', () => run('biome check (lint+format+imports)', node, [path.join(ROOT, 'v3', 'node_modules', '@biomejs', 'biome', 'bin', 'biome'), 'check', '.'], { cwd: path.join(ROOT, 'v3') }));
    G('v3-build', () => run('بناء v3', node, [path.join(V3WEB, 'node_modules', 'vite', 'bin', 'vite.js'), 'build'], { cwd: V3WEB }));
    G('v3-budget', () => run('ميزانية الحزمة (gzip)', node, [path.join(V3WEB, 'e2e', 'scripts', 'bundle-budget.mjs')], { cwd: V3WEB }));
}

(async () => {
    console.log(`🏰 fortress — وضع: ${FULL ? 'كامل' : QUICK ? 'سريع' : 'قياسي (pre-push)'}${ONLY ? ' — بوابة: ' + ONLY : ''}`);
    const selected = ONLY ? gates.filter((g) => g.name === ONLY) : gates;
    if (ONLY && !selected.length) {console.error('بوابة غير معروفة: ' + ONLY); process.exit(2);}
    const failed = [];
    for (const g of selected) {
        let ok = false;
        try { ok = g.fn(); } catch (e) { console.log(`✗ ${g.name} — استثناء: ${e.message.slice(0, 150)}`); }
        if (!ok) { failed.push(g.name); if (!FULL && !ONLY) { /* استمر لعرض كل الفشل دفعة واحدة */ } }
    }
    console.log('─'.repeat(50));
    if (failed.length) {
        console.error(`🚫 القلعة ترفض: ${failed.length} بوابة فشلت → ${failed.join(', ')}`);
        console.error('   أصلح السبب، ولا ترفع حدًا/أساسًا لتخضير الفشل (ratchet).');
        process.exit(1);
    }
    console.log(`✅ القلعة تسمح: ${selected.length} بوابة خضراء — الكود صح ومتوافق.`);
})().catch((e) => { console.error('fortress crash:', e.message); process.exit(1); });
