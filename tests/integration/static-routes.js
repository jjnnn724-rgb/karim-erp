/**
 * integration/static-routes.js — سلوك الصفحات الثابتة وCSP على خادم حقيقي
 * ────────────────────────────────────────────────────────────────────────────
 * لماذا اختبار تكامل (لا فحص مصدر): ما نتحقق منه هو **ما يراه المتصفح فعلاً**:
 *   · /app/menu.html يجب أن يوجّه إلى الشاشة الحيّة (menu-board.html)
 *     بدل صفحة ميتة (سكربتها inline محجوب + Tailwind CDN محجوب).
 *   · /app/pos.html يجب أن تحمّل ملف التهيئة الخارجي (لا سكربت inline).
 *   · صفحة الشاشة الحيّة يجب أن تعمل (200) — لا نكسرها أثناء الإصلاح.
 *
 * لا يكتب في القاعدة: طلبات GET فقط.
 */
'use strict';

const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const PORT = Number(process.env.STATIC_ROUTES_PORT || 5096);
const BASE = `http://127.0.0.1:${PORT}`;
let serverProc = null;

function loadEnv() {
    const dotenv = require(path.join(ROOT, 'node_modules', 'dotenv'));
    dotenv.config({ path: path.join(ROOT, '.env'), override: false });
}

async function startServer() {
    const env = {
        ...process.env,
        NODE_ENV: 'production',
        PORT: String(PORT),
        HOST: '127.0.0.1',
        DB_NAME: process.env.KARIM_TEST_DB_NAME || 'karim_erp_test',
        DB_HOST: process.env.DB_HOST || '127.0.0.1',
        DB_PORT: process.env.DB_PORT || '5432',
        DB_USER: process.env.DB_USER || 'postgres',
        DB_PASSWORD: process.env.DB_PASSWORD || '',
        JWT_ACCESS_SECRET: crypto.randomBytes(48).toString('base64url'),
        JWT_REFRESH_SECRET: crypto.randomBytes(48).toString('base64url'),
        API_KEY: crypto.randomBytes(24).toString('base64url'),
        SKIP_BULLMQ: 'true',
        ZATCA_ENABLED: 'false',
        SSL_KEY: '',
        SSL_CERT: '',
        CSP_STRICT_REPORT_ONLY: 'false',
        LOG_LEVEL: 'warn',
    };
    const log = [];
    serverProc = spawn(process.execPath, [path.join(ROOT, 'backend', 'server.js')], {
        cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'],
    });
    serverProc.stdout.on('data', (d) => log.push(String(d)));
    serverProc.stderr.on('data', (d) => log.push(String(d)));
    for (let i = 0; i < 120; i++) {
        await new Promise((r) => setTimeout(r, 500));
        try {
            const res = await fetch(`${BASE}/api/health`);
            if (res.ok) {return;}
        } catch (_) { /* لم يبدأ بعد */ }
        if (serverProc.exitCode !== null) {
            throw new Error(`الخادم توقف (code=${serverProc.exitCode})\n${log.join('').slice(-2000)}`);
        }
    }
    throw new Error(`الخادم لم يستجب خلال 60 ثانية\n${log.join('').slice(-2000)}`);
}

function stopServer() {
    if (serverProc && serverProc.exitCode === null) {
        try {serverProc.kill('SIGTERM');} catch (_) {}
    }
}

async function main() {
    loadEnv();
    // حارسان: لا نعمل على منفذ الإنتاج، ولا على قاعدة الإنتاج.
    if (Number(PORT) === 5000) {
        throw new Error('تجنّب: هذا الاختبار لا يعمل على منفذ الإنتاج 5000.');
    }
    const testDb = process.env.KARIM_TEST_DB_NAME || 'karim_erp_test';
    if (testDb === 'karim_erp') {
        throw new Error('تجنّب: قاعدة الإنتاج (karim_erp) ممنوعة في الاختبار.');
    }
    await startServer();
    const results = [];
    const check = (name, ok, detail = '') => {
        results.push({ name, ok, detail });
        if (!ok) {throw new Error(`فشل: ${name} ${detail}`);}
    };

    try {
        // 1) صفحة البوفيه القديمة ⇒ توجيه للشاشة الحيّة
        const old = await fetch(`${BASE}/app/menu.html`, { redirect: 'manual' });
        check('menu.html يوجّه', old.status === 302 && (old.headers.get('location') || '').includes('/app/menu-board.html'),
            `status=${old.status} location=${old.headers.get('location')}`);

        // 2) الشاشة الحيّة تعمل
        const board = await fetch(`${BASE}/app/menu-board.html`);
        const boardHtml = await board.text();
        check('menu-board.html يعمل', board.status === 200 && boardHtml.includes('menu-board'),
            `status=${board.status}`);

        // 3) صفحة الكاشير بلا سكربت inline + تشير لملف التهيئة
        const pos = await fetch(`${BASE}/app/pos.html`);
        const posHtml = await pos.text();
        check('pos.html 200', pos.status === 200, `status=${pos.status}`);
        check('pos.html يحمّل pos-bootstrap.js', posHtml.includes('js/pos-bootstrap.js'));
        const inlineInPos = posHtml.match(/<script(?![^>]*\ssrc\s*=)[^>]*>/gi) || [];
        check('pos.html بلا سكربت inline', inlineInPos.length === 0, `عدد=${inlineInPos.length}`);

        // 4) ملف التهيئة يُخدَم فعليًا (لا 404 ⇒ التهيئة ستعمل)
        const boot = await fetch(`${BASE}/app/js/pos-bootstrap.js`);
        const bootJs = await boot.text();
        check('pos-bootstrap.js يُخدَم', boot.status === 200 && bootJs.includes('applyPosPathPolicy'),
            `status=${boot.status}`);

        // 5) منطق البوفيه القديم منقول ويُخدَم
        const legacy = await fetch(`${BASE}/app/js/features/menu-legacy.js`);
        const legacyJs = await legacy.text();
        check('menu-legacy.js يُخدَم', legacy.status === 200 && legacyJs.includes('DEFAULT_DATA'),
            `status=${legacy.status}`);

        // 6) سياسة CSP المطبَّقة: لا 'unsafe-inline' في script-src (وإلا فقدت الحماية)
        const page = await fetch(`${BASE}/app/index.html`);
        const csp = page.headers.get('content-security-policy') || '';
        const scriptSrc = csp.split(';').map((d) => d.trim()).find((d) => d.startsWith('script-src')) || '';
        check('script-src بلا unsafe-inline', !scriptSrc.includes("'unsafe-inline'"), scriptSrc);
        check('script-src-attr يسمح بالمعالجات السطرية (الوضع الحالي)', (csp.split(';').map((d) => d.trim()).find((d) => d.startsWith('script-src-attr')) || '').includes("'unsafe-inline'"));

        console.log('\n✅ كل فحوص الصفحات الثابتة نجحت:');
        for (const r of results) {console.log(`   • ${r.name}`);}
    } finally {
        stopServer();
    }
}

main().then(() => process.exit(0)).catch((e) => {
    console.error(`\n❌ ${e.message}`);
    process.exit(1);
});
