-- Migration 013: Hide legacy ingredient SKUs from restaurant cashier
-- Migration 009 intentionally cleared legacy_inventory_id, so identify the
-- old auto-synced rows by their synthetic non-MENU barcode format.

BEGIN;

UPDATE pos_products
   SET is_active = false,
       metadata = COALESCE(metadata, '{}'::jsonb)
           || jsonb_build_object('catalog_scope', 'ingredient', 'managed_in', 'inventory', 'hidden_reason', 'restaurant_menu_migration'),
       updated_at = CURRENT_TIMESTAMP
 WHERE barcode NOT LIKE 'MENU-%'
   AND COALESCE(metadata->>'catalog_scope', '') <> 'menu';

COMMIT;
