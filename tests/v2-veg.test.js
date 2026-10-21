/**
 * v2-veg.test.js — عقد شاشة 14 (طلبات شراء الخضار) في V2 — دورة الخضار الكاملة W1-4
 * ═══════════════════════════════════════════════════════════════════════
 * نفس أسلوب tests/v2-wh-prs.test.js (W1-3): المستودع يُحمَّل في vm وبوابته
 * apiFetch مزيفة، والشاشة تُقرأ كعقد مصدر (testEnvironment:'node') لأن
 * المتصفح لا يُثبته النص.
 *
 * المثبَّت هنا:
 *   • الباب الواحد لشبكة الشاشة: js/v2/data/veg-repo.js — القراءات الثلاث
 *     وستة أبواب كتابة منسوخة من سطور الخادم (veg-requests-routes.js
 *     :102/:110/:154/:199/:320/:391/:444/:476)
 *   • ثوابت الأدوار مرايا سطرٍ بسطر بمسافاته: الخمسة من الخادم :25-27
 *     و:320 و:390، وقوائم الواجهة من vegCanCreate/vegCanPrice/vegIsBoss
 *     في القديم (features/veg-requests.js:18-20)
 *   • الانحرافات المعلنة ثلاثة، كلها بلا زر يرفضه الخادم حتمًا: زر التعديل
 *     لما سيقبله الخادم فعلًا (admin/owner أو المنشئ — الميدل وير :391
 *     يقصي البقية)، والتسعير على قايمة القديم الضيقة لا قائمة الخادم :320
 *     (manager)، وترميز معرّف كل مسار كتابة
 *   • لا توقيع إلكتروني في هذه الدورة — الأبواب لا تقرأ signatureData،
 *     وتوقيع الورقة خطّي كما في vegBuildPrintHtml :669-670
 *   • كلمات اللوحات والحمولات منسوخة من features/veg-requests.js حرفيًا
 *     (التحقق :257، التأكيد :404، الأسعار :420/:423/:488، رسائل النجاح
 *     :265/:429/:492/:541/:550)، وwindow.prompt القديم :546 صار حقلًا
 *   • الطباعة: النافذة تُفتح في إيماءة النقر قبل الجلب، والعدّاد يُطلق ولا
 *     يُنتظر (:576)، والورقة A4 من vegBuildPrintHtml :582-680 ببنتها
 *     الذهبية #c9a227 وتوقيعَي الشيف وأمين المخزن
 *   • الشاشة: لا fetch/apiFetch، لا معالج سطري إلا زرا ورقة الطباعة، حارس
 *     أحدث قراءة + isConnected + busy قرار واحد + destroy() يُتلف الجدول
 *   • status.js: حالات veg_request الأربع مسجلة بأيقونات موجودة فعلًا في
 *     icons.js — الثلاث الجديدة (received/priced/cancelled) بكلمات شارة
 *     القديم :28-32
 *   • الطبقة: كل قيم erp-ops.css رموز --erp-* بلا hex ولا px خام، ووسائط
 *     الشاشة ممتدة داخل آخر كتلتي الوسيط عمدًا (عدد الكتل يبقى 2 و2 — أي
 *     كتلة ثالثة تكسر ضوابط شاشات W1-1/W1-2 التي تقرأ أول/آخر كتلة)
 */
const fs = require('fs');
const path = require('path');
const { ruleBody, hidesLabel, withoutSrOnly } = require('./helpers/css-contract');
const vm = require('vm');

const APP = path.join(__dirname, '..', 'frontend', 'app');
const V2 = path.join(APP, 'js', 'v2');
const REPO = path.join(V2, 'data', 'veg-repo.js');
const SCREEN = path.join(V2, 'screens', 'veg-requests.js');
const SHARED_STATUS = path.join(V2, 'status.js');
const OPS_CSS = path.join(APP, 'css', 'v2', 'erp-ops.css');
const V2_HTML = path.join(APP, 'v2.html');
const HOST = path.join(V2, 'preview.js');
const ICONS = path.join(APP, 'js', 'icons.js');
const VR = path.join(__dirname, '..', 'backend', 'veg-requests-routes.js');
const LEGACY = path.join(APP, 'js', 'features', 'veg-requests.js');
// REV مشتق من الوسم الحيّ في v2.html (نفس نمط v2-kitchen/wh-prs) —
// الاشتقاق يجعل الاختبار معاييرًا لا تثبيتًا يدويًا.
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

const EXPORTS = ['VEG_CREATE_ROLES', 'VEG_READ_ROLES', 'VEG_RECEIVE_ROLES',
    'VEG_PRICE_ROLES', 'VEG_EDIT_ROLES',
    'VEG_UI_CREATE_ROLES', 'VEG_UI_PRICE_ROLES', 'VEG_UI_BOSS_ROLES', 'VEG_STATUS_FILTERS',
    'fetchVegRequests', 'fetchVegCatalog', 'fetchVegRequestById',
    'createVegRequest', 'receiveVegRequest', 'priceVegRequest', 'editVegItems',
    'cancelVegRequest', 'markVegPrinted',
    'vegRequestToRow', 'vegItemsOf', 'collectVegItems',
    'vegCreatePayload', 'vegReceivePayload', 'vegEditPayload',
    'vegCreateVisible', 'vegReceiveVisible', 'vegPriceVisible', 'vegEditVisible', 'vegCancelVisible'];

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
const legacyOf = () => source(LEGACY);
const stripComments = (s) => s
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

