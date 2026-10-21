/**
 * v2-dept-cards.test.js — عقد بطاقات الأقسام وربط الكاشير (V2)
 * ═══════════════════════════════════════════════════════════════════════
 * طلب المالك 2026-10-19: «كل قسم بكارت شيك احترافي ثيماتي» + «أقدر أربط
 * القسم بالكاشير المعين». المثبّت هنا:
 *   1) مستودع الروابط: تطبيع رقم الكاشير، قواعد التحقق، مصدر الأرقام
 *      (روابط 103 أولًا، والخريطة المدمجة احتياطًا) — بلا خلط المصدرين.
 *   2) علم v2deptcashier ظاهرٌ افتراضيًا و`=0` يُخفيه (طلب المالك: الأوبشن في الواجهة).
 *   3) قاعدة 103 + تسجيل الكيان في الباب العام + حرس الخادم في المسارين.
 *   4) الشاشة: البطاقات تُستخدم نفس حساب القديم، ولا معالج مضمّن (on=…).
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const APP = path.join(ROOT, 'frontend', 'app');
const V2 = path.join(APP, 'js', 'v2');
const REPO = path.join(V2, 'data', 'dept-cashier-repo.js');
const FLAGS = path.join(V2, 'write-flags.js');
const SCREEN = path.join(V2, 'screens', 'departments.js');
const CSS = path.join(APP, 'css', 'v2', 'erp-departments.css');
const V2_HTML = path.join(APP, 'v2.html');
const MIGRATION = path.join(ROOT, 'database', 'migrations', '103_dept_cashier_links.sql');
const SERVER = path.join(ROOT, 'backend', 'server.js');

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

/* شجرة الأقسام المستخدمة في الاختبارات: كافيه أب، وتحته حلواني */
const DEPARTMENTS = [
    {code: 'CAF', name: 'الكافيه', parent_code: ''},
    {code: 'sweets', name: 'الحلواني', parent_code: 'CAF'},
    {code: 'kitchen', name: 'المطبخ', parent_code: ''},
];

/** مرآة deptWithChildren في finance-repo: الكود + كل الأبناء تتابعيًا. */
function deptWithChildren(departments, code) {
    const out = new Set([String(code)]);
    const kids = new Map();
    (departments || []).forEach((d) => {
        const p = d && d.parent_code ? String(d.parent_code) : '';
        const c = d && d.code ? String(d.code) : '';
        if (!p || !c || p === c) {return;}
        if (!kids.has(p)) {kids.set(p, []);}
        kids.get(p).push(c);
    });
    const stack = [String(code)];
    while (stack.length) {
        for (const k of (kids.get(stack.pop()) || [])) {
            if (!out.has(k)) {out.add(k); stack.push(k);}
        }
    }
    return out;
}

function repoCtx(extra = {}) {
    const calls = [];
    const apiFetch = jest.fn(async (p, opts) => {
        calls.push({path: p, method: (opts && opts.method) || 'GET', body: opts && opts.body});
        return [];
    });
    const ctx = loadEsm(REPO, {
        apiFetch,
        fetchEntityNewest: jest.fn(async () => []),
        deptWithChildren,
        CASHIER_DEPT_MAP: {1: 'CAF', 4: 'external_sales', 5: 'external_sales', 6: 'G', 9: 'open_buffet'},
        ...extra,
    }, ['normalizeCashierNo', 'isValidCashierNo', 'validateLinkForm', 'deptLinkRows',
        'deptCashierNos', 'deptNameOf', 'createDeptCashierLink', 'deleteDeptCashierLink',
        'updateDeptCashierLink', 'LINKS_ENTITY', 'DEPT_CASHIER_WRITE_ROLES',
        'fetchYaraCashiers', 'cashierNameOf', 'cashierLabel']);
    ctx.__calls = calls;
    return ctx;
}

