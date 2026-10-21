'use strict';

const net = require('net');
const { once } = require('events');
const { attemptPrint } = require('../backend/cashier-module/print-worker');

function createClient(printer) {
    const queries = [];
    return {
        queries,
        async query(sql, values) {
            queries.push({ sql, values });
            if (sql === 'SELECT * FROM pos_printers;') {
                return { rows: [printer] };
            }
            return { rows: [] };
        },
    };
}

describe('print worker delivery lifecycle', () => {
    test('sends the exact binary payload before marking the job printed', async () => {
        const received = [];
        let resolveDelivery;
        const delivered = new Promise((resolve) => { resolveDelivery = resolve; });
        const server = net.createServer((socket) => {
            socket.on('data', (chunk) => received.push(chunk));
            socket.on('end', resolveDelivery);
        });
        server.listen(0, '127.0.0.1');
        await once(server, 'listening');
        const { port } = server.address();
        const payload = Buffer.from([0, 1, 127, 128, 255]);
        const client = createClient({
            id: 'pos-7',
            kind: 'receipt',
            is_online: true,
            connection_type: 'network',
            address: `127.0.0.1:${port}`,
        });

        try {
            await attemptPrint(client, {
                id: 'print-job-success',
                printer_id: 'pos-7',
                payload,
                attempts: 1,
            });
            await delivered;
            expect(Buffer.concat(received)).toEqual(payload);
            expect(client.queries.some(({ sql }) => sql.includes("status='printed'"))).toBe(true);
            expect(client.queries.some(({ sql }) => sql.includes('SET is_online = true'))).toBe(true);
        } finally {
            server.close();
            await once(server, 'close');
        }
    });

    test('keeps a failed delivery queued with an explicit retry and backoff', async () => {
        const probe = net.createServer();
        probe.listen(0, '127.0.0.1');
        await once(probe, 'listening');
        const { port } = probe.address();
        probe.close();
        await once(probe, 'close');

        const client = createClient({
            id: 'pos-7',
            kind: 'receipt',
            is_online: true,
            connection_type: 'network',
            address: `127.0.0.1:${port}`,
        });

        await attemptPrint(client, {
            id: 'print-job-failure',
            printer_id: 'pos-7',
            payload: Buffer.from('receipt'),
            attempts: 2,
        });

        const failedUpdate = client.queries.find(({ sql }) => sql.includes("status='failed'"));
        expect(failedUpdate).toBeDefined();
        expect(failedUpdate.values[0]).toBe('print-job-failure');
        expect(failedUpdate.values[2]).toBe(4000);
        expect(client.queries.some(({ sql }) => sql.includes('SET is_online = false'))).toBe(true);
        expect(client.queries.some(({ sql }) => sql.includes("status='printed'"))).toBe(false);
    });
});
