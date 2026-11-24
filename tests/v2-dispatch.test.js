/**
 * v2-dispatch.test.js — عقد شاشة 13 (أذون الصرف) في V2 — دورة القرار الكاملة W1-1
 * ═══════════════════════════════════════════════════════════════════════
 * نفس أسلوب tests/v2-kitchen.test.js وtests/v2-leaves.test.js: المستودع
 * يُحمَّل في vm وبوابته apiFetch مزيفة، والشاشة تُقرأ كعقد مصدر
 * (testEnvironment:'node') لأن المتصفح لا يُثبته النص.
 *
 * المثبَّت هنا:
 *   • الباب الواحد لشبكة الشاشة: js/v2/data/dispatch-repo.js — القائمة
 *     قراءةٌ فقط من السجل العام، والأبواب العشرة للكتابة ترسل
 *     X-Idempotency-Key، ومنها الإنشاء، بلا باب حذف
 *   • ثوابت الأدوار مرايا سطرٍ بسطر: createRoles (server.js)،
 *     WRITE_ROLES/CHEF_APPROVAL_ROLES (warehouse-routes.js)،
 *     canDecide + canReceive/canEdit (kitchen.js)
 *   • البوابات نقية ومختبَرة بالصف والصفوف الحدّية: إلغاء قبل الصرف،
 *     إرجاع موقّع قبل أي استلام، إبطال موقّع بعد الصرف، استلام المتبقي
 *     فقط، تعديل قبل اعتماد المخازن، وطباعة الحالات الموقّعة
 *   • كلمات المراحل منسوخة من core/i18n.js حرفيًا، والحالات الست في
 *     السجل المشترك مع cancelled/voided في تجاوزات الشاشة المحلية
 *   • حمولات القرار منسوخة من القديم حرفًا — بما فيها الشواذ المقصودة:
 *     estWeightKg عند إنشاء الوزن المتغير، وrequestedQty:actualWeight عند
 *     الاعتماد بالوزن الفعلي، والاستلام فروق هذه المرة فقط
 *   • التواقيع: لا قرار موقّع بلا اسم حساب (البوابة قبل فتح اللوحة)، وكل
 *     لوحة ترسم لوحتها بمعرّفها الثابت، والصور المخزنة (warehouse/
 *     kitchenReceipt SignatureData) لا تُرسم إلا على ورقة الطباعة
 *   • الطباعة: النافذة تُفتح في إيماءة النقر قبل الجلب، والورقة A4 منسوخة
 *     من printDispatchNote (kitchen.js:1233-1253) ببنتها الخضراء #8fbfa9
 *   • التكرار (409 DUPLICATE_DISPATCH) يُكشف بالرسالة لا بالكود لأن
 *     core/api.js:serverErrorInfo يقرأ data.error لا data.code
 *   • الشاشة: لا fetch/apiFetch، لا معالج سطري إلا زرا ورقة الطباعة، حارس
 *     أحدث قراءة (readSeq) + isConnected + busy قرار واحد + destroy() يُتلف
 *     الجدول ويحرّر اللوحات كلها
 *   • كل رمز data-i ساكن موجود في icons.js — الغائب يسقط صامتًا إلى
 *     circle-help (icons.js:169) فلا يُشحن رمزٌ لا وجود له
 */
const { warehouseSource } = require('./helpers/warehouse-source');
const fs = require('fs');
const path = require('path');
const { ruleBody, hidesLabel } = require('./helpers/css-contract');
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
const DISPATCH_SERVER = path.join(__dirname, '..', 'backend', 'warehouse', 'dispatch-routes.js');
const WR = warehouseSource();
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
    'CANCEL_ROLES', 'LIFECYCLE_ROLES', 'EDIT_ROLES', 'PRINT_STATUSES', 'CHAIN_STAGE_AR',
    'chainStage', 'deptCodesOf', 'canonicalDeptCode', 'rowDeptMatches',
    'chefActionsVisible', 'warehouseActionsVisible', 'cancelVisible', 'reopenVisible',
    'voidVisible', 'receiveVisible', 'editVisible', 'printVisible',
    'dispatchReceiptBalance', 'hasRemaining',
    'fetchMainAvailability', 'fetchDispatchCatalog', 'catalogItem', 'arSearchKey', 'searchCatalog',
    'fetchDepartmentOptions', 'deptNameByCode', 'fetchDispatchSettings', 'fetchDispatchFull',
    'createDispatch', 'editDispatch', 'cancelDispatch', 'reopenDispatch', 'voidDispatch',
    'chefApproveDispatch', 'chefRejectDispatch', 'approveDispatch', 'rejectDispatch', 'receiveDispatch'];

function repoStub(impl) {
    const calls = [];
    const bodies = [];
    let uuid = 0;
    const apiFetch = jest.fn(async (p, opts) => {
        calls.push(p);
        if (opts && opts.body) {
            bodies.push({ path: p, body: opts.body, method: opts.method, headers: opts.headers });
        }
        return typeof impl === 'function' ? impl(p, opts) : impl;
    });
    const repo = loadEsm(REPO, {
        apiFetch,
        crypto: { randomUUID: () => `00000000-0000-4000-8000-${String(++uuid).padStart(12, '0')}` },
    }, EXPORTS);
    return { calls, bodies, repo };
}

const source = (f) => fs.readFileSync(f, 'utf8');

