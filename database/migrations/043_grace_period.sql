-- 043_grace_period.sql — فترة سماح الحضور/الانصراف + علم الانصراف المبكر
-- ────────────────────────────────────────────────────────────────────────────
-- early_leave: انصراف قبل نهاية الوردية بأكثر من فترة السماح (GRACE_MINUTES)
ALTER TABLE attendance ADD COLUMN IF NOT EXISTS early_leave BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS idx_attendance_early ON attendance("employeeId", date) WHERE early_leave = true;
