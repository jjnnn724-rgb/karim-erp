/**
 * v2-nav-labels.test.js — كل صفحة في ROLES يجب أن تصل إلى الشريط الجانبي
 * ═══════════════════════════════════════════════════════════════════════
 * سبب الاختبار: nav-model يهمل أي مفتاح مسموح بلا تسمية — نفس قاعدة
 * buildNav (auth-navigation.js:351). ثمانية مفاتيح كانت في ROLES ولها شاشات
 * ومسارات في V2 لكنها غائبة عن MENU_STRINGS (‏40 مفتاحًا فقط)، فكانت تختفي
 * من القائمة كأنها غير موجودة — ومنها «مقارنة الصرف والمبيعات».
 *
 * يُثبَّت الباب من الجهتين:
 *   ١) لكل مفتاح في ROLES تسمية في MENU_STRINGS ∪ V2_MENU_STRINGS.
 *   ٢) لكل مفتاح في ROLES مجموعة في NAV_GROUPS_FALLBACK (لا صفحة بلا ركن).
 *   ٣) تسميات V2 الثمانية هي عناوين القديم نفسها، وأيقوناتها موجودة.
 *   ٤) preview يزرع الناقص قبل بناء القائمة ولا يطمس ما ركّبه المضيف.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const APP = path.join(__dirname, '..', 'frontend', 'app');
const CONFIG = path.join(APP, 'js', 'core', 'config.js');
const I18N = path.join(APP, 'js', 'core', 'i18n.js');
const ICONS = path.join(APP, 'js', 'icons.js');
const PREVIEW = path.join(APP, 'js', 'v2', 'preview.js');
const NAVMODEL = path.join(APP, 'js', 'v2', 'layout', 'nav-model.js');
const read = (p) => fs.readFileSync(p, 'utf8');

/** ROLES من config.js — الأسطر مفردة، فلا حاجة لتنفيذ الوحدة. */
function roleMenus() {
    const src = read(CONFIG);
    const roles = {};
    for (const line of src.split('\n')) {
        const m = line.match(/^(\w+):\s*\{[^}]*?menus:\s*\[([^\]]*)\]/);
        if (m) {roles[m[1]] = [...m[2].matchAll(/'([a-z0-9-]+)'/g)].map((x) => x[1]);}
    }
    return roles;
}

/** MENU_STRINGS من i18n.js — التسميات القصيرة للشريط. */
function menuStrings() {
    const src = read(I18N);
    const start = src.indexOf('const MENU_STRINGS = {');
    const end = src.indexOf('\n}', start);
    const out = {};
    for (const line of src.slice(start, end).split('\n')) {
        const m = line.match(/^\s*'?([a-z0-9-]+)'?:\s*\{\s*icon:\s*'([a-z0-9-]+)',\s*ar:\s*'([^']+)'/);
        if (m) {out[m[1]] = { icon: m[2], ar: m[3] };}
    }
    return out;
}

/** الطبقة التي يضيفها مضيف V2 لما لا يعرفه القديم. */
function v2MenuStrings() {
    const src = read(PREVIEW);
    const start = src.indexOf('const V2_MENU_STRINGS = Object.freeze({');
    const end = src.indexOf('});', start);
    const out = {};
    for (const line of src.slice(start, end).split('\n')) {
        const m = line.match(/'([a-z0-9-]+)':\s*\{\s*icon:\s*'([a-z0-9-]+)',\s*ar:\s*'([^']+)'/);
        if (m) {out[m[1]] = { icon: m[2], ar: m[3] };}
    }
    return out;
}

function loadEsm(file, collect) {
    const src = read(file)
        .split('\n')
        .filter((line) => !/^\s*import\b|^\s*from\s*'[^']*';?\s*$/.test(line))
        .join('\n')
        .replace(/^export\s+/gm, '');
    const context = {
        console, String, Number, Boolean, Array, Object, RegExp, Error, Set, Map, JSON,
    };
    vm.createContext(context);
    vm.runInContext(`${src}\n;Object.assign(globalThis, {${collect.join(', ')}});`, context, { filename: file });
    return context;
}

/** مجموعات التنقّل الفعلية — بلا window فتعود إلى NAV_GROUPS_FALLBACK. */
const navGroups = () => loadEsm(NAVMODEL, ['readNavGroups']).readNavGroups();
const groupKeys = () => new Set(navGroups().flatMap((g) => (Array.isArray(g.keys) ? g.keys : [])));
const groupOf = (key) => {
    const found = navGroups().find((g) => Array.isArray(g.keys) && g.keys.includes(key));
    return found ? found.id : null;
};

