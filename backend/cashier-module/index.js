/**
 * index.js — Module entry point: registers all cashier-module routes
 * on an existing Express app.
 *
 * Usage in backend/server.js:
 *
 *   const cashierModule = require('./cashier-module');
 *   cashierModule.register(app, { io });
 */

const { jwtAuth, loginHandler, changePasswordHandler } = require('./jwt-middleware');
const { auditContextMiddleware } = require('./audit-middleware');
const { registerMetricsRoute } = require('./metrics');
const { register: registerSaleRoute } = require('./complete-sale');
const shiftRoutes = require('./shift-routes');
const buffetRoutes = require('./buffet-routes');
const ordersRoutes = require('./orders-routes');
const excelImportRoutes = require('./excel-import-routes');
const { logger } = require('../logger');
const { authLimiter, generalLimiter } = require('../rate-limiter');

function register(app, opts = {}) {
    // Inject io into req so handlers can emit real-time events
    app.use((req, res, next) => { req.io = opts.io || null; next(); });

    // Global audit context (correlation IDs, RLS GUC population helper)
    app.use(auditContextMiddleware);

    // Auth endpoint (login) — rate-limited to prevent brute force
    app.post('/api/auth/login', authLimiter, loginHandler);
    // First-login / administrator password rotation. jwtAuth permits this
    // endpoint even when the token is deliberately restricted to rotation only.
    app.post('/api/auth/change-password', authLimiter, jwtAuth, changePasswordHandler);
    // Security audit 2026-09-03: دورة حياة الجلسة الكاملة — تدوير رمز التحديث
    // (القديم يُستهلك ويُصدر بديل) وتسجيل خروج بإبطال رموز التجديد.
    const { refreshHandler, logoutHandler } = require('./jwt-middleware');
    app.post('/api/auth/refresh', authLimiter, refreshHandler);
    app.post('/api/auth/logout', generalLimiter, jwtAuth, logoutHandler);

    // استعادة كلمة المرور الذاتية: رمز لمرة واحدة يصدره المدير ويستخدمه الموظف
    // من شاشة الدخول (لمن نسي كلمة مروره ولا يستطيع الدخول أصلاً).
    const passwordRecoveryRoutes = require('./password-recovery-routes');
    app.use('/api/auth/forgot-password', passwordRecoveryRoutes.router);

    // المصادقة الثنائية (TOTP): تذكرة قصيرة بعد كلمة المرور ثم جلسة كاملة.
    const mfaRoutes = require('./mfa-routes');
    mfaRoutes.register(app);

    // Prometheus metrics
    registerMetricsRoute(app);

    // Sale endpoint (atomic, idempotent)
    registerSaleRoute(app);

    // POS routes (departments, products, shifts, dashboard)
    app.use('/api/pos', shiftRoutes);
    app.use('/api/pos/buffet', buffetRoutes.router);

    // Daily Z close (manager/admin) — isolated load, never breaks core POS.
    try {
        const dayCloseRoutes = require('./day-close-routes');
        app.use('/api/pos', dayCloseRoutes.router);
        dayCloseRoutes.ensureDayCloseSchema();
    } catch (e) {
        logger.error('[day-close] module failed to load — Z close disabled, POS still running:', e.message);
    }

    // Orders (relational — replaces app_state JSON blob for orders module)
    app.use('/api/orders', ordersRoutes);

    // Excel/CSV import for inventory
    app.use('/api/inventory/import', excelImportRoutes.router);

    // POS Order History + Reprint (Professional invoice management)
    const posOrdersHistoryRoutes = require('./pos-orders-history');
    app.use('/api/pos/orders', posOrdersHistoryRoutes);

    // ZATCA (Fatoora) integration hub — settings screen drives everything
    const zatcaSettingsRoutes = require('./zatca-settings-routes');
    zatcaSettingsRoutes.register(app);

    // Kitchen Order Tickets (KOT) — settings screen + printable ticket page
    const kotRoutes = require('./kot-routes');
    kotRoutes.ensureKotSchema().catch((e) => logger.error('[kot] schema bootstrap failed:', e.message));
    app.use('/api/pos/kot', kotRoutes.router);

    // Task 36 (التسليم): إدارة الطابعات + الاكتشاف + نظافة التوكنات الأوتوماتيكية
    const printerRoutes = require('./printer-routes');
    app.use('/api/pos/printers', printerRoutes.router);
    if (!app.locals.tokenCleanupStarted) {
        const { startTokenCleanup } = require('./token-cleanup');
        const { pool } = require('./db-pool');
        startTokenCleanup(pool);
        app.locals.tokenCleanupStarted = true;
    }

    logger.info('✓ Karim ERP cashier module registered:');
    logger.info('    POST /api/auth/login');
    logger.info('    POST /api/auth/change-password');
    logger.info('    POST /api/auth/forgot-password/request-code (admin/manager — رمز لمرة واحدة)');
    logger.info('    POST /api/auth/forgot-password/reset        (عام — استعادة ذاتية)');
    logger.info('    GET  /api/auth/mfa/status');
    logger.info('    POST /api/auth/mfa/setup              (تذكرة تسجيل أو جلسة — QR)');
    logger.info('    POST /api/auth/mfa/confirm');
    logger.info('    POST /api/auth/mfa/verify             (TOTP أو رمز استرداد ← جلسة)');
    logger.info('    POST /api/auth/mfa/disable');
    logger.info('    POST /api/auth/mfa/recovery-codes');
    logger.info('    POST /api/auth/mfa/admin-reset        (owner/admin)');
    logger.info('    POST /api/sales/complete      (Idempotency-Key + atomic)');
    logger.info('    POST /api/pos/shifts/open');
    logger.info('    POST /api/pos/shifts/:id/close');
    logger.info('    GET  /api/pos/day-close/status (manager/admin — readiness)');
    logger.info('    POST /api/pos/day-close (manager/admin — daily Z + variance journal)');
    logger.info('    GET  /api/pos/day-close/:zNumber (Z slip)');
    logger.info('    GET  /api/pos/shifts/active');
    logger.info('    GET  /api/pos/shifts/:id/summary');
    logger.info('    GET  /api/pos/departments');
    logger.info('    GET  /api/pos/products?department_id=');
    logger.info('    GET  /api/pos/dashboard');
    logger.info('    GET  /api/pos/buffet/config');
    logger.info('    PUT  /api/pos/buffet/config/prices');
    logger.info('    GET  /api/metrics');
    logger.info('    CRUD /api/orders              (relational, flexible invoice)');
    logger.info('    POST /api/inventory/import    (Excel/CSV bulk import)');
    logger.info('    GET  /api/inventory/import/template');
    logger.info('    GET  /api/pos/orders            (order history + search/filter)');
    logger.info('    GET  /api/pos/orders/stats/today (dashboard statistics)');
    logger.info('    GET  /api/pos/orders/:id         (invoice detail)');
    logger.info('    GET  /api/pos/orders/:id/receipt-html (browser printable receipt)');
    logger.info('    POST /api/pos/orders/:id/reprint (queue thermal reprint)');
    logger.info('    POST /api/pos/orders/:id/void    (void invoice)');
    logger.info('    /api/zatca/settings              (GET/PUT — ZATCA integration hub)');
    logger.info('    POST /api/zatca/toggle|test|csr|csid | GET /api/zatca/queue');
    logger.info('    GET/PUT /api/pos/kot/settings   (kitchen tickets on/off, copies, notes)');
    logger.info('    GET  /api/pos/kot/orders/:id/html (printable kitchen ticket page)');
    logger.info('    CRUD /api/pos/printers         (thermal printers + probe/scan discovery)');
    logger.info('    [bg] token-cleanup             (expired/revoked refresh tokens purge, 6h)');
}

module.exports = { register };
