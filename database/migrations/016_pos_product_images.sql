-- Migration 016: Database-backed menu product images
BEGIN;

ALTER TABLE pos_products
    ADD COLUMN IF NOT EXISTS image_url TEXT;

CREATE INDEX IF NOT EXISTS idx_pos_products_image_url
    ON pos_products(id) WHERE image_url IS NOT NULL;

COMMIT;
