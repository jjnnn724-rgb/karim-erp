-- 079_accounting_controls.sql — Period lock + draft/approve workflow (ADDITIVE)
-- ─────────────────────────────────────────────────────────────────────────────
-- Idempotent. No data touched. Existing posted/void entries keep working.
--   1) journal_entries.status: posted/void → draft/posted/void
--   2) journal_entries: approved_by / approved_at (nullable → no backfill)
--   3) accounting_periods: one row per YYYY-MM, closed flag (period lock)
-- ─────────────────────────────────────────────────────────────────────────────

-- 1) widen status (drop PG-default check name if present, recreate wider)
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'journal_entries_status_check') THEN
        ALTER TABLE journal_entries DROP CONSTRAINT journal_entries_status_check;
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'journal_entries_status_check') THEN
        ALTER TABLE journal_entries ADD CONSTRAINT journal_entries_status_check
            CHECK (status IN ('draft', 'posted', 'void'));
    END IF;
END $$;

-- 2) approval trail (nullable)
ALTER TABLE journal_entries ADD COLUMN IF NOT EXISTS approved_by BIGINT REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE journal_entries ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_journal_status ON journal_entries(status, date);

-- 3) period lock table
CREATE TABLE IF NOT EXISTS accounting_periods (
    period CHAR(7) PRIMARY KEY CHECK (period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
    closed BOOLEAN NOT NULL DEFAULT FALSE,
    closed_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
    closed_at TIMESTAMPTZ,
    note VARCHAR(255),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
