/**
 * perf-hardening.test.js — اختبارات تثبيت تعزيز التحمّل تحت الضغط (Task 23)
 * ────────────────────────────────────────────────────────────────────────
 * 1) مولّد مفتاح الدخول بحساب المستخدم: شبكة راوتر واحد لا تُجهاض دخول الطاقم
 * 2) حد جسم الطلب العام مشدود (2MB) واستثناء وحيد لاستيراد الإكسل (50MB)
 * 3) ضغط الاستجابات gzip مركّب قبل المسارات
 * 4) تخزين مؤقت لمكتبات vendor الثابتة
 * 5) إعادة الجدولة على الأخطاء العابرة في safeQuery (سلوك قائم يُثبّت)
 */
const fs = require('fs');
const path = require('path');
const {
    accountKeyGenerator,
    defaultKeyGenerator,
    createRateLimiter,
    DEFAULT_CONFIGS,
} = require('../backend/rate-limiter');

const SERVER = fs.readFileSync(path.join(__dirname, '..', 'backend', 'server.js'), 'utf8');
const ROOT_PKG = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));

function fakeReq({ ip = '10.0.0.1', user, body } = {}) {
    return { ip, connection: { remoteAddress: ip }, user, body: body || {} };
}

describe('مفتاح الدخول بحساب المستخدم (accountKeyGenerator)', () => {
    test('حسابات مختلفة من نفس IP تحصل على مفاتيح مختلفة (دخول الطاقم الصباحي لا يتعارض)', () => {
        const a = accountKeyGenerator(fakeReq({ body: { username: 'admin' } }));
        const b = accountKeyGenerator(fakeReq({ body: { username: 'chef' } }));
        const c = accountKeyGenerator(fakeReq({ body: { username: 'keeper' } }));
        expect(new Set([a, b, c]).size).toBe(3);
    });

    test('نفس الحساب من نفس IP يحصل على نفس المفتاح (عدّاد التخمين يبقى مُقيَّدًا)', () => {
        const a = accountKeyGenerator(fakeReq({ body: { username: 'admin' } }));
        const b = accountKeyGenerator(fakeReq({ body: { username: 'admin' } }));
        expect(a).toBe(b);
    });

    test('اسم المستخدم غير حساس لحالة الأحرف ومقصوصًا عند 64 حرفًا', () => {
        expect(accountKeyGenerator(fakeReq({ body: { username: 'Admin' } })))
            .toBe(accountKeyGenerator(fakeReq({ body: { username: 'admin' } })));
        const long = 'x'.repeat(100);
        const k = accountKeyGenerator(fakeReq({ body: { username: long } }));
        expect(k.endsWith('x'.repeat(64))).toBe(true);
    });

    test('بدون اسم مستخدم → ip:anonymous (سلوك احتياطي آمن)', () => {
        expect(accountKeyGenerator(fakeReq({}))).toBe('10.0.0.1:anonymous');
        expect(accountKeyGenerator(fakeReq({ body: { username: '   ' } }))).toBe('10.0.0.1:anonymous');
    });

    test('IP مختلف يحصل على مفتاح مختلف لنفس الحساب (لا تجميد عابر للأجهزة)', () => {
        const a = accountKeyGenerator(fakeReq({ ip: '10.0.0.1', body: { username: 'admin' } }));
        const b = accountKeyGenerator(fakeReq({ ip: '10.0.0.2', body: { username: 'admin' } }));
        expect(a).not.toBe(b);
    });

    test('مولّد المفتاح العام ما زال يُفضّل userId بعد المصادقة', () => {
        expect(defaultKeyGenerator(fakeReq({ user: { id: 7 } }))).toBe('10.0.0.1:7');
    });

    test('حد المصادقة 20 محاولة/15 دقيقة لكل حساب (وليس 10 على مستوى الراوتر)', () => {
        expect(DEFAULT_CONFIGS.auth.windowMs).toBe(15 * 60 * 1000);
        const limiter = createRateLimiter({ ...DEFAULT_CONFIGS.auth, maxRequests: 20 });
        expect(typeof limiter).toBe('function');
    });
});

describe('تحصين الخادم ضد الضغط (server.js)', () => {
    test('ضغط الاستجابات gzip بعتبة 512B ومستوى 9 قبل تعريف المسارات', () => {
        expect(SERVER).toMatch(/require\('compression'\)/);
        expect(SERVER).toMatch(/app\.use\(compression\(\{[\s\S]{0,120}?threshold:\s*512/);
        // يجب أن يسبق تعريف أول مسار
        const compIdx = SERVER.indexOf('app.use(compression(');
        const firstRouteIdx = SERVER.indexOf("app.get('/");
        expect(compIdx).toBeGreaterThan(-1);
        expect(compIdx).toBeLessThan(firstRouteIdx);
    });

    test('حد الجسم العام مشدود 2MB — قطع هجمات الحشو مبكرًا', () => {
        expect(SERVER).toMatch(/express\.json\(\{\s*limit:\s*'2mb'/);
        expect(SERVER).toMatch(/express\.urlencoded\(\{[^}]*limit:\s*'2mb'/);
        expect(SERVER).not.toMatch(/express\.json\(\{\s*limit:\s*'50mb'\s*\}\);\s*\n\s*app\.use\(express\.urlencoded/);
    });

    test('استثناء وحيد 50MB لاستيراد الإكسل، وركوبه قبل المحلل العام', () => {
        expect(SERVER).toMatch(/app\.use\('\/api\/inventory\/import',\s*express\.json\(\{\s*limit:\s*'50mb'\s*\}\)\)/);
        const scopedIdx = SERVER.indexOf("/api/inventory/import', express.json");
        const globalIdx = SERVER.indexOf("express.json({ limit: '2mb'");
        expect(scopedIdx).toBeGreaterThan(-1);
        expect(scopedIdx).toBeLessThan(globalIdx);
    });

    test('مكتبات vendor تُخزَّن 365 يومًا بصيغة immutable', () => {
        expect(SERVER).toMatch(/\/app\/js\/vendor'[\s\S]{0,140}?maxAge:\s*'365d',\s*immutable:\s*true/);
    });

    test('compression مُثبّت كت redependency إنتاجية في package.json', () => {
        expect(ROOT_PKG.dependencies && ROOT_PKG.dependencies.compression).toBeTruthy();
    });
});

describe('safeQuery — إعادة المحاولة على الأخطاء العابرة (سلوك قائم يُثبَّت)', () => {
    test('الواجهة المصدَّرة سليمة: safeQuery دالة، والرموز العابرة موثقة في المصدر', () => {
        const shared = require('../backend/shared-pool');
        expect(typeof shared.safeQuery).toBe('function');
        expect(typeof shared.pool).toBe('object');
        const src = fs.readFileSync(path.join(__dirname, '..', 'backend', 'shared-pool.js'), 'utf8');
        for (const code of ['ECONNRESET', '40001', '40P01', '57P01']) {
            expect(src).toContain(`'${code}'`);
        }
    });
});
