-- مطاعم الشرفه العالمي v3.1.0 — signed dispatch workflow and flexible audit periods
-- Idempotent: preserves all existing dispatches, audits, quantities, and master data.
BEGIN;

ALTER TABLE dispatches ADD COLUMN IF NOT EXISTS "requestSignatureData" TEXT;
ALTER TABLE dispatches ADD COLUMN IF NOT EXISTS "requestSignatureHash" VARCHAR(128);
ALTER TABLE dispatches ADD COLUMN IF NOT EXISTS "requestedAt" TIMESTAMPTZ;
ALTER TABLE dispatches ADD COLUMN IF NOT EXISTS "warehouseApprovedAt" TIMESTAMPTZ;
ALTER TABLE dispatches ADD COLUMN IF NOT EXISTS "warehouseApprovedBy" VARCHAR(150);
ALTER TABLE dispatches ADD COLUMN IF NOT EXISTS "warehouseApprovalSignatureData" TEXT;
ALTER TABLE dispatches ADD COLUMN IF NOT EXISTS "warehouseApprovalSignatureHash" VARCHAR(128);
ALTER TABLE dispatches ADD COLUMN IF NOT EXISTS "warehouseRejectedAt" TIMESTAMPTZ;
ALTER TABLE dispatches ADD COLUMN IF NOT EXISTS "warehouseRejectedBy" VARCHAR(150);
ALTER TABLE dispatches ADD COLUMN IF NOT EXISTS "warehouseRejectionSignatureData" TEXT;
ALTER TABLE dispatches ADD COLUMN IF NOT EXISTS "warehouseRejectionSignatureHash" VARCHAR(128);
ALTER TABLE dispatches ADD COLUMN IF NOT EXISTS "kitchenReceivedAt" TIMESTAMPTZ;
ALTER TABLE dispatches ADD COLUMN IF NOT EXISTS "kitchenReceivedBy" VARCHAR(150);
ALTER TABLE dispatches ADD COLUMN IF NOT EXISTS "kitchenReceiptSignatureData" TEXT;
ALTER TABLE dispatches ADD COLUMN IF NOT EXISTS "kitchenReceiptSignatureHash" VARCHAR(128);
ALTER TABLE dispatches ADD COLUMN IF NOT EXISTS "receivedItems" JSONB;
ALTER TABLE dispatches ADD COLUMN IF NOT EXISTS "receiptNotes" TEXT;
ALTER TABLE dispatches ADD COLUMN IF NOT EXISTS "closedAt" TIMESTAMPTZ;
ALTER TABLE dispatches ADD COLUMN IF NOT EXISTS "closedBy" VARCHAR(150);
ALTER TABLE dispatches ADD COLUMN IF NOT EXISTS "lastEventHash" VARCHAR(128);

