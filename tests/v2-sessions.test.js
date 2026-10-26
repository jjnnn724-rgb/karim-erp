/**
 * v2-sessions.test.js — البند ١٠ في الواجهة (بلا متصفح)
 * ═══════════════════════════════════════════════════════════════════════
 * الملفات هنا ESM للمتصفح، وjest يعمل بلا حزم: نقرأ المصدر وننزع
 * import/export ونشغّله في vm مع بدائل الشبكة/التخزين — نفس أسلوب
 * v2-branches.test.js.
 *
 * ما يُثبَّت:
 *   1) التجديد الصامت لا يُطلق طلبين متوازيين: رمز التحديث يدور مرة واحدة،
 *      والثاني كان سيقدّم رمزًا مُدوَّرًا فيُحسب إعادة استعمال.
 *   2) المؤقّت الاستباقي يُجدول عند الإصدار، ويتوقف في تبويب مخفي،
 *      ولا يُلمس شيء وقت الاستيراد (vm بلا DOM/مؤقّتات).
 *   3) شاشة الجلسات: مساراتها الحقيقية فقط، بلا معالجات inline، وتأكيد قبل
 *      أي إبطال، و`?v=` على كل استيراد.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { TextDecoder } = require('util');

const V2 = path.join(__dirname, '..', 'frontend', 'app', 'js', 'v2');
const SESSION = path.join(V2, 'session.js');
const SCREEN = path.join(V2, 'screens', 'sessions.js');
const REPO = path.join(V2, 'data', 'sessions-repo.js');
const ROUTING = path.join(V2, 'routing.js');

function loadEsm(file, injections = {}) {
    const src = fs.readFileSync(file, 'utf8')
        .split('\n')
        .filter((line) => !/^\s*import\b|^\s*from\s*'[^']*';?\s*$/.test(line))
        .join('\n')
        .replace(/^export\s+/gm, '');
    const context = {
        console, JSON, String, Number, Boolean, Array, Object, RegExp, Error, Date, Math, Promise,
        encodeURIComponent, decodeURIComponent, TextDecoder, Uint8Array,
        atob: (s) => Buffer.from(s, 'base64').toString('binary'),
        ...injections,
    };
    vm.createContext(context);
    vm.runInContext(src, context, { filename: file });
    return context;
}

function token(expSecondsFromNow, extra = {}) {
    const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
    return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({
        sub: '1', role: 'manager', exp: Math.floor(Date.now() / 1000) + expSecondsFromNow, ...extra,
    })}.sig`;
}

function storage(initial = {}) {
    const store = { ...initial };
    let writes = 0;
    return {
        getItem: (k) => (k in store ? store[k] : null),
        setItem: (k, v) => {writes += 1; store[k] = String(v);},
        removeItem: (k) => {delete store[k];},
        dump: () => ({ ...store }),
        get writes() { return writes; },
    };
}

function sessionHarness({ refreshTokens = {}, response = null, documentRef, timers = null } = {}) {
    const localStorage = storage(refreshTokens);
    const window = { location: { origin: 'https://erp.test' } };
    const fetch = jest.fn(async () => {
        if (!response) {return { ok: false, json: async () => ({}) };}
        return { ok: true, json: async () => response };
    });
    const injections = { window, localStorage, fetch };
    if (documentRef) {injections.document = documentRef;}
    if (timers) {
        let seq = 0;
        injections.setTimeout = (fn, ms) => {timers.push({ fn, ms, id: ++seq }); return seq;};
        injections.clearTimeout = () => {timers.cleared = (timers.cleared || 0) + 1;};
    }
    return { ctx: loadEsm(SESSION, injections), window, localStorage, fetch };
}

describe('التجديد الصامت — طلب واحد للموجة الواحدة', () => {
    test('نداءان متوازيان = دوران واحد، ونفس النتيجة للاثنين', async () => {
        const payload = {
            access_token: token(900), refresh_token: 'rotated-1', app_key: 'key-1',
            user: { id: 1, role: 'manager', name: 'Probe' },
        };
        let release;
        const { ctx, fetch, localStorage, window } = sessionHarness({ refreshTokens: { karim_rt_v1: 'rt-0' } });
        fetch.mockImplementation(() => new Promise((resolve) => {
            release = () => resolve({ ok: true, json: async () => payload });
        }));

        const p1 = ctx.silentRefresh();
        const p2 = ctx.silentRefresh();
        expect(fetch).toHaveBeenCalledTimes(1);

        release();
        const [a, b] = await Promise.all([p1, p2]);
        expect(a).toBe(b);
        expect(a).toMatchObject({ source: 'refresh', role: 'manager' });
        expect(localStorage.dump().karim_rt_v1).toBe('rotated-1');
        expect(window._jwt).toBe(payload.access_token);
        expect(window._appKey).toBe('key-1');

        // بعد انتهاء الموجة يُسمح بموجة تالية — التعطيل دائم لا مؤقّت.
        fetch.mockImplementation(async () => ({ ok: true, json: async () => payload }));
        await ctx.silentRefresh();
        expect(fetch).toHaveBeenCalledTimes(2);
    });

    test('طلب فاشل لا يترك قفلًا عالقًا', async () => {
        const { ctx, fetch } = sessionHarness({ refreshTokens: { karim_rt_v1: 'rt-0' } });
        expect(await ctx.silentRefresh()).toBeNull();
        fetch.mockImplementation(async () => ({ ok: true, json: async () => ({ access_token: token(900), app_key: 'k' }) }));
        expect(await ctx.silentRefresh()).toMatchObject({ source: 'refresh' });
    });
});

describe('المؤقّت الاستباقي — بلا DOM لا شيء يحدث', () => {
    test('الاستيراد والوصل آمنان في vm بلا document أو setTimeout', () => {
        const { ctx, window } = sessionHarness();
        expect(() => ctx.installApiFetchBridge()).not.toThrow();
        for (const name of ['KARIM_RTget', 'refreshSession', 'toast', 'doLogout']) {
            expect(typeof window[name]).toBe('function');
        }
    });

    test('يُجدول تجديدًا قبل الانتهاء بهامش المحافظة على التبويب', async () => {
        const documentRef = { hidden: false, addEventListener: jest.fn() };
        const timers = [];
        const { ctx } = sessionHarness({
            refreshTokens: { karim_rt_v1: 'rt-0' },
            response: { access_token: token(900), refresh_token: 'rt-1', app_key: 'k' },
            documentRef, timers,
        });
        ctx.installApiFetchBridge();
        ctx.installApiFetchBridge();
        expect(documentRef.addEventListener).toHaveBeenCalledTimes(1); // مستمع واحد لا اثنان

        await ctx.silentRefresh();
        expect(timers).toHaveLength(1);
        expect(timers[0].ms).toBeGreaterThanOrEqual(15_000);
        expect(timers[0].ms).toBeLessThanOrEqual(900_000 - 120_000);
    });

    test('الخروج يُلغي المؤقّت — لا تجديد يوقظ جلسة أنهىها المستخدم', async () => {
        const documentRef = { hidden: false, addEventListener: jest.fn() };
        const timers = [];
        const { ctx, window } = sessionHarness({
            refreshTokens: { karim_rt_v1: 'rt-0' },
            response: { access_token: token(900), refresh_token: 'rt-1', app_key: 'k' },
            documentRef, timers,
        });
        ctx.installApiFetchBridge();
        await ctx.silentRefresh();
        expect(timers).toHaveLength(1);

        window.doLogout();
        expect(timers.cleared).toBe(1);
        expect(window._jwt).toBeNull();
    });

    test('ردٌّ متأخر بعد الخروج لا يُحيي الجلسة في الذاكرة ولا في التخزين', async () => {
        const payload = { access_token: token(900), refresh_token: 'rotated-x', app_key: 'k' };
        const { ctx, fetch, localStorage, window } = sessionHarness({ refreshTokens: { karim_rt_v1: 'rt-0' } });
        let release;
        fetch.mockImplementation(() => new Promise((resolve) => {
            release = () => resolve({ ok: true, json: async () => payload });
        }));

        const pending = ctx.silentRefresh();
        ctx.stopKeepAlive();
        release();

        expect(await pending).toBeNull();
        expect(window._jwt).toBeUndefined();
        expect(localStorage.dump().karim_rt_v1).toBe('rt-0');
    });

    test('تبويب مخفي: لا مؤقّت (المتصفح يخنق المؤقّتات ويضلّل التوقيت)', async () => {
        const documentRef = { hidden: true, addEventListener: jest.fn() };
        const timers = [];
        const { ctx } = sessionHarness({
            refreshTokens: { karim_rt_v1: 'rt-0' },
            response: { access_token: token(900), refresh_token: 'rt-1', app_key: 'k' },
            documentRef, timers,
        });
        await ctx.silentRefresh();
        expect(timers).toHaveLength(0);
    });
});

describe('مستودع الجلسات — العقد كما هو على الخادم', () => {
    test('العرض والإبطال على المسارات الثلاثة فقط، بلا معرّف مستخدم', async () => {
        const calls = [];
        const apiFetch = jest.fn(async (p, options = {}) => {
            calls.push({ p, options });
            if (p === '/auth/sessions') {
                return { ok: true, current_session_id: 's-1', sessions: [{ id: 's-1', current: true, device: 'Chrome على Windows' }] };
            }
            return { ok: true, revoked: 1, current: false, message: 'أُبطل الجهاز المحدد.' };
        });
        const ctx = loadEsm(REPO, { apiFetch });

        const listed = await ctx.fetchSessions();
        expect(listed.currentSessionId).toBe('s-1');
        expect(listed.sessions[0]).toMatchObject({ id: 's-1', current: true });

        await ctx.revokeSession('s-2');
        await ctx.revokeOtherSessions();

        expect(calls.map((c) => `${c.options.method} ${c.p}`)).toEqual([
            'GET /auth/sessions',
            'DELETE /auth/sessions/s-2',
            'POST /auth/sessions/revoke-others',
        ]);
        for (const c of calls) {
            expect(JSON.stringify(c.options.body || '')).not.toMatch(/user_?id/i);
        }
    });

    test('formatMoment: لا وقت = شرطة صريحة لا ساعة وهمية', () => {
        const ctx = loadEsm(REPO, { apiFetch: async () => ({}) });
        expect(ctx.formatMoment(null)).toBe('—');
        expect(ctx.formatMoment('غير تاريخ')).toBe('—');
        expect(ctx.formatMoment('2026-10-24T09:05:00.000Z')).toMatch(/^2026-10-24 \d{2}:\d{2}$/);
    });
});

describe('شاشة الجلسات — عقد المصدر', () => {
    const src = fs.readFileSync(SCREEN, 'utf8');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');

    test('لا معالجات inline — CSP يمنعها، والمستمعون مفوَّضون', () => {
        expect(code).not.toMatch(/\son(click|change|submit|input|load)=/i);
        expect(code).toMatch(/addEventListener\('click'/);
    });

    test('كل إبطال يمر بالتأكيد، وإبطال الجهاز الحالي يُعلِم المضيف', () => {
        expect(code).toMatch(/if \(!confirmFn\(question\)\) \{return;\}/);
        expect(code).toMatch(/if \(!confirmFn\(`إبطال \$\{otherCount\} جلسة أخرى/);
        expect(code).toMatch(/ctx\.onCurrentRevoked/);
        // لا تنقّل من داخل الشاشة: القرار للمضيف، لأن الإبطال الحالي يعني خروجًا.
        expect(code).not.toMatch(/location\.|shell\.navigate/);
    });

    test('زر «إبطال الأخرى» معطَّل عندما لا توجد جلسة أخرى', () => {
        expect(code).toMatch(/rows\.length < 2/);
        expect(code).toMatch(/othersBtn\.disabled = saving \|\| loading/);
    });

    test('كل استيراد يحمل نسخة الصفحة — الممر يخزّن JS أربع ساعات', () => {
        const specifiers = [...src.matchAll(/from '([^']+)'/g)].map((m) => m[1]);
        expect(specifiers.length).toBeGreaterThan(0);
        for (const spec of specifiers) {expect(spec).toMatch(/\?v=\d+\.\d+\.\d+$/);}
    });

    test('الجلسات مسار فرعي مسجَّل — والتوجيه يثبت وجود مسار له', () => {
        const routingSrc = fs.readFileSync(ROUTING, 'utf8');
        expect(routingSrc).toMatch(/'sessions',/);
    });
});

/* ── انتهاء الجلسة أثناء العمل ────────────────────────────────────────
   apiFetch على 401 قاطع: يمحو الاعتماد ثم يندي doLogout(). قبل هذا
   الوصل كانت V2 تبقى «داخلة» وكل طلب يفشل، والتوست مطفأ افتراضيًا —
   أي المستخدم يرى شاشةً صامتة بلا طريق للدخول. */
