const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
// const morgan = require('morgan'); // FIX 2026-10-03: أُزيل — تسجيل مكرر مع httpLogger (انظر أسفل ملف الإعداد)
const compression = require('compression');
const os = require('os');
const bcrypt = require('./pw-crypto');
const path = require('path');
const crypto = require('crypto');
// dotenv يجب أن يُحمَّل قبل أي وحدة تقرأ NODE_ENV أثناء التحميل (logger أولها)
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { logger, httpLogger } = require("./logger");
const { MEDIA_ROOT, ensureMediaDirs } = require('./media-storage');
const { spawn } = require('child_process');

// ─── Enterprise Foundation Layers ──────────────────────────
const { correlationMiddleware, updateUserContext } = require('./middleware/correlation');
const { securityHeaders, hppGuard } = require('./middleware/security');
const { createHealthRouter, markBootComplete, registerCheck } = require('./middleware/health');
const { idempotency, ensureIdempotencySchema } = require('./middleware/idempotency');
const { registerWithHealthChecks: circuitRegisterHealth } = require('./middleware/circuit');
const startup = require('./startup');
const {
    attachSafeHelpers,
    asyncHandler: asyncHandlerEnterprise,
    globalErrorHandler,
    installProcessShields,
    notFoundHandler,
} = require('./errors/error-handler');

// ─── Shared Database Pool (avoids circular dependency) ──────
const { pool } = require('./shared-pool');
const { normalizeShiftStart, normalizeShiftKarim } = require('./shift-day');

// ─── JWT Authentication Middleware ────────────────────
const { jwtAuth, requireRole, verifyAccessToken, isStrongPassword } = require('./cashier-module/jwt-middleware');
const { requireRoleOrPerm, permForEntity } = require('./permissions');
const { router: hrRouter } = require('./hr-routes');
const { router: warehouseRouter, ensureLegacyKitchenReceiptLedger, resolveDeptHeadDispatch, canDeleteDispatch } = require('./warehouse-routes');
const { router: inventoryControlRouter } = require('./inventory-control-routes');
const { router: stocktakingRouter, ensureStocktakingSchema } = require('./stocktaking-routes');
const { router: inventoryTransferRouter } = require('./inventory-transfer-routes');
const { router: kitchenProductionRouter, ensureKitchenSchema } = require('./kitchen-production-routes');
const { router: procurementRouter, ensureProcurementSchema } = require('./procurement-routes');
const { router: financeRouter } = require('./finance-routes');
const { router: leaveWorkflowRouter, ensureLeaveWorkflowSchema } = require('./leave-workflow-routes');
const { ensureNotificationsSchema } = require('./notification-service');
const notificationRouter = require('./notification-routes');
const { notifyChainEvent, ensureDispatchCreatorSchema } = require('./dispatch-notifier');
// ─── مزامنة أجهزة البصمة داخل النظام (ZKTeco) — ليست خدمة منفصلة ──
const { router: zktecoRouter, ensureZktecoSchema, attendanceEngine } = require('./zkteco');
const { router: yarasoftRouter, ensureYarasoftSchema, yarasoftEngine } = require('./yarasoft');

// ─── Schema Registry (Column Whitelist for Security) ──
const { filterBody, entityExists, validateColumnName, getSortableColumns, getSchema, getEntityWriteRoles, isProtectedDeleteEntity, maskEmployeeRowForRole } = require('./schema-registry');
const { encryptForVault, decryptFromVault, ensurePasswordVaultSchema } = require('./password-vault');

// ─── Pagination Utilities ─────────────────────────────
const { parsePaginationParams, buildPaginatedQuery } = require('./pagination');

// ─── Rate Limiting ──────────────────────────────────
const { generalLimiter, authLimiter, stateLimiter, crudLimiter } = require('./rate-limiter');

// ─── Graceful Shutdown Handler ──────────────────────
const { initGracefulShutdown, rejectDuringShutdown, getShutdownStatus } = require('./graceful-shutdown');
const { collectDailyReport, renderDailyReportHtml, sendDailyReport, startDailyReportScheduler, smtpConfigured } = require('./daily-report-service');

// ─── API Response Cache (10s TTL for heavy GET endpoints) ──
// Extracted to backend/api-cache.js (session-scoped key + invalidation).
const { apiCacheMiddleware } = require('./api-cache');
// ─── حماية من طوفان النسخ الاحتياطية (backup throttling) ─────────
let lastBackupAt = 0;
let pendingBackupTimer = null;
let stopDailyReportScheduler = () => {};
const BACKUP_MIN_INTERVAL_MS = 15_000; // نسخة احتياطية كل 15 ثانية كحد أقصى

function scheduleBackup() {
    const now = Date.now();
    const elapsed = now - lastBackupAt;
    if (elapsed < BACKUP_MIN_INTERVAL_MS) {
        // اجدولها للتنفيذ لاحقاً — بدون فتح عمليات متعددة
        if (pendingBackupTimer) {return;}
        pendingBackupTimer = setTimeout(() => {
            pendingBackupTimer = null;
            runBackup();
        }, BACKUP_MIN_INTERVAL_MS - elapsed);
        return;
    }
    runBackup();
}

function runBackup() {
    lastBackupAt = Date.now();
    try {
        const backupScript = path.join(__dirname, '..', 'database', 'scripts', 'backup.js');
        const backupProcess = spawn(process.execPath, [backupScript], {
            detached: true,
            stdio: 'ignore',
            windowsHide: true, // ⭐ منع ظهور نافذة CMD السوداء على ويندوز
        });
        backupProcess.unref();
        backupProcess.on('error', (e) => {
            logger.error('[backup-spawn] error:', e.message);
        });
    } catch (e) {
        logger.error('Failed to trigger backup (non-critical):', e.message);
    }
}

const app = express();

// HTTPS محلي (mkcert) عند توفر SSL_KEY/SSL_CERT — وإلا HTTP عادي
let httpServer;
let LAN_SCHEME = 'http'; // يُحدَّث تلقائيًا — يستخدمه إعلان LAN ليعرف العميل الصيغة الصحيحة
{
    const fs = require('fs');
    const keyPath = process.env.SSL_KEY;
    const certPath = process.env.SSL_CERT;
    if (keyPath && certPath && fs.existsSync(keyPath) && fs.existsSync(certPath)) {
        const https = require('https');
        httpServer = https.createServer({
            key: fs.readFileSync(keyPath),
            cert: fs.readFileSync(certPath),
        }, app);
        LAN_SCHEME = 'https';
        logger.info('[SSL] HTTPS enabled (local certificate)');
    } else {
        httpServer = createServer(app);
    }
}

const PORT = process.env.PORT || 5000;

// -------------------------------------------------------
// Unified CORS source-of-truth (B.5)
// -------------------------------------------------------
// Both REST (express cors middleware) and Socket.io read from the
// SAME `ALLOWED_ORIGINS` env var. No hardcoded '*' anywhere.
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS || '*';
if (ALLOWED_ORIGINS === '*') {
    logger.warn('[SECURITY] ALLOWED_ORIGINS=* (open CORS). This is unsafe outside a trusted LAN. Set ALLOWED_ORIGINS=http://localhost:5000,http://192.168.1.* in .env for production.');
}

// Compute origin value once — used by both REST and Socket.io.
// Tailscale MagicDNS (*.ts.net over HTTPS) is always allowed: those names only
// resolve inside your private tailnet AND carry auto-provisioned trusted certs,
// so PWA works with zero warnings and no manual .env edit per device.
const _staticOrigins = ALLOWED_ORIGINS === '*'
    ? null
    : ALLOWED_ORIGINS.split(',').map(o => o.trim()).filter(Boolean);
const corsOriginValue = ALLOWED_ORIGINS === '*'
    ? '*'
    : ((origin, callback) => {
        if (!origin) {return callback(null, true);}
        if (_staticOrigins.includes(origin)) {return callback(null, true);}
        if (/^https:\/\/[a-z0-9-]+(\.[a-z0-9-]+)*\.ts\.net(:\d+)?$/i.test(origin)) {
            return callback(null, true);
        }
        // zrok reserved public share (trusted HTTPS, checked-in tunnel).
        if (/^https:\/\/[a-z0-9-]+\.shares\.zrok\.io(:\d+)?$/i.test(origin)) {
            return callback(null, true);
        }
        return callback(null, false);
    });

const unifiedCorsOptions = {
    origin: corsOriginValue,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-api-key', 'x-socket-id', 'x-device-name'],
    credentials: ALLOWED_ORIGINS !== '*',
};

// -------------------------------------------------------
// Socket.io Setup — Real-time LAN Communication (uses unified CORS)
// -------------------------------------------------------
const io = new Server(httpServer, {
    cors: unifiedCorsOptions,
    pingTimeout: 30000,
    pingInterval: 10000,
});

// ─── Real-time guard (TASK 4): optional handshake JWT + per-socket limits ───
// Coexistence: anonymous sockets still connect (legacy/pre-login). Verified
// sockets join `erp:authed`; with RT_REQUIRE_AUTH=true sensitive broadcasts
// go only there, otherwise legacy global behavior is unchanged.
const { isRtAuthRequired, resolveHandshakeUser, createSocketLimiter, SOCKET_EVENT_BUDGETS } = require('./realtime/guard');
const socketLimiter = createSocketLimiter();
io.use((socket, next) => {
    const user = resolveHandshakeUser(verifyAccessToken, socket.handshake);
    socket.data.authed = Boolean(user);
    if (user) {
        socket.data.rtUser = user;
        socket.join('erp:authed');
    }
    next();
});
function rtGuard(socket, event) {
    const ok = socketLimiter.check(socket.id, event, SOCKET_EVENT_BUDGETS[event] || 10);
    if (!ok) {logger.warn(`[Socket] rate-limited ${event} from ${socket.id}`);}
    return ok;
}
// Sensitive broadcast: authed-room only when flag on, legacy global otherwise.
// Anti-echo preserved via exceptSocketId in both modes.
function emitScoped(event, data, exceptSocketId) {
    if (isRtAuthRequired()) {
        const target = io.to('erp:authed');
        if (exceptSocketId) {target.except(exceptSocketId).emit(event, data); return;}
        target.emit(event, data); return;
    }
    if (exceptSocketId) {io.except(exceptSocketId).emit(event, data); return;}
    io.emit(event, data);
}

// Track connected clients
const connectedClients = new Map(); // socketId → { ip, deviceName, joinedAt }

function getErrorMessage(error) {
    if (!error) {return 'Unknown error';}
    if (error.message) {return error.message;}
    if (Array.isArray(error.errors) && error.errors.length > 0) {
        return error.errors
            .map(getErrorMessage)
            .filter(Boolean)
            .join(' | ');
    }
    if (error.code) {return error.code;}
    return String(error);
}

// ─── Security: Sanitize headers to prevent XSS ─────────
function sanitizeHeader(value) {
    if (!value || typeof value !== 'string') {return null;}
    
    // Remove/nullify potentially dangerous patterns
    const dangerousPatterns = [
        /<script[^>]*>.*?<\/script>/gis,      // Script tags
        /javascript:/gi,                          // JavaScript protocol
        /on\w+\s*=/gi,                           // Event handlers (onclick, etc.)
        /<iframe/gi,                             // Iframes
        /<object/gi,                             // Objects
        /<embed/gi,                              // Embeds
        /data:\s*text\/html/gi,                  // Data URLs with HTML
    ];
    
    let sanitized = value;
    for (const pattern of dangerousPatterns) {
        if (pattern.test(sanitized)) {
            // Return truncated version with warning instead of original
            return '[SANITIZED:' + sanitized.substring(0, 20).replace(/[<>]/g, '') + '...]';
        }
    }
    
    // Limit length to prevent abuse
    const MAX_HEADER_LENGTH = 200;
    if (sanitized.length > MAX_HEADER_LENGTH) {
        sanitized = sanitized.substring(0, MAX_HEADER_LENGTH);
    }
    
    return sanitized;
}

// -------------------------------------------------------
// Enterprise Middleware — ORDER MATTERS (outer → inner)
// -------------------------------------------------------
//   1. Request Identity (correlation-id + trace-context + AsyncLocalStorage)
//   2. Safe helpers attached (wrapError, throwSafe)
//   3. Structured HTTP logger (per-request child logger + timing)
//   4. Security Headers (CSP / HSTS / XFO / COOP / CORP / Permissions)
//   5. HTTP Parameter Pollution guard
//   6. CORS (unified with Socket.io)
//   7. Trust-proxy awareness
// -------------------------------------------------------

// 1 ════ Request Identity ════════════════════════════════
app.use(correlationMiddleware({
    headerNames: ['x-request-id', 'x-correlation-id', 'x-trace-id'],
}));

// 2 ════ Safe error helpers on each req ══════════════════
app.use(attachSafeHelpers);

// 3 ════ Structured per-request logging ══════════════════
app.use(httpLogger({
    ignorePaths: ['/api/health', '/api/network-info', '/api/live', '/api/ready', '/api/startup'],
    slowThresholdMs: 1500,
}));

// 4 ════ Production-grade Security Headers ═══════════════
app.use(securityHeaders({
    hsts: process.env.NODE_ENV === 'production',
    referrerPolicy: 'strict-origin-when-cross-origin',
    frameguard: 'sameorigin',
    permittedCrossDomainPolicies: 'none',
}));

// 5 ════ HPP (HTTP Parameter Pollution) guard ════════════
app.use(hppGuard({ arrayKeys: ['ids', 'tags', 'selected[]', 'items[]'] }));

// 6 ════ REST CORS (uses the SAME unified options as Socket.io) ──
app.use(cors(unifiedCorsOptions));

// 7 ════ Baseline browser security and reverse-proxy awareness ──
app.disable('x-powered-by');
app.set('trust proxy', String(process.env.TRUST_PROXY || '').toLowerCase() === 'true' ? 1 : false);
// ─── Metrics collector (enterprise hardening): ring buffer + counters ──
// مُسجّل مبكر جدًا ليقيس كل شيء (قبل الضغط والحدّ من الطلبات)،
// ويكشف الطلبات البطيئة في السجل دون أي تكلفة تُذكر على المسار الساخن.
const metrics = require('./metrics');
app.use(metrics.middleware());
app.use((req, res, next) => {
    const startMs = Date.now();
    res.on('finish', () => {
        const dur = Date.now() - startMs;
        if (dur >= metrics.SLOW_MS) {
            logger.warn(`[SLOW] ${req.method} ${req.originalUrl} → ${res.statusCode} in ${dur}ms`, {
                requestId: req.headers['x-request-id'] || undefined,
            });
        }
    });
    next();
});
// ─── Response compression (gzip) — يقلّل حجم JSON على شبكة المطعم ≤ 70% ──
// Socket.io يسلك قنواته الخاصة (websocket/polling) فلا يتأثر، ولا نستخدم SSE.
app.use(compression({
    threshold: 512,
    level: 9,
    memLevel: 9,
    filter: (req, res) => {
        if (req.headers['x-no-compression']) {return false;}
        const ct = res.getHeader('Content-Type') || '';
        return compression.filter(req, res) || /text|json|javascript|css|xml|svg|font|woff/i.test(ct);
    },
}));
// ─── Enterprise Static Asset Cache Headers (Brotli-aware, immutable for versioned) ──
function setStaticCacheHeaders(res, filePath) {
    const ext = path.extname(filePath).toLowerCase();
    const NO_CACHE = 'no-cache, must-revalidate, proxy-revalidate';

    // Normalize separators for cross-OS detection (handles Windows \ and Unix /)
    const normPath = filePath.replace(/\\/g, '/');
    const reqUrl = res.req?.url || '';
    const nocacheTest = /[?&]nocache/.test(reqUrl || '');
    // Immutable versioned assets: vendor folder (by path or by URL mount) OR ?v= query
    const isImmutable = /[/\\]app[/\\]js[/\\]vendor[/\\]/i.test(filePath)
        || /\/app\/js\/vendor\//i.test(normPath)
        || /^\/app\/js\/vendor\//i.test(reqUrl)
        || /[?&]v=\d/.test(reqUrl);
    const noCache = nocacheTest;

    if (['.woff', '.woff2', '.ttf', '.eot', '.otf'].includes(ext)) {
        res.setHeader('Cache-Control', noCache ? 'no-cache, must-revalidate, proxy-revalidate' : isImmutable
            ? `public, max-age=31536000, immutable`
            : `public, max-age=2592000`);
        res.setHeader('Vary', 'Accept-Encoding');
    } else if (['.png', '.jpg', '.jpeg', '.webp', '.gif', '.ico', '.bmp'].includes(ext)) {
        res.setHeader('Cache-Control', noCache ? 'no-cache, must-revalidate, proxy-revalidate' : isImmutable
            ? `public, max-age=31536000, immutable`
            : `public, max-age=604800`);
        res.setHeader('Vary', 'Accept-Encoding');
    } else if (['.svg'].includes(ext)) {
        res.setHeader('Cache-Control', `public, max-age=2592000`);
        res.setHeader('Vary', 'Accept-Encoding');
    } else if (['.css'].includes(ext)) {
        res.setHeader('Cache-Control', NO_CACHE);
        res.setHeader('Vary', 'Accept-Encoding');
    } else if (['.js', '.mjs'].includes(ext)) {
        // ROOT FIX (نهاية عهد ?v= اليدوي): كود التطبيق لا يُخزَّن طويلًا أبدًا حتى مع
        // ?v= — السياسة القديمة كانت تعطي ?v= كاش سنة immutable، فبقي الكود الجديد
        // محجوبًا في المتصفحات أسبوعين. مكتبات vendor وحدها immutable (ثابتة فعلًا).
        const isVendorLib = normPath.toLowerCase().indexOf('/vendor/') !== -1 || String(reqUrl).toLowerCase().indexOf('/vendor/') !== -1;
        res.setHeader('Cache-Control', isVendorLib
            ? 'public, max-age=31536000, immutable'
            : NO_CACHE);
        res.setHeader('Vary', 'Accept-Encoding');
    } else if (['.json'].includes(ext)) {
        if (/manifest\.json$/i.test(filePath)) {
            res.setHeader('Cache-Control', `public, max-age=3600`);
        } else {
            res.setHeader('Cache-Control', NO_CACHE);
        }
    } else if (['.html', '.htm'].includes(ext)) {
        res.setHeader('Cache-Control', NO_CACHE);
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
    } else {
        res.setHeader('Cache-Control', `public, max-age=3600`);
    }

    // Security headers for static content
    if (['.js', '.css'].includes(ext)) {
        res.setHeader('X-Content-Type-Options', 'nosniff');
    }

    // PWA: Service Worker registration requires explicit scope allowance
    // if the served file path is not at the scope root.
    if (/[/\\]sw\.js$/i.test(filePath) || /^\/app\/sw\.js/i.test(reqUrl)) {
        res.setHeader('Service-Worker-Allowed', '/app/');
        // Service workers must never be cached long-term — SW update relies on byte-diff check.
        res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
    }
}
app.use(apiCacheMiddleware); // أقل من 1KB لا يستحق الحساب

