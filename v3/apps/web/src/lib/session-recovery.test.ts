import { MutationCache, MutationObserver, QueryClient, QueryObserver } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from './api';
import { applySession, getAuthState, logout } from './auth';
import { handleAuthError, registerSessionToast, resetSessionRecoveryForTests } from './session-recovery';

/**
 * الاستجابة التفاعلية لـ401 — تُختبَر على جلسة حقيقية (`applySession`) مع
 * `fetch` مُستبدل لنقطة التجديد، وعميل استعلامات حقيقي لمراقبة إعادة الجلب.
 * المنطق الشبكي للتجديد نفسه مغطّى في `auth.test.ts`؛ هنا نثبّت الاستجابة:
 * 401⇒تجديد⇒إعادة جلب، فشل⇒خروج+توست واحد، 403⇒لا خروج، وتزامن⇒تجديد واحد.
 */

const SESSION = {
    access_token: 'access-1',
    refresh_token: 'refresh-1',
    app_key: 'key-1',
    user: { id: '7', name: 'قارئ', role: 'accountant', username: 'reader' },
};
const SESSION2 = { ...SESSION, access_token: 'access-2', refresh_token: 'refresh-2' };

function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function err401(): ApiError {
    return new ApiError(401, 'UNAUTHORIZED', 'انتهت الجلسة');
}

beforeEach(() => {
    resetSessionRecoveryForTests();
    window.localStorage.clear();
});

