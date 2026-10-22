/**
 * v2-inventory-inquiry.test.js — عقد استعلامات المخزون (محرك + بطاقة الصنف)
 * ═══════════════════════════════════════════════════════════════════════
 * المرجع: backend/inventory-inquiry.js (:96 :100 :106 :292 :446 :625)
 *          backend/server.js:639  ·  backend/permissions.js:39
 *          frontend/app/js/v2/data/inventory-inquiry-repo.js
 *          frontend/app/js/v2/data-display/item-dossier.js
 *          frontend/app/js/v2/screens/{inventory-inquiry,inventory-inquiry-pro}.js
 *          frontend/app/js/features/inventory-inquiry.js (الواجهة القديمة)
 *
 * لماذا يوجد هذا الاختبار: هذا الباب قراءة فقط، ورقمه يُقارَن بأرقام خدمات
 * أخرى (accounting-routes وdaily-report-service). أي انحراف في قائمة الاستثناء
 * أو في الأدوار أو في مسار الطلب يغيّر رقمًا يراه المالك بلا أن يصرخ أحد.
 * المثبَّت إذًا:
 *   • الأدوار والسقف (93) ومسارات الأبواب الثلاثة مرآة حرفية للخادم.
 *   • قائمة الاستثناء المخزني/الجردي واحدة في الخدمات الثلاثة — لا ازدواج تكلفة.
 *   • الأعمدة التي يقرؤها التصدير موجودة حرفيًا في صفوف الخادم.
 *   • soldPos و soldYara عمودان لا يُجمعان: لا في الباب ولا في الواجهتين.
 *   • الشاشات لا تلمس الشبكة ولا تعرف onclick=، والبطاقة نسخة واحدة في طبقة العرض.
 *   • الوصل في الواجهتين: preview.js + routing، والجسر في main.js + page-router
 *     + الأدوار + العناوين — admin و sous_chef فقط.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const APP = path.join(ROOT, 'frontend', 'app');
const V2 = path.join(APP, 'js', 'v2');
const REPO = path.join(V2, 'data', 'inventory-inquiry-repo.js');
const DOSSIER = path.join(V2, 'data-display', 'item-dossier.js');
const ENGINE = path.join(V2, 'screens', 'inventory-inquiry.js');
const PRO = path.join(V2, 'screens', 'inventory-inquiry-pro.js');
const PREVIEW = path.join(V2, 'preview.js');
const CSS = path.join(APP, 'css', 'v2', 'erp-inquiry.css');
const V2_HTML = path.join(APP, 'v2.html');
const SERVER = path.join(ROOT, 'backend', 'inventory-inquiry.js');
const SERVER_JS = path.join(ROOT, 'backend', 'server.js');
const PERMS = path.join(ROOT, 'backend', 'permissions.js');
const ACCOUNTING = path.join(ROOT, 'backend', 'accounting-routes.js');
const DAILY = path.join(ROOT, 'backend', 'daily-report-service.js');
const LEGACY = path.join(APP, 'js', 'features', 'inventory-inquiry.js');
const ICONS = path.join(APP, 'js', 'icons.js');
const CONFIG = path.join(APP, 'js', 'core', 'config.js');
const ROUTER = path.join(APP, 'js', 'features', 'page-router.js');
const MAIN = path.join(APP, 'js', 'main.js');
const INDEX = path.join(APP, 'index.html');
const I18N = path.join(APP, 'js', 'core', 'i18n.js');
const NAV = path.join(APP, 'js', 'features', 'auth-navigation.js');

const read = (p) => fs.readFileSync(p, 'utf8');
const REV = (read(V2_HTML).match(/js\/v2\/preview\.js\?v=([0-9.]+)/) || [])[1];

/** تحميل وحدة ESM حقيقية بتجريد كلمات import/export وحقن رموزها المستوردة. */
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
        Date, Math, Promise, Set, Map, Intl, isNaN, parseFloat, parseInt,
        URLSearchParams, encodeURIComponent, decodeURIComponent,
        ...injections,
    };
    vm.createContext(context);
    vm.runInContext(src, context, { filename: file });
    return context;
}

