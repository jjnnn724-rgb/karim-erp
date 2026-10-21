/**
 * سياسة الكاش المُسبق لخدمة العمل الخلفية (البند ٧).
 *
 * لا تُختبر نصوصٌ في الملف؛ تُختبر الآلية: sw.js يُحمَّل في سياقٍ معزول بـ fetch/caches
 * وهميين، ثم يُشتقّ الكاشُ من ملفات المستودع الحقيقية. المفتاحُ الذي لا تطلبه صفحةٌ ولا
 * وحدةٌ ولا manifest لا مكانه في الكاش — لأنه لا يُقرأ أبدًا، وكان يُنزَّل مرّتين.
 */
const fs = require('fs');
const path = require('path');
const { makeSw, readRepoFile, repoReader, ORIGIN, APP_DIR, SW_FILE } = require('./sw-precache-harness');

const SW = fs.readFileSync(SW_FILE, 'utf8');
const INDEX = fs.readFileSync(path.join(APP_DIR, 'index.html'), 'utf8');
const POS = fs.readFileSync(path.join(APP_DIR, 'pos.html'), 'utf8');
const V2 = fs.readFileSync(path.join(APP_DIR, 'v2.html'), 'utf8');
const LEGACY_REV = (INDEX.match(/js\/main\.js\?v=([\d.]+)/) || [])[1];
const POS_REV = (POS.match(/js\/pos\.js\?v=([\d.]+)/) || [])[1];
const V2_REV = (V2.match(/js\/v2\/preview\.js\?v=([\d.]+)/) || [])[1];
// v2.html تحولت إلى وسم لكل ملف (per-file) — قراءة وسم erp-hr نفسه لا من preview REV
const HR_REV = (V2.match(/css\/v2\/erp-hr\.css\?v=([\d.]+)/) || [])[1];
const BOARD = fs.readFileSync(path.join(APP_DIR, 'menu-board.html'), 'utf8');
const BOARD_REV = (BOARD.match(/js\/menu-board\.js\?v=([\d.]+)/) || [])[1];
const PRECACHE_LIMIT = Number((SW.match(/PRECACHE_LIMIT = (\d+)/) || [])[1]);
const MAX_REV = Number((SW.match(/MAX_REVISIONS_PER_PATH = (\d+)/) || [])[1]);

const SHELL_KEYS = ['/app/index.html', '/app/pos.html', '/app/v2.html', '/app/menu-board.html',
    '/app/menu-totem-dashboard.html', '/app/menu-admin.html'];

function tinyEmpty() {
    const out = {};
    for (const key of SHELL_KEYS) {out[key] = '<html></html>';}
    out['/app/manifest.json'] = '{}';
    return out;
}

async function installOn(opts) {
    const sw = makeSw(opts);
    await sw.fire('install');
    const stored = await sw.stored();
    return { sw, stored, keys: stored.map((s) => s.key) };
}

