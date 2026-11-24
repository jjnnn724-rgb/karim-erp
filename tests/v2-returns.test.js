/**
 * v2-returns.test.js — عقد شاشة 20 (مرتجعات المطبخ) في V2 — دورة المرتجعات W1-5
 * ═══════════════════════════════════════════════════════════════════════
 * نفس أسلوب tests/v2-veg.test.js (W1-4): المستودع يُحمَّل في vm وبوابته
 * apiFetch مزيفة، والشاشة تُقرأ كعقد مصدر (testEnvironment:'node').
 *
 * المثبَّت هنا:
 *   • الباب الواحد لشبكة الشاشة: warehouse-repo.js — قراءات لوحة الإنشاء،
 *     وحمولة الإنشاء، وبابا POST للإنشاء والإبطال مع X-Idempotency-Key
 *   • فصل الأدوار: RETURN_ROLES للإنشاء وRETURN_VOID_ROLES للإبطال، ورفض
 *     سبب الإبطال الفارغ قبل أي اتصال، وتشفير معرّف الإبطال في المسار
 *   • عقود الوزن المتغير: packagingQty/packagingUom وcatchWeight، وحفظ
 *     actualWeight مع التعبئة الموجبة في حمولة الإنشاء
 *   • kitchenReturnToRow يعرّض voided؛ الإجمالي النشط يستبعد المبطل والعدّ
 *     يشمل كل السجلات، مع اختبار سلوكي للشاشة المركّبة
 *   • الشاشة بلا fetch/apiFetch أو window.confirm: لوحة سبب إبطال وحالة
 *     «مبطل» وإجراء «إبطال»، مع حراس القراءة والقرار وdestroy()
 *   • الخادم: مسار الإبطال يرفض السبب الفارغ ويحفظ السجل، والحذف القديم
 *     والكتابة العامة على kitchenReturns محجوبان بـ405، وحارس الإذن النشط
 *   • المضيف والطبقة: هوية السجلات المشتركة، مراجعة الأصول، ورموز CSS فقط
 */
const { warehouseSource } = require('./helpers/warehouse-source');
const fs = require('fs');
const path = require('path');
const { ruleBody, hidesLabel, withoutSrOnly } = require('./helpers/css-contract');
const vm = require('vm');

const APP = path.join(__dirname, '..', 'frontend', 'app');
const V2 = path.join(APP, 'js', 'v2');
const REPO = path.join(V2, 'data', 'warehouse-repo.js');
const SCREEN = path.join(V2, 'screens', 'wh-returns.js');
const OPS_CSS = path.join(APP, 'css', 'v2', 'erp-ops.css');
const V2_HTML = path.join(APP, 'v2.html');
const HOST = path.join(V2, 'preview.js');
const ICONS = path.join(APP, 'js', 'icons.js');
const VR = warehouseSource();
const LEGACY = path.join(APP, 'js', 'features', 'kitchen.js');
const SERVER = path.join(__dirname, '..', 'backend', 'server.js');
// REV مشتق من الوسم الحيّ في v2.html (نفس نمط v2-kitchen/wh-prs/veg).
const REV = (fs.readFileSync(V2_HTML, 'utf8').match(/js\/v2\/preview\.js\?v=([0-9.]+)/) || [])[1];