describe('dispatch-repo — الباب الواحد: قراءة من السجل وكتابات من الأبواب العشرة', () => {
    test('كل ما تحتاجه الشاشة مُصدَّر، والحذف لم يعد من الدورة', () => {
        const src = source(REPO);
        for (const name of EXPORTS) {
            expect(src).toMatch(new RegExp(`export (async function|function|const) ${name}\\b`));
        }
        expect(src).not.toMatch(/export (async function|function|const) (deleteDispatch|deleteVisible)\b/);
    });

    test('السجل يمشي صفحاته الخمس ويعترف بالمصفوفة العارية', async () => {
        const { calls, repo } = repoStub(() => ({
            data: Array.from({ length: 1000 }, (_, i) => ({ id: i })),
            pagination: { total: 6000, totalPages: 6 },
        }));
        const rows = await repo.fetchDispatches();
        expect(rows).toHaveLength(5000);
        expect(calls).toHaveLength(5);
        expect(calls[0]).toBe('/dispatches?page=1&limit=1000&sort=id&order=desc&v2_period=month');
        const bare = repoStub([{ id: 1 }, { id: 2 }]);
        expect(await bare.repo.fetchDispatches()).toHaveLength(2);
        const short = repoStub({ data: [{ id: 1 }], pagination: { total: 1, totalPages: 1 } });
        expect(await short.repo.fetchDispatches()).toHaveLength(1);
        expect(short.calls).toHaveLength(1);
    });

    test('عشرة أبواب كتابة بمسارات الخادم نفسها وحمولة JSON ومفتاح تكرار', async () => {
        const doors = [
            ['createDispatch', 'create', 'new', '/dispatches', 'POST'],
            ['editDispatch', 'edit', 9, '/warehouse/dispatches/9/edit', 'PUT'],
            ['cancelDispatch', 'cancel', 9, '/warehouse/dispatches/9/cancel', 'POST'],
            ['reopenDispatch', 'reopen', 9, '/warehouse/dispatches/9/reopen', 'POST'],
            ['voidDispatch', 'void', 9, '/warehouse/dispatches/9/void', 'POST'],
            ['chefApproveDispatch', 'chef-approve', 9, '/warehouse/dispatches/9/chef-approve', 'POST'],
            ['chefRejectDispatch', 'chef-reject', 9, '/warehouse/dispatches/9/chef-reject', 'POST'],
            ['approveDispatch', 'approve', 9, '/warehouse/dispatches/9/approve', 'POST'],
            ['rejectDispatch', 'reject', 9, '/warehouse/dispatches/9/reject', 'POST'],
            ['receiveDispatch', 'receive', 9, '/warehouse/dispatches/9/receive', 'POST'],
        ];
        for (const [fn, action, id, door, method] of doors) {
            const { calls, bodies, repo } = repoStub({});
            const body = { probe: fn };
            await (fn === 'createDispatch' ? repo[fn](body) : repo[fn](id, body));
            expect(calls).toEqual([door]);
            expect(bodies).toHaveLength(1);
            expect(bodies[0].method).toBe(method);
            expect(JSON.parse(bodies[0].body)).toEqual(body);
            expect(bodies[0].headers).toEqual({
                'X-Idempotency-Key': `dispatch-${action}:${id}:00000000-0000-4000-8000-000000000001`,
            });
        }
    });

    test('الخادم يفرض مفتاح التكرار لكل كتابة، ويستبدل الحذف بدورة الحياة', () => {
        const dispatch = source(DISPATCH_SERVER);
        for (const action of ['cancel', 'reopen', 'void', 'chef-approve', 'chef-reject',
            'approve', 'reject', 'edit', 'receive']) {
            const method = action === 'edit' ? 'put' : 'post';
            const route = dispatch.split('\n').find((line) => line.includes(`router.${method}('/dispatches/:id/${action}'`));
            expect(route).toBeDefined();
            expect(route).toContain('idempotency({ requireKey: true })');
        }
        expect(dispatch).toContain("['pending', 'chef_approved', 'rejected'].includes(dispatch.status)");
        expect(dispatch).toContain("!['admin', 'manager', 'warehouse'].includes(req.user.role)");
        expect(dispatch).toContain('DISPATCH_RECEIPT_ALREADY_RECORDED');
        expect(dispatch).toContain("reference_type='dispatch_receipt' AND reference_id=$1");
        expect(dispatch).toContain("['approved', 'partially_received', 'received'].includes(dispatch.status)");
        expect(dispatch).toContain("'APPROVAL_QTY_EXCEEDED'");
        const server = source(SERVER);
        expect(server).toMatch(/app\.use\('\/api', idempotency\(\{[\s\S]*?methods: \['POST', 'PUT', 'PATCH', 'DELETE'\]/);
        expect(server).toContain('app.post(`/api/${entity}`');
        expect(server).toMatch(/res\.status\(405\)\.json\(\{\s*error: 'DISPATCH_DELETE_DISABLED'/);
    });

    test('خادم الاستلام يجمع الفروق على التراكمي ويحرس سقفي الكمية والصناديق', () => {
        const dispatch = source(DISPATCH_SERVER);
        const receive = dispatch.slice(dispatch.indexOf("router.post('/dispatches/:id/receive'"),
            dispatch.indexOf('/**\n * إرجاع مباشر من قسم'));
        expect(receive).toContain('const priorReceived = new Map(');
        expect(receive).toContain('const receivedDeltaQty = raw ? n(raw.receivedQty ?? raw.qty, -1) : 0;');
        expect(receive).toContain('const alreadyReceivedQty = n(prior.receivedQty, 0);');
        expect(receive).toContain('const receivedQty = round(alreadyReceivedQty + receivedDeltaQty);');
        expect(receive).toContain('receivedQty > n(allowed.qty) + 1e-6');
        expect(receive).toContain('const receivedPackagingDelta = isCwReceipt');
        expect(receive).toContain('round(n(prior.receivedPackagingQty, 0) + receivedPackagingDelta)');
        expect(receive).toContain('receivedPackagingQty > allowedPkg + 1e-6');
        expect(receive).toContain("if (!hasDelta)");
        expect(receive).toContain("'RECEIPT_DELTA_REQUIRED'");
        expect(receive).toContain('if (received.receivedDeltaQty <= 0) {continue;}');
        expect(receive).toContain('quantityDelta:received.receivedDeltaQty');
    });

    test('المعرّف في المسار مُشفَّر — لا مسار يُبنى بمزاج المدخل', async () => {
        const { calls, repo } = repoStub({});
        await repo.editDispatch('7/8', {});
        await repo.cancelDispatch('7/8', { reason: 'إلغاء' });
        await repo.reopenDispatch('7/8', { reason: 'إرجاع' });
        await repo.voidDispatch('7/8', { reason: 'إبطال' });
        await repo.receiveDispatch('7/8', {});
        expect(calls).toEqual([
            '/warehouse/dispatches/7%2F8/edit',
            '/warehouse/dispatches/7%2F8/cancel',
            '/warehouse/dispatches/7%2F8/reopen',
            '/warehouse/dispatches/7%2F8/void',
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

    test('مرحلة السلسلة: ثمانية تخزينات + فصل «معلّق» بشرط الشيف، والمجهول فراغ', () => {
        const { repo } = repoStub({});
        const C = repo.CHAIN_STAGE_AR;
        expect(repo.chainStage({ status: 'pending', needsChefApproval: true })).toBe(C.chefWait);
        expect(repo.chainStage({ status: 'pending' })).toBe(C.whWait);
        expect(repo.chainStage({ status: 'chef_approved' })).toBe(C.chefDone);
        expect(repo.chainStage({ status: 'approved' })).toBe(C.dispensed);
        expect(repo.chainStage({ status: 'partially_received' })).toBe(C.partial);
        expect(repo.chainStage({ status: 'received' })).toBe(C.received);
        expect(repo.chainStage({ status: 'rejected' })).toBe(C.rejected);
        expect(repo.chainStage({ status: 'cancelled' })).toBe('ملغى قبل الصرف');
        expect(repo.chainStage({ status: 'voided' })).toBe('مُبطل وعُكست آثاره المخزنية والمالية');
        expect(repo.chainStage({ status: 'ghost' })).toBe('');
        expect(repo.chainStage({})).toBe('');
    });

    test('ثوابت الأدوار مرايا سطور الخادم والقديم حرفيًا', () => {
        const { repo } = repoStub({});
        const list = (a) => `[${a.map((r) => `'${r}'`).join(', ')}]`;
        const server = source(SERVER);
        expect(server).toContain(`entity === 'dispatches' ? ${list(repo.CREATE_ROLES)} : entity === 'payroll'`);
        const wr = WR;
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
        expect(repo.CANCEL_ROLES).toEqual(['admin', 'manager', 'warehouse']);
        expect(repo.LIFECYCLE_ROLES).toEqual(['admin', 'manager']);
        expect([...repo.PRINT_STATUSES].sort()).toEqual([
            'approved', 'cancelled', 'partially_received', 'received', 'voided',
        ]);
        expect(kitchen).toContain("['approved','partially_received','received','cancelled','voided']");
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

    test('الإلغاء قبل الصرف: الإدارة/المخازن، أو منشئ الإذن ضمن أدوار الإنشاء', () => {
        const { repo } = repoStub({});
        for (const status of ['pending', 'chef_approved', 'rejected']) {
            for (const role of repo.CANCEL_ROLES) {
                expect(repo.cancelVisible(role, { status, creatorUserId: 42 }, { userId: 7 })).toBe(true);
            }
            for (const role of ['kitchen', 'sous_chef', 'dept_head']) {
                const row = { status, creatorUserId: 42 };
                expect(repo.cancelVisible(role, row, { userId: 42 })).toBe(true);
                expect(repo.cancelVisible(role, row, { userId: 7 })).toBe(false);
                expect(repo.cancelVisible(role, row, { id: 42 })).toBe(false);
            }
        }
        for (const status of ['approved', 'partially_received', 'received', 'cancelled', 'voided', '']) {
            expect(repo.cancelVisible('admin', { status })).toBe(false);
        }
        expect(repo.cancelVisible('accountant', { status: 'pending', creatorUserId: 42 }, { userId: 42 })).toBe(false);
    });

    test('الإرجاع: إدارة فقط، معتمد فقط، وقبل أي علامة أو صف استلام', () => {
        const { repo } = repoStub({});
        const approved = { status: 'approved', receivedItems: [] };
        for (const role of repo.LIFECYCLE_ROLES) {expect(repo.reopenVisible(role, approved)).toBe(true);}
        expect(repo.reopenVisible('warehouse', approved)).toBe(false);
        expect(repo.reopenVisible('admin', { ...approved, kitchenReceivedAt: '2026-11-01' })).toBe(false);
        expect(repo.reopenVisible('admin', { ...approved, receivedItems: [{ receivedQty: 1 }] })).toBe(false);
        for (const status of ['pending', 'chef_approved', 'partially_received', 'received', 'rejected']) {
            expect(repo.reopenVisible('admin', { status })).toBe(false);
        }
    });

    test('الإبطال بعد الصرف: إدارة فقط، وثلاث حالات مصروفة', () => {
        const { repo } = repoStub({});
        for (const role of repo.LIFECYCLE_ROLES) {
            for (const status of ['approved', 'partially_received', 'received']) {
                expect(repo.voidVisible(role, { status })).toBe(true);
            }
            for (const status of ['pending', 'chef_approved', 'rejected', 'cancelled', 'voided']) {
                expect(repo.voidVisible(role, { status })).toBe(false);
            }
        }
        expect(repo.voidVisible('warehouse', { status: 'approved' })).toBe(false);
    });

    test('فصل المهام يستخدم userId: المنشئ لا يعتمد ولا يستلم إذن نفسه', () => {
        const { repo } = repoStub({});
        const chef = { status: 'pending', needsChefApproval: true, creatorUserId: 42 };
        const warehouse = { status: 'chef_approved', creatorUserId: 42 };
        const receipt = { status: 'approved', creatorUserId: 42, approvedItems: [{ itemName: 'أرز', approvedQty: 5 }] };
        expect(repo.chefActionsVisible('kitchen', chef, { userId: 42 })).toBe(false);
        expect(repo.chefActionsVisible('kitchen', chef, { userId: 7 })).toBe(true);
        expect(repo.chefActionsVisible('kitchen', chef, { id: 42 })).toBe(true);
        expect(repo.warehouseActionsVisible('admin', warehouse, { userId: 42 })).toBe(false);
        expect(repo.warehouseActionsVisible('admin', warehouse, { userId: 7 })).toBe(true);
        expect(repo.receiveVisible('kitchen', receipt, { userId: 42 })).toBe(false);
        expect(repo.receiveVisible('kitchen', receipt, { userId: 7 })).toBe(true);
    });

    test('الاستلام: المعتمد فقط؛ والدور أو رئيس القسم صاحب الإذن بأكواد قسمه', () => {
        const { repo } = repoStub({});
        const row = { status: 'approved', deptCode: 'K1', approvedItems: [{ itemName: 'أرز', approvedQty: 5 }] };
        for (const r of repo.RECEIVE_ROLES) {expect(repo.receiveVisible(r, row)).toBe(true);}
        expect(repo.receiveVisible('warehouse', row)).toBe(false);
        expect(repo.receiveVisible('dept_head', row, { deptCode: 'K1, K2' })).toBe(true);
        expect(repo.receiveVisible('dept_head', row, { deptCode: 'k3' })).toBe(false);
        expect(repo.receiveVisible('dept_head', row, { deptCode: '' })).toBe(false);
        expect(repo.receiveVisible('admin', { status: 'pending', deptCode: 'K1' })).toBe(false);
        expect(repo.receiveVisible('admin', { status: 'approved', approvedItems: [] })).toBe(false);
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

    test('مرادفات الأقسام: SERVICE↔hot_hall و G↔juice و CAF↔shop — زر الاستلام لا يُسرَق من رئيس القسم', () => {
        const { repo } = repoStub({});
        // الحالة الحيّة: حساب رئيس القسم «SERVICE» والأذون مسجّلة «hot_hall»
        expect(repo.canonicalDeptCode('SERVICE')).toBe('hot_hall');
        expect(repo.canonicalDeptCode('hot_hall')).toBe('hot_hall');
        expect(repo.canonicalDeptCode('')).toBe('');
        const hall = { status: 'approved', deptCode: 'hot_hall', approvedItems: [{ itemName: 'أرز', approvedQty: 5 }] };
        expect(repo.rowDeptMatches({ deptCode: 'SERVICE' }, hall)).toBe(true);
        expect(repo.receiveVisible('dept_head', hall, { deptCode: 'SERVICE' })).toBe(true);
        expect(repo.editVisible('dept_head', { status: 'pending', deptCode: 'hot_hall' }, { deptCode: 'SERVICE' })).toBe(true);
        expect(repo.rowDeptMatches({ deptCode: 'juice' }, { status: 'approved', deptCode: 'G' })).toBe(true);
        expect(repo.rowDeptMatches({ deptCode: 'shop' }, { status: 'approved', deptCode: 'CAF' })).toBe(true);
        expect(repo.rowDeptMatches({ deptCode: 'ca1' }, { status: 'approved', deptCode: 'NAS' })).toBe(true);
        expect(repo.rowDeptMatches({ deptCode: 'salads' }, hall)).toBe(false);
    });
});

describe('dispatch-repo — رصيد الاستلام التراكمي والمتبقي', () => {
    test('المعتمد نافذة الاستلام، وآخر استلام مطابق هو الرصيد التراكمي', () => {
        const { repo } = repoStub({});
        const row = {
            approvedItems: [
                { itemName: 'أرز', qty: 2, requestedQty: 9, approvedQty: 10 },
                { name: 'سكر', qty: 4 },
            ],
            items: [{ itemName: 'أرز', qty: 100 }],
            receivedItems: [
                { itemName: ' أرز ', receivedQty: 2 },
                { itemName: 'سكر', receivedQty: 1 },
                { itemName: 'أرز', receivedQty: 3 },
            ],
        };
        expect(repo.dispatchReceiptBalance(row, 0)).toMatchObject({
            approved: 10, received: 3, remaining: 7, isCatchWeight: false,
            approvedPackaging: 0, receivedPackaging: 0, remainingPackaging: 0,
        });
        expect(repo.dispatchReceiptBalance(row, 1)).toMatchObject({
            approved: 4, received: 1, remaining: 3,
        });
        expect(repo.hasRemaining(row)).toBe(true);
    });

    test('الوزن المتغير له سقفان مستقلان: الكمية والصناديق', () => {
        const { repo } = repoStub({});
        const row = {
            items: [{ itemName: 'لحم', catchWeightEnabled: true, approvedQty: 20, packagingQty: 10 }],
            receivedItems: [{ itemName: 'لحم', receivedQty: 8, receivedPackagingQty: 2 }],
        };
        expect(repo.dispatchReceiptBalance(row)).toEqual({
            item: row.items[0], approved: 20, received: 8, remaining: 12, isCatchWeight: true,
            approvedPackaging: 10, receivedPackaging: 2, remainingPackaging: 8,
        });
        expect(repo.hasRemaining({ ...row, receivedItems: [{ itemName: 'لحم', receivedQty: 20, receivedPackagingQty: 2 }] })).toBe(true);
        expect(repo.hasRemaining({ ...row, receivedItems: [{ itemName: 'لحم', receivedQty: 8, receivedPackagingQty: 10 }] })).toBe(true);
        expect(repo.hasRemaining({ ...row, receivedItems: [{ itemName: 'لحم', receivedQty: 20, receivedPackagingQty: 10 }] })).toBe(false);
        const fallback = repo.dispatchReceiptBalance({
            items: [{ name: 'جبن', actualWeight: 0.1, approvedQty: 5, approvedPackagingQty: 3 }],
        });
        expect(fallback).toMatchObject({
            isCatchWeight: true, approvedPackaging: 3, receivedPackaging: 0, remainingPackaging: 3,
        });
    });

    test('لا أصناف أو لا متبقٍ أو استلام زائد: لا زر استلام ولا رصيد سالب', () => {
        const { repo } = repoStub({});
        expect(repo.hasRemaining({})).toBe(false);
        expect(repo.hasRemaining({ items: [] })).toBe(false);
        expect(repo.hasRemaining({ items: [{ itemName: 'أرز', qty: 0 }] })).toBe(false);
        expect(repo.dispatchReceiptBalance({
            items: [{ itemName: 'أرز', approvedQty: 5 }],
            receivedItems: [{ itemName: 'أرز', receivedQty: 9 }],
        })).toMatchObject({ approved: 5, received: 9, remaining: 0 });
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

    test('تستخدم ورقة الطباعة مستمعات أحداث بدل المعالجات السطرية', () => {
        const s = src();
        const handlers = s.match(/<[a-z][^>]*\son[a-z]+\s*=/gi) || [];
        expect(handlers).toEqual([]);
        expect(s).not.toMatch(/window\.(prompt|alert)\(/);
        const note = s.slice(s.indexOf('async function printNote'), s.indexOf('/* ── القراءة والرسم'));
        expect(note).toContain('data-v2-print');
        expect(note).toContain('data-v2-close');
        expect(note).toContain("querySelector('[data-v2-print]')?.addEventListener");
        expect(note).toContain("querySelector('[data-v2-close]')?.addEventListener");
    });

    test('الكتابات العشر من أبوابها: كل اسم باب مستدعى في الشاشة', () => {
        const s = src();
        for (const fn of ['createDispatch', 'editDispatch', 'cancelDispatch', 'reopenDispatch', 'voidDispatch',
            'chefApproveDispatch', 'chefRejectDispatch', 'approveDispatch', 'rejectDispatch', 'receiveDispatch']) {
            expect(s).toMatch(new RegExp(`\\b${fn}\\(`));
        }
        expect(s).not.toMatch(/\bdeleteDispatch\(/);
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
        expect(s).toContain('await cancelDispatch(raw.id, { reason });');
        expect(s).toContain('await reopenDispatch(raw.id, { reason, signatureData: sig, signerName });');
        expect(s).toContain('await voidDispatch(raw.id, { reason, signatureData: sig, signerName });');
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
        expect(s).toMatch(/SIGN_KINDS = new Set\(\['chef-approve', 'chef-reject', 'approve', 'reject', 'receive', 'reopen', 'void'\]\)/);
        expect(s).toMatch(/if \(SIGN_KINDS\.has\(kind\) && !signerName\)/);
        expect(s).toContain('اسم حسابك غير متاح في الجلسة — أعد تسجيل الدخول لتنفيذ قرار موقّع');
        expect(s).toMatch(/readSignaturePad\(panelEl, id, signerName\)/);
        for (const id of ['v2dsp-chef-approve-sig', 'v2dsp-chef-reject-sig', 'v2dsp-approve-sig',
            'v2dsp-reject-sig', 'v2dsp-receive-sig', 'v2dsp-reopen-sig', 'v2dsp-void-sig']) {
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

    test('بوابة الرصيد والطلب قبل الاعتماد: لا زيادة على المتوفر أو المطلوب ولا وزن بلا ميزان', () => {
        const s = src();
        expect(s).toMatch(/if \(!\(actualWeight > 0\)\)/);
        expect(s).toMatch(/if \(actualWeight > onHand \+ 1e-6\) \{failMsg = `الوزن الفعلي من/);
        expect(s).toMatch(/if \(approvedQty > onHand \+ 1e-6\) \{failMsg = `الكمية المعتمدة من/);
        expect(s).toMatch(/if \(approvedQty > requested \+ 1e-6\) \{failMsg = `الكمية المعتمدة من/);
        expect(s).toContain('أكبر من المطلوب (${formatQty(requested)})');
        expect(s).toMatch(/if \(packagingQty > requestedBoxes \+ 1e-6\)/);
        expect(s).toMatch(/if \(requestedWeight > 0 && actualWeight > requestedWeight \+ 1e-6\)/);
        // والواجهة تحجب زر الاعتماد عند عجز الرصيد قبل أن يرفضه الخادم
        expect(s).toContain(`<span class="erp-badge" data-tone="danger">يوجد أصناف بلا رصيد كافٍ</span>' : '', blocked)`);
        expect(s).toContain("data-v2-submit${submitDisabled ? ' disabled' : ''}");
        // ولا يُضاف صنف صفري الرصيد للإنشاء أصلًا
        expect(s).toContain('لا يوجد أي رصيد من');
        expect(s).toContain('الرصيد غير كافٍ من');
    });

    test('الاستلام يعرض المتبقي ويرسل فروق هذه المرة فقط، ويحذف الصفوف الصفرية', () => {
        const s = src();
        const receive = s.slice(s.indexOf('function receiveHtml'), s.indexOf('async function printNote'));
        expect(receive).toContain('const balance = dispatchReceiptBalance(raw, idx);');
        for (const value of ['const approved = receiptQty(balance.approved);',
            'const received = receiptQty(balance.received);', 'const remaining = receiptQty(balance.remaining);',
            'const approvedBoxes = receiptQty(balance.approvedPackaging);',
            'const receivedBoxes = receiptQty(balance.receivedPackaging);',
            'const remainingBoxes = receiptQty(balance.remainingPackaging);']) {
            expect(receive).toContain(value);
        }
        expect(receive).toContain('data-approved="${approved}" data-received="${received}" data-remaining="${remaining}"');
        expect(receive).toContain('data-apboxes="${approvedBoxes}" data-receivedboxes="${receivedBoxes}" data-remainingboxes="${remainingBoxes}"');
        expect(receive).toContain('المعتمد: ${withBoxes(approved, approvedBoxes)}');
        expect(receive).toContain('مستلم سابقًا: ${withBoxes(received, receivedBoxes)}');
        expect(receive).toContain('المتبقي: ${withBoxes(remaining, remainingBoxes)}');
        expect(receive).toContain('فرق هذه المرة وليس إجماليًا مستلمًا');
        expect(receive).toContain('received > remaining + 1e-6');
        expect(receive).toContain('recvPkg > remainingBoxes + 1e-6');
        expect(receive).toContain('if (!(received > 0) && !(isCw && recvPkg > 0)) {continue;}');
        expect(receive).toContain('receivedQty: received,');
        expect(receive).toContain('...(isCw ? { receivedPackagingQty: recvPkg } : {}),');
        expect(receive).toContain('if (!receivedItems.some((item) => item.receivedQty > 0))');
        expect(receive).toContain('صناديق الوزن المتغير وحدها لا تُسجّل كاستلام');
    });

    test('التكرار يُكشف بالرسالة لا بالكود — لأن core/api يقرأ data.error', () => {
        const s = src();
        expect(s).toMatch(/e\.code === 'DUPLICATE_DISPATCH'\) \|\| \/مكرر\|مشابه\|DUPLICATE\/\.test\(m\)/);
        expect(s).toContain('الطلب مسجل بالفعل — لم يتكرر');
    });

    test('حراس القراءة والقرار: أحدث قراءة تفوز، لا رسم بعد الانفصال، قرار واحد في المرة', () => {
        const s = src();
        /* 2026-10-29: حارس `return` الصامت كان يُسقط تحديثًا مطلوبًا أثناء
           قراءة جارية فيبقى السجل قديمًا حتى ريفريش — صار الطلب يُصفّ ولا يُسقط. */
        expect(s).toMatch(/if \(loading\) \{reloadQueued = true; return;\}/);
        expect(s).toMatch(/if \(reloadQueued\) \{reloadQueued = false; reload\(\);\}/);
        expect(s).toMatch(/const seq = \+\+readSeq;/);
        expect(s.match(/if \(!el\.isConnected \|\| seq !== readSeq\) \{return;\}/g)).toHaveLength(2);
        expect(s).toMatch(/const panelAlive = \(seq\) => el\.isConnected && seq === panelSeq;/);
        expect(s.match(/if \(busy\) \{notify\('جارٍ تنفيذ عملية — انتظر النتيجة'\); return;\}/g)).toHaveLength(8);
        expect(s.match(/^\s+busy = true;/gm)).toHaveLength(10);
        expect(s.match(/^\s+busy = false;/gm)).toHaveLength(10);
        expect(s.match(/disposeSignaturePads\(ALL_SIG_IDS\);/g)).toHaveLength(2);
        expect(s).toMatch(/table\.destroy\(\);/);
        expect(s).toMatch(/el\.remove\(\);/);
    });

    test('قرار موفق يحدّث السجل من ردّ الخادم فورًا بلا انتظار قراءة القائمة', () => {
        const s = src();
        /* الصف المعتمد في ردّ الخادم هو الحقيقة: يُدمج ويُرسم قبل reload() */
        expect(s).toMatch(/function applyDecisionResult\(result\)/);
        expect(s).toMatch(/const row = result && result\.dispatch;/);
        expect(s).toMatch(/rawRows\[idx\] = \{\.\.\.rawRows\[idx\], \.\.\.row\};/);
        expect(s).toMatch(/rawById\.set\(key, rawRows\[idx >= 0 \? idx : 0\]\);\s*\n\s*paint\(\);/);
        const decisions = ['submitCancel', 'submitReopen', 'submitVoid', 'submitChefApprove',
            'submitChefReject', 'submitApprove', 'submitReject', 'submitReceive'];
        for (const fn of decisions) {
            const start = s.indexOf(`async function ${fn}(`);
            expect(start).toBeGreaterThan(-1);
            const rest = s.slice(start + 1);
            const end = rest.search(/\n {4}(async )?function /);
            const scope = end === -1 ? rest : rest.slice(0, end);
            expect(scope).toContain('applyDecisionResult(result);');
            expect(scope.indexOf('applyDecisionResult(result);')).toBeLessThan(scope.indexOf('await reload();'));
        }
    });

    test('تعارض القرار (409) يُصحّح الشاشة من حالة الخادم — لا ريفرش يدوي', () => {
        const s = src();
        /* 2026-10-29 طلب المالك: «لما بعمل موافقة لإذن الصرف لازم أعمل تحديث للصفحة
           وساعات لم تتم الموافقة ولما دوس مرة تانية يقولي الطلب تم الموافقة عليه».
           الشفاء: شارة الحالة في ردّ الخادم تُدمج وتُرسم، فلا يبقى زر اعتماد أمام
           المستخدم على إذن حُسِم فعلًا. */
        expect(s).toMatch(/const DECIDED_CODES = new Set\(\[/);
        for (const code of ['DISPATCH_ALREADY_APPROVED', 'DISPATCH_ALREADY_RECEIVED', 'DISPATCH_REJECTED',
            'DISPATCH_INVALID_STATUS', 'DISPATCH_NOT_PENDING', 'CHEF_APPROVAL_NOT_REQUIRED',
            'CHEF_APPROVAL_REQUIRED', 'DISPATCH_NOT_RECEIVABLE', 'DISPATCH_RECEIPT_ALREADY_RECORDED']) {
            expect(s).toContain(`'${code}'`);
        }
        expect(s).toMatch(/function handleDecisionConflict\(e\)/);
        // الرموز غير المعروفة فشلٌ حقيقي: لا تبتلعه الشاشة
        expect(s).toMatch(/if \(!code \|\| !DECIDED_CODES\.has\(code\)\) \{return false;\}/);
        // الحالة من الردّ أولًا، ومعرّف اللوحة احتياطًا — ثم دمجٌ ورسمٌ فوري
        expect(s).toMatch(/const details = \(e && e\.details\) \|\| \{\};/);
        expect(s).toMatch(/details\.dispatchId != null \? details\.dispatchId : \(panelRaw && panelRaw\.id\);/);
        expect(s).toMatch(/applyDecisionResult\(\{ dispatch: \{ id, status: currentStatus \} \}\);/);
        // اللوحة تُغلق: لا يبقى قرارٌ منتهٍ معروضًا
        expect(s).toMatch(/function handleDecisionConflict\(e\)[\s\S]*?closePanel\(\);/);
        // والاعلان يُسمّي الحالة التي رآها الخادم، عبر مُحلّل الشاشة المحلي
        expect(s).toContain('الحالة الحالية: ${dispatchStatusLabel(currentStatus)}');
        // والستار: إعادة قراءة تعيد السجل كله من الخادم
        expect(s).toMatch(/function handleDecisionConflict\(e\)[\s\S]*?reload\(\);\s*\n\s*return true;/);
        // كل قرار من الثمانية يجرّب التصحيح أولًا — قبل فرع «قيد التنفيذ» والرسائل
        for (const fn of ['submitCancel', 'submitReopen', 'submitVoid', 'submitChefApprove',
            'submitChefReject', 'submitApprove', 'submitReject', 'submitReceive']) {
            const start = s.indexOf(`async function ${fn}(`);
            expect(start).toBeGreaterThan(-1);
            const rest = s.slice(start + 1);
            const end = rest.search(/\n {4}(async )?function /);
            const scope = end === -1 ? rest : rest.slice(0, end);
            expect(scope).toContain('if (handleDecisionConflict(e)) {return;}');
        }
        expect(s.match(/if \(handleDecisionConflict\(e\)\) \{return;\}/g)).toHaveLength(8);
    });

    test('عميل الشبكة يوصل حالة الردّ وتفاصيله — الشاشة تقرر من حقيقة الخادم لا من نص الرسالة', () => {
        const api = source(path.join(APP, 'js', 'core', 'api.js'));
        // قبل هذا كان الخطأ يحمل رسالة فقط، فتضطر الشاشة لمطابقة العربية الحساسة
        expect(api).toMatch(/err\.status = res\.status;/);
        expect(api).toMatch(/if \(data && typeof data === 'object'\) \{err\.details = data;\}/);
        // والرمز لا يزال من serverErrorInfo (data.error.code) — الترتيب: code ثم status/details
        expect(api.indexOf('err.code = info.code;')).toBeLessThan(api.indexOf('err.status = res.status;'));
    });

    test('زر القرار يعلن الانشغال من أول نقرة — لا ضغطة ثانية', () => {
        const s = src();
        expect(s).toMatch(/function setPanelBusy\(label\)/);
        expect(s).toMatch(/btn\.disabled = true;/);
        expect(s).toMatch(/btn\.setAttribute\('aria-busy', 'true'\);/);
        expect(s).toMatch(/function clearPanelBusy\(prevHtml\)/);
        expect(s.match(/const prevBtn = setPanelBusy\('جارٍ /g)).toHaveLength(8);
        expect(s.match(/clearPanelBusy\(prevBtn\);/g)).toHaveLength(8);
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

    test('الطباعة: العارض الداخلي يُفتح مباشرة قبل الجلب، والورقة ورقة القديم', () => {
        const s = src();
        const note = s.slice(s.indexOf('async function printNote'), s.indexOf('/* ── القراءة والرسم'));
        expect(note.indexOf('openInAppReport(')).toBeGreaterThan(-1);
        expect(note.indexOf('openInAppReport(')).toBeLessThan(note.indexOf('fetchDispatchFull'));
        expect(note).toContain('جارٍ تجهيز إذن الصرف…');
        expect(note).toContain('إذن صرف مخزن');
        expect(note).toContain('#8fbfa9');
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
        for (const gate of ['printVisible(raw)', 'editVisible(role, raw, user)',
            'chefActionsVisible(role, raw, user)', 'warehouseActionsVisible(role, raw, user)',
            'receiveVisible(role, raw, user)', 'cancelVisible(role, raw, user)',
            'reopenVisible(role, raw)', 'voidVisible(role, raw)']) {
            expect(actions).toContain(gate);
        }
        expect(actions).toContain("btn('cancel', id, 'circle-x', 'إلغاء', 'erp-btn--danger')");
        expect(actions).toContain("btn('reopen', id, 'undo', 'إرجاع')");
        expect(actions).toContain("btn('void', id, 'archive', 'إبطال', 'erp-btn--danger')");
        expect(actions).not.toMatch(/\bdeleteVisible\b|btn\('delete'/);
    });

    test('دورة الحياة: إلغاء موثّق قبل الصرف، وإرجاع/إبطال موقّعان، بلا واجهة حذف', () => {
        const s = src();
        expect(s).toContain('userId: ctx.userId != null ? ctx.userId : null,');
        expect(s).toContain('إلغاء موثّق قبل الصرف:');
        expect(s).toContain('الإرجاع متاح قبل بدء الاستلام فقط.');
        expect(s).toContain('الإبطال يعكس الأثر المخزني والمالي للمستند.');
        expect(s).toContain("panelActions('تأكيد الإلغاء', 'circle-x')");
        expect(s).toContain("panelActions('تأكيد الإرجاع والتوقيع', 'undo')");
        expect(s).toContain("panelActions('تأكيد الإبطال والتوقيع', 'archive')");
        for (const [fn, reasonMsg, sig] of [
            ['submitCancel', 'أدخل سبب إلغاء إذن الصرف', null],
            ['submitReopen', 'أدخل سبب إرجاع الإذن للمراجعة', 'readSig(SIG_IDS.reopen)'],
            ['submitVoid', 'أدخل سبب إبطال إذن الصرف', 'readSig(SIG_IDS.void)'],
        ]) {
            const scope = s.slice(s.indexOf(`async function ${fn}(`), s.indexOf('async function submitChefApprove'));
            expect(scope).toContain(reasonMsg);
            if (sig) {expect(scope.indexOf(reasonMsg)).toBeLessThan(scope.indexOf(sig));}
        }
        expect(s).not.toMatch(/\bdeleteVisible\b|\bdeleteDispatch\b|btn\('delete'|data-v2-action="delete"/);
    });

    test('رسائل النجاح تحكي ما وقع فعلًا — والمبلغ من ردّ الخادم لا محسوبًا هنا', () => {
        const s = src();
        expect(s).toContain('تم اعتماد الطلب وإحالته للمخازن');
        expect(s).toContain('تم رفض الطلب وسيظهر لرئيس القسم');
        expect(s).toContain('تم إلغاء إذن الصرف وتسجيل السبب في سجله');
        expect(s).toContain('تم إرجاع الإذن للمراجعة وعكس أثره المخزني والمالي');
        expect(s).toContain('تم إبطال إذن الصرف وعكس آثاره المخزنية والمالية');
        expect(s).toContain('تم تسجيل استلام الإذن بالكامل والتوقيع');
        expect(s).toContain('تم تسجيل الاستلام الجزئي — بقي المتبقي لدفعة لاحقة');
        expect(s).toMatch(/\$\{moneyPlain\(result && result\.totalValue \|\| 0\)\}/);
        expect(s).toMatch(/res && res\.chefApprovalReset/);
        expect(s).toContain('تم التعديل — أُلغي اعتماد الشيف وأُعيد الطلب للمراجعة');
    });

    test('ملخّص الحالات يستخدم السجل المشترك وتجاوزات محلية، والمجهول يبقى خامًا', () => {
        const s = src();
        const shared = source(SHARED_STATUS);
        for (const status of ['pending', 'chef_approved', 'approved', 'partially_received', 'received', 'rejected']) {
            expect(shared).toContain(`'dispatch:${status}':`);
        }
        expect(shared).not.toContain("'dispatch:cancelled':");
        expect(shared).not.toContain("'dispatch:voided':");
        expect(s).toContain("cancelled: { label: 'ملغى', tone: 'danger', icon: 'circle-x' }");
        expect(s).toContain("voided: { label: 'مُبطل', tone: 'danger', icon: 'archive' }");
        expect(s).toContain("return (status && status.label) || String(value || '—');");
        expect(s).toMatch(/const states = Object\.entries\(c\)\.map\(\(\[k, v\]\) => `\$\{k \? dispatchStatusLabel\(k\) : 'بلا حالة'\} \$\{v\}`\)\.join\(' · '\);/);
        expect(s).toContain('dispatchStatusBadge(row.status)');
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
        expect(h).toMatch(/dispatchScreen = \(await mountLazy\('dispatch', '\[data-v2-dispatch-host\]'/);
        expect(h).toMatch(/role: session\.role,/);
        expect(h).toMatch(/userId: u\.id != null \? u\.id : \(u\.sub != null \? Number\(u\.sub\) : null\),/);
        expect(h).toMatch(/userName: String\(u\.name \|\| u\.username \|\| ''\),/);
        expect(h).toMatch(/deptCode: String\(u\.dept_code \|\| ''\),/);
        expect(h).toMatch(/notify: notifyTo\(note\),/);
        expect(h).toMatch(/confirmFn: confirmAction,/);
    });

    test('المغادرة تُتلف الشاشة — لا شبح يكتب على DOM بعد التنقّل', () => {
        const h = source(HOST);
        expect(h).toMatch(/dispatchScreen\.destroy\(\);/);
        expect(h).toMatch(/dispatchScreen = null;/);
        expect(h).toMatch(/navStatus\.current !== 'dispatch'/);
    });

    test('الشاشة تُستورد بمراجعة الصفحة نفسها وتُركّب على مضيفها', () => {
        const rev = source(V2_HTML).match(/js\/v2\/preview\.js\?v=([0-9.]+)/)[1];
        expect(source(path.join(V2, 'screens', 'registry.js'))).toContain(`./dispatch.js?v=${rev}`);
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
        // تسمية الزرّ تُخفى (display:none أو النمط البصري sr-only) ويبقى الرمز مقروءًا
        const labelRule = ruleBody(d, '.erp-v2-dispatch .erp-card__head .erp-btn > span');
        expect(labelRule).not.toBe('');
        expect(hidesLabel(labelRule)).toBe(true);
        expect(d).toMatch(/min-block-size: var\(--erp-space-8\)/);
        expect(d).toContain('.erp-v2-dispatch__tools { flex: 1 1 100%; }');
        expect(d).not.toMatch(/\.erp-v2-dispatch \.erp-input\s*\{[^}]*min-block-size/);
    });
});
