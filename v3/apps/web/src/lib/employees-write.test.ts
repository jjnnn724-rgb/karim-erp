import { afterEach, describe, expect, it, vi } from 'vitest';
import { updateEmployeeProfile } from './employees-write';

function json(body: unknown): Response {
    return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
    });
}

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('تحديث دوام الموظف', () => {
    it('يحوّل auto_checkout/auto_lock إلى boolean ويحتفظ بـ shift_karim رقمًا', async () => {
        const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => json({ id: 118 }));
        vi.stubGlobal('fetch', fetchMock);

        await updateEmployeeProfile(118, {
            name: 'يوسف محمد حسن المالكي',
            shift_start: '15:00',
            shift_karim: 9,
            auto_checkout: 'false' as unknown as boolean,
            auto_lock: 'true' as unknown as boolean,
        } as never);

        const call = fetchMock.mock.calls.at(-1);
        expect(call).toBeDefined();
        const url = String(call?.[0]);
        const body = JSON.parse(String(call?.[1]?.body));
        expect(url).toBe('/api/employees/118');
        expect(body.auto_checkout).toBe(false);
        expect(body.auto_lock).toBe(true);
        expect(body.shift_karim).toBe(9);
        expect(body.name).toBe('يوسف محمد حسن المالكي');
    });

    it('يقبل 1/0 من أي عميل قديم ويُطبّعه إلى boolean', async () => {
        const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => json({ id: 120 }));
        vi.stubGlobal('fetch', fetchMock);

        await updateEmployeeProfile(120, {
            name: 'إيهاب مانع زايد عسيري',
            auto_checkout: 1 as unknown as boolean,
            auto_lock: 0 as unknown as boolean,
        });

        const body = JSON.parse(String(fetchMock.mock.calls.at(-1)?.[1]?.body));
        expect(body.auto_checkout).toBe(true);
        expect(body.auto_lock).toBe(false);
    });
});