function loadEsm(file, injections = {}, collect = []) {
    const stripped = fs.readFileSync(file, 'utf8')
        .replace(/^[ \t]*import[\s\S]*?from\s*['"][^'"]+['"];[ \t]*$/gm, '')
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

const EXPORTS = ['isoDay', 'firstOfMonth', 'WALK_PAGES',
    'fetchInventoryTx', 'fetchKitchenReturns', 'INV_TYPE_AR', 'INV_TYPE_TONE',
    'invTxToRow', 'kitchenReturnToRow',
    'RETURN_ROLES', 'RETURN_VOID_ROLES', 'returnCreateVisible', 'returnVoidVisible',
    'fetchReturnDispatches', 'returnDispatchOption', 'fetchReturnDepartments',
    'directReturnDepartments', 'deptLabelOf', 'fetchReturnInventory', 'returnInventoryOption',
    'returnDeptCodesOf', 'returnCreatePayload', 'createKitchenReturn', 'voidKitchenReturn'];

function repoStub(impl, injections = {}) {
    const calls = [];
    const bodies = [];
    const methods = [];
    const requests = [];
    const apiFetch = jest.fn(async (p, opts = {}) => {
        calls.push(p);
        methods.push(opts.method);
        requests.push({ path: p, ...opts });
        if (opts.body) {bodies.push({ path: p, body: opts.body, method: opts.method });}
        return typeof impl === 'function' ? impl(p, opts) : impl;
    });
    const repo = loadEsm(REPO, { apiFetch, ...injections }, EXPORTS);
    return { calls, bodies, methods, requests, repo, apiFetch };
}

function returnsScreenStub(rows, role = 'admin') {
    const gateway = repoStub({ data: rows });
    const repoFns = Object.fromEntries(EXPORTS.map((name) => [name, gateway.repo[name]]));
    const countEl = { textContent: '' };
    const summaryEl = { textContent: '' };
    const panelEl = {
        innerHTML: '', hidden: true,
        querySelectorAll: () => [],
        querySelector: () => null,
        scrollIntoView: jest.fn(),
    };
    const tableHost = { appendChild: jest.fn() };
    const nodes = {
        '[data-v2-count]': countEl,
        '[data-v2-summary]': summaryEl,
        '[data-v2-panel]': panelEl,
        '[data-v2-table]': tableHost,
    };
    const listeners = {};
    const el = {
        isConnected: true,
        querySelector: (selector) => nodes[selector] || null,
        addEventListener: jest.fn((type, handler) => { listeners[type] = handler; }),
        remove: jest.fn(),
    };
    const host = { insertAdjacentHTML: jest.fn(), lastElementChild: el };
    const table = {
        el: {}, rows: [], setLoading: jest.fn(), setError: jest.fn(), destroy: jest.fn(),
    };
    table.setRows = jest.fn((next) => { table.rows = next; });
    let tableOptions;
    const notify = jest.fn();
    const confirm = jest.fn();
    const context = loadEsm(SCREEN, {
        ...repoFns,
        createDataTable: jest.fn((options) => { tableOptions = options; return table; }),
        fetchCurrency: async () => 'SAR',
        formatMoney: (value, currency) => ({ amount: String(value), unit: currency, hasUnit: Boolean(currency) }),
        formatInt: (value) => String(value),
        formatQty: (value) => String(value),
        window: { confirm, print: jest.fn() },
    });
    const screen = context.mountWhReturnsScreen(host, { role, notify });
    return { screen, gateway, context, host, el, panelEl, countEl, summaryEl, table, tableOptions, listeners, notify, confirm };
}

const flushAsync = () => new Promise((resolve) => setImmediate(resolve));

const source = (f) => fs.readFileSync(f, 'utf8');
const legacyOf = () => source(LEGACY);
const stripComments = (s) => s
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

describe('warehouse-repo — الباب الواحد: قراءات لوحة الإنشاء وبابا الكتابة', () => {
    test('كل ما تحتاجه الشاشة مُصدَّر', () => {
        const src = source(REPO);
        for (const name of EXPORTS) {
            expect(src).toMatch(new RegExp(`export (async function|function|const) ${name}\\b`));
        }
    });

    test('إذونات الصرف: عين القديم :1256 (approved فقط) — والصف approvedItems ثم items', async () => {
        const { calls, repo } = repoStub({
            data: [
                { id: 2, status: 'pending', deptName: 'المطبخ', items: [{ itemName: 'طماطم', qty: 1, unit: 'كجم' }] },
                {
                    id: 1, status: 'approved', deptName: 'المطبخ', date: '2026-10-15T00:00:00Z',
                    approvedItems: [{ itemName: 'خيار', unit: 'كجم', approvedQty: 3 }],
                },
            ],
        });
        const out = await repo.fetchReturnDispatches();
        expect(calls).toEqual(['/dispatches?page=1&limit=1000&sort=id&order=desc']);
        expect(out).toHaveLength(1);   // المعلّق يسقط — الاختيار للـapproved وحده
        expect(out[0]).toMatchObject({ id: 1, deptName: 'المطبخ', date: '2026-10-15' });
        expect(out[0].items).toEqual([{ name: 'خيار', unit: 'كجم', qty: 3, packagingQty: null, packagingUom: '' }]);
    });

    test('مشي الصفحات: الصفحة القصيرة تقصر — وtotalPages يقفل', async () => {
        const big = repoStub({ data: Array.from({ length: 1000 }, (_, i) => ({ id: i })), pagination: { totalPages: 1 } });
        await big.repo.fetchKitchenReturns();
        expect(big.calls).toEqual(['/kitchenReturns?page=1&limit=1000&sort=id&order=desc&v2_period=month']);
        const short = repoStub({ data: [{ id: 1 }] });
        await short.repo.fetchInventoryTx();
        expect(short.calls).toHaveLength(1);
        const { repo } = repoStub({});
        expect(repo.WALK_PAGES).toBe(8);
    });

    test('صف الإذن: approvedQty ?? qty والتعبئة محفوظة — بلا تخمين', () => {
        const { repo } = repoStub({});
        const full = repo.returnDispatchOption({
            id: 5, deptName: 'كافتيريا', date: '2026-10-15T08:00:00Z',
            approvedItems: [{ itemName: 'طماطم', unit: 'كجم', approvedQty: 0, qty: 9 }],
        });
        expect(full.items).toEqual([{ name: 'طماطم', unit: 'كجم', qty: 0, packagingQty: null, packagingUom: '' }]);   // 0 قيمة لا سقوط
        const fallback = repo.returnDispatchOption({
            id: 6, deptCode: 'caf', items: [{ name: 'بصل', qty: '2.5' }],
        });
        expect(fallback).toMatchObject({ id: 6, deptName: 'caf', date: '' });
        expect(fallback.items).toEqual([{ name: 'بصل', unit: '', qty: 2.5, packagingQty: null, packagingUom: '' }]);
        const packed = repo.returnDispatchOption({
            id: 8, approvedItems: [{ itemName: 'دجاج', approvedQty: 12.5, packagingQty: '3', packagingUom: 'صندوق' }],
        });
        expect(packed.items).toEqual([{ name: 'دجاج', unit: '', qty: 12.5, packagingQty: 3, packagingUom: 'صندوق' }]);
        const bad = repo.returnDispatchOption({ id: 7, approvedItems: [{ itemName: '', qty: 1 }] });
        expect(bad.items).toEqual([]);
    });

    test('أقسام الإرجاع المباشر: فلتر القديم :1259 حرفًا — واسم السقوط name_ar ثم الكود', () => {
        const { repo } = repoStub({});
        const out = repo.directReturnDepartments([
            { code: 'caf', name: 'كافتيريا' },
            { code: 'ys_kitchen', name: 'مرآة' },
            { code: 'kitchen', name: 'المطبخ' },
            { code: 'external_sales', name: 'بيع خارجي' },
            { code: 'grill', parent_code: 'kitchen', name: 'مشويات' },
            { code: 'svc', name_ar: 'خدمة', parent_code: 'fb' },
            { code: '' },
        ]);
        expect(out).toEqual([
            { code: 'caf', name: 'كافتيريا' },
            { code: 'svc', name: 'خدمة' },
            { code: '', name: '' },
        ]);
    });

    test('deptLabelOf: بالكود الصغير، والباقي يُعرض خامًا', () => {
        const { repo } = repoStub({});
        expect(repo.deptLabelOf([{ code: 'CAF', name: 'كافتيريا' }], ' caf ')).toBe('كافتيريا');
        expect(repo.deptLabelOf([{ code: 'caf', name_ar: 'قسم' }], 'caf')).toBe('قسم');
        expect(repo.deptLabelOf([{ code: 'caf' }], 'caf')).toBe('caf');
        expect(repo.deptLabelOf([{ code: 'caf', name: 'كافتيريا' }], 'x')).toBe('x');
        expect(repo.deptLabelOf(null, null)).toBe('');
    });

    test('أكواد صاحب الحساب: قائمة بفواصل تطبيع كما dispatch-repo.deptCodesOf', () => {
        const { repo } = repoStub({});
        expect(repo.returnDeptCodesOf('CAF, SERVICE ,x')).toEqual(['caf', 'service', 'x']);
        expect(repo.returnDeptCodesOf(null)).toEqual([]);
        expect(repo.returnDeptCodesOf(', ,')).toEqual([]);
    });

    test('أسماء المخزون: بلا بوابة رصيد — والفراغ يسقط وعقود الوزن المتغير تبقى', async () => {
        const { calls, repo } = repoStub({
            data: [
                { id: 1, name: 'طماطم', unit: 'كجم', qty: '2.5' },
                { id: 3, name: 'دجاج', catch_weight_enabled: 1, packaging_uom: 'صندوق' },
                { id: 2, name: '' },
            ],
        });
        const out = await repo.fetchReturnInventory();
        expect(calls).toEqual(['/inventory?page=1&limit=1000&sort=id&order=desc']);
        expect(out).toEqual([
            { id: 1, name: 'طماطم', unit: 'كجم', qty: 2.5, catchWeight: false, packagingUom: 'كرتون' },
            { id: 3, name: 'دجاج', unit: '', qty: 0, catchWeight: true, packagingUom: 'صندوق' },
        ]);
    });

    test('حمولة الإنشاء: الفرعان كما يرسلهما القديم :1360/:1385 — والصفوف الفارغة تسقط :1356', () => {
        const { repo } = repoStub({});
        const direct = repo.returnCreatePayload({
            deptCode: ' caf ', reason: 'فائض إنتاج', notes: '  قبل ٩  ',
            items: [
                { name: '  طماطم  ', qty: '2.5' },
                { name: 'دجاج', qty: '12.5', packagingQty: '3', packagingUom: 'صندوق', actualWeight: '11.75' },
                { name: 'خيار', qty: 0 },
                { name: '', qty: 3 },
                { name: 'بصل', qty: 'abc' },
                { name: 'جزر', qty: -1 },
            ],
        });
        expect(direct).toEqual({
            reason: 'فائض إنتاج', notes: 'قبل ٩',
            items: [
                { name: 'طماطم', qty: 2.5 },
                { name: 'دجاج', qty: 12.5, packagingQty: 3, packagingUom: 'صندوق', actualWeight: 11.75 },
            ], deptCode: 'caf',
        });
        expect(repo.returnCreatePayload({
            items: [{ name: 'دجاج', qty: 1, packagingQty: 2, actualWeight: 1.5 }],
        }).items[0].packagingUom).toBe('كرتون');
        const linked = repo.returnCreatePayload({
            deptCode: 'caf', dispatchId: 9, reason: 'أخرى', notes: '',
            items: [{ name: 'طماطم', qty: 1 }],
        });
        expect(linked).toEqual({ reason: 'أخرى', notes: '', items: [{ name: 'طماطم', qty: 1 }], dispatchId: 9 });
        expect(linked).not.toHaveProperty('deptCode');   // الفرعان لا يجتمعان
        const empty = repo.returnCreatePayload({ dispatchId: '  ', deptCode: 'caf' });
        expect(empty.dispatchId).toBeUndefined();
        expect(empty.deptCode).toBe('caf');
    });

    test('الإنشاء POST مع مفتاح عدم التكرار والرد كما هو', async () => {
        const response = { return: { id: 11 }, totalValue: 20 };
        const create = repoStub(response, { crypto: { randomUUID: () => 'uuid-create' } });
        const payload = { dispatchId: 9, reason: 'x', notes: '', items: [{ name: 'طماطم', qty: 2 }] };
        await expect(create.repo.createKitchenReturn(payload)).resolves.toBe(response);
        expect(create.calls).toEqual(['/warehouse/returns']);
        expect(create.methods).toEqual(['POST']);
        expect(JSON.parse(create.bodies[0].body)).toEqual(payload);
        expect(create.requests[0].headers).toEqual({ 'X-Idempotency-Key': 'return-create:9:uuid-create' });

        const direct = repoStub({}, { crypto: { randomUUID: () => 'uuid-direct' } });
        await direct.repo.createKitchenReturn({ deptCode: 'caf', items: [] });
        expect(direct.requests[0].headers).toEqual({ 'X-Idempotency-Key': 'return-create:direct:uuid-direct' });
    });

    test('الإبطال POST بالمعرّف المُشفَّر وسبب منظّف ومفتاح عدم التكرار', async () => {
        const response = { return: { id: '7/8', status: 'voided' } };
        const voided = repoStub(response, { crypto: { randomUUID: () => 'uuid-void' } });
        await expect(voided.repo.voidKitchenReturn('7/8', '  تلف موثّق  ')).resolves.toBe(response);
        expect(voided.calls).toEqual(['/warehouse/returns/7%2F8/void']);
        expect(voided.methods).toEqual(['POST']);
        expect(JSON.parse(voided.bodies[0].body)).toEqual({ reason: 'تلف موثّق' });
        expect(voided.requests[0].headers).toEqual({ 'X-Idempotency-Key': 'return-void:7/8:uuid-void' });
    });

    test('سبب الإبطال الفارغ مرفوض قبل الشبكة', async () => {
        const voided = repoStub({});
        for (const reason of ['', '   ', null, undefined]) {
            await expect(voided.repo.voidKitchenReturn(7, reason)).rejects.toThrow('أدخل سبب إبطال المرتجع');
        }
        expect(voided.apiFetch).not.toHaveBeenCalled();
        expect(voided.calls).toEqual([]);
    });
});

describe('warehouse-repo — الثوابت مرايا الخادم والقديم بمسافاتهما', () => {
    test('قائمتا الأدوار ومسارا الكتابة: إنشاء أوسع من الإبطال', () => {
        const { repo } = repoStub({});
        const wr = VR;
        const list = (a) => `[${a.map((r) => `'${r}'`).join(', ')}]`;   // مسافات الخادم
        expect(wr).toContain(`const RETURN_ROLES = ${list(repo.RETURN_ROLES)};`);
        expect(repo.RETURN_ROLES).toEqual(['admin', 'manager', 'warehouse', 'kitchen', 'sous_chef', 'dept_head']);
        expect(repo.RETURN_VOID_ROLES).toEqual(['admin', 'manager', 'warehouse']);
        expect(wr).toContain("router.post('/returns', jwtAuth, requireRoleOrPerm(RETURN_ROLES, 'dispatch.return'), idempotency({ requireKey: true })");
        expect(wr).toContain("router.post('/returns/:id/void', jwtAuth, requireRoleOrPerm(['admin', 'manager', 'warehouse'], 'dispatch.void'), idempotency({ requireKey: true })");
    });

    test('قائمتا الواجهة القديمتان: canReturn للإنشاء وcanVoid للإبطال', () => {
        const { repo } = repoStub({});
        const legacy = source(LEGACY);
        expect(legacy).toContain("const canReturn=['admin','manager','warehouse','kitchen','sous_chef','dept_head'].includes(STATE.currentUser?.role);");
        expect(legacy).toContain("const canVoid=['admin','manager','warehouse'].includes(STATE.currentUser?.role);");
        expect(repo.RETURN_ROLES.join()).toBe('admin,manager,warehouse,kitchen,sous_chef,dept_head');
        expect(repo.RETURN_VOID_ROLES.join()).toBe('admin,manager,warehouse');
    });

    test('الخادم: السقف والتعبئة والمرتجعات المبطلة لا تستهلك حق الإرجاع', () => {
        const wr = VR;
        expect(wr).toContain("if (dispatchId === undefined || dispatchId === null || String(dispatchId).trim() === '')");
        expect(wr).toContain("['approved', 'partially_received', 'received']");
        expect(wr).toContain("return fail(res, 409, 'DISPATCH_NOT_APPROVED', 'لا يمكن إرجاع طلب غير معتمد');");
        expect(wr).toContain("return fail(res, 422, 'DEPT_REQUIRED', 'اختر القسم المُرجِع');");
        expect(wr).toContain("return fail(res, 422, 'EMPTY_RETURN_ITEMS', 'يجب تحديد صنف وكمية للإرجاع');");
        expect(wr).toContain('SELECT items FROM "kitchenReturns" WHERE "dispatchId" = $1 AND "voidedAt" IS NULL FOR UPDATE');
        expect(wr).toContain("return fail(res, 409, 'RETURN_QTY_EXCEEDED'");
        expect(wr).toContain("return fail(res, 422, 'RETURN_PACKAGING_REQUIRED'");
        expect(wr).toContain("return fail(res, 409, 'RETURN_PACKAGING_EXCEEDED'");
    });

    test('الإبطال يحفظ السجل والحذف محجوب — وإبطال الإذن ينتظر المرتجع النشط', () => {
        const wr = VR;
        expect(wr).toContain("if (!reason) {return fail(res, 422, 'RETURN_VOID_REASON_REQUIRED', 'أدخل سبب إبطال المرتجع');}");
        expect(wr).toContain("return res.status(409).json({ error: 'RETURN_ALREADY_VOIDED', message: 'تم إبطال المرتجع مسبقًا' });");
        expect(wr).toContain(`UPDATE "kitchenReturns" SET status='voided', "voidedAt"=NOW(), "voidedBy"=$2, "voidReason"=$3 WHERE id=$1 RETURNING *`);
        expect(wr).toContain("message: 'تم إبطال المرتجع وعكس أثره مع حفظ السجل'");
        expect(wr).toContain("return fail(res, 405, 'RETURN_DELETE_DISABLED', 'لا يُحذف المرتجع — استخدم الإبطال لعكس أثره مع حفظ السجل');");
        expect(wr).toContain('SELECT id FROM "kitchenReturns" WHERE "dispatchId"=$1 AND "voidedAt" IS NULL LIMIT 1');
        expect(wr).toContain("return fail(res, 409, 'DISPATCH_ACTIVE_RETURN', 'أبطل المرتجع المرتبط أولًا قبل إبطال إذن الصرف');");
    });

    test('الكتابة العامة على kitchenReturns محجوبة في كل الفروع', () => {
        const server = source(SERVER);
        expect(server.match(/استخدم \/api\/warehouse\/returns لتنفيذ العكس المخزني والمحاسبي مع حفظ السجل/g)).toHaveLength(2);
        expect(server.match(/لا يُعدّل المرتجع مباشرة — استخدم مسار الإبطال لعكس أثره مع حفظ السجل/g)).toHaveLength(2);
        expect(server).toContain("return res.status(405).json({ error: 'RETURN_DELETE_DISABLED', message: 'لا يُحذف المرتجع — استخدم /api/warehouse/returns/:id/void لعكس أثره مع حفظ السجل' });");
    });
});

describe('warehouse-repo — الصف والبوابات', () => {
    test('صف السجل كما كان: القسم والطلب والأصناف موجزة والقيمة', () => {
        const { repo } = repoStub({});
        const row = repo.kitchenReturnToRow({
            id: 5, deptCode: 'caf', deptName: 'كافتيريا', dispatchId: null,
            items: [{ itemName: 'طماطم', qty: 2 }, { name: 'خيار', qty: 1 }],
            reason: 'فائض إنتاج', totalValue: '40', date: '2026-10-15T08:00:00Z', status: 'approved',
        });
        expect(row).toMatchObject({
            id: 5, deptName: 'كافتيريا', itemsSummary: 'طماطم (2)، خيار (1)', itemsCount: 2,
            reason: 'فائض إنتاج', totalValue: 40, date: '2026-10-15', status: 'approved', voided: false,
        });
        const sparse = repo.kitchenReturnToRow({ id: 6, notes: 'ملاحظة' });
        expect(sparse).toMatchObject({ deptName: '—', reason: 'ملاحظة', itemsSummary: '—', itemsCount: 0, voided: false });
    });

    test('الصف المبطل يبقى ظاهرًا: status=voided أو voidedAt كلاهما يرفع voided', () => {
        const { repo } = repoStub({});
        expect(repo.kitchenReturnToRow({ id: 7, status: 'voided', totalValue: '99' }))
            .toMatchObject({ id: 7, status: 'voided', totalValue: 99, voided: true });
        expect(repo.kitchenReturnToRow({ id: 8, status: 'approved', voidedAt: '2026-11-24T10:00:00Z' }).voided).toBe(true);
        expect(repo.kitchenReturnToRow({ id: 9, status: 'approved' }).voided).toBe(false);
    });

    test('بوابتا الأزرار بالحدّية — فصل أدوار الإنشاء عن الإبطال', () => {
        const { repo } = repoStub({});
        for (const r of repo.RETURN_ROLES) {expect(repo.returnCreateVisible(r)).toBe(true);}
        expect(repo.returnCreateVisible('owner')).toBe(false);
        expect(repo.returnCreateVisible('cashier')).toBe(false);
        expect(repo.returnCreateVisible('')).toBe(false);
        for (const r of repo.RETURN_VOID_ROLES) {expect(repo.returnVoidVisible(r)).toBe(true);}
        expect(repo.returnVoidVisible('kitchen')).toBe(false);
        expect(repo.returnVoidVisible('sous_chef')).toBe(false);
        expect(repo.returnVoidVisible('dept_head')).toBe(false);
        expect(repo.returnVoidVisible('')).toBe(false);
        expect(repo.RETURN_ROLES).toEqual(expect.arrayContaining(repo.RETURN_VOID_ROLES));
    });
});

describe('شاشة 20 — العقد المصدَّر من المصدر', () => {
    const src = () => source(SCREEN);

    test('لا شبكة من الشاشة: الباب الواحد فقط، ولا fetch ولا apiFetch', () => {
        const s = stripComments(src());
        expect(s).not.toMatch(/\bapiFetch\b/);
        expect(s).not.toMatch(/\bfetch\(/);
        expect(s).toMatch(/from '\.\.\/data\/warehouse-repo\.js\?v=/);
        expect(s).not.toMatch(/['"`]\/warehouse/);
        expect(s).not.toMatch(/['"`]\/api\//);
    });

    test('لا معالج سطري ولا confirm — الإبطال بلوحة سبب وحالة وإجراء محفوظ', () => {
        const s = src();
        const handlers = s.match(/\son[a-z]+=/g) || [];
        expect(handlers).toHaveLength(0);
        expect(s).not.toMatch(/window\.(prompt|alert|confirm)\(/);
        expect(s).not.toMatch(/\bconfirmFn\b/);
        expect(s).not.toMatch(/قراءة فقط|موجة كتابة/);
        expect(s).not.toMatch(/\b(deleteKitchenReturn|returnDeleteVisible)\b/);
        expect(s).toContain("if (returnVoidVisible(role)) {");
        expect(s).toContain('voidKitchenReturn');
        expect(s).toContain("key: 'actions', header: 'إجراءات'");
        expect(s).toContain('>مبطل</span>');
        expect(s).toContain('<span>إبطال</span>');
        expect(s).toContain('data-v2-void-reason');
        expect(s).toContain("panelActions('تأكيد الإبطال', 'undo')");
    });

    test('الأبواب الثلاثة عشر كلها مستدعاة: قراءات وحمولة والإنشاء والإبطال', () => {
        // الشطب للاستيراد فقط: الاسم يكفي مرجعًا (rets.map(kitchenReturnToRow)) أو نداءً.
        const s = src().replace(/import[\s\S]*?from '[^']+';/g, '');
        for (const fn of ['fetchKitchenReturns', 'kitchenReturnToRow',
            'returnCreateVisible', 'returnVoidVisible',
            'fetchReturnDispatches', 'fetchReturnDepartments', 'fetchReturnInventory',
            'directReturnDepartments', 'deptLabelOf', 'returnDeptCodesOf',
            'returnCreatePayload', 'createKitchenReturn', 'voidKitchenReturn']) {
            expect(s).toMatch(new RegExp(`\\b${fn}\\b`));
        }
    });

    test('الحمولات من دوال البوابة النقية — والإبطال بالمعرّف والسبب', () => {
        const s = src();
        expect(s).toContain('await createKitchenReturn(returnCreatePayload({ ...target, reason, notes, items }));');
        expect(s).toContain('await voidKitchenReturn(row.id, reason);');
    });

    test('كلمات التحقق والتحذير المشتركة مع القديم', () => {
        const s = src();
        const legacy = legacyOf();
        for (const phrase of [
            'اختر طلب صرف',
            'اختر القسم المُرجِع',
            'أضف صنفًا واحدًا على الأقل',
            'تعذر تنفيذ الإرجاع',
            'تعذر إبطال المرتجع',
            'أدخل سبب إبطال المرتجع',
        ]) {
            expect(s).toContain(phrase);
            expect(legacy).toContain(phrase);
        }
    });

    test('رسائل النجاح بنصّ القديم — والعملة من الإعدادات لا مثبتة', () => {
        const s = src();
        const legacy = legacyOf();
        expect(s).toContain('تم الإرجاع وإعادة ${moneyPlain((res && res.totalValue) || 0)} للمخزن وعكس مصروف القسم');
        expect(s).toContain('تم الإرجاع المباشر وإعادة ${moneyPlain((res && res.totalValue) || 0)} للمخزن');
        expect(legacy).toContain('تم الإرجاع وإعادة ${fC(result.totalValue||0)} للمخزن وعكس مصروف القسم');
        expect(legacy).toContain('تم الإرجاع المباشر وإعادة ${fC(result.totalValue||0)} للمخزن');
        expect(s).toContain("notify((res && res.message) || 'تم إبطال المرتجع وعكس أثره مع حفظ السجل');");
        expect(legacy).toContain("toast(result.message||'تم إبطال المرتجع وعكس أثره مع حفظ السجل','success');");
        expect(s).toContain('moneyPlain');
    });

    test('قايمة الأسباب الخمسة من القديم — والوضعان وبند الإذن', () => {
        const s = src();
        const legacy = legacyOf();
        expect(s).toContain("const RETURN_REASONS = ['فائض إنتاج', 'تغيير قائمة', 'انتهاء الوردية', 'خطأ في الصرف', 'أخرى'];");
        for (const r of ['فائض إنتاج', 'تغيير قائمة', 'انتهاء الوردية', 'خطأ في الصرف', 'أخرى']) {
            expect(legacy).toContain(`<option value="${r}">${r}</option>`);
        }
        // القديم يعرض حالات الإذن الثلاث، وV2 يختار approved فقط كما يثبت اختبار المستودع
        expect(legacy).toContain("const approvedDispatches = STATE.dispatches.filter(d=>['approved','partially_received','received'].includes(d.status));");
        expect(s).toContain('لا توجد طلبات صرف معتمدة — سيُسجَّل إرجاعًا مباشرًا من القسم إلى المخزن الرئيسي مع عكس مصروف القسم.');
        expect(legacy).toContain('لا توجد طلبات صرف قابلة للإرجاع — سيُسجَّل إرجاعًا مباشرًا من القسم إلى المخزن الرئيسي مع عكس مصروف القسم.');
        expect(s).toContain("panelData = { mode: 'dispatch', dispatches };");
        expect(s).toContain("panelData = { mode: 'direct', depts: directReturnDepartments(deptRows), inv };");
        expect(s).toContain('#${esc(String(d.id))} - ${esc(d.deptName)} - ${esc(d.date)}');
        expect(legacy).toContain('#${d.id} - ${esc(d.deptName)} - ${fD(d.date)}');
    });

    test('dept_head: كود واحد للقراءة وقائمة لأصحاب الأكواد المتعددة — الانحراف المعلن', () => {
        const s = src();
        const legacy = legacyOf();
        expect(s).toContain("role === 'dept_head' && myCodes.length > 1");
        expect(s).toContain('returnDeptCodesOf(deptCode)');
        // القديم كان يرسل الحقل الخام — والسابقة :704 هي الإصلاح المعتمد نفسه
        expect(legacy).toContain(`value="\${esc(myDeptCode()||'')}"`);
        expect(legacy).toContain("const rawCodes=String(myDeptCode()||'').split(',').map(s=>s.trim()).filter(Boolean);");
    });

    test('حراس القراءة والقرار: أحدث قراءة تفوز، لا رسم بعد الانفصال، قرار واحد في المرة', () => {
        const s = src();
        expect(s.match(/if \(loading\) \{return;\}/g)).toHaveLength(1);
        expect(s.match(/const seq = \+\+readSeq;/g)).toHaveLength(1);
        expect(s.match(/if \(!el\.isConnected \|\| seq !== readSeq\) \{return;\}/g)).toHaveLength(2);
        expect(s).toMatch(/const panelAlive = \(seq\) => el\.isConnected && seq === panelSeq;/);
        expect(s.match(/if \(!panelAlive\(seq\)\) \{return;\}/g)).toHaveLength(3);   // قراءتان + شبكة الفشل
        expect(s.match(/if \(busy\) \{notify\('جارٍ تنفيذ عملية — انتظر النتيجة'\); return;\}/g)).toHaveLength(4);
        expect(s.match(/^\s+busy = true;/gm)).toHaveLength(2);
        expect(s.match(/^\s+busy = false;/gm)).toHaveLength(2);
        expect(s.match(/panelSeq \+= 1;/g)).toHaveLength(2);   // closePanel + destroy
        expect(s).toMatch(/table\.destroy\(\);/);
        expect(s).toMatch(/el\.remove\(\);/);
        expect(s).toContain("if (!returnVoidVisible(role)) {notify('إبطال المرتجعات للمخزن والإدارة فقط'); return;}");
        expect(s).toContain("if (!reason.trim()) {panelMsg('أدخل سبب إبطال المرتجع'); return;}");
        expect(src().match(/window\.confirm\(/g) || []).toHaveLength(0);
    });

    test('بوابات openPanel بكلماتها — والبوابة قبل أي تغيير حالة', () => {
        const s = src();
        expect(s).toContain("if (!returnCreateVisible(role)) {notify('إنشاء المرتجعات للمطبخ والمخزن والإدارة فقط'); return;}");
        expect(s).toMatch(/template\(returnCreateVisible\(role\)\)/);
        const open = s.slice(s.indexOf('function openPanel'), s.indexOf('const seq = ++panelSeq;'));
        expect(open).not.toContain('panelKind =');
    });

    test('الأخطاء من ردّ الخادم كما ترد، وثلاث قراءات مسمّاة', () => {
        const s = src();
        expect(s).toContain('انتهت الجلسة — سجّل الدخول في النظام الحالي ثم أعد فتح الوضع الحيّ.');
        expect(s).toMatch(/e\.code === 'FORBIDDEN'/);
        expect(s).toContain('لا صلاحية لعرض المرتجعات بهذا الحساب — القرار للخادم وحده.');
        expect(s).toMatch(/تعذّر تحميل المرتجعات: \$\{\(e && e\.message\) \|\| 'خطأ'\}/);
        expect(s).toMatch(/panelMsg\(\(e && e\.message\) \|\| 'تعذر تنفيذ الإرجاع'\)/);
        expect(s).toMatch(/panelMsg\(\(e && e\.message\) \|\| 'تعذر إبطال المرتجع'\)/);
        expect(s).toMatch(/تعذر تجهيز اللوحة: \$\{\(e && e\.message\) \|\| 'خطأ في القراءة'\}/);
    });

    test('كل رمز data-i ساكن موجود في وحدة الرموز — الغائب يسقط للاستفهام صامتًا', () => {
        const s = src();
        const icons = source(ICONS);
        const names = new Set();
        for (const m of s.matchAll(/data-i="([a-z0-9-]+)"/g)) {names.add(m[1]);}
        for (const m of s.matchAll(/panel(?:Shell|Loading|Retry)\([^,]+,\s*'([a-z0-9-]+)'/g)) {names.add(m[1]);}
        expect(names.size).toBeGreaterThan(4);
        for (const n of names) {
            expect(icons).toContain(`'${n}':`);
            expect(n).not.toBe('circle-help');
        }
    });

    test('المراجعة الواحدة في كل مستورَد', () => {
        for (const line of src().split('\n').filter((l) => /from '\.\.\//.test(l))) {
            expect(line).toContain(`?v=${REV}`);
        }
        expect(source(REPO)).toContain(`core/api.js?v=${REV}`);
    });
});

describe('شاشة 20 — سلوك الإجماليات والإبطال عند بوابة apiFetch', () => {
    test('المبطل يبقى في الجدول والعدّ ولا يدخل القيمة النشطة', async () => {
        const mounted = returnsScreenStub([
            { id: 1, status: 'approved', totalValue: 100 },
            { id: 2, status: 'pending', totalValue: '50' },
            { id: 3, status: 'voided', totalValue: 900 },
            { id: 4, status: 'approved', voidedAt: '2026-11-24T10:00:00Z', totalValue: 800 },
        ]);
        await flushAsync();

        const rows = mounted.screen.getRows();
        expect(rows.map((row) => row.id)).toEqual([1, 2, 3, 4]);
        expect(rows.map((row) => row.voided)).toEqual([false, false, true, true]);
        expect(mounted.table.rows).toBe(rows);
        expect(mounted.countEl.textContent).toBe('(4)');
        expect(mounted.summaryEl.textContent).toBe('4 مرتجعًا · قيمة نشطة 150 SAR (أصل 8,000 الأحدث)');

        const actions = mounted.tableOptions.columns.find((column) => column.key === 'actions');
        expect(actions.header).toBe('إجراءات');
        expect(actions.render(rows[0])).toContain('<span>إبطال</span>');
        expect(actions.render(rows[2])).toContain('محفوظ');
        expect(actions.render(rows[2])).not.toContain('data-v2-act');
    });

    test('لوحة الإبطال تمنع الفراغ ثم ترسل POST بسببًا منظّفًا بلا confirm', async () => {
        const mounted = returnsScreenStub([{ id: 1, status: 'approved', totalValue: 10 }], 'warehouse');
        await flushAsync();
        mounted.listeners.click({ target: { closest: (selector) => selector === '[data-v2-act]'
            ? { getAttribute: () => '1' } : null } });
        expect(mounted.panelEl.innerHTML).toContain('إبطال المرتجع #1');
        expect(mounted.panelEl.innerHTML).toContain('data-v2-void-reason');
        expect(mounted.confirm).not.toHaveBeenCalled();

        const reason = { value: '   ' };
        const message = { textContent: '' };
        mounted.panelEl.querySelector = (selector) => selector === '[data-v2-void-reason]'
            ? reason : (selector === '[data-v2-panel-msg]' ? message : null);
        const submit = () => mounted.listeners.click({ target: { closest: (selector) => selector === '[data-v2-submit]' ? {} : null } });
        submit();
        await flushAsync();
        expect(message.textContent).toBe('أدخل سبب إبطال المرتجع');
        expect(mounted.gateway.requests.filter((request) => request.path.includes('/void'))).toHaveLength(0);

        reason.value = '  تصحيح موثّق  ';
        submit();
        await flushAsync();
        const writes = mounted.gateway.requests.filter((request) => request.path.includes('/void'));
        expect(writes).toHaveLength(1);
        expect(writes[0]).toMatchObject({ path: '/warehouse/returns/1/void', method: 'POST' });
        expect(JSON.parse(writes[0].body)).toEqual({ reason: 'تصحيح موثّق' });
        expect(writes[0].headers['X-Idempotency-Key']).toMatch(/^return-void:1:/);
        expect(mounted.panelEl.hidden).toBe(true);
        expect(mounted.notify).toHaveBeenCalledWith('تم إبطال المرتجع وعكس أثره مع حفظ السجل');
        expect(mounted.confirm).not.toHaveBeenCalled();
    });
});

describe('شاشة 20 — المضيف والطبقة', () => {
    test('المضيف يمرر deptCode الجديد مع الهوية — الركوب على مضيف السجلات المشترك', () => {
        const h = source(HOST);
        expect(h).toMatch(/renderLiveRegisterScreen\(\{ key: 'wh-returns', title: 'مرتجعات المطبخ', module: 'wh-returns', assign: \(s\) => \{ whReturnsScreen = s; \} \}\);/);
        expect(h).toMatch(/deptCode: String\(u\.dept_code \|\| ''\),/);
        expect(h).toMatch(/role: session\.role,/);
        expect(h).toMatch(/confirmFn: confirmAction,/);
        expect(h).toMatch(/notify: notifyTo\(note\),/);
    });

    test('المغادرة تُتلف الشاشة — لا شبح يكتب على DOM بعد التنقّل', () => {
        const h = source(HOST);
        expect(h).toMatch(/function teardownWhReturnsScreen\(\) \{[\s\S]{0,120}whReturnsScreen\.destroy\(\);[\s\S]{0,60}whReturnsScreen = null;/);
        expect(h).toMatch(/teardownWhReturnsScreen\(\);/);
        expect(h).toMatch(/key === 'wh-returns'/);
    });

    test('الشاشة تُستورد بمراجعة الصفحة نفسها', () => {
        const rev = source(V2_HTML).match(/js\/v2\/preview\.js\?v=([0-9.]+)/)[1];
        expect(source(path.join(V2, 'screens', 'registry.js'))).toContain(`./wh-returns.js?v=${rev}`);
        expect(source(V2_HTML)).toContain(`js/v2/preview.js?v=${rev}`);
        expect(source(V2_HTML)).toContain(`css/v2/erp-ops.css?v=${rev}`);
    });

    test('الطبقة: قواعد الأساس كلها رموز، وكلها بعد آخر وسيط', () => {
        const css = source(OPS_CSS);
        expect(css).toContain('.erp-v2-wh-returns .erp-card__head { flex-wrap: wrap; }');
        for (const sel of ['.erp-v2-wh-returns .erp-returns-panel {',
            '.erp-v2-wh-returns .erp-returns-panel__head {',
            '.erp-v2-wh-returns .erp-returns-panel__actions {',
            '.erp-v2-wh-returns .erp-returns-row {',
            '.erp-v2-wh-returns td.erp-v2-wh-returns-actions {']) {
            expect(css).toContain(sel);
        }
        // الأساس كله بعد آخر وسيط والوسائط لا تعود بعده
        const tail = css.slice(css.indexOf('.erp-v2-wh-returns .erp-card__head { flex-wrap: wrap; }'));
        expect(tail).not.toMatch(/@media/);
    });

    test('٦٤٠px: أزرار ٤٠ والأسماء تختفي والأدوات تنزل — في آخر كتلة وحدها', () => {
        const blocks = source(OPS_CSS).match(/@media \(max-width: 640px\)[\s\S]*?\n\}/g);
        expect(blocks).toHaveLength(2);   // كتلتان فقط — كتلة ثالثة تكسر ضوابط W1-1/W1-2
        const d = blocks[blocks.length - 1];
        // تسمية الزرّ تُخفى (display:none أو النمط البصري sr-only) ويبقى الرمز مقروءًا
        const labelRule = ruleBody(d, '.erp-v2-wh-returns .erp-card__head .erp-btn > span');
        expect(labelRule).not.toBe('');
        expect(hidesLabel(labelRule)).toBe(true);
        expect(d).toMatch(/min-block-size: var\(--erp-space-8\)/);
        expect(d).toContain('.erp-v2-wh-returns__tools { flex: 1 1 100%; }');
        expect(d).not.toMatch(/\.erp-v2-wh-returns [^,{]*\.erp-input\s*\{[^}]*min-block-size/);
    });

    test('الطباعة تخفي اللوحة وعمود الإجراءات — ولا تخفي أساس الأرقام', () => {
        const prints = source(OPS_CSS).match(/@media print\s*\{[\s\S]*?\n\}/g);
        expect(prints).toHaveLength(2);   // كتلتان فقط، والممتدة آخر كتلة عمدًا
        const p = prints[prints.length - 1];
        expect(p).toContain('.erp-v2-wh-returns [data-v2-panel] { display: none; }');
        expect(p).toContain('.erp-v2-wh-returns [data-col="actions"],');
        expect(p).toContain('.erp-v2-wh-returns td.erp-v2-wh-returns-actions { display: none; }');
        expect(p).not.toMatch(/summary|__tools|erp-card__head/);
    });

    test('لا ألوان ولا بكسلات خام في طبقة الموجة: كل قيمة رمزٌ من --erp-*', () => {
        const body = source(OPS_CSS)
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .replace(/@media[^{]+\{/g, '');   // شرط الوسيط مقبول، القيم ليست كذلك
        // استثناء واحد مبيّن: نمط الإخفاء البصري (sr-only) — مقاس 1px وسالب -1px
        const noSrOnly = withoutSrOnly(body);
        expect(noSrOnly).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
        expect(noSrOnly).not.toMatch(/rgba?\(/);
        expect(noSrOnly).not.toMatch(/\b\d+(px|rem|em)\b/);
        expect(body).toMatch(/var\(--erp-space-8\)/);
    });
});
