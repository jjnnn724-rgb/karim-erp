/**
 * v2-users.test.js — عقد شاشة المستخدمين ومرآة خادمها
 * ═══════════════════════════════════════════════════════════════════════
 * المرجع: backend/server.js (generic CRUD + :1684-1695 قواعد users +
 *   :1349 ربط الموظف) + ops-inspect-routes.js:17 (الخزنة) +
 *   frontend/app/js/features/settings-users.js:596-716 (السلوك) +
 *   features/auth-navigation.js:85-94 (رمز الاستعادة).
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

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
    test('الأبواب الستة تطابق العقود مساراً وطريقة', async () => {
        const { apiFetch, calls } = repoStub(() => ({}));
        const ctx = loadEsm(REPO, { apiFetch }, [
            'createUser', 'updateUser', 'deleteUser', 'linkUserEmployee',
            'fetchUserPassword', 'issueUserResetCode',
        ]);
        await ctx.createUser({ username: 'k1', password: 'Abcd1234', role: 'cashier', name: 'كاشير 1', active: true });
        await ctx.updateUser(5, { name: 'كاشير 1' });
        await ctx.deleteUser(5);
        await ctx.linkUserEmployee(5, 9);
        await ctx.fetchUserPassword(5);
        await ctx.issueUserResetCode('k1');
        expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
            'POST /users',
            'PUT /users/5',
            'DELETE /users/5',
            'PUT /users/5/employee',
            'GET /users/5/password',
            'POST /auth/forgot-password/request-code',
        ]);
        expect(JSON.parse(calls[3].body)).toEqual({ employeeId: 9 });
        expect(JSON.parse(calls[5].body)).toEqual({ username: 'k1' });
    });

    test('قوة كلمة المرور مرآة jwt-middleware (8+ حرف+رقم)', () => {
        const ctx = loadEsm(REPO, {}, ['isStrongPasswordV2', 'validateUserForm']);
        expect(ctx.isStrongPasswordV2('Abcd1234')).toBe(true);
        expect(ctx.isStrongPasswordV2('12345678')).toBe(false);
        expect(ctx.isStrongPasswordV2('Abcdefgh')).toBe(false);
        expect(ctx.isStrongPasswordV2('Ab1')).toBe(false);
        expect(ctx.validateUserForm({ name: 'س', username: 'u', password: 'Abcd1234', role: 'cashier' }).ok).toBe(true);
        expect(ctx.validateUserForm({ name: 'س', username: 'u', password: 'ضعيفة', role: 'cashier' }).errors)
            .toContain('كلمة المرور ضعيفة: 8 حروف على الأقل مع حرف ورقم');
        expect(ctx.validateUserForm({ name: 'س', username: 'u', role: 'cashier' }).errors)
            .toContain('كلمة المرور مطلوبة');
        expect(ctx.validateUserForm({ name: 'س', username: 'u', password: 'Abcd1234', role: 'dept_head', dept_code: '' }).errors)
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

    test('بوابة الأدمن + حماية الحساب الحالي + الخزنة والرمز', () => {
        const s = src();
        expect(s).toMatch(/هذه الصفحة للمدير فقط/);
        expect(s).toMatch(/لا يمكن حذف حسابك/);
        expect(s).toMatch(/data-v2-pw/);
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
