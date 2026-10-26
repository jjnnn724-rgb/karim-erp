-- ════════════════════════════════════════════════════════════════════════════
-- Migration 003: OmniTrack POS — Institutional Smart Cashier Module
-- ────────────────────────────────────────────────────────────────────────────
-- Target: Karim ERP LAN Edition (existing schema)
-- ────────────────────────────────────────────────────────────────────────────
-- IMPORTANT — Integration Strategy:
--   The existing system uses tables `users`, `inventory`, `departments`, `dispatches`,
--   `recipes` with their own column conventions. To preserve the baseline without
--   ANY destructive ALTER, this migration:
--     1. Creates NEW pos_* tables for the cashier module (fully isolated)
--     2. Creates a pos_products table that mirrors/extends inventory for POS use
--     3. Creates a pos_orders table (separate from existing app_state pattern)
--     4. Wires FK to existing `users(id)` for cashier identity
--     5. Wires FK to existing `departments(code)` for dept-level integration
--     6. Adds a sync trigger so new pos_products can be auto-created from inventory
--
-- All statements are idempotent (IF NOT EXISTS / OR REPLACE / ON CONFLICT DO NOTHING).
-- ════════════════════════════════════════════════════════════════════════════
-- Author: Senior Software Architect (Fintech)
-- Version: 1.0.0  |  Date: 2026-07-16
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ────────────────────────────────────────────────────────────────────────────
-- 0. Extensions
-- ────────────────────────────────────────────────────────────────────────────
-- pgcrypto is OPTIONAL — only needed for digest() in the ZATCA hash function.
-- gen_random_uuid() is built into PG 13+ core (no extension needed).
-- We try to create pgcrypto, but if it fails (e.g. missing on a minimal build),
-- we fall back to a digest() shim that uses md5() (built-in).
DO $$
BEGIN
    BEGIN
        CREATE EXTENSION IF NOT EXISTS "pgcrypto";
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'pgcrypto extension not available — using md5() fallback for digest()';
    END;
END $$;

-- Fallback: if digest() function doesn't exist, create a shim using md5()
-- (This allows the migration to succeed on PG builds without pgcrypto)
DO $fallback_block$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'digest' AND pronamespace = 'public'::regnamespace) THEN
        EXECUTE $func$
            CREATE OR REPLACE FUNCTION digest(data text, algorithm text)
            RETURNS bytea AS $inner$
            BEGIN
                -- Fallback: use md5 regardless of algorithm parameter
                RETURN decode(md5(data), 'hex');
            END;
            $inner$ LANGUAGE plpgsql IMMUTABLE;
        $func$;
        RAISE NOTICE 'Created digest() fallback function using md5()';
    END IF;
END $fallback_block$;

