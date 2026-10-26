-- Karim ERP v3.1.0 — Commercial brand rename
BEGIN;

UPDATE settings
SET name = 'مطاعم الشرفة العالمية'
WHERE id = '1';

COMMIT;
