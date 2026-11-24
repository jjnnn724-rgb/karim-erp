-- ═══════════════════════════════════════════════════════════════════
-- 125_attendance_audit_reconciliation.sql
-- حوكمة الحضور: سجلّ تدقيق دائم + مطابقة بصمات الجهاز بالنظام
-- ───────────────────────────────────────────────────────────────────
-- طلب المالك (2026-11-02): «إجراءات صارمة في الموقع والتدقيق» و
-- «مراجعة البصمات من جهاز البصمات لمقارنته بسستم البصمة».
--
-- (١) سجلّ تدقيق الحضور — attendance_edit_log:
--     سطرٌ لكل تغييرٍ على صفّ حضور: من غيّر، ماذا، متى، ولماذا.
--     لا يُحدَّث ولا يُحذف منه سطر — كسجلّ الحركات المالية.
--     يُكتب داخل معاملة تعديل الحضور نفسها: إما أن يُحفظ التعديل
--     ويُسجَّل، أو لا يُحفظ شيء.
--
-- (٢) فهرسان على attendance(checkInAt/checkOutAt):
--     مطابقةُ الجهاز بالنظام تقارن لحظةَ البصمة بلحظة صفِّ الحضور،
--     وهذه أعمدةٌ لم يكن لها فهرس — فالمطابقة كانت تسحب جدولاً كاملاً.
--
-- idempotent: CREATE TABLE IF NOT EXISTS + CREATE INDEX IF NOT EXISTS —
-- تشغيل ثانٍ بلا أثر.
--
-- ROLLBACK (لا يحتاج نسخة: إضافة بحتة):
--   DROP TABLE IF EXISTS attendance_edit_log;
--   DROP INDEX IF EXISTS idx_attendance_check_in_at;
--   DROP INDEX IF EXISTS idx_attendance_check_out_at;
-- ═══════════════════════════════════════════════════════════════════

BEGIN;

CREATE TABLE IF NOT EXISTS attendance_edit_log (
    id BIGSERIAL PRIMARY KEY,
    "attendanceId" BIGINT,
    "employeeId" BIGINT,
    action VARCHAR(16) NOT NULL,
    "changedFields" JSONB NOT NULL DEFAULT '{}'::jsonb,
    reason TEXT,
    "actorId" BIGINT,
    "actorName" VARCHAR(120),
    "actorRole" VARCHAR(40),
    source VARCHAR(24) NOT NULL DEFAULT 'api',
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE attendance_edit_log IS
    'تدقيق الحضور: كل تغييرٍ على صفّ حضور (من/ماذا/متى/لماذا) — يُكتب ولا يُعدَّل.';
COMMENT ON COLUMN attendance_edit_log."changedFields" IS
    'فرق القيم قبل/بعد لكل حقل تغيّر.';
COMMENT ON COLUMN attendance_edit_log.action IS
    'create | update | delete';

CREATE INDEX IF NOT EXISTS idx_attendance_edit_log_created
    ON attendance_edit_log ("createdAt" DESC);
CREATE INDEX IF NOT EXISTS idx_attendance_edit_log_employee
    ON attendance_edit_log ("employeeId", "createdAt" DESC);
CREATE INDEX IF NOT EXISTS idx_attendance_edit_log_row
    ON attendance_edit_log ("attendanceId");

-- مطابقةُ الجهاز بالنظام: لحظةُ البصمة = لحظةُ صفِّ الحضور
CREATE INDEX IF NOT EXISTS idx_attendance_check_in_at
    ON attendance ("checkInAt")
    WHERE "checkInAt" IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_attendance_check_out_at
    ON attendance ("checkOutAt")
    WHERE "checkOutAt" IS NOT NULL;

COMMIT;

-- تحقق بعد التطبيق
SELECT column_name, data_type, is_nullable
  FROM information_schema.columns
 WHERE table_name = 'attendance_edit_log'
 ORDER BY ordinal_position;
