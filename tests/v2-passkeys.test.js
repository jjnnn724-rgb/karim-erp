/**
 * v2-passkeys.test.js — مفاتيح المرور في الواجهة (بلا متصفح)
 * ═══════════════════════════════════════════════════════════════════════
 * الملفات ESM للمتصفح؛ نقرأ المصدر وننزع import/export ونشغّله في vm —
 * نفس أسلوب v2-sessions.test.js.
 *
 * ما يُثبَّت:
 *   1) التحويل بين base64url وArrayBuffer دقيق (التحدي والمعرّفات بايتات،
 *      لا نصوص)، والشكل المُعاد للخادم هو RegistrationResponseJSON /
 *      AuthenticationResponseJSON.
 *   2) خطأ المتصفح يُترجم إلى جملة عربية قابلة للتنفيذ (إلغاء، HTTPS، دعم).
 *   3) مستودع المفاتيح: كلمة المرور تُرسل مرة واحدة، وفشلها 401 لا يمسّ
 *      الجلسة (fetch خام لا apiFetch)، والمسارات مطابقة للخادم.
 *   4) شاشة الدخول تتعامل مع webauthn_required وتستخدم navigator.credentials.get،
 *      وشاشة الجلسات تعرض التسجيل والحذف بكلمة مرور — بلا معالجات inline.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const V2 = path.join(__dirname, '..', 'frontend', 'app', 'js', 'v2');
const CLIENT = path.join(V2, 'data', 'webauthn-client.js');
const REPO = path.join(V2, 'data', 'passkeys-repo.js');
const LOGIN = path.join(V2, 'screens', 'login.js');
const SCREEN = path.join(V2, 'screens', 'sessions.js');

function loadEsm(file, injections = {}) {
    const src = fs.readFileSync(file, 'utf8')
        // import { … } from '…' — أحادي أو متعدد الأسطر
        .replace(/^import\s*\{[\s\S]*?\}\s*from\s*'[^']*';?[ \t]*$/gm, '')
        .replace(/^import\b[^\n]*$/gm, '')
        .replace(/^export\s+/gm, '');
    const context = {
        console, JSON, String, Number, Boolean, Array, Object, RegExp, Error, Date, Math, Promise,
        encodeURIComponent, decodeURIComponent, Uint8Array, AbortController,
        setTimeout, clearTimeout,
        atob: (s) => Buffer.from(s, 'base64').toString('binary'),
        btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
        ...injections,
    };
    vm.createContext(context);
    vm.runInContext(src, context, { filename: file });
    return context;
}

function bytesOf(value) {
    return Array.from(value instanceof Uint8Array ? value : new Uint8Array(value));
}

function jsonResponse(status, body) {
    return { ok: status >= 200 && status < 300, status, json: async () => body };
}

describe('webauthn-client — تحويلات المتصفح', () => {
    const ctx = loadEsm(CLIENT);

    test('base64url ⇄ بايتات بلا فقدان (بما فيها - و _)', () => {
        expect(bytesOf(ctx.b64urlToBytes('AQID'))).toEqual([1, 2, 3]);
        expect(ctx.bytesToB64url(new Uint8Array([1, 2, 3]))).toBe('AQID');
        const raw = new Uint8Array([251, 255]);
        expect(ctx.bytesToB64url(raw)).toBe('-_8');
        expect(bytesOf(ctx.b64urlToBytes('-_8'))).toEqual([251, 255]);
    });

    test('خيارات الإنشاء: التحدي ومعرّف المستخدم والمستثنى تصبح بايتات', () => {
        const options = ctx.toCreationOptions({
            rp: { id: 'karimeg.online', name: 'Karim ERP' },
            user: { id: 'AQID', name: 'admin', displayName: 'المدير' },
            challenge: 'AQID',
            pubKeyCredParams: [{ alg: -7, type: 'public-key' }],
            timeout: 60000,
            authenticatorSelection: { residentKey: 'preferred', userVerification: 'required' },
            excludeCredentials: [{ id: 'BAUG', type: 'public-key', transports: ['internal'] }],
        });
        expect(bytesOf(options.user.id)).toEqual([1, 2, 3]);
        expect(bytesOf(options.challenge)).toEqual([1, 2, 3]);
        expect(bytesOf(options.excludeCredentials[0].id)).toEqual([4, 5, 6]);
        expect(options.excludeCredentials[0].transports).toEqual(['internal']);
        expect(options.rp.id).toBe('karimeg.online');
        expect(options.authenticatorSelection.userVerification).toBe('required');
    });

    test('خيارات المصادقة: allowCredentials بايتات وuserVerification إجباري', () => {
        const options = ctx.toRequestOptions({
            challenge: 'AQID',
            rpId: 'karimeg.online',
            allowCredentials: [{ id: 'BAUG', type: 'public-key', transports: ['hybrid'] }],
        });
        expect(bytesOf(options.challenge)).toEqual([1, 2, 3]);
        expect(bytesOf(options.allowCredentials[0].id)).toEqual([4, 5, 6]);
        expect(options.userVerification).toBe('required');
        expect(options.rpId).toBe('karimeg.online');
    });

    test('تسجيل: الشكل الناتج هو RegistrationResponseJSON (base64url)', () => {
        const credential = {
            id: 'cred-1',
            rawId: new Uint8Array([1, 2, 3]).buffer,
            type: 'public-key',
            authenticatorAttachment: 'platform',
            response: {
                clientDataJSON: new Uint8Array([7, 8]).buffer,
                attestationObject: new Uint8Array([9, 10]).buffer,
                getTransports: () => ['internal', 'hybrid'],
            },
            getClientExtensionResults: () => ({ credProps: { rk: true } }),
        };
        const out = ctx.serializeRegistration(credential);
        expect(out).toMatchObject({
            id: 'cred-1', rawId: 'AQID', type: 'public-key', authenticatorAttachment: 'platform',
        });
        expect(out.response.clientDataJSON).toBe('Bwg');
        expect(out.response.attestationObject).toBe('CQo');
        expect(out.response.transports).toEqual(['internal', 'hybrid']);
        expect(out.clientExtensionResults).toEqual({ credProps: { rk: true } });
    });

    test('مصادقة: userHandle غائب يبقى null لا سلسلة فارغة', () => {
        const credential = {
            id: 'cred-1',
            rawId: new Uint8Array([1]).buffer,
            type: 'public-key',
            response: {
                clientDataJSON: new Uint8Array([2]).buffer,
                authenticatorData: new Uint8Array([3]).buffer,
                signature: new Uint8Array([4]).buffer,
                userHandle: null,
            },
            getClientExtensionResults: () => ({}),
        };
        const out = ctx.serializeAssertion(credential);
        expect(out.response).toEqual({
            clientDataJSON: 'Ag',
            authenticatorData: 'Aw',
            signature: 'BA',
            userHandle: null,
        });
    });

    test('أخطاء المتصفح تُترجم إلى جمل عربية قابلة للتنفيذ', () => {
        expect(ctx.describeWebAuthnError({ name: 'InvalidStateError' })).toContain('مسجّل بالفعل');
        expect(ctx.describeWebAuthnError({ name: 'NotAllowedError' })).toContain('أعد المحاولة');
        expect(ctx.describeWebAuthnError({ name: 'SecurityError' })).toContain('HTTPS');
        expect(ctx.describeWebAuthnError({ name: 'NotSupportedError' })).toContain('لا يدعم');
        expect(ctx.describeWebAuthnError({ name: 'OtherError', message: 'رسالة الخادم' })).toBe('رسالة الخادم');
    });

    test('بيئة غير آمنة أو متصفح قديم: سبب واضح بدل زرّ يفشل', () => {
        expect(ctx.passkeyUnavailableReason({ isSecureContext: false, navigator: {} })).toContain('HTTPS');
        expect(ctx.passkeyUnavailableReason({ isSecureContext: true, navigator: {} })).toContain('لا يدعم');
        expect(ctx.isWebAuthnSupported({ isSecureContext: false })).toBe(false);
    });
});

describe('passkeys-repo — العقد كما هو على الخادم', () => {
    function harness(responder) {
        const calls = [];
        const created = jest.fn(async () => ({ id: 'cred-1', marker: 'registration' }));
        const fetch = jest.fn(async (url, init) => {
            calls.push({ url, init });
            return responder(url, init);
        });
        const apiFetch = jest.fn(async () => ({ ok: true }));
        const ctx = loadEsm(REPO, {
            API_BASE: 'https://erp.test/api',
            apiFetch,
            SERVER_CODE_AR: { INVALID_CREDENTIALS: 'بيانات غير صحيحة' },
            isWebAuthnSupported: () => true,
            passkeyUnavailableReason: () => null,
            platformAuthenticatorAvailable: async () => true,
            toCreationOptions: (options) => ({ decodedChallenge: options.challenge }),
            serializeRegistration: (credential) => ({ id: credential.id, marker: credential.marker }),
            describeWebAuthnError: (err) => `AR:${err && err.name}`,
            window: { _jwt: 'jwt-1', _appKey: 'key-1' },
            navigator: { credentials: { create: created } },
            fetch,
        });
        return { ctx, calls, fetch, created, apiFetch };
    }

    test('التسجيل: كلمة المرور في الأول، ثم توقيع الجهاز، ثم الخادم', async () => {
        const { ctx, calls, created } = harness((url) => (
            url.endsWith('/register/options')
                ? jsonResponse(200, { ok: true, options: { challenge: 'ch-1' }, device_label: 'هاتف المدير' })
                : jsonResponse(200, { ok: true, message: 'تم تسجيل الجهاز' })
        ));
        const result = await ctx.registerPasskey({ password: 'Pw-123456789', deviceLabel: 'هاتف المدير' });
        expect(result.message).toBe('تم تسجيل الجهاز');

        expect(calls.map((c) => new URL(c.url).pathname)).toEqual([
            '/api/auth/webauthn/register/options',
            '/api/auth/webauthn/register/verify',
        ]);
        expect(JSON.parse(calls[0].init.body)).toEqual({ password: 'Pw-123456789', device_label: 'هاتف المدير' });
        expect(calls[0].init.headers.Authorization).toBe('Bearer jwt-1');
        expect(created).toHaveBeenCalledWith({ publicKey: { decodedChallenge: 'ch-1' } });
        expect(JSON.parse(calls[1].init.body)).toEqual({
            response: { id: 'cred-1', marker: 'registration' },
            device_label: 'هاتف المدير',
        });
    });

    test('كلمة مرور خاطئة: 401 يصل نصًّا ولا يستدعي مسار الخروج (لا apiFetch)', async () => {
        const { ctx, apiFetch, created } = harness(() => (
            jsonResponse(401, { error: 'INVALID_CREDENTIALS', message: 'كلمة المرور غير صحيحة.' })
        ));
        await expect(ctx.registerPasskey({ password: 'wrong', deviceLabel: 'x' }))
            .rejects.toThrow('كلمة المرور غير صحيحة.');
        expect(created).not.toHaveBeenCalled();
        expect(apiFetch).not.toHaveBeenCalled();
    });

    test('الحذف: المسار مُرمّز وكلمة المرور في الجسم', async () => {
        const { ctx, calls } = harness(() => jsonResponse(200, { ok: true, message: 'تم حذف الجهاز.' }));
        await ctx.removePasskey('a/b', 'Pw-123456789');
        expect(new URL(calls[0].url).pathname).toBe('/api/auth/webauthn/credentials/a%2Fb/remove');
        expect(JSON.parse(calls[0].init.body)).toEqual({ password: 'Pw-123456789' });
    });

    test('القائمة: صفوف الخادم تُطبَّع، والمعرّف غير الصالح يُسقط لا يُعرض', async () => {
        const apiFetch = jest.fn(async () => ({
            enabled: true,
            count: 2,
            max: 5,
            credentials: [
                { id: 3, label: 'هاتف', backed_up: true, created_at: '2026-10-24T09:00:00Z', last_used_at: null },
                { id: 0, label: 'تالف' },
            ],
        }));
        const ctx = loadEsm(REPO, { apiFetch, window: {}, navigator: {} });
        const result = await ctx.fetchPasskeys();
        expect(result.credentials).toHaveLength(1);
        expect(result.credentials[0]).toMatchObject({ id: 3, label: 'هاتف', backed_up: true });
        expect(apiFetch).toHaveBeenCalledWith('/auth/webauthn/status', { method: 'GET' });
    });
});

describe('شاشة الدخول — مسار مفتاح المرور', () => {
    const src = fs.readFileSync(LOGIN, 'utf8');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');

    test('تستقبل webauthn_required وتستخدم تحدي المصادقة ثم التحقق', () => {
        expect(code).toContain('data.webauthn_required');
        expect(code).toContain('data.webauthn_available');
        expect(code).toMatch(/mfaPost\('\/auth\/webauthn\/login\/options'/);
        expect(code).toMatch(/mfaPost\(\s*'\/auth\/webauthn\/login\/verify'/);
        expect(code).toContain('navigator.credentials.get');
        expect(code).toContain('toRequestOptions');
        expect(code).toContain('serializeAssertion');
    });

    test('بلا WebAuthn يبقى رمز التطبيق هو المخرج لا شاشة ميتة', () => {
        expect(code).toContain('isWebAuthnSupported()');
        expect(code).toMatch(/totpBlock\.hidden = !totp/);
    });

    test('لا معالجات inline وكل استيراد يحمل نسخة الصفحة', () => {
        expect(code).not.toMatch(/\son(click|change|submit|input|load)=/i);
        const specifiers = [...src.matchAll(/from '([^']+)'/g)].map((m) => m[1]);
        for (const spec of specifiers) {expect(spec).toMatch(/\?v=\d+\.\d+\.\d+$/);}
    });
});

describe('شاشة الجلسات — إدارة المفاتيح', () => {
    const src = fs.readFileSync(SCREEN, 'utf8');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');

    test('تسجيل وحذف بكلمة مرور — لا تمرير عبر نافذة أو تخزين', () => {
        expect(code).toContain('registerPasskey');
        expect(code).toContain('removePasskey');
        expect(code).toContain('data-v2-passkey-remove');
        expect(code).not.toMatch(/prompt\(/);
        expect(code).not.toMatch(/localStorage|sessionStorage/);
    });

    test('لا معالجات inline وكل استيراد يحمل نسخة الصفحة', () => {
        expect(code).not.toMatch(/\son(click|change|submit|input|load)=/i);
        const specifiers = [...src.matchAll(/from '([^']+)'/g)].map((m) => m[1]);
        for (const spec of specifiers) {expect(spec).toMatch(/\?v=\d+\.\d+\.\d+$/);}
    });
});