describe('مستودع روابط الكاشير — التحقق والمصدر', () => {
    test('رقم الكاشير أرقام فقط، ومسافات الأطراف تُهمل', () => {
        const ctx = repoCtx();
        expect(ctx.normalizeCashierNo('  9 ')).toBe('9');
        expect(ctx.isValidCashierNo('12')).toBe(true);
        expect(ctx.isValidCashierNo('1a')).toBe(false);
        expect(ctx.isValidCashierNo('1234567')).toBe(false);
    });

    test('payload الربط يُطبَّع: علم أساسي حقيقي وملاحظات مقطوعة عند 255', () => {
        const ctx = repoCtx();
        const ok = ctx.validateLinkForm({dept_code: ' CAF ', cashier_no: '9', is_primary: '1', notes: 'ن'.repeat(300)});
        expect(ok.ok).toBe(true);
        expect(ok.payload).toEqual({
            dept_code: 'CAF', cashier_no: '9', is_primary: true, notes: 'ن'.repeat(255),
        });
        expect(ctx.validateLinkForm({dept_code: '', cashier_no: '9'}).message).toBe('اختر القسم أولًا');
        expect(ctx.validateLinkForm({dept_code: 'CAF', cashier_no: ''}).message).toBe('رقم الكاشير مطلوب');
        expect(ctx.validateLinkForm({dept_code: 'CAF', cashier_no: '٩'}).ok).toBe(false);
    });

    test('المصدر: روابط القاعدة تتقدّم، والخريطة المدمجة احتياط صفر فقط', () => {
        const ctx = repoCtx();
        const empty = ctx.deptCashierNos('CAF', {links: [], departments: DEPARTMENTS});
        expect(empty).toEqual({nos: ['1'], source: 'map'});
        const dbOnly = ctx.deptCashierNos('CAF', {
            links: [{dept_code: 'sweets', cashier_no: '22', is_primary: true}],
            departments: DEPARTMENTS,
        });
        expect(dbOnly).toEqual({nos: ['22'], source: 'db'});
        // قسم لا رابط له في القاعدة لا يرث خريطة قسم آخر
        const kitchen = ctx.deptCashierNos('kitchen', {
            links: [{dept_code: 'CAF', cashier_no: '7', is_primary: true}],
            departments: DEPARTMENTS,
        });
        expect(kitchen).toEqual({nos: [], source: 'map'});
    });

    test('صفوف الروابط: الأساسي أولًا، والوارث من القسم الفرعي موسوم', () => {
        const ctx = repoCtx();
        const rowsOf = ctx.deptLinkRows('CAF', [
            {id: 2, dept_code: 'sweets', cashier_no: '5', is_primary: true, notes: ''},
            {id: 1, dept_code: 'CAF', cashier_no: '9', is_primary: false, notes: 'مناوبة'},
            {id: 3, dept_code: 'CAF', cashier_no: '1', is_primary: true, notes: ''},
        ], DEPARTMENTS);
        expect(rowsOf.map((r) => r.cashierNo)).toEqual(['1', '5', '9']);
        expect(rowsOf[0]).toEqual({id: 3, cashierNo: '1', deptCode: 'CAF', isPrimary: true, notes: '', inherited: false});
        expect(rowsOf[1]).toMatchObject({id: 2, cashierNo: '5', inherited: true, isPrimary: true});
        expect(rowsOf[2]).toMatchObject({id: 1, cashierNo: '9', inherited: false, isPrimary: false});
    });

    test('الباب العام نفسه: POST/PUT/DELETE على /dept_cashier_links بلا مسار جديد', () => {
        const ctx = repoCtx();
        expect(ctx.LINKS_ENTITY).toBe('dept_cashier_links');
        expect(ctx.DEPT_CASHIER_WRITE_ROLES).toEqual(['admin', 'manager']);
        ctx.createDeptCashierLink({dept_code: 'CAF', cashier_no: '9', is_primary: true, notes: null});
        ctx.updateDeptCashierLink(17, {is_primary: true});
        ctx.deleteDeptCashierLink(17);
        const calls = ctx.__calls;
        expect(calls.map((c) => c.method)).toEqual(['POST', 'PUT', 'DELETE']);
        expect(calls[0].path).toBe('/dept_cashier_links');
        expect(calls[1].path).toBe('/dept_cashier_links/17');
        expect(calls[2].path).toBe('/dept_cashier_links/17');
    });

    test('deptNameOf: اسم القسم known وإلا الكود الخام', () => {
        const ctx = repoCtx();
        expect(ctx.deptNameOf('sweets', DEPARTMENTS)).toBe('الحلواني');
        expect(ctx.deptNameOf('ghost', DEPARTMENTS)).toBe('ghost');
    });
});