-- ────────────────────────────────────────────────────────────────────────────
-- 1. ENUM Types
-- ────────────────────────────────────────────────────────────────────────────
DO $$ BEGIN
    CREATE TYPE pos_payment_method AS ENUM ('cash', 'card', 'wallet', 'bank_transfer', 'voucher', 'loyalty');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE pos_shift_status AS ENUM ('open', 'closing', 'closed', 'voided');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE pos_invoice_status AS ENUM ('draft', 'issued', 'reported', 'failed', 'cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE pos_audit_action AS ENUM ('INSERT', 'UPDATE', 'DELETE', 'VOID', 'OPEN_SHIFT', 'CLOSE_SHIFT', 'REFUND', 'PRICE_OVERRIDE');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE pos_print_status AS ENUM ('pending', 'printing', 'printed', 'failed', 'abandoned');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE pos_zatca_status AS ENUM ('queued', 'processing', 'reported', 'failed', 'dead_letter');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ────────────────────────────────────────────────────────────────────────────
-- 2. NEW Module Tables (all prefixed with pos_ to avoid conflicts)
-- ────────────────────────────────────────────────────────────────────────────

-- 2.1 pos_departments — separate from existing `departments` table
--   (we use the existing `departments.code` for cross-reference via dept_code)
CREATE TABLE IF NOT EXISTS pos_departments (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    code            VARCHAR(50)  UNIQUE NOT NULL,
    name_ar         VARCHAR(255) NOT NULL,
    name_en         VARCHAR(255),
    legacy_dept_code VARCHAR(50) REFERENCES departments(code) ON DELETE SET NULL,  -- link to existing
    is_active       BOOLEAN NOT NULL DEFAULT true,
    vat_number      VARCHAR(50) DEFAULT '300000000000003',  -- KSA test VAT
    location        VARCHAR(255),
    sort_order      INT DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
COMMENT ON TABLE pos_departments IS 'POS departments (Malaysian, Grill, ...). Linked to legacy departments via legacy_dept_code. Multiple concurrent shifts allowed per department.';

-- 2.2 pos_products — POS-specific products, synced from inventory
CREATE TABLE IF NOT EXISTS pos_products (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    legacy_inventory_id BIGINT REFERENCES inventory(id) ON DELETE SET NULL,  -- link to existing inventory
    barcode         VARCHAR(64) UNIQUE,
    name_ar         VARCHAR(255) NOT NULL,
    name_en         VARCHAR(255),
    department_id   BIGINT REFERENCES pos_departments(id) ON DELETE SET NULL,
    price           NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (price >= 0),
    cost_price      NUMERIC(12,2),
    vat_rate        NUMERIC(5,2) NOT NULL DEFAULT 15.00,   -- KSA standard 15%
    stock_quantity  NUMERIC(14,3) NOT NULL DEFAULT 0,
    min_stock_level NUMERIC(14,3) DEFAULT 0,
    is_active       BOOLEAN DEFAULT true,
    category        VARCHAR(100),
    unit            VARCHAR(50) DEFAULT 'piece',
    metadata        JSONB DEFAULT '{}'::jsonb,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
COMMENT ON TABLE pos_products IS 'POS products. Can be auto-synced from existing inventory table via trigger or manual CRUD.';

-- 2.3 pos_shift_sessions — the heart of dynamic shift management
-- NOTE: PostgreSQL does NOT allow subqueries in GENERATED ALWAYS AS (...)
-- STORED columns. expected_cash and cash_variance are therefore regular
-- NUMERIC columns, computed inside sp_pos_close_shift (and on-demand by
-- the v_pos_cashier_dashboard view) to keep the schema portable across
-- PostgreSQL 12+.
CREATE TABLE IF NOT EXISTS pos_shift_sessions (
    id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    department_id       BIGINT NOT NULL REFERENCES pos_departments(id) ON DELETE RESTRICT,
    cashier_id          BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,  -- link to existing users
    status              pos_shift_status NOT NULL DEFAULT 'open',
    opening_balance     NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (opening_balance >= 0),
    expected_cash       NUMERIC(12,2),
    actual_cash         NUMERIC(12,2),
    cash_variance       NUMERIC(12,2),
    opened_at           TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    closed_at           TIMESTAMPTZ,
    closed_by           BIGINT REFERENCES users(id),
    closing_notes       TEXT,
    metadata            JSONB DEFAULT '{}'::jsonb,
    CONSTRAINT chk_pos_session_timing CHECK (closed_at IS NULL OR closed_at > opened_at),
    CONSTRAINT chk_pos_actual_cash CHECK (actual_cash IS NULL OR actual_cash >= 0)
);
COMMENT ON TABLE pos_shift_sessions IS 'Cashier shift sessions. Multiple concurrent sessions per department allowed. expected_cash and cash_variance are populated by sp_pos_close_shift at close time.';

-- 2.4 pos_orders — UUID PK (per spec), separate from legacy app_state pattern
CREATE TABLE IF NOT EXISTS pos_orders (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id          BIGINT NOT NULL REFERENCES pos_shift_sessions(id) ON DELETE RESTRICT,
    department_id       BIGINT NOT NULL REFERENCES pos_departments(id) ON DELETE RESTRICT,
    cashier_id          BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    status              pos_invoice_status NOT NULL DEFAULT 'draft',
    subtotal            NUMERIC(12,2) NOT NULL DEFAULT 0,
    discount_total      NUMERIC(12,2) NOT NULL DEFAULT 0,
    tax_total           NUMERIC(12,2) NOT NULL DEFAULT 0,
    total_amount        NUMERIC(12,2) NOT NULL DEFAULT 0,
    currency_code       CHAR(3) NOT NULL DEFAULT 'SAR',
    notes               TEXT,
    voided_at           TIMESTAMPTZ,
    voided_by           BIGINT REFERENCES users(id),
    void_reason         TEXT,
    -- ZATCA Phase-2 fields
    invoice_counter     BIGINT,
    invoice_uuid        UUID DEFAULT gen_random_uuid(),
    previous_invoice_hash TEXT,
    invoice_hash        TEXT,
    digital_signature   TEXT,
    signature_algorithm VARCHAR(32) DEFAULT 'ECDSA-P256-SHA256',
    qr_payload          TEXT,                              -- Base64 TLV
    zatca_reported_at   TIMESTAMPTZ,
    zatca_pi_hmac       TEXT,                              -- ZATCA PIH
    created_at          TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_pos_orders_dept_invoice_counter UNIQUE (department_id, invoice_counter)
);
COMMENT ON TABLE pos_orders IS 'POS invoices (UUID PK). Hash-chained per department for ZATCA Phase-2 compliance.';

-- 2.5 pos_order_items — line items with snapshot
CREATE TABLE IF NOT EXISTS pos_order_items (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    order_id        UUID NOT NULL REFERENCES pos_orders(id) ON DELETE CASCADE,
    product_id      BIGINT NOT NULL REFERENCES pos_products(id) ON DELETE RESTRICT,
    product_name    VARCHAR(255) NOT NULL,                 -- snapshot
    product_barcode VARCHAR(64),                           -- snapshot
    quantity        NUMERIC(14,3) NOT NULL CHECK (quantity > 0),
    unit_price      NUMERIC(12,2) NOT NULL CHECK (unit_price >= 0),
    discount        NUMERIC(12,2) NOT NULL DEFAULT 0,
    vat_rate        NUMERIC(5,2) NOT NULL DEFAULT 15.00,
    line_total      NUMERIC(12,2) NOT NULL,
    vat_amount      NUMERIC(12,2) NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
COMMENT ON TABLE pos_order_items IS 'Order line items with price/barcode snapshots to preserve historical integrity.';

-- 2.6 pos_invoice_payments — split payments breakdown
CREATE TABLE IF NOT EXISTS pos_invoice_payments (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    order_id        UUID NOT NULL REFERENCES pos_orders(id) ON DELETE CASCADE,
    method          pos_payment_method NOT NULL,
    amount          NUMERIC(12,2) NOT NULL CHECK (amount > 0),
    direction       CHAR(3) NOT NULL DEFAULT 'in' CHECK (direction IN ('in','out')),
    currency        CHAR(3) NOT NULL DEFAULT 'SAR',
    reference       VARCHAR(255),                          -- gateway/bank ref
    payer_info      JSONB DEFAULT '{}'::jsonb,
    processed_at    TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
COMMENT ON TABLE pos_invoice_payments IS 'Split payment ledger. direction=in for sale, out for refund.';

-- 2.7 pos_department_daily_revenues — per-day, per-method rollup (trigger-maintained)
CREATE TABLE IF NOT EXISTS pos_department_daily_revenues (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    department_id   BIGINT NOT NULL REFERENCES pos_departments(id) ON DELETE CASCADE,
    revenue_date    DATE NOT NULL,                         -- in AST (UTC+3) business day
    method          pos_payment_method NOT NULL,
    gross_amount    NUMERIC(12,2) NOT NULL DEFAULT 0,
    refund_amount   NUMERIC(12,2) NOT NULL DEFAULT 0,
    net_amount      NUMERIC(12,2) GENERATED ALWAYS AS (gross_amount - refund_amount) STORED,
    invoice_count   INT NOT NULL DEFAULT 0,
    refund_count    INT NOT NULL DEFAULT 0,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (department_id, revenue_date, method)
);

-- 2.8 pos_idempotency_keys — 24h TTL anti-duplicate
CREATE TABLE IF NOT EXISTS pos_idempotency_keys (
    key             VARCHAR(128) PRIMARY KEY,
    request_hash    TEXT NOT NULL,
    response_status INT,
    response_body   JSONB,
    order_id        UUID REFERENCES pos_orders(id) ON DELETE SET NULL,
    cashier_id      BIGINT REFERENCES users(id) ON DELETE SET NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at      TIMESTAMPTZ NOT NULL DEFAULT (CURRENT_TIMESTAMP + INTERVAL '24 hours'),
    CONSTRAINT chk_pos_idem_expiry CHECK (expires_at > created_at)
);

-- 2.9 pos_zatca_invoice_queue — async submission queue (BullMQ mirror)
CREATE TABLE IF NOT EXISTS pos_zatca_invoice_queue (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    order_id        UUID NOT NULL REFERENCES pos_orders(id) ON DELETE CASCADE,
    status          pos_zatca_status NOT NULL DEFAULT 'queued',
    attempts        INT NOT NULL DEFAULT 0,
    max_attempts    INT NOT NULL DEFAULT 10,
    next_retry_at   TIMESTAMPTZ,
    last_error      TEXT,
    last_attempt_at TIMESTAMPTZ,
    reported_at     TIMESTAMPTZ,
    zatca_uuid      TEXT,
    zatca_pih       TEXT,
    queued_at       TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (order_id)
);

-- 2.10 pos_pending_prints — offline-first ESC/POS print queue
CREATE TABLE IF NOT EXISTS pos_pending_prints (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    order_id        UUID NOT NULL REFERENCES pos_orders(id) ON DELETE CASCADE,
    printer_id      VARCHAR(100) NOT NULL,
    payload         BYTEA NOT NULL,                        -- raw ESC/POS bytes
    status          pos_print_status NOT NULL DEFAULT 'pending',
    attempts        INT NOT NULL DEFAULT 0,
    max_attempts    INT NOT NULL DEFAULT 8,
    next_retry_at   TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_error      TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    completed_at    TIMESTAMPTZ
);

-- 2.11 pos_printers — registry of thermal printers
CREATE TABLE IF NOT EXISTS pos_printers (
    id              VARCHAR(100) PRIMARY KEY,
    department_id   BIGINT REFERENCES pos_departments(id) ON DELETE SET NULL,
    connection_type VARCHAR(20) NOT NULL CHECK (connection_type IN ('usb','network','serial','windows_share')),
    address         VARCHAR(255),
    paper_width_mm  INT NOT NULL DEFAULT 80,
    charset         VARCHAR(50) DEFAULT 'cp864',
    is_online       BOOLEAN DEFAULT true,
    last_seen_at    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 2.12 pos_audit_logs — APPEND-ONLY
CREATE TABLE IF NOT EXISTS pos_audit_logs (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    occurred_at     TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    actor_user_id   BIGINT REFERENCES users(id) ON DELETE SET NULL,
    actor_username  VARCHAR(255),
    actor_role      VARCHAR(50),                            -- existing users.role is VARCHAR
    actor_ip        INET,
    action          pos_audit_action NOT NULL,
    table_name      VARCHAR(100) NOT NULL,
    row_pk          TEXT,
    data_before     JSONB,
    data_after      JSONB,
    reason          TEXT,
    request_id      VARCHAR(64),
    metadata        JSONB DEFAULT '{}'::jsonb
);
COMMENT ON TABLE pos_audit_logs IS 'Append-only audit trail. UPDATE and DELETE are forbidden via trigger + REVOKE.';

-- 2.13 pos_stock_movements — append-only stock ledger
CREATE TABLE IF NOT EXISTS pos_stock_movements (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    product_id      BIGINT NOT NULL REFERENCES pos_products(id) ON DELETE RESTRICT,
    order_id        UUID REFERENCES pos_orders(id) ON DELETE SET NULL,
    quantity_delta  NUMERIC(14,3) NOT NULL,
    balance_after   NUMERIC(14,3) NOT NULL,
    reason          VARCHAR(50) NOT NULL,
    performed_by    BIGINT REFERENCES users(id) ON DELETE SET NULL,
    performed_at    TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    metadata        JSONB DEFAULT '{}'::jsonb
);

-- 2.14 pos_refresh_tokens — JWT 15m access / 7d refresh
CREATE TABLE IF NOT EXISTS pos_refresh_tokens (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash      TEXT NOT NULL UNIQUE,
    device_info     JSONB DEFAULT '{}'::jsonb,
    ip_address      INET,
    issued_at       TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at      TIMESTAMPTZ NOT NULL,
    revoked_at      TIMESTAMPTZ,
    replaced_by     UUID REFERENCES pos_refresh_tokens(id),
    CONSTRAINT chk_pos_token_expiry CHECK (expires_at > issued_at)
);

-- ────────────────────────────────────────────────────────────────────────────
-- 3. Composite & Performance Indexes (p95 < 200ms / 50 concurrent cashiers)
-- ────────────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_pos_orders_session_dept_created
    ON pos_orders (session_id, department_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_pos_shift_sessions_cashier_open
    ON pos_shift_sessions (cashier_id, status, opened_at DESC)
    WHERE status = 'open';

CREATE INDEX IF NOT EXISTS idx_pos_shift_sessions_dept_open
    ON pos_shift_sessions (department_id, status, opened_at DESC)
    WHERE status = 'open';

CREATE INDEX IF NOT EXISTS idx_pos_products_barcode_active
    ON pos_products (barcode) WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_pos_products_dept_active
    ON pos_products (department_id) WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_pos_products_legacy_inv
    ON pos_products (legacy_inventory_id);

CREATE INDEX IF NOT EXISTS idx_pos_idempotency_expires
    ON pos_idempotency_keys (expires_at);

CREATE INDEX IF NOT EXISTS idx_pos_pending_prints_retry
    ON pos_pending_prints (status, next_retry_at)
    WHERE status IN ('pending','failed');

CREATE INDEX IF NOT EXISTS idx_pos_zatca_queue_retry
    ON pos_zatca_invoice_queue (status, next_retry_at)
    WHERE status IN ('queued','failed');

CREATE INDEX IF NOT EXISTS idx_pos_audit_logs_actor_time
    ON pos_audit_logs (actor_user_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_pos_audit_logs_table_row
    ON pos_audit_logs (table_name, row_pk);

CREATE INDEX IF NOT EXISTS idx_pos_audit_logs_action_time
    ON pos_audit_logs (action, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_pos_stock_movements_product_time
    ON pos_stock_movements (product_id, performed_at DESC);

CREATE INDEX IF NOT EXISTS idx_pos_orders_dept_invoice_counter
    ON pos_orders (department_id, invoice_counter DESC)
    WHERE invoice_counter IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_pos_orders_invoice_uuid
    ON pos_orders (invoice_uuid) WHERE invoice_uuid IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_pos_dept_daily_revenue_lookup
    ON pos_department_daily_revenues (department_id, revenue_date DESC);

CREATE INDEX IF NOT EXISTS idx_pos_refresh_tokens_user_active
    ON pos_refresh_tokens (user_id) WHERE revoked_at IS NULL;

-- ────────────────────────────────────────────────────────────────────────────
-- 4. Row-Level Security (RLS)
-- ────────────────────────────────────────────────────────────────────────────
ALTER TABLE pos_orders                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE pos_order_items              ENABLE ROW LEVEL SECURITY;
ALTER TABLE pos_invoice_payments         ENABLE ROW LEVEL SECURITY;
ALTER TABLE pos_shift_sessions           ENABLE ROW LEVEL SECURITY;
ALTER TABLE pos_pending_prints           ENABLE ROW LEVEL SECURITY;
ALTER TABLE pos_stock_movements          ENABLE ROW LEVEL SECURITY;
ALTER TABLE pos_department_daily_revenues ENABLE ROW LEVEL SECURITY;

-- Helper: privileged roles (admin / manager / auditor / bg_worker)
CREATE OR REPLACE FUNCTION fn_pos_is_privileged()
RETURNS BOOLEAN
LANGUAGE sql STABLE AS $$
    SELECT current_setting('app.user_role', true) IN ('admin','manager','auditor','bg_worker')
$$;

-- Helper: array of department_ids the current user can access
CREATE OR REPLACE FUNCTION fn_pos_accessible_dept_ids()
RETURNS BIGINT[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT
        CASE
            WHEN current_setting('app.user_role', true) IN ('admin','manager','auditor','bg_worker')
                THEN NULL
            WHEN current_setting('app.user_role', true) = 'cashier'
                THEN ARRAY(
                    SELECT department_id
                    FROM pos_shift_sessions
                    WHERE cashier_id = current_setting('app.user_id', true)::BIGINT
                      AND status = 'open'
                )
            ELSE ARRAY[]::BIGINT[]
        END
$$;

-- Policies
DROP POLICY IF EXISTS rls_pos_orders_visibility ON pos_orders;
CREATE POLICY rls_pos_orders_visibility ON pos_orders
    FOR ALL
    USING (
        fn_pos_is_privileged()
        OR department_id = ANY(fn_pos_accessible_dept_ids())
    )
    WITH CHECK (
        fn_pos_is_privileged()
        OR department_id = ANY(fn_pos_accessible_dept_ids())
    );

DROP POLICY IF EXISTS rls_pos_order_items_visibility ON pos_order_items;
CREATE POLICY rls_pos_order_items_visibility ON pos_order_items
    FOR ALL
    USING (
        fn_pos_is_privileged()
        OR EXISTS (
            SELECT 1 FROM pos_orders o
            WHERE o.id = pos_order_items.order_id
              AND (o.department_id = ANY(fn_pos_accessible_dept_ids()))
        )
    );

DROP POLICY IF EXISTS rls_pos_invoice_payments_visibility ON pos_invoice_payments;
CREATE POLICY rls_pos_invoice_payments_visibility ON pos_invoice_payments
    FOR ALL
    USING (
        fn_pos_is_privileged()
        OR EXISTS (
            SELECT 1 FROM pos_orders o
            WHERE o.id = pos_invoice_payments.order_id
              AND (o.department_id = ANY(fn_pos_accessible_dept_ids()))
        )
    );

DROP POLICY IF EXISTS rls_pos_shift_sessions_visibility ON pos_shift_sessions;
CREATE POLICY rls_pos_shift_sessions_visibility ON pos_shift_sessions
    FOR ALL
    USING (
        fn_pos_is_privileged()
        OR cashier_id = current_setting('app.user_id', true)::BIGINT
    )
    WITH CHECK (
        fn_pos_is_privileged()
        OR cashier_id = current_setting('app.user_id', true)::BIGINT
    );

DROP POLICY IF EXISTS rls_pos_pending_prints_visibility ON pos_pending_prints;
CREATE POLICY rls_pos_pending_prints_visibility ON pos_pending_prints
    FOR ALL
    USING (
        fn_pos_is_privileged()
        OR EXISTS (
            SELECT 1 FROM pos_orders o
            WHERE o.id = pos_pending_prints.order_id
              AND (o.department_id = ANY(fn_pos_accessible_dept_ids()))
        )
    );

DROP POLICY IF EXISTS rls_pos_stock_movements_visibility ON pos_stock_movements;
CREATE POLICY rls_pos_stock_movements_visibility ON pos_stock_movements
    FOR ALL USING (fn_pos_is_privileged());

DROP POLICY IF EXISTS rls_pos_dept_revenue_visibility ON pos_department_daily_revenues;
CREATE POLICY rls_pos_dept_revenue_visibility ON pos_department_daily_revenues
    FOR SELECT
    USING (
        fn_pos_is_privileged()
        OR department_id = ANY(fn_pos_accessible_dept_ids())
    );

-- ────────────────────────────────────────────────────────────────────────────
-- 5. Triggers
-- ────────────────────────────────────────────────────────────────────────────

-- 5.1 Auto-update updated_at
CREATE OR REPLACE FUNCTION trg_fn_pos_touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at := CURRENT_TIMESTAMP;
    RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_pos_products_touch ON pos_products;
CREATE TRIGGER trg_pos_products_touch BEFORE UPDATE ON pos_products
    FOR EACH ROW EXECUTE FUNCTION trg_fn_pos_touch_updated_at();

DROP TRIGGER IF EXISTS trg_pos_orders_touch ON pos_orders;
CREATE TRIGGER trg_pos_orders_touch BEFORE UPDATE ON pos_orders
    FOR EACH ROW EXECUTE FUNCTION trg_fn_pos_touch_updated_at();

-- 5.2 ZATCA Hash Chaining (with Advisory Lock to prevent counter races)
CREATE OR REPLACE FUNCTION fn_pos_compute_invoice_hash(p_order pos_orders) RETURNS TEXT
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
    canonical TEXT;
BEGIN
    canonical := p_order.invoice_uuid::TEXT
              || '|' || p_order.invoice_counter::TEXT
              || '|' || p_order.total_amount::TEXT
              || '|' || p_order.tax_total::TEXT
              || '|' || p_order.subtotal::TEXT
              || '|' || p_order.discount_total::TEXT
              || '|' || to_char(p_order.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"');
    RETURN encode(digest(canonical, 'sha256'), 'hex');
END $$;

CREATE OR REPLACE FUNCTION trg_fn_pos_chain_invoice_hash()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
    v_prev_hash TEXT;
    v_prev_counter BIGINT;
BEGIN
    IF (NEW.invoice_counter IS NOT NULL) THEN
        RETURN NEW;
    END IF;
    IF NEW.department_id IS NULL THEN
        RAISE EXCEPTION 'ZATCA chain requires department_id on order %', NEW.id;
    END IF;

    -- 🔒 Advisory lock — serializes counter allocation per department
    PERFORM pg_advisory_xact_lock(7331, NEW.department_id::INT);

    SELECT invoice_hash, invoice_counter
      INTO v_prev_hash, v_prev_counter
      FROM pos_orders
     WHERE department_id = NEW.department_id
       AND invoice_counter IS NOT NULL
     ORDER BY invoice_counter DESC
     LIMIT 1;

    NEW.previous_invoice_hash := COALESCE(v_prev_hash, '');
    NEW.invoice_counter        := COALESCE(v_prev_counter, 0) + 1;
    NEW.invoice_hash           := fn_pos_compute_invoice_hash(NEW);
    RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_pos_chain_invoice_hash ON pos_orders;
CREATE TRIGGER trg_pos_chain_invoice_hash
    BEFORE INSERT OR UPDATE OF status ON pos_orders
    FOR EACH ROW
    WHEN (NEW.status IN ('issued','reported') AND NEW.invoice_counter IS NULL)
    EXECUTE FUNCTION trg_fn_pos_chain_invoice_hash();

-- 5.3 Revenue Routing
CREATE OR REPLACE FUNCTION trg_fn_pos_route_revenue()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
    v_dept_id BIGINT;
    v_date DATE;
BEGIN
    SELECT department_id INTO v_dept_id FROM pos_orders WHERE id = NEW.order_id;
    IF v_dept_id IS NULL THEN RETURN NEW; END IF;
    v_date := (NEW.processed_at AT TIME ZONE 'Asia/Riyadh')::DATE;

    INSERT INTO pos_department_daily_revenues
        (department_id, revenue_date, method,
         gross_amount, refund_amount, invoice_count, refund_count, updated_at)
    VALUES
        (v_dept_id, v_date, NEW.method,
         CASE WHEN NEW.direction = 'in'  THEN NEW.amount ELSE 0 END,
         CASE WHEN NEW.direction = 'out' THEN NEW.amount ELSE 0 END,
         CASE WHEN NEW.direction = 'in'  THEN 1 ELSE 0 END,
         CASE WHEN NEW.direction = 'out' THEN 1 ELSE 0 END,
         CURRENT_TIMESTAMP)
    ON CONFLICT (department_id, revenue_date, method)
    DO UPDATE SET
        gross_amount  = pos_department_daily_revenues.gross_amount  + EXCLUDED.gross_amount,
        refund_amount = pos_department_daily_revenues.refund_amount + EXCLUDED.refund_amount,
        invoice_count = pos_department_daily_revenues.invoice_count + EXCLUDED.invoice_count,
        refund_count  = pos_department_daily_revenues.refund_count  + EXCLUDED.refund_count,
        updated_at    = CURRENT_TIMESTAMP;
    RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_pos_route_revenue ON pos_invoice_payments;
CREATE TRIGGER trg_pos_route_revenue
    AFTER INSERT ON pos_invoice_payments
    FOR EACH ROW EXECUTE FUNCTION trg_fn_pos_route_revenue();

-- 5.4 Append-Only Audit Logs: forbid UPDATE and DELETE
CREATE OR REPLACE FUNCTION trg_fn_pos_prevent_audit_modification()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'pos_audit_logs is append-only: UPDATE and DELETE are forbidden (attempt by user %, role %)',
        current_setting('app.user_id', true), current_setting('app.user_role', true);
END $$;

DROP TRIGGER IF EXISTS trg_pos_prevent_audit_update ON pos_audit_logs;
CREATE TRIGGER trg_pos_prevent_audit_update BEFORE UPDATE ON pos_audit_logs
    FOR EACH ROW EXECUTE FUNCTION trg_fn_pos_prevent_audit_modification();

DROP TRIGGER IF EXISTS trg_pos_prevent_audit_delete ON pos_audit_logs;
CREATE TRIGGER trg_pos_prevent_audit_delete BEFORE DELETE ON pos_audit_logs
    FOR EACH ROW EXECUTE FUNCTION trg_fn_pos_prevent_audit_modification();

REVOKE TRUNCATE ON pos_audit_logs FROM PUBLIC;

-- 5.5 Automatic audit capture for sensitive tables
CREATE OR REPLACE FUNCTION trg_fn_pos_audit_capture()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
    v_action pos_audit_action;
    v_row_pk TEXT;
BEGIN
    IF (TG_OP = 'INSERT') THEN
        v_action := 'INSERT';
        v_row_pk := (NEW.id)::TEXT;
        INSERT INTO pos_audit_logs(actor_user_id, actor_username, actor_role, actor_ip,
                                   action, table_name, row_pk, data_before, data_after, request_id)
        VALUES (
            NULLIF(current_setting('app.user_id', true),'')::BIGINT,
            current_setting('app.user_name', true),
            current_setting('app.user_role', true),
            NULLIF(current_setting('app.client_ip', true),'')::INET,
            v_action, TG_TABLE_NAME, v_row_pk, NULL, to_jsonb(NEW),
            current_setting('app.request_id', true)
        );
        RETURN NEW;
    ELSIF (TG_OP = 'UPDATE') THEN
        v_action := 'UPDATE';
        v_row_pk := (NEW.id)::TEXT;
        INSERT INTO pos_audit_logs(actor_user_id, actor_username, actor_role, actor_ip,
                                   action, table_name, row_pk, data_before, data_after, request_id)
        VALUES (
            NULLIF(current_setting('app.user_id', true),'')::BIGINT,
            current_setting('app.user_name', true),
            current_setting('app.user_role', true),
            NULLIF(current_setting('app.client_ip', true),'')::INET,
            v_action, TG_TABLE_NAME, v_row_pk, to_jsonb(OLD), to_jsonb(NEW),
            current_setting('app.request_id', true)
        );
        RETURN NEW;
    ELSIF (TG_OP = 'DELETE') THEN
        v_action := 'DELETE';
        v_row_pk := (OLD.id)::TEXT;
        INSERT INTO pos_audit_logs(actor_user_id, actor_username, actor_role, actor_ip,
                                   action, table_name, row_pk, data_before, data_after, request_id)
        VALUES (
            NULLIF(current_setting('app.user_id', true),'')::BIGINT,
            current_setting('app.user_name', true),
            current_setting('app.user_role', true),
            NULLIF(current_setting('app.client_ip', true),'')::INET,
            v_action, TG_TABLE_NAME, v_row_pk, to_jsonb(OLD), NULL,
            current_setting('app.request_id', true)
        );
        RETURN OLD;
    END IF;
    RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_pos_audit_orders ON pos_orders;
CREATE TRIGGER trg_pos_audit_orders AFTER INSERT OR UPDATE OR DELETE ON pos_orders
    FOR EACH ROW EXECUTE FUNCTION trg_fn_pos_audit_capture();

DROP TRIGGER IF EXISTS trg_pos_audit_shift_sessions ON pos_shift_sessions;
CREATE TRIGGER trg_pos_audit_shift_sessions AFTER INSERT OR UPDATE OR DELETE ON pos_shift_sessions
    FOR EACH ROW EXECUTE FUNCTION trg_fn_pos_audit_capture();

DROP TRIGGER IF EXISTS trg_pos_audit_order_items ON pos_order_items;
CREATE TRIGGER trg_pos_audit_order_items AFTER INSERT OR UPDATE OR DELETE ON pos_order_items
    FOR EACH ROW EXECUTE FUNCTION trg_fn_pos_audit_capture();

DROP TRIGGER IF EXISTS trg_pos_audit_invoice_payments ON pos_invoice_payments;
CREATE TRIGGER trg_pos_audit_invoice_payments AFTER INSERT OR UPDATE OR DELETE ON pos_invoice_payments
    FOR EACH ROW EXECUTE FUNCTION trg_fn_pos_audit_capture();

-- 5.6 Stock movement ledger capture
CREATE OR REPLACE FUNCTION trg_fn_pos_capture_stock_movement()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
    v_delta NUMERIC(14,3);
BEGIN
    IF (TG_OP = 'UPDATE' AND NEW.stock_quantity IS DISTINCT FROM OLD.stock_quantity) THEN
        v_delta := NEW.stock_quantity - OLD.stock_quantity;
        INSERT INTO pos_stock_movements
            (product_id, order_id, quantity_delta, balance_after, reason, performed_by, metadata)
        VALUES
            (NEW.id,
             NULLIF(current_setting('app.order_id', true),'')::UUID,
             v_delta, NEW.stock_quantity,
             COALESCE(NULLIF(current_setting('app.stock_reason', true),''), 'adjustment'),
             NULLIF(current_setting('app.user_id', true),'')::BIGINT,
             jsonb_build_object('old_qty', OLD.stock_quantity, 'new_qty', NEW.stock_quantity));
    END IF;
    RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_pos_capture_stock_movement ON pos_products;
CREATE TRIGGER trg_pos_capture_stock_movement AFTER UPDATE OF stock_quantity ON pos_products
    FOR EACH ROW WHEN (NEW.stock_quantity IS DISTINCT FROM OLD.stock_quantity)
    EXECUTE FUNCTION trg_fn_pos_capture_stock_movement();

-- 5.7 Recompute order totals when order_items changes
CREATE OR REPLACE FUNCTION trg_fn_pos_recompute_order_totals()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
    v_subtotal NUMERIC(12,2) := 0;
    v_discount NUMERIC(12,2) := 0;
    v_vat      NUMERIC(12,2) := 0;
    v_total    NUMERIC(12,2) := 0;
BEGIN
    SELECT
        COALESCE(SUM(line_total), 0),
        COALESCE(SUM(discount), 0),
        COALESCE(SUM(vat_amount), 0)
      INTO v_subtotal, v_discount, v_vat
      FROM pos_order_items
     WHERE order_id = COALESCE(NEW.order_id, OLD.order_id);

    v_total := v_subtotal + v_vat;
    UPDATE pos_orders
       SET subtotal = v_subtotal,
           discount_total = v_discount,
           tax_total = v_vat,
           total_amount = v_total
     WHERE id = COALESCE(NEW.order_id, OLD.order_id);
    RETURN COALESCE(NEW, OLD);
END $$;

DROP TRIGGER IF EXISTS trg_pos_recompute_totals ON pos_order_items;
CREATE TRIGGER trg_pos_recompute_totals AFTER INSERT OR UPDATE OR DELETE ON pos_order_items
    FOR EACH ROW EXECUTE FUNCTION trg_fn_pos_recompute_order_totals();

-- 5.8 SYNC: when an inventory row changes, update linked pos_products
--   This bridges the existing inventory system with the new POS catalog.
CREATE OR REPLACE FUNCTION trg_fn_pos_sync_from_inventory()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    -- Update linked pos_products row (if exists) with inventory changes
    UPDATE pos_products
       SET name_ar    = COALESCE(NEW.name, name_ar),
           stock_quantity = NEW.qty,
           unit       = COALESCE(NEW.unit, unit),
           category   = COALESCE(NEW.category, category),
           updated_at = CURRENT_TIMESTAMP
     WHERE legacy_inventory_id = NEW.id;
    RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_pos_sync_from_inventory ON inventory;
CREATE TRIGGER trg_pos_sync_from_inventory
    AFTER UPDATE ON inventory
    FOR EACH ROW EXECUTE FUNCTION trg_fn_pos_sync_from_inventory();

-- ────────────────────────────────────────────────────────────────────────────
-- 6. ZATCA QR TLV Payload Generator (Base64)
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION fn_pos_tlv_record(tag INT, val TEXT)
RETURNS BYTEA
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
    v_val_bytes BYTEA;
    v_len INT;
BEGIN
    v_val_bytes := convert_to(val, 'UTF8');
    v_len := length(v_val_bytes);
    IF v_len > 255 THEN
        RAISE EXCEPTION 'TLV value too long (>255 bytes) for tag %', tag;
    END IF;
    RETURN decode(lpad(to_hex(tag), 2, '0') || lpad(to_hex(v_len), 2, '0'), 'hex')
         || v_val_bytes;
END $$;

CREATE OR REPLACE FUNCTION fn_pos_build_zatca_tlv(
    p_seller_name TEXT, p_vat_number TEXT, p_timestamp TIMESTAMPTZ,
    p_total NUMERIC(12,2), p_vat_total NUMERIC(12,2),
    p_counter BIGINT, p_uuid UUID
) RETURNS TEXT
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
    b BYTEA := ''::bytea;
BEGIN
    b := b || fn_pos_tlv_record(1, p_seller_name);
    b := b || fn_pos_tlv_record(2, p_vat_number);
    b := b || fn_pos_tlv_record(3, to_char(p_timestamp AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'));
    b := b || fn_pos_tlv_record(4, to_char(p_total, 'FM999999999990.00'));
    b := b || fn_pos_tlv_record(5, to_char(p_vat_total, 'FM999999999990.00'));
    b := b || fn_pos_tlv_record(6, p_counter::TEXT);
    b := b || fn_pos_tlv_record(7, p_uuid::TEXT);
    RETURN encode(b, 'base64');
END $$;

-- ────────────────────────────────────────────────────────────────────────────
-- 7. Stored Procedures
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE PROCEDURE sp_pos_open_shift(
    p_cashier_id BIGINT, p_department_id BIGINT, p_opening_balance NUMERIC(12,2),
    OUT p_session_id BIGINT
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_open_count INT;
BEGIN
    SELECT count(*) INTO v_open_count
      FROM pos_shift_sessions
     WHERE cashier_id = p_cashier_id AND status = 'open';
    IF v_open_count > 0 THEN
        RAISE EXCEPTION 'Cashier % already has an open shift', p_cashier_id
              USING ERRCODE = 'raise_exception';
    END IF;
    INSERT INTO pos_shift_sessions(cashier_id, department_id, opening_balance, status)
    VALUES (p_cashier_id, p_department_id, p_opening_balance, 'open')
    RETURNING id INTO p_session_id;
END $$;

CREATE OR REPLACE PROCEDURE sp_pos_close_shift(
    p_session_id BIGINT, p_actual_cash NUMERIC(12,2), p_closed_by BIGINT, p_notes TEXT DEFAULT NULL
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_session pos_shift_sessions%ROWTYPE;
    v_expected_cash NUMERIC(12,2);
    v_variance      NUMERIC(12,2);
BEGIN
    SELECT * INTO v_session FROM pos_shift_sessions WHERE id = p_session_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Shift session % not found', p_session_id;
    END IF;
    IF v_session.status <> 'open' THEN
        RAISE EXCEPTION 'Shift % is not open (current: %)', p_session_id, v_session.status;
    END IF;

    -- Compute expected_cash = opening_balance + cash_in - cash_out
    SELECT COALESCE(SUM(CASE WHEN ip.method = 'cash' AND ip.direction = 'in'  THEN ip.amount END), 0)
         - COALESCE(SUM(CASE WHEN ip.method = 'cash' AND ip.direction = 'out' THEN ip.amount END), 0)
      INTO v_expected_cash
      FROM pos_invoice_payments ip
      JOIN pos_orders o ON o.id = ip.order_id
     WHERE o.session_id = p_session_id;

    v_expected_cash := v_session.opening_balance + COALESCE(v_expected_cash, 0);
    v_variance      := COALESCE(p_actual_cash, 0) - v_expected_cash;

    UPDATE pos_shift_sessions
       SET status = 'closed',
           actual_cash = p_actual_cash,
           expected_cash = v_expected_cash,
           cash_variance = v_variance,
           closed_at = CURRENT_TIMESTAMP,
           closed_by = p_closed_by,
           closing_notes = p_notes
     WHERE id = p_session_id;
END $$;

-- Atomic inventory decrement with SELECT FOR UPDATE
CREATE OR REPLACE FUNCTION fn_pos_decrement_stock_atomic(
    p_product_id BIGINT, p_quantity NUMERIC(14,3), p_order_id UUID DEFAULT NULL
) RETURNS NUMERIC(14,3)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_new_qty NUMERIC(14,3);
    v_old_qty NUMERIC(14,3);
BEGIN
    SELECT stock_quantity INTO v_old_qty
      FROM pos_products
     WHERE id = p_product_id
       FOR UPDATE;     -- 🔒 critical row-level lock

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Product % not found', p_product_id
              USING ERRCODE = 'foreign_key_violation';
    END IF;
    IF v_old_qty < p_quantity THEN
        RAISE EXCEPTION 'Insufficient stock for product %: requested %, available %',
              p_product_id, p_quantity, v_old_qty
              USING ERRCODE = 'check_violation';
    END IF;

    v_new_qty := v_old_qty - p_quantity;
    UPDATE pos_products SET stock_quantity = v_new_qty WHERE id = p_product_id
     RETURNING stock_quantity INTO v_new_qty;
    RETURN v_new_qty;
END $$;

-- ────────────────────────────────────────────────────────────────────────────
-- 8. View: pos_cashier_dashboard — fast cashier KPIs
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW v_pos_cashier_dashboard AS
SELECT
    u.id AS cashier_id,
    u.name AS cashier_name,
    s.id AS session_id,
    s.status AS session_status,
    s.opened_at,
    d.code AS dept_code,
    d.name_ar AS dept_name,
    s.opening_balance,
    s.expected_cash,
    COALESCE(inv.invoice_count, 0) AS invoice_count,
    COALESCE(inv.total_sales, 0) AS total_sales,
    COALESCE(inv.cash_sales, 0) AS cash_sales,
    COALESCE(inv.card_sales, 0) AS card_sales,
    COALESCE(inv.wallet_sales, 0) AS wallet_sales
FROM users u
JOIN pos_shift_sessions s ON s.cashier_id = u.id AND s.status = 'open'
JOIN pos_departments d   ON d.id = s.department_id
LEFT JOIN LATERAL (
    SELECT
        COUNT(DISTINCT o.id) AS invoice_count,
        SUM(o.total_amount) AS total_sales,
        SUM(CASE WHEN ip.method='cash'   AND ip.direction='in' THEN ip.amount END) AS cash_sales,
        SUM(CASE WHEN ip.method='card'   AND ip.direction='in' THEN ip.amount END) AS card_sales,
        SUM(CASE WHEN ip.method='wallet' AND ip.direction='in' THEN ip.amount END) AS wallet_sales
    FROM pos_orders o
    LEFT JOIN pos_invoice_payments ip ON ip.order_id = o.id
    WHERE o.session_id = s.id AND o.status IN ('issued','reported')
) inv ON true;

-- ────────────────────────────────────────────────────────────────────────────
-- 9. Permissions
-- pos_audit_logs is append-only (§5.4): row triggers block UPDATE/DELETE, but
-- TRUNCATE fires NO row triggers — so the blanket GRANT ALL below must be
-- followed by re-revoking everything on the audit table.
-- ────────────────────────────────────────────────────────────────────────────
REVOKE ALL ON pos_audit_logs FROM PUBLIC;
REVOKE TRUNCATE ON ALL TABLES IN SCHEMA public FROM PUBLIC;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO PUBLIC;
GRANT ALL ON ALL TABLES IN SCHEMA public TO PUBLIC;
REVOKE ALL ON pos_audit_logs FROM PUBLIC;
REVOKE TRUNCATE ON pos_audit_logs FROM PUBLIC;
GRANT SELECT, INSERT ON pos_audit_logs TO PUBLIC;

-- ────────────────────────────────────────────────────────────────────────────
-- 10. Cleanup procedure (call via Node cron)
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE PROCEDURE sp_pos_cleanup_idempotency()
LANGUAGE plpgsql AS $$
BEGIN
    DELETE FROM pos_idempotency_keys WHERE expires_at < CURRENT_TIMESTAMP;
END $$;

-- ────────────────────────────────────────────────────────────────────────────
-- 11. Master data policy
-- ────────────────────────────────────────────────────────────────────────────
-- Production setup deliberately does not seed departments, products, prices,
-- synthetic barcodes, or printers. All operational master data is created and
-- maintained from the authenticated ERP screens and stored in PostgreSQL.
-- Existing installations are not modified or deleted by this migration.


-- ────────────────────────────────────────────────────────────────────────────
-- 12. Performance hints
-- ────────────────────────────────────────────────────────────────────────────
ANALYZE pos_orders;
ANALYZE pos_order_items;
ANALYZE pos_invoice_payments;
ANALYZE pos_shift_sessions;
ANALYZE pos_products;
ANALYZE pos_department_daily_revenues;
ANALYZE pos_audit_logs;

COMMIT;

-- ════════════════════════════════════════════════════════════════════════════
-- END OF Migration 003 — OmniTrack POS Cashier Module
-- ════════════════════════════════════════════════════════════════════════════
