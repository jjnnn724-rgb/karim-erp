-- Migration 023: Versioned recipes/BOM
BEGIN;

CREATE TABLE IF NOT EXISTS pos_recipe_versions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id BIGINT NOT NULL REFERENCES pos_products(id) ON DELETE RESTRICT,
    version_no INTEGER NOT NULL CHECK (version_no > 0),
    status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('draft','active','retired')),
    effective_from TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    effective_to TIMESTAMPTZ,
    yield_qty NUMERIC(14,4) NOT NULL DEFAULT 1 CHECK (yield_qty > 0),
    notes TEXT,
    created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (product_id, version_no),
    CONSTRAINT recipe_version_dates CHECK (effective_to IS NULL OR effective_to > effective_from)
);

CREATE TABLE IF NOT EXISTS pos_recipe_version_ingredients (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    recipe_version_id UUID NOT NULL REFERENCES pos_recipe_versions(id) ON DELETE RESTRICT,
    inventory_id BIGINT NOT NULL REFERENCES inventory(id) ON DELETE RESTRICT,
    quantity_per_yield NUMERIC(14,4) NOT NULL CHECK (quantity_per_yield > 0),
    unit VARCHAR(50) NOT NULL DEFAULT 'وحدة',
    waste_percent NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (waste_percent >= 0 AND waste_percent <= 100),
    notes TEXT,
    UNIQUE (recipe_version_id, inventory_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_one_active_recipe_version
    ON pos_recipe_versions(product_id) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_recipe_versions_effective
    ON pos_recipe_versions(product_id, effective_from DESC, status);
CREATE INDEX IF NOT EXISTS idx_recipe_version_ingredients_version
    ON pos_recipe_version_ingredients(recipe_version_id);

-- Preserve the existing BOM by creating version 1 once for products that do not
-- yet have a versioned recipe. Historical rows remain untouched.
INSERT INTO pos_recipe_versions (product_id, version_no, status, effective_from, notes)
SELECT DISTINCT pi.product_id, 1, 'active', CURRENT_TIMESTAMP, 'ترحيل الوصفة الحالية إلى الإصدار الأول'
  FROM pos_product_ingredients pi
 WHERE NOT EXISTS (SELECT 1 FROM pos_recipe_versions rv WHERE rv.product_id = pi.product_id);

INSERT INTO pos_recipe_version_ingredients (recipe_version_id, inventory_id, quantity_per_yield, unit, waste_percent, notes)
SELECT rv.id, pi.inventory_id, pi.quantity_per_unit, pi.unit, pi.waste_percent, pi.notes
  FROM pos_recipe_versions rv
  JOIN pos_product_ingredients pi ON pi.product_id = rv.product_id
 WHERE rv.version_no = 1
ON CONFLICT (recipe_version_id, inventory_id) DO NOTHING;

COMMENT ON TABLE pos_recipe_versions IS 'Immutable recipe versions selected by effective date for POS and production.';
COMMENT ON TABLE pos_recipe_version_ingredients IS 'Versioned BOM components used for historical consumption traceability.';
COMMIT;