/* كل ما تطلبه الصفحاتُ والوحداتُ والمستخدِمُ — مرآةٌ مستقلة عن آلية الاشتقاق */
function requestedSet() {
    const requested = new Set(SHELL_KEYS);   // الصفحاتُ نفسها يُنتقَل إليها
    const imported = new Set();
    const push = (u) => {
        requested.add(u.pathname);
        const v = u.searchParams.get('v');
        if (v) {requested.add(`${u.pathname}?v=${v}`);}
    };
    for (const page of SHELL_KEYS) {
        const html = readRepoFile(page) || '';
        for (const m of html.matchAll(/\b(?:src|href)="([^"]*)"/g)) {
            if (/^(data:|#|javascript:|mailto:|tel:)/i.test(m[1])) {continue;}
            let u; try { u = new URL(m[1], `${ORIGIN}${page}`); } catch (_) {continue;}
            if (u.origin === ORIGIN) {push(u);}
        }
    }
    for (const m of (readRepoFile('/app/manifest.json') || '').matchAll(/"src"\s*:\s*"([^"]+)"/g)) {
        requested.add(m[1]);
    }
    for (const key of [...requested]) {
        const rel = key.replace(/^\/app\//, '').split('?')[0];
        if (!rel.endsWith('.js') || rel.includes('/vendor/') || rel.endsWith('.min.js')) {continue;}
        const text = readRepoFile(key);
        if (!text) {continue;}
        for (const m of text.matchAll(/['"](\.[^'"]*?\.(?:js|css|mjs|json)(?:\?v=[0-9.]+)?)['"]/g)) {
            const u = new URL(m[1], `${ORIGIN}${key}`);
            if (u.origin === ORIGIN) {imported.add(`${u.pathname}${u.search}`);}
        }
    }
    return { requested, imported };
}

describe('الكاش المُسبق على المستودع الحقيقي: لا مفاتيح ميتة', () => {
    let run;
    beforeAll(async () => {run = await installOn({ files: repoReader() });});

    test('كل مفتاحٍ مخزَّنٍ له ملفٌ على القرص: صفر مفتاحٍ ميت', () => {
        expect(run.keys.filter((k) => readRepoFile(k) === undefined)).toEqual([]);
    });

    test('كل مفتاحٍ مخزَّنٍ يطابق طلبًا حقيقيًا (وسمُ صفحةٍ أو استيرادُ وحدةٍ أو manifest)', () => {
        const { requested, imported } = requestedSet();
        const strangers = run.keys.filter((k) => !requested.has(k) && !imported.has(k));
        expect(strangers).toEqual([]);
    });

    test('تغطيةٌ لأصحاب الشاشات: الكلاسيكي والـ POS و V2 ولوحات المنيو', () => {
        const has = (k) => expect(run.keys).toContain(k);
        has(`/app/js/main.js?v=${LEGACY_REV}`);
        has(`/app/js/karim-i18n.js?v=${LEGACY_REV}`);
        has(`/app/js/features/branches.js?v=${LEGACY_REV}`);
        has(`/app/js/pos.js?v=${POS_REV}`);
        has(`/app/js/v2/preview.js?v=${V2_REV}`);
        expect(HR_REV).toBeDefined();   // وسمٌ حاضر لا مطابقةٌ لغيره
        has(`/app/css/v2/erp-hr.css?v=${HR_REV}`);
        has(`/app/js/menu-board.js?v=${BOARD_REV}`);
    });

    test('المفتاحُ الميت بصيغته القديمة زال: مراجعةٌ واحدة لكل مسار، لا بقايا المراجعات', () => {
        const only = (base) => run.keys.filter((k) => k.startsWith(base));
        // القديمة كانت تخزّن pos.js بمراجعة الصفحة index لا بمراجعته هو، وتترك kitchen.js بلا مراجعة
        expect(only('/app/js/pos.js?v=')).toEqual([`/app/js/pos.js?v=${POS_REV}`]);
        expect(only('/app/js/features/kitchen.js?v=')).toEqual([`/app/js/features/kitchen.js?v=${LEGACY_REV}`]);
        expect(run.keys).not.toContain('/app/assets/horus-logo.png');   // لا يرمز إليه صفحةٌ ولا manifest
    });

    test('تخزينٌ مفرد: لا ملفٌ في كاشين، ولا أصلٌ طُلِب مرّتين', () => {
        expect(new Set(run.keys).size).toBe(run.keys.length);
        expect(new Set(run.sw.asked).size).toBe(run.sw.asked.length);
        expect(run.sw.asked.length).toBe(run.keys.length);
    });

    test('الصفحاتُ الستّ مخزَّنة: هي الملاذ حين تنقطع الشبكة', () => {
        for (const page of SHELL_KEYS) {expect(run.keys).toContain(page);}
    });

    test('أنواعُ الأصول تذهب إلى أكشاشها: صورٌ وخطوطٌ وكودٌ في ثلاثٍ لا في واحدة', () => {
        const cacheOf = (key) => (run.stored.find((s) => s.key === key) || {}).cache;
        expect(cacheOf('/app/assets/icon-512.png')).toMatch(/karim-images-/);
        expect(cacheOf('/app/fonts/menu/tajawal-normal-400-arabic.woff2')).toMatch(/karim-fonts-/);
        expect(cacheOf('/app/manifest.json')).toMatch(/karim-static-/);
        expect(cacheOf('/app/js/main.js?v=' + LEGACY_REV)).toMatch(/karim-static-/);
        expect(run.stored.filter((s) => /^karim-erp-/.test(s.cache))).toEqual([]);
    });

    test('الحجمُ المعقول: الكاشُ المشتقّ أكبرُ تغطيةً وأقلُّ تنزيلًا من القائمة القديمة', () => {
        const size = (k) => {
            try {return fs.statSync(path.join(APP_DIR, k.replace('/app/', '').split('?')[0])).size;} catch (_) {return 0;}
        };
        const bytes = run.keys.reduce((s, k) => s + size(k), 0);
        // القائمة القديمة: ٤٫٢ ميجابيت تُنزَّل مرّتين = ٨٫٤، منها ١٫٣ ميجابيت لا يُقرأ
        expect(bytes).toBeLessThan(8.4e6);
        expect(run.keys.length).toBeGreaterThan(100);
        expect(run.keys.length).toBeLessThanOrEqual(PRECACHE_LIMIT);
    });
});

describe('قواعدُ الاشتقاق: المفتاحُ الصحيح لا المؤلَّف', () => {
    const sw = makeSw({ files: {} });

    test('استعلامٌ غير المراجعة لا يصنع مفتاحًا', () => {
        expect(sw.assetKey('/app/v2.html?live=1', `${ORIGIN}/app/index.html`)).toBe('/app/v2.html');
        expect(sw.assetKey('css/pos.css?v=4.9.32', `${ORIGIN}/app/pos.html`)).toBe('/app/css/pos.css?v=4.9.32');
    });

    test('المسارُ يُحلّ من موقع الصفحة لا من جذر النطاق', () => {
        expect(sw.assetKey('./core/pwa.js?v=1', `${ORIGIN}/app/js/main.js`)).toBe('/app/js/core/pwa.js?v=1');
        expect(sw.assetKey('../data/x.js?v=2', `${ORIGIN}/app/js/v2/screens/y.js`)).toBe('/app/js/v2/data/x.js?v=2');
    });

    test('ما ليس أصلًا ثابتًا داخل نطاق التطبيق يُستبعد', () => {
        const base = `${ORIGIN}/app/index.html`;
        expect(sw.assetKey('https://fonts.gstatic.com/x.woff2', base)).toBeNull();
        expect(sw.assetKey('/uploads/invoice-1.pdf', base)).toBeNull();
        expect(sw.assetKey('/api/state', base)).toBeNull();
        expect(sw.assetKey('data:image/png;base64,AAA', base)).toBeNull();
        expect(sw.assetKey('#top', base)).toBeNull();
        expect(sw.assetKey('/app/promo.mp4', base)).toBeNull();
    });
});

describe('الاشتقاقُ على شجرةٍ صغيرة: الطبقاتُ والعزلُ والسقف', () => {
    const tiny = {
        ...tinyEmpty(),
        '/app/index.html': '<script src="js/main.js?v=9.0.0"></script><link href="css/a.css?v=9.0.0">'
            + '<a href="/app/v2.html?live=1">v2</a><img src="/app/assets/pic.png">',
        '/app/pos.html': '<script src="js/pos.js?v=9.0.1"></script>',
        '/app/v2.html': '<script src="js/v2/app.js?v=9.0.2"></script>',
        '/app/manifest.json': '{"icons":[{"src":"/app/assets/icon-192.png"}]}',
        '/app/js/main.js?v=9.0.0': `import { x } from './core/one.js?v=9.0.0';
            await safeBridge('./features/two.js?v=9.0.0', 'B');
            import('./lib/three.css?v=9.0.0');`,
        '/app/js/pos.js?v=9.0.1': `import './deep/pos-part.js?v=9.0.1';
            import '../vendor/xlsx.full.min.js?v=9.0.1';`,
        '/app/js/v2/app.js?v=9.0.2': `import { s } from './screens/emp.js?v=9.0.2';`,
        '/app/js/core/one.js?v=9.0.0': 'import "./deeper/never.js?v=9.0.0";',
        '/app/js/features/two.js?v=9.0.0': '',
        '/app/js/lib/three.css?v=9.0.0': '.a{color:red}',
        '/app/js/deep/pos-part.js?v=9.0.1': '',
        '/app/vendor/xlsx.full.min.js?v=9.0.1': 'var a="./renderer/svg-tag.js";',
        '/app/js/v2/screens/emp.js?v=9.0.2': '',
        '/app/css/a.css?v=9.0.0': '.b{color:blue}',
        '/app/assets/pic.png': '',
        '/app/assets/icon-192.png': '',
        '/app/assets/icon-512.png': '',
        '/app/assets/icon-192-maskable.png': '',
        '/app/assets/icon-512-maskable.png': '',
    };

    test('طبقتان لا ثلاث: استيرادُ الصفحة يُمشى، واستيرادُ الاستيرادِ يُترك لوقت التشغيل', async () => {
        const { keys } = await installOn({ files: tiny });
        expect(keys).toContain('/app/js/core/one.js?v=9.0.0');
        expect(keys).toContain('/app/js/features/two.js?v=9.0.0');   // بلا import — نصٌّ عادي
        expect(keys).toContain('/app/js/v2/screens/emp.js?v=9.0.2');
        expect(keys).toContain('/app/js/lib/three.css?v=9.0.0');
        expect(keys).not.toContain('/app/js/deeper/never.js?v=9.0.0');
    });

    test('مكتباتُ البائع تُخزَّن ولا تُمشَى: سلاسلُها ليست طلبات', async () => {
        const { keys } = await installOn({ files: tiny });
        expect(keys).toContain('/app/vendor/xlsx.full.min.js?v=9.0.1');
        expect(keys).not.toContain('/app/vendor/renderer/svg-tag.js');
    });

    test('مجرَّدُ الوصفِ في الصفحة أصلٌ حقيقي: بلا استعلامٍ زائد', async () => {
        const { keys } = await installOn({ files: tiny });
        expect(keys).toContain('/app/v2.html');
        expect(keys).toContain('/app/assets/pic.png');
        expect(keys).toContain('/app/assets/icon-192.png');
        expect(keys).not.toContain('/app/v2.html?live=1');
    });

    test('فشلُ أصلٍ واحدٍ لا يُسقط الكاش: البقيةُ تُخزَّن والتنصيبُ يكتمل', async () => {
        const sw = makeSw({ files: tiny, failing: (key) => key === '/app/js/features/two.js?v=9.0.0' });
        let skipped = false;
        sw.self.skipWaiting = () => {skipped = true;};
        await sw.fire('install');
        const keys = (await sw.stored()).map((s) => s.key);
        expect(keys).not.toContain('/app/js/features/two.js?v=9.0.0');
        expect(keys).toContain('/app/js/core/one.js?v=9.0.0');
        expect(keys.length).toBeGreaterThan(8);
        expect(skipped).toBe(true);
    });

    test('تعذُّرُ القراءةِ لا يعني كاشًا أنقصَ من المطلوب: الصفحاتُ تُحفظ قبل أن تُمشَى', async () => {
        const broken = { ...tiny, '/app/js/main.js?v=9.0.0': undefined };
        const sw = makeSw({ files: broken });
        await sw.fire('install');
        const keys = (await sw.stored()).map((s) => s.key);
        expect(keys).toContain('/app/index.html');
        expect(keys).not.toContain('/app/js/core/one.js?v=9.0.0');   // لم يُكتشف: يُكتسب وقت التشغيل
    });

    test('سقفُ العدد يمنع انفلات الكاش المُسبق', async () => {
        const many = { ...tiny };
        const specs = [];
        for (let i = 0; i < 400; i++) {specs.push(`'./gen/g${i}.js?v=9.0.0'`);}
        many['/app/js/main.js?v=9.0.0'] = `const t = [${specs.join(',')}];`;
        for (let i = 0; i < 400; i++) {many[`/app/js/gen/g${i}.js?v=9.0.0`] = ''; }
        const { keys } = await installOn({ files: many });
        expect(PRECACHE_LIMIT).toBeGreaterThan(100);
        expect(keys.length).toBe(PRECACHE_LIMIT);
    });
});

describe('تقليمُ المراجعات: ذاكرةٌ محدودة بدل تَرَاكُمٍ لا ينتهي', () => {
    const [ROOT, STATIC] = makeSw({ files: {} }).names();

    async function seeded(keys, name) {
        const sw = makeSw({ files: {} });
        const cache = await sw.seedCache(name, keys);
        return { sw, cache };
    }

    const urlsOf = async (cache) => (await cache.keys()).map((r) => {
        const u = new URL(r.url);
        return u.pathname + u.search;
    });

    test('ثلاثُ مراجعاتٍ لنفس المسار: تبقى الأحدثُ وتُمحى الأقدم', async () => {
        const target = '/app/js/v2/screens/emp.js';
        const { sw, cache } = await seeded([`${target}?v=1.0.1`, `${target}?v=1.0.2`, `${target}?v=1.0.3`], STATIC);
        await sw.evalIn('pruneOldRevisions()');
        expect(await urlsOf(cache)).toEqual([`${target}?v=1.0.2`, `${target}?v=1.0.3`]);
    });

    test('المفتاحُ بلا مراجعةٍ أصلِيٌّ فلا يُمسّ، والمساراتُ مستقلة', async () => {
        const plain = '/app/js/icons.js';
        const other = '/app/js/scanner.js';
        const { sw, cache } = await seeded([plain, `${other}?v=1`, `${other}?v=2`, `${other}?v=3`], STATIC);
        await sw.evalIn('pruneOldRevisions()');
        expect(await urlsOf(cache)).toEqual([plain, `${other}?v=2`, `${other}?v=3`]);
    });

    test('كاشُ الجذور (طلبات التنقُّل) يُقلَّم هو الآخر', async () => {
        const keys = ['/app/index.html?v=1', '/app/index.html?v=2', '/app/index.html?v=3'];
        const { sw, cache } = await seeded(keys, ROOT);
        await sw.evalIn('pruneOldRevisions()');
        expect((await cache.keys()).length).toBe(MAX_REV);
    });

    test('التنشيطُ لا يتعثّر: عطلُ التقليم لا يمنع claim ولا إشعار التحديث', async () => {
        const sw = makeSw({ files: tinyEmpty() });
        let claimed = false;
        const messages = [];
        sw.self.clients = {
            claim: async () => {claimed = true;},
            matchAll: async () => [{ postMessage: (m) => messages.push(m) }],
        };
        sw.cachesMap.set(sw.names()[1], { async keys() {throw new Error('كاشٌ تالف');} });
        await sw.fire('activate');
        expect(claimed).toBe(true);
        expect(messages[0].type).toBe('SW_UPDATED');
    });
});

describe('ما لم يلمسه البندُ ٧: سياسةُ الجُلب كما قرّر صاحبُها', () => {
    test('سياسةُ التخطي كما هي: لا كاش لبيانات المستخدمين', () => {
        const body = SW.slice(SW.indexOf('function isBypassed'), SW.indexOf('function getCacheName'));
        expect(body).toContain("'/api/'");
        expect(body).toContain("'/socket.io/'");
        expect(body).toContain("'/uploads/'");
    });

    test('الكودُ يبقى network-first: متصلٌ بالإنترنت = أحدثُ كودٍ دائمًا', () => {
        const start = SW.indexOf('if (url.pathname.match(/\\.(css|js|mjs|html|json)$/)) {');
        expect(start).toBeGreaterThan(-1);
        const body = SW.slice(start, SW.indexOf('// الصور والخطوط', start));
        expect(body).toMatch(/event\.respondWith\(\s*fetch\(req\)/);
        expect(body).not.toMatch(/event\.respondWith\(\s*caches\./);
        expect(body).toMatch(/status: 503/);   // بلا اتصال: 503 لا index.html
    });

    test('الصورُ والخطوطُ تبقى stale-while-revalidate بعمرها الطويل', () => {
        expect(SW).toMatch(/staleWhileRevalidate\(req, cacheName, STATIC_TTL\)/);
        expect(SW).toMatch(/const STATIC_TTL = 30 \* 24 \* 60 \* 60 \* 1000;/);
    });

    test('لا addAll بعد اليوم، ولا قائمةُ أصولٍ يدوية', () => {
        expect(SW).not.toMatch(/\.addAll\(/);
        expect(SW).not.toMatch(/STATIC_ASSETS/);
    });

    test('نسخةُ الكاش مرفوعة كي تُمحى أكشاشُ 4.25.55 بمفاتيحها الميتة', () => {
        const version = (SW.match(/CACHE_VERSION='([\d.]+)'/) || [])[1];
        expect(version).not.toBe('4.25.55');
        const [major, minor, patch] = version.split('.').map(Number);
        expect([major, minor]).toEqual([4, 25]);
        expect(patch).toBeGreaterThan(55);
        for (const name of makeSw({ files: {} }).names()) {expect(name).toContain(version);}
    });
});
