/**
 * v2-zkteco.test.js — عقد شاشة 11 (أجهزة البصمة) ومرآة خادمها
 * ═══════════════════════════════════════════════════════════════════════
 * نفس أسلوب tests/v2-procurement.test.js: المستودع يُحمَّل في vm وبوابته
 * apiFetch مزيفة تسجّل كل رحلة، وشاشة 11 تُقرأ كعقد مصدر (testEnvironment:'node').
 *
 * المثبَّت هنا:
 *   • بوابة كتابة الأجهزة مرآة لثابت الخادم الحرفي (routes.js:31 WRITE_ROLES
 *     = admin|hr) — لو غيّر أحدهما دون الآخر يسقط الاختبار
 *   • أبواب الشاشة الأربعة تطابق الراوتر مسارًا وطريقة: GET /zkteco/status،
 *     GET /zkteco/devices، POST /zkteco/devices/:id/test،
 *     POST /zkteco/devices/:id/sync — ولا باب ثالث في المستودع
 *   • commKey (اعتماد الجهاز) لا يخرج من deviceToRow أبدًا — لا مخفيّاً ولا
 *     title ولا نصاً: السلسلة كلها بلا الكلمة
 *   • المزامنة وحدها يسوّقها confirm، والاختبار نبضة بلا سؤال — والشاشة
 *     لا تملك fetch ولا inline handler (CSP)، وحارس isConnected مكتوب
 *   • الأسماء المجهولة تُعرض raw (#id) ولا تُخترع — deviceToRow يعيد الاسم
 *     الخام مع nameResolved=false والشاشة تميّزه بصرياً لا نصّياً
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const APP = path.join(__dirname, '..', 'frontend', 'app');
const V2 = path.join(APP, 'js', 'v2');
const REPO = path.join(V2, 'data', 'zkteco-repo.js');
const SCREEN = path.join(V2, 'screens', 'zkteco.js');
const SERVER = path.join(__dirname, '..', 'backend', 'zkteco', 'routes.js');

const read = (p) => fs.readFileSync(p, 'utf8');

/** يحمّل وحدة ESM في vm بعد نزع الاستيرادات وكلمة export — نمط الموجات السابقة. */
function loadEsm(file, injections = {}, collect = []) {
    const stripped = read(file)
        .split('\n')
        .filter((line) => !/^\s*import\b|^\s*from\s*'[^']*';?\s*$/.test(line))
        .join('\n')
        .replace(/^export\s+/gm, '');
    const src = collect.length
        ? `${stripped}\n;Object.assign(globalThis, {${collect.join(', ')}});`
        : stripped;
    const context = {
        console, JSON, String, Number, Boolean, Array, Object, RegExp, Error,
        Date, Math, Promise, Set, Map, Intl, encodeURIComponent,
        ...injections,
    };
    vm.createContext(context);
    vm.runInContext(src, context, { filename: file });
    return context;
}

function repoStub(impl) {
    const calls = [];
    const apiFetch = jest.fn(async (p, opts) => {
        calls.push({ path: p, method: (opts && opts.method) || 'GET', opts: opts || {} });
        return impl ? impl(p, opts) : {};
    });
    return { apiFetch, calls };
}

