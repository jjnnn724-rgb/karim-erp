/**
 * v2-dept-cards.test.js — عقد بطاقات الأقسام وربط الكاشير (V2)
 * ═══════════════════════════════════════════════════════════════════════
 * طلب المالك 2026-10-19: «كل قسم بكارت شيك احترافي ثيماتي» + «أقدر أربط
 * القسم بالكاشير المعين». المثبّت هنا:
 *   1) مستودع الروابط: تطبيع رقم الكاشير، قواعد التحقق، مصدر الأرقام
 *      (روابط 103 أولًا، والخريطة المدمجة احتياطًا) — بلا خلط المصدرين.
 *   2) علم كتابة مستقل v2deptcashier (OFF افتراضيًا، والـURL يغلب المخزّن).
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
        'updateDeptCashierLink', 'LINKS_ENTITY', 'DEPT_CASHIER_WRITE_ROLES']);
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

describe('علم v2deptcashier — OFF افتراضيًا والـURL يغلب', () => {
    const load = () => loadEsm(FLAGS, {}, ['deptCashierWriteEnabled', 'DEPT_CASHIER_WRITE_FLAG']);

    test('غياب العلم = مغلق، والقراءة الممنوعة لا ترمي', () => {
        const ctx = load();
        expect(ctx.DEPT_CASHIER_WRITE_FLAG).toBe('v2deptcashier');
        expect(ctx.deptCashierWriteEnabled('', null)).toBe(false);
        expect(ctx.deptCashierWriteEnabled(undefined, {getItem: () => {throw new Error('denied');}})).toBe(false);
    });

    test('المخزّن يفتح للـstaging، و=0 في الـURL يغلب المخزّن', () => {
        const ctx = load();
        expect(ctx.deptCashierWriteEnabled('', {getItem: (k) => (k === 'karim_v2_dept_cashier_write' ? '1' : null)})).toBe(true);
        expect(ctx.deptCashierWriteEnabled('?v2deptcashier=1', {getItem: () => null})).toBe(true);
        expect(ctx.deptCashierWriteEnabled('?v2deptcashier=0', {getItem: () => '1'})).toBe(false);
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

    test('حساب البطاقة = حساب القديم: إيراد القسم + إيراد كاشيراته فوق المصروف', () => {
        expect(screen).toMatch(/calcDeptStats\(revenues, expenses, rows, String\(r\.code\), null, null\)/);
        expect(screen).toMatch(/const rev = s\.rev \+ cashRev;/);
        expect(screen).toMatch(/costRatio: rev > 0 \? \(s\.exp \/ rev\) \* 100 : 0/);
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
