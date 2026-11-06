/**
 * api-offline.test.js — شبكة الموبايل لا تُضعف الطلب ولا تكرّر الكتابة
 * ═══════════════════════════════════════════════════════════════════════
 * js/core/api.js يُحمَّل في vm (jest بلا حزم)، بنفس أسلوب v2-sessions.test.js.
 *
 * العقد المُثبَّت:
 *   ١) GET مقطوعٌ بشبكةٍ متقطّعة يُعاد مرةً واحدة ثم ينجح.
 *   ٢) الطلب الكاتِب (POST/PATCH/PUT) لا يُعاد إطلاقًا: إعادةُ فاتورةٍ
 *      مقطوعة تعني فاتورتين، والمتصفح لا يعرف ماذا فعل السيرفر فعلًا.
 *   ٣) الجهاز بلا اتصال ⇒ رسالةٌ عربية وسببٌ واضح، لا «انتهت الجلسة».
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const API = path.join(__dirname, '..', 'frontend', 'app', 'js', 'core', 'api.js');

const src = fs.readFileSync(API, 'utf8')
    .split('\n')
    .filter((line) => !/^\s*import\b|^\s*from\s*'[^']*';?\s*$|^\s*export\s*\{/.test(line))
    .join('\n')
    .replace(/^export\s+/gm, '');

function harness({ responses = [], onLine = true } = {}) {
    const calls = [];
    const queue = [...responses];
    const context = {
        console, JSON, String, Number, Boolean, Array, Object, RegExp, Error, Date, Math, Promise, Set, Map,
        setTimeout, clearTimeout, AbortController,
        window: { location: { origin: 'https://erp.test' }, _jwt: 'jwt', _appKey: 'key' },
        navigator: { onLine },
        KARIM_RTget: () => 'rt',
        refreshSession: async () => false,
        doLogout: () => {context.loggedOut = true;},
        toast: () => {},
        fetch: async (url, opts) => {
            calls.push({ url, method: (opts && opts.method) || 'GET', signal: opts && opts.signal });
            const next = queue.length > 1 ? queue.shift() : queue[0];
            if (next instanceof Error) {throw next;}
            return next;
        },
    };
    vm.createContext(context);
    vm.runInContext(src, context, { filename: API });
    return { ctx: context, calls };
}

const json = (body, init = {}) => ({
    ok: init.ok !== false, status: init.status || 200,
    headers: { get: () => null },
    json: async () => body,
    clone: () => ({ json: async () => body, status: init.status || 200 }),
});

describe('شبكة الموبايل — الإعادة الآمنة فقط', () => {
    test('GET ينقطع مرةً واحدة فتنجح الإعادة', async () => {
        const { ctx, calls } = harness({
            responses: [Object.assign(new Error('network down'), {name: 'AbortError'}), json({ rows: [1] })],
        });
        const data = await ctx.apiFetch('/sales?x=1');
        expect(data).toEqual({ rows: [1] });
        expect(calls.length).toBe(2);
        expect(calls[0].method).toBe('GET');
    });

    test('POST لا يُعاد أبدًا: لا فاتورةٌ مكرَّرة على شبكةٍ سيئة', async () => {
        const { ctx, calls } = harness({
            responses: [Object.assign(new Error('network down'), {name: 'AbortError'})],
        });
        await expect(ctx.apiFetch('/bills', { method: 'POST', body: '{}' }))
            .rejects.toThrow(/تعذّر|لا يوجد اتصال/);
        expect(calls.length).toBe(1);
        expect(calls[0].method).toBe('POST');
    });

    test('الجهاز بلا اتصال: سببٌ شبكيّ لا انتهاء جلسة، ولا طرد من الدخول', async () => {
        const { ctx, calls } = harness({
            responses: [TypeError('Failed to fetch')],
            onLine: false,
        });
        let err;
        try {await ctx.apiFetch('/dashboard');} catch (e) {err = e;}
        expect(err.code).toBe('NETWORK_UNAVAILABLE');
        expect(err.message).toMatch(/لا يوجد اتصال/);
        expect(ctx.loggedOut).toBeUndefined();
        expect(calls.length).toBe(1);   // لا إعادة في وجهٍ مغلق
    });

    test('عطلُ الشبكة لا يمرّ بمسار 401: لا مسح لرمز التحديث', async () => {
        const { ctx } = harness({ responses: [TypeError('Failed to fetch')] });
        await expect(ctx.apiFetch('/attendance')).rejects.toThrow(/تعذّر الوصول/);
        expect(ctx.loggedOut).toBeUndefined();
    });

    test('الاستثناء الشبكيّ له اسمٌ في جدول الرسائل العربية', () => {
        expect(src).toMatch(/NETWORK_UNAVAILABLE:\s*'تعذّر الاتصال/);
    });
});