// ─── Body Parsers (MUST be before apiKeyMiddleware so req.body is available) ───
// استيراد الإكسل (مسار صفوف JSON) هو النقطة الوحيدة المسموح لها جسم كبير —
// يُركّب قبل المحلل العام ليطالب الجسم نفسه ويمنع المحلل العام من رفضه.
app.use('/api/inventory/import', express.json({ limit: '50mb' }));
// حد عام مشدّد (2MB): يقطع هجمات الحشو مبكرًا بدل سحب الذاكرة على 50MB لكل طلب
app.use(express.json({ limit: '2mb', strict: true }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));
// FIX 2026-10-03 (اختبار ضغط): أُزيل morgan('combined') — كان يسجّل كل طلب
// مرتين (httpLogger المنظم يغطي البداية والنهاية بتفاصيل أكبر)، والتحذير
// للطلبات البطيئة موجود أصلًا في httpLogger (slowThresholdMs). العمل المكرر
// كان يستهلك CPU وI/O على المسار الساخن تحت الضغط بلا أي قيمة تشغيلية.

// ─── DB Constraints Validation Middleware ─────────────────
// يتحقق من قيود قاعدة البيانات (UNIQUE, FK, NOT NULL, CHECK) قبل تنفيذ أي عملية كتابة
// يرفض الطلب بـ 422 لو البيانات ستخالف قيود الـ DB
const { autoDbValidation } = require('./db-validation-middleware');
app.use('/api', autoDbValidation({
  exemptPaths: ['/api/health', '/api/auth', '/api/state', '/api/network-info', '/api/clients', '/api/metrics', '/api/reports', '/api/manager', '/api/server/info'],
  skipUnique: false,
  skipFK: false,
  skipChecks: false,
}));

// ─── API_KEY Protection (optional but recommended) ──────
const API_KEY = process.env.API_KEY;
// B.9: Print explicit warning if API_KEY is empty (no silent failure)
if (!API_KEY) {
    logger.warn('[SECURITY] API_KEY is not set in .env. All /api/* endpoints are accessible without an x-api-key header. This is acceptable on a trusted LAN, but for any environment where the network is not fully trusted, set API_KEY=<random-32-char-string> in .env.');
}
function apiKeyMiddleware(req, res, next) {
    // If API_KEY is not set in .env, skip this middleware (legacy behavior)
    if (!API_KEY) { return next(); }
    // Health probe is always open (watchdog / load-balancer / import script).
    // NOTE: req.path is relative to the '/api' mount point.
    if (req.path === '/health' || req.path === '/api/health' || req.originalUrl === '/api/health') {
        return next();
    }
    // هوية الخادم للعميل EXE أثناء الاكتشاف — معلومات عامة فقط (اسم/إصدار/وقت)
    if (req.path === '/server/info') {
        return next();
    }
    // التحقق العام من بطاقات الموظف (مسح QR بالهاتف): مؤمّن ذاتيًا بتوقيع
    // HMAC ويعرض بيانات عامة فقط — ومتصفح الهاتف لا يملك x-api-key أبدًا،
    // فحجبه بالمفتاح يعني "مفتاح التطبيق مفقود" لكل مسح. يُستثنى عمدًا و بأمان.
    if (req.path === '/hr/card/verify' || req.path.indexOf('/hr/card/v/') === 0) {
        return next();
    }
    // Auth endpoints stay open: they are credential/JWT-gated + rate-limited,
    // and the browser cannot know the app key before login. The key is handed
    // to the client inside login/refresh responses and required on all DATA
    // endpoints below. Exempting /api/auth/* is intentional and safe.
    if (req.path === '/auth/login' || req.path === '/auth/refresh'
        || req.path === '/auth/change-password' || req.path === '/auth/logout'
        || req.path === '/auth/forgot-password/request-code' || req.path === '/auth/forgot-password/reset'
        || req.path.indexOf('/auth/') === 0) {
        return next();
    }
    const providedKey = req.headers['x-api-key'];
    if (!providedKey) {
        return res.status(401).json({ error: 'API_KEY_REQUIRED', message: 'مفتاح التطبيق مفقود — أضف ترويسة x-api-key' });
    }
    // SECURITY: مقارنة timing-safe (بتغليف فرق الطول أولًا) — المقارنة المباشرة
    // === تفتح باب قياس زمن الاستجابة لكشف المفتاح بايتًا بايتًا.
    const a = Buffer.from(String(providedKey));
    const b = Buffer.from(String(API_KEY));
    const keyOk = a.length === b.length && crypto.timingSafeEqual(a, b);
    if (!keyOk) {
        return res.status(401).json({ error: 'API_KEY_INVALID', message: 'مفتاح التطبيق غير صحيح' });
    }
    next();
}
app.use('/api', apiKeyMiddleware);
app.use('/api', rejectDuringShutdown); // Reject new requests during shutdown

// Real employee portal: signed QR cards, attendance actions, and printable reports.
app.use('/api/hr', (req, res, next) => { req.io = io; next(); }, hrRouter);
try {
    require('./hr-routes').startShiftRollover();
} catch (e) {
    logger.error('[SHIFT_ROLLOVER] scheduler failed to start:', e.message);
}
// Leave approval workflow: employee → direct manager → operations manager → general manager → HR.
app.use('/api/hr', (req, res, next) => { req.io = io; next(); }, leaveWorkflowRouter);
// البصمة الذاتية المقيدة جغرافيًا (SPEC-employee-pwa-attendance-geofence-v1) —
// مولودة مغلقة: punch_portal_enabled=false حتى يفعّلها المالك من punch_settings.
const punchPortalRouter = require('./attendance-portal-routes'); // module.exports = router
app.use('/api/attendance/portal', punchPortalRouter);

// وحدة جدول الدومات حُذفت من جذورها (2026-09-30) — الدوام الثابت هو المصدر.

ensureLeaveWorkflowSchema().catch((error) => logger.error('[LEAVE_WORKFLOW_SCHEMA] initialization failed:', error.message));
// Atomic warehouse/accounting workflows: dispatch approval, kitchen returns, and purchase invoices.
app.use('/api/warehouse', (req, res, next) => { req.io = io; next(); }, warehouseRouter);
// Inventory counting sessions and admin-only operational reset.
app.use('/api/warehouse', (req, res, next) => { req.io = io; next(); }, inventoryControlRouter);
// World-class inventory transfer, receiving, variance and reconciliation workflow.
app.use('/api/warehouse', (req, res, next) => { req.io = io; next(); }, inventoryTransferRouter);
// Professional stocktaking studio: live counting, bulk counts, cancel, printable sheets.
app.use('/api/warehouse', (req, res, next) => { req.io = io; next(); }, stocktakingRouter);
ensureStocktakingSchema().catch((error) => logger.error('[STOCKTAKING_SCHEMA] initialization failed:', error.message));
// ── v7.1 Real-time infrastructure: outbox publisher + missed-event recovery + client ACK ──
// طبقة إضافية فوق Socket.IO القائم — لا تستبدل أي بث قائم (العقد C1/C5: dual-publish فقط).
const rtRecovery = require('./realtime/recovery-routes');
app.use('/api/rt', rtRecovery.router);
require('./realtime/publisher').startOutboxPublisher({ io, pool, logger })
    .catch((error) => logger.error('[OUTBOX_PUBLISHER] start failed (non-fatal):', error.message));
// Kitchen production control: flexible/monitor/strict policies, kitchen transfers, production and exceptions.
app.use('/api/kitchen', (req, res, next) => { req.io = io; next(); }, kitchenProductionRouter);
ensureKitchenSchema().catch((error) => logger.error('[KITCHEN_SCHEMA] initialization failed:', error.message));
ensureLegacyKitchenReceiptLedger().catch((error) => logger.error('[KITCHEN_RECEIPT_LEDGER] initialization failed:', error.message));
// Procurement center: suppliers directory, payments, statements, invoice payment status.
app.use('/api/procurement', (req, res, next) => { req.io = io; next(); }, procurementRouter);
ensureProcurementSchema().catch((error) => logger.error('[PROCUREMENT_SCHEMA] initialization failed:', error.message));
// Finance P&L: live income statement built from real recorded movements (sales, COGS, shrinkage, opex, payroll).
app.use('/api/finance', (req, res, next) => { req.io = io; next(); }, financeRouter);
// Accounting dept: chart of accounts + double-entry journal + CFO summary.
const { router: accountingRouter } = require('./accounting-routes');
app.use('/api/accounting', (req, res, next) => { req.io = io; next(); }, accountingRouter);
// Accounting controls (isolated): period lock + draft/approve + balance-sheet + cash-flow.
// Guarded load — any failure here never takes the core ledger down.
try {
    const acctPeriods = require('./accounting-periods');
    app.use('/api/accounting', (req, res, next) => { req.io = io; next(); }, acctPeriods.router);
    acctPeriods.ensureAccountingPeriodsSchema();
} catch (e) {
    logger.error('[ACCOUNTING_PERIODS] module failed to load — controls disabled, ledger still running:', e.message);
}
try {
    const acctGrowth = require('./accounting-growth');
    app.use('/api/accounting', (req, res, next) => { req.io = io; next(); }, acctGrowth.router);
    acctGrowth.ensureAccountingGrowthSchema();
} catch (e) {
    logger.error('[ACCOUNTING_GROWTH] module failed to load — growth disabled, ledger still running:', e.message);
}
try {
    const budgetAlerts = require('./budget-alerts');
    app.use('/api/accounting', (req, res, next) => { req.io = io; next(); }, budgetAlerts.router);
    budgetAlerts.ensureBudgetAlertsSchema();
    budgetAlerts.startAlertsScheduler(io);
} catch (e) {
    logger.error('[BUDGET_ALERTS] module failed to load — alerts disabled, ledger still running:', e.message);
}
// User permission grants (admin assigns; additive over roles).
const { router: permissionRouter } = require('./permission-routes');
app.use('/api/permissions', (req, res, next) => { req.io = io; next(); }, permissionRouter);

// Task 20: صندوق إشعارات كل مستخدم — جرس حي بعدّاد غير المقروء + إشعارات سلسلة الصرف
ensureNotificationsSchema().catch((error) => logger.error('[NOTIFICATIONS_SCHEMA] initialization failed:', error.message));
ensureDispatchCreatorSchema().catch((error) => logger.error('[DISPATCH_CREATOR_SCHEMA] initialization failed:', error.message));
// SECURITY ROOT FIX 2026-10-02: كانت مفتوحة بلا jwtAuth — أي متصفح كان يستطيع
// إرسال/قراءة إشعارات النظام. مُحمية الآن بمصادقة الحسابات.
app.use('/api/notifications', jwtAuth, (req, res, next) => { req.io = io; next(); }, notificationRouter);

// ─── ZKTeco biometric sync (inside the ERP process) ───
// أجهزة البصمة + ربط الموظفين + بصمات بوابة الموظف
app.use('/api/zkteco', (req, res, next) => { req.io = io; req.app.locals.attendanceEngine = attendanceEngine; next(); }, zktecoRouter);

// ─── Attendance PUSH channel (Face/Hikvision → queue → unified engine) ───
// معزول ومحمي: أي فشل هنا لا يسقط السيرفر (نفس discipline مثل whatsapp-engine).
// POST /api/v1/attendance/push (Bearer per-device, 202 fast) — يعمل حتى بدون Redis عبر SQL mirror.
let attendancePush = null;
try {
    attendancePush = require('./attendance-push');
    app.use('/api/v1/attendance', (req, res, next) => { req.io = io; next(); }, attendancePush.router);
    attendancePush.ensureAttendancePushSchema()
        .then(() => attendancePush.startEmbeddedPoller(io))
        .catch((error) => logger.error('[ATTENDANCE_PUSH_SCHEMA] init skipped (non-fatal):', error.message));
} catch (e) {
    logger.error('[ATTENDANCE_PUSH] module failed to load — push channel disabled, core still running:', e.message);
}

// ─── Yarasoft POS invoice import (inside the ERP process) ───
// استيراد فواتير نقاط البيع من مشاركة الشبكة — قراءة فقط من Yarasoft
app.use('/api/yarasoft', (req, res, next) => { req.io = io; req.app.locals.yarasoftEngine = yarasoftEngine; next(); }, yarasoftRouter);
// ─── Oracle Data Browser (جداول Oracle المنسوخة) ──────────────────────────
const oracleDataRouter = require('./yarasoft/oracle-data-routes');
app.use('/api/oracle-data', oracleDataRouter);
// ─── تقارير إيرادات الأقسام اليومية/الشهرية/السنوية (إغلاقات معتمدة) ────────
app.use('/api/yara-reports', require('./yarasoft/yara-reports'));
// ─── النسخ الاحتياطي الكامل والاستعادة بزر واحد (مدير فقط) ─────────────
const systemRouter = require('./system-routes');
app.use('/api/system', (req, res, next) => { req.io = io; next(); }, systemRouter);
// ─── محرك واتساب (Baileys — معطّل حتى WHATSAPP_ENABLED=true) ─────────────
// محرك واتساب تحميله محمي: بيئة تشغيل لا تدعم require(ESM) (baileys) —
// مثل Node 18 المدمج في إلكترون — تعطل تحميله يجب ألا يُسقط الخادم كله.
let whatsappRouter = null, ensureWhatsappSchema = null, whatsappEngine = null;
try {
    ({ router: whatsappRouter, ensureWhatsappSchema, whatsappEngine } = require('./whatsapp-engine'));
} catch (e) {
    logger.error('[WHATSAPP] تعذر تحميل محرك واتساب — يعمل النظام بدونه:', e.message);
}
app.use('/api/whatsapp', (req, res, next) => {
    req.io = io;
    req.app.locals.whatsappEngine = whatsappEngine;
    next();
}, whatsappRouter || ((req, res) => res.status(503).json({ error: 'WHATSAPP_UNAVAILABLE', message: 'محرك واتساب غير متاح في بيئة التشغيل الحالية' })));

// -------------------------------------------------------
// Database Connection Pool (imported from shared-pool.js)
// -------------------------------------------------------
// Pool is already created and exported from shared-pool.js
// Export for backward compatibility with any code that requires server.js.__pool__
module.exports.__pool__ = pool;

// Helper function to handle async routes
const asyncHandler = fn => (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
};

// Manager live briefing: cashiers + expenses + stock gaps + forecast + attendance + pending.
app.get('/api/manager/briefing', jwtAuth, requireRole('admin', 'manager'), asyncHandler(async (req, res) => {
    const { collectBriefing } = require('./manager-briefing');
    res.json({ ok: true, ...(await collectBriefing(pool, req.query.date)) });
}));

// Daily management report: database-backed preview and optional SMTP delivery.
app.get('/api/reports/daily', jwtAuth, requireRole('admin', 'manager', 'auditor'), asyncHandler(async (req, res) => {
    const report = await collectDailyReport(pool, req.query.date || undefined);
    res.type('html').send(renderDailyReportHtml(report));
}));
app.post('/api/reports/daily/send', jwtAuth, requireRole('admin', 'manager'), asyncHandler(async (req, res) => {
    if (!smtpConfigured()) {return res.status(503).json({ error: 'REPORT_SMTP_NOT_CONFIGURED', message: 'أضف إعدادات SMTP ومستلمي التقرير في ملف البيئة على الخادم.' });}
    const report = await sendDailyReport(pool, req.body?.date || undefined);
    res.json({ status: 'sent', reportDate: report.reportDate, recipients: process.env.REPORT_EMAIL_TO });
}));

