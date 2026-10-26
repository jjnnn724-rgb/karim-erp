/**
 * whatsapp-engine/supervisor.js — Steel watchdog policy (pure, unit tested)
 * ────────────────────────────────────────────────────────────────────────────
 * heal: stuck in a bad state for 10+ supervisor ticks (~10 min) and the last
 *       heal was over 10 minutes ago.
 * wait_qr: LOGGED_OUT — the QR pairing flow owns recovery (no forced restart).
 * ok: everything else.
 */
'use strict';

const BAD_STATES = new Set(['RECONNECTING', 'FAILED', 'DISCONNECTED']);

function supervisorDecision(state, sameTicks, sinceHealMs) {
    if (BAD_STATES.has(state) && sameTicks >= 10 && sinceHealMs > 10 * 60 * 1000) {return 'heal';}
    if (state === 'LOGGED_OUT') {return 'wait_qr';}
    return 'ok';
}

module.exports = { supervisorDecision, BAD_STATES };
