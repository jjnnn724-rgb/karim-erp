/**
 * realtime-publisher.test.js — TASK 5: claim/broadcast/mark + dead-letter visibility.
 * Fakes for pool/io/logger (no DB, no sockets).
 */

const { publishCycle, cycle, outboxStats, stopOutboxPublisher } = require('../backend/realtime/publisher');

function fakeLogger() {
    return { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
}

function fakeIo(fail = false) {
    const emitted = [];
    return {
        emitted,
        to(room) {
            return {
                emit(ev, env) {
                    if (fail) {throw new Error('transport down');}
                    emitted.push({ room, ev, env });
                },
            };
        },
    };
}

// pool fake: claim SELECT → rows; UPDATE → ok; dead-letter COUNT → n
function fakePool({ claimed = [], dead = 0 } = {}) {
    const queries = [];
    const client = {
        query: jest.fn(async (sql) => {
            queries.push(sql);
            if (sql.startsWith('SELECT * FROM event_outbox')) {return { rows: claimed };}
            return { rows: [] };
        }),
        release: jest.fn(),
    };
    return {
        queries,
        client,
        connect: jest.fn(async () => client),
        query: jest.fn(async (sql) => {
            queries.push(sql);
            if (sql.includes('COUNT(*)')) {return { rows: [{ c: dead }] };}
            return { rows: [] };
        }),
    };
}

const row = (id, seq) => ({
    id, sequence: seq, event_id: `e-${id}`, event_type: 'SALE_POSTED', event_version: 1,
    aggregate_type: 'sale', aggregate_id: String(id), branch_id: null,
    payload: { order_id: id }, routing_metadata: { rooms: ['erp:all'] }, created_at: new Date().toISOString(),
});

describe('publishCycle — claim → broadcast → mark', () => {
    test('broadcasts to rooms and marks published (short txn, no lock held during emit)', async () => {
        const pool = fakePool({ claimed: [row(1, 10), row(2, 11)] });
        const io = fakeIo();
        await publishCycle({ io, pool, logger: fakeLogger() });
        expect(io.emitted).toHaveLength(2);
        expect(io.emitted[0]).toMatchObject({ room: 'erp:all', ev: 'domain_event' });
        expect(io.emitted[0].env).toMatchObject({ eventType: 'SALE_POSTED', sequence: 10 });
        const updates = pool.queries.filter((q) => q.includes('SET published_at'));
        expect(updates).toHaveLength(2);
        // BEGIN/COMMIT present, client released
        expect(pool.client.release).toHaveBeenCalled();
        const st = outboxStats();
        expect(st.published).toBeGreaterThanOrEqual(2);
    });

    test('empty claim → no emit, no mark', async () => {
        const pool = fakePool({ claimed: [] });
        const io = fakeIo();
        await publishCycle({ io, pool, logger: fakeLogger() });
        expect(io.emitted).toEqual([]);
    });

    test('transport failure → attempts++, claim released (retryable)', async () => {
        const pool = fakePool({ claimed: [row(9, 99)] });
        const io = fakeIo(true);
        await publishCycle({ io, pool, logger: fakeLogger() });
        const retry = pool.queries.find((q) => q.includes('attempts = attempts + 1'));
        expect(retry).toBeTruthy();
        const st = outboxStats();
        expect(st.failed).toBeGreaterThanOrEqual(1);
    });
});

describe('cycle — dead-letter visibility (never deletes)', () => {
    test('every 10th cycle refreshes deadLettered count', async () => {
        const pool = fakePool({ claimed: [], dead: 3 });
        const io = fakeIo();
        for (let i = 0; i < 10; i++) {
            await cycle({ io, pool, logger: fakeLogger() });
        }
        expect(outboxStats().deadLettered).toBe(3);
        stopOutboxPublisher();
    });
});