describe('veg-repo — الباب الواحد: ثلاث قراءات وستة أبواب كتابة', () => {
    test('كل ما تحتاجه الشاشة مُصدَّر', () => {
        const src = source(REPO);
        for (const name of EXPORTS) {
            expect(src).toMatch(new RegExp(`export (async function|function|const) ${name}\\b`));
        }
    });

    test('قراءة الطلبات: الفلتر الخادمي المعلن، والحد يقصر عند 200، والشذوذ فراغ آمن', async () => {
        const full = repoStub((_p) => ({ requests: [{ id: 1 }], summary: { pending: 2 } }));
        const res = await full.repo.fetchVegRequests({ status: 'pending', limit: 999 });
        expect(full.calls).toEqual(['/veg-requests?status=pending&limit=200']);
        expect(res.rows).toEqual([{ id: 1 }]);
        expect(res.summary).toEqual({ pending: 2 });
        const def = repoStub({ requests: [] });
        await def.repo.fetchVegRequests();
        expect(def.calls).toEqual(['/veg-requests?limit=60']);
        // كلٌّ: لا يرسل حالة أصلًا — الخادم يقبل pending|received|cancelled فقط :160
        const all = repoStub({ requests: [] });
        await all.repo.fetchVegRequests({ status: 'all' });
        expect(all.calls).toEqual(['/veg-requests?limit=60']);
        const weird = repoStub(null);
        expect(await weird.repo.fetchVegRequests()).toEqual({ rows: [], summary: {}});
        const badSummary = repoStub({ requests: 'x', summary: 'y' });
        expect(await badSummary.repo.fetchVegRequests()).toEqual({ rows: [], summary: {}});
    });

    test('الكتالوج من الخادم — والفراغ لا يُملأ بأصناف مخترعة', async () => {
        const ok = repoStub({ categories: [{ key: 'leafy', label: 'ورقيات', items: [] }], units: ['كجم', 'ربطة'] });
        const cat = await ok.repo.fetchVegCatalog();
        expect(ok.calls).toEqual(['/veg-requests/catalog']);
        expect(cat.categories).toHaveLength(1);
        expect(cat.units).toEqual(['كجم', 'ربطة']);
        const empty = repoStub({});
        expect(await empty.repo.fetchVegCatalog()).toEqual({ categories: [], units: ['كجم'] });
    });

    test('صف الطباعة: قايمة 200 ثم إيجاد بالمعرّف — مشي القديم :573 نفسه', async () => {
        const { calls, repo } = repoStub({ requests: [{ id: 1 }, { id: 9, request_no: 'VR-1' }] });
        expect(await repo.fetchVegRequestById('9')).toEqual({ id: 9, request_no: 'VR-1' });
        expect(calls).toEqual(['/veg-requests?limit=200']);
        const miss = repoStub({ requests: [{ id: 1 }] });
        expect(await miss.repo.fetchVegRequestById(9)).toBeNull();
        const bad = repoStub(null);
        expect(await bad.repo.fetchVegRequestById(9)).toBeNull();
    });

    test('ستة أبواب كتابة بمسارات الخادم نفسها وحمولاتها — والعدّاد بلا حمولة', async () => {
        const create = repoStub({});
        const payload = { items: [{ name: 'طماطم', qty: 2 }], notes: 'x', priority: 'urgent' };
        await create.repo.createVegRequest(payload);
        expect(create.calls).toEqual(['/veg-requests']);
        expect(create.bodies[0].method).toBe('POST');
        expect(JSON.parse(create.bodies[0].body)).toEqual(payload);

        const recv = repoStub({});
        const rbody = { rejections: [], quantities: [{ name: 'طماطم', receivedQty: 2 }] };
        await recv.repo.receiveVegRequest(9, rbody);
        expect(recv.calls).toEqual(['/veg-requests/9/receive']);
        expect(recv.bodies[0].method).toBe('POST');
        expect(JSON.parse(recv.bodies[0].body)).toEqual(rbody);

        const price = repoStub({});
        const prices = [{ name: 'طماطم', unitPrice: 5 }];
        await price.repo.priceVegRequest(9, prices);
        expect(price.calls).toEqual(['/veg-requests/9/price']);
        expect(price.bodies[0].method).toBe('POST');
        expect(JSON.parse(price.bodies[0].body)).toEqual({ prices });   // غلاف {prices} كما يقرأ :333

        const edit = repoStub({});
        const items = [{ name: 'طماطم', qty: 3, unit: 'كجم' }];
        await edit.repo.editVegItems(9, items);
        expect(edit.calls).toEqual(['/veg-requests/9/items']);
        expect(edit.bodies[0].method).toBe('PUT');
        expect(JSON.parse(edit.bodies[0].body)).toEqual({ items });

        const canc = repoStub({});
        await canc.repo.cancelVegRequest(9, 'سبب');
        expect(canc.calls).toEqual(['/veg-requests/9/cancel']);
        expect(JSON.parse(canc.bodies[0].body)).toEqual({ reason: 'سبب' });

        const prn = repoStub({});
        await prn.repo.markVegPrinted(9);
        expect(prn.calls).toEqual(['/veg-requests/9/printed']);
        expect(prn.bodies).toHaveLength(0);   // عدّاد بلا حمولة — معرّفه في المسار وحده
    });

    test('المعرّف في المسار مُشفَّر في كل أبواب الكتابة — انتظامٌ فوق القديم', async () => {
        const { calls, repo } = repoStub({});
        await repo.receiveVegRequest('7/8', {});
        await repo.priceVegRequest('7/8', []);
        await repo.editVegItems('7/8', []);
        await repo.cancelVegRequest('7/8', '');
        await repo.markVegPrinted('7/8');
        expect(calls).toEqual([
            '/veg-requests/7%2F8/receive',
            '/veg-requests/7%2F8/price',
            '/veg-requests/7%2F8/items',
            '/veg-requests/7%2F8/cancel',
            '/veg-requests/7%2F8/printed',
        ]);
    });
});

