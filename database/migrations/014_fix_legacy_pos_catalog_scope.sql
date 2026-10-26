-- Migration 014: Correct legacy POS catalog scope
BEGIN;

UPDATE pos_products
   SET is_active = false,
       metadata = COALESCE(metadata, '{}'::jsonb)
           || jsonb_build_object('catalog_scope', 'ingredient', 'managed_in', 'inventory', 'hidden_reason', 'legacy_sku_cleanup'),
       updated_at = CURRENT_TIMESTAMP
 WHERE barcode IS NULL OR barcode NOT LIKE 'MENU-%';

COMMIT;
