-- 052: نهاية التثقيف الصحي للموظفين (جنب الشهادة الصحية) — quoted camelCase مثل healthCertExpiry
ALTER TABLE employees ADD COLUMN IF NOT EXISTS "healthEduExpiry" VARCHAR(50);
