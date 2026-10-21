/**
 * v2-procurement.test.js — عقد موجة المشتريات V2 (05 الموردون · 06 الفواتير ·
 * 07 المدفوعات · 08 فواتير الشراء)
 * ═══════════════════════════════════════════════════════════════════════
 * نفس أسلوب tests/v2-reports.test.js: المستودع يُحمَّل في vm وبوابته apiFetch
 * مزيفة، والشاشات تُقرأ كعقد مصدر (testEnvironment:'node').
 *
 * المثبَّت هنا هو ما لا تُثبته العين في المتصفح:
 *   • بوابات الأدوار مرآةٌ لثوابت الخادم الحرفية في procurement-routes.js:25-28
 *     — لو غيّر أحدهما دون الآخر يسقط الاختبار
 *   • رسائل validateSupplierForm منطوقة من رفض الخادم نفسه (:183-188) — نفس
 *     الكلام سواء Catch المحلي أو الخادمي
 *   • مسارات الكتابة وطرقها تطابق راوتر الخادم (POST/PUT/DELETE على
 *     /suppliers، /suppliers/:id/toggle، /suppliers/:id، /invoices/:id/pay،
 *     /payments/:id) — والشاشات لا تملك بابًا آخر
 *   • حدف موردٍ له معاملات يرفضة الخادم 409 — لذا زرّ الحذف danger ولا حذف
 *     جماعي هنا؛ عكس الدفعة يلبس undo لا trash لأن المعنى محاسبي لا نفايات
 *   • المدى المقلوب بوابةٌ لا نتيجة: 07 ترفضة قبل الطلب (صفر استدعاءات) و08
 *     تسمّيه خطأ مطبعة بدل أن ترسم جدولًا فارغًا يقرأ كبيانات ناقصة — نفس
 *     قاعدة شاشة 04 (reports-repo.js:117)
 *   • الشاشات الأربع كلها: لا inline handler (CSP nonce)، حارس أحدث قراءة
 *     (queued)، عدم الكتابة بعد الانفصال (isConnected)، وتسديدٌ يظهر مبلغه
 *     قبل التنفيذ ولا يُعرض إلا لمتبقٍ > 0
 *   • طبقة erp-hr.css للموجة: رموز فقط لا ألوان خام، لفّ رؤوس الشاشات، أهداف
 *     لمس 40px، وكتلة المشتريات تأتي بعد كتلة التقارير لأن اختبار v2-reports
 *     يقرأ أول كتلة 640 — الترتيب جزء من التعاقد
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const APP = path.join(__dirname, '..', 'frontend', 'app');
const V2 = path.join(APP, 'js', 'v2');
const REPO = path.join(V2, 'data', 'procurement-repo.js');
const SCREENS = ['procurement', 'invoices', 'payments', 'wh-invoices']
    .map((n) => path.join(V2, 'screens', `${n}.js`));
const HR_CSS = path.join(APP, 'css', 'v2', 'erp-hr.css');
const V2_HTML = path.join(APP, 'v2.html');
const SERVER = path.join(__dirname, '..', 'backend', 'procurement-routes.js');
const REPORTS_REPO = path.join(V2, 'data', 'reports-repo.js');

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

const EXPORTS = ['fetchProcurementSummary', 'fetchSuppliers', 'PAYMENT_METHOD_AR',
    'SUPPLIER_WRITE_ROLES', 'PAYMENT_WRITE_ROLES', 'PAYMENT_DELETE_ROLES',
    'fetchSupplierPayments', 'rangeError', 'paymentToRow', 'supplierToRow',
    'validateSupplierForm',
    'normalizeSupplierForm', 'createSupplier', 'updateSupplier', 'toggleSupplier',
    'deleteSupplier', 'payInvoiceFull', 'payInvoicePartial', 'fetchSupplierStatement',
    'deletePayment'];

function repoStub(impl) {
    const calls = [];
    const apiFetch = jest.fn(async (p, opts) => {
        calls.push({ p, opts });
        return typeof impl === 'function' ? impl(p, calls.length) : impl;
    });
    // المستودع يستورد أدوات المال من reports-repo — تُحقن بديلاً عنها بعد تجريدها.
    const repo = loadEsm(REPO, {
        apiFetch,
        fetchCurrency: async () => 'ج.م',
        formatMoney: (v) => ({ amount: String(v), unit: '', hasUnit: false }),
        formatInt: (v) => String(v),
    }, EXPORTS);
    return { calls, repo };
}

const read = (f) => fs.readFileSync(f, 'utf8');
const screenSrc = {};
SCREENS.forEach((f) => { screenSrc[path.basename(f)] = read(f); });
const serverSrc = read(SERVER);

describe('موجة المشتريات — بوابات الأدوار مرآةُ الخادم', () => {
    test('الأدوار الثلاث تطابق ثوابت procurement-routes.js:25-28 حرفيًا', () => {
        const { repo } = repoStub([]);
        const serverConst = (name) => {
            const m = serverSrc.match(new RegExp(`const ${name} = \\[([^\\]]*)\\];`));
            return m[1].split(',').map((s) => s.trim().replace(/^'|'$/g, ''));
        };
        expect(repo.SUPPLIER_WRITE_ROLES).toEqual(serverConst('SUPPLIER_WRITE_ROLES'));
        expect(repo.PAYMENT_WRITE_ROLES).toEqual(serverConst('PAYMENT_WRITE_ROLES'));
        expect(repo.PAYMENT_DELETE_ROLES).toEqual(serverConst('PAYMENT_DELETE_ROLES'));
    });

    test('عكس الدفعة للأدمن وحده — والباب في شاشة 07 يُرسم بهذه البوابة', () => {
        const { repo } = repoStub([]);
        expect(repo.PAYMENT_DELETE_ROLES).toEqual(['admin']);
        expect(screenSrc['payments.js']).toMatch(/canWrite\(ctx\.role, PAYMENT_DELETE_ROLES\)/);
    });

    test('مفردات الدفع من قاموس الخادم؛ credit عرضٌ فقط لأن PAYMENT_METHODS لا تعرفه', () => {
        const { repo } = repoStub([]);
        const serverLabels = serverSrc.match(/const PAYMENT_METHOD_LABELS = \{([\s\S]*?)\};/)[1];
        for (const key of ['cash', 'bank', 'card', 'cheque']) {
            const m = repo.PAYMENT_METHOD_AR[key];
            expect(serverLabels).toContain(`${key}: '${m}'`);
        }
        expect(serverSrc.match(/PAYMENT_METHODS = new Set\(\[([^\]]*)\]\)/)[1])
            .not.toMatch(/credit/);
    });
});

describe('procurement-repo — القراءة: التلخيص، الدليل، الدفعات', () => {
    test('الملخص يُرقَّم كله؛ Null/undefined تصبح صفرًا بلا انفجار', async () => {
        const { calls, repo } = repoStub({ activeSuppliers: '4', dueTotal: '1250.5', unpaidInvoices: null });
        const s = await repo.fetchProcurementSummary();
        expect(calls[0].p).toBe('/procurement/summary');
        expect(s.activeSuppliers).toBe(4);
        expect(s.dueTotal).toBe(1250.5);
        expect(s.unpaidInvoices).toBe(0);
    });

    test('الدليل مصفوفة عارية كما يرسلها الخادم — و{data} مقبولة، والقمامة []', async () => {
        const bare = repoStub([{ id: 1, name: 'السمك' }]);
        expect(await bare.repo.fetchSuppliers()).toEqual([{ id: 1, name: 'السمك' }]);
        const wrapped = repoStub({ data: [{ id: 2 }] });
        expect(await wrapped.repo.fetchSuppliers()).toEqual([{ id: 2 }]);
        const junk = repoStub(null);
        expect(await junk.repo.fetchSuppliers()).toEqual([]);
    });

    test('باب الدفعات: مسلة الخادم SQL — supplierId موجب وتواريخ YYYY-MM-DD فقط، وإلا يُحذف الوسيط', async () => {
        const { calls, repo } = repoStub([]);
        await repo.fetchSupplierPayments({ supplierId: '7', from: '2026-10-01', to: '2026-10-14' });
        expect(calls[0].p).toBe('/procurement/payments?supplierId=7&from=2026-10-01&to=2026-10-14');
        await repo.fetchSupplierPayments({ supplierId: '-3', from: '14/10', to: '' });
        expect(calls[1].p).toBe('/procurement/payments');
    });

    test('سطر الدفعة: الطريقة من المفردات المرسومة، والمجهولة تُعرض خامًا، والمورد الغائب يُعلن', () => {
        const { repo } = repoStub([]);
        const r = repo.paymentToRow({ id: 5, date: '2026-10-14T00:00:00Z', method: 'bank', amount: '300' });
        expect(r.methodAr).toBe('تحويل بنكي');
        expect(r.date).toBe('2026-10-14');
        expect(r.supplier).toBe('—');
        expect(r.supplierResolved).toBe(false);
        const unknown = repo.paymentToRow({ id: 6, method: 'paypal', supplierId: 9 });
        expect(unknown.methodAr).toBe('paypal');
        expect(unknown.supplier).toBe('#9');
        expect(unknown.supplierResolved).toBe(false);
    });

    test('سطر المورد: is_active الكاذب بكل أشكاله «غير نشط»، والمستحق كما حسب الخادم', () => {
        const { repo } = repoStub([]);
        expect(repo.supplierToRow({ id: 1, name: 'أ', is_active: 'false' }).status).toBe('inactive');
        expect(repo.supplierToRow({ id: 1, name: 'أ', is_active: 0 }).status).toBe('inactive');
        const r = repo.supplierToRow({ id: 2, name: 'ب', dueTotal: '1200.25', lastPurchaseDate: '2026-10-02T12:00:00Z' });
        expect(r.dueTotal).toBe(1200.25);
        expect(r.lastPurchaseDate).toBe('2026-10-02');
    });
});

describe('بوابة المدى المقلوب — 07 ترفض قبل الطلب و08 تسمّي الخطأ', () => {
    const SENTENCE = 'بداية الفترة بعد نهايتها — صحّح التاريخين قبل العرض';

    test('rangeError: مقلوبٌ يعطي الجملة، وسليمٌ أو ناقصٌ يعطي الفراغ', () => {
        const { repo } = repoStub([]);
        expect(repo.rangeError('2026-10-14', '2026-10-01')).toBe(SENTENCE);
        expect(repo.rangeError('2026-10-01', '2026-10-14')).toBe('');
        expect(repo.rangeError('2026-10-14', '2026-10-14')).toBe('');
        expect(repo.rangeError('2026-10-14', '')).toBe('');
        expect(repo.rangeError('', '2026-10-01')).toBe('');
        expect(repo.rangeError('', '')).toBe('');
    });

    test('الرفض قبل الاستدعاء: صفر طلب شبكة — لا يُسأل الخادم عن مستحيل', async () => {
        const { calls, repo } = repoStub([]);
        await expect(repo.fetchSupplierPayments({ from: '2026-10-14', to: '2026-10-01' }))
            .rejects.toThrow(SENTENCE);
        expect(calls).toHaveLength(0);
    });

    test('لا بابٌ يخالف قاعدة شاشة 04 — reports-repo يرفض نفس الحالة', () => {
        expect(read(REPORTS_REPO)).toMatch(/if \(startDate > endDate\) \{/);
        expect(read(REPORTS_REPO)).toContain('بداية الفترة بعد نهايتها');
    });

    test('شاشة 07 تعرض رسالة البوابة لا جدولًا فارغًا (setError في مسار الفشل)', () => {
        expect(screenSrc['payments.js']).toMatch(/`تعذّر تحميل الدفعات: \$\{\(e && e\.message\)/);
        expect(screenSrc['payments.js']).toMatch(/table\.setRows\(\[\]\);[\s\S]*?table\.setError\(/);
    });

    test('شاشة 08 تفحص المدى قبل الرسم: لا inRange ولا جدول عند خطأ مطبعة', () => {
        const src = screenSrc['wh-invoices.js'];
        expect(src).toMatch(/const bad = rangeError\(pickedFrom, pickedTo\);/);
        const guard = src.slice(src.indexOf('function paint()'), src.indexOf('const { rows, filtered } = inRange'));
        expect(guard).toMatch(/table\.setError\(bad\);/);
        expect(guard).toMatch(/return;/);
        expect(guard).toMatch(/printNote\.textContent = `فواتير الشراء — \$\{bad\}`;/);
    });
});

describe('procurement-repo — validateSupplierForm: كلام الخادم حرفيًا', () => {
    const fieldsOf = (errors) => errors.map((e) => e.field);

    test('الاسم بين 2 و120 كما في :129 — والحدّان مقبولان', () => {
        const { repo } = repoStub([]);
        expect(repo.validateSupplierForm({ name: 'ك' })).toHaveLength(1);
        expect(repo.validateSupplierForm({ name: 'ا'.repeat(121) })).toHaveLength(1);
        expect(repo.validateSupplierForm({ name: 'ا'.repeat(120) })).toHaveLength(0);
    });

    test('الهاتف/البريد/السجل: نفس الأشكال الثلاثة المعلنة في الخادم :36-38', () => {
        const { repo } = repoStub([]);
        const repoSrc = read(REPO);
        const shapes = [
            ['PHONE_RE', 'PHONE_SHAPE', '/^[0-9+\\-\\s()]{0,30}$/'],
            ['EMAIL_RE', 'EMAIL_SHAPE', '/^\\S+@\\S+\\.\\S+$/'],
            ['CR_RE', 'CR_SHAPE', '/^[0-9A-Za-z-]{1,20}$/'],
        ];
        for (const [srv, local, literal] of shapes) {
            expect(serverSrc).toContain(`const ${srv} = ${literal};`);
            expect(repoSrc).toContain(`const ${local} = ${literal};`);
        }
        expect(fieldsOf(repo.validateSupplierForm({ name: 'مورد', phone: '0123abc' }))).toEqual(['phone']);
        expect(fieldsOf(repo.validateSupplierForm({ name: 'مورد', email: 'a@b' }))).toEqual(['email']);
        expect(fieldsOf(repo.validateSupplierForm({ name: 'مورد', commercial_register: 'سجل#1' }))).toEqual(['commercial_register']);
    });

    test('مسجل ضريبيًا بلا 15 رقمًا — وغيرُ مسجل برقم — بنفس جملتي الخادم', () => {
        const { repo } = repoStub([]);
        const reg = repo.validateSupplierForm({ name: 'مورد', tax_registration_status: 'REGISTERED' });
        expect(reg[0].message).toBe('المورد المسجل ضريبيًا يحتاج رقمًا ضريبيًا (15 رقمًا)');
        expect(serverSrc).toContain(reg[0].message);
        const not = repo.validateSupplierForm({ name: 'مورد', tax_registration_status: 'NOT_REGISTERED', vat_number: '302212427200003' });
        expect(not[0].message).toBe('المورد غير المسجل لا يقبل رقمًا ضريبيًا — اتركه فارغًا');
        expect(serverSrc).toContain(not[0].message);
    });

    test('رقم ضريبي غير رقمي مرفوض حتى للحالة غير المعلنة؛ 15 رقمًا لمسجل تمر', () => {
        const { repo } = repoStub([]);
        expect(fieldsOf(repo.validateSupplierForm({ name: 'مورد', vat_number: '3022x2427200003' }))).toContain('vat_number');
        expect(repo.validateSupplierForm({ name: 'مورد', tax_registration_status: 'REGISTERED', vat_number: '302212427200003' })).toHaveLength(0);
    });

    test('الرصيد الافتتاحي رقم غير سالب — والرسالة منطوقة من الخادم', () => {
        const { repo } = repoStub([]);
        const neg = repo.validateSupplierForm({ name: 'مورد', openingBalance: '-5' });
        expect(neg[0].message).toBe('الرصيد الافتتاحي يجب أن يكون رقمًا غير سالب');
        expect(serverSrc).toContain(neg[0].message);
        expect(repo.validateSupplierForm({ name: 'مورد', openingBalance: '' })).toHaveLength(0);
    });

    test('التطبيع: الفراغ null، الافتتاحي الفارغ 0، والحالة الغائبة NOT_REGISTERED', () => {
        const { repo } = repoStub([]);
        const n = repo.normalizeSupplierForm({ name: '  مورد  ', phone: '  ', openingBalance: '' });
        expect(n.name).toBe('مورد');
        expect(n.phone).toBeNull();
        expect(n.openingBalance).toBe(0);
        expect(n.tax_registration_status).toBe('NOT_REGISTERED');
    });
});

describe('procurement-repo — أبواب الكتابة الستة مطابقةُ الراوتر', () => {
    test('POST/PUT/toggle/DELETE على الموردين: المسارات من راوتر الخادم نفسه', async () => {
        const { calls, repo } = repoStub({});
        await repo.createSupplier({ name: 'مورد' });
        await repo.updateSupplier(7, { name: 'مورد' });
        await repo.toggleSupplier(7);
        await repo.deleteSupplier(7);
        expect(calls.map((c) => [c.p, c.opts && c.opts.method]))
            .toEqual([
                ['/procurement/suppliers', 'POST'],
                ['/procurement/suppliers/7', 'PUT'],
                ['/procurement/suppliers/7/toggle', 'POST'],
                ['/procurement/suppliers/7', 'DELETE'],
            ]);
        for (const r of ['router.post(\'/suppliers\'', 'router.put(\'/suppliers/:id\'',
            'router.post(\'/suppliers/:id/toggle\'', 'router.delete(\'/suppliers/:id\'']) {
            expect(serverSrc).toContain(r);
        }
    });

    test('الجسد المُرسَل هو التطبيع لا النمو الخام — والحالة الضريبية حاضرة دائمًا', async () => {
        const { calls, repo } = repoStub({});
        await repo.createSupplier({ name: '  مورد  ', vat_number: '' });
        const body = JSON.parse(calls[0].opts.body);
        expect(body).toEqual({
            name: 'مورد', name_en: null, phone: null, email: null, category: null,
            address: null, notes: null, openingBalance: 0,
            tax_registration_status: 'NOT_REGISTERED', vat_number: null, commercial_register: null,
        });
    });

    test('التسديد الكامل POST /invoices/:id/pay — والخادم يحسب المتبقي، والجسد الطريقة فقط', async () => {
        const { calls, repo } = repoStub({});
        await repo.payInvoiceFull(9, { method: 'cash' });
        expect(calls[0].p).toBe('/procurement/invoices/9/pay');
        expect(JSON.parse(calls[0].opts.body)).toEqual({ method: 'cash' });
        expect(serverSrc).toContain('router.post(\'/invoices/:id/pay\'');
    });

    test('عكس الدفعة DELETE /payments/:id بلا جسد — راوتره للأدمن وحده', async () => {
        const { calls, repo } = repoStub({});
        await repo.deletePayment(3);
        expect(calls[0].p).toBe('/procurement/payments/3');
        expect(calls[0].opts.method).toBe('DELETE');
        expect(serverSrc).toMatch(/router\.delete\('\/payments\/:id', jwtAuth, requireRole\(\.\.\.PAYMENT_DELETE_ROLES\)/);
    });

    test('حذفٌ بمعاملة: الخادم يرفض 409 SUPPLIER_HAS_TRANSACTIONS — والباب لا يعمل تحايله', async () => {
        const { repo } = repoStub(() => {
            const e = new Error('SUPPLIER_HAS_TRANSACTIONS');
            e.code = 'SUPPLIER_HAS_TRANSACTIONS';
            throw e;
        });
        await expect(repo.deleteSupplier(4)).rejects.toThrow('SUPPLIER_HAS_TRANSACTIONS');
        expect(serverSrc).toContain('SUPPLIER_HAS_TRANSACTIONS');
    });
});

describe('الشاشات الأربع — عقد المصدر', () => {
    test('لا inline handler إطلاقًا (CSP بنonce يسمح بـ \'self\' فقط)', () => {
        for (const src of Object.values(screenSrc)) {
            expect(src).not.toMatch(/\son(click|change|input|submit|keydown)=/);
        }
    });

    test('لا شاشة تلمس fetch مباشرة — البوابات في المستودع وحده', () => {
        for (const src of Object.values(screenSrc)) {
            expect(src).not.toMatch(/\bfetch\(/);
            expect(src).not.toMatch(/apiFetch/);
        }
    });

    test('كل شاشة تحمل حارس أحدث قراءة: loading → queued → إعادة عند الفراغ', () => {
        for (const src of Object.values(screenSrc)) {
            expect(src).toMatch(/if \(loading\) \{queued = true; return;\}/);
            expect(src).toMatch(/if \(queued && el\.isConnected\) \{/);
        }
    });

    test('لا إشعار ولا إعادة تحميل بعد الانفصال — الكتابة تنتهي لكن الواجهة رحلت', () => {
        expect(screenSrc['invoices.js']).toMatch(/navigated away mid-pay/);
        expect(screenSrc['wh-invoices.js']).toMatch(/navigated away mid-pay/);
        expect(screenSrc['payments.js']).toMatch(/navigated away mid-reversal/);
        expect(screenSrc['procurement.js']).toMatch(/The server's sentence stays verbatim/);
    });

    test('التسديد الكامل (06/08): لا يظهر إلا لمتبقٍ > 0، وتأكيدُه يقول المبلغ حرفيًا', () => {
        for (const n of ['invoices.js', 'wh-invoices.js']) {
            expect(screenSrc[n]).toMatch(/row\.remaining > 0/);
            expect(screenSrc[n]).toMatch(/payInvoiceFull\(id, \{ method: 'cash' \}\)/);
            expect(screenSrc[n]).toMatch(/confirmFn\(`تسديد كامل للفاتورة \$\{row\.number\} — \$\{amount\}/);
        }
    });

    test('عكس الدفعة (07): undo لا trash، وdanger لا زرّ محايد، والتأكيد يقول «لا تراجع»', () => {
        const src = screenSrc['payments.js'];
        expect(src).toMatch(/data-v2-act="void"[^>]*>[\s\S]*?data-i="undo"/);
        expect(src).toMatch(/erp-btn--sm erp-btn--danger" data-v2-act="void"/);
        expect(src).toMatch(/لا تراجع/);
        expect(src).not.toMatch(/data-i="trash"/);
    });

    test('حذف المورد (05): danger صريح، والخادم يرفض ذا المعاملات — والجملة تُعرض كما هي', () => {
        const src = screenSrc['procurement.js'];
        expect(src).toMatch(/erp-btn--sm erp-btn--danger" data-v2-act="delete"/);
        expect(src).toMatch(/deleteSupplier/);
    });

    test('فواتير الشراء (08) لا تدّعي «قراءة فقط» ولا «لا أزرار كتابة» مع أن فيها تسديدًا', () => {
        const src = screenSrc['wh-invoices.js'];
        expect(src).not.toContain('Write buttons (new invoice, pay, delete-all) do not exist here');
        expect(src).not.toMatch(/<p[\s\S]*?قراءة فقط/);
        expect(src).toMatch(/شاشة فواتير الموردين \(06\) تقرأ نفس السجل بعدسة/);
        expect(src).toMatch(/ودليل الموردين هو شاشة \(05\)/);
    });

    test('شاشة 08 تحمل سطر مطبوعةٍ يقول المدى والعدد — وزرّ الطباعة موجود', () => {
        const src = screenSrc['wh-invoices.js'];
        expect(src).toMatch(/data-v2-print-note/);
        expect(src).toMatch(/المطبوعة تعرض الصفحة الحالية من الجدول/);
        expect(src).toMatch(/data-v2-print\]/);
    });

    test('فلاتر Dates تعيد القراءة عند change لا بالـEnter وحده (07) — و08 ترسم من عملائها', () => {
        expect(screenSrc['payments.js']).toMatch(/matches\('\[data-v2-sup\], #v2pay-from, #v2pay-to'\)/);
        expect(screenSrc['payments.js']).not.toMatch(/event\.key === 'Enter'/);
        expect(screenSrc['wh-invoices.js']).toMatch(/#v2whi-from, #v2whi-to'\)\) \{paint\(\);\}/);
    });
});

describe('طبقة erp-hr.css — موجة المشتريات', () => {
    const css = () => read(HR_CSS);

    test('رؤوس الشاشات الأربع تلتفّ — السطر الواحد الذي لا ينثني كان يُفيض الصفحة أفقيًا', () => {
        const block = css().match(/\.erp-v2-procurement \.erp-card__head,[\s\S]*?\{ flex-wrap: wrap; \}/);
        expect(block).not.toBeNull();
        for (const s of ['.erp-v2-invoices', '.erp-v2-payments', '.erp-v2-whinvoices']) {
            expect(block[0]).toContain(`${s} .erp-card__head`);
        }
    });

    test('زرّ الهدم يلبس رموز الخطر فقط — لا لون خام في الملف كله', () => {
        expect(css()).toMatch(/\.erp-v2 \.erp-btn--danger \{[\s\S]*?--erp-danger-text[\s\S]*?--erp-danger\);/);
        expect(css()).toMatch(/\.erp-v2 \.erp-btn--danger:hover:not\(:disabled\) \{ background: var\(--erp-danger-soft\); \}/);
        expect(css()).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
        expect(css()).not.toMatch(/rgba?\(/);
    });

    test('كتلة المشتريات 640 تأتي بعد كتلة التقارير — اختبار v2-reports يقرأ الأولى', () => {
        const firstMedia = css().search(/@media \(max-width: 640px\) \{/);
        const reportsBlock = css().indexOf('.erp-v2-reports .erp-dash-head');
        const procurementBlock = css().indexOf('.erp-v2-procurement .erp-card__title');
        expect(firstMedia).toBeLessThan(reportsBlock);
        expect(reportsBlock).toBeLessThan(procurementBlock);
    });

    test('أهداف اللمس 40px لأزرار الرؤوس وصفوف الإجراءات في الأربع', () => {
        const block = css().match(/\/\* موجة المشتريات على الموبايل[\s\S]*?\n\}/);
        expect(block).not.toBeNull();
        expect(block[0]).toMatch(/min-block-size: var\(--erp-space-8\);/);
        for (const s of ['procurement', 'invoices', 'payments', 'whinvoices']) {
            expect(block[0]).toContain(`.erp-v2-${s}`);
        }
    });

    test('القياس الميداني مفروض: شريط الأقسام وزرّ الأعمدة والمُرقِّم كلها 40px، والحقول تبقى 38', () => {
        const block = css().match(/\/\* موجة المشتريات على الموبايل[\s\S]*?\n\}/)[0];
        const targets = block.slice(block.indexOf('أزرار الرأس وأزرار الإجراءات'), block.indexOf('min-block-size'));
        for (const sel of ['.erp-seg button', '[data-erp-cols-toggle]', '.erp-table__pager .erp-btn', '[data-v2-act]']) {
            for (const s of ['procurement', 'invoices', 'payments', 'whinvoices']) {
                expect(targets).toContain(`.erp-v2-${s} ${sel}`);
            }
        }
        // الحقول المجمّدة (erp-control-md = ٣٨) مذكّرة بالاسم: رفعها وحدها
        // كان يجعل سطر التصفية غير متكافئ — القرار موثّق لا منسيّ.
        expect(block).toMatch(/erp-control-md = ٣٨/);
    });

    test('المطبوعة تُخفي أزرار شاشة 08 وحقولها — والمنطق يُقرأ من سطر المطبوعة', () => {
        const printBlocks = [...css().matchAll(/@media print \{([\s\S]*?)\n\}/g)].map((m) => m[1]);
        const joined = printBlocks.join('\n');
        expect(joined).toMatch(/\.erp-v2-whinvoices \.erp-card__head \.erp-btn,[\s\S]*?display: none; /);
    });

    test('الموجة محصورة بشاشاتها: لا قاعدة مشتريات تمس شاشات 01–04 ولا العكس', () => {
        expect(css()).not.toMatch(/\.erp-v2-(attendance|employees|warehouse|reports) \.erp-card__head/);
        expect(css()).not.toMatch(/\.erp-v2-(procurement|invoices|payments|whinvoices) \.erp-dash-head/);
    });
});

describe('الرسوم والثوابت — لا انفجار تخزيني ولا ادعاء كاذب', () => {
    test('كل استيراد في المستودع والشاشات الأربع يساوي مراجعة الصفحة نفسها', () => {
        const ver = read(V2_HTML).match(/js\/v2\/preview\.js\?v=([0-9.]+)/)[1];
        for (const f of [REPO, ...SCREENS]) {
            for (const m of read(f).matchAll(/from '\.[^']*?(\?v=[0-9.]+)'/g)) {
                expect(m[1]).toBe(`?v=${ver}`);
            }
        }
    });

    test('شراء 06 لا باب حذف له، و07 لا باب تسديد — كل شاشة بوابتها فقط', () => {
        expect(screenSrc['invoices.js']).not.toMatch(/deleteSupplier|deletePayment/);
        expect(screenSrc['payments.js']).not.toMatch(/payInvoiceFull/);
        expect(screenSrc['wh-invoices.js']).not.toMatch(/deleteSupplier|deletePayment/);
    });

    test('05 تقول صراحةً إن فواتير 06 ومدفوعات 07 شاشتان مستقلتان — لا طيّ صامت', () => {
        expect(screenSrc['procurement.js']).toMatch(/شاشتان مستقلتان \(06\/07\)/);
    });
});

describe('P1-4 — كشف الحساب والدفعة الجزئية: البابان مطابقان للراوتر', () => {
    test('fetchSupplierStatement: GET /suppliers/:id/statement — نفس الباب :678 و READ_ROLES', async () => {
        const { calls, repo } = repoStub({ statement: { rows: [], totals: {} } });
        await repo.fetchSupplierStatement(7, { from: '2026-10-01', to: '2026-10-14' });
        expect(calls[0].p).toBe('/procurement/suppliers/7/statement?from=2026-10-01&to=2026-10-14');
        expect(calls[0].opts && calls[0].opts.method).toBeUndefined();   // GET عادي
        expect(serverSrc).toContain('router.get(\'/suppliers/:id/statement\'');
        expect(serverSrc).toMatch(/router\.get\('\/suppliers\/:id\/statement', jwtAuth, requireRole\(\.\.\.READ_ROLES\)/);
    });

    test('المدى الخاطئ يُهمل لا يُرسل — البوابتان تتساقطان مع normalizeDay في الخادم :62-66', async () => {
        const { calls, repo } = repoStub({});
        await repo.fetchSupplierStatement(7, { from: '14/10/2026', to: 'yesterday' });
        expect(calls[0].p).toBe('/procurement/suppliers/7/statement');   // بلا query أصلًا
        expect(serverSrc).toContain('function normalizeDay(value)');
    });

    test('payInvoicePartial: POST /payments — الجسد أرقام ومفاتيح مشروطة، والباب :722 هو صاحبه', async () => {
        const { calls, repo } = repoStub({});
        await repo.payInvoicePartial(9, { supplierId: '7', amount: '40.5', method: 'bank', date: '2026-10-17' });
        expect(calls[0].p).toBe('/procurement/payments');
        expect(calls[0].opts.method).toBe('POST');
        expect(JSON.parse(calls[0].opts.body)).toEqual({
            supplierId: 7, amount: 40.5, method: 'bank', date: '2026-10-17', invoiceId: 9,
        });
        // دفعة على الحساب: بلا فاتورة ولا ملاحظات — المفتاح الغائب لا يُرسل أصلًا
        await repo.payInvoicePartial(null, { supplierId: 7, amount: 10, date: '2026-10-17' });
        expect(JSON.parse(calls[1].opts.body)).toEqual({
            supplierId: 7, amount: 10, method: 'cash', date: '2026-10-17',
        });
        expect(serverSrc).toMatch(/router\.post\('\/payments', jwtAuth, requireRole\(\.\.\.PAYMENT_WRITE_ROLES\)/);
    });

    test('الخادم وحده يحكم المتبقي: AMOUNT_EXCEEDS_REMAINING 422 — الباب لا يحسم ولا يتجاوز', () => {
        expect(serverSrc).toContain('AMOUNT_EXCEEDS_REMAINING');
        expect(serverSrc).toMatch(/if \(v\.clean\.amount > remaining\)/);
        // المستودع لا يحسب متبقيًا ولا يرفض مبلغًا محليًا — الرفض قرار الخادم وحده
        const repoSrc = read(REPO);
        expect(repoSrc).not.toContain('AMOUNT_EXCEEDS_REMAINING');
        expect(repoSrc).not.toMatch(/totalAmount\s*-|-\s*Number\(.*paidAmount/);
    });

    test('شاشة 06 تسدّد جزئيًا: نموذج مربوط بالفاتورة، وحارس المتبقي للمشغّل، والخادم يبقى الحاكم', () => {
        const s = screenSrc['invoices.js'];
        expect(s).toMatch(/import \{[\s\S]*?payInvoiceFull, payInvoicePartial,[\s\S]*?\} from '\.\.\/data\/procurement-repo\.js\?v=/);
        expect(s).toMatch(/data-v2-act="pay-part"/);
        expect(s).toMatch(/actBtn\.dataset\.v2Act === 'pay-part'/);
        // لا يظهر الزر لفاتورة بلا مورد (الخادم يرفضها 422) ولا لمتبقٍ صفر
        expect(s).toMatch(/row\.supplierId\s*\? `<button[^`]*data-v2-act="pay-part"/);
        // الحارس المحلي يمنع ما يراه المشغّل فقط؛ الخادم يعيد الحساب دائمًا
        expect(s).toMatch(/amount > row\.remaining \+ 0\.005/);
        expect(s).toMatch(/payInvoicePartial\(row\.id, \{/);
        expect(s).toMatch(/supplierId: row\.supplierId, amount, method, date, notes/);
        expect(s).toMatch(/confirmFn\(`تسجيل دفعة/);
        expect(s).toMatch(/const res = await payInvoicePartial/);
    });

    test('شاشة 05: زر الكشف في صفّ المورد، والمعالج يفتحه قبل الإجراءات الأخرى', () => {
        const src = screenSrc['procurement.js'];
        expect(src).toMatch(/data-v2-act="statement" data-id=/);
        expect(src).toMatch(/if \(actBtn\.dataset\.v2Act === 'statement'\) \{\s*openStatement\(actBtn\.dataset\.id\);/);
        expect(src).toMatch(/from '.*procurement-repo\.js\?v=[0-9.]+'/);
    });

    test('شاشة 05: زر التعديل يفتح النموذج بسجل المورد الخام ولا يمر بمسار الإجراءات', () => {
        const src = screenSrc['procurement.js'];
        expect(src).toMatch(/data-v2-act="edit" data-id=/);
        expect(src).toMatch(/if \(actBtn\.dataset\.v2Act === 'edit'\) \{\s*const row = rows\.find\(\(item\) => String\(item\.id\) === String\(actBtn\.dataset\.id\)\);\s*if \(row\) \{openForm\(row\);\}\s*return;/);
        expect(src).toMatch(/const raw = row \? rawById\.get\(String\(row\.id\)\) : null;\s*editing = raw \? \{ \.\.\.raw \} : null;/);
    });

    test('اللوحة تُغلق عند التنقل: closeStatement تفكك النقر خارج ثم تزيل — ولا تعلّق عقدة ميتة', () => {
        const src = screenSrc['procurement.js'];
        // الدالة الموحّدة: تفكّك المعالج ثم تزيل اللوحة، وتُستدعى من destroy
        const fn = src.slice(src.indexOf('function closeStatement()'), src.indexOf('async function openStatement'));
        expect(fn).toMatch(/document\.removeEventListener\('click', statementOutside, true\);/);
        expect(fn).toMatch(/statementPop\.remove\(\); statementPop = null;/);
        expect(fn.indexOf('removeEventListener')).toBeLessThan(fn.indexOf('statementPop.remove'));
        const destroy = src.slice(src.indexOf('destroy() {'), src.indexOf('},', src.indexOf('destroy() {')));
        expect(destroy).toMatch(/closeStatement\(\);/);
        expect(destroy.indexOf('closeStatement')).toBeLessThan(destroy.indexOf('el.remove()'));
    });

    test('النقر خارج اللوحة يغلقها — بحصاد capture، ويستثنى زر الكشف نفسه', () => {
        const src = screenSrc['procurement.js'];
        expect(src).toMatch(/statementOutside = \(ev\) => \{/);
        expect(src).toMatch(/document\.addEventListener\('click', statementOutside, true\);/);
        expect(src).toMatch(/!t\.closest\('\[data-v2-act="statement"\]'\)/);
        // إغلاق الزر يستدعي الدالة الموحّدة لا معالجًا مجمّعًا آخر
        expect(src).toMatch(/\.erp-statement-pop__close'\)\.addEventListener\('click', closeStatement\);/);
    });

    test('قراءة متأخرة بعد الإغلاق لا تسقط: body مفقود = صمت لا استثناء (لا null.replace)', () => {
        const src = screenSrc['procurement.js'];
        expect(src).toMatch(/const data = await fetchSupplierStatement\(row\.id\);\s*const body = statementPop\.querySelector\('\[data-v2-st-body\]'\);\s*if \(!data \|\| !body\) \{return;\}/);
    });

    test('طبقة erp-hr.css: اللوحة كاملة داخل .erp-v2 وبرموز tokens فقط — لا hex ولا rgba', () => {
        const css = read(HR_CSS);
        expect(css).toMatch(/\.erp-v2 \.erp-statement-pop \{/);
        expect(css).toMatch(/\.erp-v2 \.erp-statement-pop__row\.total \{/);
        const block = css.slice(css.indexOf('.erp-v2 .erp-statement-pop {'), css.indexOf('.erp-v2 .erp-statement-pop__date'));
        expect(block).toMatch(/var\(--erp-/);
        expect(block).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
        expect(block).not.toMatch(/rgba?\(/);
    });
});
