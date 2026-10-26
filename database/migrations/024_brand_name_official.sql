-- Official visible brand name
-- Keep historical migration files unchanged; update existing installations safely.
BEGIN;
UPDATE settings
   SET name = 'مطاعم الشرفه العالمي'
 WHERE id = 'main_settings';
COMMIT;

