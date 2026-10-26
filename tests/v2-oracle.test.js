/**
 * v2-oracle.test.js — عقد شاشتي بيانات Oracle والتقفيل اليومي
 * ═══════════════════════════════════════════════════════════════════════
 * المرجع: backend/yarasoft/oracle-data-routes.js (:18/:47/:63/:125) +
 * yara-reports.js:477 + features/whatsapp.js:362-508.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const APP = path.join(__dirname, '..', 'frontend', 'app');
const V2 = path.join(APP, 'js', 'v2');
const REPO = path.join(V2, 'data', 'oracle-repo.js');
const SORA = path.join(V2, 'screens', 'oracle-data.js');
const SLOCK = path.join(V2, 'screens', 'daily-locks.js');
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

describe('بيانات Oracle — الأبواب', () => {
    test('الجداول والمحتوى والمزامنة والتقفيل بنفس المسارات', async () => {
        const { apiFetch, calls } = repoStub(() => ({ ok: true, tables: [], rows: [], columns: [] }));
        const ctx = loadEsm(REPO, { apiFetch }, [
            'fetchOraTables', 'refreshOraTables', 'fetchOraTable', 'fetchDailyLocks',
        ]);
        await ctx.fetchOraTables();
        await ctx.refreshOraTables();
        await ctx.fetchOraTable('ora_cc_bills', { page: 2, limit: 50, search: 's' });
        await ctx.fetchDailyLocks('2026-10-15');
        expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
            'GET /oracle-data/tables',
            'POST /oracle-data/refresh',
            'GET /oracle-data/cc_bills?page=2&limit=50&search=s',
            'GET /yara-reports/daily-locks?date=2026-10-15',
        ]);
    });

    test('مجاميع التقفيل من الصفوف نفسها', () => {
        const { apiFetch } = repoStub(() => ({
            ok: true, date: '2026-10-15', locked: 3, unlocked: 1,
            rows: [{ net: 100, invoices: 2 }, { net: 50, invoices: 1 }],
        }));
        const ctx = loadEsm(REPO, { apiFetch }, ['fetchDailyLocks']);
        return ctx.fetchDailyLocks('2026-10-15').then((d) => {
            expect(d.totalNet).toBe(150);
            expect(d.totalInv).toBe(3);
        });
    });
});

describe('بيانات Oracle — عقد الشاشتين', () => {
    test('بلا شبكة مباشرة ولا معالج سطري', () => {
        for (const f of [SORA, SLOCK]) {
            const s = read(f).replace(/\/\*[\s\S]*?\*\//g, '');
            expect(s).not.toMatch(/\bapiFetch\b/);
            expect(s).not.toMatch(/[^a-zA-Z]fetch\(/);
            expect(s.match(/\son[a-z]+\s*=\s*["']/g) || []).toHaveLength(0);
        }
        expect(read(SORA)).toMatch(/from '\.\.\/data\/oracle-repo\.js\?v=/);
        expect(read(SLOCK)).toMatch(/from '\.\.\/data\/oracle-repo\.js\?v=/);
    });

    test('الوظائف حاضرة: بحث/تفاصيل/ترقيم/طباعة/تاريخ', () => {
        const a = read(SORA);
        for (const k of ['data-v2-search', 'data-v2-open', 'data-v2-dprev', 'data-v2-dnext', 'data-v2-print']) {
            expect(a).toContain(k);
        }
        expect(read(SLOCK)).toContain('data-v2-date');
    });

    test('الوحدة الموحدة', () => {
        expect(REV).toBeTruthy();
        for (const f of [REPO, SORA, SLOCK]) {
            const versions = [...read(f).matchAll(/\?v=([0-9.]+)/g)].map((m) => m[1]);
            expect(versions.length).toBeGreaterThan(0);
            for (const v of versions) {expect(v).toBe(REV);}
        }
    });

    test('المضيف يربط المفتاحين', () => {
        const h = read(HOST);
        expect(h).toMatch(/import \{ mountOracleDataScreen \} from '\.\/screens\/oracle-data\.js\?v=/);
        expect(h).toMatch(/import \{ mountDailyLocksScreen \} from '\.\/screens\/daily-locks\.js\?v=/);
        expect(h).toMatch(/key: 'oracle-data', title: 'بيانات Oracle', mount: mountOracleDataScreen/);
        expect(h).toMatch(/key: 'yara-daily-locks', title: 'التقفيل اليومي', mount: mountDailyLocksScreen/);
        expect(h).toMatch(/if \(key === 'oracle-data'\)/);
        expect(h).toMatch(/if \(key === 'yara-daily-locks'\)/);
    });
});
