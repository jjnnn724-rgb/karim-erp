-- ═══════════════════════════════════════════════════════════════════
-- Migration 100 — PERF-5: composite indexes for pos_orders hot paths
-- ─────────────────────────────────────────────────────────────────────
-- GET /api/pos/orders filters by department / status / cashier and
-- sorts by created_at DESC. The existing single-column indexes can't
-- satisfy that plan, and idx_pos_orders_session_dept_created is unusable
-- for department-only queries because session_id leads it.
-- Each index below matches one real WHERE + ORDER BY combination.
-- ═══════════════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS idx_pos_orders_dept_created
    ON pos_orders (department_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_pos_orders_status_created
    ON pos_orders (status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_pos_orders_cashier_created
    ON pos_orders (cashier_id, created_at DESC);
