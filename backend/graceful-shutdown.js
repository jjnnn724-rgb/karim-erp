const { logger } = require("./logger");
/**
 * graceful-shutdown.js — Graceful Shutdown Handler for Express/Socket.io
 * ────────────────────────────────────────────────────────────────────────────
 * Provides clean shutdown handling for:
 * - HTTP server (stop accepting new connections)
 * - Socket.io (disconnect all clients gracefully)
 * - Database pool (drain all connections)
 * - Redis/BullMQ (if configured)
 * 
 * Usage:
 *   const { initGracefulShutdown } = require('./graceful-shutdown');
 *   initGracefulShutdown({ server, io, pool, redisClient, bullMQ });
 */

// ─── Configuration ───────────────────────────────────────
const SHUTDOWN_TIMEOUT_MS = 30_000; // 30 seconds max for graceful shutdown
const HEALTH_CHECK_INTERVAL = 30_000; // Health check during shutdown

let _isShuttingDown = false;  // Internal state variable
let shutdownStartTime = null;

/**
 * Initialize graceful shutdown handlers.
 * 
 * @param {Object} dependencies - Required dependencies
 * @param {Object} dependencies.server - HTTP server instance
 * @param {Object} [dependencies.io] - Socket.io server instance
 * @param {Object} [dependencies.pool] - PostgreSQL pool instance
 * @param {Object} [dependencies.redisClient] - Redis client (ioredis)
 * @param {Object} [dependencies.bullMQ] - BullMQ queue instance
 * @param {Object} [options] - Additional options
 * @param {number} [options.timeout] - Shutdown timeout in ms (default: 30000)
 * @param {Function} [options.onShutdown] - Callback before shutdown starts
 * @param {Function} [options.onCleanup] - Callback after cleanup completes
 */
function initGracefulShutdown(dependencies = {}, options = {}) {
    const {
        server,
        io,
        pool,
        redisClient,
        bullMQ,
    } = dependencies;

    const {
        timeout = SHUTDOWN_TIMEOUT_MS,
        onShutdown = null,
        onCleanup = null,
        logger = console,
    } = options;

    if (!server) {
        throw new Error('HTTP server instance is required for graceful shutdown');
    }

    // ─── Handle Shutdown Signals ─────────────────────────
    const signals = ['SIGTERM', 'SIGINT', 'SIGHUP'];
    
    signals.forEach(signal => {
        process.on(signal, async () => {
            if (_isShuttingDown) {
                logger.warn(`[shutdown] Already shutting down, forcing exit...`);
                setTimeout(() => process.exit(1), 5000);
                return;
            }
            
            await gracefulShutdown({ signal, server, io, pool, redisClient, bullMQ }, { timeout, onShutdown, onCleanup, logger });
        });
    });

    // ─── Handle Uncaught Exceptions ───────────────────────
    // CRITICAL: Under load, a single bad request must NEVER kill the server.
    // The old handler called gracefulShutdown → process.exit(1), which meant
    // one uncaught exception from any route took down ALL clients (HTTP 0
    // on every subsequent request). Now we log loudly and keep serving.
    // Only SIGTERM/SIGINT (operator intent) trigger a real shutdown.
    process.on('uncaughtException', (error) => {
        try { logger.error('[shutdown] Uncaught exception (suppressed — server stays up):', error); } catch (_) {}
    });

    // ─── Handle Unhandled Promise Rejections ─────────────
    process.on('unhandledRejection', (reason, promise) => {
        try { logger.error('[shutdown] Unhandled rejection at:', promise, 'reason:', reason); } catch (_) {}
    });

    logger.info('[shutdown] Graceful shutdown handlers registered');
    return { isShuttingDown: () => _isShuttingDown };
}

/**
 * Perform the actual graceful shutdown sequence.
 */
