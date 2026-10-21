const mockPool = { query: jest.fn() };
jest.mock('../backend/cashier-module/db-pool', () => ({ pool: mockPool }));

const {
    appendLegacyRevenueMirror,
    resolveRecipeStockAvailability,
    syncErpRevenueFromPosSale,
} = require('../backend/cashier-module/complete-sale');

describe('POS ERP revenue projection atomicity', () => {
    afterEach(() => mockPool.query.mockReset());

    test('permits recipe consumption from the main warehouse when kitchen fallback is enabled', () => {
        expect(resolveRecipeStockAvailability({
            required: 2,
            consumptionLocationId: 10,
            consumptionAvailable: 0.5,
            mainLocationId: 1,
            mainAvailable: 5,
            allowFallback: true,
        })).toBe(5);
    });

    test('does not combine partial locations or fall back when disabled or same-location', () => {
        const input = {
            required: 2,
            consumptionLocationId: 10,
            consumptionAvailable: 1,
            mainLocationId: 1,
            mainAvailable: 1.5,
            allowFallback: true,
        };

        expect(resolveRecipeStockAvailability(input)).toBe(1);
        expect(resolveRecipeStockAvailability({ ...input, allowFallback: false })).toBe(1);
        expect(resolveRecipeStockAvailability({ ...input, mainLocationId: 10 })).toBe(1);
    });

    test('keeps the configured kitchen as source when it has enough stock', () => {
        expect(resolveRecipeStockAvailability({
            required: 2,
            consumptionLocationId: 10,
            consumptionAvailable: 3,
            mainLocationId: 1,
            mainAvailable: 0,
            allowFallback: true,
        })).toBe(3);
    });

    test('rejects a sale with an unmapped POS department', async () => {
        const client = { query: jest.fn().mockResolvedValue({ rows: [] }) };

        await expect(syncErpRevenueFromPosSale(client, {
            orderId: 'order-1',
            orderRow: { department_id: 9 },
            totals: { line_items: [] },
            cashier: { id: 3 },
            requestId: 'request-1',
        })).rejects.toThrow('refusing to issue a sale without its ERP revenue mapping');

        expect(client.query).toHaveBeenCalledTimes(1);
    });

    test('propagates revenue persistence failures so the enclosing sale transaction rolls back', async () => {
        const client = {
            query: jest.fn()
                .mockResolvedValueOnce({ rows: [{ id: 9, code: 'restaurant', name_ar: 'Restaurant', legacy_dept_code: 'restaurant' }] })
                .mockRejectedValueOnce(Object.assign(new Error('synthetic database failure'), { code: 'XX000' })),
        };

        await expect(syncErpRevenueFromPosSale(client, {
            orderId: 'order-2',
            orderRow: {
                department_id: 9,
                created_at: '2026-10-20T10:00:00.000Z',
                invoice_counter: 1002,
                total_amount: 120,
            },
            totals: { line_items: [] },
            cashier: { id: 3, name: 'Cashier' },
            requestId: 'request-2',
        })).rejects.toThrow('synthetic database failure');

        expect(client.query).toHaveBeenCalledTimes(2);
    });

    test('reuses the persisted revenue id when an idempotent insert finds an existing sale', async () => {
        const client = {
            query: jest.fn()
                .mockResolvedValueOnce({ rows: [{ id: 9, code: 'restaurant', name_ar: 'Restaurant', legacy_dept_code: 'restaurant' }] })
                .mockResolvedValueOnce({ rows: [] })
                .mockResolvedValueOnce({ rows: [{ id: 'existing-revenue-1' }] }),
        };

        const result = await syncErpRevenueFromPosSale(client, {
            orderId: 'order-4',
            orderRow: {
                department_id: 9,
                created_at: '2026-10-20T10:00:00.000Z',
                invoice_counter: 1004,
                total_amount: 120,
            },
            totals: { line_items: [] },
            cashier: { id: 3, name: 'Cashier' },
            requestId: 'request-4',
        });

        expect(result.revenueId).toBe('existing-revenue-1');
        expect(result.legacyMirror.id).toBe('existing-revenue-1');
        expect(client.query).toHaveBeenCalledTimes(3);
    });

    test('appends the legacy revenue mirror atomically with idempotency and a fixed 300-row cap', async () => {
        mockPool.query.mockResolvedValue({ rowCount: 1, rows: [{ id: 1 }] });
        const mirror = { pos: { order_id: 'order-3' }, amount: 120 };

        await expect(appendLegacyRevenueMirror(mirror)).resolves.toBe(true);

        const [sql, params] = mockPool.query.mock.calls[0];
        expect(sql).toContain('INSERT INTO app_state AS current_state');
        expect(sql).toContain('ON CONFLICT (id) DO UPDATE');
        expect(sql).toContain("existing.item #>> '{pos,order_id}' = $1::text");
        expect(sql).toContain('LIMIT $3');
        expect(params).toEqual(['order-3', JSON.stringify(mirror), 299]);
    });

    test('does not append a duplicate legacy mirror', async () => {
        mockPool.query.mockResolvedValue({ rowCount: 0, rows: [] });

        await expect(appendLegacyRevenueMirror({ pos: { order_id: 'order-3' } })).resolves.toBe(false);
        expect(mockPool.query).toHaveBeenCalledTimes(1);
    });
});
