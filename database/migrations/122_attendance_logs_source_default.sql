-- 122_attendance_logs_source_default.sql
-- إصلاح جذري لفشل مزامنة الجهاز: عمود source NOT NULL بلا DEFAULT،
-- بينما مُدرج البصمات القديم لا يمرّر القيمة → كل بصمة جديدة تُرفض.
-- idempotent ولا يغيّر صفوفًا موجودة.

ALTER TABLE attendance_logs ALTER COLUMN source SET DEFAULT 'device';

UPDATE attendance_logs SET source = 'device' WHERE source IS NULL;
