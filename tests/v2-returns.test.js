/**
 * v2-returns.test.js — عقد شاشة 20 (مرتجعات المطبخ) في V2 — دورة المرتجعات W1-5
 * ═══════════════════════════════════════════════════════════════════════
 * نفس أسلوب tests/v2-veg.test.js (W1-4): المستودع يُحمَّل في vm وبوابته
 * apiFetch مزيفة، والشاشة تُقرأ كعقد مصدر (testEnvironment:'node').
 *
 * المثبَّت هنا:
 *   • الباب الواحد لشبكة الشاشة: js/v2/data/warehouse-repo.js — قراءات لوحة
 *     الإنشاء (إذونات معتمدة :1256، أقسام الإرجاع المباشر :1259، المخزون
 *     :1263) وحمولة الإنشاء (:1360/:1385) وحارسا الحذف :1356/:683
 *   • ثوابت الأدوار مرايا سطرٍ بسطر: RETURN_ROLES :16 وحارس الحذف :1506،
 *     وقائمتا الواجهة من القديم :650-651 بمسافاتهما المضغوطة
 *   • الانحرافان المعلنان: قائمة أقسام dept_head المتعددة بدل الحقل الخام
 *     الذي يرفضه الخادم 422 (سابقة إصلاح :704)، ورسالة نجاح الحذف من رد
 *     الخادم (:1570) بسقوط نص القديم :689
 *   • لا توقيع إلكتروني ولا window.confirm في الشاشة (confirmFn المضيف)؛
 *     window.confirm واحدة فقط كسقوط احتياطي
 *   • كلمات اللوحة والتحقق والنجاح منسوخة من features/kitchen.js حرفيًا
 *     (:1266 البنر، :1270-1274 الأسباب، :1351/:1358/:1374/:1383 التحقق،
 *     :1366/:1391 النجاح، :683 التحذير)
 *   • الشاشة: لا fetch/apiFetch، لا معالج سطري إطلاقًا، حارس أحدث قراءة +
 *     isConnected (هدفان) + busy قرار واحد + destroy() يُتلف الجدول، وثلاثة
 *     حراس panelAlive لتجهيز اللوحة
 *   • المضيف: تمرير deptCode الجديد (u.dept_code) لفصل الدورة، والركوب على
 *     مضيف السجلات المشترك renderLiveRegisterScreen
 *   • الطبقة: كل قيم erp-ops.css رموز --erp-* بلا hex ولا px خام، ووسائط
 *     الشاشة ممتدة داخل آخر كتلتي الوسيط عمدًا (عدد الكتل يبقى 2 و2)
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const APP = path.join(__dirname, '..', 'frontend', 'app');
const V2 = path.join(APP, 'js', 'v2');
const REPO = path.join(V2, 'data', 'warehouse-repo.js');
const SCREEN = path.join(V2, 'screens', 'wh-returns.js');
const OPS_CSS = path.join(APP, 'css', 'v2', 'erp-ops.css');
const V2_HTML = path.join(APP, 'v2.html');
const HOST = path.join(V2, 'preview.js');
const ICONS = path.join(APP, 'js', 'icons.js');
const VR = path.join(__dirname, '..', 'backend', 'warehouse-routes.js');
const LEGACY = path.join(APP, 'js', 'features', 'kitchen.js');
// REV مشتق من الوسم الحيّ في v2.html (نفس نمط v2-kitchen/wh-prs/veg).
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

const EXPORTS = ['isoDay', 'firstOfMonth', 'WALK_PAGES',
    'fetchInventoryTx', 'fetchKitchenReturns', 'INV_TYPE_AR', 'INV_TYPE_TONE',
    'invTxToRow', 'kitchenReturnToRow',
    'RETURN_ROLES', 'RETURN_DELETE_ROLES', 'returnCreateVisible', 'returnDeleteVisible',
    'fetchReturnDispatches', 'returnDispatchOption', 'fetchReturnDepartments',
    'directReturnDepartments', 'deptLabelOf', 'fetchReturnInventory', 'returnInventoryOption',
    'returnDeptCodesOf', 'returnCreatePayload', 'createKitchenReturn', 'deleteKitchenReturn'];

function repoStub(impl) {
    const calls = [];
    const bodies = [];
    const methods = [];
    const apiFetch = jest.fn(async (p, opts) => {
        calls.push(p);
        methods.push(opts && opts.method);
        if (opts && opts.body) {bodies.push({ path: p, body: opts.body, method: opts.method });}
        return typeof impl === 'function' ? impl(p, opts) : impl;
    });
    const repo = loadEsm(REPO, { apiFetch }, EXPORTS);
    return { calls, bodies, methods, repo };
}

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
        expect(out[0].items).toEqual([{ name: 'خيار', unit: 'كجم', qty: 3 }]);
    });

    test('مشي الصفحات: الصفحة القصيرة تقصر — وtotalPages يقفل', async () => {
        const big = repoStub({ data: Array.from({ length: 1000 }, (_, i) => ({ id: i })), pagination: { totalPages: 1 } });
        await big.repo.fetchKitchenReturns();
        expect(big.calls).toEqual(['/kitchenReturns?page=1&limit=1000&sort=id&order=desc']);
        const short = repoStub({ data: [{ id: 1 }] });
        await short.repo.fetchInventoryTx();
        expect(short.calls).toHaveLength(1);
        const { repo } = repoStub({});
        expect(repo.WALK_PAGES).toBe(8);
    });

    test('صف الإذن: الكمية approvedQty ?? qty — بلا تخمين، والاسم من itemName ثم name', () => {
        const { repo } = repoStub({});
        const full = repo.returnDispatchOption({
            id: 5, deptName: 'كافتيريا', date: '2026-10-15T08:00:00Z',
            approvedItems: [{ itemName: 'طماطم', unit: 'كجم', approvedQty: 0, qty: 9 }],
        });
        expect(full.items).toEqual([{ name: 'طماطم', unit: 'كجم', qty: 0 }]);   // 0 قيمة لا سقوط
        const fallback = repo.returnDispatchOption({
            id: 6, deptCode: 'caf', items: [{ name: 'بصل', qty: '2.5' }],
        });
        expect(fallback).toMatchObject({ id: 6, deptName: 'caf', date: '' });
        expect(fallback.items).toEqual([{ name: 'بصل', unit: '', qty: 2.5 }]);
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

    test('أسماء المخزون: بلا بوابة رصيد — والفراغ يسقط', async () => {
        const { calls, repo } = repoStub({
            data: [{ id: 1, name: 'طماطم', unit: 'كجم', qty: '2.5' }, { id: 2, name: '' }],
        });
        const out = await repo.fetchReturnInventory();
        expect(calls).toEqual(['/inventory?page=1&limit=1000&sort=id&order=desc']);
        expect(out).toEqual([{ id: 1, name: 'طماطم', unit: 'كجم', qty: 2.5 }]);
    });

    test('حمولة الإنشاء: الفرعان كما يرسلهما القديم :1360/:1385 — والصفوف الفارغة تسقط :1356', () => {
        const { repo } = repoStub({});
        const direct = repo.returnCreatePayload({
            deptCode: ' caf ', reason: 'فائض إنتاج', notes: '  قبل ٩  ',
            items: [
                { name: '  طماطم  ', qty: '2.5' },
                { name: 'خيار', qty: 0 },
                { name: '', qty: 3 },
                { name: 'بصل', qty: 'abc' },
                { name: 'جزر', qty: -1 },
            ],
        });
        expect(direct).toEqual({
            reason: 'فائض إنتاج', notes: 'قبل ٩',
            items: [{ name: 'طماطم', qty: 2.5 }], deptCode: 'caf',
        });
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

    test('بابا الكتابة: POST /warehouse/returns وDELETE بالمعرّف مُشفَّرًا', async () => {
        const create = repoStub({});
        const payload = { deptCode: 'caf', reason: 'x', notes: '', items: [{ name: 'طماطم', qty: 2 }] };
        await create.repo.createKitchenReturn(payload);
        expect(create.calls).toEqual(['/warehouse/returns']);
        expect(create.methods).toEqual(['POST']);
        expect(JSON.parse(create.bodies[0].body)).toEqual(payload);

        const del = repoStub({});
        await del.repo.deleteKitchenReturn('7/8');
        expect(del.calls).toEqual(['/warehouse/returns/7%2F8']);
        expect(del.methods).toEqual(['DELETE']);
        expect(del.bodies).toHaveLength(0);   // الحذف بلا حمولة — المعرّف في المسار وحده
    });
});

describe('warehouse-repo — الثوابت مرايا الخادم والقديم بمسافاتهما', () => {
    test('قائمتا الأدوار حرفًا بسطر الخادم :16 وحارس الحذف :1506', () => {
        const { repo } = repoStub({});
        const wr = source(VR);
        const list = (a) => `[${a.map((r) => `'${r}'`).join(', ')}]`;   // مسافات الخادم
        expect(wr).toContain(`const RETURN_ROLES = ${list(repo.RETURN_ROLES)};`);
        expect(repo.RETURN_ROLES).toEqual(['admin', 'manager', 'warehouse', 'kitchen', 'sous_chef', 'dept_head']);
        expect(repo.RETURN_DELETE_ROLES).toEqual(['admin', 'manager', 'warehouse']);
        expect(wr).toContain("router.post('/returns', jwtAuth, requireRole(...RETURN_ROLES)");
        expect(wr).toContain("router.delete('/returns/:id', jwtAuth, requireRole('admin', 'manager', 'warehouse')");
    });

    test('قائمتا الواجهة من القديم :650-651 حرفيًا بمسافاتهما المضغوطة', () => {
        const { repo } = repoStub({});
        const legacy = source(LEGACY);
        expect(legacy).toContain("const canReturn=['admin','manager','warehouse','kitchen','sous_chef','dept_head'].includes(STATE.currentUser?.role);");
        expect(legacy).toContain("const canDelete=['admin','manager','warehouse'].includes(STATE.currentUser?.role);");
        // القائمتان المصدَّرتان تطابقان سطرَي القديم عنصرًا عنصرًا
        expect(repo.RETURN_ROLES.join()).toBe('admin,manager,warehouse,kitchen,sous_chef,dept_head');
        expect(repo.RETURN_DELETE_ROLES.join()).toBe('admin,manager,warehouse');
    });

    test('وضعا الخادم وأسقفُ الرفض — مصدر كلمات الشاشة حين يرد', () => {
        const wr = source(VR);
        // الوضع المباشر: غياب dispatchId يفتح فرع الإرجاع المباشر
        expect(wr).toContain("if (dispatchId === undefined || dispatchId === null || String(dispatchId).trim() === '')");
        // نافذة حالات الإذن المقبول للإرجاع
        expect(wr).toContain("['approved', 'partially_received', 'received']");
        expect(wr).toContain("return fail(res, 409, 'DISPATCH_NOT_APPROVED', 'لا يمكن إرجاع طلب غير معتمد');");
        expect(wr).toContain("return fail(res, 422, 'DEPT_REQUIRED', 'اختر القسم المُرجِع');");
        expect(wr).toContain("return fail(res, 422, 'EMPTY_RETURN_ITEMS', 'يجب تحديد صنف وكمية للإرجاع');");
        expect(wr).toContain('كمية الإرجاع أكبر من الكمية المتبقية للصنف');
        // نجاح الحذف من الخادم :1570 — الشاشة تنطقه بسقوط نص القديم :689
        expect(wr).toContain("res.json({ ok: true, message: 'تم حذف سجل المرتجع وعكس أثره المخزني بالكامل' });");
        expect(source(LEGACY)).toContain("toast('تم حذف سجل المرتجع','success');");
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
            reason: 'فائض إنتاج', totalValue: 40, date: '2026-10-15', status: 'approved',
        });
        const sparse = repo.kitchenReturnToRow({ id: 6, notes: 'ملاحظة' });
        expect(sparse).toMatchObject({ deptName: '—', reason: 'ملاحظة', itemsSummary: '—', itemsCount: 0 });
    });

    test('بوابتا الأزرار بالحدّية — قائمتا الخادم نفساهما بلا توسيع', () => {
        const { repo } = repoStub({});
        for (const r of repo.RETURN_ROLES) {expect(repo.returnCreateVisible(r)).toBe(true);}
        expect(repo.returnCreateVisible('owner')).toBe(false);   // ليست في قائمة الخادم :16
        expect(repo.returnCreateVisible('cashier')).toBe(false);
        expect(repo.returnCreateVisible('')).toBe(false);
        for (const r of repo.RETURN_DELETE_ROLES) {expect(repo.returnDeleteVisible(r)).toBe(true);}
        expect(repo.returnDeleteVisible('kitchen')).toBe(false);
        expect(repo.returnDeleteVisible('sous_chef')).toBe(false);
        expect(repo.returnDeleteVisible('dept_head')).toBe(false);
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

    test('لا معالج سطري إطلاقًا — والادعاء القديم «قراءة فقط» أُزيل', () => {
        const s = src();
        const handlers = s.match(/\son[a-z]+=/g) || [];
        expect(handlers).toHaveLength(0);
        expect(s).not.toMatch(/window\.(prompt|alert)\(/);
        expect(s).not.toMatch(/قراءة فقط|موجة كتابة/);   // الشاشة تكتب الآن — لا ادعاء زائف
        expect(s).toContain('وحذف السجل بعكس أثره المخزني');
        expect(s).toContain("if (returnDeleteVisible(role)) {");
        expect(s).toContain("key: 'actions', header: 'حذف'");
    });

    test('الأبواب الثلاثة عشر كلها مستدعاة: قراءات وحمولة وبابا كتابة', () => {
        // الشطب للاستيراد فقط: الاسم يكفي مرجعًا (rets.map(kitchenReturnToRow)) أو نداءً.
        const s = src().replace(/import[\s\S]*?from '[^']+';/g, '');
        for (const fn of ['fetchKitchenReturns', 'kitchenReturnToRow',
            'returnCreateVisible', 'returnDeleteVisible',
            'fetchReturnDispatches', 'fetchReturnDepartments', 'fetchReturnInventory',
            'directReturnDepartments', 'deptLabelOf', 'returnDeptCodesOf',
            'returnCreatePayload', 'createKitchenReturn', 'deleteKitchenReturn']) {
            expect(s).toMatch(new RegExp(`\\b${fn}\\b`));
        }
    });

    test('الحمولات من دوال البوابة النقية — والحذف بالمعرّف وحده', () => {
        const s = src();
        expect(s).toContain('await createKitchenReturn(returnCreatePayload({ ...target, reason, notes, items }));');
        expect(s).toContain('await deleteKitchenReturn(id);');
    });

    test('كلمات التحقق والتحذير منسوخة من القديم حرفًا', () => {
        const s = src();
        const legacy = legacyOf();
        for (const phrase of [
            'اختر طلب صرف',
            'اختر القسم المُرجِع',
            'أضف صنفًا واحدًا على الأقل',
            'تعذر تنفيذ الإرجاع',
            'تعذر الحذف',
            'تأكيد حذف سجل المرتجع؟ لا يمكن التراجع.',
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
        expect(s).toContain("(res && res.message) || 'تم حذف سجل المرتجع'");
        expect(s).toContain('moneyPlain');
    });

    test('قايمة الأسباب الخمسة من القديم :1270-1274 — والوضعان كما :1256-1257', () => {
        const s = src();
        const legacy = legacyOf();
        expect(s).toContain("const RETURN_REASONS = ['فائض إنتاج', 'تغيير قائمة', 'انتهاء الوردية', 'خطأ في الصرف', 'أخرى'];");
        for (const r of ['فائض إنتاج', 'تغيير قائمة', 'انتهاء الوردية', 'خطأ في الصرف', 'أخرى']) {
            expect(legacy).toContain(`<option value="${r}">${r}</option>`);
        }
        // القديم يقرر الإرجاع المباشر بغياب إذونات approved — الشاشة نفس القرار
        expect(legacy).toContain("const approvedDispatches = STATE.dispatches.filter(d=>d.status==='approved');");
        expect(s).toContain('لا توجد طلبات صرف معتمدة — سيُسجَّل إرجاعًا مباشرًا من القسم إلى المخزن الرئيسي مع عكس مصروف القسم.');
        expect(legacy).toContain('لا توجد طلبات صرف معتمدة — سيُسجَّل إرجاعًا مباشرًا من القسم إلى المخزن الرئيسي مع عكس مصروف القسم.');
        expect(s).toContain("panelData = { mode: 'dispatch', dispatches };");
        expect(s).toContain("panelData = { mode: 'direct', depts: directReturnDepartments(deptRows), inv };");
        // بند الإذن المعتمد بلابل القديم نفسه :1291
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
        expect(s.match(/if \(busy\) \{notify\('جارٍ تنفيذ عملية — انتظر النتيجة'\); return;\}/g)).toHaveLength(3);
        expect(s.match(/^\s+busy = true;/gm)).toHaveLength(2);
        expect(s.match(/^\s+busy = false;/gm)).toHaveLength(2);
        expect(s.match(/panelSeq \+= 1;/g)).toHaveLength(2);   // closePanel + destroy
        expect(s).toMatch(/table\.destroy\(\);/);
        expect(s).toMatch(/el\.remove\(\);/);
        // لا window.confirm في المنطق — واحدة فقط كسقوط احتياطي، والمنطق بـconfirmFn
        expect(src().match(/window\.confirm\(/g)).toHaveLength(1);
        expect(s).toMatch(/await confirmFn\('تأكيد حذف سجل المرتجع؟ لا يمكن التراجع\.'\)/);
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
        expect(s).toMatch(/notify\(\(e && e\.message\) \|\| 'تعذر الحذف'\)/);
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

describe('شاشة 20 — المضيف والطبقة', () => {
    test('المضيف يمرر deptCode الجديد مع الهوية — الركوب على مضيف السجلات المشترك', () => {
        const h = source(HOST);
        expect(h).toMatch(/import \{ mountWhReturnsScreen \} from '\.\/screens\/wh-returns\.js\?v=/);
        expect(h).toMatch(/renderLiveRegisterScreen\(\{ key: 'wh-returns', title: 'مرتجعات المطبخ', mount: mountWhReturnsScreen, assign: \(s\) => \{ whReturnsScreen = s; \} \}\);/);
        expect(h).toMatch(/deptCode: String\(u\.dept_code \|\| ''\),/);
        expect(h).toMatch(/role: session\.role,/);
        expect(h).toMatch(/confirmFn: \(message\) => window\.confirm\(message\),/);
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
        expect(source(HOST)).toContain(`./screens/wh-returns.js?v=${rev}`);
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
        expect(d).toContain('.erp-v2-wh-returns .erp-card__head .erp-btn > span { display: none; }');
        expect(d).toMatch(/min-block-size: var\(--erp-space-8\)/);
        expect(d).toContain('.erp-v2-wh-returns__tools { flex: 1 1 100%; }');
        expect(d).not.toMatch(/\.erp-v2-wh-returns [^,{]*\.erp-input\s*\{[^}]*min-block-size/);
    });

    test('الطباعة تخفي اللوحة وعمود الحذف — ولا تخفي أساس الأرقام', () => {
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
        expect(body).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
        expect(body).not.toMatch(/rgba?\(/);
        expect(body).not.toMatch(/\b\d+(px|rem|em)\b/);
        expect(body).toMatch(/var\(--erp-space-8\)/);
    });
});
