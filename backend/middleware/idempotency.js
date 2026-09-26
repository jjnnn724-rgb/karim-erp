/**
 * idempotency.js — Exactly-Once Semantics for Critical Writes
 * ────────────────────────────────────────────────────────────────────────────
 * Big Tech pattern used by Stripe, PayPal, Adyen. Clients send an
 * `X-Idempotency-Key: <uuid>` header on writes (POST/PUT/PATCH/DELETE).
 *
 * Guarantees:
 *   • Retrying the same key with the SAME request body → returns the cached 1st response
 *   • Reusing the same key with a DIFFERENT body → 409 Conflict
 *   • Concurrent inflight requests with the same key → 409 "in_progress"
 *   • Keys expire after TTL (default 24h)
 *   • Storage: Redis first (fast), falls back to Postgres idempotency_keys table
 *
 * Usage:
 *   router.post('/orders', idempotency(), async (req, res) => { ... });
 */

'use strict';

const crypto = require('crypto');
const { IdempotencyError, wrapUnknown } = require('../errors/app-error');
const { logger } = require('../logger');

// ─── Config defaults ───────────────────────────────────────
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000; // 24h
const DEFAULT_INFLIGHT_TTL_MS = 2 * 60 * 1000; // 2min max for "in_progress" lock
const HEADER = 'x-idempotency-key';
const MAX_KEY_LEN = 255;

// ─── In-memory fallback (when Redis + PG are unavailable) ──
// LRU-like: cap at 5000 keys to bound memory.
class MemoryStore {
    constructor(max = 5000) { this.map = new Map(); this.max = max; }
    _evictIfNeeded() {
        if (this.map.size <= this.max) return;
        const oldestKeys = [...this.map.keys()].slice(0, Math.ceil(this.max * 0.2));
        for (const k of oldestKeys) this.map.delete(k);
    }
    async get(key) {
        const v = this.map.get(key);
        if (!v) return null;
        if (v.expiresAt < Date.now()) { this.map.delete(key); return null; }
        return v.value;
    }
    async set(key, value, ttlMs = DEFAULT_TTL_MS) {
        this._evictIfNeeded();
        this.map.set(key, { value, expiresAt: Date.now() + ttlMs });
    }
    async del(key) { this.map.delete(key); }
}

const memoryStore = new MemoryStore();

// ─── Store facade (Redis → PG → Memory) ────────────────────
async function storeGet(redis, pool, key) {
    // Redis fast path
    if (redis) {
        try {
            const v = await redis.get(`idem:${key}`);
            if (v) return JSON.parse(v);
        } catch (e) { logger.warn('[idempotency] redis get failed:', e.message); }
    }
    // PG fallback
    if (pool) {
        try {
            const { rows } = await pool.query(
                `SELECT status, status_code, response_body, request_hash,
                        created_at, locked_until
                   FROM idempotency_keys
                  WHERE key = $1 AND (expires_at IS NULL OR expires_at > NOW())
                  LIMIT 1`,
                [key]
            );
            if (rows[0]) {
                const r = {
                    status:       rows[0].status,
                    statusCode:   rows[0].status_code,
                    responseBody: rows[0].response_body,
                    requestHash:  rows[0].request_hash,
                    createdAt:    rows[0].created_at,
                    lockedUntil:  rows[0].locked_until,
                };
                // Re-fill Redis async (read-through)
                if (redis) redis.setex(`idem:${key}`, DEFAULT_TTL_MS / 1000, JSON.stringify(r)).catch(() => {});
                return r;
            }
        } catch (e) { /* table may not exist yet — not critical */ }
    }
    // Memory fallback
    return memoryStore.get(key);
}

