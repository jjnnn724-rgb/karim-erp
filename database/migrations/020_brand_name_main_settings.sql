-- Correct the brand rename for the actual settings row.
BEGIN;

UPDATE settings
SET name = 'مطاعم الشرفة العالمية'
WHERE id = 'main_settings';

COMMIT;
