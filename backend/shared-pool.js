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
            if (!t || t.startsWith('#')) continue;
            const idx = t.indexOf('=');
            if (idx === -1) continue;
            const k = t.slice(0, idx).trim();
            if (k === key) {
                return t.slice(idx + 1).trim().replace(/^["']|["']$/g, '');
            }
        }
    }
    return fallback;
}

const pool = new Pool({
    user: dbEnv('DB_USER', 'postgres'),
    host: dbEnv('DB_HOST', 'localhost'),
    database: dbEnv('DB_NAME', 'karim_erp'),
    password: dbEnv('DB_PASSWORD', ''),
    port: parseInt(dbEnv('DB_PORT', '5432'), 10),
    max: parseInt(process.env.DB_POOL_MAX || '60', 10),
    min: 5,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
    statement_timeout: 30000,
    query_timeout: 30000,
    // حرس مؤسسي: أي معاملة تتركها شيفرة عالقة بلا عبارات تُقتل بعد 15 ثانية
    // حتى لا تمسك الاتصال ولا تمنع autovacuum — الشيفرة لدينا لا تنتظر داخل
    // المعاملات أبدًا (عبارات متتالية)، فالحد لا يمس المسار الطبيعي.
    idle_in_transaction_session_timeout: parseInt(dbEnv('DB_IDLE_TX_TIMEOUT_MS', '15000'), 10),
    keepAlive: true,
    keepAliveInitialDelayMillis: 10000,
});

pool.on('connect', (client) => {
    logger.info('[shared-pool] new DB connection established', { pid: client.processID });
});

pool.on('remove', (client) => {
    logger.warn('[shared-pool] DB connection removed from pool');
});

pool.on('error', (err) => {
    logger.error('[shared-pool] Unexpected error on idle client:', err.message);
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
            return await pool.query(text, params);
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

module.exports = { pool, safeQuery };