describe('دليل كاشيرات يارا سوفت — الباب القائم بلا اسم مُختَرع', () => {
    /** apiFetch مزوّر يُرجئ صفوف cashiers-live كما يُرجعها الخادم. */
    function dirCtx(cashiers) {
        const paths = [];
        const apiFetch = jest.fn(async (p) => { paths.push(p); return {cashiers}; });
        const ctx = loadEsm(REPO, {
            apiFetch,
            fetchEntityNewest: jest.fn(async () => []),
            deptWithChildren,
            CASHIER_DEPT_MAP: {},
        }, ['fetchYaraCashiers', 'cashierNameOf', 'cashierLabel', 'normalizeCashierNo']);
        ctx.__paths = paths;
        return ctx;
    }

    test('الباب cashiers-live نفسه: لا مسار خادم جديد للروابط', async () => {
        const ctx = dirCtx([{cashier_no: '9', name: 'الكافيه', dept_code: 'CAF'}]);
        const out = await ctx.fetchYaraCashiers();
        expect(ctx.__paths).toEqual(['/yara-reports/cashiers-live']);
        expect(out).toEqual([{no: '9', name: 'الكافيه', deptCode: 'CAF', invoices: 0, total: 0}]);
    });

    test('الترقيم رقمي تصاعدي، والصفوف غير الرقمية تُطرح — لا رقم فاسد في المنتقي', async () => {
        const ctx = dirCtx([
            {cashier_no: '10', name: 'ب', dept_code: 'X', today_invoices: 3, today_total: 450.5},
            {cashier_no: '2', name: 'أ', dept_code: 'Y'},
            {cashier_no: '9999999', name: 'طويل', dept_code: 'Z'},
            {cashier_no: '٥', name: 'عربي', dept_code: 'Z'},
            {cashier_no: '', name: 'فارغ', dept_code: 'Z'},
            null,
        ]);
        const out = await ctx.fetchYaraCashiers();
        expect(out.map((c) => c.no)).toEqual(['2', '10']);
        expect(out[1]).toMatchObject({invoices: 3, total: 450.5});
    });

    test('الاسم قد يغيب: null لا سلسلة فارغة، والوسم لا يخترع اسمًا', async () => {
        const ctx = dirCtx([{cashier_no: '4', name: '', dept_code: 'G'}, {cashier_no: '6', name: 'الجري', dept_code: 'G'}]);
        const out = await ctx.fetchYaraCashiers();
        expect(out.map((c) => c.name)).toEqual([null, 'الجري']);
        expect(ctx.cashierNameOf('4', out)).toBeNull();
        expect(ctx.cashierNameOf('99', out)).toBeNull();
        expect(ctx.cashierLabel('4', out)).toBe('كاشير 4');
        expect(ctx.cashierLabel('6', out)).toBe('كاشير 6 — الجري');
        expect(ctx.cashierLabel(' 6 ', out)).toBe('كاشير 6 — الجري');
    });

    test('قراءة بلا صفوف أو بقراءة فارغة = دليل فارغ لا استثناء', async () => {
        const empty = dirCtx([]);
        expect(await empty.fetchYaraCashiers()).toEqual([]);
        const nullish = loadEsm(REPO, {
            apiFetch: jest.fn(async () => null),
            fetchEntityNewest: jest.fn(async () => []),
            deptWithChildren,
            CASHIER_DEPT_MAP: {},
        }, ['fetchYaraCashiers']);
        expect(await nullish.fetchYaraCashiers()).toEqual([]);
    });
});

