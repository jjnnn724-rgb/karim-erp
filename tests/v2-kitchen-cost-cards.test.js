/**
 * v2-kitchen-cost-cards.test.js — بطاقات التكلفة في شاشة المطبخ (V2)
 * ═══════════════════════════════════════════════════════════════════════
 * الوظيفة المنقولة من `features/kitchen.js:1481-1546`:
 *   الصرف الفعلي (أذون الصرف − المرتجعات) + تكلفة أوامر الإنتاج الموزعة
 *   مقابل الإيراد الفعلي من الكاشير، مع طباعة بطاقة لكل جهة.
 *
 * المثبَّت:
 *   ١) الباب الوحيد `/kitchen/production/cost-cards` — الشاشة لا تستدعي
 *      fetch/apiFetch بنفسها، والتواريخ تُمرَّر كما هي (والخادم يحسم الافتراضي).
 *   ٢) الشاشة ترسم قسمًا حقيقيًّا: مدخلَي تاريخ، زر تحديث، زر طباعة لكل بطاقة،
 *      وأربع خلايا KPI بعناوين القديم نفسها.
 *   ٣) النطاق المعكوس يُرفض في الواجهة قبل الشبكة، وفشل القراءة لا يمحو بقية
 *      الشاشة (بطاقات فقط + زر إعادة محاولة).
 *   ٤) الباب الخادمي محمي بـjwtAuth + requireRole(READ) ويحسم `cards` بنفس
 *      أسماء الحقول التي تقرأها الشاشة.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const APP = path.join(__dirname, '..', 'frontend', 'app');
const V2 = path.join(APP, 'js', 'v2');
const REPO = path.join(V2, 'data', 'kitchen-repo.js');
const SCREEN = path.join(V2, 'screens', 'kitchen.js');
const SERVER = path.join(__dirname, '..', 'backend', 'kitchen-production-routes.js');

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
        console, JSON, String, Number, Boolean, Array, Object, RegExp, Error, Date, Math, Promise,
        Set, Map, Intl, URLSearchParams,
        ...injections,
    };
    vm.createContext(context);
    vm.runInContext(src, context, { filename: file });
    return context;
}

function repoWith(impl) {
    const calls = [];
    const apiFetch = jest.fn(async (p) => {
        calls.push(p);
        return typeof impl === 'function' ? impl(p) : impl;
    });
    const repo = loadEsm(REPO, { apiFetch, formatInt: (v) => String(v) },
        ['fetchKitchenCostCards']);
    return { repo, calls };
}

describe('repo — الباب الوحيد والتواريخ', () => {
    test('يمرّر from/to كما هي إلى /kitchen/production/cost-cards', async () => {
        const { repo, calls } = repoWith({ from: '2026-10-01', to: '2026-10-20', cards: [] });
        const out = await repo.fetchKitchenCostCards({ from: '2026-10-01', to: '2026-10-20' });
        expect(calls).toEqual(['/kitchen/production/cost-cards?from=2026-10-01&to=2026-10-20']);
        expect(out).toEqual({ from: '2026-10-01', to: '2026-10-20', cards: [] });
    });

    test('بلا تواريخ: لا query — الخادم يحسم أول الشهر → اليوم', async () => {
        const { repo, calls } = repoWith({ ok: true, from: '2026-10-01', to: '2026-10-20', cards: [{ code: 'external_sales' }] });
        await repo.fetchKitchenCostCards();
        expect(calls).toEqual(['/kitchen/production/cost-cards']);
    });

    test('غياب cards أو كونها غير مصفوفة = [] (لا انفجار رسم)', async () => {
        const { repo } = repoWith({ ok: true, cards: 'x' });
        const out = await repo.fetchKitchenCostCards();
        expect(out.cards).toEqual([]);
    });
});

describe('الشاشة — القسم والربط', () => {
    const screen = read(SCREEN);

    test('تقسم بـrepo فقط، ولا fetch/apiFetch داخل الشاشة', () => {
        expect(screen).toMatch(/fetchKitchenCostCards/);
        expect(screen).not.toMatch(/\bfetch\(/);
        expect(screen).not.toMatch(/\bapiFetch\(/);
    });

    test('قسم بطاقات التكلفة: مدخلان + تحديث + طباعة لكل بطاقة', () => {
        expect(screen).toContain('data-v2-costcards');
        expect(screen).toMatch(/id="v2kit-cost-from" type="date"/);
        expect(screen).toMatch(/id="v2kit-cost-to" type="date"/);
        expect(screen).toContain('data-v2-cost-reload');
        expect(screen).toContain('data-v2-cost-print="${esc(c.code)}"');
        expect(screen).toContain('طباعة البطاقة');
    });

    test('عناوين KPI منقولة حرفًا من القديم', () => {
        expect(screen).toContain('الصرف الفعلي (بعد المرتجعات)');
        expect(screen).toContain('تكلفة أوامر الإنتاج');
        expect(screen).toContain('الإيراد الفعلي');
        expect(screen).toContain('نسبة التكلفة / الصافي');
    });

    test('النطاق المعكوس يُرفض قبل الشبكة', () => {
        const fn = screen.slice(screen.indexOf('async function readCostCards'), screen.indexOf('function printCostCard'));
        expect(fn).toMatch(/costFrom > costTo/);
        expect(fn).toMatch(/صحّح الفترة/);
        /* الحارس يسبق النداء: لا طلب شبكة لفترة معكوسة */
        expect(fn.indexOf('costFrom > costTo')).toBeLessThan(fn.indexOf('await fetchKitchenCostCards('));
    });

    test('الفتح والتحديث يقرآن البطاقات أيضًا', () => {
        expect(screen).toMatch(/reload\(\);\n {4}readGovernance\(\);\n {4}readCostCards\(\);/);
        expect(screen).toMatch(/if \(event\.target\.closest\('\[data-v2-reload\]'\)\) \{reload\(\); readGovernance\(\); readCostCards\(\); return;\}/);
    });

    test('فشل البطاقات لا يمسح النظرة أو الحوكمة', () => {
        const fn = screen.slice(screen.indexOf('async function readCostCards'), screen.indexOf('function printCostCard'));
        expect(fn).toMatch(/costCards = \[\];/);
        expect(fn).not.toMatch(/batches = \[\]/);
        expect(fn).not.toMatch(/audits = \[\]/);
    });
});

describe('الخادم — الحراسة وأسماء الحقول', () => {
    const srv = read(SERVER);
    const route = srv.slice(srv.indexOf("router.get('/production/cost-cards'"), srv.indexOf("router.post('/production'"));

    test('محمي بالدور، ويقرأ الفترة من query', () => {
        expect(route).toMatch(/jwtAuth,requireRole\(\.\.\.READ\)/);
        expect(route).toMatch(/req\.query\.from/);
        expect(route).toMatch(/req\.query\.to/);
        expect(route).toMatch(/INVALID_RANGE/);
    });

    test('يعيد نفس مفاتيح الشاشة (cards/consumption/production/revenue/net/costRatio)', () => {
        for (const key of ['cards', 'consumption', 'production', 'revenue', 'net', 'costRatio', 'dispatchItemsCount']) {
            expect(route).toContain(key);
        }
    });
});
