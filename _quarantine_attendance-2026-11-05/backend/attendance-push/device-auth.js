'use strict';

/**
 * attendance-push/device-auth.js — per-device Bearer authentication.
 * Tokens are stored as SHA-256 hashes only. Fail-closed (401) by default.
 */

const crypto = require('crypto');
const { pool } = require('../shared-pool');

function sha256(token) {
    return crypto.createHash('sha256').update(String(token), 'utf8').digest('hex');
}

/**
 * Express middleware: requires `Authorization: Bearer <device-token>`.
 * On success sets req.pushDevice = { id, name }.
 */
async function deviceAuth(req, res, next) {
    try {
        const header = req.headers.authorization || '';
        const match = header.match(/^Bearer\s+(.+)$/i);
        if (!match) {
            return res.status(401).json({ error: 'DEVICE_TOKEN_REQUIRED', message: 'Missing Bearer device token' });
        }
        const hash = sha256(match[1].trim());
        const { rows } = await pool.query(
            `SELECT d.id, d.name, t.id AS token_id
               FROM attendance_device_tokens t
               JOIN attendance_devices d ON d.id = t."deviceId"
              WHERE t.token_hash = $1 AND t.revoked = FALSE
                AND (t.expires_at IS NULL OR t.expires_at > NOW())
                AND d.enabled = TRUE
              LIMIT 1`,
            [hash]
        );
        if (!rows[0]) {
            return res.status(401).json({ error: 'DEVICE_TOKEN_INVALID', message: 'Invalid or revoked device token' });
        }
        req.pushDevice = { id: rows[0].id, name: rows[0].name, tokenId: rows[0].token_id };
        pool.query(`UPDATE attendance_device_tokens SET last_used_at = NOW() WHERE id = $1`, [rows[0].token_id]).catch(() => {});
        next();
    } catch (e) {
        next(e);
    }
}

/** Issue a new raw token for a device (admin only). Returns the RAW token once. */
async function issueDeviceToken(deviceId, name) {
    const raw = crypto.randomBytes(32).toString('hex');
    const hash = sha256(raw);
    await pool.query(
        `INSERT INTO attendance_device_tokens ("deviceId", token_hash, name) VALUES ($1,$2,$3)`,
        [deviceId, hash, name || null]
    );
    return raw;
}

module.exports = { deviceAuth, issueDeviceToken, sha256 };
