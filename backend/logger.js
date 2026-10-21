/**
 * logger.js — Structured Logging with Pino
 * ────────────────────────────────────────────────────────────────────────────
 * Production-ready logging system with:
 * - Structured JSON output for log aggregation (ELK, Datadog, etc.)
 * - Request-scoped logging with context
 * - Automatic request/response logging middleware
 * - Sensitive data filtering
 * - Performance timing utilities
 */

// ─── Environment (قبل إنشاء الـ logger) ───────────────────
// يجب أن يُحمَّل .env قبل قراءة NODE_ENV أدناه — وإلا انطلق pino-pretty
// transport (worker thread) في الإنتاج وحُجب الحدث الرئيسي حين يمتلئ
// أنبوب الكونسول (تعليق السيرفر + حرق نواة CPU). dotenv لا يتجاوز
// المتغيرات الموجودة مسبقًا، فالتكرار من نقاط الدخول الأخرى آمن.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const pino = require('pino');

// ─── Configuration ───────────────────────────────────────

/**
 * Get appropriate transport based on environment.
 * Development: human-readable pretty logs
 * Production: JSON for log aggregation systems
 */
function getTransport() {
    const isProduction = process.env.NODE_ENV === 'production';
    const isTest = process.env.NODE_ENV === 'test';
    
    // In test environment, use a direct destination to avoid transport workers.
    if (isTest) {
        return undefined;
    }
    
    // Default (production): JSON إلى ملف عبر worker-thread — FIX 2026-10-03
    // (اختبار ضغط): كان pino يكتب مزامنةً على stdout، وتحت خدمة ويندوز (WinSW)
    // أنبوب stdout غير مصروف → كل سطر لوج يحجب الحلقة → كومة 300MB وتوقف
    // 3.6 ثانية وتجاوز مهلة الطلبات تحت الضغط (دليل: phase-post-all-fixes).
    // pino/file يعمل في خيط منفصل ولا يحجب أبدًا، والسجل دائم على القرص.
    // FIX 2026-10-11 (M3): size-based rotation — log file was unrotated,
    // growing unbounded on disk. Rotate at 50MB, keep 5 backups.
    if (isProduction) {
        const logDir = require('path').join(__dirname, '..', 'logs');
        try { require('fs').mkdirSync(logDir, { recursive: true }); } catch (_) {}
        const logFile = require('path').join(logDir, 'app-out.log');
        // Rotate if file exceeds 50MB
        try {
            const fs = require('fs');
            const MAX_LOG_BYTES = 50 * 1024 * 1024; // 50MB
            const MAX_LOG_BACKUPS = 5;
            if (fs.existsSync(logFile)) {
                const stat = fs.statSync(logFile);
                if (stat.size > MAX_LOG_BYTES) {
                    // Shift existing backups: .5 → delete, .4 → .5, ..., .log → .1
                    for (let i = MAX_LOG_BACKUPS - 1; i >= 1; i--) {
                        const src = `${logFile}.${i}`;
                        const dst = `${logFile}.${i + 1}`;
                        if (fs.existsSync(src)) {
                            if (i + 1 > MAX_LOG_BACKUPS) { fs.unlinkSync(src); }
                            else { fs.renameSync(src, dst); }
                        }
                    }
                    fs.renameSync(logFile, `${logFile}.1`);
                }
            }
        } catch (_) { /* rotation failure must not block logging */ }
        return {
            target: 'pino/file',
            options: { destination: logFile, mkdir: true, sync: false },
        };
    }

    // Development: pretty printing
    if (process.env.LOG_PRETTY !== 'false') {
        return {
            target: 'pino-pretty',
            options: {
                colorize: true,
                translateTime: 'SYS:yyyy-mm-dd HH:MM:ss',
                ignore: 'pid,hostname',
                levelFirst: true,
            },
        };
    }

    // Fallback: JSON to stdout
    return undefined; // Use pino defaults
}

// ─── Create Logger Instance ───────────────────────────────

