-- 080_pos_day_close.sql — Daily Z close for cashiers (ADDITIVE ONLY)
-- ─────────────────────────────────────────────────────────────────────────────
-- Idempotent. No existing object touched.
--   pos_day_closes — one approved Z per business date (Riyadh), sequential
--   z_number, session/variance totals snapshot, manager approval trail.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS pos_day_closes (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    close_date DATE NOT NULL UNIQUE,
    z_number VARCHAR(24) NOT NULL UNIQUE,
    status VARCHAR(20) NOT NULL DEFAULT 'approved' CHECK (status IN ('approved')),
    session_ids BIGINT[] NOT NULL DEFAULT '{}',
    total_expected NUMERIC(14,2) NOT NULL DEFAULT 0,
    total_actual NUMERIC(14,2) NOT NULL DEFAULT 0,
    total_variance NUMERIC(14,2) NOT NULL DEFAULT 0,
    totals JSONB NOT NULL DEFAULT '{}'::jsonb,
    journal_source_id VARCHAR(120),
    created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
    approved_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
    closed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    note TEXT
);
CREATE INDEX IF NOT EXISTS idx_day_closes_date ON pos_day_closes(close_date DESC);
