/**
 * correlation.js — Request Identity & Tracing Middleware
 * ────────────────────────────────────────────────────────────────────────────
 * Enterprise-grade request correlation:
 *   • X-Request-Id / X-Correlation-Id / X-Trace-Id — accepts all 3 common names
 *   • Generates opaque IDs when missing (k-ordered, time-sortable)
 *   • Propagates via AsyncLocalStorage → appears in every log & DB query comment
 *   • Echoes back in X-Request-Id response header
 *   • Populates OpenTelemetry-style traceparent when present
 *
 * This means you can open a support ticket, ask the user for the
 * `X-Request-Id` from their browser network tab, and grep for it
 * instantly across every log line, DB slow-query log, and external
 * HTTP call made during that single request.
 */

'use strict';

const { AsyncLocalStorage } = require('async_hooks');
const crypto = require('crypto');

// ─── Store shared across ALL async descendants of a request ─
const store = new AsyncLocalStorage();

// ─── ID generation (CUID-like / ULID-inspired, zero dependencies) ──
const BASE36 = '0123456789abcdefghijklmnopqrstuvwxyz';
function b36(len) {
    const bytes = crypto.randomBytes(Math.ceil(len * 0.6));
    let out = '';
    for (const b of bytes) out += BASE36[b % 36];
    return out.slice(0, len);
}
function makeRequestId() {
    const t = Date.now().toString(36);
    return `req_${t}_${b36(6)}_${b36(4)}`;
}
function makeTraceId() {
    return crypto.randomBytes(16).toString('hex');
}
function makeSpanId() {
    return crypto.randomBytes(8).toString('hex');
}

/**
 * Parse W3C traceparent header.
 * format: "00-{traceid_32hex}-{spanid_16hex}-{flags_2hex}"
 */
function parseTraceParent(header) {
    if (!header || typeof header !== 'string') return null;
    const parts = header.split('-');
    if (parts.length < 4) return null;
    const [version, traceId, parentSpanId, traceFlags] = parts;
    if (version !== '00') return null;
    if (!/^[0-9a-f]{32}$/i.test(traceId)) return null;
    if (!/^[0-9a-f]{16}$/i.test(parentSpanId)) return null;
    return {
        version,
        traceId: traceId.toLowerCase(),
        parentSpanId: parentSpanId.toLowerCase(),
        sampled: (parseInt(traceFlags, 16) & 0x01) === 1,
    };
}

/**
 * Express middleware — installs request identity + async context.
 * Mount VERY early, before any routing or logging.
 */
function correlationMiddleware(options = {}) {
    const {
        headerNames = [
            'x-request-id',
            'x-correlation-id',
            'x-trace-id',
        ],
        echoHeader = 'X-Request-Id',
    } = options;

    return (req, res, next) => {
        // ─── 1. Read or create requestId ──────────────
        let requestId = null;
        for (const h of headerNames) {
            const v = req.headers[h];
            if (typeof v === 'string' && v.length > 0 && v.length < 256) {
                requestId = v;
                break;
            }
        }
        if (!requestId) requestId = makeRequestId();

        // Sanitize (prevent log injection / header-splitting)
        requestId = String(requestId).replace(/[\r\n\t\s"'\\]/g, '_').slice(0, 200);
        req.requestId = requestId;

        // ─── 2. W3C trace context ──────────────────────
        const w3c = parseTraceParent(req.headers['traceparent']);
        const traceId = w3c?.traceId ?? makeTraceId();
        const spanId  = makeSpanId();
        const sampled = w3c?.sampled ?? (Math.random() < parseFloat(process.env.TRACE_SAMPLE_RATE || '0.1'));

        // ─── 3. Echo headers so clients & CDNs have it ─
        res.setHeader(echoHeader, requestId);
        res.setHeader('X-Trace-Id', traceId);
        res.setHeader('X-Span-Id', spanId);

        // If traceparent came in, respond with it (tracestate)
        if (w3c) {
            const flags = sampled ? '01' : '00';
            res.setHeader('Traceparent', `00-${traceId}-${spanId}-${flags}`);
        }

        // ─── 4. Attach short-cut getters to req ────────
        req.traceId   = traceId;
        req.spanId    = spanId;
        req.traceCtx  = { requestId, traceId, spanId, sampled };

        // Attach a helper that prefixes SQL comments with request identity
        // → usage: `pool.query(req.sqlComment('get_user') + 'SELECT ...')`
        req.sqlComment = (label = '') => {
            const safeLabel = String(label).replace(/[^a-zA-Z0-9_-]/g, '_');
            return `/* ${safeLabel || 'req'} request=${requestId} trace=${traceId} user=${req.user?.id || 'anon'} */ `;
        };

        // ─── 5. Run rest of request inside AsyncLocalStorage
        // so ANY deep async code can read the context without
        // threading `req` through 15 function calls.
        store.run({
            requestId,
            traceId,
            spanId,
            sampled,
            userId:    null,
            userRole:  null,
            method:    req.method,
            url:       req.originalUrl,
            ip:        req.ip || req.connection?.remoteAddress,
            startTs:   Date.now(),
        }, () => {
            // Once user is authenticated, call updateUserContext() to fill userId/role
            next();
        });
    };
}

/**
 * Returns the current request context (anywhere in the stack), or null
 * when called outside a request (startup jobs, workers, tests).
 */
function getContext() {
    try {
        return store.getStore() || null;
    } catch {
        return null;
    }
}

/**
 * Call this after JWT auth to enrich the async store with user info.
 *   if (user) updateUserContext({ id: user.id, role: user.role });
 */
function updateUserContext(userCtx) {
    const ctx = getContext();
    if (ctx && userCtx) {
        if (userCtx.id)   ctx.userId   = userCtx.id;
        if (userCtx.role) ctx.userRole = userCtx.role;
    }
}

/**
 * Return an SQL comment string usable in raw queries — works
 * both inside requests (from AsyncLocalStorage) and outside
 * (falls back to a static label).
 */
function sqlComment(label = 'job') {
    const ctx = getContext();
    if (!ctx) return `/* ${label} */ `;
    return `/* ${label} request=${ctx.requestId} user=${ctx.userId || 'anon'} */ `;
}

/**
 * Produce a log-safe object with current trace context.
 *   logger.info({ ...currentTraceFields(), msg: 'something happened' })
 */
function currentTraceFields() {
    const ctx = getContext();
    if (!ctx) return {};
    return {
        requestId: ctx.requestId,
        traceId:   ctx.traceId,
        spanId:    ctx.spanId,
        userId:    ctx.userId,
        durationMs: Date.now() - ctx.startTs,
    };
}

module.exports = {
    correlationMiddleware,
    getContext,
    updateUserContext,
    sqlComment,
    currentTraceFields,
    makeRequestId,
    makeTraceId,
    makeSpanId,
    AsyncLocalStorage: store, // for tests / advanced users
};