CREATE TABLE IF NOT EXISTS dispatch_workflow_events (
    id BIGSERIAL PRIMARY KEY,
    dispatch_id BIGINT NOT NULL REFERENCES dispatches(id) ON DELETE CASCADE,
    event_type VARCHAR(40) NOT NULL,
    from_status VARCHAR(50),
    to_status VARCHAR(50) NOT NULL,
    actor_user_id BIGINT,
    actor_name VARCHAR(150),
    actor_role VARCHAR(50),
    signature_hash VARCHAR(128),
    event_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    previous_event_hash VARCHAR(128),
    event_hash VARCHAR(128) NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_dispatch_workflow_events_dispatch ON dispatch_workflow_events(dispatch_id, created_at);
CREATE INDEX IF NOT EXISTS idx_dispatch_workflow_events_type ON dispatch_workflow_events(event_type, created_at);

-- The kitchen module must be installable from migrations alone.  Earlier
-- releases lazily created these tables at request time, which made a clean
-- installation fail before the kitchen routes were first opened.
CREATE TABLE IF NOT EXISTS kitchen_policies (
    id BIGSERIAL PRIMARY KEY,
    department_id BIGINT NOT NULL UNIQUE,
    kitchen_location_id BIGINT NOT NULL,
    operation_mode VARCHAR(20) NOT NULL DEFAULT 'monitor' CHECK(operation_mode IN ('flexible','monitor','strict')),
    allow_fallback BOOLEAN NOT NULL DEFAULT TRUE,
    require_reason BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS kitchen_production_batches (
    id BIGSERIAL PRIMARY KEY,
    product_id BIGINT NOT NULL,
    location_id BIGINT NOT NULL,
    planned_qty NUMERIC(14,4) NOT NULL DEFAULT 0,
    produced_qty NUMERIC(14,4) NOT NULL DEFAULT 0,
    remaining_qty NUMERIC(14,4) NOT NULL DEFAULT 0,
    consumed_qty NUMERIC(14,4) NOT NULL DEFAULT 0,
    status VARCHAR(20) NOT NULL DEFAULT 'open' CHECK(status IN ('draft','open','closed','cancelled')),
    notes TEXT,
    created_by BIGINT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    closed_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS kitchen_production_events (
    id BIGSERIAL PRIMARY KEY,
    batch_id BIGINT NOT NULL,
    event_type VARCHAR(30) NOT NULL,
    quantity NUMERIC(14,4) NOT NULL DEFAULT 0,
    reason TEXT,
    actor_user_id BIGINT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS kitchen_exceptions (
    id BIGSERIAL PRIMARY KEY,
    order_id VARCHAR(120),
    product_id BIGINT,
    department_id BIGINT,
    quantity NUMERIC(14,4) NOT NULL DEFAULT 0,
    operation_mode VARCHAR(20) NOT NULL,
    reason TEXT NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'open',
    created_by BIGINT,
    reviewed_by BIGINT,
    reviewed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS kitchen_audits (
    id BIGSERIAL PRIMARY KEY,
    audit_number VARCHAR(80) NOT NULL UNIQUE,
    period VARCHAR(20) NOT NULL DEFAULT 'weekly' CHECK(period IN ('weekly','monthly')),
    location_id BIGINT NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','submitted','approved','rejected')),
    counted_at TIMESTAMPTZ,
    submitted_at TIMESTAMPTZ,
    approved_at TIMESTAMPTZ,
    created_by BIGINT,
    approved_by BIGINT,
    notes TEXT,
    total_items INTEGER NOT NULL DEFAULT 0,
    total_variance_value NUMERIC(14,2) NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS kitchen_audit_items (
    id BIGSERIAL PRIMARY KEY,
    audit_id BIGINT NOT NULL REFERENCES kitchen_audits(id) ON DELETE CASCADE,
    inventory_id BIGINT NOT NULL,
    system_qty NUMERIC(14,4) NOT NULL DEFAULT 0,
    counted_qty NUMERIC(14,4) NOT NULL DEFAULT 0,
    variance_qty NUMERIC(14,4) NOT NULL DEFAULT 0,
    notes TEXT,
    UNIQUE(audit_id, inventory_id)
);
CREATE INDEX IF NOT EXISTS idx_kitchen_batches_available ON kitchen_production_batches(product_id, location_id, status, remaining_qty);
CREATE INDEX IF NOT EXISTS idx_kitchen_exceptions_open ON kitchen_exceptions(status, created_at DESC);

ALTER TABLE kitchen_audits ADD COLUMN IF NOT EXISTS period_start DATE;
ALTER TABLE kitchen_audits ADD COLUMN IF NOT EXISTS period_end DATE;
ALTER TABLE kitchen_audits ADD COLUMN IF NOT EXISTS counted_by BIGINT;
ALTER TABLE kitchen_audits ADD COLUMN IF NOT EXISTS count_signature_data TEXT;
ALTER TABLE kitchen_audits ADD COLUMN IF NOT EXISTS count_signature_hash VARCHAR(128);
ALTER TABLE kitchen_audits ADD COLUMN IF NOT EXISTS submitted_by BIGINT;
ALTER TABLE kitchen_audits ADD COLUMN IF NOT EXISTS submit_signature_data TEXT;
ALTER TABLE kitchen_audits ADD COLUMN IF NOT EXISTS submit_signature_hash VARCHAR(128);
ALTER TABLE kitchen_audits ADD COLUMN IF NOT EXISTS approved_signature_data TEXT;
ALTER TABLE kitchen_audits ADD COLUMN IF NOT EXISTS approved_signature_hash VARCHAR(128);
ALTER TABLE kitchen_audits DROP CONSTRAINT IF EXISTS kitchen_audits_period_check;
ALTER TABLE kitchen_audits ADD CONSTRAINT kitchen_audits_period_check CHECK(period IN ('daily','weekly','monthly','custom','annual'));

CREATE TABLE IF NOT EXISTS kitchen_audit_workflow_events (
    id BIGSERIAL PRIMARY KEY,
    audit_id BIGINT NOT NULL REFERENCES kitchen_audits(id) ON DELETE CASCADE,
    event_type VARCHAR(40) NOT NULL,
    from_status VARCHAR(30),
    to_status VARCHAR(30) NOT NULL,
    actor_user_id BIGINT,
    actor_role VARCHAR(50),
    signature_hash VARCHAR(128),
    event_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    previous_event_hash VARCHAR(128),
    event_hash VARCHAR(128) NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_kitchen_audit_events_audit ON kitchen_audit_workflow_events(audit_id, created_at);

ALTER TABLE inventory_audits ADD COLUMN IF NOT EXISTS period_type VARCHAR(20) NOT NULL DEFAULT 'custom';
ALTER TABLE inventory_audits ADD COLUMN IF NOT EXISTS period_start DATE;
ALTER TABLE inventory_audits ADD COLUMN IF NOT EXISTS period_end DATE;
ALTER TABLE inventory_audits ADD COLUMN IF NOT EXISTS count_signature_data TEXT;
ALTER TABLE inventory_audits ADD COLUMN IF NOT EXISTS count_signature_hash VARCHAR(128);
ALTER TABLE inventory_audits ADD COLUMN IF NOT EXISTS approval_signature_data TEXT;
ALTER TABLE inventory_audits ADD COLUMN IF NOT EXISTS approval_signature_hash VARCHAR(128);
ALTER TABLE inventory_audits DROP CONSTRAINT IF EXISTS inventory_audits_period_type_check;
ALTER TABLE inventory_audits ADD CONSTRAINT inventory_audits_period_type_check CHECK(period_type IN ('daily','weekly','monthly','custom','annual'));

CREATE TABLE IF NOT EXISTS inventory_audit_workflow_events (
    id BIGSERIAL PRIMARY KEY,
    audit_id BIGINT NOT NULL REFERENCES inventory_audits(id) ON DELETE CASCADE,
    event_type VARCHAR(40) NOT NULL,
    from_status VARCHAR(30),
    to_status VARCHAR(30) NOT NULL,
    actor_user_id BIGINT,
    actor_role VARCHAR(50),
    signature_hash VARCHAR(128),
    event_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    previous_event_hash VARCHAR(128),
    event_hash VARCHAR(128) NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_inventory_audit_events_audit ON inventory_audit_workflow_events(audit_id, created_at);

COMMIT;
