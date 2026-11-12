import { NUMERIC_ID_PATTERN } from '@karim/shared';
import { useSyncExternalStore } from 'react';
import { z } from 'zod';
import { type AssertionJSON, describeWebAuthnError, isWebAuthnSupported, serializeAssertion, toRequestOptions } from './webauthn';

/**
 * الجلسة — توكن الوصول مع رمز التحديث، بنفس اسمٍ ومفتاحٍ في القديم.
 *
 * العقد:
 *  · رمز التحديث في `localStorage['karim_rt_v1']` — **نفس مفتاح القديم**
 *    (`frontend/app/js/v2/session.js`)، فالجلسة واحدة بين الواجهتين على
 *    الأصل نفسه.
 *  · توكن الوصول في الذاكرة فقط: لا يُكتب في التخزين الدائم — توكنٌ في
 *    `localStorage` يقرأه أي سكربتٍ محمَّل.
 *  · عند الإقلاع: إن وُجد رمز تحديث، نُجدّده ونحصل على توكن وصول؛ وإلّا
 *    فشاشة الدخول.
 *
 * `karim_access_v1` في `localStorage` قناة **تمهيد** تُقرأ عند الإقلاع: تحرّك
 * بوابة G5 توكنًا حقيقيًا إلى المتصفح بلا خطوة تسجيل دخول. لا يُلغى التحقّق
 * عندها — كل توكنٍ يمرّ على تحقّق التوقيع في الخادم.
 *
 * مفتاح التطبيق (`app_key`) في **الذاكرة فقط** — مثل `window._appKey` في
 * القديم (`frontend/app/js/core/api.js`): السيرفر يسلّمه مع كل جلسة، وكل
 * طلب `/api/*` يحمله في ترويسة `x-api-key`، فدونه يرفض `apiKeyMiddleware`
 * الطلب بـ401 قبل أن تصل إلى طبقة المصادقة.
 */

const RT_KEY = 'karim_rt_v1';
const ACCESS_KEY = 'karim_access_v1';

const sessionUserSchema = z.object({
    // `users.id` من نوع bigint؛ pg يُسلسله نصًا والقديم يُصدره كما هو
    // (`publicUserOf`) — رقمٌ هنا = رفض كل جلسة (ADR-06).
    id: z.string().regex(NUMERIC_ID_PATTERN, 'معرّف bigint كنص'),
    name: z.string(),
    role: z.string(),
    username: z.string(),
    // `publicUserOf` في الخادم يصدر dept_code؛ الشاشات (التحويلات) تحتاجه
    // لتحديد قسم المرسل الافتراضي — يُحفظ هنا دون فرضه.
    dept_code: z.string().nullable().optional(),
});

const sessionResponseSchema = z.object({
    access_token: z.string().min(1),
    refresh_token: z.string().min(1),
    app_key: z.string().nullable().optional(),
    user: sessionUserSchema,
});

/**
 * رد `/api/auth/login` متعدد الأشكال: جلسة كاملة، أو تذكرة عامل ثانٍ، أو
 * تدوير كلمة مرور إلزامي. كل الحقول اختيارية كي لا يسقط الرد على مخطط
 * الجلسة قبل أن نعرف نوعه.
 */
const loginReplySchema = z.object({
    access_token: z.string().optional(),
    refresh_token: z.string().optional(),
    app_key: z.string().nullable().optional(),
    user: sessionUserSchema.optional(),
    password_change_required: z.boolean().optional(),
    mfa_required: z.boolean().optional(),
    mfa_enrollment_required: z.boolean().optional(),
    webauthn_required: z.boolean().optional(),
    webauthn_available: z.boolean().optional(),
    mfa_token: z.string().optional(),
    message: z.string().optional(),
});

const mfaSetupSchema = z.object({
    ok: z.literal(true),
    issuer: z.string(),
    account: z.string(),
    secret: z.string(),
    otpauth_uri: z.string(),
    qr_data_url: z.string().nullable().optional(),
    expires_in_minutes: z.number().optional(),
    message: z.string().optional(),
});

export interface SessionUser {
    id: string;
    name: string;
    role: string;
    username: string;
    dept_code?: string | null | undefined;
}

export interface AuthState {
    status: 'authenticated' | 'anonymous';
    token: string | null;
    user: SessionUser | null;
}

export interface AuthSession {
    access_token: string;
    refresh_token: string;
    app_key?: string | null | undefined;
    user: SessionUser;
}

/** نتيجة الدخول: جلسة كاملة أو بوابة عامل ثانٍ أو تدوير كلمة مرور. */
export type AuthOutcome =
    | { kind: 'session' }
    | {
          kind: 'mfa';
          ticket: string;
          methods: { totp: boolean; passkey: boolean };
          message?: string;
      }
    | { kind: 'enroll'; ticket: string; message?: string }
    | { kind: 'password_change'; ticket: string; message?: string };

