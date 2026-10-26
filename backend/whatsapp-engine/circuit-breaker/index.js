/**
 * whatsapp-engine/circuit-breaker/index.js — Circuit Breaker for ERP calls
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Prevents WhatsApp engine from overwhelming the ERP server
 * when it's slow or down. Three states:
 *   CLOSED  → Normal: requests pass through
 *   OPEN    → ERP is down: requests fail fast, no wait
 *   HALF-OPEN → Testing if ERP recovered
 *
 * When a threshold of failures is reached within a time window,
 * the circuit "opens" and all ERP calls return immediately
 * with a graceful fallback message. After a timeout, it
 * transitions to HALF-OPEN to test recovery.
 */
'use strict';

const { logger } = require('../../logger');

const STATES = Object.freeze({ CLOSED: 'CLOSED', OPEN: 'OPEN', HALF_OPEN: 'HALF_OPEN' });

class CircuitBreaker {
    /**
     * @param {object} options
     * @param {number} options.failureThreshold - failures before opening (default 5)
     * @param {number} options.timeoutMs - time to wait before half-open (default 30000)
     * @param {number} options.windowMs - time window for counting failures (default 60000)
     * @param {string} options.name - label for logging
     */
    constructor(options = {}) {
        this.name = options.name || 'ERP';
        this.failureThreshold = options.failureThreshold || 5;
        this.timeoutMs = options.timeoutMs || 30000;
        this.windowMs = options.windowMs || 60000;
        this.maxTimeoutMs = options.maxTimeoutMs || 300000; // max 5 min backoff

        this.state = STATES.CLOSED;
        this.failureCount = 0;
        this.lastFailureTime = null;
        this.nextAttempt = null;
        this._successCount = 0;
        this._consecutiveOpens = 0; // for exponential backoff
    }

    /** Execute a function through the circuit breaker */
    async call(fn) {
        if (this.state === STATES.OPEN) {
            const waitMs = this.nextAttempt - Date.now();
            if (waitMs > 0) {
                throw new Error(`CIRCUIT_OPEN: ${this.name} is down. Retry in ${Math.ceil(waitMs / 1000)}s`);
            }
            // Transition to HALF_OPEN to test recovery
            this.state = STATES.HALF_OPEN;
            logger.info(`[CB:${this.name}] HALF_OPEN — testing recovery`);
        }

        try {
            const result = await fn();
            this._onSuccess();
            return result;
        } catch (err) {
            this._onFailure();
            throw err;
        }
    }

    _onSuccess() {
        this.failureCount = 0;
        this._successCount++;
        this._consecutiveOpens = 0; // reset backoff on recovery

        if (this.state === STATES.HALF_OPEN && this._successCount >= 2) {
            this.state = STATES.CLOSED;
            this._successCount = 0;
            logger.info(`[CB:${this.name}] CLOSED — recovered ✅`);
        }
    }

    _onFailure() {
        this.failureCount++;
        this.lastFailureTime = Date.now();

        if (this.failureCount >= this.failureThreshold) {
            this.state = STATES.OPEN;
            this._successCount = 0;
            this._consecutiveOpens++;

            // Exponential backoff: 30s → 60s → 120s → 240s → max
            const backoff = Math.min(
                this.timeoutMs * Math.pow(2, this._consecutiveOpens - 1),
                this.maxTimeoutMs
            );
            this.nextAttempt = Date.now() + backoff;

            logger.warn(`[CB:${this.name}] OPEN — ${this.failureCount} failures, backoff ${Math.ceil(backoff / 1000)}s (attempt #${this._consecutiveOpens})`);
        }
    }

    /** Current health status for monitoring */
    getStatus() {
        return {
            state: this.state,
            failureCount: this.failureCount,
            threshold: this.failureThreshold,
            lastFailureTime: this.lastFailureTime,
            nextAttempt: this.nextAttempt,
            waitMs: this.state === STATES.OPEN ? Math.max(0, this.nextAttempt - Date.now()) : 0,
        };
    }

    /** Force reset (for admin use) */
    reset() {
        this.state = STATES.CLOSED;
        this.failureCount = 0;
        this._successCount = 0;
        this.nextAttempt = null;
        logger.info(`[CB:${this.name}] Manually reset to CLOSED`);
    }
}

module.exports = { CircuitBreaker, STATES };