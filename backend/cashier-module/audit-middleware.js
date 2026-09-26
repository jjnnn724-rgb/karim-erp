/**
 * audit-middleware.js — Express middleware that populates RLS / audit context
 * for every request, and offers a helper to write explicit audit entries.
 */

const crypto = require('crypto');
const { logger } = require('../logger');
const { pool } = require('./db-pool');

function auditContextMiddleware(req, res, next) {
    req.id = req.headers['x-request-id'] || req.headers['x-correlation-id'] || crypto.randomUUID();
    req.auditCtx = {
        userId: null, userRole: null, userName: null,
        clientIp: req.ip || req.socket.remoteAddress || '',
        requestId: req.id,
    };

    const origEnd = res.end;
    res.end = function (...args) {
        if (req.user) {
            req.auditCtx.userId = req.user.id;
            req.auditCtx.userRole = req.user.role;
            req.auditCtx.userName = req.user.name;
        }
        if (res.statusCode >= 400) {
            logger.warn(JSON.stringify({
                level: 'warn', event: 'http_error',
                request_id: req.id, user_id: req.auditCtx.userId,
                role: req.auditCtx.userRole, ip: req.auditCtx.clientIp,
                method: req.method, url: req.originalUrl,
                status: res.statusCode, ts: new Date().toISOString(),
            }));
        }
        return origEnd.apply(this, args);
    };
    res.setHeader('X-Request-Id', req.id);
    next();
}

async function writeAuditLog({ action, tableName = '', rowPk = null, reason = null, metadata = {}, actor = {} }) {
    const client = await pool.connect();
    try {
        // ⚠️ FIX: SET LOCAL only works inside a transaction. Use BEGIN/COMMIT
        // so the GUC takes effect for the INSERT statement below.
        await client.query('BEGIN;');
        await client.query(`SELECT set_config('app.user_role', 'bg_worker', true);`);
        await client.query(
            `INSERT INTO pos_audit_logs
                (actor_user_id, actor_username, actor_role, actor_ip,
                 action, table_name, row_pk, reason, metadata, request_id)
             VALUES ($1, $2, $3, NULLIF($4,'')::INET, $5, $6, $7, $8, $9::jsonb, $10);`,
            [
                actor.userId || null, actor.userName || null, actor.role || null, actor.ip || '',
                action, tableName, rowPk !== null ? String(rowPk) : null, reason,
                JSON.stringify(metadata), actor.requestId || null,
            ]
        );
        await client.query('COMMIT;');
    } catch (err) {
        try { await client.query('ROLLBACK;'); } catch (_) {}
        throw err;
    } finally {
        client.release();
    }
}

module.exports = { auditContextMiddleware, writeAuditLog };
