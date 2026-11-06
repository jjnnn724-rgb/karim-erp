'use strict';

/**
 * attendance-push/processor.js — single durable punch processor.
 * Shared by the BullMQ worker AND the SQL-polling fallback so both
 * paths behave identically (dedup 60s → raw log → unified engine).
 */

const { pool } = require('../shared-pool');
const { logger } = require('../logger');
const { makeEmitScoped } = require('../realtime/guard');
const { UNKNOWN_PUNCH_STATE } = require('./schema');

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
        // FIX 2026-10-13: نفس عطب `$param - INTERVAL` في attendance-engine — المعامل untyped
        // يُقيَّد interval فتهبط الدفعة كاملة إلى failed. نحسب الحدّ في JS ونمرّره لحظة صريحة.
        // FIX 2026-11-05 (مراجعة خارجية P1): للنافذة حدٌّ أعلى أيضًا — كان الاستعلام يقبل أي
        // بصمة «بعد الحدّ الأدنى» فقط، فبصمة قديمة متأخرة تُرفض كررًة لمجرد وجود بصمة أحدث
        // (بساعات) في القاعدة. المكرّرة الآن = بصمة داخل نافذة ±60 ثانية من لحظة البصمة نفسها.
        if (internalId) {
            const dedupFrom = new Date(punchTime.getTime() - DEDUP_WINDOW_SEC * 1000);
            const dedupTo = new Date(punchTime.getTime() + DEDUP_WINDOW_SEC * 1000);
            const dup = await pool.query(
                `SELECT id FROM attendance_logs
                  WHERE "employeeId" = $1 AND "attendanceTime" > $2 AND "attendanceTime" <= $3
                  LIMIT 1`,
                [internalId, dedupFrom, dedupTo]
            );
            if (dup.rows[0]) {
                await pool.query(
                    `UPDATE attendance_push_queue SET status='deduped', processed_at=NOW() WHERE id=$1`, [row.id]);
                return { deduped: true };
            }
        }

        // الحالة المفقودة لا تُقلَّب «دخولًا»: -1 (المجهول في التخزين — العمود NOT NULL
        // بديل 0 الذي يعني دخولًا فعلًا) يذهب للمحرك كـ null فلا اشتقاق ولا قرار
        // (قرار المالك 2026-11-05): ignore + review والبصمة تبقى خامًا. وحالة صريحة
        // غير معروفة (7…) تذهب كما هي للمراجعة.
        const storedState = row.punch_state == null ? UNKNOWN_PUNCH_STATE : row.punch_state;
        const engineState = storedState === UNKNOWN_PUNCH_STATE ? null : Number(storedState);

        // Raw log first (idempotent on dedup_key / device punch UNIQUE).
        await pool.query(
            `INSERT INTO attendance_logs
                ("deviceId","deviceUserId","employeeId","attendanceTime","verifyType","punchState",source,raw_payload,dedup_key)
             VALUES ($1,$2,$3,$4,$5,$6,'push',$7,$8)
             ON CONFLICT DO NOTHING`,
            [row.deviceId, row.device_user_id || '', internalId,
             punchTime.toISOString(), row.verify_type || 2, storedState,
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
                employeeId: internalId, punchState: engineState,
                instant: punchTime, wall, device: { id: row.deviceId }, source: 'push',
            });
            if (io && result && result.action) {
                makeEmitScoped(io)('attendance:updated', {
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
