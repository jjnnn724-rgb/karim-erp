'use strict';

/**
 * attendance-push/worker.js — durable consumer for attendance-push jobs.
 * Run as a separate process: `node backend/attendance-push/worker.js`
 * Dual mode (same as zatca-worker):
 *   - BullMQ Worker when Redis is up (SKIP_BULLMQ != true)
 *   - SQL polling every 5s otherwise (offline LAN safe)
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });
const { pool } = require('../shared-pool');
const { logger } = require('../logger');
const { processQueueRow } = require('./processor');
const { PUSH_QUEUE_NAME, SKIP_BULLMQ } = require('./queue');

const POLL_MS = Math.max(2000, Number(process.env.ATTENDANCE_PUSH_POLL_MS) || 5000);
const BATCH = Math.max(1, Math.min(50, Number(process.env.ATTENDANCE_PUSH_BATCH) || 10));

async function pollOnce() {
    const { rows } = await pool.query(
        `SELECT id FROM attendance_push_queue
          WHERE status = 'queued' ORDER BY queued_at LIMIT $1`,
        [BATCH]
    ).catch((e) => { logger.warn('[attendance-push] poll failed: ' + e.message); return { rows: [] }; });
    for (const r of rows) {
        try { await processQueueRow(r.id, null); }
        catch (_) { /* already marked failed inside processor */ }
    }
}

let workerStarted = false;
if (!SKIP_BULLMQ) {
    try {
        const { Worker } = require('bullmq');
        const IORedis = require('ioredis');
        const connection = new IORedis(process.env.REDIS_URL || 'redis://localhost:6379', {
            maxRetriesPerRequest: null,
        });
        connection.on('error', (e) => logger.warn('[attendance-push-worker] redis: ' + e.message));
        const { pool: _p } = require('../shared-pool');
        void _p;
        const pushWorker = new Worker(PUSH_QUEUE_NAME, async (job) => {
            // Job carries dedupKey; resolve the SQL row and process it once.
            const key = job.data && job.data.dedupKey;
            if (!key) {return;}
            const found = await pool.query(
                'SELECT id FROM attendance_push_queue WHERE dedup_key = $1 LIMIT 1', [key]);
            if (found.rows[0]) {await processQueueRow(found.rows[0].id, null);}
        }, { connection, concurrency: Number(process.env.ATTENDANCE_PUSH_CONCURRENCY) || 5 });
        pushWorker.on('completed', (j) => logger.info('[attendance-push-worker] done ' + j.id));
        pushWorker.on('failed', (j, err) => logger.error('[attendance-push-worker] failed ' + (j && j.id) + ': ' + err.message));
        workerStarted = true;
        logger.info('[attendance-push-worker] BullMQ mode');
    } catch (e) {
        logger.warn('[attendance-push-worker] BullMQ unavailable, SQL polling only: ' + e.message);
    }
}

logger.info(`[attendance-push-worker] SQL polling every ${POLL_MS}ms (batch ${BATCH})`);
setInterval(() => { pollOnce().catch(() => {}); }, POLL_MS).unref();
pollOnce().catch(() => {});
