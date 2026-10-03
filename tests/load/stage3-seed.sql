\set ON_ERROR_STOP on
INSERT INTO pos_departments (id, code, name_ar, name_en, is_active, vat_number, location)
OVERRIDING SYSTEM VALUE
VALUES (99901, 'STAGE3', 'STAGE3-DEPT', 'STAGE3-DEPT', true, '300000000000003', 'MAIN')
ON CONFLICT (id) DO UPDATE SET is_active=true;

INSERT INTO pos_products (id, name_ar, department_id, price, vat_rate, stock_quantity, is_active, unit)
OVERRIDING SYSTEM VALUE
VALUES (999001, 'STAGE3-PRODUCT', 99901, 115.00, 15.00, 99, true, 'piece')
ON CONFLICT (id) DO UPDATE SET price=115.00, is_active=true;

DELETE FROM pos_product_ingredients WHERE product_id=999001;
INSERT INTO pos_product_ingredients (product_id, inventory_id, quantity_per_unit, unit)
VALUES (999001, 999001, 1, 'piece');

INSERT INTO pos_shift_sessions (id, department_id, cashier_id, status, opening_balance, opened_at)
OVERRIDING SYSTEM VALUE
VALUES (999001, 99901, 1, 'open', 0, NOW())
ON CONFLICT (id) DO NOTHING;

SELECT 'seed_ok' AS status,
       (SELECT qty FROM inventory WHERE id=999001) AS ing_qty,
       (SELECT count(*) FROM pos_products WHERE id=999001) AS product,
       (SELECT count(*) FROM pos_shift_sessions WHERE id=999001 AND status='open') AS shift;