describe('veg-repo — الثوابت مرايا الخادم والقديم بمسافاتهما', () => {
    test('ثوابت الأدوار الخمسة حرفًا بسطور الخادم :25-27 و:320 و:390', () => {
        const { repo } = repoStub({});
        const wr = source(VR);
        const list = (a) => `[${a.map((r) => `'${r}'`).join(', ')}]`;   // مسافات الخادم
        expect(wr).toContain(`const CREATE_ROLES = ${list(repo.VEG_CREATE_ROLES)};`);
        expect(wr).toContain(`const RECEIVE_ROLES = ${list(repo.VEG_RECEIVE_ROLES)};`);
        expect(wr).toContain(`const EDIT_ROLES = ${list(repo.VEG_EDIT_ROLES)};`);
        // القراء = الإنشاء + warehouse، بلا تكرار حرفي
        expect(wr).toContain("const READ_ROLES = [...CREATE_ROLES, 'warehouse'];");
        expect(repo.VEG_READ_ROLES).toEqual([...repo.VEG_CREATE_ROLES, 'warehouse']);
        // التسعير قائمة مستقلة في مسار :320 — معطيات spread بلا أقواس
        expect(wr).toContain(`requireRole(${repo.VEG_PRICE_ROLES.map((r) => `'${r}'`).join(', ')})`);
    });

    test('المسارات الثمانية في الخادم بأدوارها — والاستلام ببوابته المسمّاة :196', () => {
        const wr = source(VR);
        for (const line of [
            "router.get('/catalog', jwtAuth, requireRole(...READ_ROLES)",
            "router.post('/', jwtAuth, requireRole(...CREATE_ROLES)",
            "router.get('/', jwtAuth, requireRole(...READ_ROLES)",
            "router.post('/:id/receive', ...receiveGate",
            "router.post('/:id/price', jwtAuth, requireRole('warehouse', 'admin', 'owner', 'manager')",
            "router.put('/:id/items', jwtAuth, requireRole(...EDIT_ROLES)",
            "router.post('/:id/cancel', jwtAuth, requireRole(...READ_ROLES)",
            "router.post('/:id/printed', jwtAuth, requireRole(...READ_ROLES)",
        ]) {
            expect(wr).toContain(line);
        }
        // بوابة الاستلام المسمّاة — كلمتها تصل الشاشة حرفًا
        expect(wr).toContain("return res.status(403).json({ ok: false, error: 'FORBIDDEN', message: 'الاستلام والتوقيع للسو شيف فقط' });");
        // الحالات المخزنة والحراسة المزدوجة داخل المعالجات
        expect(wr).toContain("CHECK (status IN ('pending','received','priced','cancelled'))");
        expect(wr).toContain("'التسعير بعد استلام رئيس القسم — الطلب حالته ' + row.status");
        expect(wr).toContain("WHERE id = $1 AND status = 'pending'");      // الاستلام لا يتقدم مرتين
        expect(wr).toContain("WHERE id = $1 AND status = 'received' RETURNING *");   // التسعير بعد استلام
    });

    test('قوائم الواجهة من القديم :18-20 حرفيًا — والضيقة تبقى ضيقة والخادم أوسع معلنًا', () => {
        const { repo } = repoStub({});
        const legacy = source(LEGACY);
        expect(legacy).toContain("function vegCanCreate() { return ['sous_chef', 'admin', 'owner'].includes(STATE.currentUser?.role); }");
        expect(legacy).toContain("function vegCanPrice() { return ['warehouse', 'admin', 'owner'].includes(STATE.currentUser?.role); }");
        expect(legacy).toContain("function vegIsBoss() { return ['admin', 'owner'].includes(STATE.currentUser?.role); }");
        expect(repo.VEG_UI_CREATE_ROLES).toEqual(['sous_chef', 'admin', 'owner']);
        expect(repo.VEG_UI_PRICE_ROLES).toEqual(['warehouse', 'admin', 'owner']);
        expect(repo.VEG_UI_BOSS_ROLES).toEqual(['admin', 'owner']);
        // manager يسعّر عند الخادم :320 ولا زر له في الواجهة — لا زر أوسع من القديم
        expect(repo.VEG_PRICE_ROLES).toContain('manager');
        expect(repo.VEG_UI_PRICE_ROLES).not.toContain('manager');
    });
});

