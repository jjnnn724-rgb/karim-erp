/**
 * v2-users.test.js — عقد شاشة المستخدمين ومرآة خادمها
 * ═══════════════════════════════════════════════════════════════════════
 * المرجع: backend/server.js (generic CRUD + :1684-1695 قواعد users +
 *   :1349 ربط الموظف) + frontend/app/js/features/settings-users.js:596-716
 *   (السلوك) + features/auth-navigation.js:85-94 (رمز الاستعادة).
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

jest.mock('../backend/cashier-module/jwt-middleware', () => ({
    jwtAuth: (req, res, next) => next(),
    requireRole: () => (req, res, next) => next(),
}));
jest.mock('../backend/shared-pool', () => ({ pool: { query: jest.fn() } }));
jest.mock('../backend/logger', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() } }));

const APP = path.join(__dirname, '..', 'frontend', 'app');
const V2 = path.join(APP, 'js', 'v2');
const REPO = path.join(V2, 'data', 'users-repo.js');
const SCREEN = path.join(V2, 'screens', 'users.js');
const V2_HTML = path.join(APP, 'v2.html');
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

describe('المستخدمون — مرآة الخادم', () => {
    test('الأبواب الخمسة تطابق العقود مساراً وطريقة', async () => {
        const { apiFetch, calls } = repoStub(() => ({}));
        const ctx = loadEsm(REPO, { apiFetch }, [
            'createUser', 'updateUser', 'deleteUser', 'linkUserEmployee',
            'issueUserResetCode',
        ]);
        await ctx.createUser({ username: 'k1', password: 'Abcd1234', role: 'cashier', name: 'كاشير 1', active: true });
        await ctx.updateUser(5, { name: 'كاشير 1' });
        await ctx.deleteUser(5);
        await ctx.linkUserEmployee(5, 9);
        await ctx.issueUserResetCode('k1');
        expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
            'POST /users',
            'PUT /users/5',
            'DELETE /users/5',
            'PUT /users/5/employee',
            'POST /auth/forgot-password/request-code',
        ]);
        expect(JSON.parse(calls[3].body)).toEqual({ employeeId: 9 });
        expect(JSON.parse(calls[4].body)).toEqual({ username: 'k1' });
    });

    test('قوة كلمة المرور مرآة jwt-middleware (12+ حرف+رقم)', () => {
        const ctx = loadEsm(REPO, {}, ['isStrongPasswordV2', 'validateUserForm']);
        expect(ctx.isStrongPasswordV2('Abcd12345678')).toBe(true);
        expect(ctx.isStrongPasswordV2('Abcd1234')).toBe(false);
        expect(ctx.isStrongPasswordV2('123456789012')).toBe(false);
        expect(ctx.isStrongPasswordV2('Abcdefghijkl')).toBe(false);
        expect(ctx.isStrongPasswordV2('Ab1')).toBe(false);
        expect(ctx.validateUserForm({ name: 'س', username: 'u', password: 'Abcd12345678', role: 'cashier' }).ok).toBe(true);
        expect(ctx.validateUserForm({ name: 'س', username: 'u', password: 'ضعيفة', role: 'cashier' }).errors)
            .toContain('كلمة المرور ضعيفة: 12 حرفًا على الأقل مع حرف ورقم');
        expect(ctx.validateUserForm({ name: 'س', username: 'u', role: 'cashier' }).errors)
            .toContain('كلمة المرور مطلوبة');
        expect(ctx.validateUserForm({ name: 'س', username: 'u', password: 'Abcd12345678', role: 'dept_head', dept_code: '' }).errors)
            .toContain('اختر قسمًا واحدًا على الأقل لرئيس القسم');
        expect(ctx.validateUserForm({ name: 'س', role: 'cashier' }, { isEdit: true }).ok).toBe(true);
    });
});

describe('المستخدمون — عقد الشاشة من المصدر', () => {
    const src = () => read(SCREEN);

    test('لا شبكة من الشاشة: الباب الواحد فقط', () => {
        const s = src().replace(/\/\*[\s\S]*?\*\//g, '');
        expect(s).not.toMatch(/\bapiFetch\b/);
        expect(s).not.toMatch(/[^a-zA-Z]fetch\(/);
        expect(s).toMatch(/from '\.\.\/data\/users-repo\.js\?v=/);
        expect(s).not.toMatch(/['"`]\/users/);
        expect(s).not.toMatch(/['"`]\/auth\//);
    });

    test('لا معالج سطري ولا حوار حاجب', () => {
        const s = src().replace(/\/\*[\s\S]*?\*\//g, '');
        expect(s.match(/\son[a-z]+=/g) || []).toHaveLength(0);
        expect(s).not.toMatch(/window\.(prompt|alert)\(/);
        expect(s).not.toMatch(/\bprompt\(/);
    });

    test('بوابة الأدمن + حماية الحساب الحالي + الرمز', () => {
        const s = src();
        expect(s).toMatch(/هذه الصفحة للمدير فقط/);
        expect(s).toMatch(/لا يمكن تعطيل حسابك/);
        expect(s).toMatch(/data-v2-reset/);
        expect(s).toMatch(/data-v2-del/);
        expect(s).toMatch(/username.*readonly|readonly.*username/s);
    });

    test('نسخة الوحدة الموحدة — لا stale خلف الكاش', () => {
        expect(REV).toBeTruthy();
        for (const f of [REPO, SCREEN]) {
            const versions = [...read(f).matchAll(/\?v=([0-9.]+)/g)].map((m) => m[1]);
            expect(versions.length).toBeGreaterThan(0);
            for (const v of versions) {expect(v).toBe(REV);}
        }
    });
});

describe('استرجاع كلمة المرور — أُغلق نهائيًا', () => {
    test('لا مسار GET /api/users/:id/password في الخادم', () => {
        const ops = require('../backend/ops-inspect-routes');
        const routes = [];
        const app = { get: (p) => routes.push(p) };
        ops.register(app, { metrics: { snapshot: () => ({}) } });
        expect(routes).toEqual(['/api/metrics', '/api/schema/constraints']);
        expect(routes.some((p) => /users\/:id\/password/.test(p))).toBe(false);
    });

    test('لا واجهة كشف في V2 ولا في القديم', () => {
        const legacy = read(path.join(APP, 'js', 'features', 'settings-users.js'));
        for (const s of [read(REPO), read(SCREEN), legacy]) {
            expect(s).not.toMatch(/users\/:id\/password|fetchUserPassword|viewPassword|viewUserPassword/);
        }
        expect(read(SCREEN)).not.toMatch(/data-v2-pw/);
    });

    test('لا كتابة جديدة في password_vault ولا فك تشفير', () => {
        const files = [
            'backend/server.js',
            'backend/cashier-module/jwt-middleware.js',
            'backend/cashier-module/password-recovery-routes.js',
            'backend/ops-inspect-routes.js',
        ].map((f) => read(path.join(__dirname, '..', f)));
        for (const s of files) {
            expect(s).not.toMatch(/UPDATE users SET password_vault|decryptFromVault|encryptForVault/);
        }
    });

    test('بيانات كلمات المرور محفوظة — لا تصفير ولا حذف لـ password_vault', () => {
        const rootDir = path.join(__dirname, '..');
        const skip = new Set(['node_modules', 'backups', 'uploads', 'logs']);
        const bad = [];
        const walk = (dir) => {
            for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
                if (skip.has(e.name)) { continue; }
                const p = path.join(dir, e.name);
                if (e.isDirectory()) { walk(p); continue; }
                if (!/\.(js|sql)$/.test(e.name)) { continue; }
                if (fs.statSync(p).size > 2 * 1024 * 1024) { continue; }
                if (/password_vault\s*=\s*(?:NULL|'')|DROP\s+COLUMN\s+(?:IF\s+EXISTS\s+)?password_vault/i.test(read(p))) {
                    bad.push(path.relative(rootDir, p));
                }
            }
        };
        walk(path.join(rootDir, 'backend'));
        walk(path.join(rootDir, 'database', 'migrations'));
        expect(bad).toEqual([]);
    });
});
