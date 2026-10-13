/**
 * app-error.js — Enterprise-Grade Error Classes
 * ────────────────────────────────────────────────────────────────────────────
 * Hierarchical error system following Big Tech patterns (Google / Stripe / AWS):
 *
 *  ┌───────────────────────────────────────────────────────┐
 *  │  AppError (base class, all errors inherit from it)    │
 *  │   ├─ ClientError (4xx, user's fault)                 │
 *  │   │   ├─ ValidationError   (400 — bad input)         │
 *  │   │   ├─ UnauthorizedError (401 — bad credentials)   │
 *  │   │   ├─ ForbiddenError    (403 — no permission)     │
 *  │   │   ├─ NotFoundError     (404 — resource missing)  │
 *  │   │   ├─ ConflictError     (409 — duplicate/race)    │
 *  │   │   ├─ RateLimitError    (429 — too many requests) │
 *  │   │   └─ IdempotencyError  (409 / 422)               │
 *  │   │                                                     │
 *  │   └─ ServerError (5xx, our fault)                    │
 *  │       ├─ DatabaseError    (DB failure)               │
 *  │       ├─ ExternalApiError (3rd-party failure)        │
 *  │       └─ ConfigurationError                          │
 *  └───────────────────────────────────────────────────────┘
 *
 * Usage:
 *   throw new NotFoundError('User', userId);
 *   throw new ValidationError('email', 'must be valid');
 *   throw new DatabaseError(queryName, originalError);
 */

'use strict';

// ─── Symbols for private fields (avoids collision) ────────
const _code = Symbol('code');
const _statusCode = Symbol('statusCode');
const _public = Symbol('public');
const _context = Symbol('context');
const _cause = Symbol('cause');
const _timestamp = Symbol('timestamp');
const _errorId = Symbol('errorId');

// ─── UUID generator (zero-dep, no external imports) ──────
function makeErrorId() {
    const t = Date.now().toString(36);
    const r1 = Math.random().toString(36).slice(2, 10);
    const r2 = Math.random().toString(36).slice(2, 10);
    return `err_${t}_${r1}${r2}`;
}

// ══════════════════════════════════════════════════════════
// BASE CLASS — every error thrown inside this ERP extends this
// ══════════════════════════════════════════════════════════
class AppError extends Error {
    /**
     * @param {string} message  Human-readable message (for logs / devs)
     * @param {object} opts
     * @param {number} opts.statusCode       HTTP status (default 500)
     * @param {string} opts.code             Machine-readable code (e.g. "USER_NOT_FOUND")
     * @param {object} opts.context          Structured context for logging (query params, IDs, etc.)
     * @param {Error}  opts.cause            Wrapped original error (for chaining)
     * @param {boolean} opts.isPublic        If true, `message` is safe to send to client (default false)
     */
    constructor(message, opts = {}) {
        super(message);
        Error.captureStackTrace(this, this.constructor);
        this.name = this.constructor.name;

        this[_statusCode] = opts.statusCode ?? 500;
        this[_code]       = opts.code       ?? 'INTERNAL_ERROR';
        this[_context]    = opts.context    ?? {};
        this[_cause]      = opts.cause      ?? null;
        this[_public]     = opts.isPublic   ?? false;
        this[_timestamp]  = new Date().toISOString();
        this[_errorId]    = makeErrorId();
    }

    // ─── Immutable getters ───────────────────────────────
    get statusCode() { return this[_statusCode]; }
    get code()       { return this[_code]; }
    get context()    { return { ...this[_context] }; }
    get cause()      { return this[_cause]; }
    get isPublic()   { return this[_public]; }
    get timestamp()  { return this[_timestamp]; }
    get errorId()    { return this[_errorId]; }
    get isServerError() { return this[_statusCode] >= 500; }
    get isClientError() { return this[_statusCode] >= 400 && this[_statusCode] < 500; }

    /**
     * Produce a safe payload to return to the HTTP client.
     * Never leaks stack traces or internal details.
     */
    toJSON() {
        const payload = {
            error: {
                id:        this[_errorId],
                code:      this[_code],
                status:    this[_statusCode],
                timestamp: this[_timestamp],
            },
        };
        if (this[_public]) {
            payload.error.message = this.message;
        } else if (this.isClientError) {
            payload.error.message = this.message;
        } else {
            // Server errors — generic message to avoid information disclosure
            payload.error.message = 'حدث خطأ داخلي في النظام. يرجى المحاولة مرة أخرى.';
        }
        if (this.isClientError && Object.keys(this[_context]).length > 0) {
            payload.error.details = this[_context];
        }
        return payload;
    }

    /**
     * Rich structured record for log aggregation.
     * Includes cause chain, full context, and stack.
     */
    toLogObject() {
        const cause = this[_cause];
        return {
            errorId:    this[_errorId],
            errorCode:  this[_code],
            statusCode: this[_statusCode],
            timestamp:  this[_timestamp],
            isPublic:   this[_public],
            message:    this.message,
            stack:      this.stack,
            context:    this[_context],
            cause: cause ? {
                name:    cause.name,
                message: cause.message,
                code:    cause.code,
                stack:   cause.stack,
            } : null,
        };
    }
}

