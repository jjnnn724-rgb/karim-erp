/**
 * v2-lazy-screens.test.js — عقدُ التحميل الكسول للشاشات
 * ────────────────────────────────────────────────────────────────────────────
 * الدافع: preview.js كان يستورد ٥٧ وحدةَ شاشةٍ استيرادًا ساكنًا، فيدفع كلُّ
 * داخلٍ ثمنَها قبل أوّلِ بطاقة. صار السجلُّ (screens/registry.js) هو البوابةَ
 * الوحيدة، وهذا الملف يحرس العقد الذي يجعل الكسلَ آمنًا:
 *   1. لا استيرادَ ساكنًا لشاشةٍ في preview.js إلا dashboard/login (تُركَّبان
 *      دائمًا في أوّل رسم).
 *   2. كل `mountLazy('x')` له راويةٌ واسمُ تصديرٍ مطابقٌ في الوحدة نفسها —
 *      وإلا رُكِّب undefined في منتصف الرسم.
 *   3. كل راويةٍ نصٌّ حرفيّ بمراجعة الصفحة نفسها (?v=) كي يوائمها
 *      scripts/v2-revision.js ويخزّنها الـSW.
 *   4. الترجمة بين مفتاح المسار واسم الملف محصورةٌ في NAV_ALIAS.
 *   5. المرور/التركيز على القائمة يبدأ الطلب استباقيًّا (سرعة محسوسة).
 *   6. الـSW يخزّن الشاشات في الطبقة الثالثة — الكسل لا يعني فقدان العمل دون اتصال.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const APP = path.join(__dirname, '..', 'frontend', 'app');
const V2 = path.join(APP, 'js', 'v2');
const SCREENS = path.join(V2, 'screens');
const REGISTRY = path.join(SCREENS, 'registry.js');
const PREVIEW = path.join(V2, 'preview.js');
const LAYOUT = path.join(V2, 'layout', 'app-layout.js');
const SW = path.join(APP, 'sw.js');
const HTML = path.join(APP, 'v2.html');

const read = (p) => fs.readFileSync(p, 'utf8');
const pageRev = () => read(HTML).match(/js\/v2\/preview\.js\?v=([0-9.]+)/)[1];

function loadRegistry() {
    const src = read(REGISTRY).replace(/^export /gm, '');
    const sandbox = { module: { exports: {} }, exports: {} };
    vm.createContext(sandbox);
    vm.runInContext(
        `${src}\nmodule.exports = { moduleFor, screenModules, loadScreen, prefetch, MOUNTS, LOADERS, NAV_ALIAS };`,
        sandbox,
        { filename: REGISTRY }
    );
    return sandbox.module.exports;
}

const exportsOf = (file) => {
    const code = read(path.join(SCREENS, `${file}.js`)).replace(/\/\*[\s\S]*?\*\//g, '');
    return [...code.matchAll(/export (?:async )?function ([A-Za-z0-9_]+)|export const ([A-Za-z0-9_]+)/g)]
        .map((m) => m[1] || m[2]);
};

describe('registry — سجل الشاشات الكسولة', () => {
    const reg = loadRegistry();

    test('٥٧ وحدة مسجّلة، ولكلٍّ راوية واسم تصدير', () => {
        const keys = reg.screenModules();
        expect(keys).toHaveLength(57);
        for (const key of keys) {
            expect(typeof reg.LOADERS[key]).toBe('function');
            expect(reg.MOUNTS[key]).toMatch(/^mount[A-Za-z]+Screen$/);
        }
        expect(new Set(keys).size).toBe(keys.length);
    });

    test('كل راوية نصٌّ حرفيّ بملفِّ مفتاحها وبمراجعة الصفحة', () => {
        const rev = pageRev();
        const src = read(REGISTRY);
        for (const key of reg.screenModules()) {
            expect(src).toContain(`'${key}': () => import('./${key}.js?v=${rev}'),`);
        }
        // ولا استيرادَ ساكنًا في السجل نفسه — الكسل يقتضي import() حصرًا.
        expect(src).not.toMatch(/^import /m);
    });

    test('كل وحدة تصدّر فعلًا الدالة المعلنة لها', () => {
        const broken = [];
        for (const key of reg.screenModules()) {
            const names = exportsOf(key);
            if (!names.includes(reg.MOUNTS[key])) {broken.push(`${key} → ${reg.MOUNTS[key]}`);}
        }
        expect(broken).toEqual([]);
    });

    test('NAV_ALIAS يحصر الفروق الأربعة فقط بين مفتاح المسار واسم الملف', () => {
        expect(reg.NAV_ALIAS).toEqual({
            'yara-daily-locks': 'daily-locks',
            'pos': 'pos-entry',
            'query': 'inventory-inquiry',
            'professional': 'inventory-inquiry-pro',
        });
        for (const [navKey, moduleKey] of Object.entries(reg.NAV_ALIAS)) {
            expect(typeof reg.LOADERS[moduleKey]).toBe('function');
            expect(reg.moduleFor(navKey)).toBe(moduleKey);
        }
        expect(reg.moduleFor('branches')).toBe('branches');
        expect(reg.moduleFor('dashboard')).toBe(null); // تُركَّب ساكنة
        expect(reg.moduleFor('login')).toBe(null);
        expect(reg.moduleFor('لا-توجد')).toBe(null);
    });

    test('وحدة غير مسجّلة تُرفَض بوعدٍ مرفوض لا باستثناءٍ متزامن', async () => {
        await expect(reg.loadScreen('لا-توجد')).rejects.toThrow(/غير مسجّلة/);
    });

    test('الفشل يُسقَط من الكاش والنجاح يُطلب مرة واحدة (single flight)', () => {
        const src = read(REGISTRY);
        expect(src).toMatch(/const loaded = new Map\(\)/);
        expect(src).toMatch(/const hit = loaded\.get\(moduleKey\);\n\s*if \(hit\) \{return hit;\}/);
        expect(src).toMatch(/loaded\.set\(moduleKey, pending\)/);
        expect(src).toMatch(/pending\.catch\(\(\) => \{[\s\S]{0,120}loaded\.delete\(moduleKey\)/);
    });
});

describe('preview — البوابة الوحيدة للتركيب', () => {
    const preview = read(PREVIEW);

    test('لا استيرادَ ساكنًا لشاشةٍ غير dashboard/login', () => {
        const imports = [...preview.matchAll(/from '\.\/screens\/([a-z0-9-]+)\.js\?v=/g)].map((m) => m[1]);
        expect(imports.sort()).toEqual(['dashboard', 'login', 'registry']);
    });

    test('كل mountLazy في المضيف له مفتاح مسجّل', () => {
        const reg = loadRegistry();
        const calls = [...preview.matchAll(/mountLazy\('([a-z0-9-]+)'/g)].map((m) => m[1]);
        // ٢٤ موقعًا بمفتاحٍ حرفيّ + مسار السجلات المشترك (module || key).
        expect(calls.length).toBe(24);
        const unknown = calls.filter((k) => !reg.LOADERS[k]);
        expect(unknown).toEqual([]);
        expect(calls).toEqual(expect.arrayContaining([
            'branches', 'attendance', 'employees', 'warehouse', 'warehouse-gov',
            'reports', 'briefing', 'procurement', 'dispatch', 'veg-requests',
        ]));
        // الشاشات المارّة بمضيف السجلات المشترك تُسمّى في module لا في mountLazy.
        const modules = [...preview.matchAll(/module: '([a-z0-9-]+)'/g)].map((m) => m[1]);
        expect(modules).toEqual(expect.arrayContaining(['pos-entry', 'daily-locks', 'inventory-inquiry', 'inventory-inquiry-pro', 'wh-prs', 'wh-returns']));
        expect(modules.filter((k) => !reg.LOADERS[k])).toEqual([]);
    });

    test('مضيف السجلات المشترك يمرّر module ويستمر في تمرير confirmFn', () => {
        expect(preview).toMatch(/function renderLiveRegisterScreen\(\{ key, title, module, assign, extraCtx \}\)/);
        expect(preview).toMatch(/await mountLazy\(module \|\| key, '\[data-v2-register-host\]'/);
        expect(preview).toMatch(/confirmFn: confirmAction,/);
    });

    test('حارس الرسم: لا تركيب في مضيفٍ منزوع ولا نسخة قديمة فوق أحدث', () => {
        expect(preview).toMatch(/if \(navStatus\.current !== navKey\) \{return null;\}/);
        expect(preview).toMatch(/if \(!host \|\| host !== pending\) \{return null;\}/);
        expect(preview).toMatch(/\}\)\) \|\| branchesScreen;/);
    });

    test('فشل التحميل يُعلن نفسه ولا يعرض بيانات نموذجية', () => {
        expect(preview).toMatch(/function paintLoadFailure\(host, title\)/);
        expect(preview).toMatch(/role="alert"/);
        expect(preview).toMatch(/لا تُعرض بيانات نموذجية/);
    });
});

describe('speed — الطلب يسبق النقر', () => {
    test('عناصر القائمة تُحمّل وحدتها عند المرور والتركيز', () => {
        const layout = read(LAYOUT);
        expect(layout).toMatch(/import \{ prefetch \} from '\.\.\/screens\/registry\.js\?v=/);
        expect(layout).toMatch(/addEventListener\('pointerenter', \(\) => prefetch\(node\.dataset\.erpNav\)\)/);
        expect(layout).toMatch(/addEventListener\('focus', \(\) => prefetch\(node\.dataset\.erpNav\)\)/);
    });

    test('الـSW يخزّن الشاشات في طبقة ثالثة مقيَّدة بـscreens/', () => {
        const sw = read(SW);
        expect(sw).toMatch(/const registryKey = \[\.\.\.new Set\(importedRefs\)\]\.find\(\(k\) => k\.startsWith\('\/app\/js\/v2\/screens\/registry\.js'\)\)/);
        expect(sw).toMatch(/screenRefs\.push\(\.\.\.refsInModule\(text, hrefOf\(registryKey\)\)\.filter\(\(k\) => k\.includes\('\/js\/v2\/screens\/'\)\)\)/);
        expect(sw).toMatch(/\[\.\.\.pageRefs, \.\.\.importedRefs, \.\.\.screenRefs\]/);
    });
});