describe('veg-repo — الصف والمحوّلات والبوابات', () => {
    test('صف الجدول: الرقم أو #المعرّف، والعاجل، والمنشئ البديل', () => {
        const { repo } = repoStub({});
        const r = repo.vegRequestToRow({
            id: 7, request_no: 'VR-7', items_count: '3', priority: 'urgent', status: 'pending',
            total: '12.5', created_by_name: 'كريم', created_at: '2026-10-15T10:20:30Z',
            received_by_name: 'أمين', notes: 'ملاحظة',
        });
        expect(r).toMatchObject({
            id: 7, number: 'VR-7', numberResolved: true, itemsCount: 3, priority: 'urgent',
            urgent: true, status: 'pending', total: 12.5, by: 'كريم',
            created: '2026-10-15', receivedBy: 'أمين', notes: 'ملاحظة',
        });
        const bare = repo.vegRequestToRow({ id: 9 });
        expect(bare.number).toBe('#9');
        expect(bare.numberResolved).toBe(false);
        expect(bare.by).toBe('—');
        expect(bare.urgent).toBe(false);
        expect(repo.vegRequestToRow({}).number).toBe('#؟');
        expect(repo.vegRequestToRow({ id: 3, created_by: 15 }).by).toBe('#15');
    });

    test('أصناف الصف الخام: مصفوفة أو JSON نصّي أو فراغ آمن', () => {
        const { repo } = repoStub({});
        expect(repo.vegItemsOf({ items: [{ name: 'x' }] })).toEqual([{ name: 'x' }]);
        expect(repo.vegItemsOf({ items: '[{"name":"طماطم","qty":2}]' }))
            .toEqual([{ name: 'طماطم', qty: 2 }]);
        expect(repo.vegItemsOf({ items: 'ليس JSON' })).toEqual([]);
        expect(repo.vegItemsOf({})).toEqual([]);
    });

    test('أصناف الإنشاء: الكتالوج بكمية موجبة فقط ثم الصفوف الحرة — شرط القديم :224-248', () => {
        const { repo } = repoStub({});
        const items = repo.collectVegItems(
            [
                { name: 'طماطم', qty: '5', unit: 'كجم' },
                { name: 'خيار', qty: '0', unit: 'كجم' },
                { name: 'بصل', qty: '-2', unit: 'كجم' },
                { name: 'جزر', qty: 'abc', unit: 'كجم' },
                { name: 'فلفل', qty: '2', unit: '' },
            ],
            [
                { name: '  كزبرة  ', qty: '3', unit: '', note: '  طازة  ' },
                { name: '', qty: '4' },
                { name: 'شبت', qty: '0' },
            ],
        );
        expect(items).toEqual([
            { name: 'طماطم', qty: 5, unit: 'كجم' },
            { name: 'فلفل', qty: 2, unit: 'وحدة' },
            { name: 'كزبرة', qty: 3, unit: 'وحدة', note: 'طازة' },
        ]);
        expect(items[0]).not.toHaveProperty('note');   // الكتالوج بلا حقل note — حقول القديم الثلاثة
    });

    test('حمولة الإنشاء: الأولوية تطبيع والملاحظات قصّ — حقول القديم :260-262', () => {
        const { repo } = repoStub({});
        expect(repo.vegCreatePayload({ items: [{ name: 'طماطم' }], notes: '  قبل ٩  ', priority: 'urgent' }))
            .toEqual({ items: [{ name: 'طماطم' }], notes: 'قبل ٩', priority: 'urgent' });
        expect(repo.vegCreatePayload({})).toEqual({ items: [], notes: '', priority: 'normal' });
        expect(repo.vegCreatePayload({ priority: 'weird' }).priority).toBe('normal');
    });

    test('حمولة الاستلام: الأسعار فقط مع اعتماد مباشر كامل — شرط القديم :423-426', () => {
        const { repo } = repoStub({});
        const quantities = [{ name: 'طماطم', receivedQty: 2 }];
        const prices = [{ name: 'طماطم', unitPrice: 5 }];
        const plain = repo.vegReceivePayload({ rejections: [], quantities, prices, direct: false });
        expect(plain).toEqual({ rejections: [], quantities });
        expect(plain).not.toHaveProperty('prices');
        const direct = repo.vegReceivePayload({ rejections: [], quantities, prices, direct: true });
        expect(direct).toEqual({ rejections: [], quantities, prices });
        const emptyDirect = repo.vegReceivePayload({ rejections: [], quantities, prices: [], direct: true });
        expect(emptyDirect).not.toHaveProperty('prices');   // direct بلا أسعار = استلام عادي
    });

    test('حمولة التعديل: name/qty/unit لكل صنف قائم — كما في القديم :530-535', () => {
        const { repo } = repoStub({});
        expect(repo.vegEditPayload([{ name: 'طماطم', qty: '4.5', unit: 'كجم' }]))
            .toEqual([{ name: 'طماطم', qty: 4.5, unit: 'كجم' }]);
        expect(repo.vegEditPayload([])).toEqual([]);
    });

    test('بوابات الأزرار بالحدّية — والاستلام لتوقيع السو شيف وحده كما يرد الخادم', () => {
        const { repo } = repoStub({});
        for (const r of repo.VEG_UI_CREATE_ROLES) {expect(repo.vegCreateVisible(r)).toBe(true);}
        expect(repo.vegCreateVisible('warehouse')).toBe(false);
        expect(repo.vegCreateVisible('')).toBe(false);

        for (const r of repo.VEG_RECEIVE_ROLES) {expect(repo.vegReceiveVisible(r, 'pending')).toBe(true);}
        expect(repo.vegReceiveVisible('warehouse', 'pending')).toBe(false);
        expect(repo.vegReceiveVisible('sous_chef', 'received')).toBe(false);
        // قايمة القديم vegCanReceive :22-25 تطابق RECEIVE_ROLES الخادمية حرفيًا
        const legacy = source(LEGACY);
        expect(legacy).toContain("if (['admin', 'owner'].includes(me.role)) {return true;}");
        expect(legacy).toContain("return me.role === 'sous_chef';");

        for (const r of repo.VEG_UI_PRICE_ROLES) {expect(repo.vegPriceVisible(r, 'received')).toBe(true);}
        expect(repo.vegPriceVisible('warehouse', 'pending')).toBe(false);
        expect(repo.vegPriceVisible('manager', 'received')).toBe(false);   // الضيق عمدًا مقابل :320
    });

    test('التعديل والإلغاء: pending + (admin/owner أو صاحب الطلب) — وانحراف التعديل معلن', () => {
        const { repo } = repoStub({});
        const raw = { id: 4, status: 'pending', created_by: 15 };
        expect(repo.vegEditVisible('admin', 'pending', raw, 99)).toBe(true);
        expect(repo.vegEditVisible('owner', 'pending', raw, 99)).toBe(true);
        expect(repo.vegEditVisible('sous_chef', 'pending', raw, 15)).toBe(true);
        expect(repo.vegEditVisible('sous_chef', 'pending', raw, 99)).toBe(false);
        expect(repo.vegEditVisible('sous_chef', 'pending', raw, null)).toBe(false);
        expect(repo.vegEditVisible('warehouse', 'pending', raw, 15)).toBe(false);   // الميدل وير :391 يقصيه قبل فحص المنشئ
        expect(repo.vegEditVisible('dept_head', 'pending', raw, 15)).toBe(false);   // الانحراف: القديم يعرض :511
        expect(repo.vegEditVisible('admin', 'received', raw, 99)).toBe(false);

        expect(repo.vegCancelVisible('admin', 'pending', raw, 99)).toBe(true);
        expect(repo.vegCancelVisible('sous_chef', 'pending', raw, 15)).toBe(true);
        expect(repo.vegCancelVisible('sous_chef', 'pending', raw, 99)).toBe(false);
        expect(repo.vegCancelVisible('admin', 'received', raw, 15)).toBe(false);

        // دليل الانحراف من المصدرين: القديم سبعة أدوار :511 والخادم يقبل الإدارة أو المنشئ فقط
        expect(legacyOf()).toContain("['warehouse', 'admin', 'owner', 'manager', 'kitchen', 'sous_chef', 'dept_head'].includes(role)");
        expect(source(VR)).toContain("return res.status(403).json({ ok: false, error: 'FORBIDDEN', message: 'التعديل لرئيس القسم أو صاحب الطلب فقط' });");
        expect(source(VR)).toContain("return res.status(403).json({ ok: false, error: 'FORBIDDEN', message: 'إلغاء الطلب متاح لصاحبه أو للإدارة فقط' });");
        // شرط الإلغاء في القديم :340 نفسه
        expect(legacyOf()).toContain("const canCancel = r.status === 'pending' && (mine || vegIsBoss());");
    });
});

