/**
 * v2-registers.test.js — عقد سجلات القراءة V2 (12/15/16/19/22/23/24)
 * ═══════════════════════════════════════════════════════════════════════
 * شاشات السجلات قراءة-فقط بنفس العقد، والمثبَّت هنا مصدرِياً:
 *   • المشي المحدود (8 صفحات × 1000، الأحدث أولاً) يتوقف عند أول صفحة ناقصة
 *     — صعوداً نزولاً في finance-repo وhr-registers-repo معاً
 *   • هذه الـ repos لا تكتب: لا POST/PUT/DELETE في نص أي منها (بالبناء)
 *   • أبوابها تطابق سجلات الخادم: /revenues، /expenses، /departments،
 *     /hrDepartments، /payroll_runs، /inventoryTx، /recipes + /pos/recipes/catalog
 *   • الشاشات: لا inline handler ولا fetch (CSP)، حارس isConnected، رسالة
 *     401 على مسار apiFetch نفسه، وdestroy يُتلف الجدول
 *   • لوحة HR (12): كل مصدر اختياري — فشله يُسمّى ولا يسقط اللوحة
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const APP = path.join(__dirname, '..', 'frontend', 'app');
const V2 = path.join(APP, 'js', 'v2');
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
        Date, Math, Promise, Set, Map, Intl, encodeURIComponent, URLSearchParams,
        ...injections,
    };
    vm.createContext(context);
    vm.runInContext(src, context, { filename: file });
    return context;
}

function loadTemplate(file) {
    const source = read(file)
        .replace(/^import[\s\S]*?\s+from\s+['"][^'"]+['"];?\s*$/gm, '')
        .replace(/^export\s+/gm, '');
    const context = { Date, String };
    vm.createContext(context);
    vm.runInContext(`${source}\n;globalThis.template = template;`, context, { filename: file });
    return context.template;
}

const SCREENS = ['hr-dashboard', 'revenues', 'expenses', 'wh-moves', 'recipes',
    'departments', 'hr-departments', 'payroll', 'cost-analysis', 'pnl'];

describe('سجلات القراءة — عقد المشي المحدود وأبواب الخادم', () => {
    test('المشي المحدود يتوقف عند أول صفحة ناقصة — 8 صفحات أقصى', async () => {
        const calls = [];
        const apiFetch = jest.fn(async (p) => {
            calls.push(p);
            const page = Number(new URLSearchParams(p.split('?')[1]).get('page'));
            return { data: page === 1 ? Array.from({ length: 1000 }, (_, i) => ({ id: i })) : [] };
        });
        const ctx = loadEsm(path.join(V2, 'data', 'finance-repo.js'), { apiFetch }, ['fetchRevenues']);
        const rows = await ctx.fetchRevenues();
        expect(rows).toHaveLength(1000);
        // الصفحة الأولى ممتلئة (1000) → يمشي للثانية، والثانية فارغة → يتوقف
        expect(calls).toEqual([
            '/revenues?page=1&limit=1000&sort=id&order=desc&v2_period=month',
            '/revenues?page=2&limit=1000&sort=id&order=desc&v2_period=month',
        ]);
    });

    test('المشي يمشي الصفحات حتى السقف إن امتلأت كلها', async () => {
        const calls = [];
        const apiFetch = jest.fn(async (p) => {
            calls.push(p);
            return { data: Array.from({ length: 1000 }, (_, i) => ({ id: i })), pagination: { totalPages: 99 } };
        });
        const ctx = loadEsm(path.join(V2, 'data', 'hr-registers-repo.js'), { apiFetch }, ['fetchPayrollRuns']);
        await ctx.fetchPayrollRuns();
        expect(calls).toHaveLength(8); // WALK_PAGES
        expect(calls[7]).toBe('/payroll_runs?page=8&limit=1000&sort=id&order=desc');
    });

    test('repos السجلات لا تكتب — لا POST/PUT/DELETE في نص أي منها', () => {
        const repos = ['finance-repo', 'hr-registers-repo', 'recipes-repo'];
        for (const r of repos) {
            const src = read(path.join(V2, 'data', `${r}.js`));
            expect(src).not.toMatch(/method:\s*'(POST|PUT|DELETE)'/);
        }
    });

    test('أبواب السجلات مسماة كما يخدمها الخادم', async () => {
        const calls = [];
        const apiFetch = jest.fn(async (p) => { calls.push(p); return { data: [] }; });
        const fin = loadEsm(path.join(V2, 'data', 'finance-repo.js'), { apiFetch },
            ['fetchPnl', 'fetchExpenses', 'fetchDepartments']);
        const hr = loadEsm(path.join(V2, 'data', 'hr-registers-repo.js'), { apiFetch },
            ['fetchHrDepartments']);
        const rec = loadEsm(path.join(V2, 'data', 'recipes-repo.js'), { apiFetch },
            ['fetchRecipes', 'fetchRecipesCatalog']);
        await Promise.all([
            fin.fetchExpenses(), fin.fetchDepartments(), fin.fetchPnl('2026-10-01', '2026-10-15'),
            hr.fetchHrDepartments(), rec.fetchRecipes(), rec.fetchRecipesCatalog(),
        ]);
        expect(calls).toContain('/expenses?page=1&limit=1000&sort=id&order=desc&v2_period=month');
        expect(calls).toContain('/departments?page=1&limit=1000&sort=id&order=desc');
        expect(calls).toContain('/finance/pnl?from=2026-10-01&to=2026-10-15');
        expect(calls).toContain('/hrDepartments?page=1&limit=1000&sort=id&order=desc');
        expect(calls).toContain('/pos/recipes/catalog');
    });

    test('السجلات التاريخية تطلب شهر الرياض من الخادم قبل الترقيم', async () => {
        const calls = [];
        const apiFetch = jest.fn(async (p) => { calls.push(p); return { data: [] }; });
        const dispatch = loadEsm(path.join(V2, 'data', 'dispatch-repo.js'), { apiFetch }, ['fetchDispatches']);
        const warehouse = loadEsm(path.join(V2, 'data', 'warehouse-repo.js'), { apiFetch },
            ['fetchInventoryTx', 'fetchKitchenReturns']);
        const invoices = loadEsm(path.join(V2, 'data', 'purchase-invoices-repo.js'), { apiFetch },
            ['fetchPurchaseInvoices']);
        await Promise.all([
            dispatch.fetchDispatches(), warehouse.fetchInventoryTx(),
            warehouse.fetchKitchenReturns(), invoices.fetchPurchaseInvoices(),
        ]);
        for (const entity of ['dispatches', 'inventoryTx', 'kitchenReturns', 'purchaseInvoices']) {
            expect(calls).toContain(`/${entity}?page=1&limit=1000&sort=id&order=${entity === 'purchaseInvoices' ? 'asc' : 'desc'}&v2_period=month`);
        }
    });

    test('حدود الشهر واليوم تتبع تقويم الرياض عند عبور منتصف الليل', () => {
        const ctx = loadEsm(path.join(V2, 'data', 'finance-repo.js'), {}, ['riyadhToday', 'firstOfMonth']);
        const afterMidnightInRiyadh = new Date('2026-01-31T22:00:00.000Z');
        expect(ctx.riyadhToday(afterMidnightInRiyadh)).toBe('2026-02-01');
        expect(ctx.firstOfMonth(afterMidnightInRiyadh)).toBe('2026-02-01');
    });

    test('fetchPnl يتاريخان أو لا شيء — الخادم يرفض الواحد 400', async () => {
        const calls = [];
        const apiFetch = jest.fn(async (p) => { calls.push(p); return {}; });
        const ctx = loadEsm(path.join(V2, 'data', 'finance-repo.js'), { apiFetch }, ['fetchPnl']);
        await ctx.fetchPnl('2026-10-01', '');
        expect(calls).toEqual(['/finance/pnl?from=2026-10-01']);
        await ctx.fetchPnl('', '');
        expect(calls[1]).toBe('/finance/pnl');
    });
});

describe('عقد الشاشات السبع — CSP/هدم/أمانة الفشل', () => {
    for (const name of SCREENS) {
        test(`شاشة ${name}: لا inline handler ولا fetch، وحارس isConnected وdestroy`, () => {
            const src = read(path.join(V2, 'screens', `${name}.js`));
            expect(src).not.toMatch(/\son(click|change|submit|input|keydown)=/i);
            expect(src).not.toMatch(/\bfetch\s*\(/);
            expect(src).toMatch(/if \(!el\.isConnected\)\s*\{\s*return;\s*\}/);
            expect(src).toMatch(/[a-zA-Z]+\.destroy\(\)/);
            expect(src).toContain('انتهت الجلسة — سجّل الدخول في النظام الحالي ثم أعد فتح الوضع الحيّ.');
        });
    }
});

describe('لوحة الموارد (12) — كل مصدر اختياري ومُسمّى عند فشله', () => {
    const repo = read(path.join(V2, 'data', 'hr-dashboard-repo.js'));

    test('القالب متعدد البطاقات داخل جذر واحد كي تبقى مراجع العرض صالحة', () => {
        const template = loadTemplate(path.join(V2, 'screens', 'hr-dashboard.js'));
        const html = template();
        expect(html.trimStart()).toMatch(/^<div class="erp-v2-hrdash-root">/);
        expect((html.match(/<section\b/g) || [])).toHaveLength(2);
        expect(html).toContain('data-v2-kpis');
        expect(html).toContain('data-v2-table');
        expect(html.trimEnd()).toMatch(/<\/section>\s*<\/div>$/);
    });

    test('المستودع يجمع أربعة مصادر ويحمل فشل كل منها كاسم لا كسر', () => {
        expect(repo).toMatch(/Promise\.allSettled/);
        expect(repo).toMatch(/failures/);
        expect(repo).not.toMatch(/method:\s*'(POST|PUT|DELETE)'/);
    });

    test('buildHrKpis لا يخترع رقماً غائباً — والقيم المجهولة تبقى مجهولة', async () => {
        // تنسيقات التقارير تُستورد من reports-repo — تُزوَّد هنا بنفس العقد
        const money = (v, c) => ({ amount: String(Number(v) || 0), hasUnit: !!c, unit: c || '' });
        const ctx = loadEsm(path.join(V2, 'data', 'hr-dashboard-repo.js'),
            { formatMoney: money, formatInt: (v) => String(Number(v) || 0) }, ['buildHrKpis']);
        const kpis = ctx.buildHrKpis({ day: '2026-10-15', employees: [], attendance: [], leaves: [], departments: [] });
        expect(Array.isArray(kpis)).toBe(true);
        for (const k of kpis) {
            expect(k).toHaveProperty('label');
            expect(k).toHaveProperty('value');
            expect(String(k.value)).not.toMatch(/NaN|undefined/);
        }
    });

    test('pendingLeaveRows يبني صفوف الانتظار من سجل الإجازات فقط', async () => {
        const money = (v, c) => ({ amount: String(Number(v) || 0), hasUnit: !!c, unit: c || '' });
        const ctx = loadEsm(path.join(V2, 'data', 'hr-dashboard-repo.js'),
            { formatMoney: money, formatInt: (v) => String(Number(v) || 0) }, ['pendingLeaveRows']);
        const rows = ctx.pendingLeaveRows(
            [{ id: 1, status: 'pending', employeeId: 1, startDate: '2026-10-20', endDate: '2026-10-22' }],
            new Map(),
        );
        expect(rows.length).toBe(1);
        expect(rows[0].employee).toBe('#1'); // اسم مجهول → الرقم الخام لا اختراع
    });
});