async function storeSet(redis, pool, key, value, ttlMs = DEFAULT_TTL_MS) {
    const payload = JSON.stringify(value);
    if (redis) {
        try { await redis.setex(`idem:${key}`, Math.ceil(ttlMs / 1000), payload); }
        catch (e) { logger.warn('[idempotency] redis set failed:', e.message); }
    }
    if (pool) {
        try {
            await pool.query(`
                INSERT INTO idempotency_keys (key, status, status_code, response_body, request_hash, expires_at)
                VALUES ($1, $2, $3, $4::jsonb, $5, NOW() + ($6::bigint || ' ms')::interval)
                ON CONFLICT (key) DO UPDATE
                  SET status       = EXCLUDED.status,
                      status_code  = EXCLUDED.status_code,
                      response_body= EXCLUDED.response_body,
                      request_hash = EXCLUDED.request_hash,
                      expires_at   = EXCLUDED.expires_at,
                      locked_until = NULL
            `, [
                key, value.status, value.statusCode ?? null, value.responseBody ?? null,
                value.requestHash ?? null, ttlMs,
            ]);
        } catch (e) { /* ignore — table might not exist */ }
    }
    await memoryStore.set(key, value, ttlMs);
}

async function storeLock(redis, pool, key, hash, ttlMs = DEFAULT_INFLIGHT_TTL_MS) {
    // Try Redis SET NX first (atomic lock)
    if (redis) {
        try {
            const ok = await redis.set(`idem-lock:${key}`, hash, 'PX', ttlMs, 'NX');
            if (ok === 'OK') return true;
            return false;
        } catch (e) { logger.warn('[idempotency] redis lock failed:', e.message); }
    }
    // PG advisory lock or upsert condition — simpler: try insert in_progress row
    if (pool) {
        try {
            const { rowCount } = await pool.query(`
                INSERT INTO idempotency_keys (key, status, request_hash, locked_until, expires_at)
                VALUES ($1, 'in_progress', $2, NOW() + ($3::bigint || ' ms')::interval,
                                             NOW() + ($4::bigint || ' ms')::interval)
                ON CONFLICT (key) DO NOTHING
            `, [key, hash, ttlMs, DEFAULT_TTL_MS]);
            if (rowCount === 1) return true;
            // Row exists → check if stale lock
            const { rows } = await pool.query(`
                SELECT status, locked_until FROM idempotency_keys WHERE key = $1
            `, [key]);
            if (rows[0]?.status === 'in_progress') {
                const lu = rows[0].locked_until;
                if (!lu || new Date(lu).getTime() < Date.now()) {
                    // Steal stale lock
                    await pool.query(`
                        UPDATE idempotency_keys
                           SET status='in_progress', locked_until = NOW() + ($2::bigint || ' ms')::interval, request_hash = $3
                         WHERE key = $1
                    `, [key, ttlMs, hash]);
                    return true;
                }
                return false;
            }
            return false;
        } catch (e) { /* fall through */ }
    }
    // Memory CAS
    const existing = await memoryStore.get(key);
    if (!existing) {
        await memoryStore.set(key, { status: 'in_progress', requestHash: hash, lockedUntil: Date.now() + ttlMs }, DEFAULT_TTL_MS);
        return true;
    }
    if (existing.status === 'in_progress') {
        if (!existing.lockedUntil || existing.lockedUntil < Date.now()) {
            await memoryStore.set(key, { status: 'in_progress', requestHash: hash, lockedUntil: Date.now() + ttlMs }, DEFAULT_TTL_MS);
            return true;
        }
        return false;
    }
    return false;
}

function hashRequest(body) {
    const h = crypto.createHash('sha256');
    h.update(typeof body === 'string' ? body : JSON.stringify(body ?? null));
    return h.digest('hex');
}

/**
 * Middleware factory.
 * @param {object} opts
 * @param {number} [opts.ttlMs]            Expiry of idempotency keys (default 24h)
 * @param {string[]} [opts.methods]        HTTP methods to protect (default POST/PUT/PATCH/DELETE)
 * @param {boolean} [opts.requireKey]      If true, reject requests missing the header (400)
 */
