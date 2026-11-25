import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchDepartmentDispatchReport, fetchDispatchDetails } from './dispatches';

vi.mock('./auth', () => ({
    getAccessToken: () => 'dispatch-read-token',
    getAppKey: () => null,
}));

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('fetchDispatchDetails', () => {
    it('loads one full dispatch, including signature data, through the authenticated detail route', async () => {
        const fetchMock = vi.fn(
            async () =>
                new Response(
                    JSON.stringify({
                        id: 41,
                        status: 'approved',
                        requestSignatureData: 'data:image/png;base64,QUJD',
                        approvedItems: [{ itemName: 'رز', catchWeightEnabled: 'false' }],
                    }),
                    { status: 200, headers: { 'Content-Type': 'application/json' } },
                ),
        );
        vi.stubGlobal('fetch', fetchMock);

        const dispatch = await fetchDispatchDetails('41');

        expect(dispatch.id).toBe('41');
        expect(dispatch.requestSignatureData).toBe('data:image/png;base64,QUJD');
        expect(dispatch.approvedItems?.[0]?.catchWeightEnabled).toBe(false);
        expect(fetchMock).toHaveBeenCalledWith(
            '/api/dispatches/41',
            expect.objectContaining({
                headers: expect.objectContaining({ Authorization: 'Bearer dispatch-read-token' }),
            }),
        );
    });

    describe('fetchDepartmentDispatchReport', () => {
        it('requests a cost report only by dates and leaves department scope to the authenticated server account', async () => {
            const fetchMock = vi.fn<typeof fetch>();
            fetchMock.mockResolvedValue(
                new Response(
                    JSON.stringify({
                        ok: true,
                        departmentCodes: ['butcher'],
                        from: '2026-11-01',
                        to: '2026-11-25',
                        dispatchCount: 2,
                        totalCost: 125.5,
                        daily: [{ date: '2026-11-25', dispatchCount: 2, totalCost: 125.5 }],
                        monthly: [{ month: '2026-11', dispatchCount: 2, totalCost: 125.5 }],
                    }),
                    { status: 200, headers: { 'Content-Type': 'application/json' } },
                ),
            );
            vi.stubGlobal('fetch', fetchMock);

            const report = await fetchDepartmentDispatchReport('2026-11-01', '2026-11-25');

            expect(report.totalCost).toBe(125.5);
            const requestCall = fetchMock.mock.calls[0];
            if (!requestCall) {
                throw new Error('Expected the department report request');
            }
            const [url, options] = requestCall;
            expect(String(url)).toBe('/api/warehouse/dispatches/department-report?from=2026-11-01&to=2026-11-25');
            expect(options?.headers).toHaveProperty('Authorization');
            expect(String(url)).not.toContain('deptCode=');
        });
    });

    it('encodes an ID before requesting the detail route', async () => {
        const fetchMock = vi.fn(
            async () =>
                new Response(JSON.stringify({ id: 'a/b', status: 'approved' }), {
                    status: 200,
                    headers: { 'Content-Type': 'application/json' },
                }),
        );
        vi.stubGlobal('fetch', fetchMock);

        await fetchDispatchDetails('a/b');

        expect(fetchMock).toHaveBeenCalledWith('/api/dispatches/a%2Fb', expect.any(Object));
    });
});
