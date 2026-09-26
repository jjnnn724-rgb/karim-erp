-- Migration 028: Ensure the kitchen has a real inventory location.
-- Safe and idempotent: never deletes or changes existing quantities.
BEGIN;

INSERT INTO inventory_locations (code, name_ar, location_type, active, negative_stock_policy, costing_policy, count_frequency_days)
VALUES ('KITCHEN-MAIN', 'مخزن المطبخ', 'kitchen', TRUE, 'deny', 'weighted_average', 7)
ON CONFLICT (code) DO UPDATE
SET active = TRUE,
    location_type = 'kitchen',
    updated_at = CURRENT_TIMESTAMP;

INSERT INTO inventory_location_balances (inventory_id, location_id, on_hand, reserved, in_transit, quarantined, expired)
SELECT i.id, l.id, 0, 0, 0, 0, 0
FROM inventory i
CROSS JOIN inventory_locations l
WHERE l.code = 'KITCHEN-MAIN'
  AND NOT EXISTS (
    SELECT 1 FROM inventory_location_balances b
    WHERE b.inventory_id = i.id AND b.location_id = l.id
  );

COMMIT;
