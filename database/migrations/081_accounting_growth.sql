-- 081_accounting_growth.sql — Cost centers + fixed assets + bank rec + custody
-- ─────────────────────────────────────────────────────────────────────────────
-- ADDITIVE ONLY, idempotent. Nothing existing is altered except adding a
-- NULLABLE column to journal_lines (no backfill, no constraint change).
--   cost_centers            فرع/قسم (MAIN default)
--   journal_lines.cost_center_code (nullable FK)
--   chart 1520              مجمع الإهلاك (contra-asset)
--   fixed_assets            الأصول + الإهلاك الشهري التراكمي
--   bank_statements         كشف البنك المستورد للمطابقة
--   pos_cash_custody        تسليم العهدة كاشير→كاشير بإقرار
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS cost_centers (
    code VARCHAR(20) PRIMARY KEY CHECK (code ~ '^[A-Z0-9_-]{1,20}$'),
    name_ar VARCHAR(150) NOT NULL,
    name_en VARCHAR(150),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO cost_centers (code, name_ar, name_en) VALUES
    ('MAIN', 'المركز الرئيسي', 'Main')
ON CONFLICT (code) DO NOTHING;

ALTER TABLE journal_lines ADD COLUMN IF NOT EXISTS cost_center_code VARCHAR(20)
    REFERENCES cost_centers(code) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_journal_lines_cc ON journal_lines(cost_center_code);

INSERT INTO chart_of_accounts (id, code, name_ar, name_en, type, parent_code, is_postable) VALUES
    (1520, '1520', 'مجمع إهلاك المعدات', 'Accumulated Depreciation', 'asset', '1500', true)
ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS fixed_assets (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    category VARCHAR(100),
    purchase_date DATE NOT NULL,
    cost NUMERIC(14,2) NOT NULL CHECK (cost > 0),
    salvage NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (salvage >= 0),
    life_months INTEGER NOT NULL CHECK (life_months > 0),
    accumulated NUMERIC(14,2) NOT NULL DEFAULT 0,
    last_month CHAR(7),
    status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active','disposed')),
    cost_center_code VARCHAR(20) REFERENCES cost_centers(code) ON DELETE SET NULL,
    notes TEXT,
    created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_fixed_assets_status ON fixed_assets(status);

CREATE TABLE IF NOT EXISTS bank_statements (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    account_code VARCHAR(20) NOT NULL DEFAULT '1010' REFERENCES chart_of_accounts(code),
    stmt_date DATE NOT NULL,
    description VARCHAR(255),
    amount NUMERIC(14,2) NOT NULL,
    matched BOOLEAN NOT NULL DEFAULT FALSE,
    matched_entry BIGINT REFERENCES journal_entries(id) ON DELETE SET NULL,
    created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_bank_stmt UNIQUE (account_code, stmt_date, description, amount)
);
CREATE INDEX IF NOT EXISTS idx_bank_stmt_open ON bank_statements(account_code, matched, stmt_date);

CREATE TABLE IF NOT EXISTS pos_cash_custody (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    custody_date DATE NOT NULL DEFAULT (NOW() AT TIME ZONE 'Asia/Riyadh')::date,
    from_cashier BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    to_cashier BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
    session_id BIGINT REFERENCES pos_shift_sessions(id) ON DELETE SET NULL,
    note TEXT,
    ack_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT ck_custody_pair CHECK (from_cashier <> to_cashier)
);
CREATE INDEX IF NOT EXISTS idx_custody_to ON pos_cash_custody(to_cashier, ack_at);
