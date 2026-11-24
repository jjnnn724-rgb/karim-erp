'use strict';
/**
 * backup-throttle — منع طوفان النسخ الاحتياطية عند طلبات متتالية.
 * مُستخلص من server.js حرفيًا: نسخة كل 15 ثانية كحد أقصى، وأي طلب داخل
 * النافذة يُجدول مرة واحدة فقط (لا عمليات spawn متعددة).
 * الحالة داخلية بالكامل — لا تعتمد على المتغيرات العامة للخادم.
 */
const { spawn } = require('child_process');
const path = require('path');

const BACKUP_MIN_INTERVAL_MS = 15_000;

/**
 * @param {{
 *   logger?:any,
 *   backupScript?:string,
 *   minIntervalMs?:number,
 *   spawnFn?:Function,
 *   nowFn?:Function,
 *   setTimeoutFn?:Function,
 * }} [opts]
 */
function createBackupThrottle(opts = {}) {
    const logger = opts.logger || console;
    const backupScript = opts.backupScript
        || path.resolve(__dirname, '..', 'database', 'scripts', 'backup.js');
    const minIntervalMs = opts.minIntervalMs ?? BACKUP_MIN_INTERVAL_MS;
    const spawnFn = opts.spawnFn || spawn;
    const nowFn = opts.nowFn || Date.now;
    const setTimeoutFn = opts.setTimeoutFn || setTimeout;

    let lastBackupAt = 0;
    /** @type {any} */
    let pendingTimer = null;

    function runBackup() {
        lastBackupAt = nowFn();
        try {
            const child = spawnFn(process.execPath, [backupScript], {
                detached: true,
                stdio: 'ignore',
                windowsHide: true,
            });
            child.unref();
            child.on('error', (/** @type {any} */ e) => {
                logger.error('[backup-spawn] error:', e.message);
            });
        } catch (/** @type {any} */ e) {
            logger.error('Failed to trigger backup (non-critical):', e.message);
        }
    }

    function scheduleBackup() {
        const elapsed = nowFn() - lastBackupAt;
        if (elapsed < minIntervalMs) {
            if (pendingTimer) {return;}
            pendingTimer = setTimeoutFn(() => {
                pendingTimer = null;
                runBackup();
            }, minIntervalMs - elapsed);
            return;
        }
        runBackup();
    }

    return {
        scheduleBackup,
        runBackup,
        state: () => ({ lastBackupAt, pending: Boolean(pendingTimer) }),
    };
}

module.exports = { createBackupThrottle, BACKUP_MIN_INTERVAL_MS };
