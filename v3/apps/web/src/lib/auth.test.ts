import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    AuthError,
    applySession,
    changePassword,
    confirmMfa,
    getAppKey,
    getAuthState,
    login,
    loginWithPasskey,
    logout,
    refreshSession,
    resetPassword,
    setupMfa,
    subscribeAuth,
    verifyMfa,
} from './auth';

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    window.localStorage.clear();
    logout();
});

function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

/** نداء fetch رقم `index` بوسائطه — `vi.fn` المجرّدة تفقد نوع الوسائط. */
function callArgs(fetchMock: ReturnType<typeof vi.fn>, index = 0): [string, RequestInit] {
    return fetchMock.mock.calls[index] as unknown as [string, RequestInit];
}

function allCalls(fetchMock: ReturnType<typeof vi.fn>): [string, RequestInit][] {
    return fetchMock.mock.calls as unknown as [string, RequestInit][];
}

const SESSION = {
    access_token: 'test-access-1',
    refresh_token: 'test-refresh-1',
    app_key: 'test-app-key-1',
    user: { id: '7', name: 'قارئ', role: 'accountant', username: 'reader' },
};

describe('مزامنة الجلسة بين التبويبات', () => {
    it('ينشر الدخول والخروج ويحدّث حالة التبويب عند استقبال رسالة موثوقة شكليًا', () => {
        const channels: TestAuthBroadcastChannel[] = [];
        class TestAuthBroadcastChannel extends EventTarget {
            readonly messages: unknown[] = [];

            constructor() {
                super();
                channels.push(this);
            }

            postMessage(message: unknown): void {
                this.messages.push(message);
            }

            close(): void {}
        }
        vi.stubGlobal('BroadcastChannel', TestAuthBroadcastChannel);

        const unsubscribe = subscribeAuth(() => {});
        applySession(SESSION);
        const channel = channels[0];
        if (!channel) {
            throw new Error('قناة المصادقة لم تُنشأ');
        }
        expect(channel.messages).toEqual([
            {
                type: 'session',
                access_token: SESSION.access_token,
                app_key: SESSION.app_key,
                user: SESSION.user,
            },
        ]);

        channel.dispatchEvent(
            new MessageEvent('message', {
                data: {
                    type: 'session',
                    access_token: 'remote-access',
                    app_key: null,
                    user: { id: '8', name: 'مدير', role: 'admin', username: 'admin' },
                },
            }),
        );
        expect(getAuthState()).toMatchObject({
            status: 'authenticated',
            token: 'remote-access',
            user: { id: '8', role: 'admin' },
        });
        expect(getAppKey()).toBeNull();

        channel.dispatchEvent(
            new MessageEvent('message', {
                data: { type: 'session', access_token: '', app_key: null, user: {} },
            }),
        );
        expect(getAuthState().token).toBe('remote-access');

        channel.dispatchEvent(new MessageEvent('message', { data: { type: 'logout' } }));
        expect(getAuthState()).toEqual({ status: 'anonymous', token: null, user: null });
        logout();
        expect(channel.messages.at(-1)).toEqual({ type: 'logout' });
        unsubscribe();
    });

    it('يتجاهل نتيجة تجديد قديمة إذا وصلت جلسة أحدث من تبويب آخر', async () => {
        window.localStorage.setItem('karim_rt_v1', 'old-refresh');
        let resolveRefresh: (response: Response) => void = () => {
            throw new Error('طلب التجديد لم يبدأ');
        };
        const pendingResponse = new Promise<Response>((resolve) => {
            resolveRefresh = resolve;
        });
        vi.stubGlobal(
            'fetch',
            vi.fn(() => pendingResponse),
        );

        const refresh = refreshSession();
        applySession({
            ...SESSION,
            access_token: 'new-access',
            refresh_token: 'new-refresh',
        });
        resolveRefresh(jsonResponse({ error: 'REFRESH_TOKEN_INVALID' }, 401));

        expect(await refresh).toBe(true);
        expect(getAuthState().token).toBe('new-access');
        expect(window.localStorage.getItem('karim_rt_v1')).toBe('new-refresh');
    });
});

