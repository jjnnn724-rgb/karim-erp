import { v3ChartResponseSchema } from '@karim/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { ApiError, fetchJson } from './api';
import { login, logout } from './auth';

afterEach(() => {
    vi.unstubAllGlobals();
    logout();
});

function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('fetchJson', () => {
    it('يرسل توكن الوصول في ترويسة Authorization', async () => {
        const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => jsonResponse([]));
        vi.stubGlobal('fetch', fetchMock);

        await fetchJson(v3ChartResponseSchema, '/api/v3/accounting/chart', 'token-abc');

        const init = fetchMock.mock.calls[0]?.[1];
        expect(init?.headers).toMatchObject({ Authorization: 'Bearer token-abc' });
    });

    it('يُرفق مفتاح التطبيق بعد تسجيل الدخول — فبدونه يرفض القديم الطلب', async () => {
        const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => {
            if (String(_url).includes('/api/auth/login')) {
                return jsonResponse({
                    access_token: 'test-access-1',
                    refresh_token: 'test-refresh-1',
                    app_key: 'test-app-key-1',
                    user: { id: '7', name: 'قارئ', role: 'accountant', username: 'reader' },
                });
            }
            return jsonResponse([]);
        });
        vi.stubGlobal('fetch', fetchMock);

        await login('reader', 'synthetic-password');
        await fetchJson(v3ChartResponseSchema, '/api/v3/accounting/chart', 'token-abc');

        const init = fetchMock.mock.calls[1]?.[1];
        expect(init?.headers).toMatchObject({ 'x-api-key': 'test-app-key-1' });
    });

    it('يحذف ترويسة المفتاح حين لا يوجد مفتاح', async () => {
        const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => jsonResponse([]));
        vi.stubGlobal('fetch', fetchMock);

        await fetchJson(v3ChartResponseSchema, '/api/v3/accounting/chart', 'token-abc');

        const init = fetchMock.mock.calls[0]?.[1];
        expect(init?.headers).not.toHaveProperty('x-api-key');
    });

    it('يدعم POST/PUT JSON للأبواب القديمة مع ترويسات المصادقة', async () => {
        const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => jsonResponse({ ok: true }));
        vi.stubGlobal('fetch', fetchMock);

        await fetchJson(z.unknown(), '/api/inventory/7', 'token-abc', {
            method: 'PUT',
            body: { barcode: '4006381333931' },
        });

        const init = fetchMock.mock.calls[0]?.[1];
        expect(init?.method).toBe('PUT');
        expect(init?.headers).toMatchObject({ 'Content-Type': 'application/json' });
        expect(JSON.parse(String(init?.body))).toEqual({ barcode: '4006381333931' });
    });

    it('يدعم DELETE مع المصادقة دون جسم JSON', async () => {
        const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => jsonResponse({ ok: true }));
        vi.stubGlobal('fetch', fetchMock);
        await fetchJson(z.unknown(), '/api/hrDepartments/7', 'token-abc', { method: 'DELETE' });
        const init = fetchMock.mock.calls[0]?.[1];
        expect(init?.method).toBe('DELETE');
        expect(init?.headers).not.toHaveProperty('Content-Type');
        expect(init?.body).toBeUndefined();
    });

    it('يرفض استجابةً تخالف العقد بدل تمريرها', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => jsonResponse([{ code: '1' }])),
        );

        await expect(fetchJson(v3ChartResponseSchema, '/api/v3/accounting/chart', null)).rejects.toBeInstanceOf(
            ApiError,
        );
    });

    it('يحمل رمز الخطأ ورسالته من جسم {error, message}', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => jsonResponse({ error: 'UNAUTHORIZED', message: 'Missing Bearer token.' }, 401)),
        );

        const failure = await fetchJson(v3ChartResponseSchema, '/api/v3/accounting/chart', null).catch(
            (error: unknown) => error,
        );

        expect(failure).toBeInstanceOf(ApiError);
        expect((failure as ApiError).status).toBe(401);
        expect((failure as ApiError).code).toBe('UNAUTHORIZED');
        expect((failure as ApiError).message).toBe('Missing Bearer token.');
        expect((failure as ApiError).isAuthProblem).toBe(true);
    });
});
