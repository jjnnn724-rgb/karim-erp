/**
 * circuit.js — Resilient External Dependency Calls
 * ────────────────────────────────────────────────────────────────────────────
 * Lightweight, zero-dep Circuit Breaker + Retry pattern.
 *
 * State machine (per resource key like "zatca" or "zkteco-device-1"):
 *
 *   CLOSED ──(failures > threshold)──► OPEN
 *     ▲                                  │
 *     │                                  │ after cooldown
 *     │                                  ▼
 *     └───── (success on probe) ──── HALF_OPEN
 *
 * Used alongside `withRetry()` which adds exponential backoff + jitter.
 *
 *   // Protect a function
 *   const protectedSend = circuit.protect('zatca', sendFn, { threshold: 5 });
 *   const result = await withRetry(() => protectedSend(payload), { max: 3 });
 */

'use strict';

const { logger } = require('../logger');
const { ExternalApiError } = require('../errors/app-error');

const DEFAULT_CIRCUIT = {
    threshold:       5,        // consecutive failures before opening
    cooldownMs:      30_000,   // how long to stay OPEN before probing
    halfOpenMax:     1,        // number of probe calls allowed in HALF_OPEN
    windowMs:        60_000,   // window to count consecutive errors
};

const DEFAULT_RETRY = {
    max:                3,
    baseDelayMs:        300,
    maxDelayMs:         10_000,
    jitter:             true,
    retryableStatuses:  [408, 429, 500, 502, 503, 504],
    isRetryable:        (err) => true, // by default, let caller control
};

// ─── Per-key circuit store ──────────────────────────────────
const circuits = new Map();

function getOrCreate(key, opts = {}) {
    let c = circuits.get(key);
    if (c) {return c;}
    c = {
        key,
        state: 'CLOSED',      // CLOSED | OPEN | HALF_OPEN
        failures: 0,
        successes: 0,
        openedAt: 0,
        halfOpenInflight: 0,
        opts: { ...DEFAULT_CIRCUIT, ...opts },
    };
    circuits.set(key, c);
    return c;
}

function transition(c, newState) {
    if (c.state === newState) {return;}
    logger.warn({
        event: 'circuit.state',
        key: c.key,
        from: c.state,
        to: newState,
        failures: c.failures,
    }, `[Circuit ${c.key}] ${c.state} → ${newState}`);
    c.state = newState;
    if (newState === 'OPEN')   {c.openedAt = Date.now();}
    if (newState === 'CLOSED') { c.failures = 0; c.successes = 0; }
    if (newState === 'HALF_OPEN') {c.halfOpenInflight = 0;}
}

/**
 * Wrap a function with circuit-breaker protection.
 * @param {string}   key            Logical resource name (e.g. "zatca")
 * @param {Function} fn             Async (payload) => result
 * @param {object}   [opts]
 * @param {boolean}  [opts.retryable=true] If this failure should count toward threshold
 */
