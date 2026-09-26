-- Migration 022: Transfer, receiving and reconciliation workflow
BEGIN;

CREATE TABLE IF NOT EXISTS inventory_transfers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    transfer_number VARCHAR(80) NOT NULL UNIQUE,
    status VARCHAR(35) NOT NULL DEFAULT 'draft' CHECK (status IN (
        'draft','requested','approved','reserved','picking','picked','dispatched',
        'in_transit','received','partially_received','reconciliation_required',
        'reconciled','rejected','cancelled','reversed'
    )),
    source_location_id BIGINT NOT NULL REFERENCES inventory_locations(id) ON DELETE RESTRICT,
    destination_location_id BIGINT NOT NULL REFERENCES inventory_locations(id) ON DELETE RESTRICT,
    requested_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
    approved_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
    picked_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
    dispatched_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
    received_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
    requested_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    approved_at TIMESTAMPTZ,
    dispatched_at TIMESTAMPTZ,
    received_at TIMESTAMPTZ,
    reconciled_at TIMESTAMPTZ,
    business_date DATE NOT NULL DEFAULT CURRENT_DATE,
    notes TEXT,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT transfer_locations_different CHECK (source_location_id <> destination_location_id)
);

CREATE TABLE IF NOT EXISTS inventory_transfer_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    transfer_id UUID NOT NULL REFERENCES inventory_transfers(id) ON DELETE RESTRICT,
    inventory_id BIGINT NOT NULL REFERENCES inventory(id) ON DELETE RESTRICT,
    unit VARCHAR(50) NOT NULL DEFAULT 'وحدة',
    requested_qty NUMERIC(14,4) NOT NULL CHECK (requested_qty > 0),
    reserved_qty NUMERIC(14,4) NOT NULL DEFAULT 0 CHECK (reserved_qty >= 0),
    picked_qty NUMERIC(14,4) NOT NULL DEFAULT 0 CHECK (picked_qty >= 0),
    dispatched_qty NUMERIC(14,4) NOT NULL DEFAULT 0 CHECK (dispatched_qty >= 0),
    received_qty NUMERIC(14,4) NOT NULL DEFAULT 0 CHECK (received_qty >= 0),
    variance_qty NUMERIC(14,4) NOT NULL DEFAULT 0,
    unit_cost NUMERIC(14,4) NOT NULL DEFAULT 0,
    variance_reason TEXT,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (transfer_id, inventory_id)
);

CREATE TABLE IF NOT EXISTS inventory_transfer_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    transfer_id UUID NOT NULL REFERENCES inventory_transfers(id) ON DELETE RESTRICT,
    from_status VARCHAR(35),
    to_status VARCHAR(35) NOT NULL,
    actor_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
    reason TEXT,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_inventory_transfers_status_created
    ON inventory_transfers(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inventory_transfers_locations
    ON inventory_transfers(source_location_id, destination_location_id, status);
CREATE INDEX IF NOT EXISTS idx_inventory_transfer_items_transfer
    ON inventory_transfer_items(transfer_id);
CREATE INDEX IF NOT EXISTS idx_inventory_transfer_events_transfer
    ON inventory_transfer_events(transfer_id, created_at DESC);

COMMENT ON TABLE inventory_transfers IS 'Controlled transfer lifecycle: request, approval, reservation, dispatch, receiving and reconciliation.';
COMMENT ON TABLE inventory_transfer_events IS 'Immutable transfer state transition audit trail.';
COMMIT;