// -------------------------------------------------------
// Socket.io — Connection Handling
// -------------------------------------------------------
io.on('connection', (socket) => {
    const clientIp = socket.handshake.address.replace('::ffff:', '');
    const deviceName = socket.handshake.query.deviceName || `جهاز (${clientIp})`;

    connectedClients.set(socket.id, {
        ip: clientIp,
        deviceName,
        joinedAt: new Date().toISOString(),
        socketId: socket.id,
    });

    const clientCount = connectedClients.size;
    logger.info(`🟢 [Socket] اتصل: ${deviceName} (${clientIp}) — إجمالي: ${clientCount} جهاز`);

    // Notify all clients about new connection
    emitScoped('device_connected', {
        deviceName,
        ip: clientIp,
        totalClients: clientCount,
        clients: Array.from(connectedClients.values()).map(c => ({
            deviceName: c.deviceName,
            ip: c.ip,
            joinedAt: c.joinedAt,
        })),
    });

    // Send current client list to the newly connected device
    socket.emit('clients_list', Array.from(connectedClients.values()).map(c => ({
        deviceName: c.deviceName,
        ip: c.ip,
        joinedAt: c.joinedAt,
    })));

    // Task 20: تسجيل هوية المستخدم على الغرف — الإشعارات الفورية توجَّه عبر
    // user:<id> و role:<role> و dept:<dept_code>، والصلاحيات تُقرأ من قاعدة
    // البيانات (لا من رسالة العميل) حتى لا يمكن انتحال غرفة غير حقها.
    socket.on('register_user', async (data) => {
        if (!rtGuard(socket, 'register_user')) {return;}
        try {
            // SECURITY: الهوية تُؤخذ من JWT المُتحقق منه في الـ handshake فقط —
            // عميل مجهول يزعم أي userId كان سيُلتحق بغرف إشعارات ومحادثات مستخدم آخر.
            const verified = socket.data.rtUser;
            if (!verified || !verified.id) {
                socket.emit('user_register_rejected', { reason: 'AUTH_REQUIRED', message: 'أعد تسجيل الدخول لتفعيل الإشعارات الفورية' });
                return;
            }
            const userId = Number(verified.id);
            if (!Number.isInteger(userId) || userId <= 0) {return;}
            const user = (await pool.query('SELECT id, username, role, dept_code FROM users WHERE id = $1 AND active = true', [userId])).rows[0];
            if (!user) {return;}
            // تبديل هوية على نفس المقبس (خروج ثم دخول) — اترك غرف المستخدم السابق أولًا
            for (const room of socket.data.identityRooms || []) {socket.leave(room);}
            const identityRooms = [`user:${user.id}`];
            if (user.role) {identityRooms.push(`role:${user.role}`);}
            if (user.dept_code) {identityRooms.push(`dept:${user.dept_code}`);}
            identityRooms.forEach(room => socket.join(room));
            socket.data.identityRooms = identityRooms;
            const client = connectedClients.get(socket.id);
            if (client) {client.userId = user.id;}
            socket.emit('user_registered', { userId: user.id, role: user.role, dept_code: user.dept_code || null });
        } catch (error) {
            logger.warn('[Socket] register_user failed:', error.message);
        }
    });

    // Handle disconnect
    socket.on('disconnect', (reason) => {
        socketLimiter.reset(socket.id);
        const client = connectedClients.get(socket.id);
        if (client) {
            connectedClients.delete(socket.id);
            const remaining = connectedClients.size;
            logger.info(`🔴 [Socket] انقطع: ${client.deviceName} (${client.ip}) — سبب: ${reason} — متبقي: ${remaining}`);

            emitScoped('device_disconnected', {
                deviceName: client.deviceName,
                ip: client.ip,
                totalClients: remaining,
                clients: Array.from(connectedClients.values()).map(c => ({
                    deviceName: c.deviceName,
                    ip: c.ip,
                    joinedAt: c.joinedAt,
                })),
            });
        }
    });

    // Handle ping for latency check
    socket.on('ping_check', (data) => {
        if (!rtGuard(socket, 'ping_check')) {return;}
        socket.emit('pong_check', { ...data, serverTime: Date.now() });
    });

    // Handle manual data request
    socket.on('request_sync', async () => {
        if (!rtGuard(socket, 'request_sync')) {return;}
        try {
            const result = await pool.query('SELECT state_data FROM app_state WHERE id = 1');
            if (result.rows.length > 0 && result.rows[0].state_data) {
                socket.emit('sync_data', result.rows[0].state_data);
            }
        } catch (e) {
            logger.error('[Socket] Failed to send sync data:', e.message);
        }
    });

    // Handle notification broadcast (device-to-device messaging)
    socket.on('broadcast_notification', (data) => {
        if (!rtGuard(socket, 'broadcast_notification')) {return;}
        if (isRtAuthRequired() && !socket.data.authed) {return;}
        const client = connectedClients.get(socket.id);
        // Guard against malformed payloads (data may be undefined)
        const payload = data && typeof data === 'object' ? data : {};
        // Broadcast to all OTHER clients
        socket.broadcast.emit('incoming_notification', {
            from: client ? client.deviceName : 'جهاز مجهول',
            fromIp: client ? client.ip : 'unknown',
            message: String(payload.message || '').slice(0, 2000),
            type: payload.type || 'info',
            timestamp: new Date().toISOString(),
        });
    });
});

// ─── الشات الداخلي للأجهزة المتصلة ─────────────────────────────
// رسائل بشرية بين الطاقم: حفظ دائم + بث لحظي + سجل. سياسة العرض في الواجهة.
// جدول صغير يُنشأ كسولًا + تقليم أقدم من 7 أيام مع كل إرسال.
let _chatSchemaReady = null;
function ensureChatSchema() {
    if (_chatSchemaReady) {return _chatSchemaReady;}
    _chatSchemaReady = pool.query(`
        CREATE TABLE IF NOT EXISTS internal_chat (
            id BIGSERIAL PRIMARY KEY,
            from_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
            from_name VARCHAR(120) NOT NULL DEFAULT '—',
            from_device VARCHAR(160) NOT NULL DEFAULT '',
            body TEXT NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_internal_chat_created ON internal_chat (created_at DESC);
        ALTER TABLE internal_chat ADD COLUMN IF NOT EXISTS to_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL;
        CREATE INDEX IF NOT EXISTS idx_internal_chat_pair ON internal_chat (from_user_id, to_user_id, id DESC);
    `).catch((e) => { _chatSchemaReady = null; throw e; });
    return _chatSchemaReady;
}
const _chatThrottle = new Map(); // userId -> last send timestamp (anti-spam)
async function handleChatSend({ userId, toUserId, body }) {
    // eslint-disable-next-line no-control-regex -- تعقيم مقصود: إزالة أحرف التحكم من مدخلات المحادثة
    const text = String(body || '').replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '').trim().slice(0, 1000);
    if (!text) {const e = new Error('EMPTY_MESSAGE'); e.statusCode = 422; throw e;}
    const peer = Number(toUserId);
    if (!Number.isInteger(peer) || peer <= 0) {const e = new Error('PEER_REQUIRED'); e.statusCode = 422; throw e;}
    if (peer === Number(userId)) {const e = new Error('SELF_CHAT'); e.statusCode = 422; throw e;}
    const now = Date.now();
    if (now - (_chatThrottle.get(Number(userId)) || 0) < 2000) {
        const e = new Error('TOO_FAST'); e.statusCode = 429; throw e;
    }
    _chatThrottle.set(Number(userId), now);
    await ensureChatSchema();
    const u = (await pool.query('SELECT id, username, name, role FROM users WHERE id = $1 AND active = true', [Number(userId)])).rows[0];
    if (!u) {const e = new Error('UNKNOWN_USER'); e.statusCode = 401; throw e;}
    const p = (await pool.query('SELECT id FROM users WHERE id = $1 AND active = true', [peer])).rows[0];
    if (!p) {const e = new Error('PEER_NOT_FOUND'); e.statusCode = 404; throw e;}
    const r = (await pool.query(
        `INSERT INTO internal_chat (from_user_id, from_name, from_device, body, to_user_id) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [u.id, u.name || u.username, '', text, peer]
    )).rows[0];
    pool.query(`DELETE FROM internal_chat WHERE created_at < NOW() - INTERVAL '7 days'`).catch(() => {});
    return r;
}

// سجل محادثة خاصة مع موظف (أحدث 50) — ?with=<userId> إجباري (لا عام)
app.get('/api/chat/history', jwtAuth, async (req, res) => {
    try {
        const peer = Number(req.query.with);
        if (!Number.isInteger(peer) || peer <= 0) {
            return res.status(422).json({ error: 'PEER_REQUIRED', message: 'حدد الموظف (with)' });
        }
        await ensureChatSchema();
        const r = await pool.query(
            `SELECT id, from_user_id, to_user_id, from_name, body, created_at FROM internal_chat
              WHERE (from_user_id = $1 AND to_user_id = $2) OR (from_user_id = $2 AND to_user_id = $1)
              ORDER BY id DESC LIMIT 50`,
            [Number(req.user.id), peer]);
        res.json({ ok: true, messages: r.rows.reverse() });
    } catch (e) {
        logger.error('[chat] history failed:', e.message);
        res.status(500).json({ error: 'CHAT_HISTORY_FAILED', message: 'تعذر جلب سجل الشات' });
    }
});

// قائمة موظفي الإدارة والمخازن للاختيار + المتصل منهم الآن
app.get('/api/chat/users', jwtAuth, async (req, res) => {
    try {
        const r = await pool.query(
            `SELECT id, username, name, role FROM users WHERE active = true AND role IN ('admin','manager','hr','warehouse') AND id <> $1 ORDER BY name LIMIT 200`,
            [Number(req.user.id)]);
        const online = new Set();
        for (const c of connectedClients.values()) { if (c.userId) {online.add(Number(c.userId));} }
        res.json({ ok: true, users: r.rows.map((u) => ({ ...u, online: online.has(Number(u.id)) })) });
    } catch (e) {
        logger.error('[chat] users failed:', e.message);
        res.status(500).json({ error: 'CHAT_USERS_FAILED', message: 'تعذر جلب الموظفين' });
    }
});

// إرسال رسالة خاصة — حفظ + توصيل للطرفين فقط عبر غرف user:<id>
app.post('/api/chat/send', jwtAuth, async (req, res) => {
    try {
        const row = await handleChatSend({ userId: req.user.id, toUserId: req.body?.to_user_id, body: req.body?.body });
        try {
            io.to(`user:${row.from_user_id}`).emit('chat:new', row);
            io.to(`user:${row.to_user_id}`).emit('chat:new', row);
        } catch (_) {}
        res.status(201).json({ ok: true, message: row });
    } catch (e) {
        const map = { EMPTY_MESSAGE: [422, 'الرسالة فارغة'], PEER_REQUIRED: [422, 'حدد الموظف'], SELF_CHAT: [422, 'لا تراسل نفسك'], PEER_NOT_FOUND: [404, 'الموظف غير موجود'], TOO_FAST: [429, 'تمهل ثانيتين بين الرسائل'] };
        const pair = map[e.message] || [e.statusCode || 500, 'تعذر إرسال الرسالة'];
        res.status(pair[0]).json({ error: e.message, message: pair[1] });
    }
});

// -------------------------------------------------------
// Routes
// -------------------------------------------------------

// Root redirect
app.get('/', (req, res) => {
    res.redirect('/app/index.html');
});

// ─── Enterprise-grade Health Router (live / ready / startup / verbose) ───
// Mounted BEFORE apiKeyMiddleware + rejectDuringShutdown — LB probes
// must always succeed (otherwise the service is removed from rotation when
// it's just the key missing). Mounted at both /api/health and /health.
{
    const healthRouter = createHealthRouter({
        pool,
        redis: null,
        dataDir: path.resolve(__dirname, '..', 'database', 'data'),
    });
    // Extra readiness check: socket.io attached clients
    registerCheck(() => ({
        component: 'realtime',
        status: 'ok',
        details: {
            connectedClients: connectedClients.size,
            clients: Array.from(connectedClients.values()).map(c => ({
                deviceName: c.deviceName,
                ip: c.ip,
                joinedAt: c.joinedAt,
            })),
        },
    }));
    // TASK 8: outbox publisher stall + lag gate the /ready endpoint.
    // ok = flowing; warn = lag/dead-letters; fail = loop stalled (>30s) → 503.
    registerCheck(async () => {
        try {
            const { outboxStats } = require('./realtime/publisher');
            const st = outboxStats();
            let lagSec = 0;
            try {
                const r = await pool.query(
                    `SELECT COALESCE(EXTRACT(EPOCH FROM (NOW() - MIN(created_at)))::int, 0) AS lag
                      FROM event_outbox WHERE published_at IS NULL`);
                lagSec = Number(r.rows[0]?.lag || 0);
            } catch (_) {return { component: 'outbox', status: 'warn', details: { reason: 'table_unchecked' } };}
            const lastCycleMs = st.lastCycleAt ? Date.now() - new Date(st.lastCycleAt).getTime() : null;
            const details = { ...st, lagSec };
            if (st.cycles > 0 && lastCycleMs != null && lastCycleMs > 30000) {
                return { component: 'outbox', status: 'fail', details };
            }
            if (lagSec > 60 || (st.deadLettered || 0) > 0) {
                return { component: 'outbox', status: lagSec > 60 ? 'fail' : 'warn', details };
            }
            return { component: 'outbox', status: 'ok', details };
        } catch (e) {
            return { component: 'outbox', status: 'warn', error: e.message };
        }
    });
    // TASK 8: websocket accepting gate — fail when the listener is down.
    registerCheck(() => {
        try {
            const listening = Boolean(httpServer?.listening);
            const clients = io?.engine ? Number(io.engine.clientsCount || 0) : 0;
            return { component: 'websocket', status: listening ? 'ok' : 'fail', details: { listening, clients } };
        } catch (e) {
            return { component: 'websocket', status: 'fail', error: e.message };
        }
    });
    // Extra: shutdown probe (k8s-aware)
    registerCheck(() => {
        const s = getShutdownStatus();
        return {
            component: 'shutdown',
            status: s?.shuttingDown ? 'warn' : 'ok',
            details: s,
        };
    });
    circuitRegisterHealth();
    app.use('/api/health', healthRouter);
    app.use('/health',      healthRouter);

    // ─── هوية الخادم + قناة تحديث العملاء عبر الشبكة (EXE عميل/سيرفر) ───
    // العميل يكتشف السيرفر عبر UDP (common/lan-discovery) ثم يتحقق من هنا،
    // وملف latest.yml + حزمة التثبيت داخل مجلد updates يكفيان لتحديث كل
    // أجهزة الشبكة من السيرفر نفسه — بلا إنترنت ولا GitHub.
    const SERVER_PKG_VERSION = (() => { try { return require('../package.json').version || ''; } catch (_) { return ''; } })();
    const UPDATES_DIR = process.env.KARIM_UPDATES_DIR
        || (process.resourcesPath ? path.join(process.resourcesPath, 'updates')
            : path.join(__dirname, '..', 'updates'));
    try { require('fs').mkdirSync(UPDATES_DIR, { recursive: true }); } catch (_) {}
    app.use('/updates', express.static(UPDATES_DIR, { index: false, dotfiles: 'deny', fallthrough: true }));
    app.get('/api/server/info', (req, res) => {
        res.json({
            ok: true,
            app: 'karim-erp',
            version: SERVER_PKG_VERSION,
            serverName: process.env.KARIM_SERVER_NAME || require('os').hostname(),
            scheme: LAN_SCHEME,
            serverTime: new Date().toISOString(),
            uptimeSeconds: Math.round(process.uptime()),
        });
    });
}

// ─── Idempotency Middleware (write-safe by default on /api) ───
// Clients send X-Idempotency-Key header. Replayed keys with identical
// bodies replay the cached response. Different bodies with same key → 409.
app.use('/api', idempotency({
    ttlMs: 24 * 60 * 60 * 1000,
    methods: ['POST', 'PUT', 'PATCH', 'DELETE'],
    requireKey: false,
}));
ensureIdempotencySchema(pool).catch((e) => logger.warn('[idempotency] schema skipped:', e.message));

// Network info — SECURITY: طوبولوجيا الشبكة (كل عناوين LAN) تُخفى خلف JWT.
// كان يُقرأ بمفتاح التطبيق وحده، والمفتاح يوزع على كل عميل بعد تسجيل الدخول.
// عميل الاكتشاف (EXE) يقرأ /server/info العامة — لا يحتاج هذا المسار.
app.get('/api/network-info', jwtAuth, (req, res) => {
    const nets = os.networkInterfaces();
    const results = {};
    for (const name of Object.keys(nets)) {
        for (const net of nets[name]) {
            if (net.family === 'IPv4' && !net.internal) {
                if (!results[name]) {results[name] = [];}
                results[name].push(net.address);
            }
        }
    }
    res.json({
        ips: results,
        port: PORT,
        urls: Object.values(results).flat().map(ip => `http://${ip}:${PORT}`),
        connectedClients: connectedClients.size,
    });
});

// Connected clients list — SECURITY: كذلك خلف JWT (أسماء أجهزة + عناوين).
app.get('/api/clients', jwtAuth, (req, res) => {
    res.json({
        count: connectedClients.size,
        clients: Array.from(connectedClients.values()).map(c => ({
            deviceName: c.deviceName,
            ip: c.ip,
            joinedAt: c.joinedAt,
        })),
    });
});

// ─── Runtime metrics (enterprise observability) ─────────────
// لقطة حية: عدّادات الطلبات ومئينات زمن الاستجابة وتأخر حلقة الأحداث
// وذاكرة العملية واستغلال مسبّح قاعدة البيانات — للمالك/المدير فقط.
ensurePasswordVaultSchema().catch((e) => logger.warn('[pw-vault] schema skipped:', e.message));

// خزنة كلمات المرور: عرض نسخة كلمة المرور المسجلة — للأدمن حصريًا (قرار المالك
// لمساعدة الموظف النسي كلمته). بلا نسخة محفوظة ترجع available:false بدل فشل.
app.get('/api/users/:id/password', jwtAuth, requireRole('admin'), asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {return res.status(422).json({ error: 'USER_ID_INVALID', message: 'معرف المستخدم غير صالح' });}
    try {
        const r = await pool.query('SELECT password_vault FROM users WHERE id = $1', [id]);
        if (!r.rows[0]) {return res.status(404).json({ error: 'USER_NOT_FOUND', message: 'المستخدم غير موجود' });}
        res.set('Cache-Control', 'no-store');
        const plain = decryptFromVault(r.rows[0].password_vault);
        if (!plain) {return res.json({ ok: true, available: false, message: 'لا توجد نسخة محفوظة لهذا الحساب — أعد تعيين كلمة المرور من «تعديل الحساب» وستُسجَّل' });}
        res.json({ ok: true, available: true, password: plain });
    } catch (e) {
        logger.error('[pw-vault] view failed:', e.message);
        res.status(500).json({ error: 'VAULT_VIEW_FAILED', message: 'تعذر جلب كلمة المرور' });
    }
}));

