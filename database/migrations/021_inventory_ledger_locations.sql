-- Migration 021: World-class inventory ledger and multi-location foundation
-- PostgreSQL remains the single source of truth. Existing inventory.qty is
-- preserved as a compatibility projection while all new controlled postings
-- are recorded in the immutable ledger.
BEGIN;

CREATE TABLE IF NOT EXISTS inventory_locations (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    code VARCHAR(80) NOT NULL UNIQUE,
    name_ar VARCHAR(255) NOT NULL,
    location_type VARCHAR(40) NOT NULL DEFAULT 'warehouse'
        CHECK (location_type IN ('warehouse','kitchen','production','pos','buffet','bar','return','waste','transit')),
    department_code VARCHAR(50) REFERENCES departments(code) ON DELETE SET NULL,
    cost_center VARCHAR(80),
    manager_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
    active BOOLEAN NOT NULL DEFAULT true,
    negative_stock_policy VARCHAR(20) NOT NULL DEFAULT 'deny'
        CHECK (negative_stock_policy IN ('deny','allow','approval')),
    costing_policy VARCHAR(30) NOT NULL DEFAULT 'weighted_average'
        CHECK (costing_policy IN ('fifo','fefo','weighted_average','standard_cost')),
    count_frequency_days INTEGER NOT NULL DEFAULT 30 CHECK (count_frequency_days > 0),
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS inventory_ledger (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    transaction_id UUID NOT NULL DEFAULT gen_random_uuid(),
    transaction_type VARCHAR(40) NOT NULL CHECK (transaction_type IN (
        'opening_balance','purchase_receipt','transfer_out','transfer_in',
        'sale_consumption','production_consumption','production_output','waste',
        'return','adjustment','count_correction','reversal','receiving_variance',
        'other_approved_movement'
    )),
    inventory_id BIGINT NOT NULL REFERENCES inventory(id) ON DELETE RESTRICT,
    location_id BIGINT NOT NULL REFERENCES inventory_locations(id) ON DELETE RESTRICT,
    quantity_delta NUMERIC(14,4) NOT NULL,
    unit VARCHAR(50) NOT NULL,
    unit_cost NUMERIC(14,4) NOT NULL DEFAULT 0,
    total_cost NUMERIC(16,4) NOT NULL DEFAULT 0,
    batch_id BIGINT,
    lot_number VARCHAR(120),
    expiry_date DATE,
    source_location_id BIGINT REFERENCES inventory_locations(id) ON DELETE RESTRICT,
    destination_location_id BIGINT REFERENCES inventory_locations(id) ON DELETE RESTRICT,
    reference_type VARCHAR(80),
    reference_id VARCHAR(160),
    business_date DATE NOT NULL DEFAULT CURRENT_DATE,
    shift_id BIGINT,
    user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
    correlation_id UUID,
    idempotency_key VARCHAR(180),
    reason TEXT,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT inventory_ledger_idempotency_unique UNIQUE (idempotency_key),
    CONSTRAINT inventory_ledger_nonzero_delta CHECK (quantity_delta <> 0)
);

ALTER TABLE pos_departments ADD COLUMN IF NOT EXISTS location_id BIGINT;

CREATE TABLE IF NOT EXISTS inventory_location_balances (
    inventory_id BIGINT NOT NULL REFERENCES inventory(id) ON DELETE RESTRICT,
    location_id BIGINT NOT NULL REFERENCES inventory_locations(id) ON DELETE RESTRICT,
    on_hand NUMERIC(14,4) NOT NULL DEFAULT 0,
    reserved NUMERIC(14,4) NOT NULL DEFAULT 0,
    in_transit NUMERIC(14,4) NOT NULL DEFAULT 0,
    quarantined NUMERIC(14,4) NOT NULL DEFAULT 0,
    expired NUMERIC(14,4) NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (inventory_id, location_id),
    CONSTRAINT inventory_balance_nonnegative_reserved CHECK (reserved >= 0),
    CONSTRAINT inventory_balance_nonnegative_transit CHECK (in_transit >= 0)
);

CREATE INDEX IF NOT EXISTS idx_inventory_ledger_item_location_created
    ON inventory_ledger(inventory_id, location_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inventory_ledger_reference
    ON inventory_ledger(reference_type, reference_id);
CREATE INDEX IF NOT EXISTS idx_inventory_ledger_business_date
    ON inventory_ledger(business_date, transaction_type);
CREATE INDEX IF NOT EXISTS idx_inventory_locations_active
    ON inventory_locations(active, location_type);

INSERT INTO inventory_locations (code, name_ar, location_type, costing_policy)
VALUES ('MAIN-WAREHOUSE', 'المخزن الرئيسي', 'warehouse', 'weighted_average')
ON CONFLICT (code) DO NOTHING;

-- Backfill the current operational quantity as a traceable opening balance.
INSERT INTO inventory_locations (code, name_ar, location_type, costing_policy)
SELECT 'POS-' || d.code, d.name_ar, 'pos', 'weighted_average'
  FROM pos_departments d
ON CONFLICT (code) DO NOTHING;

UPDATE pos_departments d
   SET location_id = l.id
  FROM inventory_locations l
 WHERE l.code = 'POS-' || d.code
   AND d.location_id IS NULL;

INSERT INTO inventory_location_balances (inventory_id, location_id, on_hand)
SELECT i.id, l.id, COALESCE(i.qty, 0)
  FROM inventory i CROSS JOIN inventory_locations l
 WHERE l.code = 'MAIN-WAREHOUSE'
ON CONFLICT (inventory_id, location_id) DO NOTHING;

INSERT INTO inventory_ledger (
    transaction_type, inventory_id, location_id, quantity_delta, unit,
    unit_cost, total_cost, reference_type, reference_id, reason, metadata
)
SELECT 'opening_balance', i.id, l.id, COALESCE(i.qty, 0), COALESCE(i.unit, 'وحدة'),
       COALESCE(i."avgCost", 0), COALESCE(i.qty, 0) * COALESCE(i."avgCost", 0),
       'migration', '021_inventory_ledger_locations', 'ترحيل الرصيد الحالي إلى دفتر المخزون',
       jsonb_build_object('source', 'inventory.qty', 'migration', '021')
  FROM inventory i CROSS JOIN inventory_locations l
 WHERE l.code = 'MAIN-WAREHOUSE'
   AND COALESCE(i.qty, 0) <> 0
   AND NOT EXISTS (
       SELECT 1 FROM inventory_ledger x
        WHERE x.inventory_id = i.id
          AND x.location_id = l.id
          AND x.transaction_type = 'opening_balance'
          AND x.reference_id = '021_inventory_ledger_locations'
   );

COMMENT ON TABLE inventory_ledger IS 'Immutable stock movement ledger. Corrections use reversal/correction entries; balances are projections.';
COMMENT ON TABLE inventory_location_balances IS 'Per-item per-location projection: on_hand, reserved, in_transit, quarantined and expired.';
COMMENT ON TABLE inventory_locations IS 'Operational stock locations and their inventory/costing policies.';
COMMIT;
