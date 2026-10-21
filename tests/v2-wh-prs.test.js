/**
 * v2-wh-prs.test.js — عقد شاشة 21 (طلبات شراء النواقص) في V2 — دورة الطلب الكاملة W1-3
 * ═══════════════════════════════════════════════════════════════════════
 * نفس أسلوب tests/v2-dispatch.test.js (W1-1) وtests/v2-kitchen.test.js (W1-2):
 * المستودع يُحمَّل في vm وبوابته apiFetch مزيفة، والشاشة تُقرأ كعقد مصدر
 * (testEnvironment:'node') لأن المتصفح لا يُثبته النص.
 *
 * المثبَّت هنا:
 *   • الباب الواحد لشبكة الشاشة: js/v2/data/pr-repo.js — القراءات الثلاث من
 *     سجلها، والدورة السبعة أبواب كتابة منسوخة من سطور الخادم
 *     (warehouse-routes.js:3224/:3294/:3326/:3361/:3393/:3636/:3667)
 *   • ثوابت الأدوار مرايا سطرٍ بسطر بمسافاتها: الستة من الخادم :2997-3006،
 *     وقائمتا الواجهة من prCanCreate/prCanCancel في القديم (kitchen.js:305,:311)
 *   • الاستلام الغائب عمدًا: 410 PR_RECEIVE_RETIRED (:3428) — لا باب في
 *     المستودع ولا زر في الشاشة؛ يوجد في الخادم وحده كحارس
 *   • البوابات نقية ومختبَرة بالحدّية: شيف المعلّق، المدير العام لموقّع الشيف،
 *     إلغاء wider عند الخادم من UI عمدًا (dept_head)، والحذف له انحراف معلن
 *     واحد: يختفي على الحالات الثلاث المحمية بخادمها (:3674) لا اثنتين كالقديم
 *   • كلمات المراحل منسوخة من features/kitchen.js حرفيًا (البنرات :498،
 *     التحقق :528/:567/:600، التأكيدات :622/:315، رسائل النجاح :539-:605)
 *   • التواقيع: لا لوحة موقّعة بلا اسم حساب (البوابة قبل فتح اللوحة)، وكل
 *     لوحة ترسم توقيعها بمعرّفها الثابت، ورفضٌ بلا سببٍ مكتوب لا يقرأ توقيعًا
 *   • الطباعة: النافذة تُفتح في إيماءة النقر قبل الجلب، والورقة A4 منسوخة من
 *     printPR (kitchen.js:638-645) ببنتها الذهبية #c9a227 وأربع خانات توقيع
 *   • الشاشة: لا fetch/apiFetch، ولا معالجات HTML سطرية، حارس
 *     أحدث قراءة + isConnected + busy قرار واحد + destroy() يُتلف الجدول
 *   • status.js: حالات purchase_request:* السبع كلها مسجلة، وكل أيقونة في
 *     السجل المشترك (65 سطرًا في كل النطاقات) موجودة فعلًا في icons.js —
 *     كانت اثنتا عشرة تسقط صامتة إلى circle-help وأُصلحت في W1-3
 *   • الطبقة: كل قيم erp-ops.css رموز --erp-* بلا hex ولا px خام، ووسائط
 *     الشاشة ممتدة داخل آخر كتلتي الوسيط عمدًا (عدد الكتل يبقى 2 و2 — أي
 *     كتلة ثالثة تكسر ضوابط شاشات W1-1/W1-2 التي تقرأ أول/آخر كتلة)
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const APP = path.join(__dirname, '..', 'frontend', 'app');
const V2 = path.join(APP, 'js', 'v2');
const REPO = path.join(V2, 'data', 'pr-repo.js');
const SCREEN = path.join(V2, 'screens', 'wh-prs.js');
const SHARED_STATUS = path.join(V2, 'status.js');
const OPS_CSS = path.join(APP, 'css', 'v2', 'erp-ops.css');
const V2_HTML = path.join(APP, 'v2.html');
const HOST = path.join(V2, 'preview.js');
const ICONS = path.join(APP, 'js', 'icons.js');
const WR = path.join(__dirname, '..', 'backend', 'warehouse-routes.js');
const LEGACY = path.join(APP, 'js', 'features', 'kitchen.js');
// REV مشتق من الوسم الحيّ في v2.html (نفس نمط v2-kitchen/leaves/dispatch) —
// تثبيت يدوي هنا كسر مرّات عند رفع النسخة الموحّدة؛ الاشتقاق يجعل الاختبار معاييرًا.
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

const EXPORTS = ['PR_CREATE_ROLES', 'PR_CANCEL_ROLES', 'PR_CHEF_ROLES', 'PR_GM_ROLES',
    'PR_READ_ROLES', 'PR_CHEF_CREATE_ROLES', 'PR_CANCEL_UI_ROLES',
    'fetchPurchaseRequests', 'fetchShortages', 'fetchPRDepartments', 'fetchPRInventoryNames',
    'fetchPRSettings',
    'createPR', 'chefApprovePR', 'chefRejectPR', 'gmApprovePR', 'gmRejectPR', 'cancelPR', 'deletePR',
    'purchaseRequestToRow', 'summarizePR', 'isChefCreator', 'chefActionsVisible', 'gmActionsVisible',
    'cancelVisible', 'deleteVisible', 'printVisible', 'filterPRDeptOptions',
    'collectPRItems', 'prCreateError', 'prReasonError',
    'prCreatePayload', 'prNotesPayload', 'prRejectPayload'];

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
const stripComments = (s) => s
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

describe('pr-repo — الباب الواحد: قراءات من سجلاتها وسبعة أبواب كتابة', () => {
    test('كل ما تحتاجه الشاشة مُصدَّر', () => {
        const src = source(REPO);
        for (const name of EXPORTS) {
            expect(src).toMatch(new RegExp(`export (async function|function|const) ${name}\\b`));
        }
    });

    test('قراءة الطلبات: مصفوفة عارية أو {data}، وشذوذ ثالث يعني فراغًا', async () => {
        const bare = repoStub([{ id: 1 }, { id: 2 }]);
        expect(await bare.repo.fetchPurchaseRequests()).toHaveLength(2);
        expect(bare.calls).toEqual(['/warehouse/purchase-requests']);
        const wrapped = repoStub({ data: [{ id: 1 }] });
        expect(await wrapped.repo.fetchPurchaseRequests()).toHaveLength(1);
        const weird = repoStub({ error: 'x' });
        expect(await weird.repo.fetchPurchaseRequests()).toEqual([]);
    });

    test('النواقص استشارية: فشل قراءتها لا يكسر الشاشة — مصفوفة فارغة', async () => {
        const ok = repoStub([{ itemId: 5 }]);
        expect(await ok.repo.fetchShortages()).toEqual([{ itemId: 5 }]);
        expect(ok.calls).toEqual(['/warehouse/purchase-requests/shortages']);
        const bad = repoStub(() => { throw new Error('boom'); });
        expect(await bad.repo.fetchShortages()).toEqual([]);
    });

    test('أقسام القسم الطالب: مشيٌ علوي بثلاث صفحات، والاسم يسقط لـname_ar ثم الكود', async () => {
        const full = () => ({
            data: Array.from({ length: 1000 }, () => ({ code: 'x', name: 'x' })),
            pagination: { totalPages: 3 },
        });
        const { calls, repo } = repoStub((p) => (p.includes('page=3')
            ? { data: [{ code: 'K1', name_ar: 'المطبخ', parent_code: 'ops' }], pagination: { totalPages: 3 } }
            : full()));
        const rows = await repo.fetchPRDepartments();
        expect(calls).toHaveLength(3);
        expect(calls[0]).toBe('/departments?page=1&limit=1000&sort=id&order=asc');
        expect(rows[rows.length - 1]).toEqual({ code: 'K1', name: 'المطبخ', parentCode: 'ops' });
        // دفعة قصيرة توقف المشي، وصف بلا اسم يأخذ كوده، وبلا parent_code يبقى ''
        const one = repoStub({ data: [{ code: 'K2' }], pagination: { totalPages: 9 } });
        expect(await one.repo.fetchPRDepartments()).toEqual([{ code: 'K2', name: 'K2', parentCode: '' }]);
        expect(one.calls).toHaveLength(1);
    });

    test('أسماء المخزون للإكمال: خمس صفحات حدًّا أقصى، أسماء فقط، وفشلها لا يعطّل النموذج', async () => {
        const { calls, repo } = repoStub((p) => ({
            data: Array.from({ length: 1000 }, (_, i) => ({ name: p.includes('page=1') && i === 0 ? '' : 'صنف' })),
            pagination: { totalPages: 100 },
        }));
        const names = await repo.fetchPRInventoryNames();
        expect(calls).toHaveLength(5);
        expect(calls[0]).toBe('/inventory?page=1&limit=1000&sort=id&order=asc');
        expect(names).toHaveLength(4999);   // 5 صفحات × 1000 صف، والاسم الفارغ يسقط
        expect(names.every((n) => n === 'صنف')).toBe(true);
        const bad = repoStub(() => { throw new Error('boom'); });
        expect(await bad.repo.fetchPRInventoryNames()).toEqual([]);
    });

    test('إعدادات الطباعة: صفّ السجل الواحد أو الصف العاري', async () => {
        const arr = repoStub([{ name: 'مطاعم', logoB64: 'data:image/png;base64,x' }]);
        expect(await arr.repo.fetchPRSettings())
            .toEqual({ name: 'مطاعم', logoB64: 'data:image/png;base64,x' });
        expect(arr.calls).toEqual(['/settings/main_settings']);
        const one = repoStub({ name: 'مطاعم' });
        expect(await one.repo.fetchPRSettings()).toEqual({ name: 'مطاعم', logoB64: '' });
    });

    test('سبعة أبواب كتابة بمسارات الخادم نفسها، والحذف بلا حمولة، والإلغاء جسمٌ فارغ', async () => {
        const doors = [
            ['createPR', 'POST', '/warehouse/purchase-requests'],
            ['chefApprovePR', 'POST', '/warehouse/purchase-requests/9/chef-approve'],
            ['chefRejectPR', 'POST', '/warehouse/purchase-requests/9/chef-reject'],
            ['gmApprovePR', 'POST', '/warehouse/purchase-requests/9/gm-approve'],
            ['gmRejectPR', 'POST', '/warehouse/purchase-requests/9/gm-reject'],
            ['cancelPR', 'POST', '/warehouse/purchase-requests/9/cancel'],
            ['deletePR', 'DELETE', '/warehouse/purchase-requests/9'],
        ];
        for (const [fn, method, door] of doors) {
            const { calls, bodies, repo } = repoStub({});
            const body = { probe: fn };
            // create يأخذ الحمولة وحدها، delete معرّفًا وحده، والبقية (معرّف، حمولة)
            await (fn === 'deletePR' ? repo[fn](9)
                : fn === 'createPR' ? repo[fn](body)
                    : repo[fn](9, body));
            expect(calls).toEqual([door]);
            if (fn === 'deletePR') {
                expect(bodies).toHaveLength(0);   // حذفٌ بلا حمولة — المعرّف في المسار وحده
            } else {
                expect(bodies[0].method).toBe(method);
                // الإلغاء يرسل {} دائمًا حتى لو مُرّرت حمولة — مرآة القديم :624
                expect(JSON.parse(bodies[0].body)).toEqual(fn === 'cancelPR' ? {} : body);
            }
        }
    });

    test('المعرّف في المسار مُشفَّر — لا مسار يُبنى بمزاج المدخل', async () => {
        const { calls, repo } = repoStub({});
        await repo.chefApprovePR('7/8', {});
        await repo.cancelPR('7/8');
        await repo.deletePR('7/8');
        expect(calls).toEqual([
            '/warehouse/purchase-requests/7%2F8/chef-approve',
            '/warehouse/purchase-requests/7%2F8/cancel',
            '/warehouse/purchase-requests/7%2F8',
        ]);
    });

    test('الاستلام الغائب عمدًا: لا باب في المستودع — والنافذة 410 في الخادم وحده', () => {
        const repo = stripComments(source(REPO));
        expect(repo).not.toContain('warehouse-receive');
        expect(repo).not.toMatch(/\breceivePR\b/);
        const wr = source(WR);
        expect(wr).toContain("router.post('/purchase-requests/:id/warehouse-receive', jwtAuth, requireRole(...PR_WH_ROLES)");
        expect(wr).toContain("return fail(res, 410, 'PR_RECEIVE_RETIRED', 'دورة طلب الشراء تنتهي باعتماد المدير العام — سجّل البضاعة بفاتورة مشتريات');");
    });
});

describe('pr-repo — الثوابت مرايا الخادم والقديم بمسافاتهما', () => {
    test('ثوابت الأدوار الستة حرفًا بسطر الخادم :2997-3006', () => {
        const { repo } = repoStub({});
        const list = (a) => `[${a.map((r) => `'${r}'`).join(', ')}]`;   // مسافات الخادم
        const wr = source(WR);
        expect(wr).toContain(`const PR_CREATE_ROLES = ${list(repo.PR_CREATE_ROLES)};`);
        expect(wr).toContain(`const PR_CANCEL_ROLES = ${list(repo.PR_CANCEL_ROLES)};`);
        expect(wr).toContain(`const PR_CHEF_ROLES = ${list(repo.PR_CHEF_ROLES)};`);
        expect(wr).toContain(`const PR_GM_ROLES = ${list(repo.PR_GM_ROLES)};`);
        expect(wr).toContain(`const PR_READ_ROLES = ${list(repo.PR_READ_ROLES)};`);
        expect(wr).toContain(`const PR_CHEF_CREATE_ROLES = ${list(repo.PR_CHEF_CREATE_ROLES)};`);
    });

    test('المسارات السبعة في الخادم بأدوارها — والقراءتان بأدوار القراءة', () => {
        const wr = source(WR);
        for (const line of [
            "router.get('/purchase-requests/shortages', jwtAuth, requireRole(...PR_READ_ROLES)",
            "router.get('/purchase-requests', jwtAuth, requireRole(...PR_READ_ROLES)",
            "router.post('/purchase-requests', jwtAuth, requireRole(...PR_CREATE_ROLES)",
            "router.post('/purchase-requests/:id/chef-approve', jwtAuth, requireRole(...PR_CHEF_ROLES)",
            "router.post('/purchase-requests/:id/chef-reject', jwtAuth, requireRole(...PR_CHEF_ROLES)",
            "router.post('/purchase-requests/:id/gm-approve', jwtAuth, requireRole(...PR_GM_ROLES)",
            "router.post('/purchase-requests/:id/gm-reject', jwtAuth, requireRole(...PR_GM_ROLES)",
            "router.post('/purchase-requests/:id/cancel', jwtAuth, requireRole(...PR_CANCEL_ROLES)",
            "router.delete('/purchase-requests/:id', jwtAuth, requireRole(...PR_GM_ROLES)",
        ]) {
            expect(wr).toContain(line);
        }
        // سقف السجل 200 كما يعلنه الخادم :3215 — والنافذة تعلنه في الشاشة أيضًا
        expect(wr).toContain('SELECT * FROM purchase_requests ORDER BY created_at DESC LIMIT 200');
    });

    test('قائمة الإلغاء في الواجهة — الخمسة بلا مسافات من prCanCreate/prCanCancel :305,:311، والخادم أوسع عمدًا', () => {
        const { repo } = repoStub({});
        const legacy = source(LEGACY);
        const unspaced = (a) => `[${a.map((r) => `'${r}'`).join(',')}]`;   // مسافات القديم: لا شيء
        expect(legacy).toContain(`${unspaced(repo.PR_CANCEL_UI_ROLES)}.includes(STATE.currentUser?.role)`);
        expect(repo.PR_CANCEL_UI_ROLES).not.toContain('dept_head');
        // dept_head يلغى عند الخادم لطلباته القديمة (:2998) لكنه لا يقرأ الشاشة أصلًا
        expect(repo.PR_CANCEL_ROLES).toContain('dept_head');
    });
});

describe('pr-repo — الصف والملخص والبوابات: شرط الصف كما في القديم :495', () => {
    test('صف الجدول: الرقم أو #المعرّف، والتوقيعات المسجلة، وتاريخ اليوم العشري', () => {
        const { repo } = repoStub({});
        const r = repo.purchaseRequestToRow({
            id: 7, request_number: 'PR-7', status: 'pending', creator_name: 'كريم',
            chef_approved_name: 'شيف', gm_approved_name: '', wh_received_name: 'أمين',
            created_at: '2026-10-15T10:20:30Z', items: [{ itemName: 'أرز', requestedQty: 2 }],
        });
        expect(r).toMatchObject({
            id: 7, number: 'PR-7', status: 'pending', by: 'كريم',
            chefSigned: 'شيف', gmSigned: '', whReceived: 'أمين', created: '2026-10-15', itemsCount: 1,
        });
        const bare = repo.purchaseRequestToRow({ id: 9 });
        expect(bare.number).toBe('#9');
        expect(bare.by).toBe('—');
        expect(repo.purchaseRequestToRow({}).number).toBe('#؟');
    });

    test('WW1-3: استلام المخزن يُقرأ من wh_received_name — العمود الذي في المخطط فعلًا', () => {
        const repo = stripComments(source(REPO));
        expect(repo).toContain('r.wh_received_name');
        expect(repo).not.toContain('received_by_name');   // شذوذ النسخة السابقة أُصلح
        const { repo: r } = repoStub({});
        expect(r.purchaseRequestToRow({ wh_received_name: 'أمين' }).whReceived).toBe('أمين');
    });

    test('ملخص الأصناف: الأولان ثم +N — وسطر واحد لا JSON', () => {
        const { repo } = repoStub({});
        const one = repo.purchaseRequestToRow({ items: [{ name: 'أرز', qty: 2 }] });
        expect(one.itemsText).toBe('أرز (2)');
        const three = repo.purchaseRequestToRow({
            items: [{ itemName: 'أرز', qty: 2 }, { itemName: 'سكر', requestedQty: 3 }, { itemName: 'شاي', qty: 1 }],
        });
        expect(three.itemsText).toBe('أرز (2)، سكر (3) +1');
        expect(repo.purchaseRequestToRow({}).itemsText).toBe('—');
    });

    test('عدّ حالة الملخص مشتق من الصفوف لا من طلب ثانٍ', () => {
        const { repo } = repoStub({});
        expect(repo.summarizePR([
            { status: 'pending' }, { status: 'pending' }, { status: 'chef_approved' },
            { status: 'approved' }, { status: 'cancelled' }, { status: '' },
        ])).toEqual({ total: 6, pending: 2, chefApproved: 1, approved: 1, rejected: 0, cancelled: 1 });
    });

    test('زرّا الشيف للمعلّق فقط ولمن يملك الدور — :495 prCanChef', () => {
        const { repo } = repoStub({});
        for (const r of repo.PR_CHEF_ROLES) {expect(repo.chefActionsVisible(r, 'pending')).toBe(true);}
        expect(repo.chefActionsVisible('warehouse', 'pending')).toBe(false);
        expect(repo.chefActionsVisible('admin', 'chef_approved')).toBe(false);
        expect(repo.chefActionsVisible('admin', 'approved')).toBe(false);
        expect(repo.isChefCreator('kitchen')).toBe(true);
        expect(repo.isChefCreator('sous_chef')).toBe(true);
        expect(repo.isChefCreator('admin')).toBe(false);
    });

    test('زرّا المدير العام للموقّع من الشيف فقط — :495 prCanGM', () => {
        const { repo } = repoStub({});
        for (const r of repo.PR_GM_ROLES) {expect(repo.gmActionsVisible(r, 'chef_approved')).toBe(true);}
        expect(repo.gmActionsVisible('admin', 'pending')).toBe(false);
        expect(repo.gmActionsVisible('kitchen', 'chef_approved')).toBe(false);
        expect(repo.gmActionsVisible('admin', 'approved')).toBe(false);
    });

    test('الإلغاء: معلّقٌ بأدوار الإنشاء الخمسة أو موقّع الشيف — والخمسة نفسها (بلا dept_head)', () => {
        const { repo } = repoStub({});
        for (const r of repo.PR_CREATE_ROLES) {expect(repo.cancelVisible(r, 'pending')).toBe(true);}
        for (const r of repo.PR_CANCEL_UI_ROLES) {expect(repo.cancelVisible(r, 'chef_approved')).toBe(true);}
        expect(repo.cancelVisible('dept_head', 'pending')).toBe(false);        // يلغى عند الخادم لا هنا
        expect(repo.cancelVisible('dept_head', 'chef_approved')).toBe(false);
        expect(repo.cancelVisible('admin', 'approved')).toBe(false);
        expect(repo.cancelVisible('admin', 'rejected')).toBe(false);
    });

    test('الحذف: المدير العام وحده، والحالات الثلاث المحمية بخادمها لا تُعرض لها زرًّا', () => {
        const { repo } = repoStub({});
        for (const r of repo.PR_GM_ROLES) {
            expect(repo.deleteVisible(r, 'pending')).toBe(true);
            expect(repo.deleteVisible(r, 'chef_approved')).toBe(true);
            expect(repo.deleteVisible(r, 'rejected')).toBe(true);
            expect(repo.deleteVisible(r, 'cancelled')).toBe(true);
        }
        // الانحراف المعلن: القديم يخفي اثنتين (:495) والثالثة يرجمها الخادم (:3676)
        for (const st of ['approved', 'partially_fulfilled', 'fulfilled']) {
            expect(repo.deleteVisible('admin', st)).toBe(false);
        }
        expect(repo.deleteVisible('warehouse', 'pending')).toBe(false);
        expect(repo.deleteVisible('kitchen', 'rejected')).toBe(false);
        // ورسالة الخادم نفسها هي الدليل على الانحراف
        expect(source(WR)).toContain("لا يجوز حذف طلب معتمد أو مستلم (ولو جزئيًا) — له أثر مخزني");
    });

    test('الطباعة على قائمة القديم الأربعة حرفيًا — partially_fulfilled ليست منها', () => {
        const { repo } = repoStub({});
        // القائمة في الدالة وحدها — لا ثابت مصدَّر يُخفيها في الخارج
        expect(source(REPO)).toContain("return ['approved', 'chef_approved', 'pending', 'fulfilled'].includes(status);");
        for (const st of ['approved', 'chef_approved', 'pending', 'fulfilled']) {
            expect(repo.printVisible(st)).toBe(true);
        }
        for (const st of ['partially_fulfilled', 'rejected', 'cancelled', '']) {
            expect(repo.printVisible(st)).toBe(false);
        }
        const legacy = source(LEGACY);
        expect(legacy).toContain("['approved','chef_approved','pending','fulfilled'].includes(r.status)");
        expect(legacy).toContain("prCanDelete()&&!['approved','fulfilled'].includes(r.status)");
        expect(legacy).toContain("r.status==='pending'&&prCanCreate()||r.status==='chef_approved'&&prCanCancel()");
    });

    test('مرشح أقسام القسم الطالب — شرط القديم :504 حرفيًا', () => {
        const { repo } = repoStub({});
        const rows = [
            { code: 'K1', parentCode: '' }, { code: 'ys_1', parentCode: '' },
            { code: 'kitchen', parentCode: '' }, { code: 'external_sales', parentCode: '' },
            { code: 'K2', parentCode: 'kitchen' }, { code: 'OPS', parentCode: 'ops' },
        ];
        expect(repo.filterPRDeptOptions(rows).map((d) => d.code)).toEqual(['K1', 'OPS']);
        const legacy = source(LEGACY);
        expect(legacy).toContain("!String(d.code||'').startsWith('ys_') && d.code !== 'kitchen' && d.code !== 'external_sales' && d.parent_code !== 'kitchen'");
    });
});

describe('pr-repo — الأصناف والحمولات: حقول القديم حرفًا', () => {
    test('أصناف الإنشاء: النواقص المختارة ثم اليدوية — وغير الصالح يسقط', () => {
        const { repo } = repoStub({});
        const items = repo.collectPRItems(
            [
                { itemId: '7', itemName: 'أرز', unit: ' كجم ', qty: '5' },
                { itemId: '8', itemName: 'سكر', unit: '', qty: '0' },
                { itemId: '9', itemName: 'شاي', unit: 'علبة', qty: '-2' },
                { itemId: '', itemName: 'ملح', unit: 'كجم', qty: 'abc' },
            ],
            [
                { name: '  طماطم  ', unit: '', qty: '3' },
                { name: '', unit: 'كجم', qty: '4' },
                { name: 'خيار', unit: 'كجم', qty: '0' },
            ],
        );
        expect(items).toEqual([
            { itemId: 7, itemName: 'أرز', unit: 'كجم', requestedQty: 5 },
            { itemName: 'طماطم', unit: 'وحدة', requestedQty: 3 },
        ]);
        expect(items[1]).not.toHaveProperty('itemId');   // الصف اليدوي كما في القديم :526
    });

    test('كلمة الإنشاء الفارغ من القديم :528 نفسها', () => {
        const { repo } = repoStub({});
        expect(repo.prCreateError([])).toBe('اختر صنفًا واحدًا على الأقل بكمية موجبة');
        expect(repo.prCreateError([{ itemName: 'أرز' }])).toBe('');
        expect(source(LEGACY)).toContain("toast('اختر صنفًا واحدًا على الأقل بكمية موجبة','error')");
    });

    test('حدّ السبب ثلاثة أحرف — نفس كلمة القديم :567/:600 وكلمة الخادم :3330/:3397', () => {
        const { repo } = repoStub({});
        expect(repo.prReasonError('ab')).toBe('سبب الرفض مطلوب (3 أحرف على الأقل)');
        expect(repo.prReasonError('  ab  ')).toBe('سبب الرفض مطلوب (3 أحرف على الأقل)');
        expect(repo.prReasonError('abc')).toBe('');
        expect(repo.prReasonError('  abc  ')).toBe('');
        expect(repo.prReasonError('')).toBe('سبب الرفض مطلوب (3 أحرف على الأقل)');
        const legacy = source(LEGACY);
        expect(legacy).toContain("toast('سبب الرفض مطلوب (3 أحرف على الأقل)','error')");
        expect(source(WR)).toContain("return fail(res, 422, 'PR_REASON_REQUIRED', 'سبب الرفض مطلوب (3 أحرف على الأقل)');");
    });

    test('حمولة الإنشاء: حقول القديم :537 بتوقيع الشيف وحده — وإلا null كما ترسل', () => {
        const { repo } = repoStub({});
        expect(repo.prCreatePayload({
            items: [{ itemName: 'أرز' }], notes: '  أولوية  ', deptCode: 'K1',
            signatureData: 'data:image/png;base64,x', signerName: 'شيف',
        })).toEqual({
            items: [{ itemName: 'أرز' }], notes: 'أولوية', deptCode: 'K1',
            signatureData: 'data:image/png;base64,x', signerName: 'شيف',
        });
        expect(repo.prCreatePayload({}))
            .toEqual({ items: [], notes: '', deptCode: '', signatureData: null, signerName: null });
        expect(repo.prCreatePayload({ deptCode: 5 }).deptCode).toBe('5');
    });

    test('حمولتا الملاحظات والرفض — كما في :554/:586 و:571/:604', () => {
        const { repo } = repoStub({});
        expect(repo.prNotesPayload('  ملاحظة  ', 'sig', 'شيف'))
            .toEqual({ notes: 'ملاحظة', signatureData: 'sig', signerName: 'شيف' });
        expect(repo.prRejectPayload('  سبب الرفض  ', 'sig', 'مدير'))
            .toEqual({ reason: 'سبب الرفض', signatureData: 'sig', signerName: 'مدير' });
    });
});

describe('شاشة 21 — العقد المصدَّر من المصدر', () => {
    const src = () => source(SCREEN);

    test('لا شبكة من الشاشة: الباب الواحد فقط، ولا fetch ولا apiFetch', () => {
        const s = stripComments(src());
        expect(s).not.toMatch(/\bapiFetch\b/);
        expect(s).not.toMatch(/\bfetch\(/);
        expect(s).toMatch(/from '\.\.\/data\/pr-repo\.js\?v=/);
        expect(s).not.toMatch(/['"`]\/warehouse/);
        expect(s).not.toMatch(/\/purchase-requests/);
        expect(s).not.toMatch(/warehouse-receive|receivePR|receiveDispatch/);
    });

    test('تستخدم ورقة الطباعة مستمعات أحداث بدل المعالجات السطرية', () => {
        const s = src();
        const handlers = s.match(/<[a-z][^>]*\son[a-z]+\s*=/gi) || [];
        expect(handlers).toEqual([]);
        expect(s).toContain('data-v2-print');
        expect(s).toContain('data-v2-close');
        expect(s).toContain("querySelector('[data-v2-print]')?.addEventListener");
        expect(s).toContain("querySelector('[data-v2-close]')?.addEventListener");
        expect(s).not.toMatch(/window\.(prompt|alert)\(/);
        const note = s.slice(s.indexOf('async function printNote'), s.indexOf('/* ── القراءة والرسم'));
        expect(note).toContain('data-v2-print');
        expect(note).toContain('data-v2-close');
    });

    test('الكتابات السبعة من أبوابها: كل اسم باب مستدعى في الشاشة', () => {
        const s = src();
        for (const fn of ['createPR', 'chefApprovePR', 'chefRejectPR', 'gmApprovePR', 'gmRejectPR',
            'cancelPR', 'deletePR']) {
            expect(s).toMatch(new RegExp(`\\b${fn}\\(`));
        }
        expect(s).not.toMatch(/\breceivePR\b/);
    });

    test('حمولات القرار منسوخة من القديم حرفًا — والتوقيع شرطُ إنشاء الشيف وحده', () => {
        const s = src();
        expect(s).toContain('await createPR(prCreatePayload({');
        expect(s).toContain('items, notes, deptCode,');
        expect(s).toContain('signatureData: chef ? sig : null,');
        expect(s).toContain('signerName: chef ? signerName : null,');
        expect(s).toContain('await chefApprovePR(raw.id, prNotesPayload(notes, sig, signerName));');
        expect(s).toContain('await chefRejectPR(raw.id, prRejectPayload(reason, sig, signerName));');
        expect(s).toContain('await gmApprovePR(raw.id, prNotesPayload(notes, sig, signerName));');
        expect(s).toContain('await gmRejectPR(raw.id, prRejectPayload(reason, sig, signerName));');
        expect(s).toContain('await cancelPR(raw.id);');
        expect(s).toContain('await deletePR(raw.id);');
        // رسالة نجاح المطبخ من القديم :539 حرفًا (نهائي لدى المخزن مباشرة — حسم الخادم)
        expect(s).toContain('saved.request_number} موقّعًا منك — نهائي ولدى المخزن مباشرة');
        expect(s).toContain('saved.request_number} — بانتظار توقيع الشيف');
        expect(source(LEGACY)).toContain('موقّعًا منك — نهائي ولدى المخزن مباشرة');
    });

    test('لا قرار موقّع بلا اسم حساب: البوابة قبل فتح اللوحة، وكل لوحة بقفلها', () => {
        const s = src();
        expect(s).toMatch(/SIGN_KINDS = new Set\(\['chef-approve', 'chef-reject', 'gm-approve', 'gm-reject'\]\)/);
        expect(s).toMatch(/SIGN_KINDS\.has\(kind\) \|\| \(kind === 'create' && isChefCreator\(role\)\)/);
        expect(s).toMatch(/if \(requiresSignature\(kind\) && !signerName\)/);
        expect(s).toContain('اسم حسابك غير متاح في الجلسة — أعد تسجيل الدخول لتنفيذ قرار موقّع');
        expect(s).toMatch(/readSignaturePad\(panelEl, id, signerName\)/);
        for (const id of ['v2pr-create-sig', 'v2pr-chef-approve-sig', 'v2pr-chef-reject-sig',
            'v2pr-gm-approve-sig', 'v2pr-gm-reject-sig']) {
            expect(s).toContain(id);
        }
        expect(s.match(/signaturePadMarkup\(SIG_IDS\./g)).toHaveLength(5);
        expect(s.match(/initSignaturePad\(panelEl, SIG_IDS\./g)).toHaveLength(5);
        expect(s.match(/readSig\(SIG_IDS\./g)).toHaveLength(5);
        // وبوابة الاسم قبل بوابة الدور في الترتيب نفسه
        const open = s.slice(s.indexOf('async function openPanel'), s.indexOf('/* ── إلغاء وحذف'));
        expect(open.indexOf('requiresSignature(kind) && !signerName')).toBeLessThan(open.indexOf("if (kind === 'create' && !PR_CREATE_ROLES.includes(role))"));
    });

    test('الرفض بلا سبب مكتوب لا يخرج — قبل قراءة التوقيع', () => {
        const s = src();
        const chef = s.slice(s.indexOf('async function submitChefReject'), s.indexOf('async function submitGmApprove'));
        expect(chef.indexOf('prReasonError(reason)')).toBeGreaterThan(-1);
        expect(chef.indexOf('prReasonError(reason)')).toBeLessThan(chef.indexOf('readSig(SIG_IDS.chefReject)'));
        const gm = s.slice(s.indexOf('async function submitGmReject'), s.indexOf('function submitPanel'));
        expect(gm.indexOf('prReasonError(reason)')).toBeGreaterThan(-1);
        expect(gm.indexOf('prReasonError(reason)')).toBeLessThan(gm.indexOf('readSig(SIG_IDS.gmReject)'));
    });

    test('بوابات الأدوار في openPanel بكلمات القديم — والقرار النهائي للخادم', () => {
        const s = src();
        expect(s).toContain("if (kind === 'create' && !PR_CREATE_ROLES.includes(role)) {");
        expect(s).toContain('إنشاء طلبات الشراء للمطبخ (الشيف) والمخزن والإدارة فقط');
        expect(source(LEGACY)).toContain("toast('إنشاء طلبات الشراء للمطبخ (الشيف) والمخزن والإدارة فقط','error')");
        expect(s).toMatch(/chefActionsVisible\(role, raw && raw\.status\)/);
        expect(s).toMatch(/gmActionsVisible\(role, raw && raw\.status\)/);
        // زر الإنشاء نفسه لا يُرسم إلا لأصحاب الدور (لا زر يرفضه الخادم حتمًا)
        expect(s).toMatch(/template\(PR_CREATE_ROLES\.includes\(role\)\)/);
    });

    test('حراس القراءة والقرار: أحدث قراءة تفوز، لا رسم بعد الانفصال، قرار واحد في المرة', () => {
        const s = src();
        expect(s).toMatch(/if \(loading\) \{return;\}/);
        expect(s).toMatch(/const seq = \+\+readSeq;/);
        expect(s.match(/if \(!el\.isConnected \|\| seq !== readSeq\) \{return;\}/g)).toHaveLength(2);
        expect(s).toMatch(/const panelAlive = \(seq\) => el\.isConnected && seq === panelSeq;/);
        expect(s.match(/if \(busy\) \{notify\('جارٍ تنفيذ عملية — انتظر النتيجة'\); return;\}/g)).toHaveLength(4);
        expect(s.match(/^\s+busy = true;/gm)).toHaveLength(7);
        expect(s.match(/^\s+busy = false;/gm)).toHaveLength(7);
        expect(s.match(/disposeSignaturePads\(ALL_SIG_IDS\);/g)).toHaveLength(2);
        expect(s).toMatch(/table\.destroy\(\);/);
        expect(s).toMatch(/el\.remove\(\);/);
        // والاستدعاء الوحيد لـwindow.confirm في fallback المضيف — الشاشة تعمل بـconfirmFn فقط
        expect(s.match(/window\.confirm\(/g)).toHaveLength(1);
    });

    test('الأخطاء من ردّ الخادم كما ترد، وثلاث قراءات مسمّاة', () => {
        const s = src();
        expect(s).toContain("'انتهت الجلسة — سجّل الدخول في النظام الحالي ثم أعد فتح الوضع الحيّ.'");
        expect(s).toMatch(/e\.code === 'FORBIDDEN'/);
        expect(s).toContain('لا صلاحية لعرض طلبات النواقص بهذا الحساب — القرار للخادم وحده.');
        expect(s).toMatch(/تعذّر تحميل الطلبات: \$\{\(e && e\.message\) \|\| 'خطأ'\}/);
        expect(s).toMatch(/panelMsg\(\(e && e\.message\) \|\| 'تعذر إنشاء طلب الشراء'\)/);
        expect(s).toMatch(/panelMsg\(\(e && e\.message\) \|\| 'تعذر توقيع الشيف'\)/);
        expect(s).toMatch(/panelMsg\(\(e && e\.message\) \|\| 'تعذر رفض الطلب'\)/);
        expect(s).toMatch(/panelMsg\(\(e && e\.message\) \|\| 'تعذر اعتماد المدير العام'\)/);
        expect(s).toMatch(/notify\(\(e && e\.message\) \|\| 'تعذر إلغاء الطلب'\)/);
        expect(s).toMatch(/notify\(\(e && e\.message\) \|\| 'تعذر حذف الطلب'\)/);
    });

    test('التأكيدات ورسائل النجاح من القديم حرفًا', () => {
        const s = src();
        const legacy = source(LEGACY);
        expect(s).toContain("await confirmFn('إلغاء طلب الشراء المعلّق؟')");
        expect(s).toContain("await confirmFn('حذف نهائي لهذا الطلب؟ لا يمكن التراجع.')");
        for (const [t, word] of [
            ['أُلغي طلب الشراء', "toast('أُلغي طلب الشراء','info')"],
            ['حُذف الطلب نهائيًا', "toast('حُذف الطلب نهائيًا','info')"],
            ['وقّع الشيف — الطلب الآن بانتظار المدير العام', "toast('وقّع الشيف — الطلب الآن بانتظار المدير العام','success')"],
            ['رفض الشيف الطلب', "toast('رفض الشيف الطلب','warning')"],
            ['اعتمد المدير العام الطلب نهائيًا', "toast('اعتمد المدير العام الطلب نهائيًا','success')"],
            ['رفض المدير العام الطلب', "toast('رفض المدير العام الطلب','warning')"],
        ]) {
            expect(s).toContain(t);
            expect(legacy).toContain(word);
        }
    });

    test('الأزرار صفٌ بصف من البوابات — لا شرط مخترع في الشاشة', () => {
        const s = src();
        const actions = s.slice(s.indexOf('function rowActionsHtml'), s.indexOf('/* ── اللوحة'));
        for (const gate of ['chefActionsVisible(role, raw.status)', 'gmActionsVisible(role, raw.status)',
            'cancelVisible(role, raw.status)', 'deleteVisible(role, raw.status)', 'printVisible(raw.status)']) {
            expect(actions).toContain(gate);
        }
        // ترتيب القديم :495 نفسه: عرض ← شيف ← مدير ← إلغاء ← حذف ← طباعة
        const order = ['view', 'chef-approve', 'chef-reject', 'gm-approve', 'gm-reject', 'cancel', 'delete', 'print'];
        const found = [...actions.matchAll(/btn\('([a-z-]+)'/g)].map((m) => m[1]);
        expect(found).toEqual(order);
    });

    test('التفاصيل بالسلسلة: أربع محطات وخامسة للرفض — وأعمدة القديم :636', () => {
        const s = src();
        const details = s.slice(s.indexOf('function detailsHtml'), s.indexOf('/* ── فتح اللوحة'));
        const legacy = source(LEGACY);
        for (const phrase of ['أنشأ', 'وقّع الشيف', 'بانتظار توقيع الشيف.', 'اعتمد المدير العام',
            'اعتمادًا نهائيًا', 'بانتظار اعتماد المدير العام.', 'استلم المخزن', 'مرفوض بواسطة']) {
            expect(details).toContain(phrase);
            expect(legacy).toContain(phrase);
        }
        for (const head of ['الصنف', 'الوحدة', 'المطلوب', 'الرصيد وقت الإنشاء']) {
            expect(details).toContain(head);
            expect(legacy).toContain(head);
        }
        for (const mode of ['تسليم مباشر (مصروف فوري)', 'تسليم مختلط', 'دخول مخزن']) {
            expect(s).toContain(mode);
            expect(legacy).toContain(mode);
        }
        expect(s).toContain("statusBadge('purchase_request', raw.status)");
        expect(s).toMatch(/const st = resolveStatus\('purchase_request', s\);/);
        expect(s.match(/statusBadge\('purchase_request'/g)).toHaveLength(2);
    });

    test('لوحة الإنشاء: نواقص مختارة افتراضًا بعجزها المقترح وصفوفٌ يدوية وقسم طالب', () => {
        const s = src();
        expect(s).toContain('data-pr-sel data-idx="${idx}" checked');
        expect(s).toContain('value="${Number(s.suggestedQty || 0)}"');
        expect(s).toContain('data-m="unit" value="وحدة"');
        expect(s).toContain("const deptOptions = filterPRDeptOptions(depts).map(");
        expect(s).toContain("${i === 0 ? ' selected' : ''}");
        expect(s).toContain('v2pr-inv-names');   // قائمة إكمال الأسماء الاستشارية
        // لوحة الفشل تعيد المحاولة بلا فقدان النوع
        expect(s).toContain("retryState = { kind: 'create', raw: null };");
        expect(s).toMatch(/if \(retryState\) \{openPanel\(retryState\.kind, retryState\.raw\);\}/);
    });

    test('سقف السجل 200 معلن في الشاشة من مصدره الخادمي', () => {
        const s = src();
        expect(s).toContain('const PR_LIST_CAP = 200;');
        expect(s).toContain('warehouse-routes.js:3215');
        expect(s).toMatch(/capNoteEl\.hidden = !\(rawRows\.length >= PR_LIST_CAP\);/);
    });

    test('الطباعة: العارض الداخلي يُفتح مباشرة قبل الجلب، والورقة ورقة القديم', () => {
        const s = src();
        const note = s.slice(s.indexOf('async function printNote'), s.indexOf('/* ── القراءة والرسم'));
        expect(note.indexOf('openInAppReport(')).toBeGreaterThan(-1);
        expect(note.indexOf('openInAppReport(')).toBeLessThan(note.indexOf('await ensureSettings()'));
        expect(note).toContain('جارٍ تجهيز طلب الشراء…');
        expect(note).toContain('طلب شراء نواقص — ');
        expect(note).toContain('#c9a227');
        expect(note).toContain('A4');
        expect(note).toContain('print-color-adjust');
        expect(note).toContain('........');
        for (const label of ['توقيع أمين المخزن', 'توقيع الشيف', 'اعتماد المدير العام', 'استلام المخزن']) {
            expect(note).toContain(label);
            expect(source(LEGACY)).toContain(label);
        }
        expect(note).toMatch(/statusLabelOf\(raw\.status\)/);
        // الاسم والشعار يُجلبان مرة واحدة في الملف كله — إعداداتٌ كسولة الباب الواحد
        expect(s.match(/await ensureSettings\(\)/g)).toHaveLength(1);
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

describe('شاشة 21 — السجل المشترك والمضيف والطبقة', () => {
    test('حالات purchase_request السبع مسجلة، وكل أيقونة في السجل المشترك موجودة فعلًا', () => {
        const st = source(SHARED_STATUS);
        const icons = source(ICONS);
        for (const k of ['pending', 'chef_approved', 'approved', 'partially_fulfilled', 'fulfilled', 'rejected', 'cancelled']) {
            expect(st).toContain(`'purchase_request:${k}':`);
        }
        // كلمة «معلّق» من خريطة القديم :483 حرفًا (بقية التسميات قرار موجة القراءة)
        expect(source(LEGACY)).toContain("pending:'بانتظار الشيف'");
        expect(st).toMatch(/'purchase_request:pending':\s*\{ label: 'بانتظار الشيف'/);
        const prIcons = [...st.matchAll(/'purchase_request:[a-z_]+':\s*\{ label: '[^']*',\s*tone: '[a-z]+',\s*icon: '([a-z0-9-]+)'/g)];
        expect(prIcons).toHaveLength(7);
        for (const m of prIcons) {expect(icons).toContain(`'${m[1]}':`);}
    });

    test('WW1-3: كل أيقونات السجل المشترك (65 سطرًا) موجودة في icons.js — لا سقوطٌ صامت', () => {
        const st = source(SHARED_STATUS);
        const icons = source(ICONS);
        const all = [...st.matchAll(/icon: '([a-z0-9-]+)'/g)].map((m) => m[1]);
        expect(all.length).toBeGreaterThan(40);
        for (const n of all) {expect(icons).toContain(`'${n}':`);}
        // الأسماء الاثنا عشر التي كانت تسقط صامتة إلى circle-help لا تعود
        expect(st).not.toMatch(/icon: '(pen-line|package-check|file-pen|book-check|book-x|pause-circle|wifi-off|lock-open|circle-half|triangle-alert|loader|reply)'/);
    });

    test('المضيف يمرر الهوية كاملة ويطبع الإشعارات على سطره', () => {
        const h = source(HOST);
        expect(h).toMatch(/import \{ mountWhPrsScreen \} from '\.\/screens\/wh-prs\.js\?v=/);
        expect(h).toMatch(/renderLiveRegisterScreen\(\{ key: 'wh-prs', title: 'طلبات شراء النواقص', mount: mountWhPrsScreen, assign: \(s\) => \{ whPrsScreen = s; \} \}\);/);
        expect(h).toMatch(/const u = session\.user \|\| \{\};/);
        expect(h).toMatch(/userName: String\(u\.name \|\| u\.username \|\| ''\),/);
        expect(h).toMatch(/notify: notifyTo\(note\),/);
        expect(h).toMatch(/confirmFn: \(message\) => window\.confirm\(message\),/);
        expect(h).toMatch(/if \(navStatus\.current !== key\) \{return;\}/);
    });

    test('المغادرة تُتلف الشاشة — لا شبح يكتب على DOM بعد التنقّل', () => {
        const h = source(HOST);
        expect(h).toMatch(/if \(whPrsScreen\) \{ whPrsScreen\.destroy\(\); whPrsScreen = null; \}/);
        expect(h).toMatch(/teardownWhPrsScreen\(\);/);
    });

    test('الشاشة تُستورد بمراجعة الصفحة نفسها وتُركّب على مضيفها', () => {
        const rev = source(V2_HTML).match(/js\/v2\/preview\.js\?v=([0-9.]+)/)[1];
        expect(source(HOST)).toContain(`./screens/wh-prs.js?v=${rev}`);
        expect(source(V2_HTML)).toContain(`js/v2/preview.js?v=${rev}`);
        expect(source(V2_HTML)).toContain(`css/v2/erp-ops.css?v=${rev}`);
    });

    test('الطبقة: قواعد الأساس كلها رموز، وألوان السياق الستة بحصر الشاشة', () => {
        const css = source(OPS_CSS);
        expect(css).toContain('.erp-v2-wh-prs .erp-card__head { flex-wrap: wrap; }');
        for (const sel of ['.erp-v2-wh-prs .erp-v2-wh-prs__scroll {',
            '.erp-v2-wh-prs .erp-pr-line {',
            '.erp-v2-wh-prs .erp-pr-line__row {',
            '.erp-v2-wh-prs .erp-manual-row {',
            '.erp-v2-wh-prs .erp-signature {',
            '.erp-v2-wh-prs td.erp-v2-wh-prs-actions {',
            '.erp-v2-wh-prs .fw-bold {']) {
            expect(css).toContain(sel);
        }
        for (const tone of ['info', 'warning', 'danger', 'success', 'brand', 'neutral']) {
            expect(css).toContain(`.erp-v2-wh-prs .erp-flow-note[data-tone="${tone}"]`);
        }
        expect(css).toContain('@supports not (color-mix(in srgb, red 10%, transparent))');
        expect(css).toMatch(/\.erp-v2-wh-prs \.erp-signature canvas \{[\s\S]*?background: white;/);
        // الأساس كله بعد آخر وسيط والوسائط لا تعود بعده — الإلحاق في آخر كتلة أعلاه
        const tail = css.slice(css.indexOf('.erp-v2-wh-prs .erp-card__head { flex-wrap: wrap; }'));
        expect(tail).not.toMatch(/@media/);
    });

    test('٦٤٠px: أزرار ٤٠ والأسماء تختفي والأدوات تنزل — والحقول لا تُرفع', () => {
        const blocks = source(OPS_CSS).match(/@media \(max-width: 640px\)[\s\S]*?\n\}/g);
        expect(blocks).toHaveLength(2);   // كتلتان فقط — كتلة ثالثة تكسر ضوابط W1-1/W1-2
        const d = blocks[blocks.length - 1];
        expect(d).toContain('.erp-v2-wh-prs .erp-card__head .erp-btn > span { display: none; }');
        expect(d).toMatch(/min-block-size: var\(--erp-space-8\)/);
        expect(d).toContain('.erp-v2-wh-prs__tools { flex: 1 1 100%; }');
        expect(d).toContain('.erp-v2-wh-prs .erp-seg { flex-wrap: wrap; }');
        expect(d).not.toMatch(/\.erp-v2-wh-prs \.erp-input\s*\{[^}]*min-block-size/);
    });

    test('الطباعة تخفي اللوحة وعمود الإجراءات — ولا تخفي أساس الأرقام', () => {
        const prints = source(OPS_CSS).match(/@media print\s*\{[\s\S]*?\n\}/g);
        expect(prints).toHaveLength(2);   // كتلتان فقط، والممتدة آخر كتلة عمدًا
        const p = prints[prints.length - 1];
        expect(p).toContain('.erp-v2-wh-prs [data-v2-panel] { display: none; }');
        expect(p).toContain('.erp-v2-wh-prs [data-col="actions"],');
        expect(p).toContain('.erp-v2-wh-prs td.erp-v2-wh-prs-actions { display: none; }');
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
