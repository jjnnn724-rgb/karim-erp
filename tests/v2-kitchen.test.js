/**
 * v2-kitchen.test.js — عقد شاشة 09 (المطبخ) في V2 — دورة المطبخ الكاملة W1-2
 * ═══════════════════════════════════════════════════════════════════════
 * نفس أسلوب tests/v2-dispatch.test.js (W1-1) وtests/v2-procurement.test.js:
 * المستودع يُحمَّل في vm وبوابته apiFetch مزيفة، والشاشة تُقرأ كعقد مصدر
 * (testEnvironment:'node') لأن المتصفح لا يُثبت ما يُثبته النص.
 *
 * المثبَّت هنا:
 *   • نافذة الباب مطابقة لـ SQL الخادم حرفيًا: أحدث 100 أمر، 100 استثناء
 *     مفتوح، 300 توزيع، والسياسات بلا حدّ (kitchen-production-routes.js:145-150)
 *     — كل رقم على الصفحة معدودٌ على هذه النافذة، وcapNote() يقولها متى امتلأت
 *   • W1-2: ست كتابات منسوخة من مسارات الخادم نفسها — /kitchen/production (:247)،
 *     /kitchen/transfers/receive (:155)، /kitchen/audits (:329)، /audits/:id/count
 *     (:330)، /audits/:id/submit (:331)، /audits/:id/approve (:332) — والمحوّلات
 *     النقية والتحقق برسائل features/kitchen.js:69-76 بترتيبها حرفيًا
 *   • الاستلام بلا `reference` عمدًا: حارس التكرار الخادمي (:156) يعمل بغيابه
 *     فقط، والقديم كان يعطّله بـKITCHEN-uid() (kitchen.js:124) — الانحراف مثبّت
 *     على الجانبين
 *   • انحرافان معلنان: إرسال الجرد يقرأ التوقيع قبل حفظ العدّ (القديم :94
 *     يعكس)، وتغيير الصنف في الاستلام يقلّص الحالة المخزّنة لا الخانة وحدها
 *     (:120) — الاثنان يُثبتان في الشاشة مع تعليق السبب
 *   • ثوابت الأدوار مرايا: KITCHEN_WRITE_ROLES ← WRITE (:12) وصفوف
 *     count/submit (requireRole(...WRITE))، KITCHEN_APPROVE_ROLES ←
 *     requireRole('admin','manager','auditor') (:332) وكلمة canApprove القديمة (:97)
 *   • التواقيع: لا قرار موقّع بلا اسم حساب، ولوحتا الجرد تحملان معرّفيهما
 *     الثابتين، والحارس قبل فتح أي لوحة موقّعة
 *   • قاعدة العرض الموروثة: draft وopen وجهان لـ«مفتوح» (features/kitchen.js:168)،
 *     وclosed «مغلق — موزع» — والكلمات والألوان تُقرأ من السجل المشترك
 *     status.js لا من خريطة ثانية في الباب أو في الشاشة؛ وحالات kitchen_audit
 *     الثلاث من status.js:125-129 وكلمات القديم :97 نفسها
 *   • لا جمع عبر الوحدات؛ وحراس القراءة (queued/readSeq+هنا gov*) وحارس القرار
 *     الواحد (busy) وdestroy() يُتلف الجداول الخمسة ويحرّر اللوحتين
 *   • قراءة الحوكمة (الجرد+المستندات) منفصلة عن النظرة: فشل إحداهما لا يمحو
 *     الأخرى، والسقوف GOVERNANCE_LIMITS = LIMIT 50/100 في SQL البابين
 *   • طبقة css/v2/erp-ops.css: كل قيمة رمزٌ من --erp-*، وأهداف اللمس 40px
 *     محصورة في الشاشة داخل أول كتلة 640px، والطباعة تخفي اللوحة وعمود
 *     الإجراءات ولا تخفي أساس الأرقام
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const APP = path.join(__dirname, '..', 'frontend', 'app');
const V2 = path.join(APP, 'js', 'v2');
const REPO = path.join(V2, 'data', 'kitchen-repo.js');
const SCREEN = path.join(V2, 'screens', 'kitchen.js');
const SHARED_STATUS = path.join(V2, 'status.js');
const OPS_CSS = path.join(APP, 'css', 'v2', 'erp-ops.css');
const V2_HTML = path.join(APP, 'v2.html');
const ICONS = path.join(APP, 'js', 'icons.js');
const SERVER = path.join(__dirname, '..', 'backend', 'kitchen-production-routes.js');
const LEGACY = path.join(APP, 'js', 'features', 'kitchen.js');
// REV مشتق من الوسم الحيّ في v2.html (نفس نمط v2-dispatch/leaves) — تثبيت
// يدوي هنا كسر مرّات عند رفع النسخة الموحّدة؛ الاشتقاق يجعل الاختبار معيارًا.
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

const EXPORTS = ['KITCHEN_WINDOW', 'fetchKitchenOverview', 'batchToRow',
    'POLICY_MODE_AR', 'exceptionToRow', 'policyToRow', 'distributionToRow',
    'summarizeKitchen', 'buildKitchenKpis', 'topDistributions', 'capNote',
    'KITCHEN_WRITE_ROLES', 'KITCHEN_APPROVE_ROLES', 'AUDIT_PERIODS', 'GOVERNANCE_LIMITS',
    'fetchKitchenStock', 'fetchProductionMaterials', 'fetchProductionDestinations',
    'fetchProductionProducts', 'fetchKitchenAudits', 'fetchKitchenDocuments',
    'createProduction', 'receiveKitchenTransfer', 'createKitchenAudit',
    'countKitchenAudit', 'submitKitchenAudit', 'approveKitchenAudit',
    'legacyQty', 'materialPayload', 'distributionPayload', 'productionPayload',
    'validateProductionForm', 'transferPayload', 'validateAuditPeriod', 'auditPayload',
    'countPayload', 'distributionsInRange', 'auditToRow', 'auditItemToRow', 'documentToRow'];

function repoStub(impl) {
    const calls = [];
    const bodies = [];
    const apiFetch = jest.fn(async (p, opts) => {
        calls.push(p);
        if (opts && opts.body) {bodies.push({ path: p, body: opts.body, method: opts.method });}
        return typeof impl === 'function' ? impl(p, opts) : impl;
    });
    // الباب يستورد apiFetch من core/api وformatInt من reports-repo.
    const repo = loadEsm(REPO, {
        apiFetch,
        formatInt: (v) => String(Number(v) || 0),
    }, EXPORTS);
    return { calls, bodies, repo };
}

const source = (f) => fs.readFileSync(f, 'utf8');

/* عقد CSS يثبت النية لا الصياغة: إخفاء تسمية الزرّ إما display:none أو
   النمط البصري (sr-only: position:absolute + مقاس 1px + clip-path) — وكلاهما
   يُبقي الرمز ظاهرًا ويبقى aria-label يسمّي الزرّ لقارئ الشاشة. */
const ruleBody = (cssText, selector) => {
    const i = cssText.indexOf(selector);
    if (i < 0) return '';
    const open = cssText.indexOf('{', i);
    const close = cssText.indexOf('}', open);
    return open < 0 || close < 0 ? '' : cssText.slice(open + 1, close);
};
const hidesLabel = (body) => /display:\s*none/.test(body)
    || (/position:\s*absolute/.test(body)
        && /inline-size:\s*1px/.test(body)
        && /clip-path:\s*inset\(50%\)/.test(body));

