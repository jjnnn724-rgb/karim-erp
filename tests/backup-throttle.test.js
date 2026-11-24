'use strict';
/** عقود نقية لمانع طوفان النسخ الاحتياطية — بلا قاعدة وبلا خادم. */
const { createBackupThrottle, BACKUP_MIN_INTERVAL_MS } = require('../backend/backup-throttle');

function harness() {
    let now = 1_000_000;
    const timers = [];
    const spawns = [];
    const logger = { error: jest.fn() };
    const throttle = createBackupThrottle({
        logger,
        nowFn: () => now,
        setTimeoutFn: (fn, ms) => {
            const timer = { fn, ms, fired: false };
            timers.push(timer);
            timer.fire = () => { timer.fired = true; fn(); };
            return timer;
        },
        spawnFn: () => {
            const child = { unref: jest.fn(), on: jest.fn() };
            spawns.push(child);
            return child;
        },
    });
    return {
        throttle,
        advance: (ms) => { now += ms; },
        timers,
        spawns,
        logger,
    };
}

describe('backup-throttle', () => {
    test('النافذة 15 ثانية', () => {
        expect(BACKUP_MIN_INTERVAL_MS).toBe(15000);
    });

    test('أول طلب يشغّل نسخة فورًا', () => {
        const h = harness();
        h.throttle.scheduleBackup();
        expect(h.spawns).toHaveLength(1);
        expect(h.timers).toHaveLength(0);
        expect(h.throttle.state().lastBackupAt).toBe(1_000_000);
        expect(h.spawns[0].unref).toHaveBeenCalledTimes(1);
    });

    test('طلب داخل النافذة يُجدول مرة واحدة فقط', () => {
        const h = harness();
        h.throttle.scheduleBackup();
        h.advance(1000);
        h.throttle.scheduleBackup();
        h.throttle.scheduleBackup();
        expect(h.spawns).toHaveLength(1);
        expect(h.timers).toHaveLength(1);
        expect(h.timers[0].ms).toBe(14000);
    });

    test('عند انقضاء المؤقت تُنفّذ نسخة واحدة', () => {
        const h = harness();
        h.throttle.scheduleBackup();
        h.advance(1000);
        h.throttle.scheduleBackup();
        h.advance(14000);
        h.timers[0].fire();
        expect(h.spawns).toHaveLength(2);
        expect(h.throttle.state().pending).toBe(false);
    });

    test('بعد النافذة يعود الطلب فوريًا بلا مؤقت', () => {
        const h = harness();
        h.throttle.scheduleBackup();
        h.advance(16000);
        h.throttle.scheduleBackup();
        expect(h.spawns).toHaveLength(2);
        expect(h.timers).toHaveLength(0);
    });
});