const loggerOptions = {
    name: 'karim-erp-pro',
    level: process.env.LOG_LEVEL || 'info',
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: {
        level(label) {
            return { level: label.toUpperCase() };
        },
        log(object) {
            // Add app version if available
            try {
                const { version } = require('../package.json');
                return { ...object, appVersion: version };
            } catch {
                return object;
            }
        },
    },
    // Redact sensitive fields in all logs
    redact: {
        paths: [
            'req.headers.authorization',
            'req.headers.cookie',
            'req.body.password',
            'req.body.token',
            'req.body.secret',
            'res.body.token',
            'res.body.password',
            'user.password',
            'config.databasePassword',
        ],
        censor: '[REDACTED]',
    },
    ...(getTransport() ? { transport: getTransport() } : {}),
};
const testDestination = process.env.NODE_ENV === 'test'
    ? pino.destination({ dest: process.platform === 'win32' ? 'NUL' : '/dev/null', sync: true })
    : undefined;
const logger = pino(loggerOptions, testDestination);

// ─── Child Logger Factory (Request-Scoped) ────────────────

/**
 * Create a child logger bound to a specific request context.
 * All logs from this child will include the context automatically.
 * 
 * @param {Object} req - Express request object
 * @returns {pino.Logger} Child logger with request context
 */
function childLogger(req) {
    const requestId = req.headers['x-request-id'] || generateRequestId();
    const userId = req.user?.id || null;
    const userRole = req.user?.role || null;
    
    return logger.child({
        requestId,
        userId,
        userRole,
        ip: req.ip || req.connection?.remoteAddress,
        method: req.method,
        path: req.path,
        userAgent: req.headers['user-agent'],
    });
}

// ─── Request ID Generator ─────────────────────────────────

let requestCounter = 0;

function generateRequestId() {
    requestCounter++;
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 8);
    const counter = requestCounter.toString(36);
    return `${timestamp}-${random}-${counter}`;
}

// ─── Express Middleware ────────────────────────────────────

/**
 * Express middleware that:
 * 1. Creates request-scoped child logger
 * 2. Logs incoming requests
 * 3. Logs outgoing responses with timing
 * 4. Attaches logger to req.log for use in route handlers
 */
function httpLogger(options = {}) {
    const {
        ignorePaths = ['/api/health', '/api/network-info'],
        slowThresholdMs = 1000, // Log warning if response takes longer
    } = options;
    
    return (req, res, next) => {
        // Skip ignored paths
        if (ignorePaths.some(path => req.path.startsWith(path))) {
            return next();
        }
        
        // Create request-scoped logger
        const log = childLogger(req);
        req.log = log;
        
        // Record start time
        const startTime = Date.now();
        
        // Log request
        log.info({
            event: 'request.start',
            query: req.query,
            params: req.params,
            hasBody: !!req.body && Object.keys(req.body).length > 0,
        }, `→ ${req.method} ${req.path}`);
        
        // Override res.end to capture response
        const originalEnd = res.end;
        res.end = function(chunk, encoding, callback) {
            res.end = originalEnd;
            res.end(chunk, encoding, callback);

            try {
                // Calculate duration
                const duration = Date.now() - startTime;

                // Safe logger fallback: prefer request child, fall back to root singleton
                const safeLog = (log && typeof log.info === 'function') ? log : logger;

                // Determine log level based on status code
                const statusCode = res.statusCode;
                let event = 'response.success';
                let level = 'info';

                if (statusCode >= 500) {
                    level = (typeof safeLog.error === 'function') ? 'error' : 'info';
                    event = 'response.error';
                } else if (statusCode >= 400) {
                    level = (typeof safeLog.warn === 'function') ? 'warn' : 'info';
                    event = 'response.client_error';
                } else if (duration > slowThresholdMs) {
                    level = (typeof safeLog.warn === 'function') ? 'warn' : 'info';
                    event = 'response.slow';
                }

                // Log response (never let a logging failure crash the process).
                // Call through safeLog so `this` stays bound — pino level methods
                // read instance symbols and throw when invoked detached.
                if (typeof safeLog[level] === 'function') {
                    safeLog[level]({
                        event,
                        statusCode,
                        durationMs: duration,
                        contentLength: res.getHeader('content-length'),
                    }, `← ${req.method} ${req.path} ${statusCode} (${duration}ms)`);
                }
            } catch (logErr) {
                // Swallow logging errors entirely — they must never kill the server
                try {
                    logger.warn({
                        event: 'logger.res_end.suppressed_error',
                        errorMessage: logErr && logErr.message ? logErr.message : String(logErr),
                        path: req.path,
                        method: req.method,
                    }, '[Logger] Suppressed error in res.end override');
                } catch (_) { /* final defensive no-op */ }
            }
        };
        
        next();
    };
}

