/**
 * v2-permissions.test.js — عقد شاشة الصلاحيات ومرآة خادمها
 * ═══════════════════════════════════════════════════════════════════════
 * المرجع: backend/permission-routes.js — admin حصرًا في الأبواب الثلاثة
 * (:28/:40/:58)، والمنح تراكمية فوق الدور، وهدف admin مرفوض 422
 * ADMIN_HAS_ALL، وdenies=null تعني لا تغيير على السحب (:67-69).
 * المرجع الثاني: frontend/app/js/features/permissions.js (116 سطرًا) —
 * اختيار مستخدم ← منح/سحب/وراثة ← حفظ بسبب ← تدقيق (آخر 50).
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const APP = path.join(__dirname, '..', 'frontend', 'app');
const V2 = path.join(APP, 'js', 'v2');
const REPO = path.join(V2, 'data', 'permissions-repo.js');
const SCREEN = path.join(V2, 'screens', 'permissions.js');
const SERVER = path.join(__dirname, '..', 'backend', 'permission-routes.js');
const V2_HTML = path.join(APP, 'v2.html');
const HOST = path.join(V2, 'preview.js');
const REV = (fs.readFileSync(V2_HTML, 'utf8').match(/js\/v2\/preview\.js\?v=([0-9.]+)/) || [])[1];

const read = (p) => fs.readFileSync(p, 'utf8');

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
        calls.push({ path: p, method: (opts && opts.method) || 'GET', body: opts && opts.body });
        return impl ? impl(p, opts) : {};
    });
    return { apiFetch, calls };
}

describe('الصلاحيات — مرآة الخادم', () => {
    const srv = read(SERVER);

    test('البوابة admin حصراً في الأبواب الثلاثة', () => {
        expect(srv).toMatch(/const ADMIN_ONLY = \['admin'\]/);
        expect(srv.match(/requireRole\(\.\.\.ADMIN_ONLY\)/g).length).toBe(3);
        const ctx = loadEsm(REPO, {}, ['PERM_WRITE_ROLES']);
        expect(ctx.PERM_WRITE_ROLES).toEqual(['admin']);
    });

    test('الأبواب الثلاثة تطابق الراوتر مساراً وطريقة', async () => {
        const { apiFetch, calls } = repoStub(() => ({}));
        const ctx = loadEsm(REPO, { apiFetch }, [
            'fetchPermCatalog', 'fetchUserPerms', 'saveUserPerms',
        ]);
        await ctx.fetchPermCatalog();
        await ctx.fetchUserPerms(7);
        await ctx.saveUserPerms(7, { grants: ['dispatch.view'], denies: [], reason: 'تشغيل' });
        expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
            'GET /permissions/catalog',
            'GET /permissions/users/7',
            'PUT /permissions/users/7',
        ]);
        const putBody = JSON.parse(calls[2].body);
        expect(putBody.grants).toEqual(['dispatch.view']);
        expect(putBody.denies).toEqual([]);
        expect(putBody.reason).toBe('تشغيل');
    });

    test('denies=null لا تُرسل — عقد الخادم (لا تغيير على السحب)', async () => {
        const { apiFetch, calls } = repoStub(() => ({}));
        const ctx = loadEsm(REPO, { apiFetch }, ['saveUserPerms']);
        await ctx.saveUserPerms(7, { grants: [], denies: null });
        const putBody = JSON.parse(calls[0].body);
        expect('denies' in putBody).toBe(false);
    });

    test('الخادم يرفض هدف admin — والشاشة لا تعرض له حفظًا', () => {
        expect(srv).toMatch(/ADMIN_HAS_ALL/);
        const s = read(SCREEN);
        expect(s).toMatch(/target\.role === 'admin'/);
        expect(s).toMatch(/يملك كل الصلاحيات — لا حاجة لمنح/);
    });

    test('التدقيق آخر 50 من الخادم — والشاشة تعرضه بشاراته', () => {
        expect(srv).toMatch(/ORDER BY id DESC LIMIT 50/);
        const s = read(SCREEN);
        expect(s).toMatch(/سجل التدقيق \(آخر 50\)/);
        const ctx = loadEsm(REPO, {}, ['auditActionLabel']);
        expect(ctx.auditActionLabel('grant')).toEqual({ label: 'منح', tone: 'success' });
        expect(ctx.auditActionLabel('deny')).toEqual({ label: 'سحب', tone: 'danger' });
        expect(ctx.auditActionLabel('undeny')).toEqual({ label: 'إلغاء سحب', tone: 'info' });
        expect(ctx.auditActionLabel('revoke')).toEqual({ label: 'سحب منح', tone: 'danger' });
    });
});

describe('الصلاحيات — منطق المستودع النقي', () => {
    test('groupCatalog يجمع بنفس ترتيب الورود', () => {
        const ctx = loadEsm(REPO, {}, ['groupCatalog']);
        const groups = ctx.groupCatalog([
            { key: 'a', group: 'التشغيل' },
            { key: 'b', group: 'المالية' },
            { key: 'c', group: 'التشغيل' },
        ]);
        expect(groups.map((g) => g.name)).toEqual(['التشغيل', 'المالية']);
        expect(groups[0].items.map((i) => i.key)).toEqual(['a', 'c']);
    });

    test('permMode: السحب يغلب المنح يغلب الوراثة', () => {
        const ctx = loadEsm(REPO, {}, ['permMode']);
        expect(ctx.permMode('k', new Set(['k']), new Set(['k']))).toBe('deny');
        expect(ctx.permMode('k', new Set(['k']), new Set())).toBe('grant');
        expect(ctx.permMode('k', new Set(), new Set())).toBe('inherit');
    });

    test('fetchPermissionUsers: النشطون بترتيب عربي', async () => {
        const { apiFetch } = repoStub(() => ({}));
        const fetchUsers = jest.fn(async () => [
            { id: 2, username: 'b', name: 'كاشير', role: 'cashier', active: true },
            { id: 1, username: 'a', name: 'مدير', role: 'admin', active: true },
            { id: 3, username: 'c', name: 'موقوف', role: 'cashier', active: false },
        ]);
        const ctx = loadEsm(REPO, { apiFetch, fetchUsers, userToRow: (u = {}) => ({ ...u }) }, ['fetchPermissionUsers']);
        const list = await ctx.fetchPermissionUsers();
        expect(list.map((u) => u.id)).toEqual([2, 1]);
    });
});

describe('الصلاحيات — عقد الشاشة من المصدر', () => {
    const src = () => read(SCREEN);

    test('لا شبكة من الشاشة: الباب الواحد فقط', () => {
        const s = src().replace(/\/\*[\s\S]*?\*\//g, '');
        expect(s).not.toMatch(/\bapiFetch\b/);
        expect(s).not.toMatch(/\bfetch\(/);
        expect(s).toMatch(/from '\.\.\/data\/permissions-repo\.js\?v=/);
        expect(s).not.toMatch(/['"`]\/permissions/);
    });

    test('لا معالج سطري — التفويض وحده', () => {
        const s = src();
        expect(s.match(/\son[a-z]+=/g) || []).toHaveLength(0);
        expect(s).not.toMatch(/window\.(prompt|alert)\(/);
    });

    test('بوابة الأدمن + سبب الحفظ + عدّاد التغييرات', () => {
        const s = src();
        expect(s).toMatch(/canWrite\(ctx\.role, PERM_WRITE_ROLES\)/);
        expect(s).toMatch(/صفحة الصلاحيات للمدير العام فقط/);
        expect(s).toMatch(/data-v2-reason/);
        expect(s).toMatch(/تغييرات غير محفوظة/);
        expect(s).toMatch(/confirmFn\(/);
    });

    test('نسخة الوحدة الموحدة — لا stale خلف الكاش', () => {
        expect(REV).toBeTruthy();
        for (const f of [REPO, SCREEN]) {
            const versions = [...read(f).matchAll(/\?v=([0-9.]+)/g)].map((m) => m[1]);
            expect(versions.length).toBeGreaterThan(0);
            for (const v of versions) {expect(v).toBe(REV);}
        }
    });

    test('المضيف يربط المفتاح: استيراد + متغير + تفكيك + رسم + توجيه', () => {
        const h = read(HOST);
        expect(h).toMatch(/import \{ mountPermissionsScreen \} from '\.\/screens\/permissions\.js\?v=/);
        expect(h).toMatch(/let permissionsScreen = null;/);
        expect(h).toMatch(/function teardownPermissionsScreen\(\)/);
        expect(h).toMatch(/key: 'permissions', title: 'الصلاحيات', mount: mountPermissionsScreen/);
        expect(h).toMatch(/if \(key === 'permissions'\)/);
    });
});
