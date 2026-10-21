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
// OpenTelemetry — صامت تمامًا ما لم OTEL_ENABLED=true (يجب أن يسبق express/pg)
require('./otel');
const { logger, httpLogger } = require("./logger");
const { MEDIA_ROOT, ensureMediaDirs } = require('./media-storage');
const { spawn } = require('child_process');

// ─── Enterprise Foundation Layers ──────────────────────────
const { correlationMiddleware } = require('./middleware/correlation');
const { createBrotliStatic } = require('./middleware/brotli-static');
const { createBrotliMetrics } = require('./middleware/brotli-metrics');
const { createCachePolicy, resolveCacheLimits } = require('./middleware/brotli-cache-policy');
const { securityHeaders, hppGuard, buildV2Csp, buildStrictCsp, createCspReportCollector } = require('./middleware/security');
const { posChannelMeter, getMeter: getPosChannelMeter } = require('./middleware/pos-channel-meter');
const { createHealthRouter, markBootComplete, registerCheck } = require('./middleware/health');
const { idempotency, ensureIdempotencySchema } = require('./middleware/idempotency');
const { registerWithHealthChecks: circuitRegisterHealth } = require('./middleware/circuit');
const startup = require('./startup');
const {
    attachSafeHelpers,
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
const { guardCreate } = require('./submit-guard');
const { router: hrRouter } = require('./hr-routes');
const { router: warehouseRouter, ensureLegacyKitchenReceiptLedger, resolveDeptHeadDispatch, canDeleteDispatch, dispatchStockGate, canonicalDeptCode } = require('./warehouse-routes');
const { postInventoryLedgerEntry } = require('./inventory-ledger');
const { normalizeExpiryDate, readExpiryField } = require('./expiry-policy');
const { router: inventoryControlRouter } = require('./inventory-control-routes');
const { router: stocktakingRouter, ensureStocktakingSchema } = require('./stocktaking-routes');
const { router: inventoryTransferRouter } = require('./inventory-transfer-routes');
const { router: kitchenProductionRouter, ensureKitchenSchema } = require('./kitchen-production-routes');
const { router: procurementRouter, ensureProcurementSchema } = require('./procurement-routes');
const { router: financeRouter, resolveCostAnalysisPeriod } = require('./finance-routes');
const { router: leaveWorkflowRouter, ensureLeaveWorkflowSchema } = require('./leave-workflow-routes');
const { ensureNotificationsSchema } = require('./notification-service');
const notificationRouter = require('./notification-routes');
const { notifyChainEvent, ensureDispatchCreatorSchema } = require('./dispatch-notifier');
// ─── مزامنة أجهزة البصمة داخل النظام (ZKTeco) — ليست خدمة منفصلة ──
const { router: zktecoRouter, ensureZktecoSchema, attendanceEngine } = require('./zkteco');
const { router: yarasoftRouter, ensureYarasoftSchema, yarasoftEngine } = require('./yarasoft');

// ─── Schema Registry (Column Whitelist for Security) ──
const { filterBody, validateColumnName, getSortableColumns, getSchema, getEntityWriteRoles, isProtectedDeleteEntity, maskEmployeeRowForRole } = require('./schema-registry');
const { encryptForVault, ensurePasswordVaultSchema } = require('./password-vault');
// decryptFromVault يُستخدم الآن داخل ops-inspect-routes.js
// ─── طبقة الفروع (migration 102) — تصفية CRUD الديناميكي حسب branch_id ───
const branchCtx = require('./branch-context');
// M20: riyadhToday for business dates
const { riyadhToday } = require('./riyadh-date');

// ─── Pagination Utilities ─────────────────────────────
const { parsePaginationParams, buildPaginatedQuery } = require('./pagination');

// ─── Rate Limiting ──────────────────────────────────
const { generalLimiter, stateLimiter, crudLimiter } = require('./rate-limiter');

// ─── Graceful Shutdown Handler ──────────────────────
const { initGracefulShutdown, rejectDuringShutdown, getShutdownStatus } = require('./graceful-shutdown');
// مسارات التقارير والإحاطة نُقلت إلى reports-routes.js — بقي هنا مجدول التقرير اليومي فقط
const { startDailyReportScheduler } = require('./daily-report-service');

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
const fs = require('fs'); // FIX 2026-10-11: moved to module scope — was block-scoped, broke /app/sw.js at line 2497+
{
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
    connectTimeout: 20000,
    // HARDENED 2026-10-08: استرداد حالة الاتصال — انقطاع لحظي (شبكة جوال)
    // يستعيد الحزم الفائتة تلقائيًا بدل إعادة التحميل الكاملة
    connectionStateRecovery: {
        maxDisconnectionDuration: 2 * 60 * 1000,
        skipMiddlewares: true,
    },
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

// 4b ════ قياس CSP قبل الفرض (Phase: تقوية الـCSP) ═══════════════
// الواجهة القديمة فيها ~1100 معالج سطري، ففرض script-src-attr 'none'
// دفعة واحدة يكسرها. لذلك: تُرسل سياسة صارمة كـReport-Only (لا تمنع
// شيئًا) وتُستقبل التقارير فتُعرف بالضبط ما الذي يكسر قبل الفرض.
// مُعطّل افتراضيًا (CSP_STRICT_REPORT_ONLY) ⇒ صفر تغيير في السلوك.
const cspReports = createCspReportCollector();
const cspMeasurementEnabled = String(process.env.CSP_STRICT_REPORT_ONLY || '').toLowerCase() === 'true';
if (cspMeasurementEnabled) {
    app.use((req, res, next) => {
        // V2 له CSP صارم خاص به — لا نلمسه
        if (String(req.path || '').endsWith('/v2.html')) {return next();}
        // nonce حقيقي per-request + report-uri حتى تصل التقارير إلى الجامع
        res.setHeader('Content-Security-Policy-Report-Only',
            buildStrictCsp({ nonce: req.cspNonce, reportUri: '/api/security/csp-report' }));
        next();
    });
    logger.info('[csp] قياس الانتهاكات مفعّل (Report-Only) — التقارير على /api/security/csp-report');
}

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
        /* إجبار UTF-8 على كل HTML — يمنع المتصفح من تخمين ترميز غلط */
        const ct = res.getHeader('Content-Type');
        if (!ct || !/charset/i.test(ct)) {
            res.setHeader('Content-Type', 'text/html; charset=utf-8');
        } else if (!/charset=utf-?8/i.test(ct)) {
            res.setHeader('Content-Type', ct.replace(/charset=[^;]+/i, 'charset=utf-8'));
        }
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

// ─── Body Parsers (MUST be before apiKeyMiddleware so req.body is available) ───
// استيراد الإكسل (مسار صفوف JSON) هو النقطة الوحيدة المسموح لها جسم كبير —
// يُركّب قبل المحلل العام ليطالب الجسم نفسه ويمنع المحلل العام من رفضه.
// FIX 2026-10-11 (C7): reduced from 50mb to 10mb — 50mb pre-auth was an
// unauthenticated memory DoS vector. 10mb is enough for realistic Excel imports.
app.use('/api/inventory/import', express.json({ limit: '10mb' }));
// حد عام مشدّد (2MB): يقطع هجمات الحشو مبكرًا بدل سحب الذاكرة على 50MB لكل طلب
app.use(express.json({ limit: '2mb', strict: true }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));

// ─── استقبال تقارير CSP (بعد محلّل الجسم وإلا وصل req.body فارغًا) ────────
if (cspMeasurementEnabled) {
    // المتصفح يرسل تقرير CSP بنوع application/csp-report — لا يلتقطه
    // محلّل JSON الافتراضي، فنقرأ النص ونحلّله بأنفسنا.
    app.post('/api/security/csp-report',
        express.text({ type: ['application/csp-report', 'application/json', 'text/plain'], limit: '64kb' }),
        (req, res) => {
            try {
                const raw = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
                cspReports.record(raw['csp-report'] || raw);
            } catch (_) { /* تقرير تالف — نتجاهله */ }
            res.status(204).end();
        });
    app.get('/api/security/csp-report', (req, res) => {
        res.json({ ok: true, total: cspReports.total(), counters: cspReports.snapshot() });
    });
}
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
    // شاشة منيو المول (Digital Signage): أسماء أصناف وأسعار — معلومات علنية
    // بطبيعتها (معروضة على الشاشة أصلاً). جهاز العرض متصفح بلا تسجيل دخول.
    if (req.path === '/menu-board/public' || req.path === '/menu-board/background' || req.path === '/buffet-menu') {
        return next();
    }
    // إعداد اللغة/العملة العام للواجهات قبل تسجيل الدخول — بيانات عرض فقط
    if (req.path === '/i18n/config') {
        return next();
    }
    // سياسة توحيد مسار POS — تُقرأ قبل تسجيل الدخول (لعرض التنبيه/التوجيه
    // على الشاشة القديمة)، ولا تحوي إلا الوضع والمسار — لا سرّ.
    if (req.path === '/pos/path-policy') {
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
// Phase 4.1: قياس قناة واجهة POS الفعلية (pos / cashier / v2-embedded).
// لا يفتح اتصال قاعدة ولا يستورد شيئاً من الإنتاج، ولا يُسقط أي طلب.
// المرجع من المتصفح (Referer/Origin) هو مصدر القرار — لا ترويسة العميل.
app.use('/api', posChannelMeter);
// بدء الكتابة الدورية لملف القياس اليومي (كل 5 ثوانٍ، unref فلا يمنع الإغلاق)
getPosChannelMeter().start();
// FIX 2026-10-11 (C6): moved apiCacheMiddleware AFTER apiKeyMiddleware + rejectDuringShutdown
// — was mounted at line 412 (before auth), so a cache HIT bypassed API-key check,
// shutdown rejection, and rate limiting. Now cached responses are only served
// after the request has passed the security perimeter.
app.use(apiCacheMiddleware);

// Real employee portal: signed QR cards, attendance actions, and printable reports.
app.use('/api/hr', (req, res, next) => { req.io = io; next(); }, hrRouter);
try {
    require('./hr-routes').startShiftRollover();
} catch (e) {
    logger.error('[SHIFT_ROLLOVER] scheduler failed to start:', e.message);
}
// R3 (قرار المالك 2026-10-03): كاسح جسر الإيراد اللحظي — يلتقط أي صف إيراد
// يارسوفت فشل ترحيله اللحظي (سقوط/إعادة تشغيل). الحدث الأساسي داخل importer
// بعد COMMIT؛ هذا مجرد صمام أمان كل 5 دقائق.
try {
    const { bridgeUnbridged } = require('./yarasoft/gl-bridge');
    let yaraGlSweepRunning = false;
    const yaraGlSweep = async () => {
        if (yaraGlSweepRunning) {return;}
        yaraGlSweepRunning = true;
        try {
            await bridgeUnbridged(pool);
        } catch (e) {
            logger.warn('[YARA-GL] sweep failed:', e.message);
        } finally {
            yaraGlSweepRunning = false;
        }
    };
    setTimeout(yaraGlSweep, 90_000);
    setInterval(yaraGlSweep, 5 * 60_000);
} catch (e) {
    logger.error('[YARA-GL] sweep scheduler failed to start:', e.message);
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
// طلبات شراء الخضار: المطبخ (شيف/سو شيف) يبني الطلب من قايمة جاهزة → المخازن تستلم ويطبع الطرفان (2026-10-04)
const vegRequestsRouter = require('./veg-requests-routes'); // module.exports = router
app.use('/api/veg-requests', (req, res, next) => { req.io = io; next(); }, vegRequestsRouter);
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
// ─── محرك استعلامات المخزون (قراءة فقط — الدفتر هو المرجع، للمدير والسو-شيف) ──
app.use('/api/inventory-inquiry', require('./inventory-inquiry').router);
// ─── متابعة الكاشير للأونر (مرآة يارا سوفت 1/4/5/6/9 — قراءة فقط + بث حي) ──
app.use('/api/cashier-monitor', (req, res, next) => { req.io = io; next(); }, require('./cashier-monitor-routes'));
// ─── النسخ الاحتياطي الكامل والاستعادة بزر واحد (مدير فقط) ─────────────
const systemRouter = require('./system-routes');
app.use('/api/system', (req, res, next) => { req.io = io; next(); }, systemRouter);
// ─── محرك واتساب (Baileys — معطّل حتى WHATSAPP_ENABLED=true) ─────────────
// محرك واتساب تحميله محمي: بيئة تشغيل لا تدعم require(ESM) (baileys) —
// مثل Node المدمج في Electron — تعطل تحميله يجب ألا يُسقط الخادم كله.
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

// Manager briefing + daily reports — مُستخلص إلى reports-routes.js
require('./reports-routes').register(app, { pool });

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
    socket.on('register_user', async (_data) => {
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

// ─── الشات الداخلي للأجهزة المتصلة — مُستخلص إلى internal-chat-routes.js ───
require('./internal-chat-routes').register(app, { io, connectedClients });

// -------------------------------------------------------
// Root/menu redirects + legacy buffet-menu API — مُستخلص إلى menu-legacy-routes.js
// -------------------------------------------------------
require('./menu-legacy-routes').register(app, { io });

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

// Network info + connected clients — مُستخلص إلى network-routes.js (خلف JWT)
require('./network-routes').register(app, { connectedClients, PORT });

// ─── Runtime metrics (enterprise observability) ─────────────
// لقطة حية: عدّادات الطلبات ومئينات زمن الاستجابة وتأخر حلقة الأحداث
// وذاكرة العملية واستغلال مسبّح قاعدة البيانات — للمالك/المدير فقط.
ensurePasswordVaultSchema().catch((e) => logger.warn('[pw-vault] schema skipped:', e.message));

// Password vault view + runtime metrics + schema constraints — مُستخلص إلى ops-inspect-routes.js
require('./ops-inspect-routes').register(app, { metrics });

// إدارة الفروع /api/branches — backend/branch-routes.js (migration 102_branches)
require('./branch-routes').register(app);

// إعداد اللغة/العملة العام — backend/i18n-routes.js
require('./i18n-routes').register(app);

// سياسة توحيد مسار POS (off | banner | redirect) — backend/pos-path-routes.js
require('./pos-path-routes').register(app);


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
    JSON.stringify(state);

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
        const day = /^\d{4}-\d{2}-\d{2}$/.test(String(expenseRow.date || '').slice(0, 10)) ? String(expenseRow.date).slice(0, 10) : riyadhToday();
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
    // FIX 2026-10-11 (L3): wider random range (0-999999) to further reduce
    // collision probability under concurrent bursts.
    return Date.now() * 1000 + crypto.randomInt(0, 999999);
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

// ختم branch_id عند الإنشاء للكيانات الواعية بالفروع (102_branches) — يُسقط
// filterBody عمود branch_id لأنه غير معلن في المخطط، فالختم هنا بعد الترشيح.
async function stampBranchOnCreate(entity, req, filtered) {
    if (!branchCtx.BRANCH_AWARE_ENTITIES.has(entity)) {return filtered;}
    const branchId = await branchCtx.stampForCreate(req, filtered.branch_id);
    return { ...filtered, branch_id: branchId };
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
    const safe = { ...row };
    delete safe.password;
    delete safe.password_vault;
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
    'dept_cashier_links',
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
    dept_cashier_links: 'روابط الأقسام بالكاشير',
};

async function ensureEmployeeUserLinkSchema() {
    await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS employees_userid_unique_idx
      ON "employees" ("userId") WHERE "userId" IS NOT NULL`);
}

// ─── Dedicated attendance range endpoint (avoids 142-page pagination bottleneck) ───
// dept_head: يرى سجل حضور/انصراف موظفي قسمه حصرًا — نطاق rosterScope نفسه
// (dept_code يقبل قائمة أقسام مفصولة بفواصل، والمقارنة غير حساسة لحالة الأحرف)
app.get('/api/attendance/range', jwtAuth, requireRoleOrPerm([...SENSITIVE_READ_ROLES, 'hr', 'dept_head'], 'hr.view'), asyncHandler(async (req, res) => {
    const from = String(req.query.from || '').slice(0, 10);
    const to = String(req.query.to || '').slice(0, 10);
    if (!from || !to) {return res.status(400).json({ error: 'MISSING_DATES', message: 'from and to params required (YYYY-MM-DD)' });}
    const limit = Math.min(parseInt(req.query.limit, 10) || 10000, 50000);
    const params = [from, to, limit];
    let deptFilter = '';
    if (req.user?.role === 'dept_head') {
        const depts = String(req.user.dept_code || '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
        if (!depts.length) {
            return res.status(403).json({ error: 'DEPT_HEAD_WITHOUT_DEPARTMENT', message: 'حساب رئيس القسم غير مرتبط بأي قسم — راجع مسؤول النظام' });
        }
        params.push(depts);
        deptFilter = ` AND "employeeId" IN (SELECT id FROM employees WHERE LOWER(TRIM("department")) = ANY($${params.length}))`;
    }
    const { rows } = await pool.query(
        `SELECT * FROM attendance WHERE date >= $1 AND date <= $2${deptFilter} ORDER BY date DESC, "employeeId" ASC LIMIT $3`,
        params
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

/**
 * 103 — روابط الأقسام بالكاشير (طلب المالك 2026-10-19): حرس الكتابة على
 * الكيان dept_cashier_links عبر الباب العام. الخادم يظل الحاكم: القسم لا بد
 * مسجل، رقم الكاشير أرقام فقط، لا تكرار للربط، وكاشير أساسي واحد لكل قسم
 * (الباقِي يُخفَّض تلقائيًا بدل رفض الطلب).
 */
async function validateDeptCashierLink(filtered, currentId = null) {
    const deptCode = String(filtered.dept_code ?? '').trim();
    const cashierNo = String(filtered.cashier_no ?? '').trim();
    if (!deptCode) {
        const error = new Error('كود القسم مطلوب');
        error.statusCode = 422; error.code = 'DEPT_CODE_REQUIRED'; throw error;
    }
    if (!cashierNo) {
        const error = new Error('رقم الكاشير مطلوب');
        error.statusCode = 422; error.code = 'CASHIER_NO_REQUIRED'; throw error;
    }
    if (!/^[0-9]{1,6}$/.test(cashierNo)) {
        const error = new Error('رقم الكاشير أرقام فقط (مثل 1 أو 9)');
        error.statusCode = 422; error.code = 'INVALID_CASHIER_NO'; throw error;
    }
    const dept = await pool.query('SELECT code FROM departments WHERE code = $1 LIMIT 1', [deptCode]);
    if (!dept.rows.length) {
        const error = new Error('القسم غير موجود في سجل الأقسام');
        error.statusCode = 422; error.code = 'DEPT_NOT_FOUND'; throw error;
    }
    const duplicate = await pool.query(
        'SELECT id FROM dept_cashier_links WHERE dept_code = $1 AND cashier_no = $2 AND id <> $3 LIMIT 1',
        [deptCode, cashierNo, currentId || 0]
    );
    if (duplicate.rows.length) {
        const error = new Error('هذا الكاشير مربوط بهذا القسم بالفعل');
        error.statusCode = 409; error.code = 'DEPT_CASHIER_LINK_EXISTS'; throw error;
    }
    const primary = filtered.is_primary === true || filtered.is_primary === 'true' || filtered.is_primary === 1;
    if (primary) {
        await pool.query(
            'UPDATE dept_cashier_links SET is_primary = false WHERE dept_code = $1 AND cashier_no <> $2',
            [deptCode, cashierNo]
        );
    }
    return { ...filtered, dept_code: deptCode, cashier_no: cashierNo };
}

/**
 * حرس تاريخ الصلاحية على البوابة العامة (سياسة المالك 2026-10-20:
 * التاريخ اختياري، ويُرفض فقط إن جاء بصيغة فاسدة).
 *
 * تاريخ الصلاحية تاريخ **دُفعة** لا عمود في جدول inventory — الحقيقة لكل دُفعة
 * في inventory_ledger.expiry_date. لذا يُقرأ من الطلب هنا قبل الترشيح، يُتحقق
 * منه، ثم يُزال من الجسم ويُمرَّر إلى قيد الرصيد الافتتاحي.
 * @returns {{expiryDate: (string|null), error?: {error:string, message:string}}}
 */
function checkInventoryOpeningExpiry(entity, body) {
    if (entity !== 'inventory') {return { expiryDate: null };}
    const raw = readExpiryField(body || {});
    const expiryDate = normalizeExpiryDate(raw);
    const qty = Number((body || {}).qty) || 0;
    if (qty <= 0) {return { expiryDate };}
    if (!raw) {
        return { expiryDate: null };
    }
    if (!expiryDate) {
        return { expiryDate: null, error: { error: 'INVALID_EXPIRY_DATE', message: `تاريخ الصلاحية غير صحيح (${String(raw).slice(0, 24)}) — الصيغة المطلوبة YYYY-MM-DD` } };
    }
    return { expiryDate };
}

/** إسقاط حقول الصلاحية المكافئة من الجسم حتى لا تُرفض كحقل غير مسموح. */
function dropExpiryFields(req) {
    const body = req.body;
    if (!body || typeof body !== 'object') {return;}
    const aliases = ['expiryDate', 'expiry_date', 'bestBefore', 'best_before'];
    if (!aliases.some((key) => Object.prototype.hasOwnProperty.call(body, key))) {return;}
    req.body = { ...body };
    for (const key of aliases) {delete req.body[key];}
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
    // FIX 2026-10-11: use ENTITY_READ_ROLES (7 entities) instead of sensitiveReadEntities (5)
    // — salary_advances, payroll_adjustments, employee_contracts, employee_evaluations,
    // payroll_runs were ungated because they were only in ENTITY_READ_ROLES
    const requiresElevatedRead = sensitiveReadEntities.includes(entity) || entity in ENTITY_READ_ROLES;

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

        // ─── تصفية الفرع: null = كل الفروع (سلوك ما قبل 102 حرفيًا) ───
        const branchId = branchCtx.BRANCH_AWARE_ENTITIES.has(entity) ? await branchCtx.resolveBranch(req) : null;

        const queryOptions = { branchId };
        const v2MonthDateColumn = {
            revenues: 'date',
            expenses: 'date',
            dispatches: 'date',
            inventoryTx: 'date',
            kitchenReturns: 'date',
            purchaseInvoices: 'date',
        }[entity];
        if (v2MonthDateColumn && req.query.v2_period === 'month') {
            const { from, to } = resolveCostAnalysisPeriod({});
            const toExclusive = new Date(`${to}T00:00:00.000Z`);
            toExclusive.setUTCDate(toExclusive.getUTCDate() + 1);
            queryOptions.dateRange = {
                column: v2MonthDateColumn,
                from,
                toExclusive: toExclusive.toISOString().slice(0, 10),
            };
        }

        // Build safe paginated query
        const { dataQuery, countQuery, params, countParams } = buildPaginatedQuery(entity, pagination, queryOptions);

        // Execute both queries in parallel for performance
        const [dataResult, countResult] = await Promise.all([
            pool.query(dataQuery, params),
            pool.query(countQuery, countParams),
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
        // PERF 2026-10-08 (load test): قوائم الكيانات كانت تشحن صور التواقيع
        // (base64 ~40KB لكل توقيع — قائمة الصرف 1.9MB!) فتخنق الجوال والشبكة.
        // صور التواقيع تُجلب عند الطلب فقط عبر GET /:id (طباعة/تفاصيل).
        const listRows = dataResult.rows.map(row => viewerSafeRow(entity, row, req));
        if (entity === 'dispatches') {
            for (const r of listRows) {
                delete r.requestSignatureData;
                delete r.warehouseApprovalSignatureData;
                delete r.kitchenReceiptSignatureData;
                delete r.chefApprovalSignatureData;
                delete r.chefRejectionSignatureData;
                delete r.warehouseRejectionSignatureData;
            }
        }
        return res.json({
            data: listRows,
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
        // تصفية الفرع على التفاصيل أيضًا — قائمة مقفولة بتفاصيل مفتوحة = IDOR بين الفروع
        if (branchCtx.BRANCH_AWARE_ENTITIES.has(entity)) {
            const branchId = await branchCtx.resolveBranch(req);
            if (branchId != null && Number(result.rows[0].branch_id) !== branchId) {
                return res.status(404).json({ error: 'NOT_FOUND', message: 'السجل المطلوب غير موجود' });
            }
        }
        res.json(viewerSafeRow(entity, result.rows[0], req));
    }));

    // POST create (role-based auth for sensitive entities)
    if (requiresAdminRole || entity === 'dispatches') {
        const createRoles = entity === 'dispatches' ? ['admin', 'manager', 'warehouse', 'kitchen', 'sous_chef', 'dept_head'] : entity === 'payroll' ? ['admin', 'manager', 'accountant'] : ['admin', 'manager'];
        app.post(`/api/${entity}`, jwtAuth, requireRoleOrPerm(createRoles, permForEntity(entity, 'write')), crudLimiter, guardCreate(entity), asyncHandler(async (req, res) => {
            // ─── SECURITY: Filter body against whitelist (CRITICAL FIX) ──
            // حرس الصلاحية (سياسة 2026-10-20): الرصيد الافتتاحي بلا تاريخ مقبول.
            const expiryGuardA = checkInventoryOpeningExpiry(entity, req.body);
            if (expiryGuardA.error) {return res.status(422).json(expiryGuardA.error);}
            dropExpiryFields(req);
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
                const requestFields = { ...filtered };
                delete requestFields.status;
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
                    const canonCode = canonicalDeptCode(resolved.deptCode);
                    const deptRow = (await pool.query('SELECT code, name FROM departments WHERE LOWER(code)=LOWER($1) OR LOWER(code)=LOWER($2) LIMIT 1', [resolved.deptCode, canonCode])).rows[0]
                        || (await pool.query('SELECT code, name FROM "hrDepartments" WHERE LOWER(code)=LOWER($1) OR LOWER(code)=LOWER($2) LIMIT 1', [resolved.deptCode, canonCode])).rows[0];
                    if (!deptRow) {return res.status(422).json({ error: 'DEPT_NOT_FOUND', message: `القسم المرتبط بالحساب غير موجود: ${resolved.deptCode}` });}
                    requestFields.deptCode = deptRow.code;
                    requestFields.deptName = deptRow.name;
                    filtered = { ...requestFields, status: 'pending', createdBy: req.user.name || req.user.username || String(req.user.id), requestedAt: new Date().toISOString(), creatorRole: 'dept_head', needsChefApproval: true, creatorUserId: req.user.id };
                } else {
                    if (requestFields.deptCode) {
                        const canonCode = canonicalDeptCode(requestFields.deptCode);
                        const opDept = (await pool.query('SELECT code, name FROM departments WHERE LOWER(code)=LOWER($1) OR LOWER(code)=LOWER($2) LIMIT 1', [requestFields.deptCode, canonCode])).rows[0];
                        if (opDept) {
                            requestFields.deptCode = opDept.code;
                            if (!requestFields.deptName || requestFields.deptName === 'قسم غير معروف') {requestFields.deptName = opDept.name;}
                        }
                    }
                    filtered = { ...requestFields, status: 'pending', createdBy: req.user.name || req.user.username || String(req.user.id), requestedAt: new Date().toISOString(), creatorRole: req.user?.role || null, needsChefApproval: false, creatorUserId: req.user.id };
                }
                // طلب المالك 2026-10-05: «لا يقبل أي إذن صرف ليس له رصيد في المخزن نهائيًا» —
                // البوابة عند الإنشاء نفسه: طلب صنف غير موجود أو كميته فوق الرصيد يُرفض فورًا
                // ولا يدور في سلسلة الاعتماد أصلًا (نفس معادلة الرصيد المستخدمة في الخصم الفعلي)
                let gateItems = filtered.items;
                if (typeof gateItems === 'string') { try { gateItems = JSON.parse(gateItems || '[]'); } catch (_) { gateItems = []; } }
                if (Array.isArray(gateItems) && gateItems.length) {
                    const stockGate = await dispatchStockGate(pool, gateItems);
                    if (!stockGate.ok) {
                        return res.status(409).json({
                            error: 'INSUFFICIENT_STOCK',
                            message: 'لا يمكن قبول إذن الصرف — الرصيد غير كافٍ في المخزن: ' + stockGate.shortages.map(s => s.message).join('، '),
                            shortages: stockGate.shortages,
                        });
                    }
                }
                // HARDENED 2026-10-08: طلب صرف اتكرر 13 مرة بضغطات متتالية —
                // نفس المنشئ + القسم + الأصناف (اسم+كمية+وحدة) خلال 10 دقائق = مكرر.
                // المقارنة في جافاسكربت (تطبيع شامل) — بصمات SQL النصية غير موثوقة
                // لاختلاف ترتيب المفاتيح في JSON.
                // FIX 2026-10-11 (C11): removed broken `id > $3` clause — dispatch IDs
                // are Date.now()*1000+rand, so `id > Date.now()-600000` was always true,
                // collapsing the 10-minute window into "any matching dispatch today".
                // The requestedAt interval alone correctly bounds the window.
                {
                    const normIt = (arr) => (Array.isArray(arr) ? arr : [])
                        .map(r => `${String(r.itemName || r.name || '').trim().toLowerCase()}|${Number(r.approvedQty ?? r.qty ?? 0)}|${String(r.unit || '').trim()}`)
                        .sort().join(';;');
                    const newSig = normIt(gateItems);
                    const whoDb = filtered.createdBy || null;
                    const candRows = (await pool.query(
                        `SELECT id, items FROM dispatches
                          WHERE date = to_char(CURRENT_DATE, 'YYYY-MM-DD')
                            AND ($1::text IS NULL OR "createdBy" = $1)
                            AND "deptCode" = $2
                            AND "requestedAt" >= NOW() - INTERVAL '10 minutes'
                          ORDER BY id DESC LIMIT 20`,
                        [whoDb, filtered.deptCode || null])).rows;
                    const dupDisp = candRows.find(r => {
                        try {
                            const ex = typeof r.items === 'string' ? JSON.parse(r.items) : r.items;
                            return normIt(ex) === newSig && newSig.length > 0;
                        } catch (_) { return false; }
                    });
                    if (dupDisp) {
                        return res.status(409).json({ ok: false, code: 'DUPLICATE_DISPATCH', message: 'طلب صرف مشابه أُنشئ قبل أقل من 10 دقائق — تم تجاهل الطلب المكرر', duplicateOf: { id: dupDisp.id } });
                    }
                }
            }
            // سستم حديد 2026-10-06: منع إنشاء صنف مكرر باختلافات شكلية في الاسم (مسافات/حالة) —
            // نفس فئة الخلل التي أنتجت 12 صنفًا مكررًا بإعادة إدخال الافتتاحي
            if (entity === 'inventory' && String(filtered.name || '').trim()) {
                const nameKey = String(filtered.name).trim().toLowerCase().replace(/\s+/g, '');
                const twin = (await pool.query(
                    `SELECT id, name FROM inventory WHERE lower(regexp_replace(name, '\\s+', '', 'g')) = $1 LIMIT 1`,
                    [nameKey])).rows[0];
                if (twin) {
                    return res.status(409).json({
                        error: 'DUPLICATE_ITEM_NAME',
                        message: `الصنف «${twin.name}» موجود في المخزن بالفعل — لا يُنشأ مكرر. عدّل الصنف الموجود أو راجع أداة دمج الأصناف`,
                        existingId: twin.id,
                    });
                }
            }
            // Catch Weight: صنف لحوم/دواجن/أسماك مخزون بالوزن ⇒ وزن متغير تلقائيًا
            // (طلب بالكرتون + صرف بالوزن الفعلي) — ما لم يحدد المرسل الحقل صراحةً
            if (entity === 'inventory' && filtered.catch_weight_enabled == null) {
                const suggested = require('./catch-weight-heuristic').suggestCatchWeight(filtered.name, filtered.unit);
                if (suggested) {filtered = { ...filtered, ...suggested };}
            }
            // Auto-generate id for legacy tables that mark `id` as protected
            filtered = ensureIdForEntity(entity, filtered);
            try { filtered = await stampBranchOnCreate(entity, req, filtered); }
            catch (error) { if (error.statusCode) {return res.status(error.statusCode).json({ error: error.message });} throw error; }
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
            // ROOT FIX 2026-10-02 + حديد 2026-10-06: الجداول تُبنى من أرصدة المواقع، والرصيد
            // الافتتاحي للصنف الجديد يُقيَّد في الدفتر (opening_balance) — الرصيد والدفتر يولدان
            // متطابقين بدل رصيد صامت بلا أي قيد
            if (entity === 'inventory') {
                let c2;
                try {
                    c2 = await pool.connect();
                    await c2.query('BEGIN');
                    const _mainLoc = (await c2.query(
                        `SELECT id FROM inventory_locations WHERE code='MAIN-WAREHOUSE' AND active = true LIMIT 1`)).rows[0];
                    if (_mainLoc) {
                        await c2.query(
                            `INSERT INTO inventory_location_balances (inventory_id, location_id, on_hand)
                             VALUES ($1, $2, 0) ON CONFLICT (inventory_id, location_id) DO NOTHING`,
                            [result.rows[0].id, _mainLoc.id]);
                        const _qty0 = Number(result.rows[0].qty) || 0;
                        if (_qty0 > 0) {
                            await postInventoryLedgerEntry(c2, {
                                transactionType: 'opening_balance', inventoryId: result.rows[0].id, locationId: _mainLoc.id,
                                quantityDelta: _qty0, unit: result.rows[0].unit || 'وحدة',
                                unitCost: Number(result.rows[0].avgCost) || 0,
                                referenceType: 'inventory_create', referenceId: String(result.rows[0].id),
                                idempotencyKey: `inventory-create-opening:${result.rows[0].id}`,
                                expiryDate: expiryGuardA.expiryDate || null,
                                reason: 'رصيد افتتاحي عند إنشاء الصنف', metadata: { created_via: 'generic_crud' },
                            });
                        }
                    }
                    await c2.query('COMMIT');
                } catch (e) { logger.warn('[inventory-balance-seed]', e.message); } finally { if (c2) {c2.release();} }
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
        app.post(`/api/${entity}`, jwtAuth, ...writeGuard, crudLimiter, guardCreate(entity), asyncHandler(async (req, res) => {
            // ─── SECURITY: Filter body against whitelist ──
            // نفس حرس الصلاحية في المعالج الآخر (البوابة ذات الأدوار المفتوحة).
            const expiryGuardB = checkInventoryOpeningExpiry(entity, req.body);
            if (expiryGuardB.error) {return res.status(422).json(expiryGuardB.error);}
            dropExpiryFields(req);
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
            try { filtered = await stampBranchOnCreate(entity, req, filtered); }
            catch (error) { if (error.statusCode) {return res.status(error.statusCode).json({ error: error.message });} throw error; }
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
            if (entity === 'dept_cashier_links') {
                try { filtered = await validateDeptCashierLink(filtered); }
                catch (error) { return res.status(error.statusCode || 422).json({ error: error.code || 'DEPT_CASHIER_LINK_INVALID', message: error.message }); }
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
            // FIX 2026-10-11 (C12): handler B was seeding balances WITHOUT a
            // ledger entry → on-hand vs ledger drift. Now posts opening_balance
            // entry matching handler A.
            if (entity === 'inventory') {
                let c3;
                try {
                    c3 = await pool.connect();
                    await c3.query('BEGIN');
                    const _mainLoc = (await c3.query(
                        `SELECT id FROM inventory_locations WHERE code='MAIN-WAREHOUSE' AND active = true LIMIT 1`)).rows[0];
                    if (_mainLoc) {
                        await c3.query(
                            `INSERT INTO inventory_location_balances (inventory_id, location_id, on_hand)
                             VALUES ($1, $2, GREATEST(0, $3::numeric)) ON CONFLICT (inventory_id, location_id) DO NOTHING`,
                            [result.rows[0].id, _mainLoc.id, Number(result.rows[0].qty) || 0]);
                        const _qtyB = Number(result.rows[0].qty) || 0;
                        if (_qtyB > 0) {
                            await postInventoryLedgerEntry(c3, {
                                transactionType: 'opening_balance', inventoryId: result.rows[0].id, locationId: _mainLoc.id,
                                quantityDelta: _qtyB, unit: result.rows[0].unit || 'وحدة',
                                unitCost: Number(result.rows[0].avgCost) || 0,
                                referenceType: 'inventory_create', referenceId: String(result.rows[0].id),
                                idempotencyKey: `inventory-create-opening:${result.rows[0].id}`,
                                expiryDate: expiryGuardB.expiryDate || null,
                                reason: 'رصيد افتتاحي عند إنشاء الصنف', metadata: { created_via: 'generic_crud_open_roles' },
                            });
                        }
                    }
                    await c3.query('COMMIT');
                } catch (e) { logger.warn('[inventory-balance-seed]', e.message); await c3?.query('ROLLBACK').catch(() => {}); } finally { if (c3) {c3.release();} }
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
            dropExpiryFields(req); // الصلاحية تُقيَّد في الدفتر عبر مسارات الاستلام، لا عبر التعديل العام
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
                // ─── حارس الهدف: غير-admin لا يستهدف حساب administrator ───
                if (req.user?.role !== 'admin') {
                    const targetUser = (await pool.query('SELECT role, username FROM users WHERE id=$1', [id])).rows[0];
                    if (targetUser && targetUser.role === 'admin') {
                        return res.status(403).json({ error: 'ADMIN_TARGET_FORBIDDEN', message: 'لا يمكن تعديل حساب المسؤول العام إلا من قبل المسؤول العام نفسه' });
                    }
                }
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
            let result;
            try {
                result = await pool.query(
                    `UPDATE "${entity}" SET ${setClause} WHERE id = $${keys.length + 1} RETURNING *`,
                    [...values, id]
                );
            } catch (updErr) {
                // 42703 = column does not exist. Happens when the code ships
                // before the migration that adds the column (staged rollout).
                // Retrying without the unknown column keeps the other fields
                // saved instead of failing the whole update.
                if (updErr && updErr.code === '42703') {
                    // message: column "x" of relation "settings" does not exist
                    const missing = /column "([^"]+)"[^;]*does not exist/i.exec(updErr.message || '');
                    const bad = missing ? missing[1] : null;
                    const kept = bad ? keys.filter((k) => k !== bad) : [];
                    if (kept.length && kept.length !== keys.length) {
                        logger.warn(`[crud] missing column in ${entity} (${bad}) - retried without it`);
                        const keptValues = kept.map((key) => prepareDbValue(entity, key, filtered[key]));
                        result = await pool.query(
                            `UPDATE "${entity}" SET ${kept.map((k, i) => `"${k}" = $${i + 1}`).join(', ')} WHERE id = $${kept.length + 1} RETURNING *`,
                            [...keptValues, id]
                        );
                    } else {
                        throw updErr;
                    }
                } else {
                    throw updErr;
                }
            }
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
            dropExpiryFields(req); // نفس القاعدة: لا تعديل عام لتاريخ الصلاحية — مسارات الاستلام هي الحكم
            
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
            // ─── FIX C3 (Enterprise 2026-10-03): inventory.qty/avgCost إسقاط معلن
            // يُعاد حسابه من inventory_location_balances بعد كل حركة (021:2-4) —
            // الكتابة المباشرة عبر CRUD كانت تكسر الإسقاط بصمت. الإنشاء بكيمة
            // افتتاحية مشروع ويبقى مسموحًا؛ التحديث يمر حصرًا عبر مسارات
            // الاستلام/الجرد/الصرف التي تكتب صف دفتر متسق.
            if (entity === 'inventory' && ('qty' in filtered || 'avgCost' in filtered)) {
                return res.status(422).json({
                    error: 'INVENTORY_PROJECTION_DIRECT_WRITE',
                    message: 'qty/avgCost تُدار عبر مسارات الاستلام والجرد والصرف فقط — التعديل المباشر يكسر تطابق الرصيد مع دفتر المخزون',
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
            if (entity === 'departments' && Object.prototype.hasOwnProperty.call(filtered, 'parent_code')) {
                try {
                    const target = (await pool.query('SELECT code FROM departments WHERE id = $1 LIMIT 1', [id])).rows[0];
                    if (!target) {return res.status(404).json({ error: 'NOT_FOUND', message: 'السجل المطلوب غير موجود' });}
                    filtered = { ...filtered, parent_code: await validateDeptParent(target.code, filtered.parent_code) };
                }
                catch (error) { return res.status(error.statusCode || 422).json({ error: error.code || 'DEPT_PARENT_INVALID', message: error.message }); }
            }
            if (entity === 'dept_cashier_links') {
                try {
                    const target = (await pool.query(
                        'SELECT dept_code, cashier_no, is_primary FROM dept_cashier_links WHERE id = $1 LIMIT 1', [id]
                    )).rows[0];
                    if (!target) {return res.status(404).json({ error: 'NOT_FOUND', message: 'السجل المطلوب غير موجود' });}
                    filtered = await validateDeptCashierLink({ ...target, ...filtered }, id);
                }
                catch (error) { return res.status(error.statusCode || 422).json({ error: error.code || 'DEPT_CASHIER_LINK_INVALID', message: error.message }); }
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
        // صاحب الإذن (kitchen/sous_chef/dept_head) أُضيف (طلب المالك 2026-10-04):
        // يحذف طلبه المعلّق فقط — الفرض الفعلي داخل المعالج أدناه (creatorUserId + الحالة).
        const deleteRoles = entity === 'dispatches' ? ['admin', 'manager', 'warehouse', 'kitchen', 'sous_chef', 'dept_head'] : ['admin', 'manager'];
        app.delete(`/api/${entity}/:id`, jwtAuth, requireRoleOrPerm(deleteRoles, permForEntity(entity, 'write')), crudLimiter, asyncHandler(async (req, res) => {
            const { id } = req.params;
            if (entity === 'users') {
                // ─── حارس الهدف: غير-admin لا يستهدف حساب administrator ───
                if (req.user?.role !== 'admin') {
                    const targetUser = (await pool.query('SELECT role FROM users WHERE id=$1', [id])).rows[0];
                    if (targetUser && targetUser.role === 'admin') {
                        return res.status(403).json({ error: 'ADMIN_TARGET_FORBIDDEN', message: 'لا يمكن حذف حساب المسؤول العام إلا من قبل المسؤول العام نفسه' });
                    }
                }
                // ─── حارس آخر-admin: لا يُحذف آخر مسؤول عام حتى من الأدمن نفسه ───
                const targetAdmin = (await pool.query('SELECT role FROM users WHERE id=$1', [id])).rows[0];
                if (targetAdmin && targetAdmin.role === 'admin') {
                    const adminCount = Number((await pool.query('SELECT count(*) FROM users WHERE role=$1', ['admin'])).rows[0].count);
                    if (adminCount <= 1) {
                        return res.status(403).json({ error: 'LAST_ADMIN_FORBIDDEN', message: 'لا يمكن حذف آخر مسؤول عام في النظام' });
                    }
                }
                await pool.query('UPDATE employees SET "userId"=NULL WHERE "userId"=$1', [id]);
            }
            const periodBlockDel = await payrollRowViolation(entity, id);
            if (periodBlockDel) {return res.status(423).json(periodBlockDel);}
            // تدقيق أمني جولة 2: إذن الصرف الموقّع (معتمد/مرفوض/مستلم) مستند مالي
            // لا يُمحى عبر CRUD العام — الاعتماد يرحّل مصروفات وحركات دفتر وأحداث
            // موقّعة بسلسلة hash؛ حذفه يقطع السلسلة. المعلّق فقط يجوز حذفه (إلغاء طلب خاطئ).
            // استثناء الأدمن (2026-10-01): admin يحذف أي حالة — بتوثيق إجباري.
            // صاحب الطلب (2026-10-04): يحذف طلبه المعلّق قبل وصوله للمخزن.
            if (entity === 'dispatches') {
                const dispatchRow = (await pool.query('SELECT status, "creatorUserId" FROM dispatches WHERE id = $1', [id])).rows[0];
                if (!dispatchRow) {return res.status(404).json({ error: 'NOT_FOUND', message: 'السجل المطلوب غير موجود' });}
                const isAdmin = req.user?.role === 'admin';
                const isCreator = dispatchRow.creatorUserId != null && Number(dispatchRow.creatorUserId) === Number(req.user?.id);
                const isWarehouseSide = ['manager', 'warehouse'].includes(req.user?.role);
                if (!isAdmin && !isWarehouseSide) {
                    // صاحب الطلب: معلّق فقط
                    const deleteGuard = canDeleteDispatch(dispatchRow);
                    if (!deleteGuard.ok || !isCreator) {
                        const deleteMessages = {
                            DISPATCH_ALREADY_APPROVED: 'لا يمكن حذف إذن صرف معتمد — مستند مالي موقّع مرحّل مصروفات وحركات مخزون',
                            DISPATCH_REJECTED: 'لا يمكن حذف إذن مرفوض — قرار الرفض موقّع وموثّق في سلسلة الأحداث',
                            DISPATCH_ALREADY_RECEIVED: 'لا يمكن حذف إذن تم استلامه — الاستلام موقّع ومرحّل للمخزون',
                            DISPATCH_CHEF_DECIDED: 'لا يمكن حذف إذن اعتمده الشيف العمومي — قرار موقّع في السلسلة (يمكن تعديله بدلًا من حذفه)',
                            DISPATCH_INVALID_STATUS: 'حالة إذن الصرف لا تسمح بحذفه',
                        };
                        const message = !deleteGuard.ok
                            ? (deleteMessages[deleteGuard.code] || 'حذف إذن الصرف غير مسموح في هذه الحالة — الأدمن فقط يستطيع الحذف النهائي (force)')
                            : 'الحذف لصاحب الطلب المعلّق فقط قبل اعتماد الشيف — بعد اعتماد الشيف تواصل مع الإدارة';
                        return res.status(deleteGuard.ok ? 403 : 409).json({ error: deleteGuard.ok ? 'NOT_CREATOR' : deleteGuard.code, message });
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
// FIX 2026-10-11 (C8): /uploads was fully public — any unauthenticated user
// could browse uploaded files. Now: image extensions (.png/.jpg/etc) stay
// public (menu images, low sensitivity), but ALL other file types require
// authentication. Signed-URLs remain a future option.
app.use('/uploads', (req, res, next) => {
    const ext = path.extname(req.path).toLowerCase();
    const PUBLIC_IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.ico'];
    if (PUBLIC_IMAGE_EXTS.includes(ext)) {return next();}
    // Non-image files require auth
    try {
        const auth = String(req.headers.authorization || '');
        if (auth.startsWith('Bearer ')) {
            const jwt = require('jsonwebtoken');
            jwt.verify(auth.slice(7), process.env.JWT_ACCESS_SECRET, (err) => {
                if (err) {return res.status(401).json({ error: 'UNAUTHORIZED' });}
                next();
            });
            return;
        }
        return res.status(401).json({ error: 'UNAUTHORIZED', message: 'يجب تسجيل الدخول للوصول لهذا الملف' });
    } catch (_) { return res.status(401).json({ error: 'UNAUTHORIZED' }); }
});
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
// ─── Service Worker محقون بالإصدار (2026-10-10): sw.js يُبنى ديناميكيًا من ?v= الحالي —
// أي رفع نسخة واجهة يغيّر بايتات sw.js تلقائيًا → كل المتصفحات تحدّث الكاش من أول زيارة.
// يقضي على ظاهرة «لسه على القديم» نهائيًا (السبب: SW كان يجمّد ?v= قديمة منذ 10-05).
function frontendVersion() {
    try {
        const html = fs.readFileSync(path.join(APP_DIR, 'index.html'), 'utf8');
        const m = html.match(/main\.js\?v=([\d.]+)/);
        return m ? m[1] : '0.0.0';
    } catch (_) { return '0.0.0'; }
}
app.get('/app/sw.js', (req, res) => {
    try {
        let js = fs.readFileSync(path.join(APP_DIR, 'sw.js'), 'utf8');
        const v = frontendVersion();
        js = js.replace(/const CACHE_VERSION = '[^']*';/, `const CACHE_VERSION = '${v}';`);
        js = js.replace(/\?v=[\d.]+/g, `?v=${v}`);
        res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store, must-revalidate');
        res.setHeader('Service-Worker-Allowed', '/app/');
        res.send(js);
    } catch (_) { res.status(500).send('// sw unavailable'); }
});
// The live menu preview is embedded only by this same-origin dashboard.
app.use('/app/menu-board.html', (req, res, next) => {
    const policy = res.getHeader('Content-Security-Policy');
    if (typeof policy !== 'string') {
        logger.error('[MENU_PREVIEW_CSP] Content-Security-Policy header missing');
        return next();
    }
    const sameOriginPolicy = policy.replace(/frame-ancestors\s+[^;]+/, "frame-ancestors 'self'");
    if (sameOriginPolicy === policy) {
        logger.error('[MENU_PREVIEW_CSP] frame-ancestors directive missing');
        return next();
    }
    res.setHeader('Content-Security-Policy', sameOriginPolicy);
    next();
});
/* Brotli للأصول الساكنة — Nginx في aaPanel مجرد reverse proxy لا يقرأ القرص،
   فالضغط مسؤولية Node. يغطي /app و/app/js/vendor معًا (نفس الجذر على القرص). */
const brotliLimits = resolveCacheLimits();
const appBrotliMetrics = createBrotliMetrics({
    // BROTLI_METRICS=off يوقف القياس بلا لمس أي منطق ضغط
    enabled: process.env.BROTLI_METRICS !== 'off',
    maxBytes: brotliLimits.maxBytes,
});
const appBrotli = createBrotliStatic({
    rootDir: APP_DIR,
    setCacheHeaders: setStaticCacheHeaders,
    metrics: appBrotliMetrics,
});
appBrotliMetrics.setCacheDir(appBrotli.cacheDir); // حجم الكاش يُقاس عند السحب
/* سياسة التنظيف: عمر ثم حجم — أول كنستة بعد التسخين ثم دوريًا (مؤقّت unref) */
const appBrotliCache = createCachePolicy({
    cacheDir: appBrotli.cacheDir,
    metrics: appBrotliMetrics,
    maxBytes: brotliLimits.maxBytes,
    maxAgeDays: brotliLimits.maxAgeDays,
});
appBrotliCache.start(); // كنستة أولى بعد التسخين ثم دورية — مؤقّت unref لا يُبقي العملية حيّة
/* إبطال المرحلة 3 — fs.watch في التطوير فقط: تغيّر أي ملف أصل يُحذف مقابله
   القديم فورًا. في الإنتاج لا يُنشأ مراقب، والإبطال عبر BROTLI_POLICY_VERSION
   أو POST /api/system/brotli-cache/invalidate (admin). */
appBrotli.watch();
app.use((req, res, next) => {
    if (req.path === '/app/v2.html') {
        res.setHeader('Content-Security-Policy', buildV2Csp());
    }
    next();
});
app.use('/app', appBrotli);
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

// ─── شاشة منيو المول (Digital Signage Menu Board) ───
// /api/menu-board/public (عام) + /api/menu-board/settings (admin/manager)
// المنيو نفسه يُقرأ من pos_products — تعديلات المطبخ تصل الشاشة لحظيًا
// عبر بث entity_changed (posProducts) الموجود في cashier-module.
try {
    require('./menu-board-routes').register(app, { io });
} catch (err) {
    logger.error('[menu-board] Failed to register (continuing without menu board):', err.message);
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
//   • Unrecoverable process errors → controlled exit for WinSW restart
// (Replaces inline steelFail.)
installProcessShields({
    exitOnFatal: true,
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
// FIX 2026-10-11 (M4): logger was passed in dependencies (ignored) — moved
// to options where graceful-shutdown.js actually reads it.
initGracefulShutdown({
    server: httpServer,
    io,
    pool,
}, {
    timeout: 30_000, // 30 seconds for graceful shutdown
    logger,
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

// ─── Resilient listen (FIX 2026-10-19) ─────────────────────────────────────
// مع إعادة تشغيل الخدمة، المنفذ قد يبقى في TIME_WAIT أو ممسوكًا لحظيًا فيموت
// الخادم الجديد بـEADDRINUSE (306 سقوطًا تاريخيًا في CRASH.log). الآن نعيد
// المحاولة بتدرّج حتى يتحرّر المنفذ ثم نُقلع مرة واحدة فقط، ولا نُسقط العملية
// إلا إذا فشلت كل المحاولات (عندها يتكفّل WinSW/SCM بإعادة التشغيل).
let _listenAttempt = 0;
const MAX_LISTEN_ATTEMPTS = 60; // ~ حتى 5 دقائق انتظار
httpServer.on('error', (err) => {
    if (err && err.code === 'EADDRINUSE' && _listenAttempt < MAX_LISTEN_ATTEMPTS) {
        _listenAttempt += 1;
        const waitMs = Math.min(1000 + _listenAttempt * 1000, 15000);
        logger.warn(
            { event: 'listen_retry', port: PORT, code: err.code, attempt: _listenAttempt, waitMs },
            `⏳ المنفذ ${PORT} ما زال مشغولًا — إعادة المحاولة ${_listenAttempt}/${MAX_LISTEN_ATTEMPTS} بعد ${waitMs}ms`
        );
        setTimeout(() => httpServer.listen(PORT, '0.0.0.0'), waitMs);
        return;
    }
    logger.fatal({ event: 'listen_failed', code: err?.code, message: err?.message },
        '💥 فشل ربط منفذ الـHTTP — إعادة تشغيل نظيفة مطلوبة');
    process.exit(1);
});
httpServer.on('listening', async () => {
    _listenAttempt = 0;
    await onServerListening();
});
httpServer.listen(PORT, '0.0.0.0');

async function onServerListening() {
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

    // ─── تسخين نسخ Brotli خلفيًا: لا ينتظر أي مستخدم أول ضغطة ───
    // WARMUP_ENABLED=false يوقفه بلا إعادة تشغيل (القياس يبقى يعمل)
    if (process.env.WARMUP_ENABLED !== 'false') { appBrotli.warmup(); }

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
            let activeOracleWorker = null;
            const runOracleWorker = () => {
                if (activeOracleWorker) {
                    logger.warn('[YARASOFT_ORACLE] تخطي دورة Oracle جديدة — الدورة السابقة ما زالت تعمل');
                    return;
                }
                try {
                    const worker = spawnWorker(process.execPath, [path.join(__dirname, '..', 'scripts', 'oracle-poll-worker.js')],
                        { stdio: 'ignore', cwd: path.join(__dirname, '..'), env: process.env });
                    activeOracleWorker = worker;
                    worker.once('error', (e) => {
                        if (activeOracleWorker === worker) {activeOracleWorker = null;}
                        logger.error('[YARASOFT_ORACLE] تعذر تشغيل عامل الدورة:', e.message);
                    });
                    worker.once('exit', (code, signal) => {
                        if (activeOracleWorker === worker) {activeOracleWorker = null;}
                        if (code !== 0) {
                            logger.error(`[YARASOFT_ORACLE] انتهت دورة العامل بخطأ (code=${code}, signal=${signal || 'none'})`);
                        }
                    });
                } catch (e) {
                    activeOracleWorker = null;
                    logger.error('[YARASOFT_ORACLE] تعذر تشغيل عامل الدورة:', e.message);
                }
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
}
