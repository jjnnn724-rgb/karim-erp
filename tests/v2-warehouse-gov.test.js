/**
 * v2-warehouse-gov.test.js — عقد P2-4: حوكمة المخزن
 * ═══════════════════════════════════════════════════════════════════════
 * المرجع: backend/inventory-control-routes.js (329/339/356/383)
 *          backend/warehouse-routes.js (2815/2871)
 *          frontend/app/js/v2/data/warehouse-gov-repo.js
 *          frontend/app/js/v2/screens/warehouse-gov.js
 *
 * المثبَّت:
 *   • الأدوار مرآة حرفية لـrequireRole على الأبواب الستة.
 *   • كل باب يطابق المسار والطريقة والحقول الخمسة التي يقرأها الخادم فقط.
 *   • تحقق التواريخ يكرر شرط الخادم (YYYY-MM-DD و end >= start).
 *   • المصفّيات لا تخترع رقمًا: snapshot/opening/health كلها أعداد آمنة.
 *   • الشاشة بلا fetch/apiFetch/onclick، والكتابة مزدوجة القفل بالدور وعلم
 *     v2fiscalwrite، والقراءة وحدها ترسم بلا أي زر كتابة.
 *   • المسار الفرعي warehouse-gov موصول في routing.js وpreview.js، وزر
 *     الدخول من شاشة المخزون لا يظهر لدور بلا بطاقة قراءة.
 */
const { warehouseSource } = require('./helpers/warehouse-source');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const APP = path.join(__dirname, '..', 'frontend', 'app');
const V2 = path.join(APP, 'js', 'v2');
const REPO = path.join(V2, 'data', 'warehouse-gov-repo.js');
const SCREEN = path.join(V2, 'screens', 'warehouse-gov.js');
const WAREHOUSE = path.join(V2, 'screens', 'warehouse.js');
const PREVIEW = path.join(V2, 'preview.js');
const ROUTING = path.join(V2, 'routing.js');
const CSS = path.join(APP, 'css', 'v2', 'erp-warehouse-gov.css');
const V2_HTML = path.join(APP, 'v2.html');
const SERVER_FISCAL = path.join(__dirname, '..', 'backend', 'inventory-control-routes.js');
const SERVER_WAREHOUSE = warehouseSource();

const read = (p) => fs.readFileSync(p, 'utf8');
const REV = (read(V2_HTML).match(/js\/v2\/preview\.js\?v=([0-9.]+)/) || [])[1];

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
        Date, Math, Promise, Set, Map, encodeURIComponent,
        ...injections,
    };
    vm.createContext(context);
    vm.runInContext(src, context, { filename: file });
    return context;
}

function repoStub(impl) {
    const calls = [];
    const apiFetch = jest.fn(async (p, opts) => {
        calls.push({ path: p, method: (opts && opts.method) || 'GET', opts: opts || {} });
        return impl ? impl(p, opts) : {};
    });
    return { apiFetch, calls };
}

const EXPORTS = [
    'FISCAL_READ_ROLES', 'FISCAL_CREATE_ROLES', 'FISCAL_CLOSE_ROLES',
    'OPENING_READ_ROLES', 'HEALTH_READ_ROLES', 'hasGovernanceRead',
    'fetchFiscalYears', 'createFiscalYear', 'closeFiscalYear', 'createNextFiscalYear',
    'fetchOpeningBalanceReport', 'fetchSystemHealth',
    'validateFiscalYearForm', 'normalizeFiscalYearForm',
    'fiscalYearToRow', 'fiscalSummary', 'openingToInvoice', 'openingTotals', 'healthSummary',
];

