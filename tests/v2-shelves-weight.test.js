/**
 * v2-shelves-weight.test.js — عقد P2-5 (الرفوف + الميزان)
 * ═══════════════════════════════════════════════════════════════════════
 * المثبَّت هنا:
 *   • الأدوار منسوخة من خرائط الخادم نفسها، لا مخترعة
 *     (schema-registry.js:782 shelves · :786 inventory · :793 weightReadings).
 *   • الكتابة تمر بالباب العام نفسه وبالحمولة المسموحة فقط، و`id` لا يُرسل.
 *   • الميزان يحوّل الجرام والرطل قبل الجمع، والوحدة غير المعروفة لا تُحسب
 *     كيلوجرامًا صامتًا (kg = null وتُعدّ في unconverted).
 *   • الشاشتان لا تلمسان الشبكة مباشرة ولا تستخدمان معالجًا سطريًا، وكل
 *     كتابة وراء الدور + العلم المستقل.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const APP = path.join(__dirname, '..', 'frontend', 'app');
const V2 = path.join(APP, 'js', 'v2');
const SHELF_REPO = path.join(V2, 'data', 'shelves-repo.js');
const WEIGHT_REPO = path.join(V2, 'data', 'weight-repo.js');
const SHELVES = path.join(V2, 'screens', 'shelves.js');
const WEIGHT = path.join(V2, 'screens', 'weight.js');
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

describe('الرفوف — الباب والحمولة', () => {
    test('خرائط الأدوار منسوخة من الخادم', () => {
        const ctx = loadEsm(SHELF_REPO, { apiFetch: jest.fn() }, ['SHELF_WRITE_ROLES']);
        expect(ctx.SHELF_WRITE_ROLES).toEqual(['admin', 'manager', 'warehouse']);
    });

    test('القراءة تمر بالباب العام وتتبع الصفحات', async () => {
        const { apiFetch, calls } = repoStub((p) => (p.startsWith('/shelves')
            ? (p.includes('page=2')
                ? { data: [{ id: 1001, name: 'آخر' }], pagination: { totalPages: 2 } }
                : { data: Array.from({ length: 1000 }, (_, i) => ({ id: i + 1 })), pagination: { totalPages: 2 } })
            : { data: [{ id: 9, shelfId: 1, qty: 2, avgCost: 5 }], pagination: { totalPages: 1 } }));
        const ctx = loadEsm(SHELF_REPO, { apiFetch }, ['fetchShelves', 'fetchShelfInventory']);
        const shelves = await ctx.fetchShelves();
        const items = await ctx.fetchShelfInventory();
        expect(shelves).toHaveLength(1001);
        expect(items).toHaveLength(1);
        expect(calls).toEqual([
            { path: '/shelves?page=1&limit=1000&sort=id&order=desc', method: 'GET', body: undefined },
            { path: '/shelves?page=2&limit=1000&sort=id&order=desc', method: 'GET', body: undefined },
            { path: '/inventory?page=1&limit=1000&sort=id&order=desc', method: 'GET', body: undefined },
        ]);
    });

    test('تجميع الرف: العدد والكمية والقيمة (qty × avgCost)', () => {
        const ctx = loadEsm(SHELF_REPO, { apiFetch: jest.fn() }, ['shelfItems', 'shelfStats']);
        expect(ctx.shelfItems(1, [
            { shelfId: 1, qty: '2', avgCost: '5' },
            { shelfId: '1', qty: 3, avgCost: 2 },
            { shelfId: 2, qty: 9, avgCost: 1 },
        ])).toMatchObject({ count: 2, qty: 5, value: 16 });

        expect(ctx.shelfStats(
            [{ id: 1 }, { id: 2 }, { id: 3 }],
            [{ shelfId: 1 }, { shelfId: 1 }, { shelfId: null }, { shelfId: '' }, { shelfId: 2 }],
        )).toEqual({ shelves: 3, assignedItems: 3, emptyShelves: 1, occupancy: 60 });
    });

    test('التحقق يردّ بجمل الخادم ويرفض كودًا فارغًا وسعة سالبة', () => {
        const ctx = loadEsm(SHELF_REPO, { apiFetch: jest.fn() }, ['validateShelfForm', 'normalizeShelfForm']);
        expect(ctx.validateShelfForm({})).toEqual([
            { field: 'name', message: 'حقول مطلوبة ناقصة: name' },
            { field: 'code', message: 'الكود مطلوب — معرّف الرف كما في الشاشة القديمة' },
        ]);
        expect(ctx.validateShelfForm({ name: 'x'.repeat(256), code: 'c', location: 'l'.repeat(256), capacity: -1 }))
            .toEqual([
                { field: 'name', message: 'الحقل "name" أطول من المسموح (الحد الأقصى 255 حرفًا)' },
                { field: 'location', message: 'الحقل "location" أطول من المسموح (الحد الأقصى 255 حرفًا)' },
                { field: 'capacity', message: 'الحقل "capacity" يجب أن يكون رقمًا' },
            ]);
        expect(ctx.validateShelfForm({ name: 'رف', code: 'c' })).toEqual([]);
        expect(ctx.normalizeShelfForm({ name: ' رف أ ', code: ' s-1 ', location: ' ' })).toEqual({
            name: 'رف أ',
            code: 'S-1',
            location: null,
            capacity: 50,
            icon: '<i class=ji data-i=archive></i>',
        });
    });

    test('الإنشاء والتعديل والحذف على الأبواب العامة فقط', async () => {
        const { apiFetch, calls } = repoStub(() => ({ id: 1 }));
        const ctx = loadEsm(SHELF_REPO, { apiFetch }, ['createShelf', 'updateShelf', 'deleteShelf']);
        await ctx.createShelf({ name: ' رف ', code: ' s1 ', location: ' ', capacity: '' });
        await ctx.updateShelf(7, { name: 'رف 2', code: 'zz', location: 'A', capacity: '3' });
        await ctx.deleteShelf(7);
        expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
            'POST /shelves', 'PUT /shelves/7', 'DELETE /shelves/7',
        ]);
        expect(JSON.parse(calls[0].body)).toEqual({
            name: 'رف', code: 'S1', location: null, capacity: 50,
            icon: '<i class=ji data-i=archive></i>',
        });
        // code ثابت بعد الإنشاء، وicon لا يُرسل في التعديل.
        expect(Object.keys(JSON.parse(calls[1].body)).sort()).toEqual(['capacity', 'location', 'name']);
    });
});

describe('الميزان — الحساب والحمولة', () => {
    test('خرائط الأدوار منسوخة من الخادم — وكتابة المخزون أضيق', () => {
        const ctx = loadEsm(WEIGHT_REPO, { apiFetch: jest.fn() },
            ['WEIGHT_WRITE_ROLES', 'WEIGHT_INVENTORY_ROLES']);
        expect(ctx.WEIGHT_WRITE_ROLES).toEqual(['admin', 'manager', 'kitchen', 'sous_chef', 'warehouse']);
        expect(ctx.WEIGHT_INVENTORY_ROLES).toEqual(['admin', 'manager', 'warehouse']);
    });

    test('التحويل: كجم كما هو، جرام ÷ 1000، رطل × 0.453592', () => {
        const ctx = loadEsm(WEIGHT_REPO, { apiFetch: jest.fn() }, ['toKg', 'unitLabel']);
        expect(ctx.toKg(2, 'kg')).toBe(2);
        expect(ctx.toKg(500, 'g')).toBe(0.5);
        expect(ctx.toKg(1, 'lb')).toBeCloseTo(0.453592, 6);
        expect(ctx.unitLabel('lb')).toBe('رطل');
        expect(ctx.unitLabel('oz')).toBe('oz');
    });

    test('صف القراءة: وحدة غير معروفة تبقى نصًّا وkg = null', () => {
        const ctx = loadEsm(WEIGHT_REPO, { apiFetch: jest.fn() }, ['readingToRow']);
        expect(ctx.readingToRow({
            id: 1, weight: '2.500', unit: 'kg', date: '2026-10-17', time: '09:00', itemId: 9,
        })).toMatchObject({ weight: 2.5, unit: 'kg', unitAr: 'كجم', kg: 2.5, itemName: '#9' });
        expect(ctx.readingToRow({ weight: 500, unit: 'g' }).kg).toBe(0.5);
        expect(ctx.readingToRow({ weight: 2, unit: 'oz' })).toMatchObject({ kg: null, unitAr: 'oz' });
        expect(ctx.readingToRow({ weight: 1 }).unit).toBe('kg');
    });

    test('الإجمالي بالكيلوجرام بعد التحويل، وغير المعروف يُعدّ لا يُخمَّن', () => {
        const ctx = loadEsm(WEIGHT_REPO, { apiFetch: jest.fn() }, ['readingsSummary']);
        const s = ctx.readingsSummary([
            { weight: 1, unit: 'kg', date: '2026-10-17' },
            { weight: 500, unit: 'g', date: '2026-10-17' },
            { weight: 1, unit: 'lb', date: '2026-10-16' },
            { weight: 3, unit: 'oz', date: '2026-10-16' },
        ], '2026-10-17');
        expect(s.totalKg).toBeCloseTo(1.954, 3);
        expect(s.todayCount).toBe(2);
        expect(s.count).toBe(4);
        expect(s.unconverted).toBe(1);
        expect(s.last).toMatchObject({ unit: 'kg', weight: 1 });
    });

    test('التحقق: صفر أو سالب أو غير رقم = خطأ، والموجب يمر', () => {
        const ctx = loadEsm(WEIGHT_REPO, { apiFetch: jest.fn() }, ['validateReading']);
        const err = [{ field: 'weight', message: 'الوزن يجب أن يكون أكبر من صفر' }];
        expect(ctx.validateReading(0)).toEqual(err);
        expect(ctx.validateReading(-1)).toEqual(err);
        expect(ctx.validateReading('abc')).toEqual(err);
        expect(ctx.validateReading(0.5)).toEqual([]);
    });

    test('الحمولة تعكس حقول الخادم فقط وتُطبّع الوحدة والملاحظات', () => {
        const ctx = loadEsm(WEIGHT_REPO, { apiFetch: jest.fn() }, ['buildReadingPayload']);
        const now = new Date(2026, 9, 17, 9, 5, 7);
        expect(ctx.buildReadingPayload({
            weight: '2.5', unit: 'g', item: { id: 7, name: 'لحم' },
            notes: '   ', recordedBy: ' كريم ', now,
        })).toEqual({
            weight: 2.5, unit: 'g', date: '2026-10-17', time: '09:05:07',
            timestamp: now.toISOString(), itemId: 7, itemName: 'لحم',
            notes: null, recordedBy: 'كريم',
        });
        expect(ctx.buildReadingPayload({ weight: 1, unit: 'oz', now }).unit).toBe('kg');
        expect(ctx.buildReadingPayload({ weight: 1, now }).itemId).toBeNull();
    });

    test('تسجيل القراءة وإضافتها لوزن الصنف', async () => {
        const { apiFetch, calls } = repoStub((p) => (p === '/weightReadings' ? { id: 5 } : { id: 7, weight: 3 }));
        const ctx = loadEsm(WEIGHT_REPO, { apiFetch },
            ['createWeightReading', 'addWeightToItem', 'fetchWeightReadings']);
        await ctx.createWeightReading({ weight: 2, unit: 'kg' });
        const result = await ctx.addWeightToItem({ id: 7, weight: '2.5' }, 500, 'g');
        expect(result.nextWeight).toBe(3);
        expect(result.saved).toEqual({ id: 7, weight: 3 });
        await ctx.fetchWeightReadings();
        expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
            'POST /weightReadings',
            'PUT /inventory/7',
            'GET /weightReadings?page=1&limit=1000&sort=id&order=desc',
        ]);
        expect(JSON.parse(calls[1].body)).toEqual({ weight: 3 });
        await expect(ctx.addWeightToItem(null, 1, 'kg')).rejects.toThrow('الصنف غير موجود');
    });
});

describe('الشاشتان — لا شبكة مباشرة ولا معالج سطري', () => {
    test('الوصول للبيانات عبر repo فقط', () => {
        for (const f of [SHELVES, WEIGHT]) {
            const s = read(f).replace(/\/\*[\s\S]*?\*\//g, '');
            expect(s).not.toMatch(/\bapiFetch\b/);
            expect(s).not.toMatch(/[^a-zA-Z]fetch\(/);
            expect(s.match(/\son[a-z]+\s*=\s*["']/g) || []).toHaveLength(0);
        }
        expect(read(SHELVES)).toMatch(/from '\.\.\/data\/shelves-repo\.js\?v=/);
        expect(read(WEIGHT)).toMatch(/from '\.\.\/data\/weight-repo\.js\?v=/);
    });

    test('الرفوف: العلم والدور، والحذف يعلن SET NULL، والأيقونة لا تُحقن', () => {
        const s = read(SHELVES);
        expect(s).toMatch(/const writable = canWrite\(ctx\.role, SHELF_WRITE_ROLES\) && shelfWriteEnabled\(\)/);
        expect(s).toContain('ON DELETE SET NULL');
        expect(s).toContain('ولن تُحذف الأصناف نفسها');
        expect(s).toMatch(/data-i="archive"/);
        expect(s).not.toMatch(/shelf\.icon/);
    });

    test('الميزان: كتابة القراءة والصنف بعلمين ودورين، والفشل الجزئي يُعلن', () => {
        const s = read(WEIGHT);
        expect(s).toMatch(/canWrite\(ctx\.role, WEIGHT_WRITE_ROLES\) && weightWriteEnabled\(\)/);
        expect(s).toMatch(/const canAdd = writable && canWrite\(ctx\.role, WEIGHT_INVENTORY_ROLES\)/);
        expect(s).toContain('سُجّلت القراءة، لكن تعذّر تحديث وزن الصنف');
        expect(s).toContain('data-v2-step');
        expect(s).toContain('data-v2-unit');
        expect(s).toContain('data-v2-record');
        expect(s).toContain('data-v2-to-item');
    });

    test('المضيف يربط المفتاحين ويفكّ الشاشتين عند الانتقال', () => {
        const h = read(HOST);
        expect(h).toMatch(/import \{ mountShelvesScreen \} from '\.\/screens\/shelves\.js\?v=/);
        expect(h).toMatch(/import \{ mountWeightScreen \} from '\.\/screens\/weight\.js\?v=/);
        expect(h).toMatch(/key: 'shelves', title: 'الرفوف', mount: mountShelvesScreen/);
        expect(h).toMatch(/key: 'weight', title: 'الميزان', mount: mountWeightScreen/);
        expect(h).toMatch(/if \(key === 'shelves'\)/);
        expect(h).toMatch(/if \(key === 'weight'\)/);
        expect(h).toMatch(/teardownShelvesScreen\(\)/);
        expect(h).toMatch(/teardownWeightScreen\(\)/);
    });

    test('الوحدة الموحدة، وCSS الرفوف لا يسبق صفحة JS', () => {
        expect(REV).toBeTruthy();
        for (const f of [SHELF_REPO, WEIGHT_REPO, SHELVES, WEIGHT]) {
            const versions = [...read(f).matchAll(/\?v=([0-9.]+)/g)].map((m) => m[1]);
            expect(versions.length).toBeGreaterThan(0);
            for (const v of versions) {expect(v).toBe(REV);}
        }
        const css = (read(V2_HTML).match(/erp-ops\.css\?v=([0-9.]+)/) || [])[1];
        expect(css).toBeTruthy();
        const [a, b, c] = css.split('.').map(Number);
        const [x, y, z] = REV.split('.').map(Number);
        expect([a, b]).toEqual([x, y]);
        expect(c).toBeGreaterThanOrEqual(z);
    });
});