function rolesOf(serverSrc, name) {
    const m = serverSrc.match(new RegExp(`const ${name} = \\[([^\\]]*)\\]`));
    expect(m).not.toBeNull();
    return m[1].split(',').map((s) => s.trim().replace(/['"]/g, '')).filter(Boolean);
}

describe('v2 شاشة 11 — أجهزة البصمة: مرآة الخادم', () => {
    const serverSrc = read(SERVER);

    test('بوابة كتابة الأجهزة مرآة لثابت الخادم WRITE_ROLES', async () => {
        const write = rolesOf(serverSrc, 'WRITE_ROLES');
        const readRoles = rolesOf(serverSrc, 'READ_ROLES');
        const ctx = loadEsm(REPO, {}, ['ZK_WRITE_ROLES']);
        expect(ctx.ZK_WRITE_ROLES).toEqual(write);
        expect(write).not.toEqual(readRoles); // القراءة أوسع — والتوثيق يقول ذلك
    });

    test('الأبواب الأربعة تطابق الراوتر مسارًا وطريقة — ولا باب ثالث', async () => {
        const { apiFetch, calls } = repoStub(() => ({}));
        const ctx = loadEsm(REPO, { apiFetch }, [
            'fetchZkStatus', 'fetchZkDevices', 'testDevice', 'syncDevice', 'deviceToRow',
        ]);
        await ctx.fetchZkStatus();
        await ctx.fetchZkDevices();
        await ctx.testDevice(7);
        await ctx.syncDevice('7');
        expect(calls).toEqual([
            { path: '/zkteco/status', method: 'GET', opts: {} },
            { path: '/zkteco/devices', method: 'GET', opts: {} },
            { path: '/zkteco/devices/7/test', method: 'POST', opts: { method: 'POST' } },
            { path: '/zkteco/devices/7/sync', method: 'POST', opts: { method: 'POST' } },
        ]);
        // المسارات نفسها مسماة في الراوتر حرفيًا
        expect(serverSrc).toContain("router.get('/status'");
        expect(serverSrc).toContain("router.get('/devices'");
        expect(serverSrc).toContain("router.post('/devices/:id/test'");
        expect(serverSrc).toContain("router.post('/devices/:id/sync'");
    });

    test('commKey لا يخرج من deviceToRow — لا قيمة ولا مفتاح ولا نص', () => {
        const ctx = loadEsm(REPO, {}, ['deviceToRow']);
        const row = ctx.deviceToRow({
            id: 1, name: 'المطبخ', ipAddress: '192.168.1.202', port: 4370,
            commKey: 'SECRET-KEY-123', enabled: 1, status: 'online',
            totalSynced: '1200', live: { syncing: true, consecutiveFailures: '3', lastError: 'timeout' },
        });
        const json = JSON.stringify(row);
        expect(json).not.toContain('commKey');
        expect(json).not.toContain('SECRET-KEY-123');
        expect(row.enabled).toBe(true);
        expect(row.nameResolved).toBe(true);
        expect(row.syncing).toBe(true);
        expect(row.failures).toBe(3);
    });

    test('الاسم المجهول يُعرض raw (#id) مع nameResolved=false — لا اختراع', () => {
        const ctx = loadEsm(REPO, {}, ['deviceToRow']);
        const row = ctx.deviceToRow({ id: 42 });
        expect(row.name).toBe('#42');
        expect(row.nameResolved).toBe(false);
    });

    test('summarizeDevices مشتق من الصفوف — صفر طلبات', () => {
        const ctx = loadEsm(REPO, {}, ['summarizeDevices']);
        const c = ctx.summarizeDevices([
            { status: 'online', enabled: true, syncing: true },
            { status: 'offline', enabled: true, syncing: false },
            { status: 'online', enabled: false, syncing: false },
        ]);
        expect(c).toEqual({ total: 3, online: 2, enabled: 2, syncing: 1 });
    });
});

describe('v2 شاشة 11 — عقد المصدر (CSP/تأكيد/هدم)', () => {
    const src = read(SCREEN);

    test('لا inline handler ولا fetch في الشاشة (CSP nonce + باب واحد)', () => {
        expect(src).not.toMatch(/\son(click|change|submit|keydown)=/i);
        expect(src).not.toMatch(/\bfetch\s*\(/);
    });

    test('المزامنة وحدها بتأكيد مسمّي والاختبار نبضة بلا سؤال', () => {
        expect(src).toMatch(/op === 'sync'/);
        expect(src).toContain('بدء مزامنة');
        // نية واحدة في كل لحظة
        expect(src).toMatch(/if \(saving\)\s*\{return;\}/);
    });

    test('حارس isConnected بعد كل انتظار — لا كتابة بعد الرحيل', () => {
        expect(src).toMatch(/if \(!el\.isConnected\)\s*\{return;\}/);
        expect(src).toContain('table.destroy()');
    });

    test('رسالة 401 منطوقة من مسار apiFetch نفسه (نص الموجات الموحد)', () => {
        expect(src).toContain('انتهت الجلسة — سجّل الدخول في النظام الحالي ثم أعد فتح الوضع الحيّ.');
        expect(src).toContain('القرار للخادم وحده');
    });

    test('أزرار التشغيل لا تُعرض إلا لبوابة الكتابة (writable)', () => {
        expect(src).toMatch(/\.\.\.\(writable \? \[\{/);
        expect(src).toContain('ZK_WRITE_ROLES');
    });
});
