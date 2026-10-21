/**
 * v2-reports-extra.test.js — عقد التقارير التسعة خارج مبيعات POS
 * ═══════════════════════════════════════════════════════════════════════
 * المرجع: features/reports.js:268-670 (الحسابات المحلية والأبواب) +
 * backend/yarasoft/yara-reports.js (:103/:181) + yarasoft/routes.js:808.
 * يمتد عقد v2-reports.test.js دون تعديله: شاشة التقارير نفسها تستضيف
 * الأنواع التسعة خلف منتقي النوع، ووضع POS المقيس لا يتغير.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const APP = path.join(__dirname, '..', 'frontend', 'app');
const V2 = path.join(APP, 'js', 'v2');
const REPO = path.join(V2, 'data', 'reports-extra.js');
const SCREEN = path.join(V2, 'screens', 'reports.js');
const YARA_REPORTS = path.join(__dirname, '..', 'backend', 'yarasoft', 'yara-reports.js');
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
        Date, Math, Promise, Set, Map, Intl, URLSearchParams, encodeURIComponent,
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

describe('التقارير الإضافية — الأبواب', () => {
    test('أبواب يارا تطابق القديم مساراً', async () => {
        const { apiFetch, calls } = repoStub(() => ({}));
        const ctx = loadEsm(REPO, { apiFetch }, [
            'fetchYaraDepartments', 'fetchYaraCashierItems', 'fetchYaraInvoiceDetail',
        ]);
        await ctx.fetchYaraDepartments({ from: '2026-10-01', to: '2026-10-15', group: 'day' });
        await ctx.fetchYaraCashierItems({ from: '2026-10-01', to: '2026-10-15', view: 'invoices', cashier: '1', limit: 100, page: 2 });
        await ctx.fetchYaraCashierItems({ from: '2026-10-01', to: '2026-10-15', view: 'invoices', cashiers: ['1', '3', '4', '5', '9'], limit: 50, page: 1 });
        await ctx.fetchYaraCashierItems({ from: '2026-10-01', to: '2026-10-15', view: 'invoices', cashiers: ['1', '3', '4', '5', '9'], summaryOnly: true, live: true });
        await ctx.fetchYaraInvoiceDetail('1280596');
        expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
            'GET /yara-reports/departments?from=2026-10-01&to=2026-10-15&group=day',
            'GET /yara-reports/cashier-items?from=2026-10-01&to=2026-10-15&view=invoices&limit=100&cashier=1&page=2',
            'GET /yara-reports/cashier-items?from=2026-10-01&to=2026-10-15&view=invoices&limit=50&cashiers=1%2C3%2C4%2C5%2C9&page=1',
            'GET /yara-reports/cashier-items?from=2026-10-01&to=2026-10-15&view=invoices&limit=100&cashiers=1%2C3%2C4%2C5%2C9&summary_only=1&live=1&page=1',
            'GET /yarasoft/sections/invoice-detail?ref=ora%3ACC%3A1280596',
        ]);
    });

    test('فلترة عدة كاشيرات تُبنى بمتغيرات bind وتُحدّث كاش الفترة الحالية كل 10 ثوانٍ', () => {
        const server = read(YARA_REPORTS);
        expect(server).toContain('const CI_LIVE_CACHE_MS = 10 * 1000;');
        expect(server).toContain('const liveRefresh = String(req.query.live || \'\') === \'1\';');
        expect(server).toContain("error: 'INVALID_CASHIERS'");
        expect(server).toContain("const summaryOnly = String(req.query.summary_only || '') === '1';");
        expect(server).toContain("kind: 'summary'");
        expect(server).toContain('cashiers.map((_, i) => `:cashier${i}`)');
        expect(server).toMatch(/TRIM\(b\.CSHR_NO\) IN \(\$\{cashiers\.map/);
        expect(server).toMatch(/cashiers\.map\(\(no, i\) => \[`cashier\$\{i\}`, no\]\)/);
        expect(server).toMatch(/liveRefresh && \(summaryOnly \|\| view === 'invoices'\)/);
    });

    test('الحسابات المحلية: الشامل والمطبخ والمرتجعات والمخزون', () => {
        const ctx = loadEsm(REPO, {}, [
            'computeGeneral', 'computeKitchen', 'computeReturns', 'computeWarehouse',
            'isOperatingExpenseLocal',
        ]);
        expect(ctx.isOperatingExpenseLocal({ adjustmentType: 'dispatch' })).toBe(false);
        expect(ctx.isOperatingExpenseLocal({ adjustmentType: 'transfer' })).toBe(false);
        expect(ctx.isOperatingExpenseLocal({ adjustmentType: 'count_correction' })).toBe(false);
        expect(ctx.isOperatingExpenseLocal({ adjustmentType: '' })).toBe(true);
        expect(ctx.isOperatingExpenseLocal({})).toBe(true);
        const g = ctx.computeGeneral({
            revenues: [{ date: '2026-10-10', amount: 1000 }],
            expenses: [
                { date: '2026-10-10', amount: 200 },
                { date: '2026-10-10', amount: 300, adjustmentType: 'dispatch' },
                { date: '2026-09-01', amount: 9999 },
            ],
        }, '2026-10-01', '2026-10-15');
        expect(g.totalRev).toBe(1000);
        expect(g.totalExp).toBe(500);
        expect(g.profit).toBe(500);
        expect(g.sample.map((s) => s.kind).sort()).toEqual(['operating', 'revenue', 'stock']);
        const k = ctx.computeKitchen({
            dispatches: [{
                date: '2026-10-10', status: 'approved', deptName: 'مطبخ',
                items: [{ itemName: 'أرز', qty: 5, unit: 'كجم' }],
                approvedItems: [{ approvedValue: 250 }],
            }, { date: '2026-10-10', status: 'pending', items: [] }],
            recipes: [{}, {}],
        }, '2026-10-01', '2026-10-15');
        expect(k.count).toBe(1);
        expect(k.totalValue).toBe(250);
        expect(k.recipesCount).toBe(2);
        const r = ctx.computeReturns({
            returns: [{ date: '2026-10-10', totalValue: '120.5' }],
        }, '2026-10-01', '2026-10-15');
        expect(r.count).toBe(1);
        expect(r.total).toBe(120.5);
        const w = ctx.computeWarehouse({
            inventory: [
                { name: 'أرز', qty: 10, avgCost: 5, minQty: 20, weight: 10, category: 'حبوب', unit: 'كجم' },
                { name: 'سكر', qty: 50, avgCost: 2, minQty: 5, category: 'حبوب', unit: 'كجم' },
            ],
        });
        expect(w.totalValue).toBe(150);
        expect(w.low.map((i) => i.name)).toEqual(['أرز']);
    });
});

describe('التقارير الإضافية — عقد الشاشة', () => {
    const src = () => read(SCREEN);

    test('منتقي الأنواع الاثني عشر حاضر + حاوية إضافية', () => {
        const s = src();
        for (const v of ['pos-department', 'pos-cashier', 'pos-item', 'general', 'department',
            'kitchen', 'returns', 'warehouse', 'hr', 'dept-specific',
            'yara-departments', 'yara-cashiers']) {
            expect(s).toContain(`value="${v}"`);
        }
        expect(s).toContain('data-v2-extra');
        expect(s).toContain('data-v2-type');
        expect(s).toContain('توزيع الرفوف غير معروض بقرار المالك');
    });

    test('بلا شبكة مباشرة ولا معالج سطري في الإضافة', () => {
        const s = src().replace(/\/\*[\s\S]*?\*\//g, '');
        expect(s).not.toMatch(/\bapiFetch\b/);
        expect(s).not.toMatch(/window\.(prompt|alert)\(/);
        expect(s.match(/\son[a-z]+\s*=\s*["']/g) || []).toHaveLength(0);
        expect(s).not.toMatch(/\.avgCost|\.cashier_username\b|\.product_barcode\b/);
    });

    test('الوحدة الموحدة في الملف الجديد', () => {
        expect(REV).toBeTruthy();
        const versions = [...read(REPO).matchAll(/\?v=([0-9.]+)/g)].map((m) => m[1]);
        expect(versions.length).toBeGreaterThan(0);
        for (const v of versions) {expect(v).toBe(REV);}
    });
});
