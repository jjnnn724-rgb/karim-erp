/**
 * v2-cashier-monitor.test.js — عقد شاشة متابعة الكاشير ومرآة خادمها
 * ═══════════════════════════════════════════════════════════════════════
 * المرجع: backend/cashier-monitor-routes.js (3 أبواب قراءة، حارس
 * admin-or-perm، نطاق MIRROR_CASHIERS، live=1 بحد 45 ثانية) +
 * frontend/app/js/features/cashier-monitor.js (275 سطرًا).
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const APP = path.join(__dirname, '..', 'frontend', 'app');
const V2 = path.join(APP, 'js', 'v2');
const REPO = path.join(V2, 'data', 'cashier-monitor-repo.js');
const SCREEN = path.join(V2, 'screens', 'cashier-monitor.js');
const V2_HTML = path.join(APP, 'v2.html');
const HOST = path.join(V2, 'preview.js');
const SERVER = path.join(__dirname, '..', 'backend', 'cashier-monitor-routes.js');
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

describe('متابعة الكاشير — مرآة الخادم', () => {
    test('الأبواب الثلاثة قراءة فقط بنفس المسارات', async () => {
        const srv = read(SERVER);
        expect(srv).not.toMatch(/router\.(post|put|delete|patch)\(/);
        const { apiFetch, calls } = repoStub(() => ({}));
        const ctx = loadEsm(REPO, { apiFetch }, [
            'fetchMonitorSummary', 'fetchMonitorOrders', 'fetchMonitorOrder',
        ]);
        await ctx.fetchMonitorSummary('2026-10-15', true);
        await ctx.fetchMonitorOrders({ date: '2026-10-15', cashier: '1', limit: 50, offset: 0 });
        await ctx.fetchMonitorOrder('A-100');
        expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
            'GET /cashier-monitor/summary?date=2026-10-15&live=1',
            'GET /cashier-monitor/orders?date=2026-10-15&cashier=1&limit=50&offset=0',
            'GET /cashier-monitor/orders/A-100',
        ]);
    });

    test('المجاميع وحداثة المرآة بنفس قواعد القديم', () => {
        const ctx = loadEsm(REPO, {}, ['summarizeCashiers', 'mirrorFreshness']);
        const rows = [
            { invoices: 10, revenue: 1000, revenue_ex_vat: 900, pay_cash: 600, pay_network: 400 },
            { invoices: 5, revenue: 500, revenue_ex_vat: 450, pay_cash: 500, pay_network: 0 },
        ];
        expect(ctx.summarizeCashiers(rows)).toEqual({
            invoices: 15, revenue: 1500, revenueEx: 1350, cash: 1100, network: 400,
        });
        expect(ctx.mirrorFreshness([])).toEqual({ state: 'none', ageMin: null });
        const now = Date.now();
        const fresh = new Date(now - 10 * 60000).toISOString();
        const old = new Date(now - 60 * 60000).toISOString();
        expect(ctx.mirrorFreshness([{ synced_at: fresh }], now).state).toBe('live');
        expect(ctx.mirrorFreshness([{ synced_at: old }], now).state).toBe('stale');
    });
});

describe('متابعة الكاشير — عقد الشاشة من المصدر', () => {
    const src = () => read(SCREEN);

    test('لا شبكة من الشاشة: الباب الواحد فقط', () => {
        const s = src().replace(/\/\*[\s\S]*?\*\//g, '');
        expect(s).not.toMatch(/\bapiFetch\b/);
        expect(s).not.toMatch(/[^a-zA-Z]fetch\(/);
        expect(s).toMatch(/from '\.\.\/data\/cashier-monitor-repo\.js\?v=/);
        expect(s).not.toMatch(/['"`]\/cashier-monitor/);
    });

    test('لا معالج سطري — واللايف يُنظَّف عند التدمير', () => {
        const s = src().replace(/\/\*[\s\S]*?\*\//g, '');
        expect(s.match(/\son[a-z]+=/g) || []).toHaveLength(0);
        expect(s).toMatch(/clearInterval\(timer\)/);
        expect(s).toMatch(/stopLive\(\);\s*\n?\s*el\.remove\(\)/);
    });

    test('البطاقات فلتر + تفاصيل فاتورة + طباعة وExcel حقيقيان', () => {
        const s = src();
        for (const k of ['data-v2-cashier', 'data-v2-order-row', 'data-v2-print', 'data-v2-excel',
            'data-v2-prev', 'data-v2-next', 'cashiers_']) {
            expect(s).toContain(k);
        }
        expect(s).toMatch(/typeof window\.XLSX === 'undefined'/);
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
        expect(h).toMatch(/import \{ mountCashierMonitorScreen \} from '\.\/screens\/cashier-monitor\.js\?v=/);
        expect(h).toMatch(/let cashierMonitorScreen = null;/);
        expect(h).toMatch(/function teardownCashierMonitorScreen\(\)/);
        expect(h).toMatch(/key: 'cashier-monitor', title: 'متابعة الكاشير', mount: mountCashierMonitorScreen/);
        expect(h).toMatch(/if \(key === 'cashier-monitor'\)/);
    });
});
