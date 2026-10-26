/**
 * v2-routing.test.js — عقد التوجيه بالهاش `#/key` (P0-3a)
 * ═══════════════════════════════════════════════════════════════════════
 * المرجع: frontend/app/js/v2/routing.js + الوصل في preview.js (§2b)
 * + مصدر المفاتيح: layout/nav-model.js (NAV_GROUPS_FALLBACK = نفس
 * auth-navigation.js:280-285 حرفيًا).
 *
 * ما يُثبَّت هنا:
 *   1) تحليل الهاش ذهابًا وإيابًا، وكل شكل خاطئ يسقط على اللوحة لا على فراغ.
 *   2) البوابة هي السحب الصريح (deniedMenus) فقط — لا قائمة الدور.
 *   3) المفتاح الافتراضي للراية: OFF.
 *   4) حارس انحراف: كل مفتاح في القائمة له مسار فعلي في preview.js، وكل
 *      مسار فرعي مسجَّل في routing.js موجود فعلًا — والعكس صحيح.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const APP = path.join(__dirname, '..', 'frontend', 'app');
const V2 = path.join(APP, 'js', 'v2');
const ROUTING = path.join(V2, 'routing.js');
const NAVMODEL = path.join(V2, 'layout', 'nav-model.js');
const HOST = path.join(V2, 'preview.js');

const read = (p) => fs.readFileSync(p, 'utf8');

/** مصدر بلا تعليقات — للعقود التي تقيس الكود لا النثر. */
const code = (p) => read(p)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '');

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
        console, String, Number, Boolean, Array, Object, RegExp, Error,
        Set, Map, JSON, decodeURIComponent, encodeURIComponent,
        ...injections,
    };
    vm.createContext(context);
    vm.runInContext(src, context, { filename: file });
    return context;
}

const esm = () => loadEsm(ROUTING, {}, [
    'DASH_KEY', 'SUB_ROUTES', 'keyFromHash', 'hashFor', 'knownKeys', 'resolveRouteKey', 'routingEnabled',
]);

/** مجموعة NAV_GROUPS_FALLBACK الحقيقية — لا نسخة مكتوبة في الاختبار. */
const navGroups = () => loadEsm(NAVMODEL, {}, ['readNavGroups']).readNavGroups();

/* لا شاشة اليوم تقع على فرع المعاينة الهيكلية في preview.js (بطاقة 🚧):
   shelves/weight خرجا في P2-5، وquery/professional صار لهما مسار حقيقي.
   أي مفتاح قائمة يجب أن يكون له مسار — والقائمة تُبقي الحارس صريحًا. */
const STUB_KEYS = [];

describe('التوجيه — تحليل الهاش', () => {
    test('الأشكال كلها تُفهم، والخاطئ لا يمر', () => {
        const m = esm();
        expect(m.keyFromHash('#/employees')).toBe('employees');
        expect(m.keyFromHash('#employees')).toBe('employees');
        expect(m.keyFromHash('#goods-scan')).toBe('goods-scan');
        expect(m.keyFromHash('employees')).toBe('employees');
        expect(m.keyFromHash('#/wh-vs-pos')).toBe('wh-vs-pos');
        expect(m.keyFromHash('#/revenues?tab=2')).toBe('revenues');
        expect(m.keyFromHash('#/')).toBe('');
        expect(m.keyFromHash('')).toBe('');
        expect(m.keyFromHash(null)).toBe('');
        expect(m.keyFromHash(undefined)).toBe('');
        // shapes that are not keys: uppercase, leading digit, underscore, injection
        expect(m.keyFromHash('#/Employees')).toBe('');
        expect(m.keyFromHash('#/2fa')).toBe('');
        expect(m.keyFromHash('#/a_b')).toBe('');
        expect(m.keyFromHash('#/../etc')).toBe('');
        expect(m.keyFromHash('#/employees<script>')).toBe('');
    });

    test('الذهاب والإياب متطابق، والافتراضي اللوحة', () => {
        const m = esm();
        expect(m.hashFor('employees')).toBe('#/employees');
        expect(m.hashFor('wh-vs-pos')).toBe('#/wh-vs-pos');
        for (const key of [...m.knownKeys(navGroups())]) {
            expect(m.keyFromHash(m.hashFor(key))).toBe(key);
        }
        expect(m.hashFor('')).toBe('#/dashboard');
        expect(m.hashFor(null)).toBe('#/dashboard');
        expect(m.hashFor('Bad Key')).toBe('#/dashboard');
    });
});