async function gracefulShutdown(context = {}, options = {}) {
    const { signal, server, io, pool, redisClient, bullMQ } = context;
    const { timeout, onShutdown, onCleanup, logger } = options;
    
    _isShuttingDown = true;
    shutdownStartTime = Date.now();
    
    logger.info(`[shutdown] 🛑 Received ${signal}. Starting graceful shutdown...`);
    logger.info(`[shutdown] ⏱️  Timeout: ${timeout}ms`);
    
    // Call pre-shutdown callback
    if (typeof onShutdown === 'function') {
        try {
            await onShutdown(signal);
        } catch (err) {
            logger.error('[shutdown] onShutdown callback error:', err.message);
        }
    }
    
    // Set up force-exit timer
    const forceExitTimer = setTimeout(() => {
        logger.error('[shutdown] ⏰ Force exiting after timeout!');
        process.exit(1);
    }, timeout);

    // ─── Step 1: Stop accepting new HTTP connections ─────
    logger.info('[shutdown] Step 1/5: Stopping new HTTP connections...');
    try {
        server.close(() => {
            logger.info('[shutdown] ✅ HTTP server closed');
        });
    } catch (err) {
        logger.error('[shutdown] Error closing HTTP server:', err.message);
    }

    // ─── Step 2: Disconnect Socket.io clients ────────────
    if (io) {
        logger.info(`[shutdown] Step 2/5: Disconnecting ${io.sockets.sockets.size} Socket.io clients...`);
        try {
            // Notify all clients that server is shutting down
            io.emit('server_shutdown', {
                message: 'Server is restarting. Please wait...',
                reconnect: true,
                estimatedDowntime: 10, // seconds
            });
            
            // Give clients time to receive the message
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            // Disconnect all clients
            io.sockets.sockets.forEach(socket => {
                socket.disconnect(true);
            });
            
            // Close Socket.io server
            io.close(() => {
                logger.info('[shutdown] ✅ Socket.io closed');
            });
        } catch (err) {
            logger.error('[shutdown] Error closing Socket.io:', err.message);
        }
    } else {
        logger.info('[shutdown] Step 2/5: No Socket.io instance, skipping');
    }

    // ─── Step 3: Drain database pool ─────────────────────
    if (pool) {
        logger.info(`[shutdown] Step 3/5: Draining database pool (${pool.totalCount} connections)...`);
        try {
            await pool.end();
            logger.info('[shutdown] ✅ Database pool drained');
        } catch (err) {
            logger.error('[shutdown] Error draining pool:', err.message);
        }
    } else {
        logger.info('[shutdown] Step 3/5: No database pool, skipping');
    }

    // ─── Step 4: Close Redis connection ──────────────────
    if (redisClient) {
        logger.info('[shutdown] Step 4/5: Closing Redis connection...');
        try {
            await redisClient.quit();
            logger.info('[shutdown] ✅ Redis connection closed');
        } catch (err) {
            logger.error('[shutdown] Error closing Redis:', err.message);
        }
    } else {
        logger.info('[shutdown] Step 4/5: No Redis client, skipping');
    }

    // ─── Step 5: Close BullMQ queues ─────────────────────
    if (bullMQ) {
        logger.info('[shutdown] Step 5/5: Closing BullMQ queues...');
        try {
            await bullMQ.close();
            logger.info('[shutdown] ✅ BullMQ queues closed');
        } catch (err) {
            logger.error('[shutdown] Error closing BullMQ:', err.message);
        }
    } else {
        logger.info('[shutdown] Step 5/5: No BullMQ instance, skipping');
    }

    // Clear force-exit timer
    clearTimeout(forceExitTimer);

    const shutdownDuration = Date.now() - shutdownStartTime;
    logger.info(`[shutdown] ✅ Graceful shutdown completed in ${shutdownDuration}ms`);

    // Call post-cleanup callback
    if (typeof onCleanup === 'function') {
        try {
            await onCleanup(shutdownDuration);
        } catch (err) {
            logger.error('[shutdown] onCleanup callback error:', err.message);
        }
    }

    // Exit cleanly
    process.exit(0);
}

/**
 * Check if the server is currently shutting down.
 */
function isShuttingDown() {
    return _isShuttingDown;
}

/**
 * Get shutdown status information.
 */
function getShutdownStatus() {
    return {
        isShuttingDown: _isShuttingDown,
        startedAt: shutdownStartTime ? new Date(shutdownStartTime).toISOString() : null,
        duration: shutdownStartTime ? Date.now() - shutdownStartTime : null,
    };
}

/**
 * Middleware to reject requests during shutdown.
 * Returns 503 Service Unavailable with Retry-After header.
 */
function rejectDuringShutdown(req, res, next) {
    if (isShuttingDown()) {  // Call the function to check status
        res.set('Retry-After', '10');
        return res.status(503).json({
            error: 'SERVICE_UNAVAILABLE',
            message: 'Server is shutting down. Please try again shortly.',
            retryAfter: 10,
        });
    }
    next();
}

module.exports = {
    initGracefulShutdown,
    gracefulShutdown,
    isShuttingDown,
    getShutdownStatus,
    rejectDuringShutdown,
    SHUTDOWN_TIMEOUT_MS,
};