describe('علم v2deptcashier — ظاهر افتراضيًا، و=0 يُخفيه (طلب المالك)', () => {
    const load = () => loadEsm(FLAGS, {}, ['deptCashierWriteEnabled', 'DEPT_CASHIER_WRITE_FLAG']);

    test('غياب العلم = ظاهر (الأوبشن في الواجهة)، والقراءة الممنوعة لا ترمي', () => {
        const ctx = load();
        expect(ctx.DEPT_CASHIER_WRITE_FLAG).toBe('v2deptcashier');
        expect(ctx.deptCashierWriteEnabled('', null)).toBe(true);
        expect(ctx.deptCashierWriteEnabled(undefined, {getItem: () => {throw new Error('denied');}})).toBe(true);
    });

    test('=0 صريح يُخفيه، و=1 يفتحه، والـURL يغلب المخزّن', () => {
        const ctx = load();
        expect(ctx.deptCashierWriteEnabled('?v2deptcashier=0', {getItem: () => '1'})).toBe(false);
        expect(ctx.deptCashierWriteEnabled('', {getItem: (k) => (k === 'karim_v2_dept_cashier_write' ? '0' : null)})).toBe(false);
        expect(ctx.deptCashierWriteEnabled('?v2deptcashier=1', {getItem: () => '0'})).toBe(true);
        expect(ctx.deptCashierWriteEnabled('', {getItem: () => null})).toBe(true);
    });
});

describe('قاعدة 103 والباب العام وحرس الخادم', () => {
    const sql = read(MIGRATION);
    const server = read(SERVER);
    const registry = require('../backend/schema-registry');

    test('الجدول إضافي: مفتاح صريح، FK تتابعي، قيد تكرار ممنوع، وأساسي واحد', () => {
        expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS dept_cashier_links/);
        expect(sql).toMatch(/dept_code\s+VARCHAR\(50\)\s+NOT NULL REFERENCES departments\(code\) ON DELETE CASCADE/);
        expect(sql).toMatch(/CONSTRAINT dept_cashier_links_unique UNIQUE \(dept_code, cashier_no\)/);
        expect(sql).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS dept_cashier_links_one_primary/);
        expect(sql).toMatch(/WHERE is_primary/);
        expect(sql).toMatch(/cashier_no ~ '\^\[0-9\]\{1,6\}\$'/);
    });

    test('البذرة تطابق الخريطة المدمجة حرفيًا (صفر انحراف في الإيراد)', () => {
        const seeded = [...sql.matchAll(/\(\s*(91\d\d), '([a-z_A-Z]+)',\s*'(\d)', (TRUE|FALSE)\)/g)]
            .map((m) => `${m[3]}→${m[2]}`);
        expect(seeded.sort()).toEqual(['1→CAF', '4→external_sales', '5→external_sales', '6→G', '9→open_buffet']);
    });

    test('الكيان مسجل في المخطط وأدوار كتابته admin|manager وحصانة id قائمة', () => {
        const schema = registry.getSchema('dept_cashier_links');
        expect(schema).toBeTruthy();
        expect(schema.writeable).toEqual(['dept_code', 'cashier_no', 'is_primary', 'notes']);
        expect(schema.required).toEqual(['dept_code', 'cashier_no']);
        expect(schema.protected).toContain('id');
        expect(registry.getEntityWriteRoles('dept_cashier_links')).toEqual(['admin', 'manager']);
    });

    test('الخادم: الكيان في قائمة CRUD ومساران محرسون (POST وPUT)', () => {
        const entities = server.match(/const entities = \[([\s\S]*?)\];/)[1];
        expect(entities).toContain("'dept_cashier_links'");
        expect((server.match(/entity === 'dept_cashier_links'/g) || []).length).toBe(2);
        expect(server).toMatch(/async function validateDeptCashierLink\(filtered, currentId = null\)/);
        // حرس الفترة لم يُمسّ: نفس العدد قبل التعديل وبعده (create×2 + put×2 + delete)
        expect((server.match(/payrollPeriodViolation|payrollRowViolation/g) || []).length).toBeGreaterThanOrEqual(6);
    });
});

