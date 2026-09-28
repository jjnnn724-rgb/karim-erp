-- 069_inventory_search.sql — Smart inventory search: trgm + category/stock indexes
-- ────────────────────────────────────────────────────────────────────────────
-- Idempotent. Supports GET /api/warehouse/inventory/search (paginated,
-- server-side) so the items table stays fast with thousands of products.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_inventory_name_trgm
    ON inventory USING gin (name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_inventory_barcode
    ON inventory (barcode) WHERE barcode IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_inventory_category
    ON inventory (category);

CREATE INDEX IF NOT EXISTS idx_inventory_stock
    ON inventory (qty, "minQty");
