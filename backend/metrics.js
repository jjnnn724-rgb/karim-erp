/**
 * metrics.js — In-process observability collector (enterprise hardening)
 * ────────────────────────────────────────────────────────────────────────────
 * Zero-dependency, allocation-cheap metrics for a restaurant LAN server:
 *   • Request ring buffer → latency percentiles (p50/p90/p95/p99) per window
 *   • Counters: total / 2xx / 4xx / 5xx / slow, per route-group
 *   • Event-loop lag via perf_hooks.monitorEventLoopDelay (timer unref'd)
 *   • CPU & memory gauges on demand (snapshot time, not per request)
 *   • DB pool passthrough (total/idle/waiting) at snapshot time
 *
 * Design rules:
 *   - The per-request hot path does ONLY: Date.now() diff + ring push +
 *     counter++ → sub-microsecond, no I/O, no await, never throws.
 *   - Ring buffer is fixed-size (drops oldest) → memory bounded under any load.
 *   - Every exported function is defensive: metrics must NEVER take the
 *     server down. All middleware errors are swallowed by design.
 */
'use strict';

const { performance, monitorEventLoopDelay, PerformanceObserver } = require('perf_hooks');

const RING_MAX = (() => {
    // FIX 2026-10-11 (M8): validate env var — parseInt NaN → new Array(NaN) = RangeError boot crash
    const n = parseInt(process.env.METRICS_RING_MAX || '5000', 10);
    return Number.isFinite(n) && n > 0 && n <= 100000 ? n : 5000;
})();
const SLOW_MS = (() => {
    const n = parseFloat(process.env.SLOW_REQUEST_MS || '800');
    return Number.isFinite(n) && n > 0 ? n : 800;
})();

// ─── Route grouping (avoid cardinality explosion: no raw URLs) ─────────────
// FIX 2026-10-11 (M8): cap byGroup cardinality — arbitrary path segments
// (/api/x1, /api/<random>) each created a new group → unbounded map growth.
const MAX_GROUPS = 500;
function routeGroup(req) {
    const p = req.originalUrl || req.url || '';
    // Strip ids and query strings → /api/pos/orders/123/reprint → api.pos.orders
    const clean = p.split('?')[0]
        .replace(/\/\d+(?=\/|$)/g, '/:id')
        .replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '/:uuid');
    const parts = clean.split('/').filter(Boolean).slice(0, 4);
    return parts.length ? parts.join('.') : 'root';
}

// ─── Ring buffer of finished requests ───────────────────────────────────────
const ring = new Array(RING_MAX);
let ringHead = 0;
let ringLen = 0;

function pushRing(entry) {
    ring[ringHead] = entry;
    ringHead = (ringHead + 1) % RING_MAX;
    if (ringLen < RING_MAX) {ringLen++;}
}

// ─── Counters ────────────────────────────────────────────────────────────────
const counters = {
    total: 0, ok: 0, clientError: 0, serverError: 0, slow: 0,
    byGroup: Object.create(null),   // group → {total, err, sumMs, maxMs}
};
let startedAt = Date.now();

// ─── Event-loop lag monitor ──────────────────────────────────────────────────
let loopHist = null;
let loopObserver = null;
if (typeof monitorEventLoopDelay === 'function') {
    try {
        loopHist = monitorEventLoopDelay({ resolution: 20 });
        loopHist.enable();
        // keep reference so GC never collects an enabled observer pattern
        loopObserver = loopHist;
    } catch (_) { /* older node — degrade silently */ }
}

