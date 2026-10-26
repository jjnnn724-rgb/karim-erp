/**
 * v2-portal.test.js — عقد P2-3: بوابة البصمة الذاتية في V2
 * ═══════════════════════════════════════════════════════════════════════
 * المرجع الخادمي: backend/attendance-portal-routes.js
 *   :151 punch · :475 punch/client-reject · :661 face/enroll · :703 enroll-v2
 * والقديم: features/mobile-shell.js:717-912 (البصمة) و:350-555 (الوجه).
 *
 * المثبَّت:
 *   • الأدوار مرآة requireRole حرفيًا (لا توسيع من الواجهة).
 *   • كل باب يُنادى بمساره وطريقته وحمولته بالضبط، ولا fetch/apiFetch في الشاشة.
 *   • رفض الجهاز يُرسل برمز من القائمة البيضاء وتفصيل مُطهَّر من HTML.
 *   • معرّف الجهاز بنفس مفتاح القديم فلا يُفكّ الربط بين الواجهتين.
 *   • الكتابة مزدوجة القفل: البصمة وراء v2portalwrite، والوجه وراء v2facewrite
 *     (كلاهما ظاهرٌ افتراضيًا بطلب المالك 2026-10-24، و`=0` يُخفيه).
 *   • الشاشة تحرس isConnected بعد كل انتظار، ولا معالج سطري (CSP).
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const APP = path.join(__dirname, '..', 'frontend', 'app');
const V2 = path.join(APP, 'js', 'v2');
const REPO = path.join(V2, 'data', 'portal-repo.js');
const SCREEN = path.join(V2, 'screens', 'employee-portal.js');
const FACE = path.join(V2, 'portal-face.js');
const SERVER = path.join(__dirname, '..', 'backend', 'attendance-portal-routes.js');
const V2_HTML = path.join(APP, 'v2.html');
const CSS = path.join(APP, 'css', 'v2', 'erp-portal.css');

const read = (p) => fs.readFileSync(p, 'utf8');
const REV = (read(V2_HTML).match(/js\/v2\/preview\.js\?v=([0-9.]+)/) || [])[1];

function loadEsm(file, injections = {}, collect = []) {
    const stripped = read(file)
        .replace(/^\s*import\b[\s\S]*?;\s*$/gm, '')
        .replace(/^export\s+/gm, '');
    const src = collect.length
        ? `${stripped}\n;Object.assign(globalThis, {${collect.join(', ')}});`
        : stripped;
    const context = {
        console, JSON, String, Number, Boolean, Array, Object, RegExp, Error,
        Date, Math, Promise, Set, Map, Intl, encodeURIComponent, URLSearchParams,
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

function rolesAfter(src, literal) {
    const idx = src.indexOf(literal);
    expect(idx).toBeGreaterThan(-1);
    const m = src.slice(idx).match(/requireRole\(([^)]*)\)/);
    expect(m).not.toBeNull();
    return m[1].split(',').map((s) => s.trim().replace(/['"]/g, '')).filter(Boolean);
}

const EXPORTS = [
    'fetchPortalStatus', 'fetchMyPunches', 'sanitizeClientDetail', 'reportClientReject',
    'punchPortal', 'enrollFaceV1', 'enrollFaceV2', 'removeFaceEnrollment',
    'portalDeviceId', 'faceV1Required', 'punchActionLabel', 'PUNCH_ROLES',
    'FACE_ENROLL_ROLES', 'CLIENT_REJECT_CODES', 'DEVICE_ID_KEY',
];

describe('P2-3 — المستودع مرآة الخادم حرفيًا', () => {
    const serverSrc = read(SERVER);

    test('أدوار البصمة والوجه = requireRole في الراوتر', () => {
        const ctx = loadEsm(REPO, {}, ['PUNCH_ROLES', 'FACE_ENROLL_ROLES']);
        expect(ctx.PUNCH_ROLES).toEqual(rolesAfter(serverSrc, "router.post('/punch',"));
        expect(ctx.FACE_ENROLL_ROLES).toEqual(rolesAfter(serverSrc, "router.post('/face/enroll',"));
        expect(ctx.FACE_ENROLL_ROLES).toEqual(rolesAfter(serverSrc, "router.post('/face/enroll-v2',"));
        expect(ctx.PUNCH_ROLES).toContain('employee');
        expect(ctx.FACE_ENROLL_ROLES).not.toContain('employee');
    });

    test('قائمة رفض الجهاز = CLIENT_REJECT_CODES في الخادم', () => {
        const block = serverSrc.slice(
            serverSrc.indexOf('const CLIENT_REJECT_CODES'),
            serverSrc.indexOf('router.post(\'/punch/client-reject\'')
        );
        const codes = [...block.matchAll(/'([A-Z_]+)'/g)].map((m) => m[1]);
        const ctx = loadEsm(REPO, {}, ['CLIENT_REJECT_CODES']);
        expect(ctx.CLIENT_REJECT_CODES).toEqual(codes);
    });

    test('كل الأبواب تُنادى بمسارها وطريقتها وحمولتها', async () => {
        const { apiFetch, calls } = repoStub();
        const ctx = loadEsm(REPO, { apiFetch }, EXPORTS);
        await ctx.fetchPortalStatus();
        await ctx.punchPortal({ deviceId: 'dev-1', location: null, intent: null });
        await ctx.reportClientReject('PUNCH_LOCATION_MOCKED_CLIENT', 'live:GPS clean');
        await ctx.enrollFaceV1(42, [[0.1, 0.2]]);
        await ctx.enrollFaceV2(42, ['data:image/jpeg;base64,AAA']);
        await ctx.removeFaceEnrollment(42);

        expect(calls).toEqual([
            { path: '/attendance/portal/status', method: 'GET', opts: {} },
            {
                path: '/attendance/portal/punch', method: 'POST',
                opts: { method: 'POST', body: '{"deviceId":"dev-1","location":null,"intent":null}' },
            },
            {
                path: '/attendance/portal/punch/client-reject', method: 'POST',
                opts: { method: 'POST', body: '{"reason":"PUNCH_LOCATION_MOCKED_CLIENT","detail":"live:GPS clean"}' },
            },
            {
                path: '/attendance/portal/face/enroll', method: 'POST',
                opts: { method: 'POST', body: '{"targetUserId":42,"descriptors":[[0.1,0.2]]}' },
            },
            {
                path: '/attendance/portal/face/enroll-v2', method: 'POST',
                opts: { method: 'POST', body: '{"targetUserId":42,"images":["data:image/jpeg;base64,AAA"]}' },
            },
            { path: '/attendance/portal/face/enroll/42', method: 'DELETE', opts: { method: 'DELETE' } },
        ]);

        for (const door of [
            "router.get('/status'",
            "router.post('/punch'",
            "router.post('/punch/client-reject'",
            "router.post('/face/enroll'",
            "router.post('/face/enroll-v2'",
            "router.delete('/face/enroll/:userId'",
        ]) {
            expect(serverSrc).toContain(door);
        }
    });

    test('رمز رفض غير معروف يُطَبَّع، والتفصيل يفقد كل حرف HTML', async () => {
        const { apiFetch, calls } = repoStub();
        const ctx = loadEsm(REPO, { apiFetch }, EXPORTS);
        const cleaned = ctx.sanitizeClientDetail('live:GPS <img src=x onerror=alert(1)>');
        expect(cleaned.startsWith('live:GPS')).toBe(true);
        expect(cleaned).not.toMatch(/[<>"'&()=]/);
        expect(ctx.sanitizeClientDetail('   ')).toBeNull();
        expect(ctx.sanitizeClientDetail('a'.repeat(200))).toHaveLength(120);

        await ctx.reportClientReject('SOMETHING_ELSE', '<b>drop</b>');
        const body = JSON.parse(calls[0].opts.body);
        expect(body.reason).toBe('PUNCH_CLIENT_REJECTED');
        expect(body.detail).toBe('bdropb');
        expect(body.detail).not.toContain('<');
    });

    test('معرّف الجهاز: نفس المفتاح، ويُولَّد مرة واحدة، ولا يرمي عند حجب التخزين', () => {
        const ctx = loadEsm(REPO, {}, ['portalDeviceId', 'DEVICE_ID_KEY']);
        expect(ctx.DEVICE_ID_KEY).toBe('punch_device_id');

        const saved = [];
        const existing = { getItem: () => 'existing-id', setItem: (k, v) => saved.push([k, v]) };
        expect(ctx.portalDeviceId(existing)).toBe('existing-id');
        expect(saved).toEqual([]);

        const store = { getItem: () => null, setItem: (k, v) => saved.push([k, v]) };
        const cryptoObj = { randomUUID: () => 'uuid-1' };
        const ctx2 = loadEsm(REPO, { crypto: cryptoObj }, ['portalDeviceId']);
        expect(ctx2.portalDeviceId(store)).toBe('uuid-1');
        expect(saved[0]).toEqual(['punch_device_id', 'uuid-1']);

        const ctx3 = loadEsm(REPO, { crypto: { randomUUID: () => 'uuid-2' } }, ['portalDeviceId']);
        const broken = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } };
        expect(ctx3.portalDeviceId(broken)).toBe('uuid-2');
    });

    test('faceV1Required: v2 لا يعفي من المتجه إلا بقالب v2 نشط', () => {
        const ctx = loadEsm(REPO, {}, ['faceV1Required', 'punchActionLabel']);
        expect(ctx.faceV1Required(null)).toBe(false);
        expect(ctx.faceV1Required({ faceEnabled: false })).toBe(false);
        expect(ctx.faceV1Required({ faceEnabled: true })).toBe(true);
        expect(ctx.faceV1Required({ faceEnabled: true, faceV2: { enabled: true, enrolled: false } })).toBe(true);
        expect(ctx.faceV1Required({ faceEnabled: true, faceV2: { enabled: false, enrolled: true } })).toBe(true);
        expect(ctx.faceV1Required({ faceEnabled: true, faceV2: { enabled: true, enrolled: true } })).toBe(false);
        expect(ctx.punchActionLabel('check_in')).toBe('✅ تم تسجيل الحضور');
        expect(ctx.punchActionLabel('check_out')).toBe('✅ تم تسجيل الانصراف');
        expect(ctx.punchActionLabel(undefined)).toBe('✅ تم تسجيل البصمة');
    });
});

describe('P2-3 — الشاشة: الأبواب موصولة والكتابة مزدوجة القفل', () => {
    const src = read(SCREEN);

    test('كل دالة باب مستوردة ومستدعاة — لا زر بلا باب', () => {
        for (const fn of [
            'fetchPortalStatus', 'punchPortal', 'reportClientReject',
            'enrollFaceV1', 'enrollFaceV2', 'removeFaceEnrollment', 'portalDeviceId',
            'captureFace',
        ]) {
            expect(src).toContain(fn);
        }
        expect(src).toMatch(/from '\.\.\/data\/portal-repo\.js\?v=/);
        expect(src).toMatch(/from '\.\.\/portal-face\.js\?v=/);
    });

    test('البصمة وراء الدور + v2portalwrite، والوجه وراء admin/hr + v2facewrite', () => {
        expect(src).toMatch(/import \{ portalWriteEnabled, faceWriteEnabled \} from '\.\.\/write-flags\.js\?v=/);
        expect(src).toMatch(/canWrite\(ctx\.role, PUNCH_ROLES\) && portalWriteEnabled\(\)/);
        expect(src).toMatch(/canWrite\(ctx\.role, FACE_ENROLL_ROLES\) && faceWriteEnabled\(\)/);
        expect(src).toMatch(/if \(!canPunch\)/);
        expect(src).toMatch(/if \(!canFace\) \{ return ''; \}/);
        // زر البصمة لا يُبنى إلا في فرع الكتابة المفتوح
        expect(src).toMatch(/data-v2-punch/);
        expect(src).toMatch(/punchBusy \|\| faceBusy|if \(!canPunch \|\| punchBusy\)/);
        expect(src).toMatch(/if \(!canFace \|\| faceBusy\)/);
    });

    test('رفض الجهاز يُوثَّق بالرمزين المسموحين — لا رفض صامت', () => {
        expect(src).toContain("reportClientReject('PUNCH_LOCATION_MOCKED_CLIENT'");
        expect(src).toContain("reportClientReject('PUNCH_LOCATION_UNAVAILABLE_CLIENT'");
        expect(src).toContain("['MOCK_APP_SELECTED']");
        expect(src).toContain('navigator.onLine === false');
    });

    test('تحصين الموقع: 6 قراءات خلال 9 ثوانٍ ومحاولة ثانية عند الفشل التام', () => {
        expect(src).toMatch(/const GEO_TARGET = 6;/);
        expect(src).toMatch(/const GEO_SESSION_MS = 9000;/);
        expect(src).toMatch(/if \(!fixes\) \{ fixes = await once\(\); \}/);
        expect(src).toMatch(/enableHighAccuracy: true, maximumAge: 0/);
    });

    test('الوجه: v1 يحصل على المتجه، وv2 على اللقطة', () => {
        expect(src).toContain('requireDescriptor: faceV1Required(s)');
        expect(src).toContain('payload.faceDescriptor = face.descriptors[0]');
        expect(src).toContain('payload.faceImage = face.images[0]');
        expect(src).toContain('target: 5');
        expect(src).toContain('faceEnrollMessage(saved)');
        expect(src).toContain('تم تسجيل الوجه بالمحركين');
        expect(src).toContain("window.confirm('إزالة قالب الوجه لهذا الموظف؟')");
        expect(src).toContain('data-v2-face-user');
    });

    test('لا شبكة مباشرة ولا معالج سطري (CSP)', () => {
        const noComments = src.replace(/\/\*[\s\S]*?\*\//g, '');
        expect(noComments).not.toMatch(/\bapiFetch\b/);
        expect(noComments).not.toMatch(/[^a-zA-Z]fetch\(/);
        expect(noComments).not.toMatch(/\son(click|change|submit|keydown|input)=/i);
    });

    test('حارس isConnected بعد الانتظار — لا كتابة بعد الرحيل', () => {
        expect((src.match(/if \(!el\.isConnected\)/g) || []).length).toBeGreaterThanOrEqual(10);
    });

    test('الوحدة الموحدة: كل استيراد يحمل نسخة الصفحة', () => {
        expect(REV).toBeTruthy();
        const versions = [...src.matchAll(/\?v=([0-9.]+)/g)].map((m) => m[1]);
        expect(versions.length).toBeGreaterThan(0);
        for (const v of versions) {expect(v).toBe(REV);}
    });
});

describe('P2-3 — كاميرا الوجه: محلية ونظيفة', () => {
    const src = read(FACE);

    test('face-api محلي من vendor — لا CDN يخالف CSP', () => {
        expect(src).toContain("const FACE_API_SRC = 'vendor/face-api.js?v=4.9.77'");
        expect(src).toContain("const FACE_MODELS_URI = 'vendor/face-models'");
        expect(src).not.toMatch(/https?:\/\//);
    });

    test('لا شبكة بيانات ولا معالج سطري، والحد الأقصى 8 عينات', () => {
        expect(src).not.toMatch(/\bapiFetch\b/);
        expect(src).not.toMatch(/[^a-zA-Z]fetch\(/);
        expect(src).not.toMatch(/\son(click|change|submit|keydown|input)=/i);
        expect(src).toContain('const MAX_SAMPLES = 8;');
        expect(src).toContain("new Error('FACE_CANCELLED')");
    });

    test('التنظيف يوقف كل مسار كاميرا ويُزيل العقدة، والإغلاق من X وحده', () => {
        expect(src).toMatch(/getTracks\(\)\.forEach\(\(track\) => track\.stop\(\)\)/);
        expect(src).toContain('host.remove()');
        expect(src).toContain('data-face-cancel aria-label="إغلاق الكاميرا"');
        expect(src).toContain('erp-modal-x');
        expect(src).not.toContain("event.key === 'Escape'");
        expect(src).not.toContain("document.addEventListener('keydown', onKey)");
    });
});

describe('P2-3 — الربط البصري', () => {
    test('الصفحة تربط erp-portal.css بنسخة الصفحة', () => {
        expect(REV).toBeTruthy();
        expect(read(V2_HTML)).toContain(`css/v2/erp-portal.css?v=${REV}`);
    });

    test('CSS بلا hex أو px خام وكل قواعده مُختصة', () => {
        const css = read(CSS).replace(/\/\*[\s\S]*?\*\//g, '');
        expect(css).not.toMatch(/#[0-9a-f]{3,8}\b/i);
        // نقطة الكسر داخل @media وحدها بلا رمز (لا تقبل متغيّرات CSS)
        expect(css.replace(/@media[^{]*/g, '@media')).not.toMatch(/\b\d+px\b/);
        const selectors = [...css.matchAll(/^[ \t]*([.][^{@]*)\{/gm)].map((m) => m[1].trim());
        expect(selectors.length).toBeGreaterThan(0);
        for (const sel of selectors) {
            expect(sel.startsWith('.erp-v2-eportal') || sel.startsWith('.erp-face-cam')).toBe(true);
        }
    });

    test('رأس كشف الحضور ينثني على 360 فلا يدفع الصفحة أفقًا', () => {
        expect(read(SCREEN)).toContain('erp-card__head erp-portal-report__head');
        const css = read(CSS).replace(/\/\*[\s\S]*?\*\//g, '');
        expect(css).toMatch(/\.erp-v2-eportal \.erp-portal-report__head \{[^}]*flex-wrap: wrap/);
        expect(css).toMatch(/\.erp-v2-eportal \.erp-portal-report__head \.erp-input \{[^}]*flex: 1 1 100%/);
        expect(css).toMatch(/\.erp-v2-eportal \.erp-portal-report__head \.erp-grow \{[^}]*display: none/);
    });
});
