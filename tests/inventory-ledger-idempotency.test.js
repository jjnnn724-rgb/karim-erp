const { postInventoryLedgerEntry } = require('../backend/inventory-ledger');

describe('postInventoryLedgerEntry idempotency race', () => {
    test('uses a non-aborting conflict path and replays the committed ledger row', async () => {
        const committedEntry = { id: 'ledger-existing', idempotency_key: 'sale:order-1:inventory:1' };
        const responses = [
            { rows: [] },
            { rows: [{ id: 1, name: 'Ingredient', unit: 'kg', qty: 10, avg_cost: 2 }] },
            { rows: [] },
            { rows: [{ id: 2, negative_stock_policy: 'deny' }] },
            { rows: [{ count: 1 }] },
            { rows: [] },
            { rows: [{ on_hand: 10 }] },
            { rows: [] },
            { rows: [committedEntry] },
        ];
        const queries = [];
        const client = {
            query: jest.fn(async (sql) => {
                queries.push(sql);
                const response = responses.shift();
                if (!response) { throw new Error(`Unexpected query: ${sql}`); }
                return response;
            }),
        };

        const result = await postInventoryLedgerEntry(client, {
            transactionType: 'sale_consumption',
            inventoryId: 1,
            locationId: 2,
            quantityDelta: -1,
            idempotencyKey: 'sale:order-1:inventory:1',
        });

        expect(result).toEqual({ ledger: committedEntry, replay: true });
        expect(queries.some(sql => sql.includes('ON CONFLICT ON CONSTRAINT inventory_ledger_idempotency_unique DO NOTHING'))).toBe(true);
        expect(queries.some(sql => sql.includes('UPDATE inventory_location_balances'))).toBe(false);
        expect(responses).toHaveLength(0);
    });
});