describe('P2-4 — الأدوار مرآة الخادم', () => {
    const fiscal = read(SERVER_FISCAL);
    const warehouse = SERVER_WAREHOUSE;

    test('قراءة/إنشاء السنة: admin|manager|accountant حرفيًا', () => {
        expect(fiscal).toContain("router.get('/fiscal-years', jwtAuth, requireRole('admin', 'manager', 'accountant')");
        expect(fiscal).toContain("router.post('/fiscal-years', jwtAuth, requireRole('admin', 'manager', 'accountant')");
        const ctx = loadEsm(REPO, {}, EXPORTS);
        expect(ctx.FISCAL_READ_ROLES).toEqual(['admin', 'manager', 'accountant']);
        expect(ctx.FISCAL_CREATE_ROLES).toEqual(['admin', 'manager', 'accountant']);
    });

    test('الإقفال والسنة التالية للإدارة وحدها', () => {
        expect(fiscal).toContain("router.post('/fiscal-years/:id/close', jwtAuth, requireRole('admin')");
        expect(fiscal).toContain("router.post('/fiscal-years/:id/create-next', jwtAuth, requireRole('admin')");
        const ctx = loadEsm(REPO, {}, ['FISCAL_CLOSE_ROLES']);
        expect(ctx.FISCAL_CLOSE_ROLES).toEqual(['admin']);
    });

    test('الرصيد الافتتاحي admin|manager|warehouse وفحص النظام admin وحده', () => {
        expect(warehouse).toContain("router.get('/opening-balance/report', jwtAuth, requireRole('admin', 'manager', 'warehouse')");
        expect(warehouse).toContain("router.get('/system-health', jwtAuth, requireRole('admin')");
        const ctx = loadEsm(REPO, {}, ['OPENING_READ_ROLES', 'HEALTH_READ_ROLES']);
        expect(ctx.OPENING_READ_ROLES).toEqual(['admin', 'manager', 'warehouse']);
        expect(ctx.HEALTH_READ_ROLES).toEqual(['admin']);
    });

    test('hasGovernanceRead اتحاد البطاقات — لا دور يُعرض له زر لشاشة فارغة', () => {
        const ctx = loadEsm(REPO, {}, ['hasGovernanceRead']);
        expect(ctx.hasGovernanceRead('admin')).toBe(true);
        expect(ctx.hasGovernanceRead('manager')).toBe(true);
        expect(ctx.hasGovernanceRead('accountant')).toBe(true);
        expect(ctx.hasGovernanceRead('warehouse')).toBe(true);
        expect(ctx.hasGovernanceRead('cashier')).toBe(false);
        expect(ctx.hasGovernanceRead('')).toBe(false);
        expect(ctx.hasGovernanceRead(null)).toBe(false);
    });
});

describe('P2-4 — الأبواب والحمولات', () => {
    test('كل باب يطابق المسار والطريقة، والإنشاء يرسل الحقول الخمسة وحدها', async () => {
        const { apiFetch, calls } = repoStub((p) => {
            if (p === '/warehouse/fiscal-years') {return [{ id: 1 }];}
            if (p === '/warehouse/opening-balance/report') {return { invoices: [{ id: 9 }] };}
            return {};
        });
        const ctx = loadEsm(REPO, { apiFetch }, EXPORTS);
        await ctx.fetchFiscalYears();
        await ctx.createFiscalYear({ startDate: '2026-01-01', endDate: '2026-12-31', notes: '' });
        await ctx.closeFiscalYear(3);
        await ctx.createNextFiscalYear('4');
        const invoices = await ctx.fetchOpeningBalanceReport();
        await ctx.fetchSystemHealth();

        expect(invoices).toEqual([{ id: 9 }]);
        expect(calls).toEqual([
            { path: '/warehouse/fiscal-years', method: 'GET', opts: {} },
            {
                path: '/warehouse/fiscal-years', method: 'POST',
                opts: {
                    method: 'POST',
                    body: '{"startDate":"2026-01-01","endDate":"2026-12-31","yearCode":"2026","name":"السنة المالية 2026","notes":null}',
                },
            },
            { path: '/warehouse/fiscal-years/3/close', method: 'POST', opts: { method: 'POST' } },
            { path: '/warehouse/fiscal-years/4/create-next', method: 'POST', opts: { method: 'POST' } },
            { path: '/warehouse/opening-balance/report', method: 'GET', opts: {} },
            { path: '/warehouse/system-health', method: 'GET', opts: {} },
        ]);
    });

    test('القراءات لا تسلّم بنية غير متوقعة — مصفوفات فارغة لا انفجار', async () => {
        const { apiFetch } = repoStub(() => ({ items: [] }));
        const ctx = loadEsm(REPO, { apiFetch }, ['fetchFiscalYears', 'fetchOpeningBalanceReport']);
        expect(await ctx.fetchFiscalYears()).toEqual([]);
        expect(await ctx.fetchOpeningBalanceReport()).toEqual([]);
    });
});

