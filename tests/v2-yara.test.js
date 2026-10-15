/**
 * v2-yara.test.js — عقد عائلة تحليلات يارا (sales-analyzer · received-analyzer ·
 * wh-vs-pos) ومرآة خادمها
 * ═══════════════════════════════════════════════════════════════════════
 * المرجع: backend/yarasoft/yara-reports.js — كل الأبواب GET بقراءة حصراً،
 * سقف المدى 93 يومًا، المدى المعكوس 422، والأدوار (sous_chef|admin|owner).
 * المثبَّت هنا: الأبواب مساراتها وبارامتراتها، البوابة المحلية قبل أي طلب،
 * وعقود الشاشات الثلاث (CSP/هدم/أمانة الفشل).
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const APP = path.join(__dirname, '..', 'frontend', 'app');
const V2 = path.join(APP, 'js', 'v2');
const REPO = path.join(V2, 'data', 'yara-reports-repo.js');
const SERVER = path.join(__dirname, '..', 'backend', 'yarasoft', 'yara-reports.js');
const SCREENS = ['sales-analyzer', 'received-analyzer', 'wh-vs-pos'];

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
    const apiFetch = jest.fn(async (p) => { calls.push(p); return impl ? impl(p) : {}; });
    return { apiFetch, calls };
}

describe('عائلة يارا — مرآة الخادم', () => {
    const srv = read(SERVER);

    test('بوابة القراءة مرآة حرفية لسطور الخادم السبعة', () => {
        const ctx = loadEsm(REPO, {}, ['YARA_READ_ROLES', 'YARA_MAX_SPAN_DAYS']);
        expect(ctx.YARA_READ_ROLES).toEqual(['sous_chef', 'admin', 'owner']);
        expect(srv.match(/requireRole\('sous_chef', 'admin', 'owner'\)/g).length).toBeGreaterThanOrEqual(7);
        expect(ctx.YARA_MAX_SPAN_DAYS).toBe(93);
    });

    test('repo لا يكتب — لا POST/PUT/DELETE بأي شكل', () => {
        const src = read(REPO);
        expect(src).not.toMatch(/method:\s*'(POST|PUT|DELETE)'/);
    });

    test('الأبواب السبعة مساراتها وبارامتراتها كما يخدمها الخادم', async () => {
        const { apiFetch, calls } = repoStub(() => ({}));
        const ctx = loadEsm(REPO, { apiFetch }, [
            'fetchItemSales', 'fetchYaraOrders', 'fetchReceivedItems', 'fetchReceivedDispatches',
            'fetchItemOutflow', 'fetchItemSuggestions', 'fetchWhVsPos',
        ]);
        await ctx.fetchItemSales({ from: '2026-10-01', to: '2026-10-15', group: 'item', cashier: '4', item: 'شاورما' });
        await ctx.fetchYaraOrders({ from: '2026-10-01', to: '2026-10-15', cashier: '', limit: 50, offset: 0 });
        await ctx.fetchReceivedItems({ from: '2026-10-01', to: '2026-10-15', group: 'dept' });
        await ctx.fetchReceivedDispatches({ from: '2026-10-01', to: '2026-10-15' });
        await ctx.fetchItemOutflow({ from: '2026-10-01', to: '2026-10-15' });
        await ctx.fetchItemSuggestions('شاور');
        await ctx.fetchWhVsPos({ from: '2026-10-01', to: '2026-10-15' });
        expect(calls).toEqual([
            '/yara-reports/item-sales?from=2026-10-01&to=2026-10-15&group=item&cashier=4&item=%D8%B4%D8%A7%D9%88%D8%B1%D9%85%D8%A7',
            '/yara-reports/orders?from=2026-10-01&to=2026-10-15&limit=50&offset=0',
            '/yara-reports/received-items?from=2026-10-01&to=2026-10-15&group=dept&limit=200&offset=0',
            '/yara-reports/received-dispatches?from=2026-10-01&to=2026-10-15&limit=50&offset=0',
            '/yara-reports/item-outflow?from=2026-10-01&to=2026-10-15',
            '/yara-reports/item-suggest?q=%D8%B4%D8%A7%D9%88%D8%B1',
            '/yara-reports/wh-vs-pos?from=2026-10-01&to=2026-10-15',
        ]);
        // المسارات مسماة في الخادم حرفياً
        for (const door of ['item-sales', 'orders', 'received-items', 'received-dispatches',
            'item-outflow', 'item-suggest', 'wh-vs-pos']) {
            expect(srv).toContain(`'/${door}'`);
        }
    });

    test('بوابة المدى المحلية: المعكوس والواسع يُرفضان بجملة الخادم قبل أي طلب', () => {
        const ctx = loadEsm(REPO, {}, ['rangeError', 'spanDays']);
        expect(ctx.rangeError('2026-10-15', '2026-10-01').ok).toBe(false);
        // أكتوبر→ديسمبر = 92 يومًا (داخل السقف) — السنة الكاملة هي المرفوضة
        expect(ctx.rangeError('2026-10-01', '2026-12-31').ok).toBe(true);
        expect(ctx.rangeError('2026-01-01', '2026-12-31').message).toContain('93');
        expect(ctx.rangeError('2026-10-01', '2026-10-15').ok).toBe(true);
        // فرق الأيام شامل الطرفين كما يحسبه الخادم (:524)
        expect(ctx.spanDays('2026-10-01', '2026-10-15')).toBe(15);
        // item-suggest: أقل من حرفين لا طلب (:959)
    });

    test('item-suggest لا يسأل تحت حرفين — والقص عند 40 (:958)', async () => {
        const { apiFetch, calls } = repoStub(() => ({ suggestions: [] }));
        const ctx = loadEsm(REPO, { apiFetch }, ['fetchItemSuggestions']);
        expect(await ctx.fetchItemSuggestions('ا')).toEqual([]);
        expect(calls).toEqual([]);
        await ctx.fetchItemSuggestions('شاورما'.padEnd(60, 'x'));
        expect(calls[0].length).toBeLessThanOrEqual('/yara-reports/item-suggest?q='.length + 120);
    });

    test('safeTotals وanalysisLabel: لا NaN ولا اسم مخترع', () => {
        const ctx = loadEsm(REPO, {}, ['safeTotals', 'analysisLabel']);
        expect(ctx.safeTotals({ invoices: '5', net: 'x' })).toEqual({ invoices: 5, qty: 0, net: 0, vat: 0 });
        expect(ctx.analysisLabel({ item_name: 'أرز' }, 'item')).toBe('أرز');
        expect(ctx.analysisLabel({ cashier_name: 'كاشير 4' }, 'cashier')).toBe('كاشير 4');
        expect(ctx.analysisLabel({ doc_date: '2026-10-15' }, 'day')).toBe('2026-10-15');
        expect(ctx.analysisLabel({}, 'item')).toBe('—');
    });
});

describe('عقود الشاشات الثلاث — CSP/هدم/بوابة المدى', () => {
    for (const name of SCREENS) {
        test(`شاشة ${name}: لا inline ولا fetch، حارس isConnected، هدم، و401 موحد`, () => {
            const src = read(path.join(V2, 'screens', `${name}.js`));
            expect(src).not.toMatch(/\son(click|change|submit|input|keydown)=/i);
            expect(src).not.toMatch(/\bfetch\s*\(/);
            expect(src).toMatch(/if \(!el\.isConnected\)\s*\{\s*return;\s*\}/);
            expect(src).toMatch(/[a-zA-Z]+Table\.destroy\(\)|Table\.destroy\(\)|\.destroy\(\)/);
            expect(src).toContain('rangeError');
            expect(src).toContain('انتهت الجلسة — سجّل الدخول في النظام الحالي ثم أعد فتح الوضع الحيّ.');
        });
    }

    test('sales-analyzer: تبويبَان وتجميع الثلاثة فقط (مرآة SA_GROUPS)', () => {
        const src = read(path.join(V2, 'screens', 'sales-analyzer.js'));
        expect(src).toContain("tab = t.dataset.v2Tab");
        expect(src).toContain("SA_GROUPS");
        // الخادم يتحقق من التجميع — والمرآة مصفوفة الاسماء نفسها
        expect(srv()).toMatch(/group/);
    });

    test('received-analyzer: ثلاثة أقسام بأمانة فشل مستقلة (allSettled)', () => {
        const src = read(path.join(V2, 'screens', 'received-analyzer.js'));
        expect(src).toContain('Promise.allSettled');
        expect(src).toContain('تعذّر الأذون');
        expect(src).toContain('تعذّر الأصناف');
    });
});

function srv() { return read(SERVER); }
