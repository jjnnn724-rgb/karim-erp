/**
 * realtime-guard.test.js — TASK 4: handshake auth + socket rate limits.
 * Pure unit tests (no boot, no DB).
 */

const {
    isRtAuthRequired,
    resolveHandshakeUser,
    createSocketLimiter,
    SOCKET_EVENT_BUDGETS,
} = require('../backend/realtime/guard');

describe('isRtAuthRequired — default off (coexistence)', () => {
    const prev = process.env.RT_REQUIRE_AUTH;
    afterEach(() => {
        if (prev === undefined) {delete process.env.RT_REQUIRE_AUTH;}
        else {process.env.RT_REQUIRE_AUTH = prev;}
    });
    test('unset → false', () => {
        delete process.env.RT_REQUIRE_AUTH;
        expect(isRtAuthRequired()).toBe(false);
    });
    test.each([['true', true], ['TRUE', true], ['1', false], ['yes', false], ['', false]])('%s → %s', (v, expected) => {
        process.env.RT_REQUIRE_AUTH = v;
        expect(isRtAuthRequired()).toBe(expected);
    });
});

describe('resolveHandshakeUser — never trusts client claims', () => {
    const verify = (token) => {
        if (token === 'good') {return { sub: '7', role: 'cashier', name: 'كاشير', dept_code: null };}
        throw new Error('invalid');
    };
    test('valid JWT in auth → identity', () => {
        expect(resolveHandshakeUser(verify, { auth: { token: 'good' } }))
            .toEqual({ id: 7, role: 'cashier', name: 'كاشير', dept_code: null });
    });
    test('legacy query token supported', () => {
        expect(resolveHandshakeUser(verify, { query: { token: 'good' } }).id).toBe(7);
    });
    test.each([[{}], [{ auth: {} }], [null], [undefined]])('no token → anonymous (%p)', (hs) => {
        expect(resolveHandshakeUser(verify, hs)).toBeNull();
    });
    test('bad token → anonymous (never throws)', () => {
        expect(resolveHandshakeUser(verify, { auth: { token: 'bad' } })).toBeNull();
    });
    test('non-integer sub / missing role → anonymous', () => {
        const v = () => ({ sub: 'x', role: 'admin' });
        expect(resolveHandshakeUser(v, { auth: { token: 't' } })).toBeNull();
        const v2 = () => ({ sub: '3' });
        expect(resolveHandshakeUser(v2, { auth: { token: 't' } })).toBeNull();
    });
    test('no verify fn → anonymous', () => {
        expect(resolveHandshakeUser(null, { auth: { token: 'good' } })).toBeNull();
    });
});

describe('createSocketLimiter — per-socket budgets', () => {
    test('allows up to budget then blocks', () => {
        const t = 1000;
        const lim = createSocketLimiter({ now: () => t });
        for (let i = 0; i < 10; i++) {expect(lim.check('s1', 'register_user', 10)).toBe(true);}
        expect(lim.check('s1', 'register_user', 10)).toBe(false);
    });
    test('budgets isolated per socket + event', () => {
        const lim = createSocketLimiter({ now: () => 0 });
        expect(lim.check('a', 'ping_check', 1)).toBe(true);
        expect(lim.check('a', 'ping_check', 1)).toBe(false);
        expect(lim.check('b', 'ping_check', 1)).toBe(true);
        expect(lim.check('a', 'request_sync', 1)).toBe(true);
    });
    test('window resets after 60s', () => {
        let t = 0;
        const lim = createSocketLimiter({ now: () => t });
        expect(lim.check('s', 'e', 1)).toBe(true);
        expect(lim.check('s', 'e', 1)).toBe(false);
        t = 61000;
        expect(lim.check('s', 'e', 1)).toBe(true);
    });
    test('reset clears socket state (disconnect)', () => {
        const lim = createSocketLimiter({ now: () => 0 });
        expect(lim.check('s', 'e', 1)).toBe(true);
        expect(lim.check('s', 'e', 1)).toBe(false);
        lim.reset('s');
        expect(lim.check('s', 'e', 1)).toBe(true);
    });
    test('budgets table sane', () => {
        expect(SOCKET_EVENT_BUDGETS.register_user).toBe(10);
        expect(SOCKET_EVENT_BUDGETS.ping_check).toBe(30);
    });
});
