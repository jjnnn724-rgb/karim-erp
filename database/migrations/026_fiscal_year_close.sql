-- Karim ERP v3.1.0 — Fiscal years and safe year-end closing
BEGIN;

CREATE TABLE IF NOT EXISTS fiscal_years (
    id BIGINT PRIMARY KEY,
    year_code VARCHAR(20) NOT NULL UNIQUE,
    name VARCHAR(120) NOT NULL,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
    closed_at TIMESTAMPTZ,
    closed_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
    closing_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
    opening_balances JSONB NOT NULL DEFAULT '{}'::jsonb,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fiscal_year_dates_valid CHECK (end_date >= start_date)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_fiscal_year_open ON fiscal_years(status) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS idx_fiscal_years_dates ON fiscal_years(start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_fiscal_years_status ON fiscal_years(status);

INSERT INTO fiscal_years (id, year_code, name, start_date, end_date, status, notes)
SELECT 2600000000001, to_char(CURRENT_DATE, 'YYYY'), 'السنة المالية ' || to_char(CURRENT_DATE, 'YYYY'),
       make_date(EXTRACT(YEAR FROM CURRENT_DATE)::int, 1, 1),
       make_date(EXTRACT(YEAR FROM CURRENT_DATE)::int, 12, 31), 'open', 'تم إنشاؤها تلقائيًا عند الترقية'
WHERE NOT EXISTS (SELECT 1 FROM fiscal_years);

COMMIT;
