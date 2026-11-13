/**
 * v2-mobile-pwa.test.js — الهاتف: فتحٌ على V2، وصوتٌ يُسمع من أول نداء
 * ═══════════════════════════════════════════════════════════════════════
 * المالك: «v2 مش بيشتغل كويس على الموبايل». القياس أظهر أن التخطيط سليم
 * عند 360/390/414، وأن العطب في العقد لا في الـ CSS:
 *   ١) التطبيق المثبَّت كان يفتح الواجهة القديمة (المانيفست يربط v2.html
 *      بنفس مانيفست index.html).
 *   ٢) انقطعت الشبكة في منتصف الوردية فأعطىSW الصفحةَ القديمة بدل الشاشة
 *      التي طلبها الموظف، لأن الرابط يختلف في استعلامه فقط (?live=1).
 *   ٣) أولُ نداءٍ على أندرويد يخرج صامتًا: قائمةُ أصوات المحرك فارغة حتى
 *      يصل تحديثها، فلا صوتَ عربي ثم صمتٌ مُعلن.
 *   ٤) رمزُ الوصول 15 دقيقة والمؤقّت ينام حين يجمّد الهاتف التبويب.
 * كل بندٍ مُثبَّتٌ هنا بسلوكه، لا بسطرٍ في ملف.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const APP = path.join(__dirname, '..', 'frontend', 'app');
const read = (p) => fs.readFileSync(p, 'utf8');
const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');

const MANIFEST = JSON.parse(read(path.join(APP, 'manifest.v2.json')));
const V2_HTML = read(path.join(APP, 'v2.html'));
const SW = read(path.join(APP, 'sw.js'));
const SESSION = read(path.join(APP, 'js', 'v2', 'session.js'));
const CALL = path.join(APP, 'js', 'v2', 'callout.js');
const NAV = read(path.join(APP, 'js', 'v2', 'layout', 'nav-model.js'));

/* ── ١. التطبيق المثبَّت يفتح V2 ─────────────────────────────────────── */
describe('PWA الهاتف — مانيفست V2 مستقل', () => {
    test('v2.html يرتبط بمانيفسته الخاصة، لا بمانيفست الواجهة القديمة', () => {
        expect(V2_HTML).toContain('href="/app/manifest.v2.json"');
        expect(V2_HTML).not.toContain('href="/app/manifest.json"');
    });

    test('الفاتحةُ هي V2 حيًّا، والمعرّفُ مختلفٌ كي لا يُلغى التثبيتُ القديم', () => {
        expect(MANIFEST.start_url).toBe('/app/v2.html?live=1');
        expect(MANIFEST.id).toBe('/app/v2.html');
        expect(MANIFEST.scope).toBe('/app/');
        expect(MANIFEST.display).toBe('standalone');
        expect(MANIFEST.lang).toBe('ar');
        expect(MANIFEST.dir).toBe('rtl');
        // scope يغطّي الفاتحة والمعرّف وكل رابطٍ مختصر
        for (const url of [MANIFEST.start_url, MANIFEST.id, ...MANIFEST.shortcuts.map((s) => s.url)]) {
            expect(url.startsWith(MANIFEST.scope)).toBe(true);
        }
        // الواجهة القديمة لم تلمسها يدٌ هنا
        const legacy = JSON.parse(read(path.join(APP, 'manifest.json')));
        expect(legacy.start_url).toBe('/app/index.html');
    });

    test('الأيقونات موجودةٌ فعلًا، والاختصاراتُ تفتح شاشاتٍ حقيقية', () => {
        for (const icon of MANIFEST.icons) {
            const file = path.join(APP, icon.src.replace('/app/', ''));
            expect({ src: icon.src, exists: fs.existsSync(file) }).toEqual({ src: icon.src, exists: true });
        }
        expect(MANIFEST.icons.map((i) => i.purpose)).toEqual(expect.arrayContaining(['any', 'maskable']));
        const keys = MANIFEST.shortcuts
            .map((s) => (s.url.match(/#\/([a-z0-9-]+)/) || [])[1])
            .filter(Boolean);
        expect(keys.length).toBeGreaterThan(0);
        for (const key of keys) {
            expect(NAV.includes(`'${key}'`)).toBe(true);   // لا شاشة مخترعة في اختصار
        }
        // الكاشير المستقل يبقى اختصارًا مباشرًا (صفحةٌ لا مسار V2)
        expect(MANIFEST.shortcuts.some((s) => s.url === '/app/cashier/')).toBe(true);
    });
});

/* ── ٢. بلا شبكة: شاشةُ الموظف لا شاشةُ النظام القديم ────────────────── */
describe('PWA الهاتف — الملاذ دون اتصال', () => {
    test('مطابقةُ الكاش تُهمِل الاستعلام قبل الهبوط إلى index.html', () => {
        const stripped = strip(SW);
        const start = stripped.indexOf("if (req.mode === 'navigate')");
        const end = stripped.indexOf('OFFLINE_PAGE', start);
        expect(start).toBeGreaterThan(-1);
        expect(end).toBeGreaterThan(start);
        const body = stripped.slice(start, end);
        expect(body).toMatch(/caches\.match\(req, \{ ignoreSearch: true \}\)/);
        // الترتيب: الطلب نفسه ⇒ نفس الصفحة باستعلامٍ آخر ⇒ index.html أخيرًا
        const exact = body.indexOf('caches.match(req)');
        const loose = body.indexOf('ignoreSearch: true');
        const legacy = body.indexOf("caches.match('/app/index.html')");
        expect(exact).toBeGreaterThan(-1);
        expect(loose).toBeGreaterThan(exact);
        expect(legacy).toBeGreaterThan(loose);
    });
});

/* ── ٣. التجديد يستيقظ مع الهاتف لا مع المؤقّت فقط ──────────────────── */
describe('جلسة الهاتف — إعادة التسليح', () => {
    test('التجديد الاستباقي مربوطٌ بالتحويل للصفحة وعودتها وعودتها من bfcache', () => {
        const src = strip(SESSION);
        expect(src).toMatch(/listen\(document, 'visibilitychange'\)/);
        expect(src).toMatch(/listen\(window, 'pageshow'\)/);
        expect(src).toMatch(/listen\(window, 'online'\)/);
        // المعالج واحد، ولا يلمس شيئًا بلا جلسة
        expect(src).toMatch(/if \(!window\._jwt && !readRefreshToken\(\)\) \{return;\}/);
        // ولا مربوطٍ في سياقٍ بلا DOM (vm الاختباري) يرمي
        expect(src).toMatch(/typeof target\.addEventListener === 'function'/);
    });
});

/* ── ٣ب. الانقطاع لا يُطرد الموظف ────────────────────────────────────── */
const SESSION_NAMES = ['silentRefresh', 'lastRefreshOutcome', 'readRefreshToken', 'installApiFetchBridge'];

function loadSession({ response, throwFetch = false, rt = 'rt-token' } = {}) {
    const src = read(path.join(APP, 'js', 'v2', 'session.js'))
        .split('\n')
        .filter((line) => !/^\s*import\b|^\s*from\s*'[^']*';?\s*$/.test(line))
        .join('\n')
        .replace(/^export\s+/gm, '')
        + `\n;Object.assign(globalThis, {${SESSION_NAMES.join(', ')}});`;
    const data = {};
    const store = {
        getItem: (k) => (k in data ? data[k] : null),
        setItem: (k, v) => {data[k] = String(v);},
        removeItem: (k) => {delete data[k];},
    };
    if (rt) {store.setItem('karim_rt_v1', rt);}
    const context = {
        console, String, Number, Boolean, Array, Object, RegExp, Error, Set, Map, JSON, Date, Math,
        Promise,
        /* مؤقّتٌ زائف: التجديد الصامت يجدول مؤقّتًا بعمر الرمز (دقائق)،
           والمؤقّتُ الحقيقيّ يُبقي عملية jest حيّة بعد آخر اختبار. */
        setTimeout: () => 1, clearTimeout: () => {},
        atob: (s) => Buffer.from(s, 'base64').toString('binary'),
        TextDecoder, Uint8Array,
        localStorage: store,
        window: {location: {origin: 'https://erp.test'}},
        fetch: async () => {
            if (throwFetch) {throw TypeError('Failed to fetch');}
            return response;
        },
    };
    vm.createContext(context);
    vm.runInContext(src, context, { filename: path.join(APP, 'js', 'v2', 'session.js') });
    return {ctx: context, store};
}

describe('جلسة الهاتف — سببُ الفشل معروف', () => {
    test('لا شبكة: التجديد يقول network ولا يمسح رمز التحديث', async () => {
        const {ctx, store} = loadSession({throwFetch: true});
        expect(await ctx.silentRefresh()).toBeNull();
        expect(ctx.lastRefreshOutcome()).toBe('network');
        expect(store.getItem('karim_rt_v1')).toBe('rt-token');   // ينجح بعد ثانيةٍ بلا إعادة دخول
    });

    test('بوابةٌ راجعة 502 (تونل/إعادة تشغيل): network لا رمزٌ ميت', async () => {
        const {ctx, store} = loadSession({response: {ok: false, status: 502, json: async () => ({})}});
        expect(await ctx.silentRefresh()).toBeNull();
        expect(ctx.lastRefreshOutcome()).toBe('network');
        expect(store.getItem('karim_rt_v1')).toBe('rt-token');
    });

    test('401 من التجديد: رمزٌ ميت يقينًا، فيُمحى ويُقال rejected', async () => {
        const {ctx, store} = loadSession({response: {ok: false, status: 401, json: async () => ({error: 'TOKEN_INVALID'})}});
        expect(await ctx.silentRefresh()).toBeNull();
        expect(ctx.lastRefreshOutcome()).toBe('rejected');
        expect(store.getItem('karim_rt_v1')).toBeNull();
    });

    test('بلا رمز تحديث أصلًا: none — لا شيء يُستعاد ولا شيء يضيع', async () => {
        const {ctx} = loadSession({rt: ''});
        expect(await ctx.silentRefresh()).toBeNull();
        expect(ctx.lastRefreshOutcome()).toBe('none');
    });

    test('نجاحٌ صامت: رمزٌ حيّ في الذاكرة والحالة ok', async () => {
        const jwt = `${Buffer.from(JSON.stringify({alg: 'HS256', typ: 'JWT'})).toString('base64url')}`
            + `.${Buffer.from(JSON.stringify({exp: Math.floor(Date.now() / 1000) + 900, role: 'manager'})).toString('base64url')}.sig`;
        const {ctx, store} = loadSession({
            response: {
                ok: true,
                status: 200,
                json: async () => ({access_token: jwt, app_key: 'key', user: {name: 'عبداللطيف', role: 'manager'}}),
            },
        });
        const s = await ctx.silentRefresh();
        expect(s).toMatchObject({source: 'refresh', role: 'manager', accessToken: jwt});
        expect(ctx.lastRefreshOutcome()).toBe('ok');
        expect(ctx.window._jwt).toBe(jwt);              // الرمزُ في الذاكرة وحدها
        expect(store.getItem('karim_rt_v1')).toBe('rt-token');
    });

    test('المضيف يسأل السبب قبل أن يطرد إلى شاشة الدخول', () => {
        const src = strip(read(path.join(APP, 'js', 'v2', 'preview.js')));
        const gate = src.indexOf("lastRefreshOutcome() === 'network'");
        const login = src.indexOf('navigateLogin(keyFromHash');
        expect(gate).toBeGreaterThan(-1);
        expect(login).toBeGreaterThan(gate);
        // ولا حلقة طلبٍ ضيقة: إعادة المحاولة مؤجَّلة لا فورية
        expect(src).toMatch(/setTimeout\(tryNow, RETRY_MS\)/);
        expect(src).toMatch(/addEventListener\('online', revive, \{once: true\}\)/);
    });
});

/* ── ٤. أولُ نداءٍ يُسمَع ────────────────────────────────────────────── */const CALL_NAMES = [
    'VOICE_PREF_KEY', 'VOICE_LOG_KEY', 'VOICE_QUIET_KEY', 'VOICE_SEEN_KEY',
    'announce', 'watchVoices', 'refreshVoices', 'knownVoices', 'pickVoice', 'speak',
];

function loadCallout(context) {
    const src = read(CALL)
        .split('\n')
        .filter((line) => !/^\s*import\b|^\s*from\s*'[^']*';?\s*$/.test(line))
        .join('\n')
        .replace(/^export\s+/gm, '')
        + `\n;Object.assign(globalThis, {${CALL_NAMES.join(', ')}});`;
    vm.createContext(context);
    vm.runInContext(src, context, { filename: CALL });
    return context;
}

class FakeUtterance {
    constructor(text) {this.text = text; this.lang = ''; this.voice = null;}
}

/** محركٌ أصمّ أول الأمر ثم يُحمَّل أصواته — هذا بالضبط أندرويد. */
function androidSynth() {
    const listeners = [];
    const box = { list: [], spoken: [] };
    return {
        box,
        getVoices: () => box.list,
        addEventListener: (ev, fn) => {if (ev === 'voiceschanged') {listeners.push(fn);}},
        speak: (u) => box.spoken.push(u),
        cancel: () => {},
        fire: () => listeners.forEach((fn) => {try {fn();} catch (_) { /* listener لا يرمي */ }}),
    };
}

const memoryStorage = (seed = {}) => {
    const data = {...seed};
    return {
        getItem: (k) => (k in data ? data[k] : null),
        setItem: (k, v) => {data[k] = String(v);},
        removeItem: (k) => {delete data[k];},
    };
};

const AR_EG = {lang: 'ar-EG', name: 'أسماء'};
const FR = {lang: 'fr-FR', name: 'Amelie'};
const notice = {id: 'n-1', name: 'عبداللطيف محمد', title: 'طلب صرف جديد', message: 'من المخزن', category: 'dispatch'};

describe('المنادي على الهاتف — أول نداء لا يضيع', () => {
    test('قائمةٌ فارغة ثم تحديث: المخزون يخدم النداء التالي فورًا', () => {
        const ctx = loadCallout({
            console, String, Number, Boolean, Array, Object, RegExp, Error, Set, Map, JSON, Date, Math,
            setTimeout, clearTimeout,
        });
        const synth = androidSynth();
        expect(ctx.watchVoices({synth})).toBe(true);
        expect(ctx.knownVoices()).toEqual([]);           // لا صوت بعدُ — حالةٌ مجهولة لا «لا عربي»
        synth.box.list = [AR_EG];
        synth.fire();
        expect(ctx.knownVoices().map((v) => v.lang)).toEqual(['ar-EG']);

        const res = ctx.announce(notice, {
            synth, Utterance: FakeUtterance, storage: memoryStorage(), log: [], route: 'dispatch',
            now: Date.UTC(2026, 10, 2, 12),
        });
        expect(res.spoken).toBe(true);
        expect(synth.box.spoken.length).toBe(1);
        expect(synth.box.spoken[0].lang).toBe('ar-EG');
        expect(synth.box.spoken[0].text).toMatch(/^يا عبداللطيف/);
    });

    test('سماعٌ مرّة واحدة لكل محرك، وتحديثٌ لا يعرف العربية لا يسرق الصمت', () => {
        const ctx = loadCallout({
            console, String, Number, Boolean, Array, Object, RegExp, Error, Set, Map, JSON, Date, Math,
            setTimeout, clearTimeout,
        });
        const synth = androidSynth();
        expect(ctx.watchVoices({synth})).toBe(true);
        expect(ctx.watchVoices({synth})).toBe(true);    // لا مستمعٌ مكرَّر
        synth.box.list = [FR];
        synth.fire();
        expect(ctx.pickVoice(ctx.knownVoices())).toBeNull();
        const res = ctx.announce(notice, {
            synth, Utterance: FakeUtterance, storage: memoryStorage(), log: [], route: 'dispatch',
            now: Date.UTC(2026, 10, 2, 12), noWait: true,
        });
        expect(res).toMatchObject({spoken: false, reason: 'no-arabic-voice'});
        expect(synth.box.spoken.length).toBe(0);        // القاعدة ٤ باقية: لا لاتينية تقرأ عربية
    });

    test('المحرك الأصلي على الهاتف يسبق المتصفح، والمخزون لا يعطّله', () => {
        const ctx = loadCallout({
            console, String, Number, Boolean, Array, Object, RegExp, Error, Set, Map, JSON, Date, Math,
            setTimeout, clearTimeout, Promise,
        });
        const synth = androidSynth();
        synth.box.list = [AR_EG];
        const nativeCalls = [];
        const res = ctx.announce(notice, {
            native: {speak: (o) => {nativeCalls.push(o); return Promise.resolve({success: true});}},
            synth, Utterance: FakeUtterance, storage: memoryStorage(), log: [], route: 'dispatch',
            now: Date.UTC(2026, 10, 2, 12),
        });
        expect(res.spoken).toBe(true);
        expect(nativeCalls.length).toBe(1);
        expect(synth.box.spoken.length).toBe(0);        // المتصفح احتياطٌ فقط
    });

    test('استيراد الوحدة لا يرمي حين لا يوجد محرك نطق (سياق بلا نافذة)', () => {
        expect(() => loadCallout({
            console, String, Number, Boolean, Array, Object, RegExp, Error, Set, Map, JSON, Date, Math,
            setTimeout, clearTimeout,
        })).not.toThrow();
    });
});

/* ══ التخطيط على الهاتف: الحواف الآمنة وأهداف اللمس ══════════════════════
   القياس بالمتصفّح لا يُثبت هذه القواعد — قيمة env() صفرٌ على الحاسوب.
   لذا يُربط العقد نصًّا: إن حُذفت التغطية من الرأس أو الدرج عاد الخطأ
   إلى الهاتف دون أن يراه أحد. */
describe('تخطيط الهاتف — الحواف الآمنة', () => {
    const MOBILE_CSS = read(path.join(APP, 'css', 'v2', 'erp-mobile-shell.css'));

    test('viewport يمدّ الصفحة تحت النوتش', () => {
        expect(V2_HTML).toMatch(/name="viewport"[^>]*viewport-fit=cover/);
    });

    test('الرأس اللاصق يعوّض أعلى المنطقة غير الآمنة بارتفاعه لا بموضعه', () => {
        const header = /body\.erp-mobile-shell-on \.erp-shell__header \{([^}]*)\}/.exec(MOBILE_CSS);
        expect(header).not.toBeNull();
        expect(header[1]).toMatch(/height:\s*calc\(var\(--erp-header-height\)\s*\+\s*env\(safe-area-inset-top/);
        expect(header[1]).toMatch(/padding-block-start:\s*env\(safe-area-inset-top/);
        // دفع الرأس إلى أسفل يترك شريحة محتوى تتحرّك داخل المنطقة غير الآمنة.
        expect(header[1]).not.toMatch(/inset-block-start:/);
    });

    test('شريط عدم الاتصال والدرج والمحتوى تغطي الحواف الأربع', () => {
        expect(MOBILE_CSS).toMatch(/\.erp-offline-bar \{[^}]*safe-area-inset-top/);
        expect(MOBILE_CSS).toMatch(/\.erp-shell__sidebar \{[^}]*safe-area-inset-top/);
        expect(MOBILE_CSS).toMatch(/\.erp-shell__nav \{[^}]*safe-area-inset-bottom/);
        const content = /#erp-main \{([^}]*)\}/.exec(MOBILE_CSS);
        expect(content).not.toBeNull();
        expect(content[1]).toMatch(/safe-area-inset-left/);
        expect(content[1]).toMatch(/safe-area-inset-right/);
        expect(content[1]).toMatch(/safe-area-inset-bottom/);
    });
});

describe('تخطيط الهاتف — أهداف اللمس', () => {
    const BASE_CSS = read(path.join(APP, 'css', 'v2', 'erp-base.css'));
    const AUTH_CSS = read(path.join(APP, 'css', 'v2', 'erp-auth.css'));
    const MOBILE_CSS = read(path.join(APP, 'css', 'v2', 'erp-mobile-shell.css'));

    test('وصلة تجاوز الهيكل لا تُلمس بأقل من 44px حين تظهر', () => {
        const skip = /\.erp-v2 \.erp-skip-link \{([^}]*)\}/.exec(BASE_CSS);
        expect(skip).not.toBeNull();
        expect(skip[1]).toMatch(/min-block-size:\s*44px/);
    });

    test('مَخرج بوابة الدخول إلى الواجهة القديمة هدفٌ لمسٍ كامل', () => {
        const link = /\.erp-v2 \.erp-login-center a\[href\] \{([^}]*)\}/.exec(AUTH_CSS);
        expect(link).not.toBeNull();
        expect(link[1]).toMatch(/min-block-size:\s*44px/);
    });

    test('أزرار شريط الجوال أربعٌ وأربعون على الأقل', () => {
        const item = /\.erp-mobile-nav \.erp-mnav-item \{([^}]*)\}/.exec(MOBILE_CSS);
        expect(item).not.toBeNull();
        expect(Number(/min-height:\s*(\d+)px/.exec(item[1])[1])).toBeGreaterThanOrEqual(44);
        expect(Number(/min-width:\s*(\d+)px/.exec(item[1])[1])).toBeGreaterThanOrEqual(44);
    });
});

describe('تخطيط الهاتف — iOS وضعَ standalone', () => {
    test('الوسوم الثلاثة موجودة، وإلا بقي التطبيق المثبَّت تبويبًا عاديًا', () => {
        expect(V2_HTML).toMatch(/apple-mobile-web-app-capable" content="yes/);
        expect(V2_HTML).toMatch(/apple-mobile-web-app-status-bar-style" content="default/);
        expect(V2_HTML).toMatch(/apple-mobile-web-app-title" content="Karim V2"/);
    });
});

/* ══ سرعة الهاتف: رحلةٌ واحدة بدل رحلتين ════════════════════════════════
   المقياس على النفق العام: TTFB الوسيط 1.1 ثانية وأقصى 6.2 لملفٍ واحد.
   كل انتظارٍ تتابعي في مسار التحميل = ثانيةٌ يرى فيها الموظف جدولًا فارغًا. */
describe('سرعة الهاتف — لا انتظارٌ متالٍ في مسار التحميل', () => {
    test('الحضور: الأسماء والسجلّات تُطلبان معًا', () => {
        const src = read(path.join(APP, 'js', 'v2', 'screens', 'attendance.js'));
        expect(src).toMatch(/Promise\.all\(\[\s*\n?[^\]]*ensureRefs\(\),\s*\n[^\]]*fetchAttendanceRange/);
        expect(src).not.toMatch(/await ensureRefs\(\);\s*\n\s*const res = await fetchAttendanceRange/);
    });

    test('استعلام المبيعات: الأصناف والفواتير تُطلبان معًا عند اختيار صنف', () => {
        const src = read(path.join(APP, 'js', 'v2', 'screens', 'sales-inquiry.js'));
        expect(src).toMatch(/const jobs = \[loadItems\(\)\];\s*\n\s*if \(state\.selected\) \{jobs\.push\(loadInvoices\(\)\);\}\s*\n\s*await Promise\.all\(jobs\);/);
        expect(src).not.toMatch(/await loadItems\(\);\s*\n\s*if \(state\.selected\) \{ await loadInvoices\(\); \}/);
    });
});
