-- 144_attendance_punch_source_down.sql
BEGIN;

ALTER TABLE attendance_logs DROP CONSTRAINT IF EXISTS attendance_logs_source_allowed;
ALTER TABLE attendance_logs ALTER COLUMN source SET DEFAULT 'device';
COMMENT ON COLUMN attendance_logs.source IS NULL;

COMMIT;
