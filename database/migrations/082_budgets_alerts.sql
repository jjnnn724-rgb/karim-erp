-- 082_budgets_alerts.sql — Budgets + alert dedup state (ADDITIVE ONLY)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS budgets (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    period CHAR(7) NOT NULL CHECK (period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
    account_code VARCHAR(20) REFERENCES chart_of_accounts(code) ON DELETE SET NULL,
    cost_center_code VARCHAR(20) REFERENCES cost_centers(code) ON DELETE SET NULL,
    label VARCHAR(150),
    amount NUMERIC(14,2) NOT NULL CHECK (amount >= 0),
    note VARCHAR(255),
    created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_budgets_period ON budgets(period);

-- Alert dedup: one row per rule key, resend at most every 24h.
CREATE TABLE IF NOT EXISTS alert_state (
    key VARCHAR(120) PRIMARY KEY,
    last_sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_title VARCHAR(255),
    times_sent INTEGER NOT NULL DEFAULT 1
);
