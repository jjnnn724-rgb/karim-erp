/**
 * api-cache.test.js — session-scoped key + invalidation (no DB).
 */

const { apiCacheMiddleware, invalidateAll } = require('../backend/api-cache');

function mockReq(url, auth) {
    return { method: 'GET', path: url.split('?')[0], originalUrl: url, headers: auth ? { authorization: auth } : {}, statusCode: 200 };
}
function mockRes() {
    const headers = {};
    return {
        headers, statusCode: 200,
        set(k, v) {headers[k] = v;},
        json(data) {this.sent = data;return this;},
    };
}
async function get(url, auth, responder) {
    const req = mockReq(url, auth);
    const res = mockRes();
    let nexted = false;
    await apiCacheMiddleware(req, res, () => { nexted = true; });
    if (nexted) {await responder(req, res);}
    return { res, nexted };
}

describe('api-cache — session isolation', () => {
    test('same URL, different sessions → separate entries', async () => {
        invalidateAll();
        const a = await get('/api/x?limit=1', 'Bearer A', async (req, res) => res.json({ for: 'A' }));
        expect(a.res.headers['X-Cache']).toBe('MISS');
        const b = await get('/api/x?limit=1', 'Bearer B', async (req, res) => res.json({ for: 'B' }));
        expect(b.nexted).toBe(true); // MISS for B, handler ran
        expect(b.res.sent).toEqual({ for: 'B' });
        const a2 = await get('/api/x?limit=1', 'Bearer A', async () => { throw new Error('must not run'); });
        expect(a2.nexted).toBe(false); // HIT, handler skipped
        expect(a2.res.sent).toEqual({ for: 'A' });
    });

    test('invalidateAll clears everything', async () => {
        invalidateAll();
        await get('/api/y', 'Bearer A', async (req, res) => res.json({ v: 1 }));
        invalidateAll();
        const r = await get('/api/y', 'Bearer A', async (req, res) => res.json({ v: 2 }));
        expect(r.nexted).toBe(true);
        expect(r.res.sent).toEqual({ v: 2 });
    });

    test('non-GET and /api/state bypass', async () => {
        invalidateAll();
        let ran = false;
        await apiCacheMiddleware(
            { method: 'POST', path: '/api/x', originalUrl: '/api/x', headers: {}, statusCode: 200 },
            mockRes(), () => { ran = true; });
        expect(ran).toBe(true);
    });
});
