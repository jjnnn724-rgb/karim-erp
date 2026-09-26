BEGIN;

-- فصل منيو الكاشير عن المخزن:
-- 1) إيقاف أي مزامنة تلقائية من inventory -> pos_products
-- 2) فك الربط القديم legacy_inventory_id حتى تصبح منتجات الكاشير مستقلة
-- 3) وسم المنتجات الحالية بأنها "menu" ومدارة من شاشة POS

DROP TRIGGER IF EXISTS trg_pos_sync_from_inventory ON inventory;
DROP FUNCTION IF EXISTS trg_fn_pos_sync_from_inventory();

UPDATE pos_products
   SET legacy_inventory_id = NULL,
       metadata = COALESCE(metadata, '{}'::jsonb)
           || jsonb_build_object('catalog_scope', 'menu', 'managed_in', 'pos'),
       updated_at = CURRENT_TIMESTAMP;

COMMIT;
