/**
 * supervisor-policy.js — Pure restart policy for the process supervisor.
 * ────────────────────────────────────────────────────────────────────────────
 * Extracted from scripts/watchdog.js so the decision is unit-testable.
 *
 * Big-company rule: a supervised service must come back after ANY exit,
 * unless the supervisor itself decided to stop. A "clean" exit (code 0)
 * that nobody asked for — a deploy script, a systemd restart, a stray
 * `kill <pid>`, Ctrl+C on the wrong terminal — must NOT leave a POS dead
 * while its guardian is still alive. The server reaches exit code 0 only
 * through its graceful-shutdown path (SIGTERM/SIGINT from outside), so an
 * unattended code-0 exit IS an unexpected shutdown from the supervisor's
 * point of view.
 */

/**
 * Decide whether the supervisor should restart an exited child.
 *
 * @param {object} input
 * @param {number|null} input.code                 Process exit code.
 * @param {string|null} input.signal               Terminating signal, if any.
 * @param {boolean} [input.stopping]               Supervisor is shutting down.
 * @param {boolean} [input.manualStopRequested]    Operator asked for a stop.
 * @returns {{restart: boolean, reason: string}}
 */
function shouldRestartChild({ code, signal, stopping = false, manualStopRequested = false } = {}) {
    // 1) The supervisor (or the operator through it) decided to stop — obey.
    if (stopping || manualStopRequested) {
        return { restart: false, reason: 'supervisor-initiated stop' };
    }
    // 2) Clean exit nobody requested = unexpected shutdown under supervision.
    //    The guardian's whole job is uptime — bring the service back.
    if (code === 0 && !signal) {
        return { restart: true, reason: 'unexpected clean exit under supervision' };
    }
    // 3) Crash (signal or non-zero code) — restart with backoff.
    return { restart: true, reason: signal ? `signal ${signal}` : `exit code ${code}` };
}

module.exports = { shouldRestartChild };
