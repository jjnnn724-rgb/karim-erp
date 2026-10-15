/**
 * v2-dispatch.test.js — عقد شاشة 13 (أذون الصرف) في V2 — دورة القرار الكاملة W1-1
 * ═══════════════════════════════════════════════════════════════════════
 * نفس أسلوب tests/v2-kitchen.test.js وtests/v2-leaves.test.js: المستودع
 * يُحمَّل في vm وبوابته apiFetch مزيفة، والشاشة تُقرأ كعقد مصدر
 * (testEnvironment:'node') لأن المتصفح لا يُثبته النص.
 *
 * المثبَّت هنا:
 *   • الباب الواحد لشبكة الشاشة: js/v2/data/dispatch-repo.js — القائمة
 *     قراءةٌ فقط من السجل العام، والقرارات الثمانية تمشي من أبواب كتابة
 *     منسوخة من سطور الخادم (server.js:1544, warehouse-routes.js:621-1076)
 *   • ثوابت الأدوار مرايا سطرٍ بسطر: createRoles (server.js:1545)،
 *     WRITE_ROLES/CHEF_APPROVAL_ROLES (warehouse-routes.js:14-18)،
 *     canDecide + canReceive/canEdit (kitchen.js:291-353)
 *   • البوابات نقية ومختبَرة بالصف والصفوف الحدّية: معلّق+شيف، شيف_معتمد،
 *     حذف الأدمن من أي حالة وغيره من المعلّق حصرًا، استلام المعتمد فقط،
 *     تعديل قبل اعتماد المخازن، طباعة الحالات الموقّعة
 *   • كلمات المراحل منسوخة من core/i18n.js:98-100 حرفيًا، وكلمات الحالة
 *     الست في السجل المشترك من features/kitchen.js:141 + ورقة الطباعة :1247
 *   • حمولات القرار منسوخة من القديم حرفًا — بما فيها الشواذ المقصودة:
 *     estWeightKg عند إنشاء الوزن المتغير، وrequestedQty:actualWeight عند
 *     الاعتماد بالوزن الفعلي (kitchen.js:1158)، وreceive..PackagingQty للوزن
 *     المتغير وحده
 *   • التواقيع: لا قرار موقّع بلا اسم حساب (البوابة قبل فتح اللوحة)، وكل
 *     لوحة ترسم لوحتها بمعرّفها الثابت، والصور المخزنة (warehouse/
 *     kitchenReceipt SignatureData) لا تُرسم إلا على ورقة الطباعة
 *   • الطباعة: النافذة تُفتح في إيماءة النقر قبل الجلب، والورقة A4 منسوخة
 *     من printDispatchNote (kitchen.js:1233-1253) ببنتها الذهبية #c9a227
 *   • التكرار (409 DUPLICATE_DISPATCH) يُكشف بالرسالة لا بالكود لأن
 *     core/api.js:serverErrorInfo يقرأ data.error لا data.code
 *   • الشاشة: لا fetch/apiFetch، لا معالج سطري إلا زرا ورقة الطباعة، حارس
 *     أحدث قراءة (readSeq) + isConnected + busy قرار واحد + destroy() يُتلف
 *     الجدول ويحرّر اللوحات كلها
 *   • كل رمز data-i ساكن موجود في icons.js — الغائب يسقط صامتًا إلى
 *     circle-help (icons.js:169) فلا يُشحن رمزٌ لا وجود له
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const APP = path.join(__dirname, '..', 'frontend', 'app');
const V2 = path.join(APP, 'js', 'v2');
const REPO = path.join(V2, 'data', 'dispatch-repo.js');
const SCREEN = path.join(V2, 'screens', 'dispatch.js');
const SHARED_STATUS = path.join(V2, 'status.js');
const OPS_CSS = path.join(APP, 'css', 'v2', 'erp-ops.css');
const V2_HTML = path.join(APP, 'v2.html');
const HOST = path.join(V2, 'preview.js');
const ICONS = path.join(APP, 'js', 'icons.js');
const SERVER = path.join(__dirname, '..', 'backend', 'server.js');
const WR = path.join(__dirname, '..', 'backend', 'warehouse-routes.js');
const LEGACY = path.join(APP, 'js', 'features', 'kitchen.js');
const I18N = path.join(APP, 'js', 'core', 'i18n.js');
// REV مشتق من الوسم الحيّ في v2.html (نفس نمط v2-kitchen/leaves) — تثبيت
// يدوي هنا كسر مرّات عند رفع النسخة الموحّدة؛ الاشتقاق يجعل الاختبار معاييرًا.
const REV = (fs.readFileSync(V2_HTML, 'utf8').match(/js\/v2\/preview\.js\?v=([0-9.]+)/) || [])[1];

function loadEsm(file, injections = {}, collect = []) {
    const stripped = fs.readFileSync(file, 'utf8')
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

const EXPORTS = ['fetchDispatches', 'itemsSummary', 'dispatchToRow', 'summarizeDispatches',
    'CREATE_ROLES', 'CHEF_DECIDE_ROLES', 'WAREHOUSE_DECIDE_ROLES', 'RECEIVE_ROLES',
    'EDIT_ROLES', 'PRINT_STATUSES', 'CHAIN_STAGE_AR',
    'chainStage', 'deptCodesOf', 'rowDeptMatches',
    'chefActionsVisible', 'warehouseActionsVisible', 'deleteVisible', 'receiveVisible',
    'editVisible', 'printVisible',
    'fetchMainAvailability', 'fetchDispatchCatalog', 'catalogItem', 'arSearchKey', 'searchCatalog',
    'fetchDepartmentOptions', 'deptNameByCode', 'fetchDispatchSettings', 'fetchDispatchFull',
    'createDispatch', 'editDispatch', 'deleteDispatch',
    'chefApproveDispatch', 'chefRejectDispatch', 'approveDispatch', 'rejectDispatch', 'receiveDispatch'];

function repoStub(impl) {
    const calls = [];
    const bodies = [];
    const apiFetch = jest.fn(async (p, opts) => {
        calls.push(p);
        if (opts && opts.body) {bodies.push({ path: p, body: opts.body, method: opts.method });}
        return typeof impl === 'function' ? impl(p, opts) : impl;
    });
    const repo = loadEsm(REPO, { apiFetch }, EXPORTS);
    return { calls, bodies, repo };
}

const source = (f) => fs.readFileSync(f, 'utf8');

describe('dispatch-repo — الباب الواحد: قراءة من السجل وكتابات من الأبواب الثمانية', () => {
    test('كل ما تحتاجه الشاشة مُصدَّر', () => {
        const src = source(REPO);
        for (const name of EXPORTS) {
            expect(src).toMatch(new RegExp(`export (async function|function|const) ${name}\\b`));
        }
    });

    test('السجل يمشي صفحاته الخمس ويعترف بالمصفوفة العارية', async () => {
        const { calls, repo } = repoStub(() => ({
            data: Array.from({ length: 1000 }, (_, i) => ({ id: i })),
            pagination: { total: 6000, totalPages: 6 },
        }));
        const rows = await repo.fetchDispatches();
        expect(rows).toHaveLength(5000);
        expect(calls).toHaveLength(5);
        expect(calls[0]).toBe('/dispatches?page=1&limit=1000&sort=id&order=asc');
        const bare = repoStub([{ id: 1 }, { id: 2 }]);
        expect(await bare.repo.fetchDispatches()).toHaveLength(2);
        const short = repoStub({ data: [{ id: 1 }], pagination: { total: 1, totalPages: 1 } });
        expect(await short.repo.fetchDispatches()).toHaveLength(1);
        expect(short.calls).toHaveLength(1);
    });

    test('ثمانية أبواب كتابة بمسارات الخادم نفسها وحمولة JSON', async () => {
        const doors = [
            ['createDispatch', '/dispatches', 'POST'],
            ['editDispatch', '/warehouse/dispatches/9/edit', 'PUT'],
            ['deleteDispatch', '/dispatches/9', 'DELETE'],
            ['chefApproveDispatch', '/warehouse/dispatches/9/chef-approve', 'POST'],
            ['chefRejectDispatch', '/warehouse/dispatches/9/chef-reject', 'POST'],
            ['approveDispatch', '/warehouse/dispatches/9/approve', 'POST'],
            ['rejectDispatch', '/warehouse/dispatches/9/reject', 'POST'],
            ['receiveDispatch', '/warehouse/dispatches/9/receive', 'POST'],
        ];
        for (const [fn, door, method] of doors) {
            const { calls, bodies, repo } = repoStub({});
            const body = { probe: fn };
            // create يأخذ الحمولة وحدها، delete معرّفًا وحده، والبقية (معرّف، حمولة)
            await (fn === 'deleteDispatch' ? repo[fn](9)
                : fn === 'createDispatch' ? repo[fn](body)
                    : repo[fn](9, body));
            expect(calls).toEqual([door]);
            if (fn === 'deleteDispatch') {
                expect(bodies).toHaveLength(0);   // حذفٌ بلا حمولة — المعرّف في المسار وحده
            } else {
                expect(bodies[0].method).toBe(method);
                expect(JSON.parse(bodies[0].body)).toEqual(body);
            }
        }
    });

    test('المعرّف في المسار مُشفَّر — لا مسار يُبنى بمزاج المدخل', async () => {
        const { calls, repo } = repoStub({});
        await repo.editDispatch('7/8', {});
        await repo.deleteDispatch('7/8');
        await repo.receiveDispatch('7/8', {});
        expect(calls).toEqual([
            '/warehouse/dispatches/7%2F8/edit',
            '/dispatches/7%2F8',
            '/warehouse/dispatches/7%2F8/receive',
        ]);
    });

    test('التوابع الثانوية: أرصدة الرئيسي، الكتالوج، الأقسام، الإعدادات، الصف الكامل', async () => {
        const avail = repoStub({ items: [{ id: 5, on_hand: '3.5' }, { id: 6, on_hand: null }, { id: 7 }] });
        const m = await avail.repo.fetchMainAvailability();
        expect(avail.calls).toEqual(['/warehouse/main-availability']);
        expect(m.get(5)).toBe(3.5);
        expect(m.get(6)).toBe(0);
        expect(m.get(7)).toBe(0);
        expect(m.get(99)).toBeUndefined();

        const cat = repoStub({ data: [{ id: 1 }], pagination: { total: 1, totalPages: 1 } });
        await cat.repo.fetchDispatchCatalog();
        expect(cat.calls).toEqual(['/inventory?page=1&limit=1000&sort=id&order=asc']);

        const deps = repoStub({ data: [{ code: 'K1', name: 'المطبخ' }, { code: 'K2' }], pagination: { total: 2, totalPages: 1 } });
        expect(await deps.repo.fetchDepartmentOptions()).toEqual([
            { code: 'K1', name: 'المطبخ' }, { code: 'K2', name: 'K2' },
        ]);
        expect(deps.repo.deptNameByCode([{ code: 'K1', name: 'المطبخ' }], ' k1 ')).toBe('المطبخ');
        expect(deps.repo.deptNameByCode([], 'K1')).toBe('');

        const set = repoStub([{ name: 'مطاعم', currency: 'ج.م', logoB64: 'data:image/png;base64,x' }]);
        expect(await set.repo.fetchDispatchSettings())
            .toEqual({ name: 'مطاعم', currency: 'ج.م', logoB64: 'data:image/png;base64,x' });
        expect(set.calls).toEqual(['/settings/main_settings']);
        const one = repoStub({ name: 'مطاعم', currency: '' });
        expect((await one.repo.fetchDispatchSettings()).name).toBe('مطاعم');

        const full = repoStub({ data: { id: 9, items: [] } });
        expect(await full.repo.fetchDispatchFull('9/8')).toEqual({ id: 9, items: [] });
        expect(full.calls).toEqual(['/dispatches/9%2F8']);
        const none = repoStub({ error: 'x' });
        expect(await none.repo.fetchDispatchFull(9)).toBeNull();
    });
});

describe('dispatch-repo — كلمات المراحل والثوابت منسوخة من أسطرها', () => {
    test('كلمات المراحل من i18n الصفحة القديمة حرفيًا', () => {
        const { repo } = repoStub({});
        const i18n = source(I18N);
        const pairs = {
            chefWait: 'stg.chefWait', whWait: 'stg.whWait', chefDone: 'stg.chefDone',
            dispensed: 'stg.dispensed', partial: 'stg.partial', received: 'stg.received', rejected: 'stg.rejected',
        };
        for (const [k, key] of Object.entries(pairs)) {
            expect(repo.CHAIN_STAGE_AR[k]).toBeTruthy();
            expect(i18n).toContain(`'${key}': '${repo.CHAIN_STAGE_AR[k]}'`);
        }
    });

    test('مرحلة السلسلة: ستة تخزينات + فصل «معلّق» بشرط الشيف، والمجهول فراغ', () => {
        const { repo } = repoStub({});
        const C = repo.CHAIN_STAGE_AR;
        expect(repo.chainStage({ status: 'pending', needsChefApproval: true })).toBe(C.chefWait);
        expect(repo.chainStage({ status: 'pending' })).toBe(C.whWait);
        expect(repo.chainStage({ status: 'chef_approved' })).toBe(C.chefDone);
        expect(repo.chainStage({ status: 'approved' })).toBe(C.dispensed);
        expect(repo.chainStage({ status: 'partially_received' })).toBe(C.partial);
        expect(repo.chainStage({ status: 'received' })).toBe(C.received);
        expect(repo.chainStage({ status: 'rejected' })).toBe(C.rejected);
        expect(repo.chainStage({ status: 'ghost' })).toBe('');
        expect(repo.chainStage({})).toBe('');
    });

    test('ثوابت الأدوار مرايا سطور الخادم والقديم حرفيًا', () => {
        const { repo } = repoStub({});
        const list = (a) => `[${a.map((r) => `'${r}'`).join(', ')}]`;
        const server = source(SERVER);
        expect(server).toContain(`entity === 'dispatches' ? ${list(repo.CREATE_ROLES)} : entity === 'payroll'`);
        const wr = source(WR);
        expect(wr).toContain(`const WRITE_ROLES = ${list(repo.WAREHOUSE_DECIDE_ROLES)};`);
        expect(wr).toContain(`const CHEF_APPROVAL_ROLES = ${list(repo.CHEF_DECIDE_ROLES)};`);
        // الاستلام عند الخادم أوسع (يضم warehouse) — مرآة الشاشة من القديم عمدًا
        expect(wr).toContain(`const RECEIVE_ROLES = ${list(['admin', 'manager', 'warehouse', 'kitchen', 'sous_chef', 'dept_head'])};`);
        for (const r of repo.RECEIVE_ROLES) {
            expect(['admin', 'manager', 'warehouse', 'kitchen', 'sous_chef', 'dept_head']).toContain(r);
        }
        const kitchen = source(LEGACY);
        expect(kitchen).toContain("if(['kitchen','sous_chef','admin','manager'].includes(role)){return true;}");
        expect([...repo.EDIT_ROLES].sort()).toEqual(['admin', 'kitchen', 'manager', 'sous_chef']);
        expect([...repo.PRINT_STATUSES].sort()).toEqual(['approved', 'partially_received', 'received']);
        expect(kitchen).toContain("['approved','partially_received','received']");
    });
});

describe('dispatch-repo — البوابات مرايا أسطر القديم، والصف يظهر أو لا يظهر', () => {
    test('أزرار الشيف: معلّق + يحتاج اعتماد الشيف + دور من الأربعة', () => {
        const { repo } = repoStub({});
        const row = { status: 'pending', needsChefApproval: true };
        for (const r of repo.CHEF_DECIDE_ROLES) {expect(repo.chefActionsVisible(r, row)).toBe(true);}
        expect(repo.chefActionsVisible('warehouse', row)).toBe(false);
        expect(repo.chefActionsVisible('admin', { status: 'pending', needsChefApproval: false })).toBe(false);
        expect(repo.chefActionsVisible('admin', { status: 'chef_approved', needsChefApproval: true })).toBe(false);
    });

    test('أزرار المخازن: معلّقٌ بلا شيف أو معتمد الشيف + دور من الثلاثة', () => {
        const { repo } = repoStub({});
        for (const r of repo.WAREHOUSE_DECIDE_ROLES) {
            expect(repo.warehouseActionsVisible(r, { status: 'pending' })).toBe(true);
            expect(repo.warehouseActionsVisible(r, { status: 'chef_approved' })).toBe(true);
        }
        expect(repo.warehouseActionsVisible('admin', { status: 'pending', needsChefApproval: true })).toBe(false);
        expect(repo.warehouseActionsVisible('kitchen', { status: 'chef_approved' })).toBe(false);
    });

    test('الحذف: أدمن من أي حالة، وغيره معلّق المخازن حصرًا', () => {
        const { repo } = repoStub({});
        expect(repo.deleteVisible('admin', { status: 'received' })).toBe(true);
        expect(repo.deleteVisible('admin', { status: 'pending' })).toBe(true);
        expect(repo.deleteVisible('warehouse', { status: 'pending' })).toBe(true);
        expect(repo.deleteVisible('manager', { status: 'pending' })).toBe(true);
        expect(repo.deleteVisible('warehouse', { status: 'approved' })).toBe(false);
        expect(repo.deleteVisible('kitchen', { status: 'pending' })).toBe(false);
    });

    test('الاستلام: المعتمد فقط؛ والدور أو رئيس القسم صاحب الإذن بأكواد قسمه', () => {
        const { repo } = repoStub({});
        const row = { status: 'approved', deptCode: 'K1' };
        for (const r of repo.RECEIVE_ROLES) {expect(repo.receiveVisible(r, row)).toBe(true);}
        expect(repo.receiveVisible('warehouse', row)).toBe(false);
        expect(repo.receiveVisible('dept_head', row, { deptCode: 'K1, K2' })).toBe(true);
        expect(repo.receiveVisible('dept_head', row, { deptCode: 'k3' })).toBe(false);
        expect(repo.receiveVisible('dept_head', row, { deptCode: '' })).toBe(false);
        expect(repo.receiveVisible('admin', { status: 'pending', deptCode: 'K1' })).toBe(false);
    });

    test('التعديل: معلّق/معتمد الشيف + الدور أو قسم رئيس القسم أو صاحب الإنشاء', () => {
        const { repo } = repoStub({});
        for (const r of repo.EDIT_ROLES) {expect(repo.editVisible(r, { status: 'pending' })).toBe(true);}
        expect(repo.editVisible('admin', { status: 'approved' })).toBe(false);
        expect(repo.editVisible('admin', { status: 'received' })).toBe(false);
        expect(repo.editVisible('admin', { status: 'chef_approved' })).toBe(true);
        expect(repo.editVisible('dept_head', { status: 'pending', deptCode: 'K1' }, { deptCode: 'K1' })).toBe(true);
        expect(repo.editVisible('dept_head', { status: 'pending', deptCode: 'K1' }, { deptCode: 'K2' })).toBe(false);
        // صاحب الإنشاء يعدّل ولو لم يطابق قسمه (creatorUserId — kitchen.js:352)
        const mine = { status: 'pending', deptCode: 'K9', creatorUserId: 42 };
        expect(repo.editVisible('dept_head', mine, { deptCode: 'K1', userId: 42 })).toBe(true);
        expect(repo.editVisible('dept_head', mine, { deptCode: 'K1', userId: 7 })).toBe(false);
        expect(repo.editVisible('dept_head', { status: 'pending' }, { userId: null })).toBe(false);
    });

    test('الطباعة على الحالات الموقّعة/المصروفة فقط — شرط زر printDispatchNote', () => {
        const { repo } = repoStub({});
        for (const st of repo.PRINT_STATUSES) {expect(repo.printVisible({ status: st })).toBe(true);}
        for (const st of ['pending', 'chef_approved', 'rejected', '']) {
            expect(repo.printVisible({ status: st })).toBe(false);
        }
    });

    test('أكواد قسم صاحب الحساب: قائمة مفصولة بفواصل بلا حسّاسية حالة', () => {
        const { repo } = repoStub({});
        expect(repo.deptCodesOf({ deptCode: 'K1, k2 ,K3' })).toEqual(['k1', 'k2', 'k3']);
        expect(repo.deptCodesOf({})).toEqual([]);
        expect(repo.rowDeptMatches({ deptCode: 'k1,k2' }, { deptCode: ' K2 ' })).toBe(true);
        expect(repo.rowDeptMatches({ deptCode: '' }, { deptCode: 'k2' })).toBe(false);
    });
});

describe('dispatch-repo — الكتالوج والرصيد والبحث: لا قيمة بلا أساس', () => {
    test('صنف الكتالوج: الوحدات الثانوية السارية فقط، والافتراضات معلنة', () => {
        const { repo } = repoStub({});
        const it = repo.catalogItem({
            id: 5, name: 'أرز', unit: 'كجم', barcode: '90', catch_weight_enabled: true,
            packaging_uom: 'شوال', packaging_qty_per_base: '25', avgCost: '10.5', catch_weight_uom: 'kg',
            secondary_units: [{ uom: 'كيس', factor: 5 }, { uom: 'x', factor: 0 }, null, { uom: '', factor: 2 }, { uom: 'كرتونة', factor: '12' }],
        });
        expect(it).toEqual({
            id: 5, name: 'أرز', unit: 'كجم', barcode: '90', catchWeight: true,
            packagingUom: 'شوال', avgBoxPerCrate: 25, avgCost: 10.5, catchWeightUom: 'kg',
            secondaryUnits: [{ uom: 'كيس', factor: 5 }, { uom: 'كرتونة', factor: 12 }],
        });
        expect(repo.catalogItem({})).toEqual({
            id: undefined, name: '', unit: 'قطعة', barcode: '', catchWeight: false,
            packagingUom: 'كرتون', avgBoxPerCrate: 0, avgCost: 0, catchWeightUom: 'kg', secondaryUnits: [],
        });
    });

    test('المفتاح المطبَّع يعبر الهمزات والتاء المربوطة والفروق الشائعة', () => {
        const { repo } = repoStub({});
        expect(repo.arSearchKey('أرز')).toBe(repo.arSearchKey('ارز'));
        expect(repo.arSearchKey('لحمة')).toBe(repo.arSearchKey('لحمه'));
        expect(repo.arSearchKey('باذنجان')).toBe(repo.arSearchKey('بازنجان'));
        expect(repo.arSearchKey('  طمــاطم ')).toBe(repo.arSearchKey('طماطم'));
    });

    test('بحث الكتالوج: صفر الرصيد محجوب، الحرفي ثم المطبَّع، والسقف ثلاثون', () => {
        const { repo } = repoStub({});
        const catalog = [
            { id: 1, name: 'باذنجان', barcode: '', unit: 'كجم' },
            { id: 2, name: 'أرز', barcode: '900123', unit: 'كجم' },
            { id: 3, name: 'بطاطس', barcode: '', unit: 'كجم' },
        ];
        const avail = (i) => (i.id === 3 ? 0 : 5);
        expect(repo.searchCatalog(catalog, '', avail).map((i) => i.id)).toEqual([1, 2]);
        expect(repo.searchCatalog(catalog, 'بازنجان', avail).map((i) => i.id)).toEqual([1]);
        expect(repo.searchCatalog(catalog, 'أرز', avail).map((i) => i.id)).toEqual([2]);
        expect(repo.searchCatalog(catalog, '900123', avail).map((i) => i.id)).toEqual([2]);
        const many = Array.from({ length: 40 }, (_, i) => ({ id: 100 + i, name: `صنف ${i}` }));
        expect(repo.searchCatalog(many, 'صنف', () => 1)).toHaveLength(30);
    });
});

describe('dispatch-repo — صف الجدول والملخص', () => {
    test('صف الجدول: القسم باسمه أو كوده، والأصناف سطر واحد لا JSON', () => {
        const { repo } = repoStub({});
        const r = repo.dispatchToRow({
            id: 7, deptCode: 'K1', deptName: null,
            items: [{ itemName: 'أرز', qty: 2 }, { itemName: 'سكر', approvedQty: 3 }, { itemName: 'شاي', qty: 1 }],
            status: 'pending', date: '2026-10-15T00:00:00Z', createdBy: 'كريم',
        });
        expect(r).toMatchObject({
            id: 7, dept: 'K1', deptResolved: false, status: 'pending',
            date: '2026-10-15', by: 'كريم', itemsCount: 3,
        });
        expect(r.itemsText).toBe('أرز (2)، سكر (3)، +1');
        const named = repo.dispatchToRow({ id: 8, deptName: 'المطبخ' });
        expect(named.dept).toBe('المطبخ');
        expect(named.deptResolved).toBe(true);
        expect(repo.dispatchToRow({ id: 9 }).dept).toBe('—');
        expect(repo.itemsSummary(null)).toBe('');
        expect(repo.itemsSummary([])).toBe('');
    });

    test('عدّ الحالات مشتق من الصفوف لا من طلب ثانٍ', () => {
        const { repo } = repoStub({});
        expect(repo.summarizeDispatches([
            { status: 'pending' }, { status: 'pending' }, { status: 'approved' }, { status: '' },
        ])).toEqual({ pending: 2, approved: 1, '': 1 });
    });
});

describe('شاشة 13 — العقد المصدَّر من المصدر', () => {
    const src = () => source(SCREEN);

    test('لا شبكة من الشاشة: الباب الواحد فقط، ولا fetch ولا apiFetch', () => {
        const s = src().replace(/\/\*[\s\S]*?\*\//g, '');
        expect(s).not.toMatch(/\bapiFetch\b/);
        expect(s).not.toMatch(/\bfetch\(/);
        expect(s).toMatch(/from '\.\.\/data\/dispatch-repo\.js\?v=/);
        expect(s).not.toMatch(/['"`]\/dispatches/);
        expect(s).not.toMatch(/['"`]\/warehouse\/dispatches/);
    });

    test('لا معالج سطري إلا زرا ورقة الطباعة — المنسوخان من القديم', () => {
        const s = src();
        const handlers = s.match(/\son[a-z]+=/g) || [];
        expect(handlers).toHaveLength(2);
        expect(s).toContain('onclick="window.print()"');
        expect(s).toContain('onclick="window.close()"');
        expect(s).not.toMatch(/window\.(prompt|alert)\(/);
        const note = s.slice(s.indexOf('async function printNote'), s.indexOf('/* ── القراءة والرسم'));
        expect(note).toContain('onclick="window.print()"');
        expect(note).toContain('onclick="window.close()"');
    });

    test('الكتابات الثماني من أبوابها: كل اسم باب مستدعى في الشاشة', () => {
        const s = src();
        for (const fn of ['createDispatch', 'editDispatch', 'deleteDispatch', 'chefApproveDispatch',
            'chefRejectDispatch', 'approveDispatch', 'rejectDispatch', 'receiveDispatch']) {
            expect(s).toMatch(new RegExp(`\\b${fn}\\(`));
        }
    });

    test('حمولات القرار منسوخة من القديم حرفًا — بما فيها الشواذ المقصودة', () => {
        const s = src();
        expect(s).toContain("await createDispatch({ deptCode, deptName, items, notes, status: 'pending', date: isoDay(0) });");
        expect(s).toContain('await editDispatch(raw.id, { items, deptCode, reason });');
        expect(s).toContain('await chefApproveDispatch(raw.id, { notes, signatureData: sig, signerName });');
        expect(s).toContain('await chefRejectDispatch(raw.id, { reason, signatureData: sig, signerName });');
        expect(s).toContain('await approveDispatch(raw.id, { approvedItems, approveNotes, signatureData: sig, signerName });');
        expect(s).toContain('await rejectDispatch(raw.id, { reason, signatureData: sig, signerName });');
        expect(s).toContain('await receiveDispatch(raw.id, { items: receivedItems, notes, signatureData: sig, signerName });');
        expect(s).toContain('await deleteDispatch(raw.id);');
        // صنف الإنشاء بالوزن المتغير: estWeightKg مفتاح القديم
        expect(s).toContain('estWeightKg: estKg || null');
        // الوحدة الثانوية تحفظ ما طلبه القسم فعليًا
        expect(s).toMatch(/requestedQty: qty, requestedUom: opt\.value/);
        // شذوذ الاعتماد بالوزن الفعلي: requestedQty = actualWeight (مقصود)
        expect(s).toMatch(/requestedQty: actualWeight,/);
        expect(s).toContain('نفس شذوذ القديم المقصود');
        // الاستلام: كمية + كراتين للوزن المتغير فقط، وملاحظة السطر ''
        expect(s).toMatch(/receivedQty: received,/);
        expect(s).toMatch(/\.\.\.\(isCw \? \{ receivedPackagingQty: recvPkg \} : \{\}\),/);
    });

    test('لا قرار موقّع بلا اسم حساب: البوابة قبل فتح اللوحة، والصور لا تُرسم إلا على الورق', () => {
        const s = src();
        expect(s).toMatch(/SIGN_KINDS = new Set\(\['chef-approve', 'chef-reject', 'approve', 'reject', 'receive'\]\)/);
        expect(s).toMatch(/if \(SIGN_KINDS\.has\(kind\) && !signerName\)/);
        expect(s).toContain('اسم حسابك غير متاح في الجلسة — أعد تسجيل الدخول لتنفيذ قرار موقّع');
        expect(s).toMatch(/readSignaturePad\(panelEl, id, signerName\)/);
        for (const id of ['v2dsp-chef-approve-sig', 'v2dsp-chef-reject-sig', 'v2dsp-approve-sig', 'v2dsp-reject-sig', 'v2dsp-receive-sig']) {
            expect(s).toContain(id);
        }
        // الصور المخزنة (blobs) لا تُرسم إلا داخل ورقة الطباعة
        const printStart = s.indexOf('async function printNote');
        const printEnd = s.indexOf('/* ── القراءة والرسم');
        const outside = s.slice(0, printStart) + s.slice(printEnd);
        for (const blob of ['warehouseApprovalSignatureData', 'kitchenReceiptSignatureData', 'requestSignatureData', 'chefApprovalSignatureData', 'lastEventHash']) {
            expect(outside).not.toContain(blob);
        }
        expect(s.slice(printStart, printEnd)).toContain('warehouseApprovalSignatureData');
        expect(s.slice(printStart, printEnd)).toContain('kitchenReceiptSignatureData');
    });

    test('الرفض بلا سبب مكتوب لا يخرج — قبل قراءة التوقيع', () => {
        const s = src();
        const chef = s.slice(s.indexOf('async function submitChefReject'), s.indexOf('async function submitApprove'));
        expect(chef.indexOf('أدخل سبب الرفض')).toBeGreaterThan(-1);
        expect(chef.indexOf('أدخل سبب الرفض')).toBeLessThan(chef.indexOf('readSig(SIG_IDS.chefReject)'));
        const wh = s.slice(s.indexOf('async function submitReject'), s.indexOf('async function submitReceive'));
        expect(wh.indexOf('أدخل سبب الرفض')).toBeGreaterThan(-1);
        expect(wh.indexOf('أدخل سبب الرفض')).toBeLessThan(wh.indexOf('readSig(SIG_IDS.reject)'));
    });

    test('بوابة الرصيد قبل الاعتماد: لا كمية أكبر من المتوفر ولا وزن بلا ميزان', () => {
        const s = src();
        expect(s).toMatch(/if \(!\(actualWeight > 0\)\)/);
        expect(s).toMatch(/if \(actualWeight > onHand\) \{failMsg = `الوزن الفعلي من/);
        expect(s).toMatch(/if \(approvedQty > onHand\) \{failMsg = `الكمية المعتمدة من/);
        // والواجهة تحجب زر الاعتماد عند عجز الرصيد قبل أن يرفضه الخادم
        expect(s).toContain(`<span class="erp-badge" data-tone="danger">يوجد أصناف بلا رصيد كافٍ</span>' : '', blocked)`);
        expect(s).toContain("data-v2-submit${submitDisabled ? ' disabled' : ''}");
        // ولا يُضاف صنف صفري الرصيد للإنشاء أصلًا
        expect(s).toContain('لا يوجد أي رصيد من');
        expect(s).toContain('الرصيد غير كافٍ من');
    });

    test('التكرار يُكشف بالرسالة لا بالكود — لأن core/api يقرأ data.error', () => {
        const s = src();
        expect(s).toMatch(/e\.code === 'DUPLICATE_DISPATCH'\) \|\| \/مكرر\|مشابه\|DUPLICATE\/\.test\(m\)/);
        expect(s).toContain('الطلب مسجل بالفعل — لم يتكرر');
    });

    test('حراس القراءة والقرار: أحدث قراءة تفوز، لا رسم بعد الانفصال، قرار واحد في المرة', () => {
        const s = src();
        expect(s).toMatch(/if \(loading\) \{return;\}/);
        expect(s).toMatch(/const seq = \+\+readSeq;/);
        expect(s.match(/if \(!el\.isConnected \|\| seq !== readSeq\) \{return;\}/g)).toHaveLength(2);
        expect(s).toMatch(/const panelAlive = \(seq\) => el\.isConnected && seq === panelSeq;/);
        expect(s.match(/if \(busy\) \{notify\('جارٍ تنفيذ عملية — انتظر النتيجة'\); return;\}/g)).toHaveLength(5);
        expect(s.match(/^\s+busy = true;/gm)).toHaveLength(8);
        expect(s.match(/^\s+busy = false;/gm)).toHaveLength(8);
        expect(s.match(/disposeSignaturePads\(ALL_SIG_IDS\);/g)).toHaveLength(2);
        expect(s).toMatch(/table\.destroy\(\);/);
        expect(s).toMatch(/el\.remove\(\);/);
    });

    test('الأخطاء من ردّ الخادم كما ترد، وثلاث قراءات مسمّاة', () => {
        const s = src();
        expect(s).toContain("'انتهت الجلسة — سجّل الدخول في النظام الحالي ثم أعد فتح الوضع الحيّ.'");
        expect(s).toMatch(/e\.code === 'FORBIDDEN'/);
        expect(s).toContain('لا صلاحية لعرض أذون الصرف بهذا الحساب — القرار للخادم وحده.');
        expect(s).toMatch(/تعذّر تحميل الأذون: \$\{\(e && e\.message\) \|\| 'خطأ'\}/);
        expect(s).toMatch(/panelMsg\(\(e && e\.message\) \|\| 'تعذر اعتماد الطلب'\)/);
        // واعتماد مزدوج متزامن: الخادم يمنعه ورسالته تُطبع بدل إعادة الضغط
        expect(s).toMatch(/e\.code === 'DISPATCH_APPROVE_IN_PROGRESS'/);
        expect(s).toContain('الإذن قيد الاعتماد فعلًا — لا تضغط مجددًا');
    });

    test('الطباعة: النافذة تُفتح في إيماءة النقر قبل الجلب، والورقة ورقة القديم', () => {
        const s = src();
        const note = s.slice(s.indexOf('async function printNote'), s.indexOf('/* ── القراءة والرسم'));
        expect(note.indexOf("window.open('', '_blank')")).toBeGreaterThan(-1);
        expect(note.indexOf("window.open('', '_blank')")).toBeLessThan(note.indexOf('fetchDispatchFull'));
        expect(note).toContain('جارٍ تجهيز إذن الصرف…');
        expect(note).toContain('إذن صرف مخزن');
        expect(note).toContain('#c9a227');
        expect(note).toContain('توقيع المستلم');
        expect(note).toContain('print-color-adjust');
        expect(note).toMatch(/chef_approved: 'معتمد من الشيف — بانتظار المخازن'/);
        expect(note).toMatch(/approved: 'معتمد من المخازن'/);
        // الصف الكامل يُجلب مرة واحدة في الملف كله — داخل الطباعة وحدها
        expect(s.match(/fetchDispatchFull\(/g)).toHaveLength(1);
    });

    test('الأزرار صفٌ بصف من البوابات — لا شرط مخترع في الشاشة', () => {
        const s = src();
        const actions = s.slice(s.indexOf('function rowActionsHtml'), s.indexOf('/* ── اللوحة'));
        for (const gate of ['printVisible(raw)', 'editVisible(role, raw, user)', 'chefActionsVisible(role, raw)',
            'warehouseActionsVisible(role, raw)', 'receiveVisible(role, raw, user)', 'deleteVisible(role, raw)']) {
            expect(actions).toContain(gate);
        }
    });

    test('الحذف: تأكيد يسمّي الحالة، ويُصعِّد للمعتمد عند الأدمن، ويصعد برسالة الخادم عند الفشل', () => {
        const s = src();
        expect(s).toMatch(/const ok = await confirmFn\(msg\);/);
        expect(s).toContain('⚠️ حذف نهائي لإذن صرف');
        expect(s).toContain('حذف طلب الصرف المعلق نهائيًا؟');
        expect(s).toMatch(/const strong = role === 'admin' && String\(raw\.status\) !== 'pending';/);
        expect(s).toMatch(/notify\(\(e && e\.message\) \|\| 'تعذر حذف الإذن'\)/);
    });

    test('رسائل النجاح تحكي ما وقع فعلًا — والمبلغ من ردّ الخادم لا محسوبًا هنا', () => {
        const s = src();
        expect(s).toContain('تم اعتماد الطلب وإحالته للمخازن');
        expect(s).toContain('تم رفض الطلب وسيظهر لرئيس القسم');
        expect(s).toContain('تم تسجيل استلام المطبخ بالتوقيع');
        expect(s).toMatch(/\$\{moneyPlain\(result && result\.totalValue \|\| 0\)\}/);
        expect(s).toMatch(/res && res\.chefApprovalReset/);
        expect(s).toContain('تم التعديل — أُلغي اعتماد الشيف وأُعيد الطلب للمراجعة');
    });

    test('ملخّص الحالات يُنطق من السجل المشترك، والحالة غير المسجلة تُعرض خامًا', () => {
        const s = src();
        expect(s).toMatch(/const s = resolveStatus\('dispatch', k\);/);
        expect(s).toMatch(/let label = k \|\| 'بلا حالة';/);
        expect(s).toMatch(/statusBadge\('dispatch', row\.status\)/);
        expect(s).toMatch(/const stage = chainStage\(row\._raw \|\| \{\}\);/);
    });

    test('كل رمز data-i ساكن موجود في وحدة الرموز — الغائب يسقط للاستفهام صامتًا', () => {
        const s = src();
        const icons = source(ICONS);
        const tones = ['danger', 'success', 'info', 'warning', 'brand'];
        const names = new Set();
        for (const m of s.matchAll(/data-i="([a-z0-9-]+)"/g)) {names.add(m[1]);}
        for (const m of s.matchAll(/\bbtn\('[a-z-]+',\s*[^,]+,\s*'([a-z0-9-]+)'/g)) {names.add(m[1]);}
        for (const m of s.matchAll(/panel(?:Shell|Loading|Retry)\([^,]+,\s*'([a-z0-9-]+)'/g)) {names.add(m[1]);}
        for (const m of s.matchAll(/\?\s*'([a-z0-9-]+)'\s*:\s*'([a-z0-9-]+)'/g)) {
            if (!tones.includes(m[1])) {names.add(m[1]);}
            if (!tones.includes(m[2])) {names.add(m[2]);}
        }
        expect(names.size).toBeGreaterThan(12);
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

describe('شاشة 13 — السجل المشترك والمضيف والطبقة', () => {
    test('كلمات الحالة الست من مصادرها الحرفية — والأيقونات كلها موجودة فعلًا', () => {
        const st = source(SHARED_STATUS);
        const legacy = source(LEGACY);
        for (const [key, label] of [
            ['pending', 'بانتظار اعتماد المخزن'],
            ['approved', 'معتمد — بانتظار استلام المطبخ'],
            ['partially_received', 'مستلم جزئيًا'],
            ['received', 'مستلم ومغلق'],
            ['rejected', 'مرفوض من الإدارة'],
        ]) {
            expect(legacy).toContain(`${key}:'${label}'`);
            expect(st).toMatch(new RegExp(`'dispatch:${key}':\\s*\\{ label: '${label}'`));
        }
        // chef_approved لم تسمّها خريطة السجل القديم — كلمتها من ورقة الطباعة
        expect(legacy).toContain("chef_approved:'معتمد من الشيف — بانتظار المخازن'");
        expect(st).toMatch(/'dispatch:chef_approved':\s*\{ label: 'معتمد من الشيف — بانتظار المخازن'/);
        // الحالات الست التي تعرضها الشاشة كلها مسجلة
        for (const k of ['pending', 'chef_approved', 'approved', 'partially_received', 'received', 'rejected']) {
            expect(st).toContain(`'dispatch:${k}':`);
        }
        // وكل أيقونة dispatch:* موجودة في وحدة الرموز
        const icons = source(ICONS);
        const stIcons = [...st.matchAll(/'dispatch:[a-z_]+':\s*\{ label: '[^']*',\s*tone: '[a-z]+',\s*icon: '([a-z0-9-]+)'/g)];
        expect(stIcons).toHaveLength(6);
        for (const m of stIcons) {expect(icons).toContain(`'${m[1]}':`);}
    });

    test('المضيف يمرر الهوية كاملة ويطبع الإشعارات على سطره', () => {
        const h = source(HOST);
        expect(h).toMatch(/import \{ mountDispatchScreen \} from '\.\/screens\/dispatch\.js\?v=/);
        expect(h).toMatch(/dispatchScreen = mountDispatchScreen\(/);
        expect(h).toMatch(/role: session\.role,/);
        expect(h).toMatch(/userId: u\.id != null \? u\.id : \(u\.sub != null \? Number\(u\.sub\) : null\),/);
        expect(h).toMatch(/userName: String\(u\.name \|\| u\.username \|\| ''\),/);
        expect(h).toMatch(/deptCode: String\(u\.dept_code \|\| ''\),/);
        expect(h).toMatch(/notify: notifyTo\(note\),/);
        expect(h).toMatch(/confirmFn: \(message\) => window\.confirm\(message\),/);
    });

    test('المغادرة تُتلف الشاشة — لا شبح يكتب على DOM بعد التنقّل', () => {
        const h = source(HOST);
        expect(h).toMatch(/dispatchScreen\.destroy\(\);/);
        expect(h).toMatch(/dispatchScreen = null;/);
        expect(h).toMatch(/navStatus\.current !== 'dispatch'/);
    });

    test('الشاشة تُستورد بمراجعة الصفحة نفسها وتُركّب على مضيفها', () => {
        const rev = source(V2_HTML).match(/js\/v2\/preview\.js\?v=([0-9.]+)/)[1];
        expect(source(HOST)).toContain(`./screens/dispatch.js?v=${rev}`);
        expect(source(HOST)).toContain('data-v2-dispatch-host');
        expect(source(V2_HTML)).toContain(`js/v2/preview.js?v=${rev}`);
    });

    test('الطبقة محصورة باسم الشاشة وتشمل حارس hidden لصندوق الأدوات', () => {
        const css = source(OPS_CSS);
        expect(css).toMatch(/\.erp-v2-dispatch \.erp-card__head \{ flex-wrap: wrap; \}/);
        expect(css).toMatch(/\.erp-v2-dispatch \[data-v2-clear\]\[hidden\] \{ display: none; \}/);
        // التعاقد: قاعدة الإخفاء بعد إعلان الشاشة وخارج أي وسيط
        const head = css.indexOf('.erp-v2-dispatch .erp-card__head { flex-wrap: wrap; }');
        const hide = css.indexOf('.erp-v2-dispatch [data-v2-clear][hidden]');
        expect(hide).toBeGreaterThan(head);
        expect(css.slice(head, hide)).not.toMatch(/@media/);
    });

    test('الطباعة تخفي اللوحة وعمود الإجراءات — ولا تخفي أساس الأرقام', () => {
        const prints = source(OPS_CSS).match(/@media print\s*\{[\s\S]*?\n\}/g);
        const dprint = prints[prints.length - 1];
        expect(dprint).toContain('.erp-v2-dispatch [data-v2-panel] { display: none; }');
        expect(dprint).toContain('.erp-v2-dispatch [data-col="actions"],');
        expect(dprint).toContain('.erp-v2-dispatch td.erp-v2-dispatch-actions { display: none; }');
        expect(dprint).not.toMatch(/summary|__tools|erp-card__head/);
    });

    test('٦٤٠px: الأزرار ٤٠ والأسماء تختفي، والحقول لا تُرفع', () => {
        const blocks = source(OPS_CSS).match(/@media \(max-width: 640px\)\s*\{[\s\S]*?\n\}/g);
        const d = blocks[blocks.length - 1];
        expect(d).toContain('.erp-v2-dispatch .erp-card__head .erp-btn > span { display: none; }');
        expect(d).toMatch(/min-block-size: var\(--erp-space-8\)/);
        expect(d).toContain('.erp-v2-dispatch__tools { flex: 1 1 100%; }');
        expect(d).not.toMatch(/\.erp-v2-dispatch \.erp-input\s*\{[^}]*min-block-size/);
    });
});