// ─── Error Logging Helper ─────────────────────────────────

/**
 * Log an error with full context.
 * 
 * @param {Error} error - The error object
 * @param {Object} context - Additional context
 * @param {pino.Logger} [log] - Optional logger instance
 */
function logError(error, context = {}, log = logger) {
    const errorInfo = {
        event: 'error',
        message: error.message,
        stack: error.stack,
        name: error.name,
        code: error.code,
        ...context,
    };
    
    // Use appropriate log level
    if (error.name === 'ValidationError' || error.code === 'VALIDATION_ERROR') {
        log.warn(errorInfo);
    } else {
        log.error(errorInfo);
    }
}

// ─── Performance Timer ────────────────────────────────────

/**
 * Create a performance timer that logs elapsed time.
 * 
 * @param {string} label - Timer label
 * @param {pino.Logger} [log] - Optional logger instance
 * @returns {{ end: Function, start: number }} Timer object
 */
function createTimer(label, log = logger) {
    const start = process.hrtime.bigint();
    
    function end(extraContext = {}) {
        const endHr = process.hrtime.bigint();
        const ms = Number(endHr - start) / 1_000_000;
        
        log.debug({
            event: 'timer',
            label,
            durationMs: Math.round(ms * 100) / 100,
            ...extraContext,
        }, `[Timer] ${label}: ${ms.toFixed(2)}ms`);
        
        return ms;
    }
    
    return { end, start: Number(start) };
}

// ─── Audit Log Helper ─────────────────────────────────────

/**
 * Create a structured audit log entry.
 * Audit logs are always at INFO level and include action details.
 * 
 * @param {string} action - Action being performed
 * @param {Object} details - Action details
 * @param {Object} req - Express request (for context)
 */
function auditLog(action, details = {}, req = null) {
    const log = req ? childLogger(req) : logger;
    
    log.info({
        event: 'audit',
        action,
        ...details,
        timestamp: new Date().toISOString(),
    }, `[AUDIT] ${action}`);
}

// ─── Security Event Logging ──────────────────────────────

/**
 * Log security-related events (always at WARN or ERROR level).
 * 
 * @param {string} eventType - Type of security event
 * @param {Object} details - Event details
 * @param {Object} req - Express request
 */
function securityLog(eventType, details = {}, req = null) {
    const log = req ? childLogger(req) : logger;
    
    const securityEvents = {
        'auth.failed': { level: 'warn', message: 'Authentication failed' },
        'auth.success': { level: 'info', message: 'Authentication successful' },
        'rate_limited': { level: 'warn', message: 'Rate limit exceeded' },
        'injection_attempt': { level: 'error', message: 'Possible injection attempt detected' },
        'xss_attempt': { level: 'error', message: 'Possible XSS attempt detected' },
        'unauthorized_access': { level: 'warn', message: 'Unauthorized access attempt' },
        'privilege_escalation': { level: 'error', message: 'Privilege escalation attempt' },
        'suspicious_payload': { level: 'warn', message: 'Suspicious payload detected' },
    };
    
    const eventConfig = securityEvents[eventType] || { level: 'warn', message: eventType };
    
    log[eventConfig.level]({
        event: 'security',
        securityEvent: eventType,
        severity: eventConfig.level === 'error' ? 'high' : eventConfig.level === 'warn' ? 'medium' : 'low',
        ...details,
    }, `[SECURITY] ${eventConfig.message}`);
}

// ─── Export Everything ─────────────────────────────────────

module.exports = {
    // Main logger instance
    logger,
    
    // Middleware
    httpLogger,
    
    // Factories & helpers
    childLogger,
    generateRequestId,
    logError,
    createTimer,
    auditLog,
    securityLog,
    
    // For testing/external access
    _resetCounter: () => { requestCounter = 0; },
};