// ══════════════════════════════════════════════════════════
// CLIENT ERRORS (4xx)
// ══════════════════════════════════════════════════════════

class ClientError extends AppError {
    constructor(message, opts = {}) {
        super(message, {
            statusCode: 400,
            isPublic: true,
            ...opts,
        });
    }
}

class ValidationError extends ClientError {
    /**
     * @param {string} fieldName       Name of the failing field
     * @param {string|object} message  Validation message, or Zod-like issues array
     * @param {object} [extraContext]
     */
    constructor(fieldName, message, extraContext = {}) {
        const ctx = typeof message === 'object'
            ? { issues: message, ...extraContext }
            : { field: fieldName, reason: message, ...extraContext };

        super(typeof message === 'object' ? 'فشل فحص صحة البيانات المرسلة' : `${fieldName}: ${message}`, {
            statusCode: 400,
            code: 'VALIDATION_ERROR',
            context: ctx,
        });
    }
}

class UnauthorizedError extends ClientError {
    constructor(reason = 'مطلوب تسجيل الدخول', context = {}) {
        super(reason, {
            statusCode: 401,
            code: 'UNAUTHORIZED',
            context,
        });
    }
}

class ForbiddenError extends ClientError {
    constructor(action = 'هذا الإجراء', context = {}) {
        super(`ليست لديك صلاحية ${action}`, {
            statusCode: 403,
            code: 'FORBIDDEN',
            context,
        });
    }
}

class NotFoundError extends ClientError {
    /**
     * @param {string} resource   e.g. "User" or "Order 123"
     * @param {string|number} [identifier]
     */
    constructor(resource, identifier) {
        const msg = identifier
            ? `${resource} (${identifier}) غير موجود`
            : `${resource} غير موجود`;
        super(msg, {
            statusCode: 404,
            code: 'NOT_FOUND',
            context: identifier ? { identifier, resource } : { resource },
        });
    }
}

class ConflictError extends ClientError {
    constructor(resource, reason = 'تعارض في البيانات', context = {}) {
        super(`${resource}: ${reason}`, {
            statusCode: 409,
            code: 'CONFLICT',
            context: { resource, ...context },
        });
    }
}

class RateLimitError extends ClientError {
    constructor(retryAfterSeconds = 60, context = {}) {
        super('تم تجاوز الحد المسموح به من الطلبات. يرجى المحاولة لاحقاً.', {
            statusCode: 429,
            code: 'RATE_LIMITED',
            context: { retryAfterSeconds, ...context },
        });
        this.retryAfter = retryAfterSeconds;
    }
}

class IdempotencyError extends ClientError {
    /**
     * @param {string} key     Idempotency key that was reused
     * @param {string} reason  "in_progress" | "conflict" | "expired"
     */
    constructor(key, reason = 'conflict') {
        const messages = {
            in_progress: 'هذه العملية لا تزال قيد التنفيذ من طلب سابق.',
            conflict:    'تم إستخدام مفتاح العملية مسبقاً بطلب مختلف.',
            expired:     'انتهت صلاحية مفتاح العملية.',
        };
        super(messages[reason] || messages.conflict, {
            statusCode: reason === 'expired' ? 422 : 409,
            code: `IDEMPOTENCY_${reason.toUpperCase()}`,
            context: { key, reason },
        });
    }
}

// ══════════════════════════════════════════════════════════
// SERVER ERRORS (5xx) — NEVER expose internals to clients
// ══════════════════════════════════════════════════════════

class ServerError extends AppError {
    constructor(message, opts = {}) {
        super(message, {
            statusCode: 500,
            isPublic: false,
            ...opts,
        });
    }
}

class DatabaseError extends ServerError {
    /**
     * @param {string} operation  e.g. "getUserById"
     * @param {Error}  cause      Original pg/query error
     * @param {object} context    Query text snippet, params, etc. (never raw secrets)
     */
    constructor(operation, cause, context = {}) {
        super(`فشل قاعدة البيانات أثناء: ${operation}`, {
            code: 'DATABASE_ERROR',
            statusCode: 500,
            cause,
            context: {
                operation,
                pgCode: cause?.code,
                pgConstraint: cause?.constraint,
                ...context,
            },
        });
    }
}

class ExternalApiError extends ServerError {
    /**
     * @param {string} provider    e.g. "ZATCA", "WhatsApp", "ZKTeco"
     * @param {Error}  cause
     * @param {object} context
     * @param {boolean} retryable  Whether client should try later
     */
    constructor(provider, cause, context = {}, retryable = true) {
        super(`فشل استدعاء خدمة خارجية: ${provider}`, {
            code: `EXTERNAL_${provider.toUpperCase()}_ERROR`,
            statusCode: retryable ? 503 : 502,
            cause,
            context: { provider, retryable, ...context },
        });
        this.retryable = retryable;
    }
}

