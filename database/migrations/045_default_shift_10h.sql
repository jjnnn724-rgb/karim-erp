-- 045_default_shift_10h.sql — الدوام الأساسي 10 ساعات (وفئات 12) بدل 9
-- ────────────────────────────────────────────────────────────────────────────
ALTER TABLE employees ALTER COLUMN shift_karim SET DEFAULT 10;
UPDATE employees SET shift_karim = 10 WHERE shift_karim = 9;