app.get('/api/metrics', jwtAuth, requireRole('admin', 'manager'), (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json(metrics.snapshot(pool));
});

// ─── DB Constraints API (for client-side validation) ────────
// يعرض قيود الجداول (NOT NULL, types, lengths, UNIQUE, FK, CHECK) للفرونت إند
app.get('/api/schema/constraints', jwtAuth, asyncHandler(async (req, res) => {
    const { loadConstraints } = require('./db-constraints');
    const constraints = await loadConstraints();
    
    // تبسيط الاستجابة للعميل
    const simplified = {};
    for (const [tableName, table] of Object.entries(constraints)) {
      simplified[tableName] = {
        columns: {},
        uniqueConstraints: table.constraints.filter(c => c.type === 'u').map(c => ({
          name: c.name,
          columns: c.def.match(/UNIQUE\s*\(([^)]+)\)/i)?.[1]?.split(',').map(s => s.trim().replace(/"/g, '')) || [],
        })),
        foreignKeys: table.constraints.filter(c => c.type === 'f').map(c => {
          const match = c.def.match(/FOREIGN KEY\s*\(([^)]+)\)\s*REFERENCES\s+(\w+)\s*\(([^)]+)\)/i);
          return match ? {
            name: c.name,
            columns: match[1].split(',').map(s => s.trim().replace(/"/g, '')),
            refTable: match[2],
            refColumns: match[3].split(',').map(s => s.trim().replace(/"/g, '')),
          } : null;
        }).filter(Boolean),
        checkConstraints: table.constraints.filter(c => c.type === 'c').map(c => ({
          name: c.name,
          def: c.def,
        })),
      };
      
      for (const [colName, col] of Object.entries(table.columns)) {
        simplified[tableName].columns[colName] = {
          type: col.type,
          nullable: col.nullable,
          default: col.default,
          maxLength: col.maxLength,
          precision: col.precision,
          scale: col.scale,
        };
      }
    }
    
    res.json(simplified);
}));


// -------------------------------------------------------
// State Sync (JWT-protected — frontend now sends Bearer token)
// The main frontend authenticates via POST /api/auth/login and
// attaches the JWT to every /api/* request (see realtime.js).
// State endpoints accept any authenticated user for GET, but
// require admin role for POST (write) and DELETE (destructive).
// -------------------------------------------------------
app.get('/api/state', jwtAuth, generalLimiter, asyncHandler(async (req, res) => {
    const result = await pool.query('SELECT state_data FROM app_state WHERE id = 1');
    if (result.rows.length > 0 && result.rows[0].state_data) {
        const saved = result.rows[0].state_data;
        return res.json({
            lang: saved.lang === 'en' ? 'en' : 'ar',
            theme: saved.theme === 'light' ? 'light' : 'dark',
        });
    }
    res.status(404).json({ error: 'No preferences found' });
}));

app.post('/api/state', jwtAuth, requireRole('admin', 'manager'), stateLimiter, asyncHandler(async (req, res) => {
    const rawState = req.body;
    if (!rawState || typeof rawState !== 'object' || Array.isArray(rawState)) {
        return res.status(400).json({ error: 'Invalid preferences format' });
    }

    // app_state is a compatibility store for UI preferences only.
    // Business entities must use their own PostgreSQL tables and CRUD routes.
    const rawStateSize = JSON.stringify(rawState).length;
    if (rawStateSize > 64 * 1024) {
        return res.status(413).json({ error: 'PREFERENCES_TOO_LARGE', message: 'حمولة التفضيلات أكبر من الحد المسموح' });
    }
    const state = {
        lang: rawState.lang === 'en' ? 'en' : 'ar',
        theme: rawState.theme === 'light' ? 'light' : 'dark',
    };
    const stateSize = JSON.stringify(state).length;

    // ─── AUDIT LOG: Record who saved state ─────────────
    const auditInfo = {
        userId: req.user?.id || null,
        userRole: req.user?.role || null,
        deviceName: sanitizeHeader(req.headers['x-device-name']),
        ip: req.ip,
        timestamp: new Date().toISOString(),
        stateSize: rawStateSize,
    };

    await pool.query(
        `INSERT INTO app_state (id, state_data, updated_at) 
         VALUES (1, $1, CURRENT_TIMESTAMP) 
         ON CONFLICT (id) DO UPDATE SET state_data = EXCLUDED.state_data, updated_at = CURRENT_TIMESTAMP`,
        [JSON.stringify({ ...state, _audit: auditInfo })]
    );

    // Log the save operation (structured logging)
    logger.info(JSON.stringify({
        level: 'info',
        action: 'state_save',
        userId: auditInfo.userId,
        userRole: auditInfo.userRole,
        deviceName: auditInfo.deviceName,
        ip: auditInfo.ip,
        stateSize: auditInfo.stateSize,
        timestamp: auditInfo.timestamp,
    }));

    // 🔴 REAL-TIME: Notify ALL other devices that data has been updated
    const senderSocket = req.headers['x-socket-id'];
    const payload = {
        updatedAt: new Date().toISOString(),
        updatedBy: auditInfo.deviceName || req.ip,
        source: 'state_save',
    };

    emitScoped('state_updated', payload, senderSocket || undefined);

    // Trigger async backup (throttled + windowsHide → لا نافذة سوداء)
    scheduleBackup();

    res.json({ status: 'success', message: 'State saved and all devices notified.' });
}));

// DELETE /api/state — DANGEROUS: requires admin role
// ROOT FIX 2026-10-02: مرآة قيود المصاريف — كل مصروف يدوي يقابله قيد
// Dr 6900 مصروف / Cr 1000 صندوق، ويُحدَّث/يُمسح مع تعديل أو حذف المصروف
// حتى يعكس الأستاذ دائمًا الواقع التشغيلي (idempotent بمعرف المصروف).
async function purgeExpenseJournal(expenseId) {
    try {
        await pool.query(`DELETE FROM journal_lines WHERE entry_id IN (SELECT id FROM journal_entries WHERE source_type='expense' AND source_id=$1)`, [String(expenseId)]);
        await pool.query(`DELETE FROM journal_entries WHERE source_type='expense' AND source_id=$1`, [String(expenseId)]);
    } catch (e) { logger.warn("[expense-journal-purge]", e.message); }
}
async function postExpenseJournal(expenseRow) {
    try {
        const amt = Number(expenseRow?.amount) || 0;
        if (!(amt > 0)) {return;}
        const { postJournal } = require('./accounting-routes');
        const day = /^\d{4}-\d{2}-\d{2}$/.test(String(expenseRow.date || '').slice(0, 10)) ? String(expenseRow.date).slice(0, 10) : new Date().toISOString().slice(0, 10);
        await postJournal(pool, {
            date: day,
            memo: `مصروف ${expenseRow.category || ''} — ${String(expenseRow.notes || '').slice(0, 60)}`.trim(),
            source_type: 'expense', source_id: String(expenseRow.id),
            lines: [
                { account_code: '6900', debit: amt, credit: 0, memo: 'مصروف تشغيلي' },
                { account_code: '1000', debit: 0, credit: amt, memo: 'دفع نقدي من الصندوق' },
            ],
        });
    } catch (e) { logger.warn("[expense-ledger]", e.message); }
}

app.delete('/api/state', jwtAuth, requireRole('admin'), asyncHandler(async (req, res) => {
    // ─── AUDIT LOG: Record who cleared state ────────────
    const auditInfo = {
        userId: req.user?.id || null,
        userRole: req.user?.role || null,
        deviceName: sanitizeHeader(req.headers['x-device-name']),
        ip: req.ip,
        timestamp: new Date().toISOString(),
    };

    logger.info(JSON.stringify({
        level: 'warn',
        action: 'state_delete',
        userId: auditInfo.userId,
        userRole: auditInfo.userRole,
        deviceName: auditInfo.deviceName,
        ip: auditInfo.ip,
        timestamp: auditInfo.timestamp,
    }));

    await pool.query('DELETE FROM app_state WHERE id = 1');

    const senderSocket = req.headers['x-socket-id'];
    const payload = {
        updatedAt: new Date().toISOString(),
        updatedBy: auditInfo.deviceName || req.ip,
        source: 'state_reset',
    };

    emitScoped('state_updated', payload, senderSocket || undefined);

    res.json({ status: 'success', message: 'Application state cleared from database.' });
}));

// -------------------------------------------------------
// Dynamic CRUD Endpoints — emit real-time events on every change
// All endpoints require JWT authentication
// -------------------------------------------------------

// ─── Helper: auto-generate a client-side-style id for legacy tables ──
// The original schema (001_schema.sql) uses `id BIGINT PRIMARY KEY` without
// a DEFAULT or sequence — clients were expected to mint their own ids using
// the frontend `uid()` algorithm: `Date.now() + Math.floor(Math.random()*9999)`.
// The schema-registry marks `id` as protected (clients cannot send it), so
// the POST handler must mint one server-side when the entity needs it.
// Milliseconds × 1000 + a crypto-random suffix keeps BIGINT headroom while
// making same-millisecond collisions virtually impossible under bursts.
function generateLegacyId() {
    return Date.now() * 1000 + crypto.randomInt(0, 1000);
}
function prepareDbValue(entity, key, value) {
    const schema = getSchema(entity);
    if (schema?.types?.[key] === 'json' && value !== null && value !== undefined && typeof value !== 'string') {
        return JSON.stringify(value);
    }
    return value;
}

function ensureIdForEntity(entity, body) {
    const schema = require('./schema-registry').getSchema(entity);
    if (!schema) {return body;}
    const isProtected = schema.protected && schema.protected.includes('id');
    if (!isProtected) {return body;}
    if (body.id !== undefined) {return body;}
    return { ...body, id: generateLegacyId() };
}

/**
 * Task 19: التحقق من ربط حساب رئيس القسم بقسم صحيح عند إنشاء المستخدم.
 * FIX 2026-10-03: الواجهة تعرض أقسام HR (hrDepartments) وتدعم اختيار أكثر من
 * قسم (dept_code بفواصل)، وكان التحقق يقارن النص كاملًا ككود واحد في جدول
 * departments التشغيلي فقط — فيفشل "القسم المختار غير موجود" لأغلب الأقسام.
 * المقارنة الآن لكل كود على حدة في جدولي hrDepartments وdepartments معًا
 * (نفس سلوك deptNameByCode في الواجهة)، بدون حساسية لحالة الأحرف.
 */
function splitDeptCodes(raw) {
    return String(raw || '').split(',').map(x => x.trim()).filter(Boolean);
}

async function assertDeptHeadCodesExist(deptList) {
    const known = new Set(
        (await pool.query('SELECT LOWER(code) AS code FROM departments UNION SELECT LOWER(code) FROM "hrDepartments"'))
            .rows.map(r => String(r.code))
    );
    const unknown = deptList.filter(c => !known.has(c.toLowerCase()));
    if (unknown.length) {
        const error = new Error(`القسم المختار غير موجود: ${unknown.join(', ')}`);
        error.statusCode = 422;
        error.code = 'DEPT_NOT_FOUND';
        throw error;
    }
}

async function validateDeptHeadUserLink(entity, filtered) {
    if (entity !== 'users') {return;}
    if ('role' in filtered && filtered.role !== 'dept_head') {return;} // غير رئيس قسم: لا ربط مطلوب
    const deptList = splitDeptCodes(filtered.dept_code);
    if (!deptList.length) {
        const error = new Error('حساب رئيس القسم يجب ربطه بقسم — اختر القسم من القائمة');
        error.statusCode = 422;
        error.code = 'DEPT_HEAD_DEPARTMENT_REQUIRED';
        throw error;
    }
    await assertDeptHeadCodesExist(deptList);
}

/**
 * Task 19: نفس التحقق عند التعديل — يدمج الدور والقسم الفعليين بعد التغيير.
 */
async function validateDeptHeadUserUpdate(filtered, userId) {
    if (!('role' in filtered) && !('dept_code' in filtered)) {return;}
    const existing = (await pool.query('SELECT role, dept_code FROM users WHERE id=$1', [userId])).rows[0];
    if (!existing) {return;} // لا يوجد مستخدم — يُعالج لاحقًا بـ 404
    const effectiveRole = 'role' in filtered ? filtered.role : existing.role;
    if (effectiveRole !== 'dept_head') {return;}
    const effectiveDept = filtered.dept_code !== undefined ? String(filtered.dept_code || '') : String(existing.dept_code || '');
    const deptList = splitDeptCodes(effectiveDept);
    if (!deptList.length) {
        const error = new Error('حساب رئيس القسم يجب ربطه بقسم — اختر القسم من القائمة');
        error.statusCode = 422;
        error.code = 'DEPT_HEAD_DEPARTMENT_REQUIRED';
        throw error;
    }
    await assertDeptHeadCodesExist(deptList);
}

/**
 * Security audit 2026-09-03: الخدمة الذاتية للحضور.
 * تسجيل الحضور/الانصراف مسموح لأي موظف لنفسه فقط (بوابة الموظف)، بينما
 * admin/manager/hr يتحكمون بكل السجلات. أي محاولة لتسجيل أو تعديل حضور
 * موظف آخر تُرفض بـ 403 — كانت سابقاً ممكنة من أي حساب مُصادق.
 */
async function enforceAttendanceSelfService(entity, req, filtered, existingId = null) {
    if (entity !== 'attendance') {return filtered;}
    if (['admin', 'manager', 'hr'].includes(req.user?.role)) {return filtered;}
    const own = await pool.query('SELECT id FROM employees WHERE "userId"=$1 LIMIT 1', [req.user.id]);
    if (!own.rows.length) {
        const error = new Error('تسجيل الحضور يتطلب ربط حسابك بملف موظف');
        error.statusCode = 403; error.code = 'EMPLOYEE_LINK_REQUIRED'; throw error;
    }
    const ownId = String(own.rows[0].id);
    if (existingId != null) {
        const rec = await pool.query('SELECT "employeeId" FROM attendance WHERE id=$1', [existingId]);
        if (!rec.rows.length) {
            const error = new Error('سجل الحضور غير موجود');
            error.statusCode = 404; error.code = 'ATTENDANCE_NOT_FOUND'; throw error;
        }
        if (String(rec.rows[0].employeeId) !== ownId) {
            const error = new Error('لا يمكنك تعديل حضور موظف آخر');
            error.statusCode = 403; error.code = 'ATTENDANCE_SELF_ONLY'; throw error;
        }
    }
    if (filtered.employeeId != null && String(filtered.employeeId) !== ownId) {
        const error = new Error('لا يمكنك تسجيل حضور لموظف آخر');
        error.statusCode = 403; error.code = 'ATTENDANCE_SELF_ONLY'; throw error;
    }
    filtered.employeeId = own.rows[0].id;
    return filtered;
}

// Never expose password hashes to browsers, logs, sockets, or export responses.
function publicEntityRow(entity, row) {
    if (entity !== 'users' || !row) {return row;}
    const { password: _password, password_vault: _pwVault, ...safe } = row;
    return safe;
}

// تدقيق أمني جولة 2: طبقة العرض الآمن حسب دور المستخدم —
// password يُكتم دائمًا (publicEntityRow) + رواتب الموظفين تُخفى
// عن الأدوار غير المرتفعة (admin/manager/hr فقط يرون salary).
function viewerSafeRow(entity, row, req) {
    const safe = publicEntityRow(entity, row);
    if (entity === 'employees') {return maskEmployeeRowForRole(safe, req.user?.role);}
    return safe;
}
const entities = [
    'users', 'hrDepartments', 'employees', 'attendance', 'leaveTypes',
    'leaveRequests', 'payroll', 'departments', 'revenues', 'expenses',
    'shelves', 'inventory', 'inventoryTx', 'dispatches', 'recipes',
    'purchaseInvoices', 'kitchenReturns', 'weightReadings', 'notifications', 'settings',
    'salary_advances', 'payroll_adjustments', 'employee_contracts', 'employee_evaluations', 'payroll_runs'
];

// Entities that require admin/manager role for write operations
const adminEntities = ['users', 'payroll', 'settings'];

// Entities whose full listings are sensitive (salaries, accounts, financials)
// — reads are restricted to elevated roles instead of every authenticated
// principal. Security audit 2026-09-03: أُضيفت الكيانات المالية (الإيرادات،
// المصاريف، فواتير الشراء) — كانت قوائمها مقروءة لأي حساب مُصادق.
const sensitiveReadEntities = ['users', 'payroll', 'revenues', 'expenses', 'purchaseInvoices'];
const SENSITIVE_READ_ROLES = ['admin', 'manager', 'accountant', 'auditor'];
// B.6: أدوار قراءة إضافية لكيانات محددة — القائمة المرئية في الواجهة يجب أن
// تعمل: HR يرى الرواتب (يديرها)، وأمين المخزن يرى فواتير الشراء (ينشئها).
const ENTITY_READ_ROLES = {
    payroll: [...SENSITIVE_READ_ROLES, 'hr'],
    purchaseInvoices: [...SENSITIVE_READ_ROLES, 'warehouse'],
    salary_advances: [...SENSITIVE_READ_ROLES, 'hr'],
    payroll_adjustments: [...SENSITIVE_READ_ROLES, 'hr'],
    employee_contracts: [...SENSITIVE_READ_ROLES, 'hr'],
    employee_evaluations: [...SENSITIVE_READ_ROLES, 'hr'],
    payroll_runs: [...SENSITIVE_READ_ROLES, 'hr'],
};
function readRolesFor(entity) {
    return ENTITY_READ_ROLES[entity] || SENSITIVE_READ_ROLES;
}

// Arabic entity names for notifications
const entityNames = {
    users: 'المستخدمون', hrDepartments: 'الأقسام (HR)', employees: 'الموظفون',
    attendance: 'الحضور', leaveTypes: 'أنواع الإجازات', leaveRequests: 'طلبات الإجازة',
    payroll: 'الرواتب', departments: 'الأقسام', revenues: 'الإيرادات',
    expenses: 'المصروفات', shelves: 'الأرفف', inventory: 'المخزون',
    inventoryTx: 'حركات المخزون', dispatches: 'التوزيعات', recipes: 'الوصفات',
    purchaseInvoices: 'فواتير الشراء', kitchenReturns: 'مرتجعات المطبخ',
    weightReadings: 'قراءات الوزن', notifications: 'الإشعارات', settings: 'الإعدادات',
};

async function ensureEmployeeUserLinkSchema() {
    await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS employees_userid_unique_idx
      ON "employees" ("userId") WHERE "userId" IS NOT NULL`);
}

// ─── Dedicated attendance range endpoint (avoids 142-page pagination bottleneck) ───
app.get('/api/attendance/range', jwtAuth, requireRoleOrPerm([...SENSITIVE_READ_ROLES, 'hr'], 'hr.view'), asyncHandler(async (req, res) => {
    const from = String(req.query.from || '').slice(0, 10);
    const to = String(req.query.to || '').slice(0, 10);
    if (!from || !to) {return res.status(400).json({ error: 'MISSING_DATES', message: 'from and to params required (YYYY-MM-DD)' });}
    const limit = Math.min(parseInt(req.query.limit, 10) || 10000, 50000);
    const { rows } = await pool.query(
        `SELECT * FROM attendance WHERE date >= $1 AND date <= $2 ORDER BY date DESC, "employeeId" ASC LIMIT $3`,
        [from, to, limit]
    );
    res.json({ data: rows, total: rows.length, from, to });
}));

/** تحقق هرمية الأقسام: الأب موجود ≠ الذات ≠ دورة — يرجع الكود المطبّع أو null */
async function validateDeptParent(deptCode, parentCode) {
    const p = parentCode == null || String(parentCode).trim() === '' ? null : String(parentCode).trim();
    if (!p) {return null;}
    if (p === deptCode) {
        const error = new Error('القسم لا يمكن أن يكون أبًا لنفسه');
        error.statusCode = 422; error.code = 'DEPT_SELF_PARENT'; throw error;
    }
    const exists = await pool.query('SELECT code FROM departments WHERE code = $1 LIMIT 1', [p]);
    if (!exists.rows.length) {
        const error = new Error('القسم الأب غير موجود');
        error.statusCode = 422; error.code = 'DEPT_PARENT_NOT_FOUND'; throw error;
    }
    // كشف الدورات: اصعد من الأب المقترح — ممنوع المرور بكود القسم نفسه
    const seen = new Set([deptCode]);
    let cur = p;
    for (let i = 0; i < 25; i++) {
        if (seen.has(cur)) {
            const error = new Error('الربط يصنع دورة في هرمية الأقسام');
            error.statusCode = 422; error.code = 'DEPT_PARENT_CYCLE'; throw error;
        }
        seen.add(cur);
        const row = (await pool.query('SELECT parent_code FROM departments WHERE code = $1 LIMIT 1', [cur])).rows[0];
        const next = row?.parent_code ? String(row.parent_code).trim() : '';
        if (!next) {break;}
        cur = next;
    }
    return p;
}

async function validateEmployeeUserLink(entity, filtered, currentId = null) {    if (entity !== 'employees' || !Object.prototype.hasOwnProperty.call(filtered, 'userId')) {return;}
    const userId = filtered.userId == null || filtered.userId === '' ? null : Number(filtered.userId);
    if (userId == null) {return;}
    if (!Number.isInteger(userId)) {
        const error = new Error('معرّف حساب المستخدم غير صحيح');
        error.statusCode = 422; error.code = 'INVALID_USER_LINK'; throw error;
    }
    const user = await pool.query('SELECT id,username,active FROM users WHERE id=$1 LIMIT 1', [userId]);
    if (!user.rows.length) {
        const error = new Error('حساب المستخدم المحدد غير موجود');
        error.statusCode = 422; error.code = 'USER_NOT_FOUND'; throw error;
    }
    const duplicate = await pool.query('SELECT id,"employeeId",name FROM employees WHERE "userId"=$1 AND id<>$2 LIMIT 1', [userId, currentId || 0]);
    if (duplicate.rows.length) {
        const error = new Error(`حساب المستخدم مرتبط بالفعل بالموظف ${duplicate.rows[0].name}`);
        error.statusCode = 409; error.code = 'USER_ALREADY_LINKED'; throw error;
    }
}

ensureEmployeeUserLinkSchema().catch((error) => logger.error('[EMPLOYEE_USER_LINK] initialization failed:', error.message));

app.put('/api/users/:id/employee', jwtAuth, requireRole('admin', 'manager'), crudLimiter, asyncHandler(async (req, res) => {
    const userId = Number(req.params.id);
    const employeeId = req.body?.employeeId == null || req.body?.employeeId === '' ? null : Number(req.body.employeeId);
    if (!Number.isInteger(userId) || (employeeId !== null && !Number.isInteger(employeeId))) {
        return res.status(422).json({ error: 'INVALID_EMPLOYEE_LINK', message: 'بيانات ربط الموظف بالحساب غير صحيحة' });
    }
    await ensureEmployeeUserLinkSchema();
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const user = (await client.query('SELECT * FROM users WHERE id=$1 FOR UPDATE', [userId])).rows[0];
        if (!user) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'USER_NOT_FOUND', message: 'حساب المستخدم غير موجود' }); }
        let targetEmployee = null;
        if (employeeId !== null) {
            targetEmployee = (await client.query('SELECT * FROM employees WHERE id=$1 FOR UPDATE', [employeeId])).rows[0];
            if (!targetEmployee) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'EMPLOYEE_NOT_FOUND', message: 'الموظف المحدد غير موجود' }); }
            if (targetEmployee.userId != null && String(targetEmployee.userId) !== String(userId)) {
                await client.query('ROLLBACK');
                return res.status(409).json({ error: 'EMPLOYEE_ALREADY_LINKED', message: `الموظف مرتبط بالفعل بحساب مستخدم آخر` });
            }
        }
        const oldLinks = (await client.query('UPDATE employees SET "userId"=NULL WHERE "userId"=$1 AND ($2::bigint IS NULL OR id<>$2) RETURNING *', [userId, employeeId])).rows;
        if (targetEmployee) {
            targetEmployee = (await client.query('UPDATE employees SET "userId"=$1 WHERE id=$2 RETURNING *', [userId, employeeId])).rows[0];
        }
        await client.query('COMMIT');
        for (const oldEmployee of oldLinks) {emitEntityChange('employees', 'update', oldEmployee, req);}
        if (targetEmployee) {emitEntityChange('employees', 'update', targetEmployee, req);}
        res.json({ user: publicEntityRow('users', user), employee: targetEmployee, previousEmployees: oldLinks.map(publicRow => publicRow) });
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        if (error.code === '23505') {return res.status(409).json({ error: 'USER_ALREADY_LINKED', message: 'حساب المستخدم مرتبط بالفعل بموظف آخر' });}
        throw error;
    } finally { client.release(); }
}));

// SECURITY audit (pre-delivery): بث السوكيت يصل لكل المقابس — ومنها المجهولة عبر
// التونل. صفوف الرواتب (payroll*) لا تُبث إطلاقًا إلا كإشارة تغيير {id}، وصفوف
// employees تُبث بكلمة الرواتب مقنعة. الشاشات المرتفعة تعيد الجلب عبر loadData()
// فلا فقدان وظيفة — نفس عقد viewerSafeRow على REST.
const SOCKET_SIGNAL_ONLY_ENTITIES = new Set(['payroll', 'salary_advances', 'payroll_adjustments', 'payroll_runs']);

function emitEntityChange(entity, action, data, req) {
    let safeData = data;
    if (SOCKET_SIGNAL_ONLY_ENTITIES.has(entity) && data && typeof data === 'object') {
        safeData = { id: data.id };
    } else if (entity === 'employees') {
        safeData = maskEmployeeRowForRole(publicEntityRow(entity, data), null);
    }
    const payload = {
        entity,
        entityName: entityNames[entity] || entity,
        action, // 'create' | 'update' | 'delete'
        data: safeData,
        changedBy: req.headers['x-device-name'] || req.ip,
        changedAt: new Date().toISOString(),
    };

    const senderSocket = req.headers['x-socket-id'];
    emitScoped('entity_changed', payload, senderSocket || undefined);
}

// ─── Closed-payroll guard (V6 Phase 3, decision #7): writes to payroll entities
// in a locked accounting period are rejected with 423 PERIOD_LOCKED.
// Fail-open everywhere: controls down / month unparseable / row missing → allow
// (reads are never affected; only these 5 entities are checked).
const PAYROLL_GUARDED_ENTITIES = new Set(['payroll', 'payroll_adjustments', 'salary_advances', 'advance_applications', 'payroll_runs']);
function payrollMonthOf(entity, obj) {
    if (!PAYROLL_GUARDED_ENTITIES.has(entity) || !obj || typeof obj !== 'object') {return null;}
    const pick = obj.month ?? obj.period ?? null;
    if (typeof pick === 'string' && /^\d{4}-\d{2}$/.test(pick)) {return pick;}
    const d = obj.date ?? obj.pay_date ?? obj.payment_date ?? null;
    if (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}/.test(d)) {return d.slice(0, 7);}
    return null;
}
async function payrollPeriodViolation(entity, obj) {
    const month = payrollMonthOf(entity, obj);
    if (!month) {return null;}
    try {
        const { isPeriodClosed } = require('./accounting-periods');
        if (await isPeriodClosed(month)) {
            return { error: 'PERIOD_LOCKED', message: `الفترة ${month} مقفلة محاسبيًا — لا يمكن تعديل الرواتب (أعد فتح الفترة أولًا)` };
        }
    } catch (_) { /* controls down → fail-open */ }
    return null;
}
async function payrollRowViolation(entity, id, extra) {
    try {
        const row = (await pool.query(`SELECT * FROM "${entity}" WHERE id = $1`, [id])).rows[0];
        if (!row) {return null;}
        return payrollPeriodViolation(entity, { ...row, ...(extra || {}) });
    } catch (_) {return null;}
}

entities.forEach(entity => {
    // Determine if this entity requires elevated role for write operations
    const requiresAdminRole = adminEntities.includes(entity);
    const requiresElevatedRead = sensitiveReadEntities.includes(entity);

    // GET all (authenticated + role-gated for sensitive entities + paginated + rate limited)
    const listMiddlewares = [jwtAuth, generalLimiter];
    if (requiresElevatedRead) {listMiddlewares.push(requireRoleOrPerm(readRolesFor(entity), permForEntity(entity, 'read')));}
    app.get(`/api/${entity}`, ...listMiddlewares, asyncHandler(async (req, res) => {
        // Get sortable columns from schema registry for this entity
        const allowedSortColumns = getSortableColumns(entity);

        // Parse pagination parameters with validation
        const pagination = parsePaginationParams(req.query, allowedSortColumns);

        // Deep-pagination protection (MAX_OFFSET) must actually be enforced
        const offsetError = pagination.errors.find(message => message.includes('exceeds maximum offset'));
        if (offsetError) {
            return res.status(400).json({ error: 'INVALID_PAGINATION_PARAMS', message: offsetError });
        }
        
        // Build safe paginated query
        const { dataQuery, countQuery, params } = buildPaginatedQuery(entity, pagination);
        
        // Execute both queries in parallel for performance
        const [dataResult, countResult] = await Promise.all([
            pool.query(dataQuery, params),
            pool.query(countQuery),
        ]);
        
        const total = parseInt(countResult.rows[0].total, 10);
        const { page, limit, sort, order } = pagination;
        const totalPages = Math.ceil(total / limit);
        
        // Set standard pagination headers
        res.set({
            'X-Total-Count': total,
            'X-Total-Pages': totalPages,
            'X-Current-Page': page,
            'X-Per-Page': limit,
            'X-Sort': `${sort} ${order}`,
            'Access-Control-Expose-Headers': 'X-Total-Count,X-Total-Pages,X-Current-Page,X-Per-Page,X-Sort',
        });
        
        // Return paginated response
        return res.json({
            data: dataResult.rows.map(row => viewerSafeRow(entity, row, req)),
            pagination: {
                page,
                limit,
                total,
                totalPages,
                hasNextPage: page < totalPages,
                hasPrevPage: page > 1,
                sort,
                order,
            },
        });
    }));

    // GET by id (authenticated)
    // تدقيق أمني جولة 2: حرس قراءة حساس على التفاصيل أيضًا — القائمة كانت
    // مقفولة من الجولة الأولى بينما /:id تقبل أي حساب مصادق (IDOR بتعداد
    // المعرفات: chef يقرأ /api/payroll/5 و /api/users/3 رغم قفل القائمة).
    const byIdMiddlewares = [jwtAuth];
    if (requiresElevatedRead) {byIdMiddlewares.push(requireRoleOrPerm(readRolesFor(entity), permForEntity(entity, 'read')));}
    app.get(`/api/${entity}/:id`, ...byIdMiddlewares, asyncHandler(async (req, res) => {
        const { id } = req.params;
        const result = await pool.query(`SELECT * FROM "${entity}" WHERE id = $1`, [id]);
        if (result.rows.length === 0) {return res.status(404).json({ error: 'NOT_FOUND', message: 'السجل المطلوب غير موجود' });}
        res.json(viewerSafeRow(entity, result.rows[0], req));
    }));

    // POST create (role-based auth for sensitive entities)
    if (requiresAdminRole || entity === 'dispatches') {
        const createRoles = entity === 'dispatches' ? ['admin', 'manager', 'warehouse', 'kitchen', 'dept_head'] : entity === 'payroll' ? ['admin', 'manager', 'accountant'] : ['admin', 'manager'];
        app.post(`/api/${entity}`, jwtAuth, requireRoleOrPerm(createRoles, permForEntity(entity, 'write')), crudLimiter, asyncHandler(async (req, res) => {
            // ─── SECURITY: Filter body against whitelist (CRITICAL FIX) ──
            const { filtered: f0, errors, removedKeys } = filterBody(entity, req.body);

            if (errors.length > 0 || removedKeys.length > 0) {
                const firstProblem = errors[0] || (removedKeys.length ? `الحقل "${removedKeys[0]}" غير مسموح في هذا الطلب` : null);
                return res.status(400).json({
                    error: 'INVALID_PAYLOAD',
                    message: firstProblem ? `بيانات مرفوضة: ${firstProblem}` : 'البيانات المرسلة تحتوي حقولًا غير صالحة — راجع الحقول المسموحة',
                    details: { errors, removedKeys },
                    allowedFields: require('./schema-registry').getSchema(entity)?.writeable || [],
                });
            }

            // Dispatches enter the workflow only as pending requests. Approval, rejection,
            // receiving, signatures, and status transitions are handled by dedicated
            // transactional endpoints — never by generic CRUD payloads.
            let filtered = f0;
            if (entity === 'employees') {
                const department = filtered.department == null ? null : String(filtered.department).trim();
                filtered = { ...filtered, department: department || null };
                if (department) {
                    const departmentCheck = await pool.query('SELECT 1 FROM "hrDepartments" WHERE code = $1 LIMIT 1', [department]);
                    if (!departmentCheck.rows.length) {
                        return res.status(422).json({ error: 'INVALID_HR_DEPARTMENT', message: 'القسم الوظيفي غير موجود، اختر قسمًا من أقسام الموارد البشرية' });
                    }
                }
            }
            if (entity === 'dispatches') {
                const workflowFields = ['status', 'approvedDate', 'approvedBy', 'approveNotes', 'approvedItems', 'rejectionReason', 'rejectedBy', 'rejectedDate', 'warehouseApprovedAt', 'warehouseApprovedBy', 'warehouseApprovalSignatureData', 'warehouseApprovalSignatureHash', 'warehouseRejectedAt', 'warehouseRejectedBy', 'warehouseRejectionSignatureData', 'warehouseRejectionSignatureHash', 'kitchenReceivedAt', 'kitchenReceivedBy', 'kitchenReceiptSignatureData', 'kitchenReceiptSignatureHash', 'receivedItems', 'receiptNotes', 'closedAt', 'closedBy', 'lastEventHash',
                    // Task 19: حقول اعتماد الشيف العمومي تُدار حصريًا عبر مساراته المخصصة
                    'chefApprovedAt', 'chefApprovedBy', 'chefApprovalSignatureData', 'chefApprovalSignatureHash', 'chefRejectedAt', 'chefRejectedBy', 'chefRejectionSignatureData', 'chefRejectionSignatureHash', 'needsChefApproval', 'creatorRole'];
                const attemptedWorkflowFields = workflowFields.filter(field => Object.prototype.hasOwnProperty.call(filtered, field) && !(field === 'status' && filtered.status === 'pending'));
                if (attemptedWorkflowFields.length) {return res.status(400).json({ error: 'WORKFLOW_FIELDS_FORBIDDEN', message: 'حقول حالة إذن الصرف لا تُرسل عبر CRUD العام', fields: attemptedWorkflowFields });}
                const { status: _clientStatus, ...requestFields } = filtered;
                // Task 19: رئيس القسم يُجبر على قسمه ولا يراه إلا فيه، وطلبه يمر بالشيف العمومي إجباريًا
                if (req.user?.role === 'dept_head') {
                    const resolved = resolveDeptHeadDispatch(req.user, requestFields.deptCode);
                    if (!resolved.ok) {
                        const messages = {
                            DEPT_HEAD_WITHOUT_DEPARTMENT: 'حساب رئيس القسم غير مرتبط بأي قسم — راجع مسؤول النظام',
                            DEPT_MISMATCH: 'رئيس القسم لا يستطيع إنشاء طلب صرف لقسم غير قسمه',
                        };
                        return res.status(403).json({ error: resolved.code, message: messages[resolved.code] || 'غير مصرح' });
                    }
                    const deptRow = (await pool.query('SELECT code, name FROM departments WHERE LOWER(code)=LOWER($1) LIMIT 1', [resolved.deptCode])).rows[0];
                    if (!deptRow) {return res.status(422).json({ error: 'DEPT_NOT_FOUND', message: `القسم المرتبط بالحساب غير موجود: ${resolved.deptCode}` });}
                    requestFields.deptCode = deptRow.code;
                    requestFields.deptName = deptRow.name;
                    filtered = { ...requestFields, status: 'pending', createdBy: req.user.name || req.user.username || String(req.user.id), requestedAt: new Date().toISOString(), creatorRole: 'dept_head', needsChefApproval: true, creatorUserId: req.user.id };
                } else {
                    filtered = { ...requestFields, status: 'pending', createdBy: req.user.name || req.user.username || String(req.user.id), requestedAt: new Date().toISOString(), creatorRole: req.user?.role || null, needsChefApproval: false, creatorUserId: req.user.id };
                }
            }
            // Auto-generate id for legacy tables that mark `id` as protected
            filtered = ensureIdForEntity(entity, filtered);
            const periodBlockCreate = await payrollPeriodViolation(entity, filtered);
            if (periodBlockCreate) {return res.status(423).json(periodBlockCreate);}
            if (entity === 'users') {
                if (!String(filtered.password || '').trim()) {return res.status(422).json({ error: 'PASSWORD_REQUIRED', message: 'كلمة المرور مطلوبة' });}
                if (!isStrongPassword(String(filtered.password).trim())) {return res.status(422).json({ error: 'PASSWORD_TOO_WEAK', message: 'كلمة المرور ضعيفة: 8 حروف على الأقل مع حرف ورقم' });}
                // Privilege-escalation guard: only admins may mint accounts with elevated roles
                if (req.user?.role !== 'admin' && 'role' in filtered) {
                    return res.status(403).json({ error: 'ROLE_ASSIGNMENT_FORBIDDEN', message: 'تعيين الأدوار متاح للمسؤول العام فقط' });
                }
                try { await validateDeptHeadUserLink(entity, filtered); }
                catch (error) { return res.status(error.statusCode || 422).json({ error: error.code || 'DEPT_HEAD_LINK_INVALID', message: error.message }); }
                req._pwVaultPlain = String(filtered.password);
                filtered = { ...filtered, password: await bcrypt.hash(String(filtered.password), 12), active: filtered.active !== false };
            }

            const keys = Object.keys(filtered);
            const values = keys.map(key => prepareDbValue(entity, key, filtered[key]));
            if (keys.length === 0) {return res.status(400).json({ error: 'Empty payload after filtering' });}

            // Validate all column names (defense in depth)
            for (const k of keys) {
                const colCheck = validateColumnName(k);
                if (!colCheck.valid) {
                    return res.status(400).json({ error: 'INVALID_COLUMN', message: colCheck.reason });
                }
            }

            const placeholders = keys.map((_, i) => `$${i + 1}`).join(', ');
            const columns = keys.map(k => `"${k}"`).join(', ');

            const result = await pool.query(
                `INSERT INTO "${entity}" (${columns}) VALUES (${placeholders}) RETURNING *`,
                values
            );

            const publicRow = publicEntityRow(entity, result.rows[0]);
            // ROOT FIX 2026-10-02: جلسات الجرد تُبنى من أرصدة المواقع — الصنف
            // المنشأ عبر CRUD العام بلا صف رصيد كان يختفي من لقطة الجرد كليًا
            // (EMPTY_AUDIT). يُضمن صف رصيد في المخزن الرئيسي عند إنشاء أي صنف.
            if (entity === 'inventory') {
                try {
                    const _mainLoc = (await pool.query(
                        `SELECT id FROM inventory_locations WHERE code='MAIN-WAREHOUSE' AND active = true LIMIT 1`)).rows[0];
                    if (_mainLoc) {
                        await pool.query(
                            `INSERT INTO inventory_location_balances (inventory_id, location_id, on_hand)
                             VALUES ($1, $2, GREATEST(0, $3::numeric)) ON CONFLICT (inventory_id, location_id) DO NOTHING`,
                            [result.rows[0].id, _mainLoc.id, Number(result.rows[0].qty) || 0]);
                    }
                } catch (e) { logger.warn('[inventory-balance-seed]', e.message); }
            }
            if (entity === 'expenses') { await postExpenseJournal(result.rows[0]); }
            emitEntityChange(entity, 'create', publicRow, req);
            // Task 20: إشعار فوري لسلسلة الاعتماد عند إنشاء طلب صرف
            if (entity === 'dispatches') {
                notifyChainEvent(req, publicRow, publicRow.needsChefApproval ? 'created_pending_chef' : 'created_direct', { io });
            }
            // بطاقة فاخرة تلقائية لأي موظف جديد برقم بصمة (خلفي — لا يعطل الرد)
            if (entity === 'employees') {
                const fp = String(result.rows[0].deviceUserId || result.rows[0].employeeId || '').trim();
                if (fp) {
                    try {
                        const { spawn } = require('child_process');
                        const path = require('path');
                        const child = spawn(process.execPath, [path.join(__dirname, '..', 'tools', 'employee-card', 'generate-card.js'), '--fp', fp], { stdio: 'ignore' });
                        if (child.unref) {child.unref();}
                    } catch (_) {}
                }
            }
            if (entity === 'users' && req._pwVaultPlain) {
                const _enc = encryptForVault(req._pwVaultPlain);
                if (_enc) { await pool.query('UPDATE users SET password_vault = $1 WHERE id = $2', [_enc, result.rows[0].id]).catch(e => logger.warn('[pw-vault]', e.message)); }
            }
            res.status(201).json(publicRow);
        }));
    } else {
        // Security audit 2026-09-03: الكتابة على الكيانات غير الإدارية لم تعد
        // مفتوحة لأي حساب مُصادق — كل كيان يُقفل على أدواره من الخريطة أعلاه.
        // SPEC-employee-pwa-attendance-geofence-v1: الكتابة العامة على الحضور
        // للإدارة فقط — البصمة الذاتية للموظفين تمر حصريًا عبر مسار البوابة
        // الآمن (Geofence + ساعة السيرفر + تدقيق كامل).
        const openWriteRoles = entity === 'attendance' ? ['admin', 'manager', 'hr'] : getEntityWriteRoles(entity);
        const writeGuard = openWriteRoles ? [requireRoleOrPerm(openWriteRoles, permForEntity(entity, 'write'))] : [];
        app.post(`/api/${entity}`, jwtAuth, ...writeGuard, crudLimiter, asyncHandler(async (req, res) => {
            // ─── SECURITY: Filter body against whitelist ──
            const { filtered: f0, errors, removedKeys } = filterBody(entity, req.body);

            if (errors.length > 0 || removedKeys.length > 0) {
                const firstProblem = errors[0] || (removedKeys.length ? `الحقل "${removedKeys[0]}" غير مسموح في هذا الطلب` : null);
                return res.status(400).json({
                    error: 'INVALID_PAYLOAD',
                    message: firstProblem ? `بيانات مرفوضة: ${firstProblem}` : 'البيانات المرسلة تحتوي حقولًا غير صالحة — راجع الحقول المسموحة',
                    details: { errors, removedKeys },
                    allowedFields: require('./schema-registry').getSchema(entity)?.writeable || [],
                });
            }

            // Auto-generate id for legacy tables that mark `id` as protected
            let filtered = ensureIdForEntity(entity, f0);
            const periodBlockCreateOpen = await payrollPeriodViolation(entity, filtered);
            if (periodBlockCreateOpen) {return res.status(423).json(periodBlockCreateOpen);}
            try { filtered = await enforceAttendanceSelfService(entity, req, filtered); }
            catch (error) { return res.status(error.statusCode || 403).json({ error: error.code || 'ATTENDANCE_FORBIDDEN', message: error.message }); }
            if (entity === 'employees') {
                const department = filtered.department == null ? null : String(filtered.department).trim();
                filtered = { ...filtered, department: department || null };
                if (department) {
                    const departmentCheck = await pool.query('SELECT 1 FROM "hrDepartments" WHERE code = $1 LIMIT 1', [department]);
                    if (!departmentCheck.rows.length) {
                        return res.status(422).json({ error: 'INVALID_HR_DEPARTMENT', message: 'القسم الوظيفي غير موجود، اختر قسمًا من أقسام الموارد البشرية' });
                    }
                }
                try { await validateEmployeeUserLink(entity, filtered); }
                catch (error) { return res.status(error.statusCode || 422).json({ error: error.code || 'EMPLOYEE_USER_LINK_INVALID', message: error.message }); }
                // انصراف تلقائي + قفل اليوم: مدير النظام فقط — يُسقط لغيره بصمت
                if (entity === 'employees' && req.user?.role !== 'admin') {
                    delete filtered.auto_checkout;
                    delete filtered.auto_lock;
                }
                if (entity === 'employees') {
                    try {
                        if (Object.prototype.hasOwnProperty.call(filtered, 'shift_start')) {
                            filtered.shift_start = normalizeShiftStart(filtered.shift_start) || '09:00';
                        }
                        if (Object.prototype.hasOwnProperty.call(filtered, 'shift_karim')) {
                            filtered.shift_karim = normalizeShiftKarim(filtered.shift_karim) ?? 9;
                        }
                    }
                    catch (error) { return res.status(error.statusCode || 422).json({ error: error.code || 'SHIFT_INVALID', message: error.message }); }
                }
            }
            if (entity === 'departments' && Object.prototype.hasOwnProperty.call(filtered, 'parent_code')) {                try { filtered = { ...filtered, parent_code: await validateDeptParent(filtered.code, filtered.parent_code) }; }
                catch (error) { return res.status(error.statusCode || 422).json({ error: error.code || 'DEPT_PARENT_INVALID', message: error.message }); }
            }
            if (entity === 'users') {
                if (!String(filtered.password || '').trim()) {return res.status(422).json({ error: 'PASSWORD_REQUIRED', message: 'كلمة المرور مطلوبة' });}
                if (!isStrongPassword(String(filtered.password).trim())) {return res.status(422).json({ error: 'PASSWORD_TOO_WEAK', message: 'كلمة المرور ضعيفة: 8 حروف على الأقل مع حرف ورقم' });}
                // Privilege-escalation guard: role changes are admin-only
                if (req.user?.role !== 'admin' && 'role' in filtered) {
                    return res.status(403).json({ error: 'ROLE_ASSIGNMENT_FORBIDDEN', message: 'تعيين الأدوار متاح للمسؤول العام فقط' });
                }
                // Task 19: حساب رئيس القسم يجب ربطه بقسم صحيح عند الإنشاء
                try { await validateDeptHeadUserLink(entity, filtered); }
                catch (error) { return res.status(error.statusCode || 422).json({ error: error.code || 'DEPT_HEAD_LINK_INVALID', message: error.message }); }
                req._pwVaultPlain = String(filtered.password);
                filtered = { ...filtered, password: await bcrypt.hash(String(filtered.password), 12), active: filtered.active !== false };
            }

            const keys = Object.keys(filtered);
            const values = keys.map(key => prepareDbValue(entity, key, filtered[key]));
            if (keys.length === 0) {return res.status(400).json({ error: 'Empty payload after filtering' });}

            // Validate all column names (defense in depth)
            for (const k of keys) {
                const colCheck = validateColumnName(k);
                if (!colCheck.valid) {
                    return res.status(400).json({ error: 'INVALID_COLUMN', message: colCheck.reason });
                }
            }

            const placeholders = keys.map((_, i) => `$${i + 1}`).join(', ');
            const columns = keys.map(k => `"${k}"`).join(', ');

            const result = await pool.query(
                `INSERT INTO "${entity}" (${columns}) VALUES (${placeholders}) RETURNING *`,
                values
            );

            const publicRow = publicEntityRow(entity, result.rows[0]);
            // نفس حرس الرصيد — المعالج الثاني للكيانات ذات الأدوار المفتوحة
            if (entity === 'inventory') {
                try {
                    const _mainLoc = (await pool.query(
                        `SELECT id FROM inventory_locations WHERE code='MAIN-WAREHOUSE' AND active = true LIMIT 1`)).rows[0];
                    if (_mainLoc) {
                        await pool.query(
                            `INSERT INTO inventory_location_balances (inventory_id, location_id, on_hand)
                             VALUES ($1, $2, GREATEST(0, $3::numeric)) ON CONFLICT (inventory_id, location_id) DO NOTHING`,
                            [result.rows[0].id, _mainLoc.id, Number(result.rows[0].qty) || 0]);
                    }
                } catch (e) { logger.warn('[inventory-balance-seed]', e.message); }
            }
            if (entity === 'expenses') { await postExpenseJournal(result.rows[0]); }
            emitEntityChange(entity, 'create', publicRow, req);
            // ─── تدقيق أمني (2026-10-01): إنشاء إجازة معتمدة/مرفوضة مباشرة (أعذار
            // إدارية) كان يتركها خارج سلسلة الاعتماد — تُلحق بسجل مكتمل/مرفوض
            // موثق حتى تظهر في المتابعة ولا تُخفى عن المراجعة
            if (entity === 'leaveRequests' && ['approved', 'rejected'].includes(String(result.rows[0]?.status))) {
                try {
                    await require('./leave-workflow-routes').ensureLeaveWorkflowSchema();
                    const done = result.rows[0].status === 'approved';
                    const wf = (await pool.query(
                        `INSERT INTO leave_approval_workflows(leave_request_id,current_stage,status,current_note,completed_at)
                         VALUES($1,$2,$3,$4,$5) ON CONFLICT (leave_request_id) DO NOTHING RETURNING *`,
                        [result.rows[0].id, done ? 'hr' : 'direct_manager', done ? 'completed' : 'rejected',
                         result.rows[0].reason || null, done ? new Date() : null])).rows[0];
                    if (wf) {
                        await pool.query(
                            `INSERT INTO leave_approval_events(workflow_id,stage,action,note,actor_user_id,actor_role)
                             VALUES($1,'direct_manager',$2,$3,$4,$5)`,
                            [wf.id, done ? 'approve' : 'reject', 'إنشاء مباشر معتمد إداريًا',
                             req.user?.id ?? null, req.user?.role ?? null]);
                    }
                } catch (e) { logger.warn('[leave-workflow-auto]', e.message); }
            }
            if (entity === 'users' && req._pwVaultPlain) {
                const _enc = encryptForVault(req._pwVaultPlain);
                if (_enc) { await pool.query('UPDATE users SET password_vault = $1 WHERE id = $2', [_enc, result.rows[0].id]).catch(e => logger.warn('[pw-vault]', e.message)); }
            }
            res.status(201).json(publicRow);
        }));
    }

    // PUT update (role-based auth for sensitive entities)
    if (requiresAdminRole || entity === 'dispatches') {
        const updateRoles = entity === 'dispatches' ? ['admin', 'manager', 'warehouse'] : entity === 'payroll' ? ['admin', 'manager', 'accountant'] : ['admin', 'manager'];
        app.put(`/api/${entity}/:id`, jwtAuth, requireRoleOrPerm(updateRoles, permForEntity(entity, 'write')), crudLimiter, asyncHandler(async (req, res) => {
            const { id } = req.params;
            if (entity === 'dispatches') {return res.status(405).json({ error: 'DISPATCH_WORKFLOW_REQUIRED', message: 'استخدم مسار دورة إذن الصرف المخصص بدل تعديل الحالة مباشرة' });}
            
            // ─── SECURITY: Filter body against whitelist ──
            const { errors, removedKeys, filtered: _filteredIn } = filterBody(entity, req.body, "update");
            let filtered = _filteredIn;
            if (errors.length > 0 || removedKeys.length > 0) {
                const firstProblem = errors[0] || (removedKeys.length ? `الحقل "${removedKeys[0]}" غير مسموح في هذا الطلب` : null);
                return res.status(400).json({
                    error: 'INVALID_PAYLOAD',
                    message: firstProblem ? `بيانات مرفوضة: ${firstProblem}` : 'البيانات المرسلة تحتوي حقولًا غير صالحة — راجع الحقول المسموحة',
                    details: { errors, removedKeys },
                    allowedFields: require('./schema-registry').getSchema(entity)?.writeable || [],
                });
            }
            if (entity === 'users') {
                // Empty/whitespace passwords must never overwrite a stored hash
                if (filtered.password !== undefined && !String(filtered.password).trim()) {
                    return res.status(422).json({ error: 'PASSWORD_EMPTY', message: 'لا يمكن حفظ كلمة مرور فارغة' });
                }
                if (filtered.password !== undefined && !isStrongPassword(String(filtered.password).trim())) {
                    return res.status(422).json({ error: 'PASSWORD_TOO_WEAK', message: 'كلمة المرور ضعيفة: 8 حروف على الأقل مع حرف ورقم' });
                }
                // Privilege-escalation guard: role changes are admin-only
                if ('role' in filtered && req.user?.role !== 'admin') {
                    return res.status(403).json({ error: 'ROLE_ASSIGNMENT_FORBIDDEN', message: 'تعيين الأدوار متاح للمسؤول العام فقط' });
                }
                if (filtered.password !== undefined) {
                    req._pwVaultPlain = String(filtered.password);
                    filtered = { ...filtered, password: await bcrypt.hash(String(filtered.password), 12) };
                }
                // Task 19: التحقق من ربط رئيس القسم بقسمه عند التعديل (يدمج الدور والقسم الفعليين)
                try { await validateDeptHeadUserUpdate(filtered, id); }
                catch (error) { return res.status(error.statusCode || 422).json({ error: error.code || 'DEPT_HEAD_LINK_INVALID', message: error.message }); }
            }
            if (entity === 'employees') {
                try { await validateEmployeeUserLink(entity, filtered, id); }
                catch (error) { return res.status(error.statusCode || 422).json({ error: error.code || 'EMPLOYEE_USER_LINK_INVALID', message: error.message }); }
                try {
                    if (Object.prototype.hasOwnProperty.call(filtered, 'shift_start')) {
                        filtered.shift_start = normalizeShiftStart(filtered.shift_start) || '09:00';
                    }
                    if (Object.prototype.hasOwnProperty.call(filtered, 'shift_karim')) {
                        filtered.shift_karim = normalizeShiftKarim(filtered.shift_karim) ?? 9;
                    }
                }
                catch (error) { return res.status(error.statusCode || 422).json({ error: error.code || 'SHIFT_INVALID', message: error.message }); }
                // انصراف تلقائي: مدير النظام فقط — يُسقط لغيره بصمت
                // انصراف تلقائي + قفل اليوم: مدير النظام فقط — يُسقط لغيره بصمت
                if (Object.prototype.hasOwnProperty.call(filtered, 'auto_checkout') && req.user?.role !== 'admin') {
                    delete filtered.auto_checkout;
                }
                if (Object.prototype.hasOwnProperty.call(filtered, 'auto_lock') && req.user?.role !== 'admin') {
                    delete filtered.auto_lock;
                }
            }
            const periodBlockPut = await payrollRowViolation(entity, id, filtered);
            if (periodBlockPut) {return res.status(423).json(periodBlockPut);}

            const keys = Object.keys(filtered);
            const values = keys.map(key => prepareDbValue(entity, key, filtered[key]));
            if (keys.length === 0) {return res.status(400).json({ error: 'Empty payload after filtering' });}

            // Validate all column names (defense in depth)
            for (const k of keys) {
                const colCheck = validateColumnName(k);
                if (!colCheck.valid) {
                    return res.status(400).json({ error: 'INVALID_COLUMN', message: colCheck.reason });
                }
            }

            const setClause = keys.map((k, i) => `"${k}" = $${i + 1}`).join(', ');
            const result = await pool.query(
                `UPDATE "${entity}" SET ${setClause} WHERE id = $${keys.length + 1} RETURNING *`,
                [...values, id]
            );
            if (result.rows.length === 0) {return res.status(404).json({ error: 'NOT_FOUND', message: 'السجل المطلوب غير موجود' });}

            const publicRow = publicEntityRow(entity, result.rows[0]);
            emitEntityChange(entity, 'update', publicRow, req);
            // SECURITY ROOT FIX 2026-10-02: أي تعديل حساس على حساب مستخدم (كلمة
            // مرور أو إيقاف) يبطل جلسات التحديث المفتوحة — كانت تظل صالحة حتى
            // 365 يومًا عبر /api/auth/refresh بعد تغيير كلمة المرور.
            if (entity === 'users' && (req._pwVaultPlain !== undefined || filtered.active === false)) {
                try { await pool.query('DELETE FROM pos_refresh_tokens WHERE user_id = $1', [id]); }
                catch (e) { logger.warn('[refresh-revoke]', e.message); }
            }
            if (entity === 'expenses' && (filtered.amount !== undefined || filtered.date !== undefined || filtered.notes !== undefined)) {
                await purgeExpenseJournal(id);
                await postExpenseJournal(result.rows[0]);
            }
            if (entity === 'users' && req._pwVaultPlain) {
                const _enc = encryptForVault(req._pwVaultPlain);
                if (_enc) { await pool.query('UPDATE users SET password_vault = $1 WHERE id = $2', [_enc, result.rows[0].id]).catch(e => logger.warn('[pw-vault]', e.message)); }
            }
            res.json(publicRow);
        }));
    } else {
        // SPEC-employee-pwa-attendance-geofence-v1: الكتابة العامة على الحضور
        // للإدارة فقط — البصمة الذاتية للموظفين تمر حصريًا عبر مسار البوابة
        // الآمن (Geofence + ساعة السيرفر + تدقيق كامل).
        const openWriteRoles = entity === 'attendance' ? ['admin', 'manager', 'hr'] : getEntityWriteRoles(entity);
        const writeGuard = openWriteRoles ? [requireRoleOrPerm(openWriteRoles, permForEntity(entity, 'write'))] : [];
        app.put(`/api/${entity}/:id`, jwtAuth, ...writeGuard, crudLimiter, asyncHandler(async (req, res) => {
            const { id } = req.params;
            
            // ─── SECURITY: Filter body against whitelist ──
            const { errors, removedKeys, filtered: _filteredIn } = filterBody(entity, req.body, "update");
            let filtered = _filteredIn;
            if (errors.length > 0 || removedKeys.length > 0) {
                const firstProblem = errors[0] || (removedKeys.length ? `الحقل "${removedKeys[0]}" غير مسموح في هذا الطلب` : null);
                return res.status(400).json({
                    error: 'INVALID_PAYLOAD',
                    message: firstProblem ? `بيانات مرفوضة: ${firstProblem}` : 'البيانات المرسلة تحتوي حقولًا غير صالحة — راجع الحقول المسموحة',
                    details: { errors, removedKeys },
                    allowedFields: require('./schema-registry').getSchema(entity)?.writeable || [],
                });
            }
            try { filtered = await enforceAttendanceSelfService(entity, req, filtered, id); }
            catch (error) { return res.status(error.statusCode || 403).json({ error: error.code || 'ATTENDANCE_FORBIDDEN', message: error.message }); }
            // ─── تدقيق أمني (2026-10-01): قرارات الإجازات (حالة/معتمِد/رافض) عبر
            // مسار السلسلة فقط — التعديل العام المباشر كان يتجاوز المراحل والمنع الذاتي
            if (entity === 'leaveRequests') {
                const decideKeys = ['status', 'approvedBy', 'approvedDate', 'rejectionReason', 'rejectedBy', 'rejectedDate'];
                if (decideKeys.some((k) => Object.prototype.hasOwnProperty.call(req.body || {}, k))) {
                    return res.status(405).json({ error: 'LEAVE_WORKFLOW_REQUIRED', message: 'قرارات الإجازة عبر مسار الاعتماد المخصص (/hr/leave-workflow) — لا تعديل مباشر' });
                }
            }
            if (entity === 'users') {
                // Empty/whitespace passwords must never overwrite a stored hash
                if (filtered.password !== undefined && !String(filtered.password).trim()) {
                    return res.status(422).json({ error: 'PASSWORD_EMPTY', message: 'لا يمكن حفظ كلمة مرور فارغة' });
                }
                if (filtered.password !== undefined && !isStrongPassword(String(filtered.password).trim())) {
                    return res.status(422).json({ error: 'PASSWORD_TOO_WEAK', message: 'كلمة المرور ضعيفة: 8 حروف على الأقل مع حرف ورقم' });
                }
                // Privilege-escalation guard: role changes are admin-only
                if ('role' in filtered && req.user?.role !== 'admin') {
                    return res.status(403).json({ error: 'ROLE_ASSIGNMENT_FORBIDDEN', message: 'تعيين الأدوار متاح للمسؤول العام فقط' });
                }
                if (filtered.password !== undefined) {
                    req._pwVaultPlain = String(filtered.password);
                    filtered = { ...filtered, password: await bcrypt.hash(String(filtered.password), 12) };
                }
                // Task 19: التحقق من ربط رئيس القسم بقسمه عند التعديل (يدمج الدور والقسم الفعليين)
                try { await validateDeptHeadUserUpdate(filtered, id); }
                catch (error) { return res.status(error.statusCode || 422).json({ error: error.code || 'DEPT_HEAD_LINK_INVALID', message: error.message }); }
            }
            if (entity === 'employees') {
                try { await validateEmployeeUserLink(entity, filtered, id); }
                catch (error) { return res.status(error.statusCode || 422).json({ error: error.code || 'EMPLOYEE_USER_LINK_INVALID', message: error.message }); }
                try {
                    if (Object.prototype.hasOwnProperty.call(filtered, 'shift_start')) {
                        filtered.shift_start = normalizeShiftStart(filtered.shift_start) || '09:00';
                    }
                    if (Object.prototype.hasOwnProperty.call(filtered, 'shift_karim')) {
                        filtered.shift_karim = normalizeShiftKarim(filtered.shift_karim) ?? 9;
                    }
                }
                catch (error) { return res.status(error.statusCode || 422).json({ error: error.code || 'SHIFT_INVALID', message: error.message }); }
                // انصراف تلقائي: مدير النظام فقط — يُسقط لغيره بصمت
                // انصراف تلقائي + قفل اليوم: مدير النظام فقط — يُسقط لغيره بصمت
                if (Object.prototype.hasOwnProperty.call(filtered, 'auto_checkout') && req.user?.role !== 'admin') {
                    delete filtered.auto_checkout;
                }
                if (Object.prototype.hasOwnProperty.call(filtered, 'auto_lock') && req.user?.role !== 'admin') {
                    delete filtered.auto_lock;
                }
            }
            if (entity === 'departments' && Object.prototype.hasOwnProperty.call(filtered, 'parent_code')) {
                try {
                    const target = (await pool.query('SELECT code FROM departments WHERE id = $1 LIMIT 1', [id])).rows[0];
                    if (!target) {return res.status(404).json({ error: 'NOT_FOUND', message: 'السجل المطلوب غير موجود' });}
                    filtered = { ...filtered, parent_code: await validateDeptParent(target.code, filtered.parent_code) };
                }
                catch (error) { return res.status(error.statusCode || 422).json({ error: error.code || 'DEPT_PARENT_INVALID', message: error.message }); }
            }
            const periodBlockPutOpen = await payrollRowViolation(entity, id, filtered);
            if (periodBlockPutOpen) {return res.status(423).json(periodBlockPutOpen);}
            const keys = Object.keys(filtered);
            const values = keys.map(key => prepareDbValue(entity, key, filtered[key]));
            if (keys.length === 0) {return res.status(400).json({ error: 'Empty payload after filtering' });}

            // Validate all column names (defense in depth)
            for (const k of keys) {
                const colCheck = validateColumnName(k);
                if (!colCheck.valid) {
                    return res.status(400).json({ error: 'INVALID_COLUMN', message: colCheck.reason });
                }
            }

            const setClause = keys.map((k, i) => `"${k}" = $${i + 1}`).join(', ');
            const result = await pool.query(
                `UPDATE "${entity}" SET ${setClause} WHERE id = $${keys.length + 1} RETURNING *`,
                [...values, id]
            );
            if (result.rows.length === 0) {return res.status(404).json({ error: 'NOT_FOUND', message: 'السجل المطلوب غير موجود' });}

            const publicRow = publicEntityRow(entity, result.rows[0]);
            emitEntityChange(entity, 'update', publicRow, req);
            // SECURITY ROOT FIX 2026-10-02: أي تعديل حساس على حساب مستخدم (كلمة
            // مرور أو إيقاف) يبطل جلسات التحديث المفتوحة — كانت تظل صالحة حتى
            // 365 يومًا عبر /api/auth/refresh بعد تغيير كلمة المرور.
            if (entity === 'users' && (req._pwVaultPlain !== undefined || filtered.active === false)) {
                try { await pool.query('DELETE FROM pos_refresh_tokens WHERE user_id = $1', [id]); }
                catch (e) { logger.warn('[refresh-revoke]', e.message); }
            }
            if (entity === 'expenses' && (filtered.amount !== undefined || filtered.date !== undefined || filtered.notes !== undefined)) {
                await purgeExpenseJournal(id);
                await postExpenseJournal(result.rows[0]);
            }
            if (entity === 'users' && req._pwVaultPlain) {
                const _enc = encryptForVault(req._pwVaultPlain);
                if (_enc) { await pool.query('UPDATE users SET password_vault = $1 WHERE id = $2', [_enc, result.rows[0].id]).catch(e => logger.warn('[pw-vault]', e.message)); }
            }
            res.json(publicRow);
        }));
    }

    // DELETE (role-based auth for sensitive entities)
    // ADMIN FULL-CONTROL (2026-10-01): دور admin يتجاوز كل قيود الحذف —
    // حذف إذن صرف بأي حالة + حذف الكيانات المحصّنة ماليًا عبر ?force=1 —
    // مع توثيق إجباري في جدول admin_delete_audit (لا يُكسر التسلسل بصمت).
    async function logAdminForceDelete(req, entity, id, reason) {
        try {
            await pool.query(`
                CREATE TABLE IF NOT EXISTS admin_delete_audit (
                    id BIGSERIAL PRIMARY KEY,
                    entity TEXT NOT NULL,
                    record_id TEXT NOT NULL,
                    deleted_by TEXT,
                    deleted_by_id BIGINT,
                    reason TEXT,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
                )`);
            await pool.query(
                `INSERT INTO admin_delete_audit (entity, record_id, deleted_by, deleted_by_id, reason)
                 VALUES ($1,$2,$3,$4,$5)`,
                [String(entity), String(id),
                 req.user?.username || req.user?.name || null,
                 Number(req.user?.id) || null,
                 String(reason || req.query?.reason || req.body?.reason || 'admin force delete').slice(0, 500)]);
        } catch (e) { logger.warn('[admin-force-delete-audit] skipped:', e.message); }
    }
    // حذف تتابعي لمتعلقات إذن صرف (للأدمن فقط) — دفتر/حركات/مصاريف/قيود/أحداث/تنبيهات.
    // الأرصدة المخزنية والمتوسطات لا تُمس عمدًا (واقع فيزيائي — تُسوّى بجرد تأكيدي).
    // يعمل حتى لو صف الإذن نفسه محذوف مسبقًا (تنظيف البقايا).
    async function purgeDispatchRelated(dispatchId) {
        const out = { journal: 0, ledger: 0, tx: 0, expenses: 0, events: 0, notifications: 0 };
        const ref = `DIS-${dispatchId}`;
        const hash = `%طلب صرف #${dispatchId}%`;
        try {
            out.journal = (await pool.query(
                `DELETE FROM journal_entries WHERE source_type='dispatch' AND source_id=$1 RETURNING id`,
                [String(dispatchId)])).rows.length;
            out.ledger = (await pool.query(
                `DELETE FROM inventory_ledger WHERE reference_type='dispatch' AND (reference_id=$1 OR reference_id=$2) RETURNING id`,
                [ref, String(dispatchId)])).rows.length;
            out.tx = (await pool.query(
                `DELETE FROM "inventoryTx" WHERE "dispatchId"=$1 RETURNING id`, [ref])).rows.length;
            out.expenses = (await pool.query(
                `DELETE FROM expenses WHERE COALESCE("adjustmentType",'') IN ('dispatch','dispatch_return')
                  AND (notes LIKE $1 OR "desc" LIKE $2) RETURNING id`, [hash, hash])).rows.length;
            out.events = (await pool.query(
                `DELETE FROM dispatch_workflow_events WHERE dispatch_id=$1 RETURNING id`,
                [isNaN(Number(dispatchId)) ? -1 : Number(dispatchId)])).rows.length;
            out.notifications = (await pool.query(
                `DELETE FROM notifications WHERE entity='dispatches' AND entity_id=$1 RETURNING id`,
                [String(dispatchId)])).rows.length;
        } catch (e) { logger.warn('[purge-dispatch] partial:', e.message); }
        return out;
    }
    if (requiresAdminRole || entity === 'dispatches') {
        const deleteRoles = entity === 'dispatches' ? ['admin', 'manager', 'warehouse'] : ['admin', 'manager'];
        app.delete(`/api/${entity}/:id`, jwtAuth, requireRoleOrPerm(deleteRoles, permForEntity(entity, 'write')), crudLimiter, asyncHandler(async (req, res) => {
            const { id } = req.params;
            if (entity === 'users') {await pool.query('UPDATE employees SET "userId"=NULL WHERE "userId"=$1', [id]);}
            const periodBlockDel = await payrollRowViolation(entity, id);
            if (periodBlockDel) {return res.status(423).json(periodBlockDel);}
            // تدقيق أمني جولة 2: إذن الصرف الموقّع (معتمد/مرفوض/مستلم) مستند مالي
            // لا يُمحى عبر CRUD العام — الاعتماد يرحّل مصروفات وحركات دفتر وأحداث
            // موقّعة بسلسلة hash؛ حذفه يقطع السلسلة. المعلّق فقط يجوز حذفه (إلغاء طلب خاطئ).
            // استثناء الأدمن (2026-10-01): admin يحذف أي حالة — بتوثيق إجباري.
            if (entity === 'dispatches') {
                const dispatchRow = (await pool.query('SELECT status FROM dispatches WHERE id = $1', [id])).rows[0];
                if (!dispatchRow) {return res.status(404).json({ error: 'NOT_FOUND', message: 'السجل المطلوب غير موجود' });}
                const isAdmin = req.user?.role === 'admin';
                if (!isAdmin) {
                    const deleteGuard = canDeleteDispatch(dispatchRow);
                    if (!deleteGuard.ok) {
                        const deleteMessages = {
                            DISPATCH_ALREADY_APPROVED: 'لا يمكن حذف إذن صرف معتمد — مستند مالي موقّع مرحّل مصروفات وحركات مخزون',
                            DISPATCH_REJECTED: 'لا يمكن حذف إذن مرفوض — قرار الرفض موقّع وموثّق في سلسلة الأحداث',
                            DISPATCH_ALREADY_RECEIVED: 'لا يمكن حذف إذن تم استلامه — الاستلام موقّع ومرحّل للمخزون',
                            DISPATCH_CHEF_DECIDED: 'لا يمكن حذف إذن اعتمده الشيف العمومي — قرار موقّع في السلسلة',
                            DISPATCH_INVALID_STATUS: 'حالة إذن الصرف لا تسمح بحذفه',
                        };
                        return res.status(409).json({ error: deleteGuard.code, message: deleteMessages[deleteGuard.code] || 'حذف إذن الصرف غير مسموح في هذه الحالة — الأدمن فقط يستطيع الحذف النهائي (force)' });
                    }
                } else {
                    // حذف تتابعي بأمر المالك (2026-10-01): إذن الأدمن يحذف معه كل
                    // المتعلقات المالية (دفتر/حركات/مصاريف/قيود/أحداث/تنبيهات) —
                    // الأرصدة المخزنية لا تُمس (واقع فيزيائي — يُسوّى بجرد)
                    const rel = await purgeDispatchRelated(id);
                    await logAdminForceDelete(req, entity, id,
                        `dispatch status=${dispatchRow.status} force-delete by admin + cascade ` +
                        `(journal=${rel.journal} ledger=${rel.ledger} tx=${rel.tx} expenses=${rel.expenses} events=${rel.events} notifications=${rel.notifications})`);
                    logger.warn('[admin] force-delete dispatch + cascade', { id, status: dispatchRow.status, by: req.user?.username || req.user?.id, ...rel });
                }
            }
            if (entity === 'expenses') { await purgeExpenseJournal(id); }
                        if (entity === 'inventory' && (req.query?.force === '1' || req.query?.force === 'true' || req.body?.force === true)) {
                // ROOT FIX 2026-10-02: الحذف القسري كان يفشل 500 بقيد RESTRICT —
                // ينضف الأرصدة والدفتر وحركات POS أولًا (قرار أدمن صريح موثق).
                try {
                    await pool.query(`DELETE FROM inventory_location_balances WHERE inventory_id = $1`, [id]);
                    await pool.query(`DELETE FROM inventory_ledger WHERE inventory_id = $1`, [id]);
                    await pool.query(`DELETE FROM "inventoryTx" WHERE "itemId" = $1`, [id]);
                } catch (e2) { logger.warn("[inventory-force-cleanup]", e2.message); }
            }
const result = await pool.query(`DELETE FROM "${entity}" WHERE id = $1 RETURNING *`, [id]);
            if (result.rows.length === 0) {return res.status(404).json({ error: 'NOT_FOUND', message: 'السجل المطلوب غير موجود' });}

            emitEntityChange(entity, 'delete', { id }, req);
            res.json({ message: 'Deleted successfully' });
        }));
    } else {
        // SPEC-employee-pwa-attendance-geofence-v1: الكتابة العامة على الحضور
        // للإدارة فقط — البصمة الذاتية للموظفين تمر حصريًا عبر مسار البوابة
        // الآمن (Geofence + ساعة السيرفر + تدقيق كامل).
        const openWriteRoles = entity === 'attendance' ? ['admin', 'manager', 'hr'] : getEntityWriteRoles(entity);
        const writeGuard = openWriteRoles ? [requireRoleOrPerm(openWriteRoles, permForEntity(entity, 'write'))] : [];
        app.delete(`/api/${entity}/:id`, jwtAuth, ...writeGuard, crudLimiter, asyncHandler(async (req, res) => {
            const { id } = req.params;
            // تدقيق أمني جولة 2: كيانات مالية/دفترية append-only — الحذف العام
            // عليها مغلق تمامًا (لا دور يملكه): دفتر الحركات، مرتجعات الأقسام
            // (حذفها يعيد فتح سقف الإرجاع)، وفواتير الموردين (حذفها يمحو الدين).
            // استثناء الأدمن (2026-10-01): admin يحذف عبر ?force=1 — بتوثيق إجباري.
            if (isProtectedDeleteEntity(entity)) {
                const isAdminForce = req.user?.role === 'admin'
                    && (req.query?.force === '1' || req.query?.force === 'true' || req.body?.force === true || req.body?.force === '1');
                if (!isAdminForce) {
                    return res.status(405).json({ error: 'PROTECTED_ENTITY_DELETE', message: 'هذا السجل جزء من السجل المالي المحصّن ولا يجوز حذفه عبر واجهة عامة — الأدمن فقط يستطيع الحذف النهائي (force)' });
                }
                await logAdminForceDelete(req, entity, id, `protected entity force-delete by admin`);
                logger.warn('[admin] force-delete protected entity', { entity, id, by: req.user?.username || req.user?.id });
            }
            const periodBlockDelOpen = await payrollRowViolation(entity, id);
            if (periodBlockDelOpen) {return res.status(423).json(periodBlockDelOpen);}
            // تدقيق أمني جولة 2: صنف مخزون له حركات/أرصدة لا يُحذف —
            // الحذف كان إما يفشل بخطأ FK خام (500) أو يمحو التاريخ المالي
            // للصنف عبر CASCADE. يجب تعطيل/تصفية الصنف عبر مساره المخصص.
            if (entity === 'inventory') {
                const itemIdNum = Number(id);
                if (!Number.isFinite(itemIdNum)) {return res.status(422).json({ error: 'INVALID_ID', message: 'معرف الصنف غير صحيح' });}
                const movementCount = (await pool.query(
                    `SELECT (SELECT COUNT(*)::int FROM inventory_ledger WHERE inventory_id = $1)
                          + (SELECT COUNT(*)::int FROM "inventoryTx" WHERE "itemId" = $1)
                          + (SELECT COUNT(*)::int FROM inventory_location_balances WHERE inventory_id = $1) AS total`,
                    [itemIdNum]
                )).rows[0]?.total || 0;
                if (movementCount > 0) {
                    const isAdminForceInv = req.user?.role === 'admin'
                        && (req.query?.force === '1' || req.query?.force === 'true' || req.body?.force === true);
                    if (!isAdminForceInv) {
                        return res.status(409).json({ error: 'INVENTORY_HAS_MOVEMENTS', message: 'لا يمكن حذف صنف له حركات مخزون أو أرصدة — صحّح رصيده بجرد أو أوقف استخدامه (الأدمن: حذف نهائي بـ force)' });
                    }
                    await logAdminForceDelete(req, entity, id, `inventory with ${movementCount} movements force-delete by admin`);
                }
            }
            if (entity === 'expenses') { await purgeExpenseJournal(id); }
                        if (entity === 'inventory' && (req.query?.force === '1' || req.query?.force === 'true' || req.body?.force === true)) {
                // ROOT FIX 2026-10-02: الحذف القسري كان يفشل 500 بقيد RESTRICT —
                // ينضف الأرصدة والدفتر وحركات POS أولًا (قرار أدمن صريح موثق).
                try {
                    await pool.query(`DELETE FROM inventory_location_balances WHERE inventory_id = $1`, [id]);
                    await pool.query(`DELETE FROM inventory_ledger WHERE inventory_id = $1`, [id]);
                    await pool.query(`DELETE FROM "inventoryTx" WHERE "itemId" = $1`, [id]);
                } catch (e2) { logger.warn("[inventory-force-cleanup]", e2.message); }
            }
const result = await pool.query(`DELETE FROM "${entity}" WHERE id = $1 RETURNING *`, [id]);
            if (result.rows.length === 0) {return res.status(404).json({ error: 'NOT_FOUND', message: 'السجل المطلوب غير موجود' });}

            emitEntityChange(entity, 'delete', { id }, req);
            res.json({ message: 'Deleted successfully' });
        }));
    }
});

// -------------------------------------------------------
// Static Files (frontend/app/ — creative UI redesign)
// -------------------------------------------------------
ensureMediaDirs();
app.use('/uploads', express.static(MEDIA_ROOT, {
    fallthrough: false,
    index: false,
    setHeaders: (res, filePath) => {
        const ext = path.extname(filePath).toLowerCase();
        if (['.png', '.jpg', '.jpeg', '.webp', '.gif', '.ico'].includes(ext)) {
            res.setHeader('Cache-Control', 'public, max-age=86400');
            res.setHeader('Vary', 'Accept-Encoding');
        } else {
            res.setHeader('Cache-Control', 'private, max-age=3600');
        }
    },
}));
const VENDOR_DIR = path.join(__dirname, '..', 'frontend', 'app', 'js', 'vendor');
const APP_DIR = path.join(__dirname, '..', 'frontend', 'app');
app.use('/app/js/vendor', express.static(VENDOR_DIR, {
    maxAge: '365d',
    immutable: true,
    setHeaders: (res, filePath) => setStaticCacheHeaders(res, filePath),
}));
app.use('/app', express.static(APP_DIR, {
    fallthrough: false,
    etag: true,
    lastModified: true,
    setHeaders: (res, filePath) => setStaticCacheHeaders(res, filePath),
}));

// -------------------------------------------------------
// OmniTrack POS — Institutional Smart Cashier Module
// Registers: /api/auth/login, /api/sales/complete,
//            /api/pos/* (shifts, departments, products, dashboard),
//            /metrics (Prometheus)
// -------------------------------------------------------
try {
    const cashierModule = require('./cashier-module');
    cashierModule.register(app, { io });
} catch (err) {
    logger.error('[cashier-module] Failed to register (continuing without POS module):', err.message);
    logger.error('  → Run `npm install` to install new deps (bullmq, ioredis, uuid, qrcode, bcryptjs).');
}

// ─── 404 catch-all (mounted AFTER all real routes) ───
// Produces a consistent AppError payload → globalErrorHandler picks it up.
app.use('/api', notFoundHandler);
app.use(notFoundHandler);

// ─── ⛔ Global Error Handler — MUST be the LAST app.use(). ───
// Catches every AppError / unknown thrown from routes + middleware,
// guarantees consistent JSON shape + structured log + never leaks stacks.
app.use(globalErrorHandler);

// -------------------------------------------------------
// Start Server
// -------------------------------------------------------

// ─── Enterprise process shields ──────────────────────────────
//   • uncaughtException / unhandledRejection → clean crash report
//   • memory watchdog (warns at 2GB RSS, configurable MEM_WARN_MB)
//   • Node.js diagnostic reports (OOM hints)
//   • Fatal DB / config errors → escalate to process restart
// (Replaces inline steelFail.)
installProcessShields({
    shutdownTimeoutMs: 15_000,
    onFatal: async (/* err */) => {
        stopDailyReportScheduler();
        try { attendanceEngine.stop(); } catch (_) {}
        try { yarasoftEngine.stop();   } catch (_) {}
        try { const { oracleEngine: oe } = require('./yarasoft/oracle-link'); oe.stop(); } catch (_) {}
        try { await whatsappEngine.stop(); } catch (_) {}
    },
});

// ─── Initialize Graceful Shutdown Handler ─────────────
initGracefulShutdown({
    server: httpServer,
    io,
    pool,
    logger,
}, {
    timeout: 30_000, // 30 seconds for graceful shutdown
    onShutdown: async (signal) => {
        logger.info(`\n${'='.repeat(50)}`);
        logger.info(`🛑 Received ${signal}. Starting graceful shutdown...`);
        stopDailyReportScheduler();
        attendanceEngine.stop(); // إيقاف مزامنة البصمة قبل إغلاق قاعدة البيانات
        yarasoftEngine.stop();   // إيقاف استيراد Yarasoft قبل إغلاق قاعدة البيانات
        try { require('./yarasoft/oracle-link').oracleEngine.stop(); } catch (_) {} // إيقاف الربط المباشر
        try { await whatsappEngine.stop(); } catch (_) {} // إيقاف محرك واتساب
    },
    onCleanup: (duration) => {
        logger.info(`✅ Cleanup completed in ${duration}ms`);
        logger.info(`${'='.repeat(50)}\n`);
    },
});

// ─── HTTP resilience timeouts (v4.7.0) ──────────────────────────────────────
// keepAliveTimeout must exceed upstream/proxy idle timeouts (default 5s is too
// short behind load balancers → 502s). headersTimeout must exceed keepAliveTimeout.
httpServer.keepAliveTimeout = 65_000;
httpServer.headersTimeout = 70_000;
httpServer.requestTimeout = 120_000;

httpServer.listen(PORT, '0.0.0.0', async () => {
    const nets = os.networkInterfaces();
    const ips = [];
    for (const name of Object.keys(nets)) {
        for (const net of nets[name]) {
            if (net.family === 'IPv4' && !net.internal) {ips.push(net.address);}
        }
    }

    logger.info(`\n${'='.repeat(50)}`);
    logger.info(`🚀  Karim ERP API Server — بدأ التشغيل`);
    logger.info(`📡  Port: ${PORT}`);
    logger.info(`🌐  Local:   http://localhost:${PORT}`);
    ips.forEach(ip => logger.info(`🌐  Network: http://${ip}:${PORT}`));
    logger.info(`⚡  Real-time: Socket.io جاهز`);

    // ─── Enterprise Boot Validation (env, DB, disk) ───
    try {
        await startup.runAll({ pool, failFast: false });
    } catch (e) {
        logger.error('[STARTUP] فحص الصحة قبل الإقلاع فشل:', e.message);
    }
    markBootComplete(); // flips /health/startup → 200

    // ─── إعلان LAN: أجهزة العميل (EXE) تكتشف هذا الخادم تلقائيًا عبر UDP 50505 ───
    if (String(process.env.KARIM_LAN_BEACON ?? 'true').trim().toLowerCase() !== 'false') {
        try {
            const primaryIp = (Object.values(require('os').networkInterfaces()).flat()
                .filter(i => i && i.family === 'IPv4' && !i.internal)
                .map(i => i.address).find(a => a.startsWith('192.168.')) || null);
            require('../common/lan-discovery').startLanBeacon({
                info: {
                    svc: 'karim-erp',
                    name: process.env.KARIM_SERVER_NAME || require('os').hostname(),
                    version: (() => { try { return require('../package.json').version || ''; } catch (_) { return ''; } })(),
                    scheme: LAN_SCHEME,
                    port: Number(PORT),
                    host: primaryIp,
                },
                logger,
            });
        } catch (e) { logger.warn('[LAN_BEACON] تعذر بدء الإعلان (سيستمر الخادم بدونه):', e.message); }
    }

    stopDailyReportScheduler = startDailyReportScheduler(pool);
    // ─── مزامنة البصمة داخل النظام: طبّق المخطط ثم ابدأ المحرك ───
    ensureZktecoSchema()
        .then(() => attendanceEngine.start(io))
        .catch((error) => logger.error('[ZKTECO] تعذر تهيئة مزامنة البصمة (سيستمر الخادم بدونها):', error.message));
    // ─── تنظيف الإشعارات: ROOT FIX 2026-10-02 — جدول الإشعارات كان يكبر بلا
    // تنظيف — المقروء الأقدم من 30 يومًا يُمسح يوميًا (fail-open). ───
    const purgeReadNotifications = async () => {
        try {
            const r = await pool.query("DELETE FROM notifications WHERE read = true AND read_at < NOW() - INTERVAL '30 days'");
            if (r.rowCount) {logger.info(`[notifications] purged ${r.rowCount} read notifications`);}
        } catch (e) { logger.warn("[notifications-purge]", e.message); }
    };
    purgeReadNotifications();
    const _notifPurgeTimer = setInterval(purgeReadNotifications, 24 * 60 * 60 * 1000);
    if (_notifPurgeTimer.unref) {_notifPurgeTimer.unref();}
    // ─── استيراد فواتير Yarasoft داخل النظام: المخطط ثم المحرك (معطّل حتى YARASOFT_ENABLED=true) ───
    ensureYarasoftSchema()
        .then(() => yarasoftEngine.start(io))
        .catch((error) => logger.error('[YARASOFT] تعذر تهيئة استيراد الفواتير (سيستمر الخادم بدونها):', error.message));
    // ─── الربط المباشر Oracle (معطّل حتى YARASOFT_ORACLE_ENABLED=true) ───
    // الدورة تُنفَّذ في عملية قصيرة العمر (scripts/oracle-poll-worker.js): خيوط
    // oracledb Thick الأصلية لا تبقى في عملية السيرفر — راجع تعليق العامل لتفاصيل
    // مشكلة حرق CPU التي حُلّت بهذا العزل.
    try {
        const { spawn: spawnWorker } = require('child_process');
        const { loadOracleConfig } = require('./yarasoft/oracle-link');
        const oraCfg = loadOracleConfig();
        if (oraCfg.enabled) {
            const pollMs = Math.max(1, oraCfg.pollMinutes || 1) * 60 * 1000;
            const runOracleWorker = () => {
                const w = spawnWorker(process.execPath, [path.join(__dirname, '..', 'scripts', 'oracle-poll-worker.js')],
                    { stdio: 'ignore', cwd: path.join(__dirname, '..'), env: process.env });
                w.on('error', (e) => logger.error('[YARASOFT_ORACLE] تعذر تشغيل عامل الدورة:', e.message));
            };
            runOracleWorker(); // دورة أولى بعد الإقلاع مباشرة
            const oraTimer = setInterval(runOracleWorker, pollMs);
            if (oraTimer.unref) {oraTimer.unref();}
            logger.info(`[YARASOFT_ORACLE] عامل دورة Oracle نشط (كل ${oraCfg.pollMinutes} دقيقة، عملية معزولة)`);
        }
    }
    catch (error) { logger.error('[YARASOFT_ORACLE] تعذر بدء الربط المباشر (سيستمر الخادم بدونه):', error.message); }
    // ─── محرك المزامنة الذكي: لحاق تلقائي بالفواتير الفائتة بعد الإقلاع ───
    // نُقل إلى scripts/oracle-poll-worker.js (عملية معزولة) — راجع تعليق عامل Oracle
    // (كان: try { require('./yarasoft/sync-doctor').bootCatchUp(io); } catch ...)
    // ─── محرك واتساب: المخطط ثم البدء (معطّل حتى WHATSAPP_ENABLED=true) ───
    if (ensureWhatsappSchema && whatsappEngine) {
        ensureWhatsappSchema()
            .then(() => whatsappEngine.start(io))
            .catch((error) => logger.error('[WHATSAPP] تعذر تهيئة محرك واتساب (سيستمر الخادم بدونه):', error.message));
    }
    logger.info(`${'='.repeat(50)}\n`);
});


