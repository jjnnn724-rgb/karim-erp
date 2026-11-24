'use strict';
/**
 * health-probe-routes — مسارات الصحة/isolation وهوية الخادم وقناة التحديث.
 * مُستخلصة من server.js (الأسطر 962–1055) حرفيًا بلا تغيير سلوك أو ترتيب.
 * تُستدعى من نفس الموضع قبل idempotency middleware عشان الـLB probes تفضل
 * متاحة حتى لو مفتاح API مفقود أو الخادم في حالة إغلاق.
 */
const express = require('express');
const path = require('path');
const { createHealthRouter, registerCheck } = require('./middleware/health');
const { registerWithHealthChecks: circuitRegisterHealth } = require('./middleware/circuit');
const { getShutdownStatus } = require('./graceful-shutdown');

/**
 * @param {any} app
 * @param {{pool:any, io:any, httpServer:any, connectedClients:Map<string,any>, lanScheme:string}} opts
 */
function register(app, opts) {
    const { pool, io, httpServer, connectedClients, lanScheme } = opts;

    const healthRouter = createHealthRouter({
        pool,
        redis: null,
        dataDir: path.resolve(__dirname, '..', 'database', 'data'),
    });

    registerCheck(() => ({
        component: 'realtime',
        status: 'ok',
        details: {
            connectedClients: connectedClients.size,
            clients: Array.from(connectedClients.values()).map((c) => ({
                deviceName: c.deviceName,
                ip: c.ip,
                joinedAt: c.joinedAt,
            })),
        },
    }));

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
            } catch (_) { return { component: 'outbox', status: 'warn', details: { reason: 'table_unchecked' } }; }
            const lastCycleMs = st.lastCycleAt ? Date.now() - new Date(st.lastCycleAt).getTime() : null;
            const details = { ...st, lagSec };
            if (st.cycles > 0 && lastCycleMs != null && lastCycleMs > 30000) {
                return { component: 'outbox', status: 'fail', details };
            }
            if (lagSec > 60 || (st.deadLettered || 0) > 0) {
                return { component: 'outbox', status: lagSec > 60 ? 'fail' : 'warn', details };
            }
            return { component: 'outbox', status: 'ok', details };
        } catch (/** @type {any} */ e) {
            return { component: 'outbox', status: 'warn', error: e.message };
        }
    });

    registerCheck(() => {
        try {
            const listening = Boolean(httpServer?.listening);
            const clients = io?.engine ? Number(io.engine.clientsCount || 0) : 0;
            return { component: 'websocket', status: listening ? 'ok' : 'fail', details: { listening, clients } };
        } catch (/** @type {any} */ e) {
            return { component: 'websocket', status: 'fail', error: e.message };
        }
    });

    registerCheck(() => {
        const s = getShutdownStatus();
        return {
            component: 'shutdown',
            status: /** @type {any} */ (s)?.shuttingDown ? 'warn' : 'ok',
            details: s,
        };
    });

    circuitRegisterHealth();
    app.use('/api/health', healthRouter);
    app.use('/health', healthRouter);

    const SERVER_PKG_VERSION = (() => { try { return require('../package.json').version || ''; } catch (_) { return ''; } })();
    const UPDATES_DIR = process.env.KARIM_UPDATES_DIR
        || (/** @type {any} */ (process).resourcesPath ? path.join(/** @type {any} */ (process).resourcesPath, 'updates')
            : path.join(__dirname, '..', 'updates'));
    try { require('fs').mkdirSync(UPDATES_DIR, { recursive: true }); } catch (_) {}
    app.use('/updates', express.static(UPDATES_DIR, { index: false, dotfiles: 'deny', fallthrough: true }));
    app.get('/api/server/info', (/** @type {any} */ req, /** @type {any} */ res) => {
        res.json({
            ok: true,
            app: 'karim-erp',
            version: SERVER_PKG_VERSION,
            serverName: process.env.KARIM_SERVER_NAME || require('os').hostname(),
            scheme: lanScheme,
            serverTime: new Date().toISOString(),
            uptimeSeconds: Math.round(process.uptime()),
        });
    });
}

module.exports = { register };