describe('P2-4 — التحقق والتطبيع', () => {
    const ctx = loadEsm(REPO, {}, ['validateFiscalYearForm', 'normalizeFiscalYearForm']);

    test('شرط الخادم نفسه: YYYY-MM-DD و end >= start', () => {
        expect(ctx.validateFiscalYearForm({ startDate: '', endDate: '' }).map((e) => e.field)).toEqual(['startDate']);
        expect(ctx.validateFiscalYearForm({ startDate: '2026/01/01', endDate: '2026-12-31' }).map((e) => e.field)).toEqual(['startDate']);
        expect(ctx.validateFiscalYearForm({ startDate: '2026-01-01', endDate: '31-12-2026' }).map((e) => e.field)).toEqual(['endDate']);
        expect(ctx.validateFiscalYearForm({ startDate: '2026-12-31', endDate: '2026-01-01' }).map((e) => e.field)).toEqual(['endDate']);
        expect(ctx.validateFiscalYearForm({ startDate: '2026-01-01', endDate: '2026-01-01' })).toEqual([]);
        expect(ctx.validateFiscalYearForm({ startDate: ' 2026-01-01T00:00:00Z ', endDate: '2026-12-31' })).toEqual([]);
    });

    test('الافتراضات كما في الخادم: كود سنة البداية، والاسم، وسقف 120', () => {
        expect(ctx.normalizeFiscalYearForm({
            startDate: ' 2026-01-01 ', endDate: '2026-12-31', yearCode: '  ', name: '  ', notes: '  ',
        })).toEqual({
            startDate: '2026-01-01', endDate: '2026-12-31', yearCode: '2026',
            name: 'السنة المالية 2026', notes: null,
        });
        expect(ctx.normalizeFiscalYearForm({
            startDate: '2026-01-01', endDate: '2026-12-31', yearCode: 'FY-26', name: 'x'.repeat(130), notes: 'ملاحظة',
        })).toEqual({
            startDate: '2026-01-01', endDate: '2026-12-31', yearCode: 'FY-26',
            name: 'x'.repeat(120), notes: 'ملاحظة',
        });
        // لا حقل خارج ما يقرأه الخادم
        expect(Object.keys(ctx.normalizeFiscalYearForm({ startDate: '2026-01-01', endDate: '2026-12-31', id: 7, status: 'closed' })))
            .toEqual(['startDate', 'endDate', 'yearCode', 'name', 'notes']);
    });
});

describe('P2-4 — المصفّيات لا تخترع رقمًا', () => {
    const ctx = loadEsm(REPO, {}, EXPORTS);

    test('fiscalYearToRow: أعداد آمنة، لقطة من كائن أو نص JSON', () => {
        const row = ctx.fiscalYearToRow({
            id: 4, year_code: '2025', name: 'السنة المالية 2025',
            start_date: '2025-01-01T00:00:00.000Z', end_date: '2025-12-31T00:00:00.000Z',
            status: 'closed', closed_at: '2026-01-01T10:00:00.000Z', closed_by: 2,
            closing_snapshot: JSON.stringify({
                revenue_count: '10', revenue_total: '1000.50', expense_total: '400.25',
                net_result: '600.25', inventory_value: '55', inventory_count: '3',
            }),
            opening_balances: JSON.stringify({ inventory: [{ id: 1 }, { id: 2 }] }),
        });
        expect(row.startDate).toBe('2025-01-01');
        expect(row.endDate).toBe('2025-12-31');
        expect(row.openingCount).toBe(2);
        expect(row.hasSnapshot).toBe(true);
        expect(row.snapshot).toMatchObject({
            revenueCount: 10, revenueTotal: 1000.5, expenseTotal: 400.25,
            netResult: 600.25, inventoryValue: 55, inventoryCount: 3,
        });
        const broken = ctx.fiscalYearToRow({ id: 5, status: 'open', closing_snapshot: '{oops', start_date: null });
        expect(broken.startDate).toBe('');
        expect(broken.hasSnapshot).toBe(false);
        expect(broken.snapshot.revenueTotal).toBe(0);
        expect(broken.openingCount).toBe(0);
    });

    test('fiscalSummary يتبع ترتيب الخادم: أول مفتوحة، وإلا الأولى', () => {
        expect(ctx.fiscalSummary([
            { id: 2, status: 'closed' }, { id: 1, status: 'open', name: 'الحالية' },
        ])).toEqual({ total: 2, open: 1, closed: 1, current: { id: 1, status: 'open', name: 'الحالية' } });
        expect(ctx.fiscalSummary([])).toEqual({ total: 0, open: 0, closed: 0, current: null });
        expect(ctx.fiscalSummary(null)).toEqual({ total: 0, open: 0, closed: 0, current: null });
    });

    test('openingToInvoice/openingTotals: لا جمع مزدوج ولا رصيد مستنتج', () => {
        const inv = ctx.openingToInvoice({
            id: 7, invoiceNumber: 'OPEN-1', date: '2026-01-01T00:00:00.000Z', totalAmount: '250',
            items: [
                { itemId: 1, itemName: 'أرز', qty: '10', unit: 'كجم', price: '20', currentQty: '4', issuedSince: '6', itemExists: true },
                { itemId: 2, itemName: 'زيت', qty: 5, unit: 'لتر', currentQty: null, issuedSince: 0, itemExists: false },
            ],
        });
        expect(inv.date).toBe('2026-01-01');
        expect(inv.items[0]).toMatchObject({ itemId: '1', qty: 10, currentQty: 4, issuedSince: 6, itemExists: true });
        expect(inv.items[1]).toMatchObject({ itemId: '2', currentQty: null, itemExists: false });
        expect(ctx.openingTotals([inv])).toEqual({
            invoices: 1, lines: 2, qty: 15, issuedSince: 6, totalAmount: 250, missing: 1,
        });
        expect(ctx.openingTotals([])).toEqual({ invoices: 0, lines: 0, qty: 0, issuedSince: 0, totalAmount: 0, missing: 0 });
    });

    test('healthSummary: ok ليست nil، والملاحظات تُنظَّف', () => {
        expect(ctx.healthSummary({
            ok: true, itemsTotal: '12', consistent: 12, anomaliesCount: 0, zeroStock: '2', lowStock: 1,
            anomalies: [],
        })).toEqual({
            ok: true, itemsTotal: 12, consistent: 12, anomaliesCount: 0,
            zeroStock: 2, lowStock: 1, anomalies: [],
        });
        const bad = ctx.healthSummary({
            itemsTotal: 3, anomaliesCount: 2,
            anomalies: [{ name: 'أرز', issue: 'الرصيد ≠ المخازن' }, null, 'x'],
        });
        expect(bad.ok).toBe(false);
        expect(bad.anomalies).toEqual([{ name: 'أرز', issue: 'الرصيد ≠ المخازن' }]);
        expect(ctx.healthSummary(null).ok).toBe(false);
    });
});

