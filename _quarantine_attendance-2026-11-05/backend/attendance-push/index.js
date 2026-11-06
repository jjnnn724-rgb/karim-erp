'use strict';

/**
 * attendance-push/index.js — module entry (mirrors backend/zkteco/index.js usage).
 */

const { router } = require('./routes');
const { ensureAttendancePushSchema } = require('./schema');
const { processQueueRow } = require('./processor');

let _timer = null;

/**
 * Embedded fallback consumer inside the API process.
 * Runs ONLY when ATTENDANCE_PUSH_EMBEDDED !== 'false' (default ON, 10s, batch 10).
 * Safe: rows are claimed atomically, so it never double-processes with worker.js.
 */
function startEmbeddedPoller(io) {
    if (_timer) {return;}
    if (String(process.env.ATTENDANCE_PUSH_EMBEDDED || 'true').toLowerCase() === 'false') {return;}
    const ms = Math.max(5000, Number(process.env.ATTENDANCE_PUSH_POLL_MS) || 10000);
    const { pool } = require('../shared-pool');
    const { logger } = require('../logger');
    _timer = setInterval(async () => {
        try {
            const { rows } = await pool.query(
                `SELECT id FROM attendance_push_queue WHERE status='queued' ORDER BY queued_at LIMIT 10`);
            for (const r of rows) {
                try { await processQueueRow(r.id, io); } catch (err) { logger.debug('[attendance-push] row skipped: ' + err.message); }
            }
        } catch (e) { logger.warn('[attendance-push] embedded poll skipped: ' + e.message); }
    }, ms);
    if (typeof _timer.unref === 'function') {_timer.unref();}
}

function stopEmbeddedPoller() {
    if (_timer) {clearInterval(_timer); _timer = null;}
}

module.exports = { router, ensureAttendancePushSchema, startEmbeddedPoller, stopEmbeddedPoller };
