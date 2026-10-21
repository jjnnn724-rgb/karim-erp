/**
 * shared-pool.js — Shared PostgreSQL connection pool (no circular deps)
 * ────────────────────────────────────────────────────────────────────────────
 * Single source of truth for the DB pool. Both server.js and cashier-module/db-pool.js
 * import from here instead of from each other.
 *
 * v4.7.0 Resilience:
 *   • TCP keepAlive on sockets (survives NAT/idle drops)
 *   • safeQuery() — automatic retry of transient DB failures
 */
const { logger } = require('./logger');
const { Pool } = require('pg');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

// ─── DB config resolver ──────────────────────────────────
// Uses process.env first (allows override by injected environment),
// then falls back to reading .env file directly for values that were
// persisted to disk but not yet in process.env (e.g., DB_PORT auto-fixed
// by setup scripts during the same boot cycle).
function dbEnv(key, fallback) {
    if (process.env[key] !== undefined && process.env[key] !== '') {
        return process.env[key];
    }
    const fs = require('fs');
    const envFile = path.join(__dirname, '..', '.env');
    if (fs.existsSync(envFile)) {
        const lines = fs.readFileSync(envFile, 'utf-8').split('\n');
        for (const line of lines) {
            const t = line.trim();
            if (!t || t.startsWith('#')) {continue;}
            const idx = t.indexOf('=');
            if (idx === -1) {continue;}
            const k = t.slice(0, idx).trim();
            if (k === key) {
                return t.slice(idx + 1).trim().replace(/^["']|["']$/g, '');
            }
        }
    }
    return fallback;
}

// FIX 2026-10-11 (M22): pool is now mutable — after DB restore, pg_terminate_backend
// kills all connections but the Pool object still holds dead sockets. reinitPool()
// creates a fresh Pool so the server doesn't need a full restart.
let _pool = new Pool({
    user: dbEnv('DB_USER', 'postgres'),
    host: dbEnv('DB_HOST', 'localhost'),
    database: dbEnv('DB_NAME', 'karim_erp'),
    password: dbEnv('DB_PASSWORD', ''),
    port: parseInt(dbEnv('DB_PORT', '5432'), 10),
    // PERF-7: max reduced 60→20 — Postgres default max_connections=100;
    // 60/process exhausts it under any concurrent load. 20 queues politely.
    max: parseInt(process.env.DB_POOL_MAX || '20', 10),
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
    statement_timeout: 30000,
    query_timeout: 30000,
    idle_in_transaction_session_timeout: parseInt(dbEnv('DB_IDLE_TX_TIMEOUT_MS', '15000'), 10),
    keepAlive: true,
    keepAliveInitialDelayMillis: 10000,
});

function _attachPoolHandlers(p) {
    p.on('connect', (client) => {
        logger.info('[shared-pool] new DB connection established', { pid: client.processID });
        // FIX 2026-10-19: عميلٌ مأخوذ من الـpool قد يبثّ 'error' بعد قطع الاتصال
        // (Connection terminated unexpectedly)؛ وبلا مستمع يتحوّل الحدث إلى
        // uncaughtException يُسقط الخادم كله. مستمعٌ دائم لكل عميل يجعل القطع
        // حدثًا مُعالَجًا يتعافى منه الـpool بدل أن يقتل العملية.
        client.on('error', (err) => {
            logger.warn('[shared-pool] client socket error (absorbed):', err && err.message);
        });
    });
    p.on('remove', () => {
        // إغلاق اتصالٍ خامل بعد idleTimeout حدثٌ طبيعي — لا يُرفع إلى warn
        // وإلا غطّى على الأعطال الحقيقية في السجل.
        logger.debug('[shared-pool] idle connection closed');
    });
    p.on('error', (err) => {
        logger.error('[shared-pool] Unexpected error on idle client:', err.message);
    });
}
_attachPoolHandlers(_pool);

/** Re-initialize the pool (after DB restore). Returns when new pool is ready. */
async function reinitPool() {
    const old = _pool;
    _pool = new Pool({
        user: dbEnv('DB_USER', 'postgres'),
        host: dbEnv('DB_HOST', 'localhost'),
        database: dbEnv('DB_NAME', 'karim_erp'),
        password: dbEnv('DB_PASSWORD', ''),
        port: parseInt(dbEnv('DB_PORT', '5432'), 10),
        max: parseInt(process.env.DB_POOL_MAX || '20', 10),
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 10000,
        statement_timeout: 30000,
        query_timeout: 30000,
        idle_in_transaction_session_timeout: parseInt(dbEnv('DB_IDLE_TX_TIMEOUT_MS', '15000'), 10),
        keepAlive: true,
        keepAliveInitialDelayMillis: 10000,
    });
    _attachPoolHandlers(_pool);
    // Test the new pool
    await _pool.query('SELECT 1');
    // Drain old pool (best-effort)
    try { await old.end(); } catch (_) { /* best-effort: الخطأ لا يوقف المسار */ }
    logger.info('[shared-pool] pool re-initialized after restore');
    return _pool;
}

// Proxy so all existing `pool.query(...)` calls transparently use the current pool
const pool = new Proxy({}, {
    get(_, prop) {
        if (prop === 'query' || prop === 'connect' || prop === 'end' || prop === 'on') {
            return _pool[prop].bind(_pool);
        }
        if (prop === 'totalCount' || prop === 'idleCount' || prop === 'waitingCount') {
            return _pool[prop];
        }
        return _pool[prop];
    },
});

// ─── Transient error codes (safe to retry) ─────────────────────────────────
const TRANSIENT_CODES = new Set([
    'ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EPIPE', 'EHOSTUNREACH', 'ENETUNREACH',
    '08000', '08003', '08006',          // connection_exception / does_not_exist / failure
    '57P01', '57P02', '57P03',          // admin_shutdown / crash_shutdown / cannot_connect_now
    '40001', '40P01',                    // serialization_failure / deadlock_detected
]);

/**
 * safeQuery — runs a query with automatic retry on transient failures.
 * Retries up to `retries` times with exponential backoff (300ms, 600ms...).
 * Non-transient errors (syntax, constraints, etc.) throw immediately.
 */
async function safeQuery(text, params = [], retries = 2) {
    let lastErr;
    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            return await _pool.query(text, params);
        } catch (err) {
            lastErr = err;
            const transient = TRANSIENT_CODES.has(err.code) || /connection terminated|socket hang up|server closed the connection/i.test(err.message || '');
            if (!transient || attempt === retries) {throw err;}
            const waitMs = 300 * Math.pow(2, attempt);
            logger.warn(`[shared-pool] transient DB error (${err.code || err.message}) — retry ${attempt + 1}/${retries} in ${waitMs}ms`);
            await new Promise(r => setTimeout(r, waitMs));
        }
    }
    throw lastErr;
}

module.exports = { pool, safeQuery, reinitPool };
