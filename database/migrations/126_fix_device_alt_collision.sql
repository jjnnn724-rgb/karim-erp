-- ═══════════════════════════════════════════════════════════════════
-- 126_fix_device_alt_collision.sql
-- إصلاح تعارف المعرف البديل على جهاز البصمة (EMP-052 / EMP-053)
-- ───────────────────────────────────────────────────────────────────
-- طلب المالك (2026-11-02): «أصلح الـ deviceUserIdAlt المتبادل».
--
-- الحقيقة من سجلّ الجهاز (zk_device_users، deviceId = 1):
--   uid 53  ↔  userId '52'  ↔  "Ibrahimhaf"   ← ابراهيم حافظ نعمان (EMP-052)
--   uid 181 ↔  userId '53'  ↔  "NN-53"        ← عبده ماهر (EMP-053)
--   uid 52  ↔  لا وجود له على الجهاز إطلاقًا.
--
-- تيار البصمات يحمل userId (لا uid) — دليل حي: 555 بصمة لإبراهيم تحت '52'
-- و30 بصمة لعبده تحت '53'، ولكلٍّ نمط وردية مختلف (06:58 مقابل 12:26).
-- لذلك:
--   · EMP-052: alt = '53'  ← صحيح، لأنه uid نفسه على الجهاز ⇒ بلا تغيير.
--   · EMP-053: alt = '52'  ← غلط؛ '52' هو معرف إبراهيم، وuid عبده الحقيقي 181.
--
-- الضرر العملي: scripts/zk-id-sync.js يُصلح البصمات اليتيمة بالمعرفين
-- [deviceUserId, deviceUserIdAlt] لكل موظف، فأي بصمة بلا موظف تحت '52'
-- كانت تُختم باسم «عبده ماهر». الحارس الجديد في ذلك السكربت يمنع أن تُعيد
-- دورة المزامنة اليومية كتابة القيمة القديمة فوق هذه التصحيحات.
--
-- idempotent: UPDATE واحد مشروط بالقيمة القديمة '52' وبوجود الزوج
-- (userId = '53' → uid) في سجلّ الجهاز؛ تشغيلٌ ثانٍ = صفر صفوف.
-- لا يمسّ attendance ولا attendance_logs ولا أي قيمة حضور.
--
-- ROLLBACK:
--   UPDATE employees SET "deviceUserIdAlt" = '52'
--    WHERE id = 53 AND "deviceUserIdAlt" = '181';
-- ═══════════════════════════════════════════════════════════════════

BEGIN;

UPDATE employees e
SET "deviceUserIdAlt" = d.uid::text
FROM zk_device_users d
WHERE e.id = 53
  AND e."employeeId" = 'EMP-053'
  AND e."deviceUserId" = '53'
  AND e."deviceUserIdAlt" = '52'
  AND d."deviceId" = 1
  AND d."userId" = e."deviceUserId";

COMMIT;
