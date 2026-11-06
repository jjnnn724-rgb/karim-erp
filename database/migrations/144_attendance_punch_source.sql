-- 144_attendance_punch_source.sql — هوية البصمة إلزامية (قرار المالك 2026-11-07)
-- ──────────────────────────────────────────────────────────────────────────────
-- القاعدة: كل بصمة خام في attendance_logs تحمل مصدرًا معروفًا
-- (device / portal / manual)، وهوية الجهاز deviceId مفروضة أصلًا NOT NULL.
-- الافتراضي الصامت source='device' كان يسمح لكاتبٍ جديد بأن يُنسب للجهاز
-- دون أن يعلن ذلك — يُزال هنا؛ كل مسار كتابة (zkteco/engine.js،
-- attendance-portal-routes.js) يمرّر source صراحةً.
--
-- Additive فقط: القيد NOT VALID لا يمسّ الصفوف التاريخية (كلها device/portal
-- في الإنتاج)، لكنه يرفض أي صفٍّ جديد بمصدر خارج القائمة.
-- الإنتاج لا يُلمس إلا بأمر المالك — هذه الهجرة تُطبَّق على karim_erp_test أولًا.

BEGIN;

ALTER TABLE attendance_logs ALTER COLUMN source DROP DEFAULT;
ALTER TABLE attendance_logs ALTER COLUMN source SET NOT NULL;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'attendance_logs_source_allowed') THEN
        ALTER TABLE attendance_logs ADD CONSTRAINT attendance_logs_source_allowed
            CHECK (source IN ('device', 'portal', 'manual')) NOT VALID;
    END IF;
END $$;

COMMENT ON COLUMN attendance_logs.source IS
    'مصدر البصمة: device (جهاز) | portal (كاميرا التطبيق) | manual (يدوية بهوية وسبب واعتماد) — بلا default';

COMMIT;