function protect(key, fn, opts = {}) {
    const c = getOrCreate(key, opts);
    const providerName = opts.providerName || key;

    return async function protectedFn(...args) {
        // ── Fast path: circuit OPEN → short-circuit ─
        if (c.state === 'OPEN') {
            const waited = Date.now() - c.openedAt;
            if (waited >= c.opts.cooldownMs) {
                transition(c, 'HALF_OPEN');
            } else {
                const remain = Math.ceil((c.opts.cooldownMs - waited) / 1000);
                const err = new ExternalApiError(
                    providerName,
                    new Error(`Circuit OPEN — ${remain}s remaining (${c.failures} consecutive failures)`),
                    { circuitState: 'OPEN', failures: c.failures, remainingSeconds: remain },
                    true
                );
                err.circuitShortCircuited = true;
                throw err;
            }
        }

        // ── HALF_OPEN gating ────────────────────────
        if (c.state === 'HALF_OPEN' && c.halfOpenInflight >= c.opts.halfOpenMax) {
            throw new ExternalApiError(
                providerName,
                new Error('Circuit HALF_OPEN — probe slot full, retry shortly'),
                { circuitState: 'HALF_OPEN' },
                true
            );
        }
        if (c.state === 'HALF_OPEN') {c.halfOpenInflight++;}

        // ── Call ────────────────────────────────────
        try {
            const result = await fn(...args);
            // Success → heal
            if (c.state === 'HALF_OPEN') {c.successes++;}
            c.failures = Math.max(0, c.failures - 1);
            if (c.failures === 0 || c.state === 'HALF_OPEN') {
                if (c.state === 'HALF_OPEN' && c.successes >= c.opts.halfOpenMax) {
                    transition(c, 'CLOSED');
                } else if (c.state === 'CLOSED') {
                    // stay
                }
            }
            return result;
        } catch (raw) {
            const retryable = opts.retryable !== false &&
                !(raw?.circuitShortCircuited);
            if (retryable) {
                c.failures++;
                logger.debug({ event: 'circuit.fail', key: c.key, failures: c.failures, message: raw?.message });
                if (c.state === 'HALF_OPEN') {
                    // Probe failed → back to OPEN
                    transition(c, 'OPEN');
                } else if (c.failures >= c.opts.threshold) {
                    transition(c, 'OPEN');
                }
            }
            if (raw instanceof ExternalApiError) {throw raw;}
            throw new ExternalApiError(providerName, raw, { circuitState: c.state, failures: c.failures }, retryable);
        } finally {
            if (c.state === 'HALF_OPEN' && c.halfOpenInflight > 0) {
                c.halfOpenInflight = Math.max(0, c.halfOpenInflight - 1);
            }
        }
    };
}

/**
 * Wrap an async function with exponential backoff + jitter retry.
 *
 * Usage:
 *   const data = await withRetry(async () => fetchJSON(url), { max: 3 });
 */
async function withRetry(fn, opts = {}) {
    const cfg = { ...DEFAULT_RETRY, ...opts };
    let lastErr;
    for (let attempt = 0; attempt <= cfg.max; attempt++) {
        try {
            return await fn(attempt);
        } catch (err) {
            lastErr = err;
            if (attempt === cfg.max) {break;}

            // Decide: retryable?
            const status = err?.statusCode || err?.response?.status;
            const retryableByCode = !status || cfg.retryableStatuses.includes(status);
            const retryableByFn   = typeof cfg.isRetryable === 'function' ? cfg.isRetryable(err, attempt) : true;
            const circuitShort    = !!err?.circuitShortCircuited;
            if (!retryableByCode || !retryableByFn || circuitShort) {break;}

            // Exponential backoff with decorrelated jitter
            let delay = cfg.baseDelayMs * Math.pow(2, attempt);
            if (cfg.jitter) {delay = delay / 2 + (delay / 2) * Math.random();}
            delay = Math.min(delay, cfg.maxDelayMs);

            logger.debug({
                event: 'retry',
                attempt: attempt + 1,
                max: cfg.max,
                delayMs: Math.round(delay),
                message: err?.message,
            }, `Retry attempt ${attempt + 1}/${cfg.max} in ${Math.round(delay)}ms`);

            await new Promise(r => setTimeout(r, delay));
        }
    }
    throw lastErr;
}

/**
 * Return diagnostic snapshot of all registered circuits (for /health/verbose).
 */
function getCircuitSnapshot() {
    return [...circuits.entries()].map(([key, c]) => ({
        key,
        state:       c.state,
        failures:    c.failures,
        successes:   c.successes,
        openedSecsAgo: c.state !== 'CLOSED' && c.openedAt > 0 ? Math.round((Date.now() - c.openedAt) / 1000) : null,
        threshold:   c.opts.threshold,
        cooldownMs:  c.opts.cooldownMs,
    }));
}

/**
 * Register the circuit breaker snapshot as a readiness check
 * that the health endpoint will pick up.
 */
function registerWithHealthChecks() {
    try {
        const health = require('./health');
        health.registerCheck(() => {
            const snap = getCircuitSnapshot();
            const openCount = snap.filter(s => s.state === 'OPEN').length;
            return {
                component: 'circuits',
                status:    openCount === 0 ? 'ok' : (openCount > 2 ? 'fail' : 'warn'),
                details:   { openCount, total: snap.length, circuits: snap },
            };
        });
    } catch { /* optional */ }
}

module.exports = {
    protect,
    withRetry,
    getCircuitSnapshot,
    registerWithHealthChecks,
    _reset: () => circuits.clear(),
};
