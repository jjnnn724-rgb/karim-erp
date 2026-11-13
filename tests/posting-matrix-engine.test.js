/**
 * tests/posting-matrix-engine.test.js — Automated Unit & Regression Tests for Posting Engine
 * ══════════════════════════════════════════════════════════════════════════════════════════
 * Verifies mathematical precision, debit=credit balance, and idempotency guarantees.
 *
 * ملاحظة المعمارية: `postJournal` يفتح معاملته على pool الحقيقي (DB) متى
 * مرّر له كائن بلا `.release` — لذا كانت محاكاة `mockPool` لا تُجدي أصلًا
 * ويفشل أي تشغيل بنفس المرجع على قاعدة معدّلة. الحل: تشغيل كل الحالات على
 * قاعدة الاختبار المعزولة بوسم جولة فريد (RUN) + تنظيف موسوم عبر بوابة 136.
 */
'use strict';

const { pool } = require('../backend/shared-pool');
const {
    round2,
    postPosCashSale,
    postDeliveryPlatformSale,
    postFactoryTransfer,
} = require('../backend/posting-matrix-engine');

describe('PostingMatrixEngine — Unit & Integrity Tests', () => {
    // وسم الجولة — كل مراجع القيد تسبقه وتُنظَّف بدالته عبر بوابة الحذف المرخّصة.
    const RUN = `pm_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`;

    const cleanup = async () => {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            await client.query("SET LOCAL coa.allow_hard_delete = 'on'");
            await client.query(
                `DELETE FROM journal_lines WHERE entry_id IN
                 (SELECT id FROM journal_entries WHERE source_id LIKE $1)`,
                [`${RUN}%`],
            );
            await client.query('DELETE FROM journal_ledger_audit WHERE entry_id IN (SELECT id FROM journal_entries WHERE source_id LIKE $1)', [`${RUN}%`]).catch(() => {});
            await client.query('DELETE FROM journal_entries WHERE source_id LIKE $1', [`${RUN}%`]);
            await client.query('COMMIT');
        } catch (_) {
            await client.query('ROLLBACK').catch(() => {});
        } finally {
            client.release();
        }
    };

    beforeAll(async () => {
        // fixture: مركزا التكلفة اللذان تتكلمان عنهما الحالات.
        await pool.query(`INSERT INTO cost_centers (code, name_ar)
                          VALUES ('MAIN', 'MAIN'), ('FACTZZ', 'FACTZZ')
                          ON CONFLICT (code) DO NOTHING`);
        await cleanup();
    });

    afterAll(async () => {
        await cleanup();
    });

    test('round2 handles cents and floats accurately', () => {
        expect(round2(100.004)).toBe(100);
        expect(round2(100.005)).toBe(100.01);
        expect(round2(13.04)).toBe(13.04);
        expect(round2('250.75')).toBe(250.75);
    });

    test('postPosCashSale produces perfectly balanced debits and credits', async () => {
        const res = await postPosCashSale(pool, {
            orderId: `${RUN}-9901`,
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
        const res = await postDeliveryPlatformSale(pool, {
            orderId: `${RUN}-8801`,
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
        const res = await postFactoryTransfer(pool, {
            transferId: `${RUN}-7701`,
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
        const res1 = await postPosCashSale(pool, {
            orderId: `${RUN}-dup`,
            date: '2026-11-03',
            netAmount: 50,
            vatAmount: 7.5,
            costAmount: 20,
        });
        expect(res1.replay).toBe(false);

        // Second post with exact same orderId
        const res2 = await postPosCashSale(pool, {
            orderId: `${RUN}-dup`,
            date: '2026-11-03',
            netAmount: 50,
            vatAmount: 7.5,
            costAmount: 20,
        });
        expect(res2.replay).toBe(true);
    });
});
