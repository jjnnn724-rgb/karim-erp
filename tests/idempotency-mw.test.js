/**
 * idempotency-mw.test.js — TASK 7: same key/body replay, key/body conflict,
 * concurrent in-progress, no-key bypass. Memory store (no DB/Redis).
 */

const { idempotency } = require('../backend/middleware/idempotency');

function reqRes({ method = 'POST', key = null, body = {} } = {}) {
    const req = { method, headers: {}, body };
    if (key) {req.headers['x-idempotency-key'] = key;}
    let complete;
    const completion = new Promise((resolve) => { complete = resolve; });
    const res = {
        statusCode: 200,
        headers: {},
        setHeader(k, v) {this.headers[k] = v;},
        status(c) {this.statusCode = c;return this;},
        json(b) {this.sentBody = b;complete();return this;},
        end() {complete();return this;},
    };
    const nextCalls = [];
    const next = (e) => {nextCalls.push(e || null);};
    return { req, res, next, nextCalls, completion };
}

// run handler through middleware like express would
async function through(mw, rr, handler) {
    await mw(rr.req, rr.res, rr.next);
    // express calls handler only if next() got no error
    if (rr.nextCalls.length && rr.nextCalls[0] === null) {await handler(rr.req, rr.res);}
}

describe('idempotency middleware (memory store)', () => {
    test('no key → bypass, handler runs', async () => {
        const mw = idempotency();
        const rr = reqRes({ body: { a: 1 } });
        let ran = false;
        await through(mw, rr, async (req, res) => {ran = true;res.json({ ok: true });});
        expect(ran).toBe(true);
        expect(rr.res.sentBody).toEqual({ ok: true });
    });

    test('GET → bypass even with key', async () => {
        const mw = idempotency();
        const rr = reqRes({ method: 'GET', key: 'k1' });
        let ran = false;
        await through(mw, rr, async (req, res) => {ran = true;res.json({});});
        expect(ran).toBe(true);
    });

    test('same key + same body → cached replay with header', async () => {
        const mw = idempotency();
        const key = `t-${Date.now()}-same`;
        const r1 = reqRes({ key, body: { total: 100 } });
        await through(mw, r1, async (req, res) => res.status(201).json({ id: 1 }));
        await r1.completion;
        expect(r1.res.sentBody).toEqual({ id: 1 });
        const r2 = reqRes({ key, body: { total: 100 } });
        await mw(r2.req, r2.res, r2.next);
        await r2.completion;
        expect(r2.res.headers['X-Idempotency-Replay']).toBe('true');
        expect(r2.res.sentBody).toEqual({ id: 1 });
        expect(r2.res.statusCode).toBe(201);
    });

    test('same key + different body → conflict error', async () => {
        const mw = idempotency();
        const key = `t-${Date.now()}-diff`;
        const r1 = reqRes({ key, body: { total: 100 } });
        await through(mw, r1, async (req, res) => res.json({ id: 2 }));
        const r2 = reqRes({ key, body: { total: 999 } });
        await mw(r2.req, r2.res, r2.next);
        expect(r2.nextCalls.length).toBe(1);
        expect(r2.nextCalls[0]).toBeTruthy(); // IdempotencyError conflict
    });

    test('concurrent same key → second sees in_progress', async () => {
        const mw = idempotency();
        const key = `t-${Date.now()}-conc`;
        const r1 = reqRes({ key, body: { x: 1 } });
        await mw(r1.req, r1.res, r1.next);
        expect(r1.nextCalls).toEqual([null]); // lock acquired, handler may run
        const r2 = reqRes({ key, body: { x: 1 } });
        await mw(r2.req, r2.res, r2.next);
        expect(r2.nextCalls.length).toBe(1);
        expect(r2.nextCalls[0]).toBeTruthy(); // in_progress, not replay
    });

    test('requireKey=true rejects missing key', async () => {
        const mw = idempotency({ requireKey: true });
        const rr = reqRes({ body: {} });
        await mw(rr.req, rr.res, rr.next);
        expect(rr.nextCalls.length).toBe(1);
        expect(rr.nextCalls[0]?.statusCode).toBe(400);
    });
});