export interface MfaSetup {
    issuer: string;
    account: string;
    secret: string;
    otpauthUri: string;
    qrDataUrl: string | null;
}

/** خطأ مصادقة يحمل رمز الخادم (`INVALID_CREDENTIALS`…) كما في القديم. */
export class AuthError extends Error {
    readonly code: string;

    constructor(code: string, message: string) {
        super(message);
        this.name = 'AuthError';
        this.code = code;
    }
}

let state: AuthState = { status: 'anonymous', token: null, user: null };
let appKey: string | null = null;
const listeners = new Set<(next: AuthState) => void>();

function readStorage(key: string): string {
    try {
        return String(window.localStorage.getItem(key) || '');
    } catch {
        return '';
    }
}

function writeStorage(key: string, value: string): void {
    try {
        if (value) {
            window.localStorage.setItem(key, value);
        } else {
            window.localStorage.removeItem(key);
        }
    } catch {
        // تخزين معطّل (وضع خاص) — الجلسة تبقى في الذاكرة.
    }
}

/**
 * المخزن حالةٌ بكائنٍ واحد: `useSyncExternalStore` يقارن بـ`Object.is`،
 * فكائنٌ جديد كل قراءة (= `getSnapshot` غير مستقر) يسبّب إعادة رسمٍ لا
 * تنتهي. فالحالة تُبنى مرّة عند كل تغيير وتُعاد كما هي حتى ذلك الحين.
 */
function setSession(token: string | null, user: SessionUser | null): void {
    if (state.token === token && state.user?.id === user?.id) {
        return;
    }
    state = { status: token ? 'authenticated' : 'anonymous', token, user };
    for (const listener of listeners) {
        listener(state);
    }
}

export function getAuthState(): AuthState {
    return state;
}

export function subscribeAuth(listener: (next: AuthState) => void): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

export function getAccessToken(): string | null {
    return state.token;
}

/**
 * مفتاح التطبيق — في الذاكرة فقط، يُسلَّم مع كل جلسة.
 *
 * `null` يعني «السيرفر بلا مفتاح» (ترويسة `x-api-key` تُحذف عندها) لا
 * «مفتاح مفقود»: الفرق يغيّر سلوك الطلب عند غياب المفتاح فعلًا.
 */
export function getAppKey(): string | null {
    return appKey;
}

function setAppKey(value: string | null | undefined): void {
    const next = typeof value === 'string' && value.trim() !== '' ? value : null;
    appKey = next;
}

/** حالة الجلسة للقاعدة (React) — اشتراكٌ على مخزن الحالة نفسه. */
export function useAuthState(): AuthState {
    return useSyncExternalStore(subscribeAuth, getAuthState, getAuthState);
}

async function requestJson(path: string, body: unknown, ticket?: string | null): Promise<{ ok: boolean; status: number; data: unknown }> {
    const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        Accept: 'application/json',
    };
    if (ticket) {
        headers.Authorization = `Bearer ${ticket}`;
    }
    const response = await fetch(path, {
        method: 'POST',
        headers,
        body: JSON.stringify(body ?? {}),
    });
    let data: unknown = null;
    try {
        data = await response.json();
    } catch {
        data = null;
    }
    return { ok: response.ok, status: response.status, data };
}

async function errorFrom(data: unknown, fallback: string): Promise<AuthError> {
    const body = data as { error?: unknown; message?: unknown } | null;
    const code = typeof body?.error === 'string' && body.error ? body.error : 'AUTH_FAILED';
    const message = typeof body?.message === 'string' && body.message ? body.message : fallback;
    return new AuthError(code, message);
}

/** يطبّق جلسة كاملة (بعد كلمة المرور أو العامل الثاني) ويحفظ رمز التحديث. */
export function applySession(session: AuthSession): void {
    writeStorage(RT_KEY, session.refresh_token);
    setAppKey(session.app_key);
    setSession(session.access_token, session.user);
}

function parseSession(data: unknown): AuthSession {
    return sessionResponseSchema.parse(data);
}