describe('شاشة 14 — العقد المصدَّر من المصدر', () => {
    const src = () => source(SCREEN);

    test('لا شبكة من الشاشة: الباب الواحد فقط، ولا fetch ولا apiFetch', () => {
        const s = stripComments(src());
        expect(s).not.toMatch(/\bapiFetch\b/);
        expect(s).not.toMatch(/\bfetch\(/);
        expect(s).toMatch(/from '\.\.\/data\/veg-repo\.js\?v=/);
        expect(s).not.toMatch(/['"`]\/veg-requests/);
        expect(s).not.toMatch(/['"`]\/api\//);
    });

    test('تستخدم ورقة الطباعة مستمعات أحداث — وwindow.prompt القديم صار حقلًا', () => {
        const s = src();
        const handlers = s.match(/<[a-z][^>]*\son[a-z]+\s*=/gi) || [];
        expect(handlers).toEqual([]);
        expect(s).toContain('data-v2-print');
        expect(s).toContain('data-v2-close');
        expect(s).toContain("querySelector('[data-v2-print]')?.addEventListener");
        expect(s).toContain("querySelector('[data-v2-close]')?.addEventListener");
        expect(s).not.toMatch(/window\.(prompt|alert)\(/);
        // القديم كان يسأل :546 — V2 يقرأ السبب من لوحة الإلغاء نفسها
        expect(legacyOf()).toContain("window.prompt('سبب الإلغاء (اختياري):')");
        expect(s).toContain('data-v2-cancel-reason');
        expect(s).toContain('سبب الإلغاء (اختياري):');
    });

    test('لا توقيع إلكتروني في دورة الخضار — توقيع الورقة خطّي وحده', () => {
        const s = src();
        expect(s).not.toMatch(/signaturePad|readSig|signatureData/);
        expect(s).toContain('ولا توقيع في هذه الدورة');
        expect(stripComments(source(VR))).not.toMatch(/signatureData/);
    });

    test('الأبواب التسعة كلها مستدعاة: ثلاث قراءات وست كتابات', () => {
        const s = src();
        for (const fn of ['fetchVegRequests', 'fetchVegCatalog', 'fetchVegRequestById',
            'createVegRequest', 'receiveVegRequest', 'priceVegRequest', 'editVegItems',
            'cancelVegRequest', 'markVegPrinted']) {
            expect(s).toMatch(new RegExp(`\\b${fn}\\(`));
        }
    });

    test('الحمولات من دوال البوابة النقية — والعدّاد يُطلق ولا يُنتظر', () => {
        const s = src();
        expect(s).toContain('await createVegRequest(vegCreatePayload({ items, notes, priority }));');
        expect(s).toContain('await receiveVegRequest(id, vegReceivePayload({ rejections, quantities, prices, direct }));');
        expect(s).toContain('await priceVegRequest(panelRaw.id, prices);');
        expect(s).toContain('await editVegItems(panelRaw.id, vegEditPayload(rows));');
        expect(s).toContain('await cancelVegRequest(panelRaw.id, reason);');
        expect(s).toMatch(/markVegPrinted\(raw\.id\)\.catch\(\(\) => \{\}\);/);   // مشي القديم :576
        // والقديم نفسه يشهد للعدّاد الذي لا يُنتظر
        expect(legacyOf()).toContain("apiFetch(`/veg-requests/${id}/printed`, { method: 'POST' }).catch(() => {});");
    });

    test('كلمات التحقق والتأكيد منسوخة من القديم حرفًا', () => {
        const s = src();
        const legacy = legacyOf();
        for (const phrase of [
            'اكتب كمية صنف واحد على الأقل قبل الإرسال',
            'رفض كل الأصناف؟ الطلب سيُستلم بلا أي صنف ولا يُسعَّر.',
            'سعّر كل الأصناف المقبولة أو اترك الأسعار فارغة للاستلام فقط',
            'سعر غير سليم للصنف ${nm}',
            'سعّر كل الأصناف المقبولة (صفر أو أكثر) قبل التأكيد',
        ]) {
            expect(s).toContain(phrase);
            expect(legacy).toContain(phrase);
        }
    });

    test('رسائل النجاح منسوخة من القديم — والعملة من الإعدادات لا مثبتة', () => {
        const s = src();
        const legacy = legacyOf();
        for (const phrase of [
            "تم إرسال الطلب ${(res && res.request && res.request.request_no) || ''} للمخازن ✔",
            'تم الاستلام والاعتماد المباشر ✔ — الإجمالي ${moneyPlain(res && res.total || 0)}',
            'تم الاستلام — ${rejections.length} صنف مرفوض لن يُسعَّر',
            'تم استلام كل الأصناف ✔ (الحساب على الكميات السليمة)',
            'تم التسعير: ${moneyPlain(res && res.total || 0)} — حُمّلت مصروف على قسم المطبخ (مصروف #',
        ]) {
            expect(s).toContain(phrase);
        }
        // القديم يثبّت « ر.س » في نصوصه — V2 قرأ الوحدة من الإعدادات
        for (const phrase of ['للمخازن ✔', 'تم الاستلام والاعتماد المباشر ✔ — الإجمالي',
            'تم الاستلام — ${rejections.length} صنف مرفوض لن يُسعَّر',
            'تم استلام كل الأصناف ✔ (الحساب على الكميات السليمة)',
            '— حُمّلت مصروف على قسم المطبخ (مصروف #']) {
            expect(legacy).toContain(phrase);
        }
        expect(legacy).toContain(' ر.س ');
        expect(s).toContain('تم تعديل الكميات');
        expect(legacy).toContain("toast('تم تعديل الكميات','success')");
        expect(s).toContain('تم إلغاء الطلب');
        expect(legacy).toContain("toast('تم إلغاء الطلب', 'info')");
        expect(s).toContain('moneyPlain');
    });

    test('بوابات openPanel بكلماتها — والبوابة قبل أي حالة، والقرار النهائي للخادم', () => {
        const s = src();
        expect(s).toContain("if (!vegCreateVisible(role)) {notify('إنشاء طلبات الخضار للسو شيف والإدارة فقط'); return;}");
        expect(s).toContain("if (!vegReceiveVisible(role, st)) {notify('الاستلام والتوقيع للسو شيف فقط'); return;}");
        expect(s).toContain("if (!vegPriceVisible(role, st)) {notify('التسعير للمخزن والإدارة فقط'); return;}");
        expect(s).toContain("if (!vegEditVisible(role, st, raw, userId)) {notify('التعديل لصاحب الطلب أو الإدارة فقط'); return;}");
        expect(s).toContain("if (!vegCancelVisible(role, st, raw, userId)) {notify('الإلغاء لصاحب الطلب أو الإدارة فقط'); return;}");
        // كلمة الاستلام من الخادم :196 نفسها
        expect(source(VR)).toContain('الاستلام والتوقيع للسو شيف فقط');
        // البوابة تُحسم قبل أي تغيير حالة — لا لوحة عالقة بحالة مرفوضة
        const open = s.slice(s.indexOf('function openPanel'), s.indexOf('const seq = ++panelSeq;'));
        expect(open).not.toContain('panelKind =');
        // زر الإنشاء نفسه لا يُرسم إلا لأصحاب الدور
        expect(s).toMatch(/template\(vegCreateVisible\(role\)\)/);
    });

    test('أزرار الصف من بواباتها بترتيب القديم :357-364 — طباعة ← استلام ← سعر ← تعديل ← إلغاء', () => {
        const s = src();
        const actions = s.slice(s.indexOf('function rowActionsHtml'), s.indexOf('/* ── اللوحة'));
        for (const gate of ['vegReceiveVisible(role, st)', 'vegPriceVisible(role, st)',
            'vegEditVisible(role, st, raw, userId)', 'vegCancelVisible(role, st, raw, userId)']) {
            expect(actions).toContain(gate);
        }
        const found = [...actions.matchAll(/btn\('([a-z-]+)'/g)].map((m) => m[1]);
        expect(found).toEqual(['print', 'receive', 'price', 'edit', 'cancel']);
        const legacy = legacyOf();
        for (const label of ['استلام / إرجاع', 'تعديل الكميات', 'إلغاء', 'طباعة']) {
            expect(legacy).toContain(label);
            expect(s).toContain(label);
        }
    });

    test('حراس القراءة والقرار: أحدث قراءة تفوز، لا رسم بعد الانفصال، قرار واحد في المرة', () => {
        const s = src();
        expect(s.match(/if \(loading\) \{return;\}/g)).toHaveLength(1);
        expect(s.match(/const seq = \+\+readSeq;/g)).toHaveLength(1);
        expect(s.match(/if \(!el\.isConnected \|\| seq !== readSeq\) \{return;\}/g)).toHaveLength(2);
        expect(s).toMatch(/const panelAlive = \(seq\) => el\.isConnected && seq === panelSeq;/);
        expect(s.match(/if \(busy\) \{notify\('جارٍ تنفيذ عملية — انتظر النتيجة'\); return;\}/g)).toHaveLength(6);
        expect(s.match(/^\s+busy = true;/gm)).toHaveLength(5);
        expect(s.match(/^\s+busy = false;/gm)).toHaveLength(5);
        expect(s.match(/panelSeq \+= 1;/g)).toHaveLength(2);   // closePanel + destroy
        expect(s).toMatch(/table\.destroy\(\);/);
        expect(s).toMatch(/el\.remove\(\);/);
        // والاستدعاء الوحيد لـwindow.confirm في fallback المضيف — الشاشة تعمل بـconfirmFn
        expect(s.match(/window\.confirm\(/g)).toHaveLength(1);
        expect(s).toMatch(/await confirmFn\('رفض كل الأصناف؟ الطلب سيُستلم بلا أي صنف ولا يُسعَّر\.'\)/);
    });

    test('الأخطاء من ردّ الخادم كما ترد، وثلاث قراءات مسمّاة', () => {
        const s = src();
        expect(s).toContain('انتهت الجلسة — سجّل الدخول في النظام الحالي ثم أعد فتح الوضع الحيّ.');
        expect(s).toMatch(/e\.code === 'FORBIDDEN'/);
        expect(s).toContain('لا صلاحية لعرض طلبات الخضار بهذا الحساب — القرار للخادم وحده.');
        expect(s).toMatch(/تعذّر تحميل الطلبات: \$\{\(e && e\.message\) \|\| 'خطأ'\}/);
        expect(s).toMatch(/panelMsg\(\(e && e\.message\) \|\| 'فشل إرسال الطلب'\)/);
        expect(s).toMatch(/panelMsg\(\(e && e\.message\) \|\| 'فشل تسجيل الاستلام'\)/);
        expect(s).toMatch(/panelMsg\(\(e && e\.message\) \|\| 'فشل التسعير'\)/);
        expect(s).toMatch(/panelMsg\(\(e && e\.message\) \|\| 'تعذر التعديل'\)/);
        expect(s).toMatch(/panelMsg\(\(e && e\.message\) \|\| 'فشل الإلغاء'\)/);
        expect(s).toMatch(/تعذر تجهيز اللوحة: \$\{\(e && e\.message\) \|\| 'خطأ في القراءة'\}/);
        // لوحة التفاصيل قراءة فقط — لا زر إرسال فيها
        const details = s.slice(s.indexOf('function detailsHtml'), s.indexOf('/* ── لوحة الاستلام'));
        expect(details).not.toContain('data-v2-submit');
    });

    test('لوحات الدورة: شرائح التفاصيل وحقول الاستلام/التسعير/التعديل بكلمات القديم', () => {
        const s = src();
        const legacy = legacyOf();
        for (const phrase of ['حدد مستلَمًا أو مُرجَعًا لكل صنف', 'لو جزء تالف',
            'سعر كل الأصناف المقبولة', 'المرفوض لا يرجع للمخزن للتسعير ولا يُحمَّل مصروفًا',
            'تأكيد الاستلام']) {
            expect(s).toContain(phrase);
            expect(legacy).toContain(phrase);
        }
        for (const phrase of ['استلمها', 'سعّرها', 'ألغاها', 'طُبع', 'مرة']) {
            expect(s).toContain(phrase);
            expect(legacy).toContain(phrase);
        }
        expect(s).toContain('data-rejected');
        expect(legacy).toContain('text-decoration:line-through;opacity:.65');
        // التسعير: المقبول فقط يُسعَّر والمرفوض يُسمّى
        expect(s).toContain('الإجمالي (المقبول فقط)');
        expect(s).toContain('تأكيد التسعير');
        expect(s).toContain('مرفوض، لا يُسعَّر ولا يُحمَّل');
        expect(s).toContain('data-v2-line=');
        expect(s).toContain('data-v2-total');
        // التعديل: أرقام الأصناف القائمة فقط — إضافة الأصناف مرفوضة بطلب جديد
        expect(s).toContain('data-v2-edit-qty');
        expect(s).toContain('إضافة أصناف جديدة مرفوضة — طلب جديد لها');
    });

    test('الطباعة: العارض الداخلي يُفتح مباشرة قبل الجلب، والورقة ورقة القديم بحرفها', () => {
        const s = src();
        const note = s.slice(s.indexOf('function printVeg'), s.indexOf('/* ── القراءة والرسم'));
        expect(note.indexOf('openInAppReport(')).toBeGreaterThan(-1);
        expect(note.indexOf('openInAppReport(')).toBeLessThan(note.indexOf('await fetchVegRequestById(raw.id)'));
        expect(note).toContain('جارٍ تجهيز طلب الخضار…');
        expect(note).not.toContain('اسمح بالنوافذ المنبثقة لطباعة طلب الخضار');
        expect(note).toContain('buildVegPrintHtml(full, userName)');
        expect(s.match(/fetchVegRequestById\(/g)).toHaveLength(1);   // القراءة الطازجة مرة واحدة
        // الورقة من vegBuildPrintHtml :582-680 — بنتها الذهبية وخاناتها
        const legacy = legacyOf();
        for (const lit of ['<div class="title">طلب شراء خضار</div>', '#c9a227', '#16213e',
            'size: A4', 'عاجل — التوريد بأسرع وقت', 'الجهة الطالبة:', 'إجمالي الأصناف:',
            'طُبعت من نظام Karim ERP بواسطة', 'نسخة رقم ', 'توقيع الشيف — ', 'توقيع أمين المخزن — الاستلام']) {
            expect(s).toContain(lit);
        }
        for (const lit of ['<div class="title">طلب شراء خضار</div>', '#c9a227', '#16213e',
            'عاجل — التوريد بأسرع وقت', 'الجهة الطالبة:', 'إجمالي الأصناف:',
            'طُبعت من نظام Karim ERP بواسطة', 'نسخة رقم ', 'توقيع الشيف — ', 'توقيع أمين المخزن — الاستلام']) {
            expect(legacy).toContain(lit);
        }
        expect(s).toContain('مطاعم الشرفاء العالمي');
        expect(legacy).toContain('مطاعم الشرفاء العالمي');
        expect(s).toContain('class="stamp ok"');
        expect(s).toContain('class="stamp no"');
        expect(s).toContain('✔ معتمد');
        expect(legacy).toContain('✔ معتمد');
        expect(s).toContain('✔ تم الاستلام');
        expect(legacy).toContain('✔ تم الاستلام');
        expect(s).toContain('✗ مرفوض — لا يُسعَّر');
        expect(legacy).toContain('✗ مرفوض — لا يُسعَّر');
        expect(s).toContain('سعّرها:');
        expect(legacy).toContain('سعّرها:');
        expect(s).toContain('استلمها:');
        expect(legacy).toContain('استلمها:');
    });

    test('كل رمز data-i ساكن موجود في وحدة الرموز — الغائب يسقط للاستفهام صامتًا', () => {
        const s = src();
        const icons = source(ICONS);
        const names = new Set();
        for (const m of s.matchAll(/data-i="([a-z0-9-]+)"/g)) {names.add(m[1]);}
        for (const m of s.matchAll(/\bbtn\('[a-z-]+',\s*[^,]+,\s*'([a-z0-9-]+)'/g)) {names.add(m[1]);}
        for (const m of s.matchAll(/panel(?:Shell|Loading|Retry)\([^,]+,\s*'([a-z0-9-]+)'/g)) {names.add(m[1]);}
        expect(names.size).toBeGreaterThan(10);
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

describe('شاشة 14 — السجل المشترك والمضيف والطبقة', () => {
    test('حالات veg_request الأربع مسجلة بكلمات القديم :28-32 — وأيقوناتها موجودة فعلًا', () => {
        const st = source(SHARED_STATUS);
        const icons = source(ICONS);
        const legacy = legacyOf();
        for (const k of ['pending', 'received', 'priced', 'cancelled']) {
            expect(st).toContain(`'veg_request:${k}':`);
        }
        // كلمات الشارة الثلاث من القديم حرفًا (pending قرار موجة القراءة)
        expect(legacy).toContain('✔ تم الاستلام');
        expect(legacy).toContain('💰 تم التسعير');
        expect(legacy).toContain('✖ ملغي');
        expect(st).toMatch(/'veg_request:received':\s*\{ label: 'تم الاستلام'/);
        expect(st).toMatch(/'veg_request:priced':\s*\{ label: 'تم التسعير'/);
        expect(st).toMatch(/'veg_request:cancelled':\s*\{ label: 'ملغي'/);
        const vegIcons = [...st.matchAll(/'veg_request:[a-z_]+':\s*\{ label: '[^']*',\s*tone: '[a-z]+',\s*icon: '([a-z0-9-]+)'/g)];
        expect(vegIcons).toHaveLength(4);
        for (const m of vegIcons) {expect(icons).toContain(`'${m[1]}':`);}
    });

    test('المضيف يمرر الهوية كاملة — المعرّف يحكم بوابتي التعديل والإلغاء والاسم يطبع', () => {
        const h = source(HOST);
        expect(h).toMatch(/import \{ mountVegScreen \} from '\.\/screens\/veg-requests\.js\?v=/);
        expect(h).toMatch(/vegScreen = mountVegScreen\(shell\.main\.querySelector\('\[data-v2-veg-host\]'\), \{/);
        expect(h).toMatch(/role: session\.role,/);
        expect(h).toMatch(/userId: u\.id != null \? u\.id : \(u\.sub != null \? Number\(u\.sub\) : null\),/);
        expect(h).toMatch(/userName: String\(u\.name \|\| u\.username \|\| ''\),/);
        expect(h).toMatch(/notify: notifyTo\(note\),/);
        expect(h).toMatch(/confirmFn: \(message\) => window\.confirm\(message\),/);
        expect(h).toMatch(/if \(navStatus\.current !== 'veg-requests'\) \{return;\}/);
    });

    test('المغادرة تُتلف الشاشة — لا شبح يكتب على DOM بعد التنقّل', () => {
        const h = source(HOST);
        expect(h).toMatch(/function teardownVegScreen\(\) \{[\s\S]{0,120}vegScreen\.destroy\(\);[\s\S]{0,60}vegScreen = null;/);
        expect(h).toMatch(/teardownVegScreen\(\);/);
    });

    test('الشاشة تُستورد بمراجعة الصفحة نفسها وتُركّب على مضيفها', () => {
        const rev = source(V2_HTML).match(/js\/v2\/preview\.js\?v=([0-9.]+)/)[1];
        expect(source(HOST)).toContain(`./screens/veg-requests.js?v=${rev}`);
        expect(source(V2_HTML)).toContain(`js/v2/preview.js?v=${rev}`);
        expect(source(V2_HTML)).toContain(`css/v2/erp-ops.css?v=${rev}`);
    });

    test('الطبقة: قواعد الأساس كلها رموز، وألوان السياق الستة بحصر الشاشة', () => {
        const css = source(OPS_CSS);
        expect(css).toContain('.erp-v2-veg .erp-card__head { flex-wrap: wrap; }');
        for (const sel of ['.erp-v2-veg .erp-veg-panel {',
            '.erp-v2-veg .erp-veg-item {',
            '.erp-v2-veg .erp-veg-item.is-filled { border-color: var(--erp-brand); }',
            '.erp-v2-veg .erp-veg-line {',
            '.erp-v2-veg .erp-veg-chip[data-rejected] {',
            '.erp-v2-veg td.erp-v2-veg-actions {',
            '.erp-v2-veg .details-list {']) {
            expect(css).toContain(sel);
        }
        for (const tone of ['info', 'warning', 'danger', 'success', 'brand', 'neutral']) {
            expect(css).toContain(`.erp-v2-veg .erp-flow-note[data-tone="${tone}"]`);
        }
        expect(css).toContain('@supports not (color-mix(in srgb, red 10%, transparent))');
        // الأساس كله بعد آخر وسيط والوسائط لا تعود بعده — الإلحاق في آخر كتلة أعلاه
        const tail = css.slice(css.indexOf('.erp-v2-veg .erp-card__head { flex-wrap: wrap; }'));
        expect(tail).not.toMatch(/@media/);
    });

    test('٦٤٠px: أزرار ٤٠ والأسماء تختفي والأدوات تنزل — والبطاقات تصير عمودين', () => {
        const blocks = source(OPS_CSS).match(/@media \(max-width: 640px\)[\s\S]*?\n\}/g);
        expect(blocks).toHaveLength(2);   // كتلتان فقط — كتلة ثالثة تكسر ضوابط W1-1/W1-2
        const d = blocks[blocks.length - 1];
        // تسمية الزرّ تُخفى (display:none أو النمط البصري sr-only) ويبقى الرمز مقروءًا
        const labelRule = ruleBody(d, '.erp-v2-veg .erp-card__head .erp-btn > span');
        expect(labelRule).not.toBe('');
        expect(hidesLabel(labelRule)).toBe(true);
        expect(d).toMatch(/min-block-size: var\(--erp-space-8\)/);
        expect(d).toContain('.erp-v2-veg__tools { flex: 1 1 100%; }');
        expect(d).toContain('.erp-v2-veg .erp-seg { flex-wrap: wrap; }');
        expect(d).toContain('.erp-v2-veg div.erp-veg-grid { grid-template-columns: 1fr 1fr; }');
        expect(d).not.toMatch(/\.erp-v2-veg \.erp-input\s*\{[^}]*min-block-size/);
    });

    test('الطباعة تخفي اللوحة وعمود الإجراءات — ولا تخفي أساس الأرقام', () => {
        const prints = source(OPS_CSS).match(/@media print\s*\{[\s\S]*?\n\}/g);
        expect(prints).toHaveLength(2);   // كتلتان فقط، والممتدة آخر كتلة عمدًا
        const p = prints[prints.length - 1];
        expect(p).toContain('.erp-v2-veg [data-v2-panel] { display: none; }');
        expect(p).toContain('.erp-v2-veg [data-col="actions"],');
        expect(p).toContain('.erp-v2-veg td.erp-v2-veg-actions { display: none; }');
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
