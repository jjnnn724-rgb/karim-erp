-- ═══════════════════════════════════════════════════════════════════
-- 124_notification_escalation.sql
-- «المنادي» المرحلة التانية · سلّم التصعيد (2026-11-02)
-- ───────────────────────────────────────────────────────────────────
-- النداء الصوتي يصل باسم صاحبه، لكن لو لم يُفتح الإشعار يبقى صوتًا في
-- الفراغ. القاعدة (طلب المالك):
--     15 دقيقة بلا فتح  → تصعيد إلى «النائب»  (sous_chef)
--     45 دقيقة بلا فتح  → تصعيد إلى «المدير»  (manager · admin)
--
-- هذا الترحيل يضيف حقلَي التتبّع فقط على جدول notifications القائم:
--   escalation_level  SMALLINT 0/1/2 — 0 = لم يُصعَّد، 2 = نهاية السلّم
--   escalated_at      TIMESTAMPTZ    — لحظة الحجز
--
-- لماذا عمودان على notifications وليس جدول منفصل؟
--   التصعيد ليس كيانًا جديدًا بل *حالة* للصف الأصلي: الحجز يجب أن يكون
--   ذريًّا ومعاملة واحدة مع الإشعار، وإلا تداخلت دورتان فصعَّدت المرّتين.
--
-- لماذا فهرس جزئي؟ المسح يقرأ: read = false AND escalation_level < 2
-- AND category IS NOT NULL — الفهرس الجزئي يغطي المسار كله ويبقي
-- إشعارات «عام» (category NULL) خارج التكلفة.
--
-- idempotent: ADD COLUMN IF NOT EXISTS + CREATE INDEX IF NOT EXISTS —
-- تشغيل ثانٍ بلا أثر.
--
-- ROLLBACK (لا يحتاج نسخة: إضافة بحتة):
--   ALTER TABLE notifications DROP COLUMN IF EXISTS escalation_level;
--   ALTER TABLE notifications DROP COLUMN IF EXISTS escalated_at;
--   DROP INDEX IF EXISTS idx_notifications_escalation;
-- ═══════════════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE notifications ADD COLUMN IF NOT EXISTS escalation_level SMALLINT NOT NULL DEFAULT 0;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS escalated_at TIMESTAMPTZ;

COMMENT ON COLUMN notifications.escalation_level IS
    '«المنادي» التصعيد: 0 = أصلي، 1 = صُعِّد للنائب (15د)، 2 = صُعِّد للمدير (45د) أو نهاية السلّم — لا يُصعَّد بعده.';
COMMENT ON COLUMN notifications.escalated_at IS
    'لحظة حجز أعلى مستوى وصل إليه هذا الإشعار (NULL = لم يُصعَّد).';

CREATE INDEX IF NOT EXISTS idx_notifications_escalation
    ON notifications (created_at)
    WHERE read = false AND escalation_level < 2 AND category IS NOT NULL;

COMMIT;

-- تحقق بعد التطبيق
SELECT column_name, data_type, is_nullable, column_default
  FROM information_schema.columns
 WHERE table_name = 'notifications'
   AND column_name IN ('escalation_level', 'escalated_at')
 ORDER BY column_name;
