/**
 * tests/posting-matrix-engine.test.js — Automated Unit & Regression Tests for Posting Engine
 * ══════════════════════════════════════════════════════════════════════════════════════════
 * Verifies mathematical precision, debit=credit balance, and idempotency guarantees.
 */
'use strict';

const {
    round2,
    postPosCashSale,
    postPosCardSale,
    postDeliveryPlatformSale,
    postFactoryTransfer,
    postPurchaseInvoice,
    postWasteAdjustment,
    postMonthlyDepreciation,
} = require('../backend/posting-matrix-engine');

describe('PostingMatrixEngine — Unit & Integrity Tests', () => {
    let mockPool;
    let postedEntries;

    beforeEach(() => {
        postedEntries = [];
        mockPool = {
            query: jest.fn(async (text, params) => {
                if (text.includes('SELECT code FROM chart_of_accounts')) {
                    // All requested codes are valid & postable
                    return { rows: params[0].map(c => ({ code: c })) };
                }
                if (text.includes('SELECT code FROM cost_centers')) {
                    return { rows: [{ code: 'MAIN' }, { code: 'FACTZZ' }] };
                }
                if (text.includes('SELECT id, entry_no FROM journal_entries WHERE source_type = $1 AND source_id = $2')) {
                    const existing = postedEntries.find(e => e.source_type === params[0] && e.source_id === params[1]);
                    return { rows: existing ? [existing] : [] };
                }
                if (text.includes('INSERT INTO journal_entries')) {
                    const entry = { id: 1001, entry_no: params[1], source_type: params[4], source_id: params[5] };
                    postedEntries.push(entry);
                    return { rows: [entry] };
                }
                if (text.includes('INSERT INTO journal_lines')) {
                    return { rows: [{ id: 5001 }] };
                }
                return { rows: [] };
            }),
        };
    });

    test('round2 handles cents and floats accurately', () => {
        expect(round2(100.004)).toBe(100);
        expect(round2(100.005)).toBe(100.01);
        expect(round2(13.04)).toBe(13.04);
        expect(round2('250.75')).toBe(250.75);
    });

    test('postPosCashSale produces perfectly balanced debits and credits', async () => {
        const res = await postPosCashSale(mockPool, {
            orderId: 'ORD-9901',
            date: '2026-11-03',
            netAmount: 100,
            vatAmount: 15,
            costAmount: 40,
            costCenter: 'MAIN',
        });

        expect(res.replay).toBe(false);
        const lines = res.lines;
        const totalDebit = lines.reduce((s, l) => s + l.debit, 0);
        const totalCredit = lines.reduce((s, l) => s + l.credit, 0);
        expect(totalDebit).toBe(totalCredit);
        expect(totalDebit).toBe(155); // 115 gross cash + 40 cogs
    });

    test('postDeliveryPlatformSale isolates platform commission and receivables', async () => {
        const res = await postDeliveryPlatformSale(mockPool, {
            orderId: 'DEL-8801',
            platformName: 'Jahez',
            date: '2026-11-03',
            grossSale: 200,
            commission: 30,
            vatAmount: 26.09,
            costCenter: 'MAIN',
        });

        expect(res.replay).toBe(false);
        const lines = res.lines;
        const totalDebit = lines.reduce((s, l) => s + l.debit, 0);
        const totalCredit = lines.reduce((s, l) => s + l.credit, 0);
        expect(Math.abs(totalDebit - totalCredit)).toBeLessThan(0.01);

        // Check receivable is 200 - 30 = 170
        const arLine = lines.find(l => l.account_code === '1310');
        expect(arLine.debit).toBe(170);

        // Check commission is 30 in expense 6420
        const commLine = lines.find(l => l.account_code === '6420');
        expect(commLine.debit).toBe(30);
    });

    test('postFactoryTransfer records revenue for factory and cost burden for outlet', async () => {
        const res = await postFactoryTransfer(mockPool, {
            transferId: 'TR-7701',
            date: '2026-11-03',
            totalValue: 500,
            factoryDept: 'FACTZZ',
            outletDept: 'MAIN',
            memoText: 'عصير برتقال طازج',
        });

        expect(res.replay).toBe(false);
        const lines = res.lines;
        expect(lines).toHaveLength(2);
        expect(lines[0].account_code).toBe('5000');
        expect(lines[0].debit).toBe(500);
        expect(lines[0].cost_center_code).toBe('MAIN');

        expect(lines[1].account_code).toBe('4000');
        expect(lines[1].credit).toBe(500);
        expect(lines[1].cost_center_code).toBe('FACTZZ');
    });

    test('Idempotency prevents duplicate posting of same source transaction', async () => {
        // First post
        const res1 = await postPosCashSale(mockPool, {
            orderId: 'ORD-DUP-01',
            date: '2026-11-03',
            netAmount: 50,
            vatAmount: 7.5,
            costAmount: 20,
        });
        expect(res1.replay).toBe(false);

        // Second post with exact same orderId
        const res2 = await postPosCashSale(mockPool, {
            orderId: 'ORD-DUP-01',
            date: '2026-11-03',
            netAmount: 50,
            vatAmount: 7.5,
            costAmount: 20,
        });
        expect(res2.replay).toBe(true);
    });
});
