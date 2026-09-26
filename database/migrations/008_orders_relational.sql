-- =====================================================
-- Migration 008: Relational `orders` table (replaces JSON blob in app_state)
-- =====================================================
-- This migration creates a proper relational `orders` table with primary
-- key, foreign keys, and timestamps. It also creates `order_items` for
-- line items. The app_state JSON blob is NOT touched — it remains as a
-- fallback until app.js is fully migrated, but NEW orders are written
-- here exclusively.
--
-- Idempotent: uses CREATE TABLE IF NOT EXISTS.
-- =====================================================

-- ─── orders ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS orders (
    id              BIGINT PRIMARY KEY,
    order_number    VARCHAR(64) UNIQUE,
    table_id        BIGINT,
    department_code VARCHAR(50),
    status          VARCHAR(50) NOT NULL DEFAULT 'open',  -- open | sent | preparing | served | paid | cancelled
    type            VARCHAR(50) NOT NULL DEFAULT 'dine_in', -- dine_in | takeaway | delivery
    customer_name   VARCHAR(255),
    customer_phone  VARCHAR(50),
    notes           TEXT,
    subtotal        NUMERIC(12,2) NOT NULL DEFAULT 0,
    discount        NUMERIC(12,2) NOT NULL DEFAULT 0,
    tax             NUMERIC(12,2) NOT NULL DEFAULT 0,
    total           NUMERIC(12,2) NOT NULL DEFAULT 0,
    payment_method  VARCHAR(50),
    payment_status  VARCHAR(50) NOT NULL DEFAULT 'unpaid', -- unpaid | partial | paid
    cashier_id      BIGINT,
    waiter_name     VARCHAR(255),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    closed_at       TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_orders_status       ON orders (status);
CREATE INDEX IF NOT EXISTS idx_orders_created_at   ON orders (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_department   ON orders (department_code);
CREATE INDEX IF NOT EXISTS idx_orders_table        ON orders (table_id);
CREATE INDEX IF NOT EXISTS idx_orders_cashier      ON orders (cashier_id);

-- ─── order_items (line items) ───────────────────────────
CREATE TABLE IF NOT EXISTS order_items (
    id           BIGINT PRIMARY KEY,
    order_id     BIGINT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    product_name VARCHAR(255) NOT NULL,                -- snapshot of product name at time of sale
    product_id   BIGINT,                                -- nullable: allows ad-hoc items not in inventory
    inventory_id BIGINT,                                -- nullable: link to inventory for stock decrement
    quantity     NUMERIC(10,3) NOT NULL DEFAULT 1,
    unit_price   NUMERIC(12,2) NOT NULL DEFAULT 0,
    discount     NUMERIC(12,2) NOT NULL DEFAULT 0,
    total        NUMERIC(12,2) NOT NULL DEFAULT 0,
    notes        TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_order_items_order    ON order_items (order_id);
CREATE INDEX IF NOT EXISTS idx_order_items_product  ON order_items (product_id);
CREATE INDEX IF NOT EXISTS idx_order_items_inv      ON order_items (inventory_id);

COMMENT ON TABLE orders IS 'Relational orders table (replaces the JSON blob in app_state for the orders module). Accepts ad-hoc items (product_id IS NULL) per the flexible-invoice requirement.';
COMMENT ON TABLE order_items IS 'Line items for orders. product_id is nullable so the invoice can include items NOT in inventory.';

-- ─── trigger: updated_at ────────────────────────────────
CREATE OR REPLACE FUNCTION trg_orders_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS orders_set_updated_at ON orders;
CREATE TRIGGER orders_set_updated_at
    BEFORE UPDATE ON orders
    FOR EACH ROW
    EXECUTE FUNCTION trg_orders_set_updated_at();