afterEach(() => {
    // الخروج قد ينادي fetch (إبطال على الخادم) — نُبقيه مُستبدلًا كي لا شبكة.
    vi.stubGlobal(
        'fetch',
        vi.fn(async () => jsonResponse({ ok: true })),
    );
    logout();
    resetSessionRecoveryForTests();
    window.localStorage.clear();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('استجابة 401', () => {
    it('401 ⇒ تجديد ناجح ⇒ إعادة جلب الاستعلامات النشطة', async () => {
        applySession(SESSION);
        const fetchMock = vi.fn(async (url: string) =>
            String(url).includes('/api/auth/refresh') ? jsonResponse(SESSION2) : jsonResponse({}),
        );
        vi.stubGlobal('fetch', fetchMock);

        const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        const queryFn = vi.fn().mockResolvedValue('payload');
        const observer = new QueryObserver(client, { queryKey: ['data'], queryFn });
        const unsubscribe = observer.subscribe(() => {});
        await vi.waitFor(() => expect(queryFn).toHaveBeenCalledTimes(1));

        await handleAuthError(err401(), client);

        // تجديد واحد فقط، ثم إعادة جلب بالتوكن الجديد.
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(String(fetchMock.mock.calls[0]?.[0])).toContain('/api/auth/refresh');
        await vi.waitFor(() => expect(queryFn).toHaveBeenCalledTimes(2));
        expect(getAuthState().status).toBe('authenticated');
        expect(getAuthState().token).toBe('access-2');
        unsubscribe();
    });

    it('401 ⇒ فشل التجديد ⇒ تفريغ الجلسة + توست عربي واحد', async () => {
        applySession(SESSION);
        const toast = vi.fn();
        registerSessionToast(toast);
        const fetchMock = vi.fn(async () => jsonResponse({ error: 'REFRESH_TOKEN_INVALID' }, 401));
        vi.stubGlobal('fetch', fetchMock);
        const client = new QueryClient();

        // أخطاء متزامنة تشترك محاولة واحدة ⇒ توست واحد لا ثلاثة.
        await Promise.all([
            handleAuthError(err401(), client),
            handleAuthError(err401(), client),
            handleAuthError(err401(), client),
        ]);

        expect(getAuthState().status).toBe('anonymous');
        expect(window.localStorage.getItem('karim_rt_v1')).toBeNull();
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(toast).toHaveBeenCalledTimes(1);
        expect(toast).toHaveBeenCalledWith({ title: 'انتهت الجلسة — سجّل الدخول من جديد', variant: 'error' });
    });

    it('403 (صلاحية) لا يُنهي الجلسة ولا يجدّد', async () => {
        applySession(SESSION);
        const toast = vi.fn();
        registerSessionToast(toast);
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
        const client = new QueryClient();

        await handleAuthError(new ApiError(403, 'FORBIDDEN', 'لا تملك صلاحية'), client);

        expect(getAuthState().status).toBe('authenticated');
        expect(getAuthState().token).toBe('access-1');
        expect(fetchMock).not.toHaveBeenCalled();
        expect(toast).not.toHaveBeenCalled();
    });

    it('أخطاء 401 المتزامنة تشترك تجديدًا واحدًا (نجاح)', async () => {
        applySession(SESSION);
        let resolveRefresh: () => void = () => {};
        const gate = new Promise<void>((resolve) => {
            resolveRefresh = resolve;
        });
        const fetchMock = vi.fn(async (url: string) => {
            if (String(url).includes('/api/auth/refresh')) {
                await gate;
                return jsonResponse(SESSION2);
            }
            return jsonResponse({});
        });
        vi.stubGlobal('fetch', fetchMock);
        const client = new QueryClient();

        const first = handleAuthError(err401(), client);
        const second = handleAuthError(err401(), client);
        const third = handleAuthError(err401(), client);
        resolveRefresh?.();
        await Promise.all([first, second, third]);

        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(getAuthState().status).toBe('authenticated');
        expect(getAuthState().token).toBe('access-2');
    });

    it('خطأ غير ApiError يُتجاهل (شبكة/500)', async () => {
        applySession(SESSION);
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
        const client = new QueryClient();

        await handleAuthError(new Error('offline'), client);
        await handleAuthError(new ApiError(500, 'SERVER', 'خطأ خادم'), client);

        expect(fetchMock).not.toHaveBeenCalled();
        expect(getAuthState().status).toBe('authenticated');
    });

    it('بلا جلسة ⇒ لا محاولة تجديد (منع الحلقة بعد الخروج)', async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
        const client = new QueryClient();

        await handleAuthError(err401(), client);

        expect(fetchMock).not.toHaveBeenCalled();
        expect(getAuthState().status).toBe('anonymous');
    });

    it('قناة التمهيد (توكن بلا رمز تحديث) ⇒ لا خروج عند 401', async () => {
        applySession(SESSION);
        window.localStorage.removeItem('karim_rt_v1'); // جلسة تمهيد بلا رمز تحديث
        const toast = vi.fn();
        registerSessionToast(toast);
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
        const client = new QueryClient();

        await handleAuthError(err401(), client);

        // لا مسار تجديد ⇒ نترك الخطأ لطبقة العرض ولا نُخرج الجلسة.
        expect(fetchMock).not.toHaveBeenCalled();
        expect(toast).not.toHaveBeenCalled();
        expect(getAuthState().status).toBe('authenticated');
    });

    it('يعالج 401 القادم من الكتابة عبر mutationCache', async () => {
        applySession(SESSION);
        const fetchMock = vi.fn(async () => jsonResponse(SESSION2));
        vi.stubGlobal('fetch', fetchMock);
        const client = new QueryClient({
            mutationCache: new MutationCache({
                onError: (error) => {
                    void handleAuthError(error, client);
                },
            }),
        });
        const observer = new MutationObserver(client, {
            mutationFn: async () => {
                throw err401();
            },
        });

        await observer.mutate().catch(() => {});

        // الاسترجاع غير متزامن بعد رفض الطفرة: ننتظر اكتمال التطبيق فعليًا
        // (النداء وحده لا يعني applySession — سباق توقيت ظهر على عدّاد CI).
        await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
        await vi.waitFor(() => {
            expect(getAuthState().status).toBe('authenticated');
            expect(getAuthState().token).toBe('access-2');
        });
    });
});