// ─── Middleware (registered once, early in the stack) ───────────────────────
function middleware() {
    return function metricsMiddleware(req, res, next) {
        try {
            const startMs = Date.now();
            res.on('finish', () => {
                try {
                    const dur = Date.now() - startMs;
                    const status = res.statusCode;
                    const group = routeGroup(req);
                    pushRing({ t: startMs, d: dur, s: status, g: group });
                    counters.total++;
                    if (status >= 500) {counters.serverError++;}
                    else if (status >= 400) {counters.clientError++;}
                    else {counters.ok++;}
                    if (dur >= SLOW_MS) {counters.slow++;}
                    let g = counters.byGroup[group];
                    if (!g) {
                        // FIX 2026-10-11 (M8): cap cardinality — don't create new
                        // groups beyond MAX_GROUPS (unbounded map growth under probing)
                        if (Object.keys(counters.byGroup).length >= MAX_GROUPS) {
                            g = counters.byGroup['__other__'] || (counters.byGroup['__other__'] = { total: 0, err: 0, sumMs: 0, maxMs: 0 });
                        } else {
                            g = counters.byGroup[group] = { total: 0, err: 0, sumMs: 0, maxMs: 0 };
                        }
                    }
                    g.total++;
                    if (status >= 400) {g.err++;}
                    g.sumMs += dur;
                    if (dur > g.maxMs) {g.maxMs = dur;}
                } catch (_) { /* metrics never break requests */ }
            });
        } catch (_) { /* even a poisoned res object must not break the chain */ }
        next();
    };
}

// ─── Percentiles from ring window ────────────────────────────────────────────
function percentiles(windowMs) {
    const cutoff = Date.now() - (windowMs || 5 * 60 * 1000);
    const durs = [];
    for (let i = 0; i < ringLen; i++) {
        const e = ring[i];
        if (e && e.t >= cutoff) {durs.push(e.d);}
    }
    if (!durs.length) {return null;}
    durs.sort((a, b) => a - b);
    const pick = (p) => durs[Math.min(durs.length - 1, Math.floor((p / 100) * durs.length))];
    return { count: durs.length, p50: pick(50), p90: pick(90), p95: pick(95), p99: pick(99), max: durs[durs.length - 1] };
}

// ─── Snapshot (called by /api/metrics) ───────────────────────────────────────
function snapshot(pool) {
    const mem = process.memoryUsage();
    const cpu = process.cpuUsage();
    const win1m = percentiles(60 * 1000);
    const win5m = percentiles(5 * 60 * 1000);
    let loop = null;
    if (loopHist) {
        const ns = (v) => Math.round(v / 1000); // ns → µs
        loop = {
            minUs: ns(loopHist.min), maxUs: ns(loopHist.max),
            meanUs: ns(loopHist.mean || 0), p99Us: ns(loopHist.percentile(99)),
            count: Number(loopHist.count),
        };
    }
    return {
        windowNote: `ring=${RING_MAX} entries, slowThreshold=${SLOW_MS}ms`,
        uptimeSec: Math.round((Date.now() - startedAt) / 1000),
        processStartedAt: new Date(startedAt).toISOString(),
        requests: {
            total: counters.total, ok: counters.ok,
            client4xx: counters.clientError, server5xx: counters.serverError,
            slow: counters.slow,
            latency: { last1m: win1m, last5m: win5m },
            byGroup: counters.byGroup,
        },
        eventLoopLagUs: loop,
        memory: {
            rssMB: +(mem.rss / 1048576).toFixed(1),
            heapUsedMB: +(mem.heapUsed / 1048576).toFixed(1),
            heapTotalMB: +(mem.heapTotal / 1048576).toFixed(1),
            externalMB: +(mem.external / 1048576).toFixed(1),
            rssLimitMB: process.config?.variables?.node_max_old_space_size || undefined,
        },
        cpu: { userSec: +(cpu.user / 1e6).toFixed(2), systemSec: +(cpu.system / 1e6).toFixed(2) },
        dbPool: pool ? {
            total: pool.totalCount, idle: pool.idleCount, waiting: pool.waitingCount,
            max: parseInt(process.env.DB_POOL_MAX || '60', 10),
        } : null,
    };
}

// ─── Reset (for tests) ───────────────────────────────────────────────────────
function reset() {
    ringHead = 0; ringLen = 0;
    for (let i = 0; i < RING_MAX; i++) {ring[i] = undefined;}
    counters.total = counters.ok = counters.clientError = counters.serverError = 0;
    counters.slow = 0;
    counters.byGroup = Object.create(null);
    startedAt = Date.now();
    if (loopHist) { try { loopHist.reset(); } catch (_) {} }
}

module.exports = {
    middleware, snapshot, percentiles, reset,
    routeGroup, pushRing, _ring: ring,
    SLOW_MS, RING_MAX,
    _loopObserver: () => loopObserver,
};
