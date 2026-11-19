-- 151_financial_compliance_schema.sql
-- Additive persistence for payroll/GOSI/WPS, VAT returns, and bank imports.
-- Reuses the existing employees, payroll, payroll_runs, POS/purchase invoices,
-- chart of accounts, users, bank_statements, and hash-chained audit log.
-- Regulatory rates and filing statuses are not seeded or represented as
-- government-approved; provider readiness remains governed by migration 145.

BEGIN;

-- The existing append-only, hash-chained pos_audit_logs is also used for
-- finance actions. Add explicit action names without creating a second ledger.
ALTER TYPE pos_audit_action ADD VALUE IF NOT EXISTS 'PAYROLL_APPROVE';
ALTER TYPE pos_audit_action ADD VALUE IF NOT EXISTS 'VAT_RETURN_FINALIZE';

-- ─── GOSI: explicit, sourced, versioned rates (no unverified seed values) ───
CREATE TABLE IF NOT EXISTS gosi_rate_sets (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    code VARCHAR(40) NOT NULL,
    version INTEGER NOT NULL CHECK (version > 0),
    effective_from DATE NOT NULL,
    effective_to DATE,
    monthly_wage_cap NUMERIC(14,2) NOT NULL CHECK (monthly_wage_cap > 0),
    verification_status VARCHAR(12) NOT NULL DEFAULT 'unverified'
        CHECK (verification_status IN ('unverified', 'verified', 'retired')),
    source_url TEXT,
    verified_at TIMESTAMPTZ,
    created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_gosi_rate_set_version UNIQUE (code, version),
    CONSTRAINT ck_gosi_rate_set_dates
        CHECK (effective_to IS NULL OR effective_to >= effective_from),
    CONSTRAINT ck_gosi_rate_set_verified_source
        CHECK (verification_status <> 'verified'
            OR (source_url IS NOT NULL AND length(trim(source_url)) > 0 AND verified_at IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS idx_gosi_rate_sets_effective
    ON gosi_rate_sets (effective_from, effective_to, verification_status);

CREATE TABLE IF NOT EXISTS gosi_rate_rules (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    rate_set_id BIGINT NOT NULL REFERENCES gosi_rate_sets(id) ON DELETE RESTRICT,
    insured_category VARCHAR(8) NOT NULL CHECK (insured_category IN ('saudi', 'expat')),
    employee_rate_bp SMALLINT NOT NULL CHECK (employee_rate_bp BETWEEN 0 AND 10000),
    employer_rate_bp SMALLINT NOT NULL CHECK (employer_rate_bp BETWEEN 0 AND 10000),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_gosi_rate_rule_category UNIQUE (rate_set_id, insured_category)
);

CREATE TABLE IF NOT EXISTS payroll_gosi_calculations (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    payroll_id BIGINT NOT NULL REFERENCES payroll(id) ON DELETE RESTRICT,
    calculation_version SMALLINT NOT NULL DEFAULT 1 CHECK (calculation_version > 0),
    rate_set_id BIGINT NOT NULL REFERENCES gosi_rate_sets(id) ON DELETE RESTRICT,
    insured_category VARCHAR(8) NOT NULL CHECK (insured_category IN ('saudi', 'expat')),
    assessable_wage NUMERIC(14,2) NOT NULL CHECK (assessable_wage >= 0),
    monthly_wage_cap NUMERIC(14,2) NOT NULL CHECK (monthly_wage_cap > 0),
    contribution_base NUMERIC(14,2) NOT NULL CHECK (
        contribution_base >= 0 AND contribution_base <= assessable_wage
        AND contribution_base <= monthly_wage_cap
    ),
    employee_rate_bp SMALLINT NOT NULL CHECK (employee_rate_bp BETWEEN 0 AND 10000),
    employer_rate_bp SMALLINT NOT NULL CHECK (employer_rate_bp BETWEEN 0 AND 10000),
    employee_contribution NUMERIC(14,2) NOT NULL CHECK (employee_contribution >= 0),
    employer_contribution NUMERIC(14,2) NOT NULL CHECK (employer_contribution >= 0),
    calculated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT uq_payroll_gosi_calculation_version UNIQUE (payroll_id, calculation_version)
);

CREATE INDEX IF NOT EXISTS idx_payroll_gosi_rate_set
    ON payroll_gosi_calculations (rate_set_id, calculated_at DESC);

COMMENT ON TABLE payroll_gosi_calculations IS
    'GOSI contribution snapshots linked to the existing payroll row; rates and capped wage are retained for audit.';

-- ─── WPS: record generated artifacts without storing bank data/file contents ─
CREATE TABLE IF NOT EXISTS wps_export_runs (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    payroll_month VARCHAR(7) NOT NULL REFERENCES payroll_runs(month) ON DELETE RESTRICT,
    revision SMALLINT NOT NULL DEFAULT 1 CHECK (revision > 0),
    status VARCHAR(12) NOT NULL DEFAULT 'generated'
        CHECK (status IN ('generated', 'superseded', 'void')),
    file_sha256 CHAR(64) NOT NULL CHECK (file_sha256 ~ '^[0-9a-f]{64}$'),
    idempotency_key VARCHAR(200) NOT NULL UNIQUE,
    employee_count INTEGER NOT NULL CHECK (employee_count >= 0),
    total_net NUMERIC(14,2) NOT NULL,
    generated_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
    generated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_wps_export_month_revision UNIQUE (payroll_month, revision)
);

-- ─── VAT: frozen return versions and invoice-linked tax snapshots ───────────
CREATE TABLE IF NOT EXISTS vat_returns (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    jurisdiction_code CHAR(2) NOT NULL DEFAULT 'SA',
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
    filing_frequency_snapshot VARCHAR(10) NOT NULL
        CHECK (filing_frequency_snapshot IN ('monthly', 'quarterly')),
    currency_code CHAR(3) NOT NULL DEFAULT 'SAR',
    return_version INTEGER NOT NULL DEFAULT 1 CHECK (return_version > 0),
    supersedes_return_id BIGINT REFERENCES vat_returns(id) ON DELETE RESTRICT,
    status VARCHAR(12) NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'reviewed', 'finalized', 'void')),
    created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    finalized_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
    finalized_at TIMESTAMPTZ,
    CONSTRAINT ck_vat_return_period CHECK (period_end >= period_start),
    CONSTRAINT ck_vat_return_not_self_superseding
        CHECK (supersedes_return_id IS NULL OR supersedes_return_id <> id),
    CONSTRAINT ck_vat_return_finalization
        CHECK (
            (finalized_by IS NULL AND finalized_at IS NULL AND status <> 'finalized')
            OR (finalized_by IS NOT NULL AND finalized_at IS NOT NULL AND status IN ('finalized', 'void'))
        ),
    CONSTRAINT uq_vat_return_period_version
        UNIQUE (jurisdiction_code, period_start, period_end, return_version)
);

CREATE INDEX IF NOT EXISTS idx_vat_returns_period_status
    ON vat_returns (period_start, period_end, status);

CREATE TABLE IF NOT EXISTS vat_return_lines (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    vat_return_id BIGINT NOT NULL REFERENCES vat_returns(id) ON DELETE RESTRICT,
    line_number INTEGER NOT NULL CHECK (line_number > 0),
    direction VARCHAR(6) NOT NULL CHECK (direction IN ('output', 'input')),
    pos_order_id UUID REFERENCES pos_orders(id) ON DELETE RESTRICT,
    purchase_invoice_id BIGINT REFERENCES "purchaseInvoices"(id) ON DELETE RESTRICT,
    invoice_reference_snapshot VARCHAR(255) NOT NULL,
    invoice_date DATE NOT NULL,
    tax_category_code VARCHAR(30) NOT NULL CHECK (tax_category_code ~ '^[A-Z0-9_]{1,30}$'),
    vat_rate NUMERIC(5,2) NOT NULL CHECK (vat_rate BETWEEN 0 AND 100),
    taxable_amount NUMERIC(14,2) NOT NULL,
    vat_amount NUMERIC(14,2) NOT NULL,
    currency_code CHAR(3) NOT NULL DEFAULT 'SAR',
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT ck_vat_return_line_source CHECK (
        (pos_order_id IS NOT NULL AND purchase_invoice_id IS NULL AND direction = 'output')
        OR
        (purchase_invoice_id IS NOT NULL AND pos_order_id IS NULL AND direction = 'input')
    ),
    CONSTRAINT uq_vat_return_line_number UNIQUE (vat_return_id, line_number)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_vat_return_pos_tax_bucket
    ON vat_return_lines (vat_return_id, pos_order_id, tax_category_code, vat_rate)
    WHERE pos_order_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_vat_return_purchase_tax_bucket
    ON vat_return_lines (vat_return_id, purchase_invoice_id, tax_category_code, vat_rate)
    WHERE purchase_invoice_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_vat_return_lines_invoice_date
    ON vat_return_lines (invoice_date, vat_return_id);

COMMENT ON TABLE vat_returns IS
    'Internal VAT-return versions; not evidence of ZATCA submission or acceptance. Totals are derived from frozen invoice-linked lines.';
COMMENT ON TABLE vat_return_lines IS
    'Tax snapshots linked to existing POS sales orders or purchase invoices; no duplicate invoice ledger is created.';

-- ─── Bank statement import provenance; existing statement/match rows remain ─
CREATE TABLE IF NOT EXISTS bank_statement_imports (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    account_code VARCHAR(20) NOT NULL REFERENCES chart_of_accounts(code) ON DELETE RESTRICT,
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
    currency_code CHAR(3) NOT NULL DEFAULT 'SAR',
    opening_balance NUMERIC(14,2),
    closing_balance NUMERIC(14,2),
    source_file_name VARCHAR(255),
    file_sha256 CHAR(64) NOT NULL CHECK (file_sha256 ~ '^[0-9a-f]{64}$'),
    imported_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
    imported_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT ck_bank_import_period CHECK (period_end >= period_start),
    CONSTRAINT uq_bank_import_id_account UNIQUE (id, account_code),
    CONSTRAINT uq_bank_import_account_hash UNIQUE (account_code, file_sha256)
);

ALTER TABLE bank_statements
    ADD COLUMN IF NOT EXISTS import_id BIGINT,
    ADD COLUMN IF NOT EXISTS import_line_no INTEGER,
    ADD COLUMN IF NOT EXISTS bank_reference VARCHAR(255);

DO $$
BEGIN
    ALTER TABLE bank_statements
        ADD CONSTRAINT bank_statements_import_account_fk
        FOREIGN KEY (import_id, account_code)
        REFERENCES bank_statement_imports (id, account_code)
        ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
    ALTER TABLE bank_statements
        ADD CONSTRAINT ck_bank_statement_import_line
        CHECK (
            (import_id IS NULL AND import_line_no IS NULL)
            OR (import_id IS NOT NULL AND import_line_no > 0)
        );
EXCEPTION WHEN duplicate_object THEN NULL;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_bank_statement_import_line
    ON bank_statements (import_id, import_line_no)
    WHERE import_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_bank_statement_import_period
    ON bank_statement_imports (account_code, period_start, period_end);

COMMENT ON TABLE bank_statement_imports IS
    'Import provenance only; statement transactions remain in bank_statements and reconcile to existing journal entries.';
COMMENT ON COLUMN bank_statement_imports.file_sha256 IS
    'SHA-256 of the source file for deduplication; raw bank files and credentials are not stored in this table.';

COMMIT;