describe('مفتاح التطبيق', () => {
    it('يُحفظ في الذاكرة عند الدخول — ولا يُكتب في التخزين الدائم', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => jsonResponse(SESSION)),
        );

        await login('reader', 'synthetic-password');

        expect(getAppKey()).toBe('test-app-key-1');
        expect(JSON.stringify(window.localStorage)).not.toContain('test-app-key-1');
    });

    it('يُحفظ عند تجديد الجلسة من رمز التحديث', async () => {
        window.localStorage.setItem('karim_rt_v1', 'refresh-0');
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => jsonResponse(SESSION)),
        );

        expect(await refreshSession()).toBe(true);
        expect(getAppKey()).toBe('test-app-key-1');
    });

    it('يحافظ على جلسة الوصول الحالية عند انقطاع الشبكة أثناء التجديد', async () => {
        applySession(SESSION);
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => Promise.reject(new Error('offline'))),
        );
        vi.spyOn(console, 'warn').mockImplementation(() => {});

        expect(await refreshSession()).toBe(false);
        expect(getAuthState()).toMatchObject({ status: 'authenticated', token: SESSION.access_token });
        expect(window.localStorage.getItem('karim_rt_v1')).toBe(SESSION.refresh_token);
    });

    it('ينهي الجلسة فقط إذا رفض الخادم رمز التحديث', async () => {
        applySession(SESSION);
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => jsonResponse({ error: 'REFRESH_TOKEN_INVALID' }, 401)),
        );

        expect(await refreshSession()).toBe(false);
        expect(getAuthState().status).toBe('anonymous');
        expect(window.localStorage.getItem('karim_rt_v1')).toBeNull();
    });

    it('يبقى nullًا حين لا يسلّمه السيرفر (بلا مفتاح مطبَّق)', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => jsonResponse({ ...SESSION, app_key: null })),
        );

        await login('reader', 'synthetic-password');

        expect(getAppKey()).toBeNull();
    });

    it('يُمحى عند الخروج', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => jsonResponse(SESSION)),
        );
        await login('reader', 'synthetic-password');

        logout();

        expect(getAppKey()).toBeNull();
    });
});

describe('عقد الجلسة', () => {
    /**
     * `users.id` bigint → pg يُسلسله نصًا، والقديم يُصدره كما هو.
     * كان المخطط يطلب `number` فرفض كل جلسة حقيقية (ظهر في بوابة G5 لا
     * في اختبارات الوحدة التي كانت تُطعمه رقمًا).
     */
    it('يقبل معرّف bigint كنص كما يُصدره القديم', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async () =>
                jsonResponse({
                    ...SESSION,
                    user: { ...SESSION.user, id: '1794001627414356' },
                }),
            ),
        );

        await login('reader', 'synthetic-password');

        expect(getAuthState().user?.id).toBe('1794001627414356');
        expect(getAuthState().status).toBe('authenticated');
    });

    it('يرفض معرّفًا رقميًا — ليس شكل العقد الملتقَط', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => jsonResponse({ ...SESSION, user: { ...SESSION.user, id: 7 } })),
        );

        await expect(login('reader', 'synthetic-password')).rejects.toThrow();
        expect(getAuthState().status).toBe('anonymous');
    });
});

/**
 * العامل الثاني وتدوير كلمة المرور — نفس سلّم القديم
 * (`frontend/app/js/v2/screens/login.js`): كلمة المرور لا تعطي جلسة عندما
 * يكون الحساب محميًا، بل تذكرة قصيرة العمر.
 */
