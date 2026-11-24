'use strict';

const {
    buildDeadlineAlert,
    buildExpiryAlerts,
    buildIntegrityAlerts,
    dayBucket,
    millisecondsUntilNextRun,
    riyadhDay,
    startComplianceAutomation,
} = require('../backend/compliance-automation');

describe('compliance automation alert builders', () => {
    test('expiry reminders are tiered, bounded, and deduplicated by reminder stage', () => {
        const rows = [
            { kind: 'iqama', employee_id: '10', employee_name: 'موظف', expiry_date: '2026-12-11' },
            { kind: 'contract', employee_id: '11', employee_name: 'موظفة', expiry_date: '2026-11-19' },
            { kind: 'iqama', employee_id: '12', employee_name: 'قديم', expiry_date: '2026-09-01' },
        ];
        const alerts = buildExpiryAlerts(rows, '2026-11-12');
        expect(alerts).toHaveLength(2);
        expect(alerts[0].eventKey).toBe('iqama:10:2026-12-11:30d');
        expect(alerts[1].eventKey).toBe('contract:11:2026-11-19:7d');
        expect(alerts.every((alert) => alert.targetRoles.includes('hr'))).toBe(true);
    });

    test('ZATCA alerts use configured dates and explicitly require official-date verification', () => {
        const alert = buildDeadlineAlert({ id: 8, title: 'إقرار محدد', due_date: '2026-11-19' }, '2026-11-12');
        expect(alert.eventKey).toBe('zatca:8:2026-11-19:7d');
        expect(alert.message).toContain('تحقق من الموعد الرسمي');
        expect(buildDeadlineAlert({ id: 9, title: 'بعد مدة', due_date: '2027-03-01' }, '2026-11-12')).toBeNull();
    });

    test('integrity alerts identify posted entry imbalance and day bucket boundaries', () => {
        expect(buildIntegrityAlerts([{ entry_id: '42', entry_no: 'JE-42', debits: '12.00', credits: '10.00', difference: '2.00' }], '2026-11-12')[0])
            .toMatchObject({ eventKey: 'journal-unbalanced:42:2026-11-12', entityId: '42' });
        expect(buildIntegrityAlerts([{ entry_id: '43', line_count: 1, debits: '0.00', credits: '0.00', difference: '0.00' }], '2026-11-12')[0].message)
            .toContain('عدد السطور 1');
        expect([dayBucket(-1), dayBucket(0), dayBucket(7), dayBucket(8), dayBucket(30), dayBucket(31)]).toEqual([
            'overdue', '7d', '7d', '30d', '30d', '90d',
        ]);
    });
});

describe('Riyadh daily scheduler', () => {
    test('uses Riyadh calendar date and schedules the next 02:15 local check', () => {
        const now = new Date('2026-11-12T00:00:00.000Z');
        expect(riyadhDay(now)).toBe('2026-11-12');
        expect(millisecondsUntilNextRun(now)).toBe(23 * 60 * 60 * 1000 + 15 * 60 * 1000);
        expect(millisecondsUntilNextRun(new Date('2026-11-12T00:00:00.000Z'))).toBeGreaterThan(0);
    });
});

describe('compliance automation lifecycle', () => {
    test('releases its running guard when acquiring a database connection fails', async () => {
        const client = {
            query: jest.fn(async (sql) => sql.includes('pg_try_advisory_lock')
                ? { rows: [{ acquired: true }] }
                : { rows: [] }),
            release: jest.fn(),
        };
        const pool = {
            connect: jest.fn()
                .mockRejectedValueOnce(new Error('database unavailable'))
                .mockResolvedValueOnce(client),
        };
        const worker = startComplianceAutomation({
            pool,
            log: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
            intervalForNextRun: () => 60_000,
        });

        try {
            await expect(worker.runOnce()).rejects.toThrow('database unavailable');
            await expect(worker.runOnce()).resolves.toMatchObject({ unbalanced: 0 });
            expect(pool.connect).toHaveBeenCalledTimes(2);
            expect(client.release).toHaveBeenCalledTimes(1);
        } finally {
            worker.stop();
        }
    });
});
