const { logger } = require("../logger");
/**
 * db-pool.js — Tuned PostgreSQL connection pool for the cashier module.
 * ────────────────────────────────────────────────────────────────────────────
 * Uses shared-pool.js to avoid circular dependency with server.js.
 */
const { pool } = require('../shared-pool');

pool.on('error', (err) => {
    logger.error('[pos db-pool] Unexpected idle client error:', err.message);
});

// Healthy pool monitoring
setInterval(() => {
    const { totalCount, idleCount, waitingCount } = pool;
    if (waitingCount > 0) {
        logger.warn(`[pos db-pool] ⚠ ${waitingCount} requests waiting (total=${totalCount}, idle=${idleCount})`);
    }
}, 60_000).unref();

/**
 * Run a fn within a transaction, auto-setting RLS GUCs.
 */
async function withTransaction(fn, ctx = {}) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN;');
        await client.query(`SET LOCAL TIME ZONE 'UTC';`);
        if (ctx.userId)    {await client.query(`SELECT set_config('app.user_id', $1, true);`, [String(ctx.userId)]);}
        if (ctx.userRole)  {await client.query(`SELECT set_config('app.user_role', $1, true);`, [ctx.userRole]);}
        if (ctx.userName)  {await client.query(`SELECT set_config('app.user_name', $1, true);`, [ctx.userName]);}
        if (ctx.clientIp)  {await client.query(`SELECT set_config('app.client_ip', $1, true);`, [ctx.clientIp]);}
        if (ctx.requestId) {await client.query(`SELECT set_config('app.request_id', $1, true);`, [ctx.requestId]);}

        const result = await fn(client);
        await client.query('COMMIT;');
        return result;
    } catch (err) {
        try { await client.query('ROLLBACK;'); } catch (_) {}
        throw err;
    } finally {
        client.release();
    }
}

module.exports = { pool, withTransaction };
