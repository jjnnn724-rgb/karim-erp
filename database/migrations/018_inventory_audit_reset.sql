-- Karim ERP v3.1.0 — Inventory audit and safe reset
-- Idempotent migration; preserves master/catalog data and adds only audit infrastructure.
BEGIN;

CREATE TABLE IF NOT EXISTS inventory_audits (
    id BIGINT PRIMARY KEY,
    audit_number VARCHAR(80) NOT NULL UNIQUE,
    status VARCHAR(30) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','submitted','approved','cancelled')),
    warehouse_scope VARCHAR(80) NOT NULL DEFAULT 'main',
    counted_at VARCHAR(50) NOT NULL,
    submitted_at VARCHAR(50),
    approved_at VARCHAR(50),
    created_by VARCHAR(100) NOT NULL,
    approved_by VARCHAR(100),
    notes TEXT,
    total_items INT NOT NULL DEFAULT 0,
    total_variance_value NUMERIC(14,2) NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS inventory_audit_items (
    id BIGINT PRIMARY KEY,
    audit_id BIGINT NOT NULL REFERENCES inventory_audits(id) ON DELETE CASCADE,
    item_id BIGINT NOT NULL REFERENCES inventory(id) ON DELETE RESTRICT,
    item_name VARCHAR(255) NOT NULL,
    unit VARCHAR(50),
    system_qty NUMERIC(14,3) NOT NULL DEFAULT 0,
    counted_qty NUMERIC(14,3) NOT NULL DEFAULT 0,
    variance_qty NUMERIC(14,3) NOT NULL DEFAULT 0,
    avg_cost NUMERIC(14,2) NOT NULL DEFAULT 0,
    variance_value NUMERIC(14,2) NOT NULL DEFAULT 0,
    notes TEXT,
    UNIQUE (audit_id, item_id)
);

CREATE TABLE IF NOT EXISTS system_reset_audit (
    id BIGINT PRIMARY KEY,
    reset_number VARCHAR(80) NOT NULL UNIQUE,
    reset_type VARCHAR(50) NOT NULL DEFAULT 'operational_numbers',
    reason TEXT NOT NULL,
    confirmation_phrase VARCHAR(80) NOT NULL,
    actor_user_id BIGINT,
    actor_username VARCHAR(255) NOT NULL,
    actor_role VARCHAR(50) NOT NULL,
    snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
    reset_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_inventory_audits_status ON inventory_audits(status);
CREATE INDEX IF NOT EXISTS idx_inventory_audits_counted_at ON inventory_audits(counted_at);
CREATE INDEX IF NOT EXISTS idx_inventory_audit_items_audit ON inventory_audit_items(audit_id);
CREATE INDEX IF NOT EXISTS idx_system_reset_audit_reset_at ON system_reset_audit(reset_at DESC);

COMMIT;
