/**
 * error-handler.js — Global Error Handling Middleware
 * ────────────────────────────────────────────────────────────────────────────
 * Big Tech patterns for error normalization in Express:
 *   1. Catches EVERYTHING (synchronous throws, async rejections, event emitters)
 *   2. Normalizes unknowns via wrapUnknown()
 *   3. Always produces a CONSISTENT JSON shape
 *   4. Structured logging with correlation id + full cause chain
 *   5. Sentry-like telemetry hooks (extendable)
 *   6. Graceful shutdown escalation on unrecoverable DB/infra errors
 *
 * Response shape (guaranteed for ALL non-2xx responses):
 *   {
 *     "error": {
 *       "id":        "err_xxx",            // unique, searchable in logs
 *       "code":      "NOT_FOUND",          // machine-readable
 *       "status":    404,                  // HTTP status
 *       "timestamp": "2026-01-01T00:00:00.000Z",
 *       "message":   "User (123) غير موجود",
 *       "details":  { ... }               // only for 4xx validation
 *     },
 *     "requestId": "req_xxx"              // for support tickets
 *   }
 */

'use strict';

const { logger, securityLog } = require('../logger');
const {
    AppError,
    wrapUnknown,
    isAppError,
    isServerError,
    isDatabaseError,
    ConfigurationError,
} = require('./app-error');

// ─── Map of pg/sql-state → user-friendly arabic message ──
const PG_HUMAN_READABLE = {
    '23505': 'سجل بهذا المعرف موجود مسبقاً',
    '23503': 'لا يمكن حذف / تعديل سجل مرتبط بسجلات أخرى',
    '23502': 'حقل مطلوب مفقود',
    '23514': 'فشل شرط صحة البيانات',
    '42703': 'حقل غير معروف',
    '42P01': 'جدول غير موجود',
};

/**
 * Middleware #1: Attach a "rescue" helper to each route.
 * Use: app.get('/x', async (req, res) => { req.trySafe(...) })
 * Or better: wrap async route handlers to never fall through without next(err).
 */
function attachSafeHelpers(req, res, next) {
    req.wrapError = (raw, hint) => wrapUnknown(raw, hint);
    req.throwSafe = (raw, hint) => { throw wrapUnknown(raw, hint); };
    next();
}

/**
 * Middleware #2: Wrap every async route automatically so a
 * forgotten try/catch still ends up in the global handler.
 *
 * Usage:
 *   router.get('/', asyncHandler(async (req, res) => { ... }));
 */
function asyncHandler(fn) {
    return function asyncHandlerWrap(req, res, next) {
        Promise.resolve(fn(req, res, next)).catch(next);
    };
}

// ══════════════════════════════════════════════════════════
// THE GLOBAL ERROR HANDLER — installed LAST in server.js
// ══════════════════════════════════════════════════════════
function globalErrorHandler(err, req, res, next) {
    // ─── Step 0: normalize to AppError ────────────────
    const error = isAppError(err) ? err : wrapUnknown(err);

    // ─── Step 1: build structured log payload ─────────
    const log = req.log || logger;
    const payload = error.toLogObject();

    if (req) {
        payload.requestId = req.headers['x-request-id'] || req.requestId || null;
        payload.endpoint  = `${req.method} ${req.path}`;
        payload.ip        = req.ip || req.connection?.remoteAddress;
        payload.userId    = req.user?.id   || null;
        payload.userRole  = req.user?.role || null;
    }

    // PG-specific human hints are added to log (not client!)
    if (error.cause?.code && PG_HUMAN_READABLE[error.cause.code]) {
        payload.pgHint = PG_HUMAN_READABLE[error.cause.code];
    }

    // ─── Step 2: choose log level & decide escalation ─
    if (isServerError(error)) {
        log.error(payload, `[5xx] ${error.code} — ${error.message}`);
        // ─── CRITICAL: configuration / total DB outage ───
        if (error instanceof ConfigurationError ||
            (isDatabaseError(error) && !req._dbWarnedOnce)) {
            req._dbWarnedOnce = true;
            log.fatal({ ...payload, fatal: true },
                `💥 FATAL-INFRA — escalation needed: ${error.message}`);
        }
    } else {
        // 4xx — warn (or info for trivial 404s)
        const fn = (error.statusCode === 404 || error.code === 'VALIDATION_ERROR')
            ? 'info'
            : 'warn';
        log[fn](payload, `[${error.statusCode}] ${error.code} — ${error.message}`);

        // Security-sensitive 4xx emit a security event too
        if (['UNAUTHORIZED', 'FORBIDDEN', 'RATE_LIMITED', 'IDEMPOTENCY_CONFLICT'].includes(error.code)) {
            securityLog(`client.${error.code.toLowerCase()}`, {
                errorId: error.errorId,
                status:  error.statusCode,
                message: error.message,
            }, req);
        }
    }

    // ─── Step 3: build response (safe, no leaks) ─────
    const statusCode = error.statusCode || 500;

    // Respect RateLimit 429 Retry-After
    if (error.code === 'RATE_LIMITED' && error.retryAfter) {
        res.setHeader('Retry-After', String(error.retryAfter));
    }
    // Idempotency header echo
    if (req?.headers['x-idempotency-key']) {
        res.setHeader('X-Idempotency-Key', req.headers['x-idempotency-key']);
    }

    // Always include request id in the response header + body
    const requestId = req?.headers['x-request-id'] || req?.requestId || null;
    if (requestId) res.setHeader('X-Request-Id', requestId);
    res.setHeader('X-Error-Id', error.errorId);

    const jsonBody = error.toJSON();
    if (requestId) jsonBody.requestId = requestId;

    // Prevent caching of errors
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.setHeader('Pragma', 'no-cache');

    // ─── Step 4: send ──────────────────────────────────
    if (res.headersSent) {
        // If a partial response already streamed, only append a newline
        // and terminate (can't change headers).
        try { res.end('\n'); } catch {/* already closed */}
        return;
    }
    res.status(statusCode).json(jsonBody);
}