function idempotency(opts = {}) {
    const {
        ttlMs = DEFAULT_TTL_MS,
        methods = ['POST', 'PUT', 'PATCH', 'DELETE'],
        requireKey = false,
    } = opts;

    return async function idempotencyMiddleware(req, res, next) {
        // ── Bypass: safe methods ────────────────────────
        if (!methods.includes(req.method)) return next();

        const key = req.headers[HEADER];

        // ── No key: bypass or reject ────────────────────
        if (!key) {
            if (requireKey) {
                const { ClientError } = require('../errors/app-error');
                return next(new ClientError('مطلوب إرسال X-Idempotency-Key لهذا الطلب', {
                    statusCode: 400, code: 'IDEMPOTENCY_KEY_REQUIRED',
                }));
            }
            return next();
        }

        // ── Validate key length & characters ────────────
        if (typeof key !== 'string' || key.length > MAX_KEY_LEN || key.length < 1) {
            return next(new IdempotencyError(key, 'conflict'));
        }
        const safeKey = key.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, MAX_KEY_LEN);

        const { pool } = require('./shared-pool');
        let redis = null;
        try {
            const Redis = require('ioredis');
            redis = global.__idempotency_redis || null;
            if (!redis && process.env.REDIS_URL) {
                redis = new Redis(process.env.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 1, enableReadyCheck: false });
                global.__idempotency_redis = redis;
            }
        } catch { /* optional */ }

        const reqHash = hashRequest(req.body);
        try {
            // 1) Read existing record
            const existing = await storeGet(redis, pool, safeKey);
            if (existing) {
                if (existing.status === 'in_progress') {
                    return next(new IdempotencyError(safeKey, 'in_progress'));
                }
                // Completed — compare request hash
                if (existing.requestHash && existing.requestHash !== reqHash) {
                    logger.warn({ event: 'idempotency.conflict', key: safeKey }, 'Idempotency key reused with different body');
                    return next(new IdempotencyError(safeKey, 'conflict'));
                }
                // Cache hit — replay the stored response
                res.setHeader('X-Idempotency-Replay', 'true');
                res.setHeader('X-Idempotency-Key', safeKey);
                if (existing.statusCode) res.status(existing.statusCode);
                if (existing.responseBody) return res.json(existing.responseBody);
                return res.end();
            }

            // 2) Acquire inflight lock
            const locked = await storeLock(redis, pool, safeKey, reqHash);
            if (!locked) {
                return next(new IdempotencyError(safeKey, 'in_progress'));
            }

            // 3) Run downstream handler; intercept res.json / res.end to cache
            const origJson = res.json.bind(res);
            const origEnd  = res.end.bind(res);
            let capturedBody = null;
            let capturedStatus = res.statusCode;

            res.status = function(code) {
                capturedStatus = code;
                return require('express').response.status.call(res, code);
            };
            res.json = function(body) {
                capturedBody = body;
                finalize();
                return origJson(body);
            };
            res.end = function(chunk, enc, cb) {
                if (!capturedBody && chunk) {
                    try { capturedBody = JSON.parse(typeof chunk === 'string' ? chunk : chunk.toString(enc || 'utf8')); }
                    catch { capturedBody = { raw: String(chunk).slice(0, 8192) }; }
                }
                finalize();
                return origEnd(chunk, enc, cb);
            };

            let finalized = false;
            function finalize() {
                if (finalized) return;
                finalized = true;
                const statusCode = res.statusCode || capturedStatus;
                const success = statusCode < 500;
                const record = {
                    status: success ? 'completed' : 'failed',
                    statusCode,
                    responseBody: success ? capturedBody : null, // don't cache 5xx
                    requestHash: reqHash,
                };
                storeSet(redis, pool, safeKey, record, ttlMs).catch(() => {});
            }

            next();
        } catch (raw) {
            next(wrapUnknown(raw, 'idempotency middleware'));
        }
    };
}

/**
 * Create the Postgres idempotency_keys table (idempotent).
 * Run during setup / migrations.
 */
async function ensureIdempotencySchema(pool) {
    if (!pool) return;
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS idempotency_keys (
                key            VARCHAR(255) PRIMARY KEY,
                status         VARCHAR(20)  NOT NULL DEFAULT 'in_progress',
                status_code    INTEGER,
                response_body  JSONB,
                request_hash   VARCHAR(64),
                locked_until   TIMESTAMPTZ,
                created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                expires_at     TIMESTAMPTZ NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_idem_expires ON idempotency_keys(expires_at);
        `);
        // Cleanup ancient keys opportunistically
        await pool.query(`DELETE FROM idempotency_keys WHERE expires_at < NOW() - INTERVAL '7 days'`);
        logger.info('[idempotency] schema ensured');
    } catch (e) {
        logger.warn('[idempotency] schema ensure failed:', e.message);
    }
}

module.exports = { idempotency, ensureIdempotencySchema };