describe('شاشة الأقسام — البطاقات الثيمية', () => {
    const screen = read(SCREEN);
    const css = read(CSS);
    const html = read(V2_HTML);

    test('البطاقات والجدول يتبديلان، والافتراضي بطاقات', () => {
        expect(screen).toContain("let view = 'cards';");
        expect(screen).toMatch(/data-v2-cards/);
        expect(screen).toMatch(/data-v2-view="cards"/);
        expect(screen).toMatch(/data-v2-view="table"/);
        expect(screen).toMatch(/cards\.hidden = view !== 'cards'/);
    });

    test('الهوية الثيمية من بيانات القسم: اللون والأيقونة لا ألوان حرفية', () => {
        expect(screen).toMatch(/--dept-accent:\$\{esc\(accent\)\}/);
        expect(screen).toMatch(/deptIdentityColor\(r\)/);
        expect(screen).toMatch(/data-dept-theme="\$\{esc\(deptThemeOf\(r\)\)\}"/);
        expect(css).toMatch(/\[data-dept-theme='stripes'\]/);
        expect(css).toMatch(/\[data-dept-theme='rings'\]/);
        expect(css).toMatch(/--dept-accent/);
        expect(html).toContain('css/v2/erp-departments.css');
    });

    test('فحص الألوان: لا hex ولا rgb ولا أسماء ألوان مرسومة في erp-departments.css', () => {
        const stripped = css.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^.*@supports.*$/gm, (m) => m.replace(/[^\n]/g, ' '));
        expect(stripped).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
        expect(stripped).not.toMatch(/\brgba?\(\s*[\d.]/);
        expect(stripped).not.toMatch(/\bhsla?\(\s*[\d.]/);
        expect(stripped).not.toMatch(/\b(white|black|red|green|blue|gray|grey|orange|yellow|purple|teal|aqua|lime|cyan|magenta)\b(?=[\s;,!)])/);
    });

    test('ولا معالج مضمّن في البطاقة، وربط الكاشير مزدوج الحرس (دور + علم)', () => {
        expect(screen).not.toMatch(/(?:^|\s)on[a-z]+="/);
        expect(screen).toMatch(/const canLink = canWrite\(ctx\.role, DEPT_CASHIER_WRITE_ROLES\) && deptCashierWriteEnabled\(\)/);
        expect(screen).toMatch(/canLink \? `<button type="button" class="erp-btn erp-btn--sm" data-v2-link=/);
    });

    test('إيراد البطاقة شهري من السجل المرحّل: شجرة القسم + مرايا كاشيريها + مرآة البيع الخارجي', () => {
        expect(screen).toContain('function monthToDateRange()');
        expect(screen).toContain('fetchYaraCashierItems({from, to, view:');
        expect(screen).toContain("new Set(['1', '3', '4', '5', '6', '9'])");
        // شجرة القسم + المرايا التي لا تحملها الشجرة (parent_code فارغ في القاعدة)
        expect(screen).toContain('const s = calcDeptStats(revenues, expenses, rows, code, from, to);');
        expect(screen).toMatch(/deptIsWithin\(`ys_cc_\$\{no\}`, code\)/);
        expect(screen).toContain("const EXT_SALES_MIRROR = 'ys_b4_ext';");
        expect(screen).toMatch(/deptIsWithin\('external_sales', code\)/);
        expect(screen).toMatch(/const rev = s\.rev \+ mirrorRev;/);
        // الحي لا يدخل إجمالي البطاقة: يُعرض في الشارة والملخّص كغير مرحّل
        expect(screen).toContain('actualCashierRevenue.get(String(no))');
        expect(screen).toMatch(/is-unposted/);
        expect(screen).toContain('إيراد حي غير مرحّل');
        expect(screen).toContain('مصروفات غير مسندة إلى قسم');
        expect(screen).toContain('نفس أساس تحليل التكاليف');
        expect(screen).toContain('لا أصفار بديلة');
        expect(screen).toContain('كاشيرات بلا إسناد موثّق');
    });

    test('صفّ الفرع يعرض إيراده ومصروفه بجوار الصافي — الكوست لا يُخفى', () => {
        expect(screen).toMatch(/erp-dept-child__split/);
        expect(screen).toMatch(/إيراد \$\{amountOnly\(s\.rev\)\}/);
        expect(screen).toMatch(/مصروف \$\{amountOnly\(s\.exp\)\}/);
        expect(css).toMatch(/\.erp-v2 \.erp-dept-child__split \{/);
        expect(css).toMatch(/\.erp-v2 \.erp-dept-cashier\.is-unposted \{/);
    });

    test('نسبة التكلفة عند صفر إيراد تُعرض — لا 0%: القسمة على صفر غير معرّفة', () => {
        // صفّ الفرع والدرج كلاهما مشروطان بإيراد موجب
        expect(screen).toMatch(/s\.rev > 0 \? `\$\{formatInt\(Math\.round\(s\.costRatio\)\)\}%` : '—'/);
        expect(screen).toMatch(/s\.rev > 0 \? `\$\{esc\(Number\(s\.costRatio\)\.toFixed\(1\)\)\}%` : '—'/);
        expect((screen.match(/النسبة غير قابلة للحساب/g) || []).length).toBeGreaterThanOrEqual(2);
    });

    test('الروابط تُقرأ بلا كسر حين لا يكون 103 مطبَّقًا (fallback الخريطة)', () => {
        expect(screen).toMatch(/linksLoaded = false;/);
        expect(screen).toMatch(/linksLoaded\s*\?\s*deptCashierNos\(String\(dept\.code\)/);
        expect(screen).toMatch(/const linked = linksLoaded/);
    });

    test('تقليل الحركة مكفول كما في erp-motion.css', () => {
        expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)/);
        expect(css).toMatch(/transform: none;/);
    });
});

describe('شاشة الأقسام — منتقي كاشيرات يارا سوفت (بند #8)', () => {
    const screen = read(SCREEN);

    test('اللوحة تعرض المنتقي بدل الرقم وحده، واليدوي يبقى مخرجًا', () => {
        expect(screen).toMatch(/function linkPickerHtml\(code\)/);
        expect(screen).toMatch(/\+ linkPickerHtml\(code\)/);
        expect(screen).toMatch(/<select class="erp-select" data-v2-link-pick>/);
        expect(screen).toMatch(/<option value="__manual__">/);
        expect(screen).toMatch(/manual\(true\)/);
        expect(screen).toMatch(/manual\(false\)/);
    });

    test('الدليل يُقرأ بعد السجل ويَفشل بصمت: لا شاشة بلا روابط عند تعذّر الباب', async () => {
        expect(screen).toMatch(/cashDir = await fetchYaraCashiers\(\);/);
        expect(screen).toMatch(/cashDirFailed = true;/);
        expect(screen).toMatch(/} catch \{\s*\n\s*\/\* نفس احتياط روابط 103/);
    });

    test('القيمة المرسلة: اختيار الدليل أولًا، واليدوي فقط حين يُطلب', () => {
        expect(screen).toMatch(/function pickedCashierNo\(\)/);
        expect(screen).toMatch(/if \(v === '__manual__'\) \{return q\('\[data-v2-link-no\]'\)\?\.value \?\? '';\}/);
        expect(screen).toMatch(/cashier_no: pickedCashierNo\(\),/);
        expect(screen).not.toMatch(/cashier_no: q\('\[data-v2-link-no\]'\)\?\.value/);
    });

    test('تبديل المنتقي يُظهر اليدوي ويُفرغه فلا يعلق رقم خلف اختيار الدليل', () => {
        expect(screen).toMatch(/matches\('\[data-v2-link-pick\]'\)/);
        expect(screen).toMatch(/manual\.hidden = !manualOn;/);
        expect(screen).toMatch(/if \(noInput && !manualOn\) \{noInput\.value = '';\}/);
    });

    test('اسم الكاشير من الدليل في الشارة وصفّ الربط — والرقم لا يُستبدل به', () => {
        expect(screen).toMatch(/const nm = cashierNameOf\(l\.cashierNo, cashDir\);/);
        expect(screen).toMatch(/erp-dept-cashier__name/);
        expect(screen).toMatch(/title="\$\{esc\(cashierLabel\(l\.cashierNo, cashDir\)\)\}/);
        expect(screen).toMatch(/كاشير <span class="erp-mono" dir="ltr">\$\{esc\(l\.cashierNo\)\}/);
    });

    test('المربوط هنا معطّل في القائمة والمربوط بغير القسم يُذكر صاحبه', () => {
        expect(screen).toMatch(/const here = new Set\(deptCashierNos\(code, \{links, departments: rows\}\)\.nos\);/);
        expect(screen).toMatch(/\$\{linkedHere \? ' disabled' : ''\}/);
        expect(screen).toMatch(/— مربوط بـ \$\{owner\}/);
        expect(screen).toMatch(/— مربوط هنا/);
    });

    test('المنتقي لا يمدّ اللوحة: min-inline-size:0 في erp-departments.css', () => {
        const css = read(CSS);
        expect(css).toMatch(/\[data-v2-link-pick\] \{[\s\S]*?min-inline-size: 0;/);
    });
});

describe('طيّ الأقسام المرآتية وتفريع الأبناء داخل الأب (طلب المالك 2026-10-19)', () => {
    const screen = read(SCREEN);
    const css = read(CSS);

    test('isMirrorDept: بادئة ys_ وحدها، وحالة الأحرف لا تفرق', () => {
        const m = screen.match(/const MIRROR_DEPT_RE = (\/\^ys_\/i);[\s\S]*?function isMirrorDept\(code\) \{ ([^\n]+) \}/);
        expect(m).toBeTruthy();
        const fn = new Function(`const MIRROR_DEPT_RE = ${m[1]};\nfunction isMirrorDept(code) { ${m[2]} }\nreturn isMirrorDept;`)();
        expect(fn('ys_cc_1')).toBe(true);
        expect(fn('ys_b4_ext')).toBe(true);
        expect(fn('YS_CC_9')).toBe(true);
        expect(fn('kitchen')).toBe(false);
        expect(fn('external_sales')).toBe(false);
        expect(fn('B.F')).toBe(false);
        expect(fn(null)).toBe(false);
        expect(fn(undefined)).toBe(false);
    });

    test('المرآتية تُطوى افتراضيًا طيّ عرضٍ فقط، والمفتاح يعيدها بلا معالج مضمّن', () => {
        expect(screen).toMatch(/let showMirrors = false;/);
        expect(screen).toMatch(/const visibleRows = \(\) => \(showMirrors \? rows : rows\.filter\(\(d\) => !isMirrorDept\(d\.code\)\)\);/);
        expect(screen).toMatch(/data-v2-mirrors/);
        expect(screen).toMatch(/if \(ev\.target\.matches\('\[data-v2-mirrors\]'\)\) \{showMirrors = !!ev\.target\.checked; paint\(\); return;\}/);
        expect(screen).not.toMatch(/(?:^|\s)on[a-z]+="/);
    });

    test('العدّادات تتبع المعروض لا الكل، والملخّص يذكر المطوي بلا حذف', () => {
        expect(screen).toMatch(/const shown = visibleRows\(\)\.length;/);
        expect(screen).toMatch(/const roots = shown\.filter\(\(d\) => !d\.parent_code\)\.length;/);
        expect(screen).toMatch(/قسم مبيعات مرآتي مطوي/);
        expect(screen).toMatch(/table\.setRows\(familyOrder\(visibleRows\(\)\)\);/);
        expect(screen).toMatch(/data-v2-mirrors-label/);
    });

    test('الفرعية تُرسم داخل بطاقة أبيها: لا بطاقة عليا لكل فرع', () => {
        expect(screen).toMatch(/const roots = list\.filter\(\(d\) => !d\.parent_code \|\| !byCode\.has\(String\(d\.parent_code\)\)\);/);
        expect(screen).toMatch(/`<ul class="erp-dept-kids\$\{cls\}">/);
        expect(screen).toMatch(/cards\.length \|\| orphans\.length/);
        expect(screen).toMatch(/const orphans = list\.filter\(\(d\) => !covered\.has\(String\(d\.code\)\)\);/);
        expect(screen).not.toMatch(/familyOrder\(rows\)\.map\(deptCardHtml\)/);
        expect(screen).toMatch(/const kids = visibleRows\(\)\.filter\(\(d\) => String\(d\.parent_code \|\| ''\) === code\)\.length;/);
    });

    test('الأنماط: الأبناء صفوفٌ مضغوطة داخل البطاقة بلا لون حرفي', () => {
        expect(screen).toMatch(/function deptChildRowHtml\(r\)/);
        expect(screen).toMatch(/erp-dept-child__row/);
        expect(css).toMatch(/\.erp-v2 \.erp-dept-kids \{/);
        expect(css).toMatch(/\.erp-v2 \.erp-dept-child__row \{/);
        expect(css).toMatch(/\.erp-v2 \.erp-dept-viewbar \{/);
        expect(css).toMatch(/border-inline-start: 2px solid color-mix\(in srgb, var\(--dept-accent\)/);
        expect(css).not.toMatch(/\.erp-dept-kids \.erp-dept-card/);
    });

    test('طيّ الأقسام الفرعية: الزر يعدّ ويُفرد، والقائمة تُطوى بـ CSS ولا تُحذف', () => {
        expect(screen).toMatch(/const kidsOpen = new Set\(\);/);
        expect(screen).toMatch(/function deptKidsBarHtml\(code, count, open\)/);
        expect(screen).toMatch(/data-v2-kids="\$\{esc\(code\)\}"/);
        expect(screen).toMatch(/aria-expanded="\$\{open \? 'true' : 'false'\}"/);
        expect(screen).toMatch(/\(kids \? deptKidsBarHtml\(code, kids, kidsOpen\.has\(code\)\) : ''\)/);
        expect(screen).toMatch(/const kidsBtn = ev\.target\.closest\('\[data-v2-kids\]'\);/);
        expect(screen).toMatch(/const cls = kidsOpen\.has\(code\) \? '' : ' is-collapsed';/);
        expect((screen.match(/kidsOpen\.has\(/g) || []).length).toBeGreaterThanOrEqual(2);
        expect(css).toMatch(/\.erp-v2 \.erp-dept-kids\.is-collapsed \{ display: none; \}/);
        expect(css).toMatch(/\.erp-v2 \.erp-dept-kids-bar \{/);
        expect(css).toMatch(/@media print \{[\s\S]*?\.erp-v2 \.erp-dept-kids\.is-collapsed \{ display: flex; \}/);
        // الطيّ لا يحذف من الـDOM: القائمة تُبنى دائمًا في render
        expect(screen).toMatch(/`<ul class="erp-dept-kids\$\{cls\}">/);
    });
});