describe('إشعار الخروج — الجلسة تسقط والواجهة تعرف', () => {
    test('المراقب يُندى بعد التنظيف: لا رمز في الذاكرة ولا رمز تحديث', () => {
        const { ctx, window, localStorage } = sessionHarness({ refreshTokens: { karim_rt_v1: 'rt-0' } });
        ctx.installApiFetchBridge();
        const seen = [];
        ctx.setLogoutObserver(() => {
            seen.push({jwt: window._jwt, rt: localStorage.dump().karim_rt_v1});
        });
        window._jwt = 'jwt-1';
        window._appKey = 'k-1';

        window.doLogout();

        expect(seen).toHaveLength(1);
        expect(seen[0]).toEqual({jwt: null, rt: undefined});
    });

    test('مراقب يرمي لا يمنع التنظيف ولا يسقط doLogout', () => {
        const { ctx, window } = sessionHarness({ refreshTokens: { karim_rt_v1: 'rt-0' } });
        ctx.installApiFetchBridge();
        ctx.setLogoutObserver(() => {throw new Error('واجهة مكسورة');});
        window._jwt = 'jwt-1';
        window._appKey = 'k-1';

        expect(() => window.doLogout()).not.toThrow();
        expect(window._jwt).toBeNull();
        expect(window._appKey).toBeNull();
    });

    test('مراقب واحد فقط، وnull يزيله', () => {
        const { ctx, window } = sessionHarness();
        ctx.installApiFetchBridge();
        const first = jest.fn();
        const second = jest.fn();
        ctx.setLogoutObserver(first);
        ctx.setLogoutObserver(second);
        window.doLogout();
        expect(first).not.toHaveBeenCalled();
        expect(second).toHaveBeenCalledTimes(1);

        ctx.setLogoutObserver(null);
        expect(() => window.doLogout()).not.toThrow();
        expect(second).toHaveBeenCalledTimes(1);
    });

    test('401 من التجديد يمحو رمزًا ميتًا — لا زر «استئناف» يفشل دائمًا', async () => {
        const { ctx, fetch, localStorage } = sessionHarness({ refreshTokens: { karim_rt_v1: 'rt-dead' } });
        fetch.mockImplementation(async () => ({
            ok: false, status: 401, json: async () => ({error: 'REFRESH_TOKEN_INVALID'}),
        }));

        expect(await ctx.silentRefresh()).toBeNull();
        expect(localStorage.dump().karim_rt_v1).toBeUndefined();
    });

    test('عطل عابر (503) يُبقي الرمز — قد يصلح بعد قليل', async () => {
        const { ctx, fetch, localStorage } = sessionHarness({ refreshTokens: { karim_rt_v1: 'rt-ok' } });
        fetch.mockImplementation(async () => ({
            ok: false, status: 503, json: async () => ({error: 'UNAVAILABLE'}),
        }));

        expect(await ctx.silentRefresh()).toBeNull();
        expect(localStorage.dump().karim_rt_v1).toBe('rt-ok');
    });
});

