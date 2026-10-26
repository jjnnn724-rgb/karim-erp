const { logger } = require("../logger");
/**
 * zatca-queue.js — BullMQ queue for async ZATCA Phase-2 invoice reporting.
 * ────────────────────────────────────────────────────────────────────────────
 * BullMQ is OPTIONAL — if Redis is unavailable, the SQL mirror table
 * pos_zatca_invoice_queue provides durable storage. The worker can be
 * run as a separate process (`node backend/cashier-module/zatca-worker.js`).
 *
 * If you don't want to install Redis, set SKIP_BULLMQ=1 in .env and the
 * system will rely solely on the SQL queue + a polling worker.
 */

let Queue, IORedis;
let connection;
let zatcaQueue = null;
let dlqQueue = null;
// `let` — the catch below flips this flag at runtime when BullMQ/Redis fails
// to load; a `const` here made the fallback itself crash the process.
let SKIP_BULLMQ = process.env.SKIP_BULLMQ === '1' || process.env.SKIP_BULLMQ === 'true';

if (!SKIP_BULLMQ) {
    try {
        ({ Queue } = require('bullmq'));
        IORedis = require('ioredis');
        const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
        connection = new IORedis(REDIS_URL, { maxRetriesPerRequest: null, enableReadyCheck: true });
        zatcaQueue = new Queue('zatca-reporting', {
            connection,
            defaultJobOptions: {
                attempts: 10,
                backoff: { type: 'exponential', delay: 2_000 },
                removeOnComplete: { count: 1000, age: 86400 },
                removeOnFail:     { count: 5000, age: 7 * 86400 },
            },
        });
        dlqQueue = new Queue('zatca-dlq', { connection });
        logger.info('[pos-zatca-queue] BullMQ connected to', REDIS_URL);
    } catch (err) {
        logger.warn('[pos-zatca-queue] BullMQ unavailable, falling back to SQL-only queue:', err.message);
        SKIP_BULLMQ = true;
    }
}

const { pool } = require('./db-pool');

/**
 * Enqueue a ZATCA reporting job. Idempotent (same orderId → no duplicate).
 * Always inserts/updates the SQL mirror; if BullMQ is up, also enqueues.
 */
async function enqueueZatcaReporting({ orderId, priority = 1 }) {
    const client = await pool.connect();
    try {
        await client.query(
            `INSERT INTO pos_zatca_invoice_queue (order_id, status, attempts, next_retry_at)
             VALUES ($1, 'queued', 0, CURRENT_TIMESTAMP)
             ON CONFLICT (order_id) DO UPDATE
                SET status = CASE WHEN pos_zatca_invoice_queue.status = 'reported' THEN pos_zatca_invoice_queue.status ELSE 'queued' END,
                    next_retry_at = CURRENT_TIMESTAMP;`,
            [orderId]
        );
    } finally {
        client.release();
    }

    if (!SKIP_BULLMQ && zatcaQueue) {
        try {
            await zatcaQueue.add(
                'report-invoice',
                { orderId, enqueuedAt: new Date().toISOString() },
                { jobId: `zatca:${orderId}`, priority }
            );
        } catch (e) {
            if (!/Job already exist/i.test(e.message)) {
                logger.error('[pos-zatca-queue] enqueue failed (SQL mirror still ok):', e.message);
            }
        }
    }
}

/**
 * Sweeper: re-enqueue stale SQL-queued rows. Run every 5 min via cron.
 */
async function sweepStaleZatcaJobs() {
    const client = await pool.connect();
    try {
        const result = await client.query(
            `SELECT order_id FROM pos_zatca_invoice_queue
              WHERE status = 'queued'
                AND queued_at < CURRENT_TIMESTAMP - INTERVAL '5 minutes'
              LIMIT 100;`
        );
        for (const row of result.rows) {
            try { await enqueueZatcaReporting({ orderId: row.order_id }); }
            catch (e) { logger.error('[pos-zatca-sweeper] failed for', row.order_id, e.message); }
        }
    } finally {
        client.release();
    }
}

setInterval(() => {
    sweepStaleZatcaJobs().catch(e => logger.error('[pos-zatca-sweeper] error:', e.message));
}, 5 * 60 * 1000).unref();

module.exports = {
    zatcaQueue, dlqQueue,
    enqueueZatcaReporting, sweepStaleZatcaJobs,
    SKIP_BULLMQ,
    ZATCA_QUEUE_NAME: 'zatca-reporting',
    ZATCA_DLQ_NAME:   'zatca-dlq',
};