// ══════════════════════════════════════════════════════════
// Process-level catch-alls (process is the "last line of defence")
// ══════════════════════════════════════════════════════════

// Synchronous, append-only crash journal. pino's async transport can lose the
// final FATAL line when we process.exit() immediately after (observed: EXIT
// 1067 with only "error-handler.js:231 / pino transport autoEnd" fragments).
// fs.appendFileSync runs before any exit path, so the root error always
// survives on disk.
const path = require('path');
const fs = require('fs');
const CRASH_LOG = path.join(__dirname, '..', '..', 'logs', 'CRASH.log');
function writeCrashJournal(kind, payload) {
    try {
        fs.mkdirSync(path.dirname(CRASH_LOG), { recursive: true });
        fs.appendFileSync(
            CRASH_LOG,
            `\n===== ${new Date().toISOString()} [${kind}] pid=${process.pid} =====\n` +
            (typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2)) + '\n',
            'utf8'
        );
    } catch {/* journaling must never throw inside a crash path */}
}

function installProcessShields({
    onFatal = null,    // async () => Promise<void> — called before exit
    shutdownTimeoutMs = 10_000,
} = {}) {
    // ─── Unhandled Promise rejections ─────────────────
    // ENTERPRISE STABILITY POLICY (big-company behavior): a single bad
    // request must NEVER kill the server. We journal the evidence
    // synchronously to logs/CRASH.log, log loudly, and KEEP SERVING.
    // (This aligns with graceful-shutdown.js "suppressed — server stays
    // up". The old behavior called process.exit(1) here, which took down
    // ALL clients under load — observed as WinSW EXIT 1067 mid-storm.)
    // Set SHIELD_EXIT_ON_FATAL=true to restore the old hard-exit behavior.
    const exitOnFatal = String(process.env.SHIELD_EXIT_ON_FATAL || '').toLowerCase() === 'true';
    process.on('unhandledRejection', (reason, promise) => {
        const err = wrapUnknown(reason, 'unhandledRejection');
        writeCrashJournal('unhandledRejection', {
            message: err.message, code: err.code, stack: err.stack,
            promise: String(promise),
        });
        logger.fatal({
            ...err.toLogObject(),
            event: 'unhandled_rejection',
            promise: String(promise),
        }, '💥 UNHANDLED PROMISE REJECTION — this is ALWAYS a bug (server stays up)');

        if (exitOnFatal) {triggerFatalShutdown(1, err, onFatal, shutdownTimeoutMs);}
    });

    // ─── Synchronous uncaught exceptions ──────────────
    process.on('uncaughtException', (err, origin) => {
        const appErr = wrapUnknown(err, `uncaughtException (${origin})`);
        writeCrashJournal('uncaughtException', {
            origin, message: appErr.message, code: appErr.code, stack: appErr.stack,
        });
        logger.fatal({
            ...appErr.toLogObject(),
            event: 'uncaught_exception',
            origin,
        }, '💥 UNCAUGHT EXCEPTION — logged + journaled, server stays up');

        if (exitOnFatal) {triggerFatalShutdown(1, appErr, onFatal, shutdownTimeoutMs);}
    });

    // ─── Out of memory / heap OOM (V8 event) ──────────
    if (process.report?.on) {
        process.report.on('diagnostic', (report) => {
            logger.error({ event: 'node_diagnostic_report', report: report.header },
                'Node.js emitted diagnostic report');
        });
    }

    // ─── Memory pressure watchdog ─────────────────────
    let memWarned = false;
    const memInterval = setInterval(() => {
        try {
            const m = process.memoryUsage();
            const rssMB = Math.round(m.rss / 1048576);
            const heapMB  = Math.round(m.heapUsed / 1048576);
            const limitMB = parseInt(process.env.MEM_WARN_MB || '2048', 10);
            if (rssMB > limitMB && !memWarned) {
                memWarned = true;
                logger.warn({
                    event: 'memory_pressure',
                    rssMB, heapMB, limitMB,
                    heapTotalMB: Math.round(m.heapTotal / 1048576),
                    externalMB: Math.round(m.external / 1048576),
                }, `⚠️ Memory pressure: RSS ${rssMB}MB > ${limitMB}MB`);
            } else if (rssMB < limitMB * 0.8) {
                memWarned = false;
            }
        } catch {/* ignore */}
    }, 30_000);
    memInterval.unref();
}

// ─── Escalation helper ───────────────────────────────────
function triggerFatalShutdown(exitCode, err, onFatal, timeoutMs) {
    const timeout = setTimeout(() => {
        logger.error('Fatal shutdown timeout reached — hard exit');
        process.exit(exitCode);
    }, timeoutMs);
    timeout.unref();

    Promise.resolve()
        .then(() => (typeof onFatal === 'function' ? onFatal(err) : null))
        .catch((e) => logger.error({ err: e?.message }, 'fatal shutdown hook errored'))
        .finally(() => process.exit(exitCode));
}

// ══════════════════════════════════════════════════════════
// 404 catch-all (mounted after all real routes)
// ══════════════════════════════════════════════════════════
function notFoundHandler(req, res, next) {
    const { NotFoundError } = require('./app-error');
    next(new NotFoundError('المسار', `${req.method} ${req.originalUrl}`));
}

module.exports = {
    attachSafeHelpers,
    asyncHandler,
    globalErrorHandler,
    installProcessShields,
    notFoundHandler,
};