describe('وصل الانتهاء في المضيف — عقد المصدر', () => {
    const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
    const preview = strip(fs.readFileSync(path.join(V2, 'preview.js'), 'utf8'));
    const login = strip(fs.readFileSync(path.join(V2, 'screens', 'login.js'), 'utf8'));

    test('preview يسجّل المراقب مرة واحدة، ويحفظ الشاشة وجهةَ عودة', () => {
        expect(preview.match(/setLogoutObserver\(/g)).toHaveLength(1);
        expect(preview).toMatch(/const SESSION_ENDED_NOTICE = '[^']+';/);
        expect(preview).toMatch(/setLogoutObserver\(\(\) => \{[\s\S]{0,240}?navigateLogin\(navStatus\.current, SESSION_ENDED_NOTICE\)/);
    });

    test('البوابة المعروضة لا تُعاد بناؤها — ما يكتبه المستخدم لا يُمحى', () => {
        expect(preview).toMatch(/navStatus\.current === 'login' && shell\.root\.classList\.contains\('is-auth'\)/);
        expect(preview).toMatch(/box\.textContent = loginNotice/);
    });

    test('السبب يمر من المضيف إلى الشاشة ويُعرض في صندوق alert القائم', () => {
        expect(preview).toMatch(/loginNotice = notice \|\| ''/);
        expect(preview).toMatch(/notice: loginNotice/);
        expect(preview).toMatch(/loginNotice = '';/);
        expect(login).toMatch(/if \(ctx\.notice\) \{fail\(String\(ctx\.notice\)\);\}/);
        // الصندوق نفسه هو صندوق خطأ النموذج: لا بانر ثانٍ فوق التصميم.
        expect(login).toMatch(/<div class="erp-error" data-v2-login-error role="alert"><\/div>/);
    });
});
