/**
 * zatca-reclaim.js — Crash recovery for stranded ZATCA queue rows.
 * ────────────────────────────────────────────────────────────────────────────
 * A worker that crashed between claiming a row ('processing') and finishing
 * leaves that row stranded forever: no live worker owns it, and no timer
 * will ever fire for it. Recovery marks such rows back to 'failed' so the
 * normal claim loop (or an operator, via the UI retry button) can resubmit.
 *
 * Recovery is intentionally INDEPENDENT of the ZATCA master switch:
 * if a worker crashed mid-send and the operator then disabled ZATCA, the
 * stranded rows would otherwise stay 'processing' forever (the freeze gate
 * used to sit before the reclaim). Recovery is bookkeeping, not sending.
 *
 * Pure module (no imports) so it is trivially unit-testable.
 */

const STALE_AFTER = '15 minutes';

/**
 * Reclaim rows stranded in 'processing' longer than STALE_AFTER.
 *
 * @param {{query: (sql: string) => Promise<{rowCount: number|null}>}} client
 *                         pg client (from pool.connect()) or any object with
 *                         `.query(sql)` — injected for testability.
 * @returns {Promise<number>} number of reclaimed rows.
 */
async function reclaimStaleProcessing(client) {
  const res = await client.query(
    `UPDATE pos_zatca_invoice_queue
            SET status = 'failed',
                last_error = COALESCE(last_error, 'Reclaimed stale processing job')
          WHERE status = 'processing'
            AND last_attempt_at <= CURRENT_TIMESTAMP - INTERVAL '${STALE_AFTER}';`
  );
  return res.rowCount || 0;
}

module.exports = { reclaimStaleProcessing, STALE_AFTER };
