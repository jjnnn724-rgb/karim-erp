'use strict';

/**
 * attendance-push/queue.js — BullMQ queue with SQL-mirror fallback.
 * Mirrors backend/cashier-module/zatca-queue.js discipline:
 *   BullMQ is OPTIONAL. SQL table attendance_push_queue is the source of truth.
 */

const { logger } = require('../logger');

let Queue;
let connection = null;
let pushQueue = null;
let SKIP_BULLMQ = process.env.SKIP_BULLMQ === '1' || process.env.SKIP_BULLMQ === 'true';

if (!SKIP_BULLMQ) {
    try {
        ({ Queue } = require('bullmq'));
        const IORedis = require('ioredis');
        const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
        connection = new IORedis(REDIS_URL, { maxRetriesPerRequest: null, enableReadyCheck: true });
        connection.on('error', (e) => logger.warn('[attendance-push] redis error: ' + e.message));
        pushQueue = new Queue('attendance-push', {
            connection,
            defaultJobOptions: {
                attempts: 5,
                backoff: { type: 'exponential', delay: 1000 },
                removeOnComplete: { count: 5000, age: 86400 },
                removeOnFail: { count: 5000, age: 7 * 86400 },
            },
        });
        logger.info('[attendance-push] BullMQ connected to ' + REDIS_URL);
    } catch (err) {
        logger.warn('[attendance-push] BullMQ unavailable, SQL-only mode: ' + err.message);
        SKIP_BULLMQ = true;
    }
}

const { pool } = require('../shared-pool');

/**
 * Persist to SQL mirror first (durable), then BullMQ if available.
 * @returns {Promise<{dedupKey:string, queued:boolean}>}
 */
async function enqueuePush(job) {
    const client = await pool.connect();
    try {
        await client.query(
            `INSERT INTO attendance_push_queue
                (dedup_key, "deviceId", device_user_id, employee_id, punch_time, verify_type, punch_state, raw_payload, status)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'queued')
             ON CONFLICT (dedup_key) DO NOTHING`,
            [job.dedupKey, job.deviceId, job.deviceUserId, job.employeeId,
             job.punchTime, job.verifyType, job.punchState, job.rawPayload]
        );
    } finally {
        client.release();
    }
    if (!SKIP_BULLMQ && pushQueue) {
        try {
            await pushQueue.add('ingest', job, { jobId: job.dedupKey });
        } catch (e) {
            if (!/already exist/i.test(e.message || '')) {
                logger.error('[attendance-push] enqueue failed (SQL mirror ok): ' + e.message);
            }
        }
    }
    return { dedupKey: job.dedupKey, queued: true };
}

module.exports = { pushQueue, connection, SKIP_BULLMQ, enqueuePush, PUSH_QUEUE_NAME: 'attendance-push' };