describe('kitchen-repo — الباب الواحد: قراءة النظرة وكتابات دورة المطبخ الست', () => {
    test('كل ما تحتاجه الشاشة مُصدَّر', () => {
        const src = source(REPO);
        for (const name of EXPORTS) {
            expect(src).toMatch(new RegExp(`export (async function|function|const) ${name}\\b`));
        }
    });

    test('الاستدعاء واحدٌ على /kitchen/overview بلا وسائط', async () => {
        const { calls, repo } = repoStub({});
        await repo.fetchKitchenOverview();
        expect(calls).toEqual(['/kitchen/overview']);
    });

    test('أبواب القراءة الستة الإضافية بمساراتها — ومنتجات POS باب اختياري', async () => {
        const { calls, repo } = repoStub({});
        await repo.fetchKitchenStock();
        await repo.fetchProductionMaterials();
        await repo.fetchProductionDestinations();
        await repo.fetchProductionProducts();
        await repo.fetchKitchenAudits();
        await repo.fetchKitchenDocuments();
        expect(calls).toEqual([
            '/kitchen/stock',
            '/kitchen/production-materials',
            '/kitchen/production-destinations',
            '/pos/products',           // shift-routes.js:238 — أدوار المخازن تُرد 403 وهذا مقبول
            '/kitchen/audits',
            '/kitchen/documents',
        ]);
    });

    test('رصيد الاستلام شكلٌ خمسيٌّ آمن ولو ردّ الخادم فاسدًا', async () => {
        const bad = repoStub(null);
        expect(await bad.repo.fetchKitchenStock()).toEqual({ source: null, destination: null, items: [] });
        const ok = repoStub({ source: { id: 1 }, destination: { id: 2 }, items: [{ inventory_id: 5 }] });
        expect((await ok.repo.fetchKitchenStock()).items).toHaveLength(1);
        // والمصفوفات العارية تعود [] على أي شكل آخر لا كائنًا مكسورًا
        for (const fn of ['fetchProductionMaterials', 'fetchProductionDestinations',
            'fetchProductionProducts', 'fetchKitchenAudits', 'fetchKitchenDocuments']) {
            const stub = repoStub({ items: [1] });
            expect(await stub.repo[fn]()).toEqual([]);
        }
    });

    test('ست كتابات منسوخة من مسارات الخادم نفسها وحمولة JSON', async () => {
        const doors = [
            ['createProduction', '/kitchen/production', false],
            ['receiveKitchenTransfer', '/kitchen/transfers/receive', false],
            ['createKitchenAudit', '/kitchen/audits', false],
            ['countKitchenAudit', '/kitchen/audits/9/count', true],
            ['submitKitchenAudit', '/kitchen/audits/9/submit', true],
            ['approveKitchenAudit', '/kitchen/audits/9/approve', true],
        ];
        for (const [fn, door, withId] of doors) {
            const { calls, bodies, repo } = repoStub({});
            const body = { probe: fn };
            await (withId ? repo[fn](9, body) : repo[fn](body));
            expect(calls).toEqual([door]);
            expect(bodies[0].method).toBe('POST');
            expect(JSON.parse(bodies[0].body)).toEqual(body);
        }
    });

    test('المعرّف في المسار مُشفَّر — لا مسار يُبنى بمزاج المدخل', async () => {
        const { calls, repo } = repoStub({});
        await repo.countKitchenAudit('7/8', {});
        await repo.submitKitchenAudit('7/8', {});
        await repo.approveKitchenAudit('7/8', {});
        expect(calls).toEqual([
            '/kitchen/audits/7%2F8/count',
            '/kitchen/audits/7%2F8/submit',
            '/kitchen/audits/7%2F8/approve',
        ]);
    });

    test('الاستلام بلا reference عمدًا — الحارس الخادمي يعمل بغيابه فقط', () => {
        const { repo } = repoStub({});
        const p = repo.transferPayload({ source: { id: 1 }, destination: { id: 2 } },
            [{ inventory_id: 5, qty: 1 }], '');
        expect(Object.keys(p).sort()).toEqual(['destination_location_id', 'items', 'notes', 'source_location_id']);
        // الخادم :156: التكرار يُمنع فقط حين لا reference في الطلب
        expect(source(SERVER)).toContain('!req.body.reference');
        // والقديم كان يرسل KITCHEN-uid() فيعطّله (kitchen.js:124)
        expect(source(LEGACY)).toContain('reference:`KITCHEN-${uid()}`');
    });

    test('نافذة الأرقام الثلاثة = LIMIT في راوتر المطبخ حرفيًا', () => {
        const sql = overviewSql();
        const { repo } = repoStub({});
        expect(repo.KITCHEN_WINDOW).toEqual({
            batches: limitOf(sql, 'kitchen_production_batches'),
            exceptions: limitOf(sql, 'kitchen_exceptions'),
            distributions: limitOf(sql, 'kitchen_production_distributions'),
        });
    });

    test('السياسات بلا حدٍّ عند الخادم — فلا capNote لها', () => {
        const sql = overviewSql();
        const from = sql.indexOf('kitchen_policies kp');
        const to = sql.indexOf('kitchen_production_distributions');
        expect(sql.slice(from, to)).not.toMatch(/LIMIT/);
    });

    test('خمسة مفاتيح تُقرأ دائمًا مصائف — شكل الفشل 500 لا ينفذ إلى الرسم', async () => {
        const { repo } = repoStub({ error: 'KITCHEN_OVERVIEW_FAILED', message: 'x' });
        const ov = await repo.fetchKitchenOverview();
        expect(ov).toEqual({ locations: [], batches: [], exceptions: [], policies: [], distributions: [] });
    });

    test('null صريح لا يكسر الباب أيضًا', async () => {
        const { repo } = repoStub(null);
        const ov = await repo.fetchKitchenOverview();
        expect(Object.values(ov).every(Array.isArray)).toBe(true);
    });
});

// نافذة الثابت في الملف تُقارَن بـ SQL الراوتر نفسه.
function overviewSql() {
    const srv = source(SERVER);
    const start = srv.indexOf("router.get('/overview'");
    return srv.slice(start, srv.indexOf("router.post('/policies'"));
}
function limitOf(sql, table) {
    const at = sql.indexOf(`FROM ${table}`);
    const seg = sql.slice(at, sql.indexOf('`', at));
    const m = seg.match(/LIMIT (\d+)/);
    return m ? Number(m[1]) : null;
}

describe('kitchen-repo — ثوابت الأدوار والسقوف مرايا سطور الخادم', () => {
    test('WRITE وAPPROVE مرآتان حرفيتان، والقائمة الخامسة عند الخادم لا عند الشاشة', () => {
        const { repo } = repoStub({});
        const srv = source(SERVER);
        // الخادم يكتب قوائمه مضغوطة (بلا فراغ بعد الفاصلة) — المرآة بالنص ذاته
        expect([...repo.KITCHEN_WRITE_ROLES]).toEqual(['admin', 'manager', 'warehouse', 'kitchen', 'sous_chef']);
        expect(srv).toContain(`const WRITE = [${repo.KITCHEN_WRITE_ROLES.map((r) => `'${r}'`).join(',')}];`);
        expect(srv).toContain(`requireRole('admin','manager','auditor')`);
        expect([...repo.KITCHEN_APPROVE_ROLES].sort()).toEqual(['admin', 'auditor', 'manager']);
        // count/submit يُبوَّبان بنفس WRITE الخادمية — فلا واجهةٌ أوسع من الباب
        for (const door of ["router.post('/audits/:id/count',jwtAuth,requireRole(...WRITE)",
            "router.post('/audits/:id/submit',jwtAuth,requireRole(...WRITE)"]) {
            expect(srv).toContain(door);
        }
        // واعتماد الجرد في القديم لنفس الثلاثة (kitchen.js:97)
        expect(source(LEGACY)).toContain("canApprove=['admin','manager','auditor'].includes(STATE.currentUser?.role)");
        // والباب نفسه لا يعرف requireRole — القرار للخادم (التعليق التوثيقي
        // الذي يسمّي سطر الحصر :332 مشروع — الحصر في الكود هو الممنوع)
        expect(source(REPO).replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '')).not.toMatch(/requireRole|canRead/);
    });

    test('سقوف الحوكمة = LIMIT في SQL بابي الجرد والمستندات', () => {
        const { repo } = repoStub({});
        const srv = source(SERVER);
        const auditsLine = srv.split('\n').find((l) => l.includes("router.get('/audits'"));
        const docsLine = srv.split('\n').find((l) => l.includes("router.get('/documents'"));
        expect(auditsLine).toContain('LIMIT 50');
        expect(docsLine).toContain('LIMIT 100');
        expect(repo.GOVERNANCE_LIMITS).toEqual({ audits: 50, documents: 100 });
    });

    test('كلمات الدورية من صفحة المطبخ: عنوان البطاقة «مخصص» والقائمة «فترة مخصصة» — كلتاهما محفوظة', () => {
        const { repo } = repoStub({});
        const legacy = source(LEGACY);
        expect(repo.AUDIT_PERIODS).toEqual({ daily: 'يومي', weekly: 'أسبوعي', monthly: 'شهري', custom: 'مخصص', annual: 'سنوي' });
        expect(legacy).toContain('<option value="custom">فترة مخصصة</option>');
        expect(legacy).toContain("custom:'مخصص'");
        const screen = source(SCREEN);
        expect(screen).toContain("custom: 'فترة مخصصة'");
        expect(screen).toMatch(/value === 'daily' \? ' selected' : ''/);
    });
});