/** يبدّل رمز التحديث بتوكن وصول جديد ويحفظ الرمز المدوَّر. */
export async function refreshSession(): Promise<boolean> {
    const refreshToken = readStorage(RT_KEY);
    if (!refreshToken) {
        setSession(null, null);
        return false;
    }
    let response: Response;
    try {
        response = await fetch('/api/auth/refresh', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Accept: 'application/json',
            },
            body: JSON.stringify({ refresh_token: refreshToken }),
        });
    } catch (error) {
        console.warn('[auth] Session refresh unavailable; keeping the current session for retry.', error);
        return false;
    }

    if (!response.ok) {
        if (response.status === 401) {
            writeStorage(RT_KEY, '');
            setAppKey(null);
            setSession(null, null);
            return false;
        }
        console.warn(`[auth] Session refresh failed with HTTP ${response.status}; keeping the current session for retry.`);
        return false;
    }

    try {
        applySession(parseSession(await response.json()));
        return true;
    } catch (error) {
        console.error('[auth] Session refresh returned an invalid response; keeping the current session for retry.', error);
        return false;
    }
}

/** يوحّد شكل بوابة العامل الثاني القادمة من الدخول أو تغيير كلمة المرور. */
function gatedOutcome(reply: z.infer<typeof loginReplySchema>): AuthOutcome {
    if (reply.password_change_required && reply.access_token) {
        return {
            kind: 'password_change',
            ticket: reply.access_token,
            ...(reply.message ? { message: reply.message } : {}),
        };
    }
    if (reply.mfa_enrollment_required && reply.mfa_token) {
        return {
            kind: 'enroll',
            ticket: reply.mfa_token,
            ...(reply.message ? { message: reply.message } : {}),
        };
    }
    if (reply.webauthn_required && reply.mfa_token) {
        return {
            kind: 'mfa',
            ticket: reply.mfa_token,
            methods: { totp: false, passkey: true },
            ...(reply.message ? { message: reply.message } : {}),
        };
    }
    if (reply.mfa_required && reply.mfa_token) {
        return {
            kind: 'mfa',
            ticket: reply.mfa_token,
            methods: { totp: true, passkey: reply.webauthn_available === true },
            ...(reply.message ? { message: reply.message } : {}),
        };
    }
    throw new AuthError('UNEXPECTED_REPLY', 'ردّ الخادم غير مفهوم — حدّث الصفحة وحاول مجددًا.');
}

/**
 * الدخول بكلمة المرور — لا يُدخل التطبيق إلا بجلسة كاملة. ردود العامل
 * الثاني وتدوير كلمة المرور تُعاد كـ`AuthOutcome` ليعرضها `AuthGate`.
 */
export async function login(username: string, password: string): Promise<AuthOutcome> {
    const { ok, status, data } = await requestJson('/api/auth/login', {
        username,
        password,
    });
    if (!ok) {
        const body = data as { error?: unknown; message?: unknown } | null;
        throw new AuthError(
            typeof body?.error === 'string' && body.error ? body.error : `HTTP_${status}`,
            typeof body?.message === 'string' && body.message
                ? body.message
                : status === 401
                  ? 'بيانات تسجيل الدخول غير صحيحة'
                  : 'تعذّر تسجيل الدخول',
        );
    }
    const reply = loginReplySchema.parse(data);
    if (reply.access_token && reply.refresh_token && reply.user) {
        applySession({
            access_token: reply.access_token,
            refresh_token: reply.refresh_token,
            app_key: reply.app_key,
            user: reply.user,
        });
        return { kind: 'session' };
    }
    return gatedOutcome(reply);
}

/** تحقق TOTP أو رمز استرداد ← جلسة كاملة. */
export async function verifyMfa(ticket: string, input: { code?: string; recoveryCode?: string }): Promise<void> {
    const body = input.recoveryCode ? { recovery_code: input.recoveryCode } : { code: input.code };
    const { ok, data } = await requestJson('/api/auth/mfa/verify', body, ticket);
    if (!ok) {
        throw await errorFrom(data, 'رمز المصادقة غير صحيح');
    }
    applySession(parseSession(data));
}

/** يبدأ تسجيل TOTP (تذكرة تسجيل) ويعيد QR والمفتاح اليدوي. */
export async function setupMfa(ticket: string): Promise<MfaSetup> {
    const { ok, data } = await requestJson('/api/auth/mfa/setup', {}, ticket);
    if (!ok) {
        throw await errorFrom(data, 'تعذّر بدء تسجيل المصادقة الثنائية');
    }
    const parsed = mfaSetupSchema.parse(data);
    return {
        issuer: parsed.issuer,
        account: parsed.account,
        secret: parsed.secret,
        otpauthUri: parsed.otpauth_uri,
        qrDataUrl: parsed.qr_data_url ?? null,
    };
}

/**
 * تأكيد التسجيل — الجلسة صادرة بالفعل، لكن لا نُدخلها قبل حفظ رموز
 * الاسترداد. تُعاد للمستدعي كي يعرضها ثم يستدعي `applySession`.
 */