describe('تسميات القائمة — ROLES ∪ MENU_STRINGS', () => {
    test('لا مفتاح دور بلا تسمية (وإلا اختفى من الشريط بلا أثر)', () => {
        const labels = { ...menuStrings(), ...v2MenuStrings() };
        const missing = [];
        for (const [role, keys] of Object.entries(roleMenus())) {
            for (const key of keys) {
                if (!labels[key]) {missing.push(`${role}:${key}`);}
            }
        }
        expect(missing).toEqual([]);
    });

    test('الثمانية التي كانت تسقط تحمل عناوين القديم حرفيًا', () => {
        const labels = { ...menuStrings(), ...v2MenuStrings() };
        const legacyTitles = {
            'menu-board': 'شاشات المنيو',
            'permissions': 'الصلاحيات',
            'oracle-data': 'بيانات Oracle',
            'yara-daily-locks': 'التقفيل اليومي',
            'sales-analyzer': 'تحليل مبيعات الكاشيرية',
            'received-analyzer': 'استلام المخازن',
            'wh-vs-pos': 'مقارنة الصرف والمبيعات',
            'dept-employees': 'موظفو قسمي',
        };
        for (const [key, title] of Object.entries(legacyTitles)) {
            expect({ key, label: labels[key] && labels[key].ar }).toEqual({ key, label: title });
        }
    });

    test('أيقونات التسميات الثمانية موجودة في مجموعة الأيقونات', () => {
        const icons = read(ICONS);
        const missing = Object.entries(v2MenuStrings())
            .filter(([, m]) => !icons.includes(`'${m.icon}'`) && !icons.includes(`${m.icon}:`))
            .map(([key]) => key);
        expect(missing).toEqual([]);
    });
});

describe('تجميع القائمة — ROLES ⊆ NAV_GROUPS', () => {
    test('كل مفتاح دور له مجموعة — لا صفحة في «غير المصنّف»', () => {
        const grouped = groupKeys();
        const orphans = [];
        for (const [role, keys] of Object.entries(roleMenus())) {
            for (const key of keys) {
                if (!grouped.has(key)) {orphans.push(`${role}:${key}`);}
            }
        }
        expect(orphans).toEqual([]);
    });

    test('المفاتيح الثلاثة التي لم يضعها القديم في مجموعة صارت في أركانها', () => {
        expect(groupOf('menu-board')).toBe('ops');
        expect(groupOf('cashier-monitor')).toBe('finance');
        expect(groupOf('yara-daily-locks')).toBe('finance');
    });

    test('كل تسمية V2 لها مجموعة — لا تسمية معلّقة بلا ركن', () => {
        const grouped = groupKeys();
        expect(Object.keys(v2MenuStrings()).filter((key) => !grouped.has(key))).toEqual([]);
    });

    test('لا مفتاح مكرر داخل مجموعتين', () => {
        const seen = new Set();
        const dupes = [];
        for (const group of navGroups()) {
            for (const key of (Array.isArray(group.keys) ? group.keys : [])) {
                if (seen.has(key)) {dupes.push(key);}
                seen.add(key);
            }
        }
        expect(dupes).toEqual([]);
    });
});

describe('باب العبور في المضيف', () => {
    const pv = read(PREVIEW);

    test('preview يبني التسميات من MENU_STRINGS ثم يكمل الناقص', () => {
        expect(pv).toContain('const MENU_CATALOG = { ...(MENU_STRINGS || {}), ...V2_MENU_STRINGS };');
        expect(pv).toContain('if (!window.ALL_PERMISSIONS.menus[key]) {');
        expect(pv).toContain('window.ALL_PERMISSIONS.menus[key] = `<i class=ji data-i=${m.icon}></i> ${m.ar}`;');
        expect(pv).toContain('const menuLabel = (key) => (MENU_CATALOG[key] && MENU_CATALOG[key].ar) || key;');
    });

    test('تسمية المضيف لا تُطمس، والمصدر لا يُعاد تعريفه', () => {
        // لا كتابة فوق موجود: الشرط يسبق الإسناد
        const idx = pv.indexOf('window.ALL_PERMISSIONS.menus[key] = ');
        const guard = pv.lastIndexOf('if (!window.ALL_PERMISSIONS.menus[key])', idx);
        expect(guard).toBeGreaterThan(-1);
        // MENU_STRINGS يُستورد من i18n ولا يُنسخ جدولًا جديدًا
        expect(pv).toMatch(/import \{ MENU_STRINGS, t \} from '\.\.\/core\/i18n\.js\?v=\d+\.\d+\.\d+';/);
    });
});
