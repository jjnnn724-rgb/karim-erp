BEGIN;

CREATE TABLE IF NOT EXISTS pos_product_departments (
    product_id BIGINT NOT NULL REFERENCES pos_products(id) ON DELETE CASCADE,
    department_id BIGINT NOT NULL REFERENCES pos_departments(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (product_id, department_id)
);

CREATE INDEX IF NOT EXISTS idx_pos_product_departments_department
    ON pos_product_departments(department_id, product_id);

-- Preserve all existing single-department assignments.
INSERT INTO pos_product_departments(product_id, department_id)
SELECT id, department_id FROM pos_products
WHERE department_id IS NOT NULL
ON CONFLICT DO NOTHING;

COMMENT ON TABLE pos_product_departments IS 'Many-to-many menu visibility. Product price, stock and recipe remain centralized on pos_products.';
COMMIT;