export async function confirmMfa(ticket: string, code: string): Promise<{ session: AuthSession; recoveryCodes: string[] }> {
    const { ok, data } = await requestJson('/api/auth/mfa/confirm', { code }, ticket);
    if (!ok) {
        throw await errorFrom(data, 'تعذّر تأكيد رمز المصادقة');
    }
    const raw = data as { recovery_codes?: unknown };
    return {
        session: parseSession(data),
        recoveryCodes: Array.isArray(raw.recovery_codes)
            ? raw.recovery_codes.filter((code): code is string => typeof code === 'string')
            : [],
    };
}

/** العامل الثاني بمفتاح مرور (بصمة / Face ID) ← جلسة كاملة. */
export async function loginWithPasskey(ticket: string): Promise<void> {
    if (!isWebAuthnSupported()) {
        throw new AuthError('WEBAUTHN_UNSUPPORTED', 'هذا المتصفح لا يدعم الدخول بالبصمة — استخدم رمز التطبيق.');
    }
    const optionsReply = await requestJson('/api/auth/webauthn/login/options', {}, ticket);
    if (!optionsReply.ok) {
        throw await errorFrom(optionsReply.data, 'تعذّر بدء التحقق بالجهاز');
    }
    const options = (optionsReply.data as { options?: Parameters<typeof toRequestOptions>[0] }).options;
    if (!options) {
        throw new AuthError('WEBAUTHN_OPTIONS', 'خيارات التحقق غير مكتملة — أعد المحاولة.');
    }
    let credential: Credential | null;
    try {
        credential = await navigator.credentials.get({
            publicKey: toRequestOptions(options),
        });
    } catch (error) {
        throw new AuthError('WEBAUTHN_FAILED', describeWebAuthnError(error));
    }
    if (!credential) {
        throw new AuthError('WEBAUTHN_CANCELLED', 'لم يكتمل التحقق بالجهاز — أعد المحاولة.');
    }
    const assertion: AssertionJSON = serializeAssertion(credential as PublicKeyCredential);
    const verify = await requestJson('/api/auth/webauthn/login/verify', { response: assertion }, ticket);
    if (!verify.ok) {
        throw await errorFrom(verify.data, 'تعذّر التحقق من الجهاز');
    }
    applySession(parseSession(verify.data));
}

/**
 * تغيير كلمة المرور. تذكرة `PASSWORD_CHANGE_REQUIRED` جلسةٌ مقيدة: بعد
 * التغيير قد يعيد الخادم بوابة عامل ثانٍ (MFA) بدل جلسة كاملة.
 */
export async function changePassword(ticket: string, currentPassword: string, newPassword: string): Promise<AuthOutcome> {
    const { ok, data } = await requestJson(
        '/api/auth/change-password',
        { current_password: currentPassword, new_password: newPassword },
        ticket,
    );
    if (!ok) {
        throw await errorFrom(data, 'تعذّر تغيير كلمة المرور');
    }
    const reply = loginReplySchema.parse(data);
    if (reply.access_token && reply.refresh_token && reply.user) {
        applySession({
            access_token: reply.access_token,
            refresh_token: reply.refresh_token,
            app_key: reply.app_key,
            user: reply.user,
        });
        return { kind: 'session' };
    }
    return gatedOutcome(reply);
}

/** استعادة كلمة المرور برمز لمرة واحدة يصدره المدير. */
export async function resetPassword(username: string, code: string, newPassword: string): Promise<void> {
    const { ok, data } = await requestJson('/api/auth/forgot-password/reset', {
        username,
        code,
        new_password: newPassword,
    });
    if (!ok) {
        throw await errorFrom(data, 'تعذّر تغيير كلمة المرور — تحقق من الرمز');
    }
}

/**
 * الخروج: إبطال رمز التجديد على الخادم (أفضل جهد) ثم تفريغ الحالة محليًا.
 * لا ننتظر الشبكة — الخروج يجب أن ينجح دائمًا على هذا الجهاز.
 */
export function logout(): void {
    const token = state.token;
    if (token) {
        void fetch('/api/auth/logout', {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
        }).catch(() => {
            // الخادم غير متاح — الحالة المحلية كافية، والرمز سيُرفض لاحقًا.
        });
    }
    writeStorage(RT_KEY, '');
    setAppKey(null);
    setSession(null, null);
}

/**
 * تمهيد الجلسة عند الإقلاع: توكن وصول مُودَع (قناة التمهيد) ثم رمز التحديث
 * المشترك مع القديم. يُعيد `true` إن كانت هناك جلسة صالحة.
 */
export async function bootstrapSession(): Promise<boolean> {
    const seeded = readStorage(ACCESS_KEY);
    if (seeded) {
        setSession(seeded, null);
        return true;
    }
    return refreshSession();
}
