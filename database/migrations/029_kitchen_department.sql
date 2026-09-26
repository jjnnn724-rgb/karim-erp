-- Migration 029: Ensure the operational kitchen department exists.
-- This is master data required by kitchen dispatches, not demo sales data.
BEGIN;

INSERT INTO departments (id, code, name, icon, color)
SELECT COALESCE(MAX(id), 0) + 1, 'kitchen', 'المطبخ', '🍳', '#D4A843'
FROM departments
WHERE NOT EXISTS (SELECT 1 FROM departments WHERE code = 'kitchen');

COMMIT;
