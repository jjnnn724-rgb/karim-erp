/**
 * v2-shell.test.js — عقد إضافات القشرة + إصلاح عملة الموجز
 * ═══════════════════════════════════════════════════════════════════════
 * المرجع: index.html (الجرس/FAB/اللغة/عدم الاتصال) + app.js:269-331
 * (الجرس للأدمن) + auth-navigation.js:395 (اللغة) + middleware/health.js.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const APP = path.join(__dirname, '..', 'frontend', 'app');
const V2 = path.join(APP, 'js', 'v2');
const REPO = path.join(V2, 'data', 'shell-repo.js');
const EXTRAS = path.join(V2, 'layout', 'shell-extras.js');
const HOST = path.join(V2, 'preview.js');
const BREPO = path.join(V2, 'data', 'briefing-repo.js');
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
        Date, Math, Promise, Set, Map, Intl, FormData, encodeURIComponent,
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

describe('القشرة — الأبواب', () => {
    test('الجرس والصحة وكلمة المرور بنفس المسارات', async () => {
        const { apiFetch, calls } = repoStub(() => ({ notifications: [], unread_count: 0 }));
        const ctx = loadEsm(REPO, { apiFetch }, [
            'fetchNotifications', 'markNotificationsRead', 'markAllNotificationsRead',
            'clearNotifications', 'changePassword',
        ]);
        await ctx.fetchNotifications();
        await ctx.markNotificationsRead([3]);
        await ctx.markAllNotificationsRead();
        await ctx.clearNotifications();
        await ctx.changePassword({ current_password: 'a', new_password: 'Abcd1234' });
        expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
            'GET /notifications',
            'POST /notifications/read',
            'POST /notifications/read-all',
            'DELETE /notifications',
            'POST /auth/change-password',
        ]);
        expect(JSON.parse(calls[1].body)).toEqual({ ids: [3] });
        expect(JSON.parse(calls[4].body)).toEqual({ current_password: 'a', new_password: 'Abcd1234' });
    });

    test('الصحة بلا مصادقة مسبقة — والسقوط معلن', async () => {
        const { apiFetch } = repoStub(() => { throw new Error('down'); });
        const ctx = loadEsm(REPO, { apiFetch }, ['fetchHealth']);
        const h = await ctx.fetchHealth();
        expect(h.ok).toBe(false);
        expect(h.server).toBe(false);
    });
});

describe('القشرة — عقد الوحدة', () => {
    const src = () => read(EXTRAS);

    test('العناصر الستة حاضرة بنفس أدوار القديم', () => {
        const s = src();
        for (const k of ['karim_lang', 'data-v2-bell', 'data-v2-notif-readall',
            'erp-lamp', 'data-v2-quick="pos"', 'data-v2-quick="menu-board"',
            'data-v2-quick="dispatch"', 'data-v2-fab-go', 'data-v2-pw-go',
            'erp-offline-bar', 'mountBoundary', 'FAB_ACTIONS']) {
            expect(s).toContain(k);
        }
        expect(s).toContain("'admin', 'manager', 'hr', 'accountant', 'dept_head'");
    });

    test('بلا شبكة مباشرة ولا معالج سطري', () => {
        const s = src().replace(/\/\*[\s\S]*?\*\//g, '');
        expect(s).not.toMatch(/\bapiFetch\b/);
        expect(s).not.toMatch(/[^a-zA-Z]fetch\(/);
        expect(s.match(/\son[a-z]+\s*=\s*["']/g) || []).toHaveLength(0);
    });

    test('المضيف يركّب الإضافات ويحدّثها مع الجلسة', () => {
        const h = read(HOST);
        expect(h).toMatch(/import \{ mountShellExtras \} from '\.\/layout\/shell-extras\.js\?v=/);
        expect(h).toMatch(/mountShellExtras\(shell, \{/);
        expect(h).toMatch(/shellExtras\.refresh\(\)/);
    });

    test('الوحدة الموحدة', () => {
        expect(REV).toBeTruthy();
        for (const f of [REPO, EXTRAS]) {
            const versions = [...read(f).matchAll(/\?v=([0-9.]+)/g)].map((m) => m[1]);
            expect(versions.length).toBeGreaterThan(0);
            for (const v of versions) {expect(v).toBe(REV);}
        }
    });
});

describe('الموجز — العملة من الإعدادات', () => {
    test('buildKpis يقبل العملة ويبقي الافتراضي', () => {
        const ctx = loadEsm(BREPO, {}, ['buildKpis']);
        const b = { cashiersTotal: { invoices: 0 } };
        const withCur = ctx.buildKpis(b, {}, 'ج.م');
        expect(withCur.filter((k) => k.unit === 'ج.م').length).toBeGreaterThan(0);
        const def = ctx.buildKpis(b, {});
        expect(def.filter((k) => k.unit === 'ر.س').length).toBeGreaterThan(0);
        expect(JSON.stringify(withCur)).not.toMatch('ر.س');
    });
});
