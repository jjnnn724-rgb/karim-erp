-- 041_attendance_inference.sql — تمييز القيم المستكملة تلقائيًا في الحضور
-- ────────────────────────────────────────────────────────────────────────────
-- checkin_inferred / checkout_inferred: القيمة خُمّنت من الوردية (نسيان بصمة)
-- وليست بصمة فعلية — تظهر بشارة مميزة في الواجهة ويمكن تصحيحها يدويًا.
ALTER TABLE attendance ADD COLUMN IF NOT EXISTS checkin_inferred BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE attendance ADD COLUMN IF NOT EXISTS checkout_inferred BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS idx_attendance_open ON attendance("employeeId", date) WHERE "checkOut" IS NULL;
CREATE INDEX IF NOT EXISTS idx_attendance_orphan ON attendance("employeeId", date) WHERE "checkIn" IS NULL;