describe('العامل الثاني', () => {
    it('الدخول المحمي يعيد تذكرة MFA مع طرق التحقق المتاحة', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async () =>
                jsonResponse({
                    mfa_required: true,
                    webauthn_available: true,
                    mfa_token: 'ticket-mfa-1',
                    message: 'أكمل التحقق',
                }),
            ),
        );

        const outcome = await login('reader', 'synthetic-password');

        expect(outcome).toEqual({
            kind: 'mfa',
            ticket: 'ticket-mfa-1',
            methods: { totp: true, passkey: true },
            message: 'أكمل التحقق',
        });
        expect(getAuthState().status).toBe('anonymous');
    });

    it('الحساب غير المسجَّل للعامل الثاني يعيد تذكرة تسجيل', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async () =>
                jsonResponse({
                    mfa_enrollment_required: true,
                    mfa_token: 'ticket-enroll-1',
                }),
            ),
        );

        const outcome = await login('admin', 'synthetic-password');

        expect(outcome.kind).toBe('enroll');
        expect(outcome.kind === 'enroll' && outcome.ticket).toBe('ticket-enroll-1');
    });

    it('الدخول بمفتاح مرور فقط يعلن أن TOTP غير متاح', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => jsonResponse({ webauthn_required: true, mfa_token: 'ticket-passkey' })),
        );

        const outcome = await login('reader', 'synthetic-password');

        expect(outcome.kind === 'mfa' && outcome.methods).toEqual({
            totp: false,
            passkey: true,
        });
    });

    it('verifyMfa يرسل التذكرة في Authorization ويثبّت الجلسة', async () => {
        const fetchMock = vi.fn(async () => jsonResponse(SESSION));
        vi.stubGlobal('fetch', fetchMock);

        await verifyMfa('ticket-1', { code: '123456' });

        const [url, init] = callArgs(fetchMock);
        expect(url).toBe('/api/auth/mfa/verify');
        expect((init.headers as Record<string, string>).Authorization).toBe('Bearer ticket-1');
        expect(JSON.parse(String(init.body))).toEqual({ code: '123456' });
        expect(getAuthState().status).toBe('authenticated');
        expect(getAppKey()).toBe('test-app-key-1');
    });

    it('verifyMfa يقبل رمز الاسترداد بدل رمز التطبيق', async () => {
        const fetchMock = vi.fn(async () => jsonResponse(SESSION));
        vi.stubGlobal('fetch', fetchMock);

        await verifyMfa('ticket-1', { recoveryCode: 'RECOVERY-CODE' });

        const [, init] = callArgs(fetchMock);
        expect(JSON.parse(String(init.body))).toEqual({
            recovery_code: 'RECOVERY-CODE',
        });
    });

    it('يفصح عن رمز خطأ الخادم مع رسالته', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => jsonResponse({ error: 'MFA_INVALID_CODE', message: 'الرمز غير صحيح' }, 401)),
        );

        const error = await verifyMfa('ticket-1', { code: '000000' }).catch((cause) => cause);

        expect(error).toBeInstanceOf(AuthError);
        expect(error.code).toBe('MFA_INVALID_CODE');
        expect(error.message).toBe('الرمز غير صحيح');
        expect(getAuthState().status).toBe('anonymous');
    });

    it('تسجيل العامل الثاني يعيد رموز الاسترداد بلا فتح جلسة قبل عرضها', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => jsonResponse({ ...SESSION, recovery_codes: ['A-1', 'B-2'] })),
        );

        const result = await confirmMfa('ticket-enroll-1', '654321');

        expect(result.recoveryCodes).toEqual(['A-1', 'B-2']);
        expect(getAuthState().status).toBe('anonymous');

        applySession(result.session);
        expect(getAuthState().status).toBe('authenticated');
    });

    it('setupMfa يعيد QR والمفتاح اليدوي من رد الخادم', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async () =>
                jsonResponse({
                    ok: true,
                    issuer: 'Karim ERP',
                    account: 'admin',
                    secret: 'JBSWY3DPEHPK3PXP',
                    otpauth_uri: 'otpauth://totp/Karim:admin?secret=JBSWY3DPEHPK3PXP',
                    qr_data_url: 'data:image/png;base64,AAAA',
                }),
            ),
        );

        const setup = await setupMfa('ticket-enroll-1');

        expect(setup.secret).toBe('JBSWY3DPEHPK3PXP');
        expect(setup.qrDataUrl).toBe('data:image/png;base64,AAAA');
    });

    it('تغيير كلمة المرور المقيد قد يعيد بوابة عامل ثانٍ بدل جلسة', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async () =>
                jsonResponse({
                    password_change_required: false,
                    mfa_required: true,
                    mfa_token: 'ticket-after-rotate',
                }),
            ),
        );

        const outcome = await changePassword('ticket-pwd', 'old-password-1', 'new-password-12');

        expect(outcome).toEqual({
            kind: 'mfa',
            ticket: 'ticket-after-rotate',
            methods: { totp: true, passkey: false },
        });
        expect(getAuthState().status).toBe('anonymous');
    });

    it('دخول مفتاح المرور: خيارات ثم توقيع المتصفح ثم تحقق الخادم', async () => {
        const credential = {
            id: 'cred-1',
            rawId: new Uint8Array([1, 2, 3]).buffer,
            type: 'public-key',
            response: {
                clientDataJSON: new Uint8Array([4]).buffer,
                authenticatorData: new Uint8Array([5]).buffer,
                signature: new Uint8Array([6]).buffer,
                userHandle: null,
            },
            getClientExtensionResults: () => ({}),
            authenticatorAttachment: 'platform',
        };
        const get = vi.fn(async () => credential);
        Object.defineProperty(window, 'PublicKeyCredential', {
            value: function PublicKeyCredential() {},
            configurable: true,
        });
        Object.defineProperty(window.navigator, 'credentials', {
            value: { get, create: vi.fn() },
            configurable: true,
        });
        const fetchMock = vi.fn(async (url: string) =>
            String(url).endsWith('/options')
                ? jsonResponse({ options: { challenge: 'AQID', rpId: 'localhost' } })
                : jsonResponse(SESSION),
        );
        vi.stubGlobal('fetch', fetchMock);

        await loginWithPasskey('ticket-passkey');

        expect(get).toHaveBeenCalledTimes(1);
        const [optionsCall, verifyCall] = allCalls(fetchMock);
        expect(optionsCall?.[0]).toBe('/api/auth/webauthn/login/options');
        expect(verifyCall?.[0]).toBe('/api/auth/webauthn/login/verify');
        const body = JSON.parse(String(verifyCall?.[1].body ?? '')) as {
            response: { rawId: string; response: { signature: string } };
        };
        expect(body.response.rawId).toBe('AQID');
        expect(body.response.response.signature).toBe('Bg');
        expect(getAuthState().status).toBe('authenticated');

        delete (window as { PublicKeyCredential?: unknown }).PublicKeyCredential;
        Object.defineProperty(window.navigator, 'credentials', {
            value: undefined,
            configurable: true,
        });
    });

    it('استعادة كلمة المرور ترسل الرمز وكلمة المرور الجديدة', async () => {
        const fetchMock = vi.fn(async () => jsonResponse({ ok: true }));
        vi.stubGlobal('fetch', fetchMock);

        await resetPassword('reader', 'RESET-1', 'new-password-12');

        const [url, init] = callArgs(fetchMock);
        expect(url).toBe('/api/auth/forgot-password/reset');
        expect(JSON.parse(String(init.body))).toEqual({
            username: 'reader',
            code: 'RESET-1',
            new_password: 'new-password-12',
        });
    });

    it('الخروج يبطل الجلسة على الخادم ثم يفرّغ الحالة محليًا', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => jsonResponse(SESSION)),
        );
        await login('reader', 'synthetic-password');
        const fetchMock = vi.fn(async () => jsonResponse({ ok: true }));
        vi.stubGlobal('fetch', fetchMock);

        logout();

        expect(getAuthState().status).toBe('anonymous');
        const [url, init] = callArgs(fetchMock);
        expect(url).toBe('/api/auth/logout');
        expect((init.headers as Record<string, string>).Authorization).toBe('Bearer test-access-1');
    });
});