describe('التوجيه — معرفة المفاتيح وحدودها', () => {
    test('القائمة + اللوحة + مسارات فرعية بلا قائمة', () => {
        const m = esm();
        const known = m.knownKeys(navGroups());
        const fromGroups = navGroups().flatMap((g) => g.keys);
        for (const key of fromGroups) {expect(known.has(key)).toBe(true);}
        expect(known.has('dashboard')).toBe(true);
        for (const key of m.SUB_ROUTES) {expect(known.has(key)).toBe(true);}
        // معرّفات المجموعات ليست شاشات
        expect(known.has('ops')).toBe(false);
        expect(known.has('finance')).toBe(false);
        // لا تكرار: المجموعة قد تذكر مفتاحًا والفرعية تذكره
        expect(known.size).toBeGreaterThanOrEqual(fromGroups.length);
    });

    test('مجموعة فارغة أو خاطئة لا ترمي استثناءً', () => {
        const m = esm();
        expect(() => m.knownKeys(undefined)).not.toThrow();
        expect(m.knownKeys([]).has('dashboard')).toBe(true);
        expect(m.knownKeys([{ id: 'x' }, null, { keys: 'لا مصفوفة' }]).has('dashboard')).toBe(true);
    });
});

describe('التوجيه — قرار المسار', () => {
    const groups = () => navGroups();

    test('مفتاح صحيح يمر بلا بوابة', () => {
        const m = esm();
        const r = m.resolveRouteKey('#/warehouse', { known: m.knownKeys(groups()), denied: new Set() });
        expect(r).toEqual({ key: 'warehouse', reason: null });
    });

    test('الهاش الفارغ أو المجهول يسقط على اللوحة بسبب مسجَّل', () => {
        const m = esm();
        const opts = { known: m.knownKeys(groups()), denied: new Set() };
        expect(m.resolveRouteKey('', opts)).toEqual({ key: 'dashboard', reason: 'empty' });
        expect(m.resolveRouteKey('#/not-a-page', opts)).toEqual({ key: 'dashboard', reason: 'unknown' });
        expect(m.resolveRouteKey('#/Employees', opts)).toEqual({ key: 'dashboard', reason: 'empty' });
    });

    test('البوابة هي السحب الصريح فقط', () => {
        const m = esm();
        const opts = { known: m.knownKeys(groups()), denied: new Set(['whatsapp', 'yarasoft']) };
        expect(m.resolveRouteKey('#/whatsapp', opts)).toEqual({ key: 'dashboard', reason: 'not-permitted' });
        // أي مفتاح آخر — حتى لو لا يظهر في قائمة هذا الدور — يمر. هذا هو سبب
        // عدم استعمال allowedMenus(): قائمة الدور ليست قائمة بيضاء.
        expect(m.resolveRouteKey('#/dept-employees', opts)).toEqual({ key: 'dept-employees', reason: null });
    });

    test('denied: null يعني لا بوابة بعد، واللوحة لا تُرفض أبدًا', () => {
        const m = esm();
        const noGate = { known: m.knownKeys(groups()), denied: null };
        expect(m.resolveRouteKey('#/whatsapp', noGate)).toEqual({ key: 'whatsapp', reason: null });
        // اللوحة تُستثنى من الرفض: رفضها يعني صفحة فارغة لكل أحد
        expect(m.resolveRouteKey('#/dashboard', { known: m.knownKeys(groups()), denied: new Set(['dashboard']) }))
            .toEqual({ key: 'dashboard', reason: null });
    });

    test('تسجيل الدخول مسار صالح رغم أنه لا يظهر في أي قائمة', () => {
        const m = esm();
        const r = m.resolveRouteKey('#/login', { known: m.knownKeys(groups()), denied: new Set(['whatsapp']) });
        expect(r).toEqual({ key: 'login', reason: null });
    });

    test('المستدعي يمرر known أو groups — وكلاهما يعمل', () => {
        const m = esm();
        expect(m.resolveRouteKey('#/cfo', { groups: groups() }).key).toBe('cfo');
        expect(m.resolveRouteKey('#/cfo', {}).key).toBe('dashboard');
    });
});