const FORMATS = ['formatInt', 'formatQty', 'formatMoney'];
function loadRepo(apiFetchImpl) {
    const reports = loadEsm(path.join(V2, 'data', 'reports-repo.js'), {}, FORMATS);
    const calls = [];
    const apiFetch = (...a) => {
        calls.push(a[0]);
        return apiFetchImpl ? apiFetchImpl(...a) : Promise.resolve({});
    };
    const yara = loadEsm(path.join(V2, 'data', 'yara-reports-repo.js'), {}, ['rangeError', 'spanDays']);
    const m = loadEsm(REPO, {
        apiFetch, rangeError: yara.rangeError, spanDays: yara.spanDays,
        formatInt: reports.formatInt, formatQty: reports.formatQty, formatMoney: reports.formatMoney,
    }, [
        'INQ_READ_ROLES', 'INQ_FILTERS', 'INQ_SORTS', 'fetchInquiryItems', 'fetchInquiryItem',
        'fetchInquiryDepartments', 'engineKpis', 'expiryState', 'EXPORT_COLUMNS', 'toExportAoa',
        'deptCostSummary', 'rangeError', 'spanDays',
    ]);
    return { m, calls };
}

const ICON_KEYS = new Set([...read(ICONS).matchAll(/^\s{4}'([a-z0-9-]+)':/gm)].map((x) => x[1]));

/* صفوف /items كما يبنيها الخادم (backend/inventory-inquiry.js:367-399): أسماء
   الخوان تُقرأ من مصدرها، فمتى غيّر الخادم اسمًا لا يقرؤه التصدير سقط العقد. */