describe('P2-4 — عقد مصدر الشاشة', () => {
    const src = read(SCREEN);

    test('لا fetch ولا apiFetch ولا inline handler (CSP + باب واحد)', () => {
        expect(src).not.toMatch(/\son(click|change|submit|keydown|input)=/i);
        expect(src).not.toMatch(/\bfetch\s*\(/);
        expect(src).not.toMatch(/\bapiFetch\b|core\/api\.js/);
    });

    test('الكتابة مزدوجة القفل: الدور + علم v2fiscalwrite، والقراءة وحدها بلا كتابة', () => {
        expect(src).toMatch(/import \{ fiscalWriteEnabled \} from '\.\.\/write-flags\.js\?v=/);
        expect(src).toMatch(/const fiscalWrite = fiscalWriteEnabled\(\);/);
        expect(src).toMatch(/fiscalCreate: canWrite\(role, FISCAL_CREATE_ROLES\) && fiscalWrite/);
        expect(src).toMatch(/fiscalClose: canWrite\(role, FISCAL_CLOSE_ROLES\) && fiscalWrite/);
        // السطر التحذيري يقرأ نفس القفل المحسوب — لا يظل ظاهرًا مع العلم المضاء
        expect(src).toMatch(/\$\{caps\.fiscalWrite\s*\? ''\s*:/);
        expect(src).toMatch(/fiscalRead: canWrite\(role, FISCAL_READ_ROLES\)/);
        expect(src).toMatch(/openingRead: canWrite\(role, OPENING_READ_ROLES\)/);
        expect(src).toMatch(/healthRead: canWrite\(role, HEALTH_READ_ROLES\)/);
        // لا زر إقفال/إنشاء يُرسم حين ينقص القفل — لا أزرار معطّلة
        expect(src).toMatch(/\$\{caps\.fiscalCreate \? `<button type="button" class="erp-btn erp-btn--primary erp-btn--sm erp-no-print" data-v2-fiscal-new>/);
        expect(src).toMatch(/\$\{caps\.fiscalClose \? '<th>الإجراء<\/th>' : ''\}/);
    });

    test('حراس isConnected بعد كل انتظار، وتأكيد الإقفال/السنة التالية بنص القديم', () => {
        expect((src.match(/if \(!el\.isConnected\)\s*\{return;\}/g) || []).length).toBeGreaterThanOrEqual(6);
        expect(src).toContain('لا يمكن تكرار الإقفال');
        expect(src).toContain('سيتم إنشاء السنة التالية وترحيل أرصدة المخزون الافتتاحية');
        expect(src).toContain('ميزة الإقفال غير مفعّلة');
        expect(src).not.toContain('v2fiscalwrite</span>');
    });

    test('الجداول ببنية erp-table__scroll > erp-table__grid', () => {
        expect(src).toContain('erp-table__scroll');
        expect(src).toContain('erp-table__grid');
        expect(src).not.toMatch(/class="erp-table"/);
    });

    test('البطاقات الثلاث لكل باب: سنوات، افتتاحي، فحص', () => {
        for (const door of ['data-v2-fiscal', 'data-v2-opening', 'data-v2-health',
            'data-v2-fiscal-form-input', 'data-v2-fiscal-close', 'data-v2-fiscal-next',
            'data-v2-opening-row']) {
            expect(src).toContain(door);
        }
        expect(src).toContain('OPEN-*');
        expect(src).toContain('issuedSince');
    });

    test('رسالة 401/403 منطوقة من الخادم لا مخمّنة', () => {
        expect(src).toContain('انتهت الجلسة — سجّل الدخول في النظام الحالي ثم أعد فتح الوضع الحيّ.');
        expect(src).toContain('القرار للخادم وحده');
    });
});

describe('P2-4 — الوصل والمسار', () => {
    test('routing يستثني المسار الفرعي وpreview يوزّعه ويهدمه', async () => {
        const routing = loadEsm(ROUTING, {}, ['SUB_ROUTES']);
        expect(routing.SUB_ROUTES).toContain('warehouse-gov');
        const host = read(PREVIEW);
        expect(host).toContain("from './screens/warehouse-gov.js?v=");
        expect(host).toMatch(/if \(key === 'warehouse-gov'\) \{\n\s*renderWarehouseGovScreen\(\);/);
        expect(host).toContain('mountWarehouseGovScreen(');
        expect(host).toContain('teardownWarehouseGovScreen();');
        expect(host).toMatch(/function teardownWarehouseGovScreen\(\)/);
        expect(host).toContain('data-v2-warehouse-gov-host');
    });

    test('شاشة المخزون تفتح الحوكمة بالتنقّل، وpreview يمرّر navigate', () => {
        const wh = read(WAREHOUSE);
        expect(wh).toContain('hasGovernanceRead');
        expect(wh).toContain('data-v2-gov');
        expect(wh).toContain("navigate('warehouse-gov')");
        expect(wh).toMatch(/const canGov = !!navigate && hasGovernanceRead\(role\)/);
        const host = read(PREVIEW);
        const block = host.slice(host.indexOf('warehouseScreen = mountWarehouseScreen'), host.indexOf('});', host.indexOf('warehouseScreen = mountWarehouseScreen')));
        expect(block).toContain('navigate: (key) => shell.navigate(key)');
    });

    test('ورقة CSS موصولة بمراجعة الصفحة نفسها', () => {
        expect(REV).toBeTruthy();
        expect(read(V2_HTML)).toContain(`css/v2/erp-warehouse-gov.css?v=${REV}`);
    });
});

describe('P2-4 — CSS بلا hex أو px خام وكل قواعده مُختصة', () => {
    const css = read(CSS).replace(/\/\*[\s\S]*?\*\//g, '');

    test('القيم من الرموز ونقطة الكسر وحدها بلا رمز', () => {
        expect(css).not.toMatch(/#[0-9a-f]{3,8}\b/i);
        expect(css.replace(/@media[^{]*/g, '@media')).not.toMatch(/\b\d+px\b/);
    });

    test('كل محدّد يبدأ بـ.erp-v2-wgov', () => {
        const selectors = [...css.matchAll(/^[ \t]*([.][^{@]*)\{/gm)].map((m) => m[1].trim());
        expect(selectors.length).toBeGreaterThan(0);
        for (const sel of selectors) {
            expect(sel.startsWith('.erp-v2-wgov')).toBe(true);
        }
    });

    test('الجداول لا تدفع الصفحة: سقف داخل erp-table__scroll', () => {
        expect(css).toMatch(/\.erp-v2-wgov \.erp-table__scroll \{[^}]*max-block-size:/);
        expect(css).toMatch(/\.erp-v2-wgov \.erp-wgov__form-grid \{[^}]*grid-template-columns: repeat\(auto-fit/);
    });
});
