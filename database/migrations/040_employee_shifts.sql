-- 040_employee_shifts.sql — ورديات الموظفين (ليلية/نهارية بساعات مخصصة)
-- ────────────────────────────────────────────────────────────────────────────
-- shift_start: بداية الوردية HH:MM (24h) — تُستخدم لحساب التأخير بدل الساعة الثابتة
-- shift_karim: مدة الوردية بالساعات (9 أو 12...) — للانصراف المتوقع والفرق
-- يوم الوردية: البصمة قبل الفجر تُنسب لليوم السابق (انظر backend/shift-day.js)
ALTER TABLE employees ADD COLUMN IF NOT EXISTS shift_start VARCHAR(5) DEFAULT '09:00';
ALTER TABLE employees ADD COLUMN IF NOT EXISTS shift_karim NUMERIC(5,2) DEFAULT 9;
UPDATE employees SET shift_start = '09:00' WHERE shift_start IS NULL;
UPDATE employees SET shift_karim = 9 WHERE shift_karim IS NULL;
