const {
    tryInsertDomainEvent,
    resetTablePresence,
} = require('../backend/realtime/outbox');

describe('transactional outbox optional writes', () => {
    beforeEach(() => resetTablePresence());

    test('rolls back a failed optional insert to its savepoint and leaves the transaction usable', async () => {
        const queries = [];
        const client = {
            query: jest.fn(async (sql) => {
                queries.push(sql);
                if (sql.startsWith('INSERT INTO event_outbox')) {
                    throw Object.assign(new Error('synthetic outbox failure'), { code: 'XX000' });
                }
                return { rows: [] };
            }),
        };
        const pool = { query: jest.fn(async () => ({ rows: [{ t: 'event_outbox' }] })) };

        const result = await tryInsertDomainEvent(pool, client, {
            eventType: 'SALE_POSTED',
            aggregateType: 'sale',
            aggregateId: 'order-1',
        });

        expect(result).toBeNull();
        expect(queries[0]).toMatch(/^SAVEPOINT outbox_optional_/);
        expect(queries).toContainEqual(expect.stringMatching(/^ROLLBACK TO SAVEPOINT outbox_optional_/));
        expect(queries).toContainEqual(expect.stringMatching(/^RELEASE SAVEPOINT outbox_optional_/));
        expect(client.query).toHaveBeenCalledTimes(4);
    });
});
