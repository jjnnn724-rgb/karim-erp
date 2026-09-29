'use strict';

/**
 * attendance-push/processor.js — single durable punch processor.
 * Shared by the BullMQ worker AND the SQL-polling fallback so both
 * paths behave identically (dedup 60s → raw log → unified engine).
 */

const { pool } = require('../shared-pool');
const { logger } = require('../logger');

const DEDUP_WINDOW_SEC = Math.max(10, Number(process.env.ATTENDANCE_PUSH_DEDUP_SEC) || 60);

/** Resolve deviceUserId/employeeId → internal employees.id */
async function resolveEmployee({ deviceUserId, employeeId }) {
    if (employeeId) {
        const byId = await pool.query('SELECT id FROM employees WHERE id = $1 LIMIT 1', [employeeId]);
        if (byId.rows[0]) {return byId.rows[0].id;}
    }
    if (deviceUserId) {
        const s = String(deviceUserId).trim();
        const byDuid = await pool.query(
            'SELECT id FROM employees WHERE "deviceUserId" = $1 LIMIT 1', [s]);
        if (byDuid.rows[0]) {return byDuid.rows[0].id;}
        if (/^\d+$/.test(s)) {
            const byNo = await pool.query(
                'SELECT id FROM employees WHERE "employeeId" = $1 OR "deviceUserId" = $2 LIMIT 1',
                [s, String(Number(s))]);
            if (byNo.rows[0]) {return byNo.rows[0].id;}
        }
    }
    return null;
}

/**
 * Process one queue row by id. Idempotent: concurrent callers converge
 * on the row status (queued → processing → done/deduped/failed).
 */
async function processQueueRow(rowId, io) {
    const client = await pool.connect();
    let row;
    try {
        const claimed = await client.query(
            `UPDATE attendance_push_queue SET status='processing', attempts=attempts+1
              WHERE id=$1 AND status IN ('queued','failed') RETURNING *`,
            [rowId]
        );
        row = claimed.rows[0];
        if (!row) {return { skipped: true };}
    } finally {
        client.release();
    }

    try {
        const internalId = row.employee_id || await resolveEmployee({
            deviceUserId: row.device_user_id, employeeId: row.employee_id,
        });
        const punchTime = new Date(row.punch_time);
        if (!Number.isFinite(punchTime.getTime()) || punchTime.getTime() > Date.now() + 7 * 86400000) {
            throw new Error('INVALID_TIMESTAMP');
        }

        // 60s sliding dedup per employee (the target-spec rule).
        if (internalId) {
            const dup = await pool.query(
                `SELECT id FROM attendance_logs
                  WHERE "employeeId" = $1 AND "attendanceTime" > $2 - INTERVAL '1 second' * $3
                  LIMIT 1`,
                [internalId, punchTime.toISOString(), DEDUP_WINDOW_SEC]
            );
            if (dup.rows[0]) {
                await pool.query(
                    `UPDATE attendance_push_queue SET status='deduped', processed_at=NOW() WHERE id=$1`, [row.id]);
                return { deduped: true };
            }
        }

        // Raw log first (idempotent on dedup_key / device punch UNIQUE).
        await pool.query(
            `INSERT INTO attendance_logs
                ("deviceId","deviceUserId","employeeId","attendanceTime","verifyType","punchState",source,raw_payload,dedup_key)
             VALUES ($1,$2,$3,$4,$5,$6,'push',$7,$8)
             ON CONFLICT DO NOTHING`,
            [row.deviceId, row.device_user_id || '', internalId,
             punchTime.toISOString(), row.verify_type || 2, row.punch_state || 0,
             row.raw_payload, row.dedup_key]
        );

        // Unified daily attendance via the existing engine (fill-only, never overwrites manual/QR).
        if (internalId) {
            const { engine, BUSINESS_TZ_OFFSET_MS } = require('../attendance-engine');
            const shifted = new Date(punchTime.getTime() + BUSINESS_TZ_OFFSET_MS);
            const pad2 = (n) => String(n).padStart(2, '0');
            const wall = {
                year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1, day: shifted.getUTCDate(),
                hour: shifted.getUTCHours(), minute: shifted.getUTCMinutes(),
                date: `${shifted.getUTCFullYear()}-${pad2(shifted.getUTCMonth() + 1)}-${pad2(shifted.getUTCDate())}`,
                time: `${pad2(shifted.getUTCHours())}:${pad2(shifted.getUTCMinutes())}`,
            };
            const result = await engine.processPunch({
                employeeId: internalId, punchState: row.punch_state || 0,
                instant: punchTime, wall, device: { id: row.deviceId }, source: 'push',
            });
            if (io && result && result.action) {
                io.emit('attendance:updated', {
                    action: result.action, source: 'push',
                    employee: { id: internalId }, record: result.record || null,
                });
            }
        }

        await pool.query(
            `UPDATE attendance_push_queue SET status='done', processed_at=NOW(), last_error=NULL WHERE id=$1`, [row.id]);
        return { done: true, employeeId: internalId };
    } catch (e) {
        await pool.query(
            `UPDATE attendance_push_queue SET status='failed', last_error=$2 WHERE id=$1`,
            [row.id, String(e.message).slice(0, 500)]
        ).catch(() => {});
        logger.warn('[attendance-push] row failed: ' + e.message);
        throw e;
    }
}

module.exports = { processQueueRow, resolveEmployee, DEDUP_WINDOW_SEC };
