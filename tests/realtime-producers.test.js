/**
 * realtime-producers.test.js — TASK 9: flag gates + in-txn insert shape.
 * Fake pool/client (no DB).
 */

const path = require('path');

function loadProducers() {
    const p = path.join('..', 'backend', 'realtime', 'producers.js');
    delete require.cache[path.resolve(__dirname, p)];
    return require(p);
}

function fakeClient(capture) {
    return { query: jest.fn(async (sql, params) => { capture.push({ sql, params }); return { rows: [{ event_id: 'e1', sequence: 7 }] }; }) };
}
function fakePool(ok = true) {
    return { query: jest.fn(async () => ({ rows: ok ? [{ t: 'event_outbox' }] : [] })) };
}

describe('producersEnabled — default off (coexistence)', () => {
    const prev = { ...process.env };
    afterEach(() => {
        for (const k of Object.keys(process.env)) {
            if (k.startsWith('RT_EVT_') && !(k in prev)) {delete process.env[k];}
        }
        Object.assign(process.env, prev);
    });
    test('unset → false for all modules', () => {
        delete process.env.RT_EVT_KITCHEN;
        const { producersEnabled } = loadProducers();
        for (const m of ['KITCHEN', 'DISPATCH', 'PURCHASE', 'INVENTORY', 'HR', 'EXPENSE', 'PAYMENT']) {
            expect(producersEnabled(m)).toBe(false);
        }
    });
    test('true → enabled (case-insensitive)', () => {
        process.env.RT_EVT_HR = 'TRUE';
        expect(loadProducers().producersEnabled('HR')).toBe(true);
    });
});

describe('emitDomainEvent — in-txn insert, deterministic rooms', () => {
    const prev = process.env.RT_EVT_DISPATCH;
    afterEach(() => {
        if (prev === undefined) {delete process.env.RT_EVT_DISPATCH;}
        else {process.env.RT_EVT_DISPATCH = prev;}
    });
    test('flag off → no query (zero behavior change)', async () => {
        delete process.env.RT_EVT_DISPATCH;
        const { emitDomainEvent } = loadProducers();
        const capture = [];
        const out = await emitDomainEvent(fakePool(), fakeClient(capture), 'DISPATCH', { eventType: 'X', aggregateType: 'a', aggregateId: '1' });
        expect(out).toBeNull();
        expect(capture).toEqual([]);
    });
    test('flag on → INSERT with rooms+target, returns sequence', async () => {
        process.env.RT_EVT_DISPATCH = 'true';
        const { emitDomainEvent } = loadProducers();
        const capture = [];
        const out = await emitDomainEvent(fakePool(), fakeClient(capture), 'DISPATCH', {
            eventType: 'DISPATCH_APPROVED', aggregateType: 'dispatch', aggregateId: 42,
            deptCode: 'kitchen', payload: { total: 100 },
        });
        expect(out).toEqual({ eventId: expect.any(String), sequence: 7 });
        const ins = capture.find((c) => c.sql.includes('INSERT INTO event_outbox'));
        expect(ins).toBeTruthy();
        const meta = JSON.parse(ins.params[7]);
        expect(meta.rooms).toEqual(expect.arrayContaining(['role:warehouse', 'dept:kitchen']));
        expect(meta.target).toEqual({ type: 'permission', value: 'dispatch.view' });
    });
});

describe('router permission map (TASK 9 additions)', () => {
    const { authorizeEventForUser } = require('../backend/realtime/router');
    test.each([
        ['purchase.view', 'accountant', true],
        ['purchase.view', 'cashier', false],
        ['inventory.view', 'kitchen', true],
        ['hr.view', 'hr', true],
        ['hr.view', 'warehouse', false],
        ['expense.view', 'accountant', true],
    ])('%s for %s → %s', async (perm, role, expected) => {
        const ev = { routing_metadata: { rooms: ['erp:all'], target: { type: 'permission', value: perm } } };
        await expect(authorizeEventForUser(ev, { id: 1, role })).resolves.toBe(expected);
    });
});