describe('التوجيه — العلم افتراضيًا مغلقة', () => {
    test('?v2routing=1 وحده يشغّل، وغيابه يترك OFF', () => {
        const m = esm();
        expect(m.routingEnabled('?live=1&v2routing=1', null)).toBe(true);
        expect(m.routingEnabled('?v2routing=true', null)).toBe(true);
        expect(m.routingEnabled('?v2routing=on', '')).toBe(true);
        expect(m.routingEnabled('?live=1', null)).toBe(false);
        expect(m.routingEnabled('', null)).toBe(false);
        expect(m.routingEnabled(undefined, undefined)).toBe(false);
    });

    test('التخزين يُبقي العلم مضاءة بين المرات', () => {
        const m = esm();
        expect(m.routingEnabled('', '1')).toBe(true);
        expect(m.routingEnabled('?live=1', 'true')).toBe(true);
        expect(m.routingEnabled('', '0')).toBe(false);
        expect(m.routingEnabled('', '')).toBe(false);
        expect(m.routingEnabled('', 'yes')).toBe(false);
    });

    test('الشريط الاستعلامي يغلب التخزين دائمًا — ?v2routing=0 مخرج نجاة', () => {
        const m = esm();
        expect(m.routingEnabled('?v2routing=0', '1')).toBe(false);
        expect(m.routingEnabled('?v2routing=1', '0')).toBe(true);
    });

    test('الوحدة لا تلمس localStorage ولا DOM وقت الاستيراد', () => {
        expect(code(ROUTING)).not.toMatch(/localStorage|document\.|window\./);
    });
});

describe('التوجيه — حارس الانحراف مع preview.js', () => {
    const host = read(HOST);
    const routedKeys = new Set([...host.matchAll(/if \(key === '([a-z0-9-]+)'\)/g)].map((x) => x[1]));

    test('كل مفتاح قائمة له مسار فعلي أو معتمد كمعاينة هيكلية', () => {
        const orphans = [];
        for (const key of navGroups().flatMap((g) => g.keys)) {
            if (key === 'dashboard') {continue;} // فرع اللوحة fallback وليس if
            if (!routedKeys.has(key) && !STUB_KEYS.includes(key)) {orphans.push(key);}
        }
        expect(orphans).toEqual([]);
    });

    test('اللوحة تظل آخر fallback صريحًا', () => {
        expect(host).toMatch(/const isDashboard = !key \|\| key === 'dashboard';/);
    });

    test('كل مسار فرعي في routing.js موجود فعلًا في المُوزِّع', () => {
        const m = esm();
        for (const key of m.SUB_ROUTES) {
            expect({ key, routed: routedKeys.has(key) }).toEqual({ key, routed: true });
        }
    });

    test('محرك الاستعلامات والبطاقة الفاخرة لهما مسار حقيقي (لا بطاقة 🚧)', () => {
        const m = esm();
        const known = m.knownKeys(navGroups());
        for (const key of [ 'query', 'professional' ]) {
            expect({ key, known: known.has(key), routed: routedKeys.has(key) }).toEqual({ key, known: true, routed: true });
        }
        expect(STUB_KEYS).toEqual([]);
    });
});

