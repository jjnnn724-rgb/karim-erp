-- 071_ys_mirror_orders.sql — Cashier mirror: Yarasoft POS orders mirrored locally
-- ────────────────────────────────────────────────────────────────────────────
-- Read-only from Oracle (CC_BILLS3 + CC_BILL_ENTER3), upsert by DOC_NO.
-- Idempotent: re-poll updates corrections, never duplicates.
-- Known limit: Oracle deletions don't propagate (posted docs only).

CREATE TABLE IF NOT EXISTS ys_mirror_orders (
    doc_no TEXT PRIMARY KEY,
    cashier_no TEXT NOT NULL,
    doc_date DATE NOT NULL,
    doc_time TEXT,
    shift_no INT,
    net NUMERIC(14,2) NOT NULL DEFAULT 0,
    total NUMERIC(14,2) NOT NULL DEFAULT 0,
    discount NUMERIC(14,2) NOT NULL DEFAULT 0,
    vat NUMERIC(14,2) NOT NULL DEFAULT 0,
    payed NUMERIC(14,2) NOT NULL DEFAULT 0,
    saler_id TEXT,
    lines JSONB NOT NULL DEFAULT '[]',
    synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ys_mirror_cashier_date
    ON ys_mirror_orders (cashier_no, doc_date DESC);
CREATE INDEX IF NOT EXISTS idx_ys_mirror_date
    ON ys_mirror_orders (doc_date DESC);