class ConfigurationError extends ServerError {
    /**
     * @param {string} key  Missing / invalid env var or setting
     */
    constructor(key, details = '') {
        super(`إعداد مفقود أو غير صحيح: ${key}${details ? ` — ${details}` : ''}`, {
            code: 'CONFIGURATION_ERROR',
            statusCode: 500,
            isPublic: false,
            context: { key, details },
        });
    }
}

// ══════════════════════════════════════════════════════════
// TYPE GUARDS — enables `if (isAppError(e)) { ... }`
// ══════════════════════════════════════════════════════════

function isAppError(e) {
    return e instanceof AppError;
}
function isClientError(e) {
    return e instanceof ClientError;
}
function isServerError(e) {
    return e instanceof ServerError;
}
function isDatabaseError(e) {
    return e instanceof DatabaseError;
}

// ══════════════════════════════════════════════════════════
// WRAPPER — normalize 3rd-party errors into AppError
// ══════════════════════════════════════════════════════════

/**
 * Wrap any caught value (Error, string, ZodIssue array, pg error)
 * into the appropriate AppError subclass. Never throws the raw
 * unknown into the global error handler.
 *
 * Usage in a catch block:
 *   catch (raw) {
 *     throw wrapUnknown(raw, 'during checkout');
 *   }
 */
function wrapUnknown(raw, hint = '') {
    if (isAppError(raw)) {return raw;}

    // ─── Zod validation array ─────────────────────────
    if (Array.isArray(raw) && raw[0]?.code !== undefined) {
        return new ValidationError(null, raw);
    }

    // ─── pg constraint violation → Conflict ───────────
    if (raw?.code === '23505') {
        return new ConflictError(
            raw.table || 'قاعدة البيانات',
            'موجود مسبقاً (تكرار)',
            { constraint: raw.constraint, detail: raw.detail }
        );
    }
    // pg foreign key violation → Validation/Conflict
    if (raw?.code === '23503') {
        return new ClientError('مرجع غير صالح في قاعدة البيانات', {
            statusCode: 400,
            code: 'FK_VIOLATION',
            context: { constraint: raw.constraint },
            isPublic: true,
        });
    }
    // pg connection errors → DatabaseError
    if (raw?.code && ['08P01', 'ECONNREFUSED', 'ETIMEDOUT'].includes(raw.code)) {
        return new DatabaseError('query', raw, { hint });
    }
    // jsonwebtoken errors → Unauthorized
    if (raw?.name === 'JsonWebTokenError' || raw?.name === 'TokenExpiredError') {
        return new UnauthorizedError(raw.message === 'jwt expired' ? 'انتهت صلاحية الجلسة' : 'رمز الدخول غير صالح');
    }
    // bcrypt compare / malformed
    if (raw?.message && /illegal arguments|data and hash arguments/.test(raw.message)) {
        return new UnauthorizedError('بيانات تسجيل الدخول غير صالحة');
    }
    // Multer file upload
    if (raw?.code === 'LIMIT_FILE_SIZE') {
        return new ClientError('حجم الملف يتجاوز الحد المسموح به', { statusCode: 413, code: 'FILE_TOO_LARGE' });
    }

    // FIX 2026-10-11 (M5): pass through statusCode/status from wrapped errors —
    // express.static file-not-found (404) and pg 22P02 (invalid input syntax)
    // were falling through to generic ServerError → HTTP 500 instead of 404/400.
    if (raw?.statusCode && raw.statusCode >= 400 && raw.statusCode < 500) {
        return new ClientError(raw.message || 'طلب غير صالح', {
            statusCode: raw.statusCode,
            code: raw.code || 'CLIENT_ERROR',
            isPublic: true,
        });
    }
    // pg invalid input syntax (22P02) → 400 Bad Request
    if (raw?.code === '22P02') {
        return new ClientError('مُعرِّف غير صالح', { statusCode: 400, code: 'INVALID_INPUT_SYNTAX', isPublic: true });
    }

    // ─── Generic fallthrough ──────────────────────────
    const message = raw?.message || String(raw) || 'خطأ غير معروف';
    return new ServerError(hint ? `${hint}: ${message}` : message, {
        cause: raw instanceof Error ? raw : null,
        context: { rawType: typeof raw, hint },
    });
}

// ══════════════════════════════════════════════════════════
module.exports = {
    // Base
    AppError,
    // 4xx
    ClientError,
    ValidationError,
    UnauthorizedError,
    ForbiddenError,
    NotFoundError,
    ConflictError,
    RateLimitError,
    IdempotencyError,
    // 5xx
    ServerError,
    DatabaseError,
    ExternalApiError,
    ConfigurationError,
    // Guards
    isAppError,
    isClientError,
    isServerError,
    isDatabaseError,
    // Utilities
    wrapUnknown,
};
