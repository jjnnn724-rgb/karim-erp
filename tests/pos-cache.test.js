/**
 * pos-cache.test.js — validates single-flight cache reuse under parallel reads
 */
const { createSingleFlightCache } = require('../backend/cashier-module/shift-routes');

describe('single-flight cache', () => {
    test('reuses one in-flight query for concurrent requests', async () => {
        let calls = 0;
        const cache = createSingleFlightCache({ ttlMs: 5000, staleMs: 15000 });

        const run = async () => cache.read(async () => {
            calls += 1;
            return { rows: [{ id: 1, ok: true }] };
        });

        const [first, second, third] = await Promise.all([
            run(),
            run(),
            run(),
        ]);

        expect(calls).toBe(1);
        expect(first).toEqual({ rows: [{ id: 1, ok: true }] });
        expect(second).toEqual({ rows: [{ id: 1, ok: true }] });
        expect(third).toEqual({ rows: [{ id: 1, ok: true }] });
    });
});