const SERVER_ROW_KEYS = [...read(SERVER).match(/const rows = rowsQ\.rows\.map\([\s\S]*?const matched/)[0]
    .matchAll(/^\s+([A-Za-z]\w*):/gm)].map((x) => x[1]);

/* مفاتيح totals التي يرسلها /items (:408-420) — البطاقات تُقرأ منها لا من اختراع. */
const SERVER_TOTAL_KEYS = [...read(SERVER).match(/totals: \{[\s\S]*?\n\s*\},\n\s*meta:/)[0]
    .matchAll(/^\s+(\w+):/gm)].map((x) => x[1]);

describe('الباب ↔ الخادم — الأدوار والمسار والسقف', () => {
    const server = read(SERVER);

    test('READ_ROLES مرآة حرفية: admin و sous_chef فقط', () => {
        expect(server).toMatch(/const READ_ROLES = \['admin', 'sous_chef'\];/);
        expect(loadRepo().m.INQ_READ_ROLES).toEqual(['admin', 'sous_chef']);
    });

    test('الأبواب الثلاثة كلها jwtAuth + requireRoleOrPerm(READ_ROLES, READ_PERM)', () => {
        const gets = [...server.matchAll(/router\.get\('([^']+)',\s*jwtAuth,\s*requireRoleOrPerm\(READ_ROLES, READ_PERM\)/g)]
            .map((x) => x[1]);
        expect(gets).toEqual(['/items', '/item/:id', '/departments']);
        expect(server).toMatch(/const READ_PERM = 'inventory-inquiry\.view';/);
        expect(read(PERMS)).toContain("'inventory-inquiry.view'");
    });

    test('المسار مُركَّب مرة: /api في الخادم، ومن دونه في الباب', () => {
        expect(read(SERVER_JS)).toContain("app.use('/api/inventory-inquiry', require('./inventory-inquiry').router)");
        const { m, calls } = loadRepo();
        m.fetchInquiryItems({ from: '2026-10-01', to: '2026-10-15' });
        m.fetchInquiryItem('42', { from: '2026-10-01', to: '2026-10-15' });
        m.fetchInquiryDepartments({ from: '2026-10-01', to: '2026-10-15' });
        expect(calls).toEqual([
            '/inventory-inquiry/items?from=2026-10-01&to=2026-10-15&only=all&sort=movements&dir=desc&limit=100&offset=0',
            '/inventory-inquiry/item/42?from=2026-10-01&to=2026-10-15',
            '/inventory-inquiry/departments?from=2026-10-01&to=2026-10-15',
        ]);
        expect(read(LEGACY).match(/apiFetch\(`\/api\//g) || []).toHaveLength(0);
    });

    test('البارامترات الفارغة لا تُرسل، والمرشّحات والتراقيم مرآة الخادم', () => {
        const { m, calls } = loadRepo();
        m.fetchInquiryItems({ from: '2026-10-01', to: '2026-10-15', dept: '', q: '  ', cat: null, only: 'low', sort: 'value', dir: 'asc', limit: 200, offset: 0 });
        expect(calls[0]).toBe('/inventory-inquiry/items?from=2026-10-01&to=2026-10-15&q=++&only=low&sort=value&dir=asc&limit=200&offset=0');
        expect(server).toMatch(/const MAX_SPAN_DAYS = 93;/);
        expect(m.INQ_SORTS).toEqual([...server.match(/const SORT_COLS = Object\.freeze\(\{([\s\S]*?)\}\);/)[1].matchAll(/(\w+):/g)].map((x) => x[1]));
        expect(m.INQ_FILTERS).toEqual(['all', ...[...server.matchAll(/only === '(\w+)'/g)].map((x) => x[1])]);
    });

    test('الباب قراءة فقط — لا POST ولا PUT ولا DELETE فيه', () => {
        const src = read(REPO);
        expect(src).not.toMatch(/method:\s*'(POST|PUT|PATCH|DELETE)'/i);
        expect(src).toMatch(/this file never writes/i);
    });
});

describe('لا ازدواج تكلفة ولا مزج مصدرين', () => {
    const EXPECTED_EXCLUSIONS = ['dispatch', 'dispatch_return', 'transfer', 'receipt',
        'stock_transfer', 'inventory_transfer', 'kitchen_return', 'count_correction'];
    const quoted = EXPECTED_EXCLUSIONS.map((t) => `'${t}'`).join(',');

    test('قائمة الاستثناء المخزني/الجردي واحدة في الخدمات الثلاثة', () => {
        const inq = read(SERVER).match(/const STOCK_EXPENSE_TYPES = `\(([^)]*)\)`/)[1].replace(/\s/g, '');
        expect(inq).toBe(quoted);
        // نفس القائمة الحرفية التي يستثنيها المحاسبة والتقرير اليومي — وإلا ضُوعفت التكلفة
        expect(read(ACCOUNTING)).toContain(`NOT IN (${quoted})`);
        expect(read(DAILY)).toContain(`NOT IN (${quoted})`);
        // وفي باب الاستعلام تُستخدم عبر الثابت، لا نسخة مكتوبة داخل الـ SQL
        expect(read(SERVER)).toContain('NOT IN ${STOCK_EXPENSE_TYPES}');
    });

    test('soldPos و soldYara عمودان منفصلان في التصدير، ولا عمود يجمعهما', () => {
        const { m } = loadRepo();
        const headers = m.EXPORT_COLUMNS.map((c) => c.header);
        expect(headers.filter((h) => /POS/.test(h))).toHaveLength(2);
        expect(headers.some((h) => /يارا|Yarasoft/.test(h))).toBe(false);
        expect(headers).toContain('مبيع بالعدد (POS — معرّف)');
        expect(headers).toContain('مبيع بالعدد (مرآة المبيعات — اسم)');
        const aoa = m.toExportAoa([{ itemName: 'طماطم', soldPos: 4, soldYara: 7, nearestExpiry: null }]);
        expect(aoa[0]).toEqual(headers);
        expect(aoa[1][headers.indexOf('مبيع بالعدد (POS — معرّف)')]).toBe(4);
        expect(aoa[1][headers.indexOf('مبيع بالعدد (مرآة المبيعات — اسم)')]).toBe(7);
        expect(aoa[1][headers.indexOf('أقرب صلاحية')]).toBe('');
        expect(read(SERVER)).toContain('لا يُجمعان في رقم واحد');
    });

    test('كل عمود تصدير يقرأ خانة موجودة فعلًا في صفوف /items', () => {
        const { m } = loadRepo();
        const names = m.EXPORT_COLUMNS.map((c) => (c.get.toString().match(/r\.(\w+)/) || [])[1]).filter(Boolean);
        expect(names.filter((k) => !SERVER_ROW_KEYS.includes(k))).toEqual([]);
        expect(SERVER_ROW_KEYS.length).toBeGreaterThan(20);
    });
});

describe('تحويلات الباب — أرقام من رؤوس الخادم', () => {
    const { m } = loadRepo();

    test('engineKpis يقرأ مفاتيح totals نفسها التي يرسلها الخادم', () => {
        const cards = m.engineKpis({ stockValue: 1234.5, qtyInPurchases: 10, qtyOutTotal: 4, purchaseCost: 800, outCost: 300, items: 12 }, 'SAR');
        expect(cards.map((c) => c.key)).toEqual(['stockValue', 'qtyInPurchases', 'qtyOutTotal', 'purchaseCost', 'outCost', 'items']);
        for (const c of cards) {
            expect(SERVER_TOTAL_KEYS).toContain(c.key);
            expect(ICON_KEYS.has(c.icon)).toBe(true);
        }
        expect(cards[0].amount).toBe('1,234.50');
        expect(cards[0].unit).toBe('SAR');
        expect(cards[1].value).toBe('10');
        expect(cards[5].value).toBe('12');
        expect(m.engineKpis()[1].raw).toBe(0);
    });

    test('expiryState: بلا تاريخ / منتهية / خلال ٧ / سليمة', () => {
        expect(m.expiryState(null)).toEqual({ key: 'none', ar: '—', tone: '' });
        expect(m.expiryState('2026-10-01', '2026-10-15')).toEqual({ key: 'expired', ar: 'منتهية', tone: 'danger' });
        expect(m.expiryState('2026-10-18', '2026-10-15')).toEqual({ key: 'soon', ar: 'خلال 3 يومًا', tone: 'warning' });
        expect(m.expiryState('2026-12-01', '2026-10-15')).toEqual({ key: 'ok', ar: 'سليمة', tone: 'success' });
    });

    test('deptCostSummary: الكوست العام + بلا ازدواج + غير المُسند', () => {
        const s = m.deptCostSummary({
            totals: { departments: 6, costTotal: 5000, issuedCost: 3200, expenseOperating: 1800, expenseStock: 900, stockValue: 40000 },
            unattributed: { issuedCost: 120, expenseOperating: 30 },
        });
        expect(s).toEqual({ departments: 6, costTotal: 5000, issuedCost: 3200, expenseOperating: 1800, expenseStock: 900, stockValue: 40000, unattributedCost: 150 });
        expect(m.deptCostSummary()).toEqual({ departments: 0, costTotal: 0, issuedCost: 0, expenseOperating: 0, expenseStock: 0, stockValue: 0, unattributedCost: 0 });
    });

    test('rangeError مستوردة من يارا — لا نسخة ثانية من سقف الـ٩٣', () => {
        expect(read(REPO)).toMatch(/import \{ rangeError, spanDays \} from '\.\/yara-reports-repo\.js\?v=/);
        expect(read(REPO)).toMatch(/^export \{ rangeError, spanDays \};$/m);
        expect(read(REPO)).not.toMatch(/MAX_SPAN_DAYS\s*=\s*\d+/);
        expect(read(path.join(V2, 'data', 'yara-reports-repo.js'))).toMatch(/export const YARA_MAX_SPAN_DAYS = 93;/);
        expect(m.rangeError('2026-01-01', '2026-10-01')).toMatchObject({ ok: false });
        expect(m.rangeError('2026-01-01', '2026-10-01').message).toContain('93');
        expect(m.rangeError('2026-10-01', '2026-10-15').ok).toBe(true);
    });
});

describe('الشاشات والبطاقة — لا شبكة، ولا نسخة ثانية، ولا أيقونة وهمية', () => {
    test('البطاقة قطعة عرض واحدة في data-display — لا شاشة ميتة ولا نسخة', () => {
        expect(fs.existsSync(DOSSIER)).toBe(true);
        expect(fs.existsSync(path.join(V2, 'screens', 'item-dossier.js'))).toBe(false);
        for (const f of [ENGINE, PRO]) {
            expect(read(f)).toMatch(/import \{ mountItemDossier \} from '\.\.\/data-display\/item-dossier\.js\?v=/);
        }
        const d = read(DOSSIER);
        expect(d).not.toMatch(/apiFetch|fetch\(|onclick=/);
        expect(d).toMatch(/from '\.\.\/data\/inventory-inquiry-repo\.js\?v=/);
    });

    test('المحرك والبطاقة لا يملكان طبقة شبكة ولا معالجات ضميمة', () => {
        for (const f of [ENGINE, PRO]) {
            const src = read(f);
            expect(src).not.toMatch(/apiFetch|core\/api\.js|fetch\(|onclick=|onchange=|oninput=/);
            expect(src).toMatch(/from '\.\.\/data\/inventory-inquiry-repo\.js\?v=/);
            expect(src).toMatch(/export function mount/);
            expect(src).toMatch(/destroy/);
        }
    });

    test('كل مفتاح أيقونة تستخدمه الواجهتان موجود في السجل', () => {
        const used = [];
        for (const f of [ENGINE, PRO, DOSSIER, REPO]) {
            for (const m of read(f).matchAll(/(?:data-i=["']?|icon:\s*['"])([a-z0-9-]+)/g)) {used.push(m[1]);}
        }
        expect([...new Set(used)].filter((k) => !ICON_KEYS.has(k))).toEqual([]);
        expect(used.length).toBeGreaterThan(6);
    });

    test('الطبقة الرقيقة من CSS موجودة وموصولة بنفس المرجع', () => {
        expect(fs.existsSync(CSS)).toBe(true);
        expect(read(V2_HTML)).toContain(`css/v2/erp-inquiry.css?v=${REV}`);
        expect(read(CSS)).toMatch(/\.erp-v2 \.erp-v2-dossier__id/);
        expect(read(CSS)).toMatch(/@media \(max-width: 640px\)/);
    });

    test('المضيف يركّب المفتاحين ويهدم شاشتيهما قبل التنقل', () => {
        const host = read(PREVIEW);
        expect(host).toMatch(/import \{ mountQueryScreen \} from '\.\/screens\/inventory-inquiry\.js\?v=/);
        expect(host).toMatch(/import \{ mountProfessionalScreen \} from '\.\/screens\/inventory-inquiry-pro\.js\?v=/);
        expect(host).toMatch(/if \(key === 'query'\) \{\s*renderQueryScreen\(\);\s*return;/);
        expect(host).toMatch(/if \(key === 'professional'\) \{\s*renderProfessionalScreen\(\);\s*return;/);
        expect(host).toMatch(/function renderQueryScreen\(\) \{ renderLiveRegisterScreen\(\{ key: 'query', title: 'محرك الاستعلامات', mount: mountQueryScreen/);
        expect(host).toMatch(/function renderProfessionalScreen\(\) \{ renderLiveRegisterScreen\(\{ key: 'professional', title: 'البطاقة الفاخرة', mount: mountProfessionalScreen/);
        expect(host).toMatch(/function teardownQueryScreen\(\) \{\s*if \(queryScreen\) \{ queryScreen\.destroy\(\); queryScreen = null; \}/);
        expect(host).toMatch(/function teardownProfessionalScreen\(\) \{\s*if \(professionalScreen\) \{ professionalScreen\.destroy\(\); professionalScreen = null; \}/);
        // الهدم يُنادى في كنسة الشاشات نفسها، وإلا بقيت مستمعات التنقل بعد مغادرة المفتاح
        expect(host).toMatch(/teardownQueryScreen\(\);\s*teardownProfessionalScreen\(\);/);
    });
});

describe('الواجهة القديمة — نفس المفتاحين، ونفس القرار للخادم', () => {
    const cfg = read(CONFIG);

    test('admin و sous_chef فقط يريان المفتاحين في القائمة', () => {
        const roles = [...cfg.matchAll(/^(\w+): \{ name:.*menus: \[([^\]]*)\]/gm)];
        expect(roles).toHaveLength(11);
        const holders = roles.filter((r) => /'query'/.test(r[2]) || /'professional'/.test(r[2])).map((r) => r[1]);
        expect(holders).toEqual(['admin', 'sous_chef']);
        // المفتاحان يظهران معًا دائمًا — نصف ميزة في القائمة لا يُترك
        for (const r of roles) {
            expect({ role: r[1], together: /'query'/.test(r[2]) === /'professional'/.test(r[2]) }).toEqual({ role: r[1], together: true });
        }
    });

    test('المُوزِّع القديم يركّب كل صفحة، والجسر يصدّر كل اسم تُناديه', () => {
        // النسخة تُقرأ من الصفحة (لا رقم مثبّت): كل رفع لإصدار الواجهة
        // كان يكسر هذا الاختبار بلا سبب حقيقي.
        const rev = (read(INDEX).match(/js\/main\.js\?v=([\d.]+)/) || [])[1];
        expect(rev).toBeTruthy();
        expect(read(MAIN)).toContain(`await safeBridge('./features/inventory-inquiry.js?v=${rev}', 'BRIDGE-INQ');`);
        const router = read(ROUTER);
        expect(router).toMatch(/case 'query':[\s\S]{0,200}await renderInventoryQueryPage\(\);/);
        expect(router).toMatch(/case 'professional':[\s\S]{0,200}await renderItemCardPage\(\);/);
        const legacy = read(LEGACY);
        const exported = legacy.match(/export \{([\s\S]*?)\};/)[1].split(',').map((s) => s.trim()).filter(Boolean);
        const called = [...new Set([...legacy.matchAll(/onclick="(\w+)\(/g)].map((x) => x[1]))];
        expect(called.filter((fn) => !exported.includes(fn) && fn !== 'window')).toEqual([]);
        for (const fn of ['renderInventoryQueryPage', 'renderItemCardPage', 'iqApply', 'iqReload', 'iqOpenCard', 'iqCloseCard', 'iqExportExcel', 'iqPrintReport']) {
            expect(exported).toContain(fn);
        }
    });

    test('العنوان القديم مطابق للنص في i18n — لا انحراف بين القائمة والترويسة', () => {
        const i18n = read(I18N);
        const nav = read(NAV);
        for (const key of ['query', 'professional']) {
            const ar = (i18n.match(new RegExp(`${key}: \\{ icon: '[\\w-]+', ar: '([^']+)'`)) || [])[1];
            expect(ar).toBeTruthy();
            expect(nav).toContain(`'${key}':'${ar}'`);
        }
        expect(nav).toMatch(/keys:\[[^\]]*'query','professional'[^\]]*\]/);
    });

    test('أخطاء الخادم تترجم إلى عربية ولا تُترك رموزًا خامًا', () => {
        const legacy = read(LEGACY);
        for (const code of ['UNAUTHORIZED', 'RANGE_TOO_WIDE', 'FORBIDDEN']) {
            expect(legacy).toContain(code);
        }
        expect(legacy).toMatch(/الحد الأقصى|93/);
    });
});
