-- Migration 012: Restaurant menu recipe schema
-- POS menu products are created by authorized users through the database API.
-- Ingredient quantities are managed by inventory and linked through this BOM table.
BEGIN;
CREATE TABLE IF NOT EXISTS pos_product_ingredients (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    product_id BIGINT NOT NULL REFERENCES pos_products(id) ON DELETE CASCADE,
    inventory_id BIGINT NOT NULL REFERENCES inventory(id) ON DELETE RESTRICT,
    quantity_per_unit NUMERIC(14,4) NOT NULL CHECK (quantity_per_unit > 0),
    unit VARCHAR(50) NOT NULL DEFAULT 'وحدة',
    waste_percent NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (waste_percent >= 0 AND waste_percent <= 100),
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (product_id, inventory_id)
);
CREATE INDEX IF NOT EXISTS idx_pos_product_ingredients_product
    ON pos_product_ingredients(product_id);
CREATE INDEX IF NOT EXISTS idx_pos_product_ingredients_inventory
    ON pos_product_ingredients(inventory_id);
COMMENT ON TABLE pos_product_ingredients IS 'Recipe/BOM for restaurant menu items. Ingredient stock is read from inventory and consumed atomically on sale.';
COMMIT;