describe('kitchen-repo — التحولات القرائية نقية ولا تخترع قيمة', () => {
    test('draft وopen وجهان لـ«مفتوح» كما تُعرض في الصفحة الحالية (:168)', () => {
        const { repo } = repoStub({});
        expect(repo.batchToRow({ id: 1, status: 'draft' }).stateKey).toBe('open');
        expect(repo.batchToRow({ id: 2, status: 'open' }).stateKey).toBe('open');
        expect(repo.batchToRow({ id: 3, status: 'closed' }).stateKey).toBe('closed');
        expect(repo.batchToRow({ id: 4, status: 'cancelled' }).stateKey).toBe('cancelled');
        expect(repo.batchToRow({ id: 5, status: 'weird' }).stateKey).toBe('other');
        expect(repo.batchToRow({ id: 6 }).stateKey).toBe('other');
        // الكلمة المخزنة تبقى كما هي للعرض الخام
        expect(repo.batchToRow({ id: 5, status: 'weird' }).status).toBe('weird');
    });

    test('كلمات الحالة في السجل المشترك وحده: لا خريطة حالة في الباب ولا في الشاشة', () => {
        const reg = source(SHARED_STATUS);
        const legacy = source(LEGACY);
        // السجل يحمل كلمات صفحة المطبخ حرفيًا (status.js:117-119 ← :168)
        expect(reg).toMatch(/'production_batch:open':\s*\{ label: 'مفتوح',/);
        expect(reg).toMatch(/'production_batch:closed':\s*\{ label: 'مغلق — موزع',/);
        expect(reg).toMatch(/'production_batch:cancelled':\s*\{ label: 'ملغى',/);
        // وحالات الجرد الثلاث من القديم :97 أيضًا
        expect(legacy).toContain('بانتظار الاعتماد');
        expect(reg).toMatch(/'kitchen_audit:draft':\s*\{ label: 'مسودة',/);
        expect(reg).toMatch(/'kitchen_audit:submitted':\s*\{ label: 'بانتظار الاعتماد',/);
        expect(reg).toMatch(/'kitchen_audit:approved':\s*\{ label: 'معتمد',/);
        // فلا تكرار لخريطة الحالة في الباب ولا في الشاشة — مصدرٌ واحد للون والكلمة
        expect(source(REPO)).not.toMatch(/BATCH_STATE_AR/);
        expect(source(SCREEN)).not.toMatch(/BATCH_STATE_AR/);
        expect(source(SCREEN)).toContain("from '../status.js");
        expect(source(SCREEN)).toMatch(/resolveStatus\('kitchen_audit', row\.status\)/);
    });

    test('اسم غير محلول يعرض رقم السجل لا اسمًا مُختلقًا', () => {
        const { repo } = repoStub({});
        const bare = repo.batchToRow({ id: 42, status: 'open' });
        expect(bare.product).toBe('#42');
        expect(bare.productResolved).toBe(false);
        expect(bare.location).toBe('—');
        expect(bare.locationResolved).toBe(false);
        const named = repo.batchToRow({ id: 42, product_name: 'أرز', product_unit: 'كجم', location_name: 'المطبخ', status: 'open' });
        expect(named).toMatchObject({ product: 'أرز', unit: 'كجم', location: 'المطبخ', productResolved: true, locationResolved: true });
    });

    test('الأرقام كلها أرقام: null و«abc» صفرٌ لا NaN يظهر في الجدول', () => {
        const { repo } = repoStub({});
        const r = repo.batchToRow({ id: 1, status: 'open', planned_qty: null, produced_qty: 'abc', remaining_qty: '12.5' });
        expect(r.planned).toBe(0);
        expect(r.produced).toBe(0);
        expect(r.remaining).toBe(12.5);
    });

    test('كلمات سياسة الوضع من صفحة المطبخ نفسها (:154)، والمجهول خام', () => {
        const { repo } = repoStub({});
        const legacy = source(LEGACY);
        expect(repo.POLICY_MODE_AR).toEqual({ flexible: 'مرن', monitor: 'مراقب', strict: 'صارم' });
        expect(legacy).toContain('مرن');
        expect(legacy).toContain('مراقب');
        expect(legacy).toContain('صارم');
        expect(repo.policyToRow({ id: 1, department_id: 7, operation_mode: 'strict' }))
            .toMatchObject({ mode: 'strict', modeAr: 'صارم', modeKnown: true, dept: '#7', deptResolved: false });
        const unknown = repo.policyToRow({ id: 2, operation_mode: 'loose' });
        expect(unknown.modeAr).toBe('loose');
        expect(unknown.modeKnown).toBe(false);
        expect(repo.exceptionToRow({ id: 3, operation_mode: 'loose' }).policyAr).toBe('loose');
        expect(repo.exceptionToRow({ id: 4, operation_mode: 'monitor' }).policyAr).toBe('مراقب');
    });

    test('الأعلام المخزنة تُقرأ boolean فقط عند true الصريح', () => {
        const { repo } = repoStub({});
        expect(repo.policyToRow({ id: 1, allow_fallback: true, require_reason: false }))
            .toMatchObject({ fallback: true, requireReason: false });
        expect(repo.policyToRow({ id: 2, allow_fallback: 'true' }).fallback).toBe(false);
        expect(repo.policyToRow({ id: 3 }).requireReason).toBe(false);
    });

    test('التوزيع: الكمية من allocated_qty والوجه كما كُتب لا مُسمّى جديدًا', () => {
        const { repo } = repoStub({});
        const d = repo.distributionToRow({ id: 9, batch_id: 3, destination_name: 'فرع الشمس', destination_type: 'branch', allocated_qty: '4', product_id: 5, created_at: '2026-10-15T09:00:00Z' });
        expect(d).toMatchObject({ dest: 'فرع الشمس', destType: 'branch', qty: 4, product: '#5', productResolved: false, created: '2026-10-15' });
    });
});

describe('kitchen-repo — الأرقام المشتقة: لا مجموع عبر وحدتين مختلفتين', () => {
    test('وحدةٌ واحدة → مجموعٌ مشروع؛ وحدتان → لا مجموع معروض', () => {
        const { repo } = repoStub({});
        const mk = (u) => repo.batchToRow({ id: 1, status: 'open', planned_qty: 10, produced_qty: 4, remaining_qty: 6, product_unit: u });
        const one = repo.summarizeKitchen([mk('كجم'), mk('كجم')], [], [], [], []);
        expect(one.uniformUnit).toBe('كجم');
        expect(one).toMatchObject({ planned: 20, produced: 8, remaining: 12 });
        const two = repo.summarizeKitchen([mk('كجم'), mk('وحدة')], [], [], [], []);
        expect(two.uniformUnit).toBe('');
        // المجاميع تُحسب لكنها لا تُعرض: الكروت تختار العدّ حين تختلف الوحدات
        expect(two.produced).toBe(8);
    });

    test('العدّ على النافذة: مفتوح/مغلق/ملغى/غير معروف وأوامر بانتظار الإنتاج', () => {
        const { repo } = repoStub({});
        const b = (status, remaining) => repo.batchToRow({ id: 1, status, remaining_qty: remaining });
        const s = repo.summarizeKitchen([b('open', 5), b('draft', 0), b('closed', 0), b('cancelled', 2), b('weird', 3)], [], [], [], []);
        expect(s).toMatchObject({ total: 5, open: 2, closed: 1, cancelled: 1, other: 1, needProduction: 1 });
    });

    test('صارمة تُعدّ على صفوف policyToRow لا على أعمدة خام', () => {
        const { repo } = repoStub({});
        const pol = [repo.policyToRow({ id: 1, operation_mode: 'strict' }), repo.policyToRow({ id: 2, operation_mode: 'monitor' })];
        const s = repo.summarizeKitchen([], [], [], pol, []);
        expect(s.policies).toBe(2);
        expect(s.strictPolicies).toBe(1);
    });
});

describe('kitchen-repo — كروت المؤشرات تسمّي أساسها', () => {
    test('ستة كروت لا سبعة: الرقم التشغيلي في الشريط، وعدد النوافذ في سطر المدى', () => {
        const { repo } = repoStub({});
        const s = repo.summarizeKitchen([], [], [], [], []);
        const kpis = repo.buildKitchenKpis(s);
        expect(kpis).toHaveLength(6);
        // المواقع ليست مؤشرًا تشغيليًا بل وصفٌ للنافذة: تُقرأ في سطر المدى لا في الشريط
        expect(kpis.map((k) => k.id)).not.toContain('locations');
        const icons = source(path.join(APP, 'js', 'icons.js'));
        for (const k of kpis) {
            expect(k.icon).toBeTruthy();
            expect(k.label).toBeTruthy();
            expect(k.en).toBeTruthy();
            expect(k.hint).toBeTruthy();
            expect(icons).toContain(`'${k.icon}':`);
        }
        // لا رقم يخلو من الأساس: «100» بلانافذة تُقرأ كل السجل
        expect(kpis.some((k) => /النافذة/.test(k.hint))).toBe(true);
    });

    test('الكمية فقط عند وحدة واحدة — وإلا تحلّ كروت العدّ', () => {
        const { repo } = repoStub({});
        const uni = repo.buildKitchenKpis(repo.summarizeKitchen([
            repo.batchToRow({ id: 1, status: 'open', produced_qty: 3, remaining_qty: 1, product_unit: 'كجم' }),
        ], [], [], [], []));
        expect(uni.map((k) => k.id)).toContain('produced');
        expect(uni.map((k) => k.id)).toContain('remaining');
        expect(uni.find((k) => k.id === 'produced').unit).toBe('كجم');
        const mixed = repo.buildKitchenKpis(repo.summarizeKitchen([
            repo.batchToRow({ id: 1, status: 'open', produced_qty: 3, remaining_qty: 1, product_unit: 'كجم' }),
            repo.batchToRow({ id: 2, status: 'open', produced_qty: 1, remaining_qty: 1, product_unit: 'وحدة' }),
        ], [], [], [], []));
        const ids = mixed.map((k) => k.id);
        expect(ids).not.toContain('produced');
        expect(ids).not.toContain('remaining');
        expect(ids).toContain('need');
        expect(ids).toContain('dist');
        expect(mixed.every((k) => !k.unit)).toBe(true);
    });
});

describe('kitchen-repo — الترتيب المحسوب هنا يُنسب إلى نافذته', () => {
    test('topDistributions: الأكبر أولًا، والتقادم يحسم التعادل، والمدخل لا يتغيّر', () => {
        const { repo } = repoStub({});
        const d = (id, qty) => repo.distributionToRow({ id, allocated_qty: qty, destination_name: `و${id}` });
        const rows = [d(1, 2), d(2, 9), d(3, 9), d(4, 5)];
        const frozen = [...rows];
        const top = repo.topDistributions(rows, 3);
        expect(top.map((x) => x.id)).toEqual([2, 3, 4]);
        expect(rows).toEqual(frozen);
        expect(repo.topDistributions([], 6)).toEqual([]);
        expect(repo.topDistributions(rows)).toHaveLength(4);   // الحد الافتراضي 6
    });

    test('capNote: صمتٌ قبل الامتلاء وصرخةٌ عنده، وبلا حدٍّ صمتٌ دائمًا', () => {
        const { repo } = repoStub({});
        expect(repo.capNote(99, 100, 'الأوامر')).toBe('');
        expect(repo.capNote(100, 100, 'الأوامر')).toMatch(/وصلت أقصى ما يرسله الخادم \(100\)/);
        expect(repo.capNote(300, 300, 'التوزيعات')).toContain('التوزيعات');
        expect(repo.capNote(10, 0, 'السياسات')).toBe('');
    });
});

describe('kitchen-repo — حمولات الإنتاج: منسوخة من القديم والتحقق برسائله وترتيبها', () => {
    test('legacyQty مرآة fN (core/utils.js:24) — والحارس المعلن للقيم الفاسدة', () => {
        const { repo } = repoStub({});
        expect(repo.legacyQty(3)).toBe('3');
        expect(repo.legacyQty(12.5)).toBe('12.50');
        expect(repo.legacyQty(3.456)).toBe('3.46');
        expect(repo.legacyQty(1250)).toBe('1,250');
        expect(repo.legacyQty(0)).toBe('0');
        expect(repo.legacyQty(null)).toBe('0');
        // انحراف V2 معلن: القديم كان يطبع «NaN» لو وصلت قيمة فاسدة
        expect(repo.legacyQty('abc')).toBe('0');
    });

    test('materialPayload: ترشيح القديم نفسه — id موجب وكمية موجبة والباقي يسقط', () => {
        const { repo } = repoStub({});
        expect(repo.materialPayload([
            { inventory_id: '5', quantity: '2.5', waste_percent: '5' },
            { inventory_id: '', quantity: '3' },        // بلا صنف
            { inventory_id: '6', quantity: '0' },       // كمية صفر
            { inventory_id: '7', quantity: 'abc' },     // كمية فاسدة
        ])).toEqual([{ inventory_id: 5, quantity: 2.5, waste_percent: 5 }]);
    });

    test('distributionPayload: التقسيم بانٍ والقيمة القديمة تمر كما وصلت', () => {
        const { repo } = repoStub({});
        expect(repo.distributionPayload([
            { destination: 'department|7|قسم أ', quantity: '10' },
            { destination: 'custom|custom|', customName: 'زفاف', quantity: '5' },
            { destination: 'channel|custom|', quantity: '2' },   // قيمة قديمة مخزنة بلا اسم — تُمرَّر '' كما تفعل القديمة، لا تُرمَّم
            { destination: 'department|7|قسم أ', quantity: '0' }, // صفر يسقط
        ])).toEqual([
            { destination_type: 'department', destination_code: '7', destination_name: 'قسم أ', department_id: 7, quantity: 10 },
            { destination_type: 'custom', destination_code: 'custom', destination_name: 'زفاف', department_id: null, quantity: 5 },
            { destination_type: 'channel', destination_code: 'custom', destination_name: '', department_id: null, quantity: 2 },
        ]);
    });

    test('productionPayload: التطبيع كما في القديم :77 — ومنتج غير رقمي null لا NaN', () => {
        const { repo } = repoStub({});
        const p = repo.productionPayload({
            productId: '', productName: ' كيك ', productUnit: '', producedQty: '10', notes: '  ',
            materials: [{ inventory_id: '5', quantity: '3' }],
            distributions: [{ destination: 'department|1|أ', quantity: '10' }],
        });
        expect(p).toMatchObject({
            product_id: null, product_name: 'كيك', product_unit: 'وحدة', produced_qty: 10, notes: null,
        });
        expect(p.materials).toEqual([{ inventory_id: 5, quantity: 3, waste_percent: 0 }]);
        expect(p.distributions[0]).toMatchObject({ department_id: 1, quantity: 10 });
        expect(repo.productionPayload({ productId: 'abc' }).product_id).toBeNull();
    });

    test('validateProductionForm: الرسائل الست بترتيب features/kitchen.js:69-76', () => {
        const { repo } = repoStub({});
        const M1 = 'اكتب اسم المنتج النهائي والكمية المنتجة';
        const M2 = 'أضف كل مكونات أمر الإنتاج وحدد كمياتها';
        const M3 = 'لا تكرر نفس المكون؛ اجمع كميته في سطر واحد';
        const M4 = 'نسبة الهالك يجب أن تكون بين 0 و100%';
        const M6 = 'اكتب اسم الجهة المخصصة';
        const mat = (o) => Object.assign({ inventory_id: '5', quantity: '3', waste_percent: '0' }, o);
        const dist = (q, o) => Object.assign({ destination: 'department|1|أ', quantity: String(q) }, o);
        expect(repo.validateProductionForm({})).toBe(M1);
        expect(repo.validateProductionForm({ productName: 'x', producedQty: 'abc' })).toBe(M1);
        expect(repo.validateProductionForm({ productName: 'x', producedQty: '5', materials: [{ inventory_id: '', quantity: '2' }] })).toBe(M2);
        expect(repo.validateProductionForm({ productName: 'x', producedQty: '5', materials: [mat({}), mat({})] })).toBe(M3);
        expect(repo.validateProductionForm({ productName: 'x', producedQty: '5', materials: [mat({ waste_percent: '150' })] })).toBe(M4);
        // عدم التساوي يُطبع بالأرقام نفسها (fN)
        const bad = repo.validateProductionForm({ productName: 'x', producedQty: '4', materials: [mat({})], distributions: [dist(3)] });
        expect(bad).toBe('يجب أن يساوي مجموع التوزيع 3 إجمالي الإنتاج 4');
        const frac = repo.validateProductionForm({ productName: 'x', producedQty: '3', materials: [mat({})], distributions: [dist('2.5')] });
        expect(frac).toBe('يجب أن يساوي مجموع التوزيع 2.50 إجمالي الإنتاج 3');
        expect(repo.validateProductionForm({ productName: 'x', producedQty: '5', materials: [mat({})], distributions: [dist(5, { destination: 'custom|custom|', customName: '' })] })).toBe(M6);
        expect(repo.validateProductionForm({ productName: 'x', producedQty: '10', materials: [mat({})], distributions: [dist(10)] })).toBe('');
    });
});

describe('kitchen-repo — حمولات الاستلام والجرد: قيود الخادم نفسها', () => {
    test('transferPayload: نفس ترشيح القديم :122 — صف فاسد يسقط وبلا صف صالح null', () => {
        const { repo } = repoStub({});
        const stock = { source: { id: 1 }, destination: { id: 2 } };
        expect(repo.transferPayload(stock, [], '')).toBeNull();
        expect(repo.transferPayload(stock, [{ inventory_id: '5', qty: '0' }], '')).toBeNull();
        expect(repo.transferPayload(stock, [{ inventory_id: '5.5', qty: '3' }], '')).toBeNull();
        expect(repo.transferPayload(stock, [{ inventory_id: '5', qty: '3' }, { inventory_id: '', qty: '2' }], '')).toEqual({
            source_location_id: 1,
            destination_location_id: 2,
            notes: '',
            items: [{ inventory_id: 5, qty: 3 }],
        });
        expect(repo.transferPayload(stock, [{ inventory_id: 5, qty: 3 }], '  تجهيز  ').notes).toBe('تجهيز');
        expect(repo.transferPayload({}, [{ inventory_id: 5, qty: 3 }], '')).toMatchObject({ source_location_id: null, destination_location_id: null });
    });

    test('validateAuditPeriod: نفس قاعدة الخادم :329 ورسالته', () => {
        const { repo } = repoStub({});
        const srv = source(SERVER);
        expect(srv).toContain('فترة الجرد غير صحيحة');
        expect(srv).toContain('INVALID_AUDIT_PERIOD');
        expect(repo.validateAuditPeriod('2026-10-15', '2026-10-15')).toBe('');
        expect(repo.validateAuditPeriod('2026-10-15', '2026-10-16')).toBe('');
        expect(repo.validateAuditPeriod('2026-10-16', '2026-10-15')).toBe('فترة الجرد غير صحيحة');
        expect(repo.validateAuditPeriod('15/10/2026', '2026-10-15')).toBe('فترة الجرد غير صحيحة');
        expect(repo.validateAuditPeriod('', '')).toBe('فترة الجرد غير صحيحة');
    });

    test('auditPayload: قائمة الدورية قيد الخادم (غريب→weekly)، والملاحظات لا تُقلَّم', () => {
        const { repo } = repoStub({});
        const srv = source(SERVER);
        expect(srv).toContain("['daily','weekly','monthly','custom','annual'].includes");
        expect(repo.auditPayload({ period: 'nonsense', periodStart: '2026-10-15T12:00:00Z' })).toMatchObject({
            period: 'weekly', period_start: '2026-10-15', period_end: '2026-10-15',
        });
        expect(repo.auditPayload({ period: 'monthly', periodStart: '2026-10-01', periodEnd: '2026-10-31', notes: ' وردية ' }).notes).toBe(' وردية ');
    });

    test('countPayload: خانة مُفرغة = صفر حرفيًا كما في القديم :93', () => {
        const { repo } = repoStub({});
        const legacy = source(LEGACY);
        expect(legacy).toContain('counted_qty:Number(x.value||0)');
        const items = [{ id: 11, system_qty: 5 }, { id: 12, system_qty: 3 }];
        expect(repo.countPayload(items, { 11: '', 12: '2.5' })).toEqual([
            { id: 11, counted_qty: 0 },
            { id: 12, counted_qty: 2.5 },
        ]);
        expect(repo.countPayload(items, {})).toEqual([{ id: 11, counted_qty: 0 }, { id: 12, counted_qty: 0 }]);
    });

    test('distributionsInRange: يوم البداية والنهاية شاملان، والغياب لا يرشّح', () => {
        const { repo } = repoStub({});
        const rows = [
            { id: 1, created: '2026-10-14T23:00:00Z' },
            { id: 2, created: '2026-10-15T06:00:00Z' },
            { id: 3, created: '2026-10-16T23:59:00Z' },
        ];
        expect(repo.distributionsInRange(rows, '2026-10-15', '2026-10-15').map((x) => x.id)).toEqual([2]);
        expect(repo.distributionsInRange(rows, '2026-10-15', '').map((x) => x.id)).toEqual([2, 3]);
        expect(repo.distributionsInRange(rows, '', '').map((x) => x.id)).toEqual([1, 2, 3]);
        expect(repo.distributionsInRange(rows, '', '2026-10-14').map((x) => x.id)).toEqual([1]);
        // القديم :89 يحرس بلا start/end منفصلين — نفس الصيغة
        expect(source(LEGACY)).toContain("const day=String(x.created_at||'').slice(0,10)");
    });
});

describe('kitchen-repo — صفوف سجل الجرد والمستندات', () => {
    test('auditToRow: الرقم باسمه أو برقم السجل، والدورية بكلماتها أو خامًا', () => {
        const { repo } = repoStub({});
        const a = repo.auditToRow({
            id: 7, audit_number: 'AUD-7', period: 'weekly',
            period_start: '2026-10-15T00:00:00Z', period_end: null,
            total_items: '12', status: 'draft', total_variance_value: '-3.5',
            created_by_name: 'كريم',
            items: [{ id: 1, inventory_id: 5, item_name: 'أرز', unit: 'كجم', system_qty: '10', counted_qty: '8.5', avg_cost: '12' }],
        });
        expect(a).toMatchObject({
            id: 7, number: 'AUD-7', periodAr: 'أسبوعي', periodKnown: true,
            start: '2026-10-15', end: '', range: '2026-10-15 → 2026-10-15',
            totalItems: 12, status: 'draft', totalVarianceValue: -3.5, by: 'كريم',
        });
        expect(a.items[0]).toMatchObject({ id: 1, inventoryId: 5, name: 'أرز', nameResolved: true, unit: 'كجم', system: 10, counted: 8.5, variance: -1.5, avgCost: 12 });
        const bare = repo.auditToRow({ id: 9, period: 'weird' });
        expect(bare.number).toBe('#9');
        expect(bare.periodAr).toBe('weird');
        expect(bare.periodKnown).toBe(false);
        expect(bare.range).toBe('');
        const item = repo.auditItemToRow({ inventory_id: 5, system_qty: '4', counted_qty: null });
        expect(item).toMatchObject({ name: '#5', nameResolved: false, system: 4, counted: 0, variance: -4 });
    });

    test('documentToRow: الأصناف بصيغة القديم :97 حرفيًا والغائب «—»', () => {
        const { repo } = repoStub({});
        const d = repo.documentToRow({
            id: 3, source_name: 'الرئيسي', destination_name: null, created_at: '2026-10-15T10:00:00Z',
            items: [{ item_name: 'أرز', received_qty: null, requested_qty: '2.5' }, { item_name: 'سكر', received_qty: 4, requested_qty: 9 }],
        });
        expect(d).toEqual({ id: 3, from: 'الرئيسي', to: '—', date: '2026-10-15', itemsText: 'أرز (2.50)، سكر (4)' });
        expect(repo.documentToRow({ id: 4 }).itemsText).toBe('—');
        expect(repo.documentToRow({ id: 5, items: [] }).itemsText).toBe('');
        expect(source(LEGACY)).toContain("(${fN(i.received_qty||i.requested_qty)})");
    });
});

describe('kitchen.js — الشاشة: دورة المطبخ الكاملة بلا معالج سطري', () => {
    const src = () => source(SCREEN);

    test('لا inline handler ولا javascript: (CSP nonce يقتلهما أصلًا)', () => {
        expect(src()).not.toMatch(/\son(click|change|input|submit|load)=/);
        expect(src()).not.toMatch(/javascript:/);
        expect(src()).not.toMatch(/new Function|eval\(/);
    });

    test('لا باب شبكة إلا المستودع: لا apiFetch ولا fetch مباشرة', () => {
        const s = src().replace(/\/\*[\s\S]*?\*\//g, '');
        expect(s).not.toMatch(/\bapiFetch\b/);
        expect(s).not.toMatch(/\bfetch\(/);
        expect(s).toMatch(/from '\.\.\/data\/kitchen-repo\.js\?v=/);
    });

    test('الكتابات الست من أبوابها + التواقيع من signature.js المقفلة', () => {
        const s = src();
        for (const fn of ['createProduction', 'receiveKitchenTransfer', 'createKitchenAudit',
            'countKitchenAudit', 'submitKitchenAudit', 'approveKitchenAudit']) {
            expect(s).toMatch(new RegExp(`\\bawait ${fn}\\(`));
        }
        expect(s).toMatch(/from '\.\.\/signature\.js\?v=/);
        expect(s).toMatch(/readSignaturePad\(panelEl, id, signerName\)/);
        expect(s).toMatch(/initSignaturePad\(panelEl, SIG_IDS\.auditSend, signerName\)/);
        expect(s).toMatch(/initSignaturePad\(panelEl, SIG_IDS\.auditApprove, signerName\)/);
    });

    test('حمولات الكتابة منسوخة من القديم حرفًا عند مواضع الاستدعاء', () => {
        const s = src();
        expect(s).toContain('await createProduction(payload);');
        expect(s).toContain('await receiveKitchenTransfer(payload);');
        expect(s).toContain('await createKitchenAudit(auditPayload({ period, periodStart: start, periodEnd: end, notes: fieldVal(\'a-notes\') }));');
        expect(s).toMatch(/await countKitchenAudit\(raw\.id, \{ items: countPayload\(raw\.items, values\) \}\);/);
        expect(s).toContain('await submitKitchenAudit(raw.id, { signatureData: sig, signerName });');
        expect(s).toContain('await approveKitchenAudit(raw.id, { signatureData: sig, signerName });');
        // null الحمولة الفارغة يُطبع بالرسالة القديمة نفسها (:123)
        expect(s).toContain("if (!payload) {panelMsg('اختر صنفًا وأدخل كمية صحيحة'); return;}");
    });

    test('انحراف معلن ١: إرسال الجرد يقرأ التوقيع قبل حفظ العدّ — والقديم بالعكس مثبَّت', () => {
        const s = src();
        const send = s.slice(s.indexOf('async function submitAuditSend'), s.indexOf('async function submitAuditApprove'));
        expect(send.indexOf('readSig(SIG_IDS.auditSend)')).toBeGreaterThan(-1);
        expect(send.indexOf('readSig(SIG_IDS.auditSend)')).toBeLessThan(send.indexOf('countKitchenAudit'));
        expect(send).toContain('إصلاح معلن لوهدَة');
        // القديم :94 يحفظ العدّ أولًا ثم يقرأ التوقيع — الانحراف مقصود ومعلن
        const legacy = source(LEGACY);
        const legacySend = legacy.slice(legacy.indexOf('async function submitKitchenAudit'), legacy.indexOf('async function approveKitchenAudit'));
        expect(legacySend.indexOf("apiFetch(`/kitchen/audits/${id}/count`")).toBeLessThan(legacySend.indexOf("readSignaturePad('kitchenAuditSubmitSignature')"));
    });

    test('انحراف معلن ٢: تغيير صنف الاستلام يقلّص الحالة المخزَّنة لا الخانة وحدها', () => {
        const s = src();
        const clamp = s.slice(s.indexOf('function syncTransferMax'), s.indexOf('async function openTransferPanel'));
        expect(clamp).toContain('row.qty = max;');
        expect(clamp).toContain('qtyInput.value = String(max);');
        expect(clamp).toContain('إصلاح معلن');
        // القديم :120 كان يقلّص الخانة فقط والحالة القديمة تُرسل أكبر من المتاح
        const legacy = source(LEGACY);
        const legacyClamp = legacy.slice(legacy.indexOf('function syncKitchenTransferMax'), legacy.indexOf('async function submitKitchenStockReceive'));
        expect(legacyClamp).toContain('input.value=max;');
        expect(legacyClamp).not.toContain('inventory_id');
    });

    test('لا قرار موقّع بلا اسم حساب: الحارس قبل فتح اللوحة، ولوحتا الجرد بمعرّفيهما', () => {
        const s = src();
        expect(s).toMatch(/SIGN_KINDS = new Set\(\['audit-approve'\]\)/);
        expect(s).toMatch(/if \(SIGN_KINDS\.has\(kind\) && !signerName\)/);
        expect(s).toContain('اسم حسابك غير متاح في الجلسة — أعد تسجيل الدخول لتنفيذ قرار موقّع');
        expect(s).toContain("auditSend: 'v2kit-audit-send-sig'");
        expect(s).toContain("auditApprove: 'v2kit-audit-approve-sig'");
        // وقراءةُ التوقيع الفاشلة تُطبع برسائلها الأربع لا صامتة
        for (const msg of ['اسم الموقّع غير متاح في الجلسة — أعد تسجيل الدخول ثم حاول مجددًا',
            'التوقيع باسم حسابك فقط — لا يمكن توقيع اسم آخر',
            'تعذر رسم التوقيع — راجع خانة التوقيع',
            'تعذر تهيئة لوحة التوقيع — أعد فتح اللوحة']) {
            expect(s).toContain(msg);
        }
    });

    test('الاعتماد: تأكيد باسم صاحبه قبل اللوحة، والقبول للدور ولمن ينتظر الاعتماد فقط', () => {
        const s = src();
        const req = s.slice(s.indexOf('async function requestApprove'), s.indexOf('/* ── إرسال لوحات القرار'));
        // الفحوص قبل السؤال: الدور ثم الحالة ثم الاسم
        expect(req.indexOf('if (!canApprove)')).toBeLessThan(req.indexOf('confirmFn('));
        expect(req.indexOf('الجرد ليس بانتظار الاعتماد')).toBeLessThan(req.indexOf('confirmFn('));
        expect(req).toContain("await confirmFn('سيتم تسجيل فروقات الجرد في دفتر المخزون. هل تريد الاعتماد؟')");
        expect(req.indexOf('confirmFn(')).toBeLessThan(req.indexOf("openPanel('audit-approve', raw)"));
        // والقديم يسأل بالنص نفسه (kitchen.js:95)
        expect(source(LEGACY)).toContain("confirm('سيتم تسجيل فروقات الجرد في دفتر المخزون. هل تريد الاعتماد؟')");
        // زر الاعتماد يظهر لمن يملك الدور وعلى «بانتظار الاعتماد» فقط (نفس شرط :97)
        expect(s).toMatch(/const approve = canApprove && row\.status === 'submitted'/);
        expect(s).toContain('عرض/عد');
    });

    test('الإنشاء ثم إعادة القراءة ثم فتح العدّ — ردّ الإنشاء لا يحمل معرّفات الأصناف', () => {
        const s = src();
        const create = s.slice(s.indexOf('async function submitAuditCreate'), s.indexOf('async function submitAuditSave'));
        expect(create.indexOf('createKitchenAudit(')).toBeLessThan(create.indexOf('await readGovernance();'));
        expect(create.indexOf('await readGovernance();')).toBeLessThan(create.indexOf("openPanel('audit-count', row)"));
        expect(create).toContain('ردّ الإنشاء لا يحمل أصنافًا بمعرّفات');
        expect(create).toContain('جلسة الجرد غير موجودة');
        // ومعرّفات الأصناف مصدرها قراءة /kitchen/audits (json_agg فيها 'id',ai.id)
        expect(source(SERVER)).toContain("'id',ai.id");
        // ولوحة العدّ تُفتح بحالة يمكن عدّها فقط: مسودة + كتابة
        expect(s).toMatch(/const editable = a\.status === 'draft' && canWrite;/);
    });

    test('بوابة الكتابة بالدور قبل فتح أي لوحة كتابة — والقرار النهائي للخادم', () => {
        const s = src();
        expect(s).toMatch(/const canWrite = KITCHEN_WRITE_ROLES\.includes\(role\);/);
        expect(s).toMatch(/const canApprove = KITCHEN_APPROVE_ROLES\.includes\(role\);/);
        expect(s).toContain("if ((kind === 'production' || kind === 'transfer' || kind === 'audit-new') && !canWrite)");
        expect(s).toContain('لا صلاحية لهذا الإجراء بهذا الحساب — دورة المطبخ كتابةٌ لأدوار المخازن والمطبخ');
        expect(s).toContain("if (kind === 'audit-approve' && !canApprove)");
        expect(s).toContain('اعتماد الجرد لأدوار الاعتماد (أدمن · مدير · مراجع)');
        // وأزرار الكتابة الثلاثة تُخفى بلا كتابة
        expect(s).toMatch(/canWrite \? writeBtn\('data-v2-new-production', 'cooking-pot', 'أمر إنتاج'\) : ''/);
        expect(s).toMatch(/canWrite \? writeBtn\('data-v2-new-audit', 'plus', 'جرد جديد'\) : ''/);
        expect(s).toMatch(/canWrite \? writeBtn\('data-v2-new-transfer', 'inbox', 'استلام مواد'\) : ''/);
    });

    test('الحراس: أحدث قراءة تفوز (نظرة وحوكمة منفصلتان)، ولا رسم بعد destroy، وقرار واحد في المرة', () => {
        const s = src();
        expect(s).toMatch(/if \(loading\) \{queued = true; return;\}/);
        expect(s).toMatch(/if \(queued && el\.isConnected\) \{/);
        expect(s).toMatch(/if \(govLoading\) \{govQueued = true; return;\}/);
        expect(s).toMatch(/if \(govQueued && el\.isConnected\) \{/);
        expect(s).toMatch(/if \(!el\.isConnected\) \{return;\}/);
        expect(s).toMatch(/const panelAlive = \(seq\) => el\.isConnected && seq === panelSeq;/);
        // القرار الواحد: ثلاثة أبواب تفتح به — وكل مسار كتابة يرفعه ثم يُنزله
        expect(s.match(/if \(busy\) \{notify\('جارٍ تنفيذ عملية — انتظر النتيجة'\); return;\}/g)).toHaveLength(3);
        expect(s.match(/^\s+busy = true;/gm)).toHaveLength(6);
        // سبعة نزول: خمسة finally + مسارا الإنشاء (فشل/نجاح) — الإنشاء بلا finally
        // عمدًا لأن النجاح ينزل قبل فتح العدّ لا بعده
        expect(s.match(/^\s+busy = false;/gm)).toHaveLength(7);
        expect(s.match(/disposeSignaturePads\(ALL_SIG_IDS\);/g)).toHaveLength(2);
        // destroy واحد يحرّر خمسة جداول ولوحتين
        const destroy = s.slice(s.indexOf('destroy() {'));
        for (const t of ['panelSeq += 1;', 'table.destroy();', 'excTable.destroy();', 'polTable.destroy();',
            'auditTable.destroy();', 'docTable.destroy();', 'el.remove();']) {
            expect(destroy).toContain(t);
        }
    });

    test('الحوكمة قراءةٌ منفصلة: فشلها لا يمحو النظرة ولا العكس', () => {
        const s = src();
        expect(s).toMatch(/Promise\.all\(\[fetchKitchenAudits\(\), fetchKitchenDocuments\(\)\]\)/);
        const govErr = s.slice(s.indexOf('function paintGovernanceError'), s.indexOf('async function readGovernance'));
        expect(govErr).toMatch(/auditTable\.setError\(message\);/);
        expect(govErr).toMatch(/docTable\.setError\(message\);/);
        expect(govErr).not.toMatch(/table\.setError/);
        expect(govErr).not.toMatch(/batches = \[\]/);
        // والفتح والتحديث يقرآن الاثنين معًا — إعادة التحميل لا تترك سجلًا قديمًا
        expect(s).toMatch(/if \(event\.target\.closest\('\[data-v2-reload\]'\)\) \{reload\(\); readGovernance\(\); readCostCards\(\); return;\}/);
        expect(s).toMatch(/reload\(\);\n {4}readGovernance\(\);\n {4}readCostCards\(\);/);
    });

    test('مرشّح «ملغى» ميت: الباب لا يرسله (status IN draft,open,closed)', () => {
        const srv = source(SERVER);
        expect(srv).toMatch(/WHERE b\.status IN \('draft','open','closed'\)/);
        const states = src().slice(src().indexOf('const STATES'), src().indexOf('function clockNow'));
        expect(states).toContain("key: 'open'");
        expect(states).toContain("key: 'closed'");
        expect(states).not.toContain("'cancelled'");
        // وكلمات الرقائق نفسها من السجل: شريحةٌ لا تخترع اسمًا للونٍ في الجدول
        expect(states).toMatch(/resolveStatus\('production_batch', key\)/);
        expect(src()).toMatch(/statusBadge\('production_batch', row\.stateKey/);
    });

    test('الجداول الخمسة تُطعم جميعًا — الفشل لا يُسكت جدولًا', () => {
        const s = src();
        const paint = s.slice(s.indexOf('function paint()'), s.indexOf('function paintError'));
        expect(paint).toMatch(/table\.setRows\(shown\);/);
        expect(paint).toMatch(/excTable\.setRows\(exceptions\);/);
        expect(paint).toMatch(/polTable\.setRows\(policies\);/);
        const gov = s.slice(s.indexOf('function paintGovernance()'), s.indexOf('function paintGovernanceError'));
        expect(gov).toMatch(/auditTable\.setRows\(audits\);/);
        expect(gov).toMatch(/docTable\.setRows\(documents\);/);
        const err = s.slice(s.indexOf('function paintError'));
        for (const h of ['table', 'excTable', 'polTable']) {
            expect(err).toMatch(new RegExp(`${h}\\.setError\\(message\\);`));
        }
    });

    test('بنية المعيار المصدّق: رأس dash + سطر مدى + شريط KPI + portlet + سجلات + سطر مطبوعة', () => {
        for (const marker of ['erp-dash-head', 'erp-dash-controls', 'data-v2-scope-line', 'data-v2-kpis',
            'data-v2-stateseg', 'data-v2-window-note', 'erp-tops', 'erp-top__fill', 'data-v2-print-note',
            'data-v2-batches', 'data-v2-exceptions', 'data-v2-policies', 'data-v2-dist',
            'data-v2-audits', 'data-v2-docs', 'data-v2-gov-note', 'data-v2-panel']) {
            expect(src()).toContain(marker);
        }
        // المؤشرات تُدرج في الشبكة: ul.lp class="erp-kpis" ثم li.erp-kpi — لا ديفات
        expect(src()).toMatch(/<ul class="erp-kpis"/);
        expect(src()).toMatch(/<li class="erp-kpi">/);
        expect(src()).not.toMatch(/<div class="erp-kpi">/);
    });

    test('النافذة تُنطق في سطر المدى وسطر المطبوعة، والتحذير يظهر عند الامتلاء', () => {
        const s = src();
        expect(s).toContain('KITCHEN_WINDOW.batches');
        expect(s).toContain('capNote(');
        const paint = s.slice(s.indexOf('function paint()'), s.indexOf('function paintError'));
        expect(paint).toMatch(/windowNoteEl\.textContent = caps\.join/);
        expect(paint).toMatch(/نافذة الخادم/);
        expect(paint).toContain('printNote.textContent');
        expect(paint).toMatch(/جرد: \$\{audits\.length\} جلسة · مستندات: \$\{documents\.length\}/);
        // عدد المواقع انتقل من الشريط إلى سطر المدى — مع أساسه مكتوبًا
        expect(paint).toMatch(/locations\.length\} موقعًا نشطًا · آخر قراءة/);
        expect(paint).not.toMatch(/inventory_locations/);
        // والملخّاص يُبنى على ما حُمِل فعلًا، لا على مصفوفٍ فارغ يُمرَّر نيابة عنه
        expect(paint).toMatch(/summarizeKitchen\(batches, exceptions, locations, policies, distributions\)/);
        // وسقفا الحوكمة يُنطقان من ثابتيهما لا من رقمٍ حرفي في الشاشة
        expect(s).toMatch(/capNote\(audits\.length, GOVERNANCE_LIMITS\.audits, 'جلسات الجرد'\)/);
        expect(s).toMatch(/capNote\(documents\.length, GOVERNANCE_LIMITS\.documents, 'مستندات الحركة'\)/);
    });

    test('المعروف لا يُلمّح والمجهول يُعرض خامًا مع سبب', () => {
        expect(src()).toMatch(/حالة مخزنة غير متوقعة — تُعرض خامًا/);
        expect(src()).toMatch(/وضع مخزن غير معروف — يُعرض خامًا/);
        expect(src()).toMatch(/لا اسم مخزّن — يُعرض رقم السجل/);
        expect(src()).toMatch(/دورية مخزنة غير متوقعة — تُعرض خامًا/);
        // ولا invent للصف الغائب: حالة البورتليت الفارغة تنطق بالنافذة
        expect(src()).toMatch(/لا رقم مخترع لصف غائب/);
    });

    test('التصفية بالحالة شريحةٌ عميلة: نقرةٌ لا تكلِّف طلب شبكة', () => {
        const s = src();
        const paint = s.slice(s.indexOf('function paint()'), s.indexOf('function paintError'));
        expect(paint).toContain('batches.filter');
        const branch = s.slice(s.indexOf("closest('[data-v2-state]')"), s.indexOf('[data-v2-print]'));
        expect(branch).toMatch(/stateFilter = stateBtn\.dataset\.v2State;/);
        expect(branch).toMatch(/paint\(\);/);
        expect(branch).not.toMatch(/reload\(\)/);
        expect(branch).not.toMatch(/fetch/);
    });

    test('رسائل النجاح والفشل تحكي ما وقع فعلًا — منسوخة من القديم', () => {
        const s = src();
        // نجاحات :77/:124/:93/:94/:96 حرفيًا
        expect(s).toContain('تم تسجيل إنتاج ${legacyQty(payload.produced_qty)} وتوزيعه على ${n} جهات مع خصم المكونات من مخزن المطبخ');
        expect(s).toContain('تم استلام ${legacyQty(n)} صنف في مخزن المطبخ');
        expect(s).toContain("notify('تم حفظ كميات الجرد');");
        expect(s).toContain("notify('تم إرسال الجرد للاعتماد');");
        expect(s).toContain("notify('تم اعتماد الجرد وترحيل الفروقات');");
        // وفشلٌ برسالة الخادم أولًا ثم رسالة القديم نفسها (:77/:124/:93/:94/:96/:83)
        expect(s).toMatch(/panelMsg\(\(e && e\.message\) \|\| 'تعذر تسجيل الإنتاج والتوزيع'\)/);
        expect(s).toMatch(/panelMsg\(\(e && e\.message\) \|\| 'تعذر استلام مواد المطبخ؛ تحقق من رصيد المخزن الرئيسي'\)/);
        expect(s).toMatch(/panelMsg\(\(e && e\.message\) \|\| 'تعذر حفظ العد'\)/);
        expect(s).toMatch(/panelMsg\(\(e && e\.message\) \|\| 'تعذر إرسال الجرد'\)/);
        expect(s).toMatch(/panelMsg\(\(e && e\.message\) \|\| 'تعذر اعتماد الجرد'\)/);
        expect(s).toMatch(/panelMsg\(\(e && e\.message\) \|\| 'تعذر إنشاء الجرد'\)/);
        expect(s).toMatch(/تعذر قراءة أرصدة المخزن الرئيسي/);
        expect(s).toContain('موقع المخزن الرئيسي أو مخزن المطبخ غير مهيأ');
        // المكوّنات الفارغة تُدعى بالاستلام لا بالاختراع
        expect(s).toContain('مخزن المطبخ فارغ — لا توجد أصناف متاحة');
        expect(s).toContain('استلم المواد أولًا (من إذن صرف معتمد أو تحويل استثنائي) ثم عُد لإكمال الأمر.');
    });

    test('رسائل الخطأ الثلاثة من طبقة المضيف المصدّقة نفسها', () => {
        const s = src();
        expect(s).toContain("if (e && e.message === 'UNAUTHORIZED')");
        expect(s).toContain('انتهت الجلسة — سجّل الدخول في النظام الحالي ثم أعد فتح الوضع الحيّ.');
        expect(s).toContain("if (e && e.code === 'FORBIDDEN')");
        expect(s).toContain('لا صلاحية لعرض المطبخ بهذا الحساب — القرار للخادم وحده.');
        expect(s).toMatch(/تعذّر تحميل \$\{what\}: \$\{\(e && e\.message\) \|\| 'خطأ'\}/);
        expect(s).toMatch(/readErrorMessage\(e, 'نظرة المطبخ'\)/);
        expect(s).toMatch(/readErrorMessage\(e, 'سجل الجرد والمستندات'\)/);
    });

    test('أزرار الحالة تحمل aria-pressed والرموز تُروى عبر ji data-i', () => {
        expect(src()).toMatch(/aria-pressed="true"/);
        expect(src()).toMatch(/aria-pressed="false"/);
        expect(src()).toMatch(/<i class="ji" data-i="\$\{esc\(k\.icon\)\}"/);
    });

    test('انحراف معلن ٣: كل badge في اللوحة من بياناتٍ محسوبة هنا لا من نصٍّ مُختلق', () => {
        const s = src();
        // شارة «مكتمل/المتبقي» تُبنى من legacyQty على حالة النموذج — نص القديم :66 نفسه
        expect(s).toMatch(/الموزع: <strong class="erp-num" dir="ltr">\$\{esc\(legacyQty\(allocated\)\)\}<\/strong> من <strong class="erp-num" dir="ltr">\$\{esc\(legacyQty\(total\)\)\}<\/strong>/);
        expect(s).toContain('المتبقي: ${esc(legacyQty(diff))}');
        // وملاحظة فروق العدّ تُعاد حسبةً مع كل كتابة لا تُطبع مرة عند الفتح
        const upd = s.slice(s.indexOf('function updateVarianceNote'), s.indexOf('function collectAuditValues'));
        expect(upd).toContain('> 0.0005');
        expect(upd).toContain('أصناف بفرق: ${formatInt(withDiff)} من ${formatInt(raw.items.length)}');
    });

    test('كل رمز data-i ساكن موجود في وحدة الرموز — الغائب يسقط للاستفهام صامتًا', () => {
        const s = src();
        const icons = source(ICONS);
        // 'info' مستثنى عمدًا: هو نبرة flowNote وشكلٌ حقيقي في icons.js:95 في آنٍ
        // (flowNote('info','info',...)) — الممنوع اسمُ نبرة لا وجود له كرمز.
        const toneOnly = ['danger', 'success', 'warning', 'brand'];
        const names = new Set();
        for (const m of s.matchAll(/data-i="([a-z0-9-]+)"/g)) {names.add(m[1]);}
        for (const m of s.matchAll(/writeBtn\('[^']+',\s*'([a-z0-9-]+)'/g)) {names.add(m[1]);}
        for (const m of s.matchAll(/panel(?:Shell|Loading|Retry)\([^,]+,\s*'([a-z0-9-]+)'/g)) {names.add(m[1]);}
        for (const m of s.matchAll(/\bflowNote\('[a-z]+',\s*'([a-z0-9-]+)'/g)) {names.add(m[1]);}
        for (const m of s.matchAll(/panelActions\([^,]+,\s*'([a-z0-9-]+)'/g)) {names.add(m[1]);}
        expect(names.size).toBeGreaterThan(12);
        for (const n of names) {
            expect(icons).toContain(`'${n}':`);
            expect(n).not.toBe('circle-help');
        }
        for (const t of toneOnly) {expect(names.has(t)).toBe(false);}
    });

    test('المراجعة الواحدة في كل مستورَد', () => {
        for (const line of source(SCREEN).split('\n').filter((l) => /from '\.\.\//.test(l))) {
            expect(line).toContain(`?v=${REV}`);
        }
        expect(source(REPO)).toContain(`core/api.js?v=${REV}`);
    });
});

describe('preview.js — المضيف: لا نموذجيات وتلفيدٌ نظيف عند التنقّل', () => {
    const host = () => source(path.join(V2, 'preview.js'));
    const fn = () => {
        const p = host();
        return p.slice(p.indexOf('function renderKitchenScreen'), p.indexOf("/** Live read of /api/leaveRequests"));
    };

    test('الشاشة تُستورد بمراجعة الصفحة نفسها وتُركّب على مضيفها', () => {
        const rev = source(V2_HTML).match(/js\/v2\/preview\.js\?v=([0-9.]+)/)[1];
        expect(host()).toContain(`./screens/kitchen.js?v=${rev}`);
        expect(host()).toContain('data-v2-kitchen-host');
    });

    test('الوضع غير الحيّ لا يطبخ بيانات باسم المطبخ', () => {
        expect(fn()).toMatch(/if \(!isLive\(\)\)/);
        expect(fn()).toContain('لا تُعرض بيانات نموذجية في الوضع الحيّ');
        expect(fn()).toContain("noSessionState('المطبخ')");
    });

    test('W1-2: المضيف يمرر اسم الحساب (يقفل التواقيع) وconfirmFn', () => {
        expect(fn()).toMatch(/userName: String\(u\.name \|\| u\.username \|\| ''\),/);
        expect(fn()).toMatch(/confirmFn: \(message\) => window\.confirm\(message\),/);
        expect(fn()).toMatch(/const u = session\.user \|\| \{\};/);
        expect(fn()).toMatch(/notify: notifyTo\(note\),/);
        // والشاشة لا تسأل بنفسها خارج fallback المضيف الواحد
        expect(source(SCREEN).match(/window\.confirm\(/g)).toHaveLength(1);
    });

    test('المغادرة تُتلف الشاشة — لا شبحٌ يكتب على DOM بعد التنقّل', () => {
        expect(host()).toMatch(/kitchenScreen\.destroy\(\);/);
        expect(host()).toMatch(/kitchenScreen = null;/);
        expect(host()).toMatch(/navStatus\.current !== 'kitchen'/);
    });
});

describe('erp-ops.css — طبقة الموجة التشغيلية', () => {
    const css = () => source(OPS_CSS);

    test('مرتبطة في v2.html بنفس مراجعة preview.js (لا شاشة بملف قديم)', () => {
        const html = source(V2_HTML);
        const rev = html.match(/js\/v2\/preview\.js\?v=([0-9.]+)/)[1];
        expect(html).toContain(`css/v2/erp-ops.css?v=${rev}`);
        expect(html.match(/css\/v2\/erp-ops\.css\?v=[0-9.]+/g)).toHaveLength(1);
        // وتأتي بعد erp-hr.css لأن بعض قواعدها تعيد ضبط سلطاتها، وقبل كروم
        // المعاينة الذي لا يجب أن يورث شيئًا. (مواضع الوسوم لا أسماء الملفات:
        // رأس v2.html يذكر erp-preview.css في شرحه.)
        const linkPos = (name) => html.indexOf(`href="css/v2/${name}`);
        expect(linkPos('erp-hr.css')).toBeLessThan(linkPos('erp-ops.css'));
        expect(linkPos('erp-ops.css')).toBeLessThan(linkPos('erp-preview.css'));
    });

    test('لا ألوان ولا بكسلات خام: كل قيمة رمزٌ من --erp-*', () => {
        const body = css()
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .replace(/@media[^{]+\{/g, '');   // شرط الوسيط مقبول، القيم ليست كذلك
        // استثناء واحد مبيّن: نمط الإخفاء البصري (sr-only) — مقاس 1px وهو
        // سالب -1px لا يقابله رمز، وكلاهما من قياس الإخفاء لا من المسافات.
        const noSrOnly = body
            .replace(/inline-size:\s*1px\s*;/g, '')
            .replace(/block-size:\s*1px\s*;/g, '')
            .replace(/margin:\s*-1px\s*;/g, '');
        expect(noSrOnly).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
        expect(noSrOnly).not.toMatch(/rgba?\(/);
        expect(noSrOnly).not.toMatch(/\b\d+(px|rem|em)\b/);
        expect(body).toMatch(/var\(--erp-space-8\)/);
    });

    test('W1-2: لوحة المطبخ ومكوّناتها بقواعد رمزية قبل أول وسيط — والوسائط تبقى الأخيرة', () => {
        const full = css();
        for (const sel of ['.erp-v2-kitchen .erp-kitchen-panel {',
            '.erp-v2-kitchen .erp-kitchen-panel__head {',
            '.erp-v2-kitchen .erp-kitchen-panel__actions {',
            '.erp-v2-kitchen .erp-prod-step__num {',
            '.erp-v2-kitchen .erp-prod-line {',
            '.erp-v2-kitchen .erp-prod-grid {',
            '.erp-v2-kitchen .erp-mini-table {',
            '.erp-v2-kitchen .erp-signature {']) {
            expect(full).toContain(sel);
        }
        // ألوان السياق الخمسة بحصر المطبخ + بنت fallback للمتصفحات بلا color-mix
        for (const tone of ['info', 'warning', 'danger', 'success', 'brand']) {
            expect(full).toContain(`.erp-v2-kitchen .erp-flow-note[data-tone="${tone}"]`);
        }
        expect(full).toContain('@supports not (color-mix(in srgb, red 10%, transparent))');
        expect(full).toMatch(/\.erp-v2-kitchen \.erp-signature canvas \{[\s\S]*?background: white;/);
        // وترتيب السلطة: قواعد اللوحة قبل أول @media كي لا تُلغيها الوسائط بلا قصد
        const panelAt = full.indexOf('.erp-v2-kitchen .erp-kitchen-panel {');
        const firstMedia = full.indexOf('@media (max-width: 640px)');
        expect(panelAt).toBeGreaterThan(-1);
        expect(panelAt).toBeLessThan(firstMedia);
    });

    test('أهداف اللمس 40px محصورة في الشاشة، والحقول لا تُلمس', () => {
        const block = css().match(/@media \(max-width: 640px\)[\s\S]*?\n\}/)[0];
        for (const sel of ['.erp-seg button', '[data-erp-cols-toggle]', '.erp-table__pager .erp-btn', '.erp-table__pager .erp-select']) {
            expect(block).toContain(`.erp-v2-kitchen ${sel}`);
        }
        expect(block).toMatch(/min-block-size: var\(--erp-space-8\)/);
        // W1-2: أزرار اللوحة وعمود إجراءات الجرد أهداف إصبع أيضًا
        expect(block).toContain('.erp-v2-kitchen .erp-kitchen-panel__actions .erp-btn,');
        expect(block).toContain('.erp-v2-kitchen td.erp-v2-kitchen-actions .erp-btn {');
        // تسمية الزرّ تُخفى (display:none أو النمط البصري) ويبقى الرمز مقروءًا
        const labelRule = ruleBody(block, '.erp-v2-kitchen .erp-card__head .erp-btn > span');
        expect(labelRule).not.toBe('');
        expect(hidesLabel(labelRule)).toBe(true);
        expect(block).toContain('.erp-v2-kitchen [data-v2-gov-note] { overflow-wrap: anywhere; }');
        // الحقول: لا قاعدة ترفعها هنا — تبقى على ٣٨ المجمّد كما في 01–08
        expect(block).not.toMatch(/\.erp-v2-kitchen \.erp-input\s*\{[^}]*min-block-size/);
    });

    test('طباعةٌ شريفة: الأزرار تختفي والنافذة وسطر المدى يبقيان، واللوحة وعمود الإجراءات يسقطان', () => {
        const print = css().match(/@media print\s*\{[\s\S]*?\n\}/)[0];
        expect(print).toContain('.erp-v2-kitchen .erp-dash-controls { display: none; }');
        expect(print).not.toMatch(/window-note|scope-line/);   // لا إخفاء لأساس الأرقام
        expect(print).toContain('.erp-v2-kitchen [data-v2-panel] { display: none; }');
        expect(print).toContain('.erp-v2-kitchen [data-col="actions"],');
        expect(print).toContain('.erp-v2-kitchen td.erp-v2-kitchen-actions { display: none; }');
    });
});
