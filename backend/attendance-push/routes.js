'use strict';

/**
 * attendance-push/routes.js — Push ingress (FAST 202 path, no heavy work here).
 *   POST /api/v1/attendance/push   (device Bearer) — ZKTeco/Hikvision compatible
 *   GET  /api/v1/attendance/status (admin/hr/manager) — queue health
 *   POST /api/v1/attendance/devices/:id/token (admin/hr) — issue Bearer token
 */

const express = require('express');
const { z } = require('zod');
const { pool } = require('../shared-pool');
const { jwtAuth, requireRole } = require('../cashier-module/jwt-middleware');
const { deviceAuth, issueDeviceToken } = require('./device-auth');
const { enqueuePush } = require('./queue');

const router = express.Router();

// ZKTeco/Hikvision-compatible payload. employee_id accepts deviceUserId
// ("12", "0123") or the internal numeric id; timestamp accepts ISO or epoch.
const pushSchema = z.object({
    device_id: z.coerce.number().int().positive(),
    employee_id: z.union([z.string().min(1).max(64), z.number().int().positive()]),
    timestamp: z.union([z.string().min(1), z.number()]),
    verify_type: z.coerce.number().int().min(0).max(20).default(2),
    punch_state: z.coerce.number().int().min(0).max(9).default(0),
}).strict();

function parseTime(v) {
    if (typeof v === 'number' && Number.isFinite(v)) {
        const ms = v < 1e12 ? v * 1000 : v; // epoch seconds → ms
        return new Date(ms);
    }
    return new Date(String(v));
}

/** POST /push — device ingress. Always fast: validate → persist → 202. */
router.post('/push', deviceAuth, async (req, res, next) => {
    try {
        const parsed = pushSchema.safeParse(req.body || {});
        if (!parsed.success) {
            return res.status(422).json({
                error: 'PUSH_INVALID',
                message: 'Invalid push payload',
                details: (parsed.error.errors || []).map((e) => ({
                    field: Array.isArray(e.path) ? e.path.join('.') : 'unknown',
                    message: e.message,
                })),
            });
        }
        const { device_id: bodyDeviceId, employee_id, timestamp, verify_type, punch_state } = parsed.data;

        // A token is bound to ONE device: body must match the token's device.
        if (Number(bodyDeviceId) !== Number(req.pushDevice.id)) {
            return res.status(403).json({ error: 'DEVICE_MISMATCH', message: 'Token does not belong to device_id' });
        }
        const dev = await pool.query(
            'SELECT id FROM attendance_devices WHERE id = $1 AND enabled = TRUE LIMIT 1', [bodyDeviceId]);
        if (!dev.rows[0]) {
            return res.status(404).json({ error: 'DEVICE_NOT_FOUND', message: 'Unknown or disabled device' });
        }

        const punchTime = parseTime(timestamp);
        if (!Number.isFinite(punchTime.getTime())) {
            return res.status(422).json({ error: 'PUSH_BAD_TIME', message: 'Unparseable timestamp' });
        }

        const deviceUserId = String(employee_id).trim();
        const dedupKey = `${bodyDeviceId}:${deviceUserId}:${Math.floor(punchTime.getTime() / 1000)}:${punch_state}`;
        await enqueuePush({
            dedupKey,
            deviceId: Number(bodyDeviceId),
            deviceUserId,
            employeeId: /^\d+$/.test(deviceUserId) && deviceUserId.length > 6 ? Number(deviceUserId) : null,
            punchTime: punchTime.toISOString(),
            verifyType: Number(verify_type),
            punchState: Number(punch_state),
            rawPayload: req.body || {},
        });
        res.status(202).json({ ok: true, queued: true, dedup_key: dedupKey });
    } catch (e) { next(e); }
});

/** GET /status — queue health for managers (no device token needed, JWT instead). */
router.get('/status', jwtAuth, requireRole('admin', 'hr', 'manager'), async (req, res, next) => {
    try {
        const q = await pool.query(
            `SELECT status, COUNT(*)::int AS n FROM attendance_push_queue
              WHERE queued_at > NOW() - INTERVAL '24 hours' GROUP BY status`);
        const byStatus = {};
        for (const r of q.rows) {byStatus[r.status] = r.n;}
        const redis = String(process.env.SKIP_BULLMQ) === 'true' ? 'disabled(sql-fallback)' : 'enabled';
        res.json({ ok: true, queue: 'attendance-push', redis, last24h: byStatus });
    } catch (e) { next(e); }
});

/** POST /devices/:id/token — issue (rotate) a Bearer token for a device. */
router.post('/devices/:id/token', jwtAuth, requireRole('admin', 'hr'), async (req, res, next) => {
    try {
        const deviceId = Number(req.params.id);
        const dev = await pool.query('SELECT id, name FROM attendance_devices WHERE id = $1 LIMIT 1', [deviceId]);
        if (!dev.rows[0]) {return res.status(404).json({ error: 'DEVICE_NOT_FOUND' });}
        const raw = await issueDeviceToken(deviceId, String(req.body?.name || 'push-token').slice(0, 100));
        res.status(201).json({
            ok: true, device_id: deviceId,
            token: raw,
            warning: 'Store this token on the device now — it cannot be retrieved again (hash only).',
        });
    } catch (e) { next(e); }
});

module.exports = { router };