describe('التوجيه — الوصل في المضيف', () => {
    const host = read(HOST);

    test('العلم يُقرأ من الشريط الاستعلامي ثم التخزين، والمفاتيح من nav-model', () => {
        expect(host).toMatch(/from '\.\/routing\.js\?v=/);
        expect(host).toMatch(/const ROUTING = routingEnabled\(window\.location\.search, storedRoutingFlag\);/);
        expect(host).toMatch(/localStorage\.getItem\('karim_v2_routing'\)/);
        expect(host).toMatch(/const ROUTE_KNOWN = knownKeys\(readNavGroups\(\)\);/);
    });

    test('الاستماع للهاش والوصلة الأخيرة مشروطان بالتوجيه أو رابط المسح', () => {
        expect(host).toMatch(/if \(ROUTING \|\| GOODS_SCAN_DEEP_LINK\) \{window\.addEventListener\('hashchange', applyRouteFromHash\);\}/);
        expect(host).toMatch(/if \(ROUTING \|\| GOODS_SCAN_DEEP_LINK\) \{applyRouteFromHash\(\);\} else \{renderScreen\('dashboard'\);\}/);
        expect(host).toMatch(/function applyKey\(key\) \{[\s\S]*?if \(ROUTING\) \{syncHash\(key\);\}/);
        // مسار التنقّل الواحد: onNavigate لم يعد يرسم مباشرة
        expect(host).toMatch(/onNavigate\(key\) \{[\s\S]{0,120}applyKey\(key\);[\s\S]{0,60}\},/);
        expect(host).not.toMatch(/onNavigate\(key\) \{[\s\S]{0,200}renderScreen\(key\);[\s\S]{0,40}\},/);
    });

    test('رابط فحص الباركود يعمل دون تفعيل التوجيه العام', () => {
        expect(host).toMatch(/import \{[^}]*\bkeyFromHash\b[^}]*\} from '\.\/routing\.js\?v=/);
        expect(host).toMatch(/const GOODS_SCAN_DEEP_LINK = keyFromHash\(window\.location\.hash\) === 'goods-scan';/);
        expect(host).toMatch(/if \(!ROUTING && !GOODS_SCAN_DEEP_LINK\) \{return;\}/);
        expect(host).toMatch(/if \(ROUTING \|\| GOODS_SCAN_DEEP_LINK\) \{applyRouteFromHash\(\);\} else \{renderScreen\('dashboard'\);\}/);
    });

    test('الرابط العميق لا يُدمَّر قبل انتهاء الصلاحيات', () => {
        expect(host).toMatch(/let routeSettled = !LIVE;/);
        expect(host).toMatch(/denied: routeSettled \? currentDenied\(\) : null,/);
        expect(host).toMatch(/if \(!routeSettled && res\.key !== DASH_KEY\) \{return;\}/);
        // التسوية تحدث داخل جلب الصلاحيات نفسه — لا في مكان آخر
        const slice = host.slice(host.indexOf('async function applyMyPermissions'));
        expect(slice).toMatch(/routeSettled = true;[\s\S]{0,160}applyRouteFromHash\(\);/);
        expect(slice.slice(0, slice.indexOf('\n}') + 2)).toMatch(/window\.STATE\.permissions = await fetchMyPermissions\(\);\n\s*shell\.refreshNav\(\);\n\s*\/\/[^\n]*\n\s*routeSettled = true;\n\s*applyRouteFromHash\(\);\n\}/);
    });

    test('رابط اللوحة المحفوظ يُرسم ولا يُختصر بحجة مطابقة الحالة', () => {
        // الحادثة (2026-10-26): فتح ?v2routing=1#/dashboard يرسم صفحة فارغة،
        // لأن الراوتر قارن الهاش بالمفتاح الافتراضي وافترض أن الشاشة مرسومة.
        expect(host).toMatch(/let screenPainted = false;/);
        expect(host).toMatch(/renderScreen\(key\);\s*screenPainted = true;\s*settleScreen\(\);\s*if \(ROUTING\) \{syncHash\(key\);\}/);
        expect(host).toMatch(/if \(screenPainted && res\.key === navStatus\.current && window\.location\.hash === hashFor\(res\.key\)\) \{return;\}/);
    });

    test('البوابة تُبنى من المسحوب لا من قائمة الدور', () => {
        expect(host).toMatch(/state\.permissions\.deniedMenus/);
        expect(host).toMatch(/if \(state && state\.currentUser && state\.currentUser\.role === 'admin'\) \{return new Set\(\);\}/);
        // لا allow-list في قرار المسار: كانسيرف الـ7 شاشات الفرعية للأدمن
        const call = host.slice(host.indexOf('function applyRouteFromHash'), host.indexOf("if (ROUTING || GOODS_SCAN_DEEP_LINK) {window.addEventListener"));
        expect(call).not.toMatch(/allowed/);
        expect(call).toMatch(/denied: routeSettled/);
    });

    test('لا انتظار على سطر يبدأ به (حارس v2-branches)', () => {
        expect(host).not.toMatch(/^\s*await /m);
    });
});
