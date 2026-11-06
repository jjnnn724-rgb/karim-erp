-- ═══════════════════════════════════════════════════════════════════
-- 127_device_alt_namespace_safe.sql
-- تطهير المعرف البديل لمعرّفات البصمة (كل الموظفين المرتبطين بالجهاز)
-- ───────────────────────────────────────────────────────────────────
-- السياق: طلب المالك «كمل كل شي ناقص تقابله اصلحه» بعد إصلاح EMP-053
-- في ترحيل 126. الفحص الشامل كشف أن الحالة في 126 ليست استثناءً بل قاعدة.
--
-- الحقيقة من البيانات الحيّة (2026-11-02، قاعدة karim_erp):
--   · جهازٌ واحد مُفعَّل (deviceId 1 «بصمه العمل») وسجلُّه zk_device_users
--     فيه 156 سطرًا، و135 موظفًا بمعرّف أساسي — لكلٍّ سطرٌ وحيدٌ
--     userId منه هو ذلك المعرّف، ولا معرّف أساسي مشترك بين موظفين.
--   · التيّارُ القادم من الجهاز يحمل userId دائمًا: القيمُ الـ30 التي هي
--     uid-only (لا يملكها أحد كمعرّف أساسي ولا كـ userId) عليها
--     صفر بصمة من أصل 55,989. أي أن البديلَ لا تصله بصمةٌ إطلاقًا.
--   · لكن الجهاز أعاد ترقيم التسجيلات فجعل uid كلِّ موظف ≈ userId جاره،
--     فصار 117 بديلًا من 135 يطابق المعرّفَ الأساسي لموظفٍ آخر حيّ.
--     الضرر: scripts/zk-id-sync.js يُرجِّع البصمات اليتيمة بـ
--     [deviceUserId, deviceUserIdAlt] — فأي بصمةٍ بلا موظفٍ تحت رقم جارٍ
--     تُختم باسم صاحب البديل الخاطئ. هذا بالضبط ما حدث لإبراهيم (126).
--
-- القاعدة المُطبَّقة هاهنا (هي نفسها التي صار يعمل بها zk-id-sync.js):
--   البديلُ الآمن = uid سطرِ الموظف نفسِه في سجل الجهاز، بشرط:
--     1. أن يكون هناك سطرٌ واحدٌ فقط userId منه = المعرّف الأساسي،
--     2. ألا يساوي المعرّفَ الأساسي نفسه،
--     3. ألا يملكه موظفٌ آخر كمعرّفٍ أساسي (وإلا فهو رقم جارٍ لا بديل).
--   وإلا فالبديل NULL. النتيجة المتوقعة من المحاكاة على الإنتاج:
--     125 تغييرًا = 96 تُفرَغ (أرقام جارٍ) + 29 تُستبدل بـuid صاحبها،
--     و10 بقيت مطابقة، منها EMP-053 (بديل 181) الذي أثبته ترحيل 126.
--   EMP-052 (إبراهيم): بديلُه '53' كان uid نفسِه لكنه رقم عبده الأساسي ⇒
--     يُفرَغ؛ هذا يُصحّح استنتاجًا سُجّل في رأس 126 وكان قاصرًا.
--
-- الأثر السلوكي: صفر على الحضور المرئي — المعرّفُ الأساسي يُسجَّل أولًا في
-- خريطة المحرك (attendance-engine.js:1264) ثم لا يُستبدل البديلُ به (1267)،
-- ولا بصمةٌ تحت أي uid خالص. التصحيحُ يرفع خطرَ النسب الخاطئ فقط.
-- لا يمسّ attendance ولا attendance_logs ولا الرواتب ولا أي قيمة مالية.
--
-- البوابة: إن لم يكن هناك جهازٌ واحد مُفعَّل أو كان سجلُّه أقل من 50 سطرًا
-- (قاعدة مستعادة بلا m zk_device_users مثلًا) لا يتغيّر أيُّ صفّ — لأن
-- غيابَ السجل ليس دليلًا على أن البدائل خاطئة.
--
-- idempotent: شرطُ UPDATE هو IS DISTINCT FROM؛ تشغيلٌ ثانٍ = 0 صفوف.
-- كلُّ قيمة قديمة تُحفَظ في attendance_device_alt_backup قبل الكتابة.
--
-- ROLLBACK:
--   UPDATE employees e SET "deviceUserIdAlt" = b.old_alt
--     FROM attendance_device_alt_backup b
--    WHERE b.source = '127' AND b.employee_pk = e.id;
--   DELETE FROM attendance_device_alt_backup WHERE source = '127';
-- ═══════════════════════════════════════════════════════════════════

BEGIN;

CREATE TABLE IF NOT EXISTS attendance_device_alt_backup (
    id             BIGSERIAL PRIMARY KEY,
    source         VARCHAR(40) NOT NULL,           -- مُعرِّف التصحيح، مثل '127'
    employee_pk    BIGINT NOT NULL,
    employee_no    VARCHAR(40),
    device_user_id VARCHAR(64),
    old_alt        VARCHAR(64),
    new_alt        VARCHAR(64),
    reason         TEXT,
    saved_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_attendance_device_alt_backup_source
    ON attendance_device_alt_backup (source);

WITH gate AS (
    SELECT (SELECT count(*) FROM attendance_devices WHERE enabled = TRUE) = 1 AS device_ok,
           (SELECT count(*) FROM zk_device_users d
             WHERE d."deviceId" = (SELECT id FROM attendance_devices WHERE enabled = TRUE LIMIT 1)) >= 50 AS roster_ok
),
roster AS (
    SELECT d.uid::text AS uid, btrim(d."userId") AS userid
      FROM zk_device_users d
     WHERE d."deviceId" = (SELECT id FROM attendance_devices WHERE enabled = TRUE LIMIT 1)
),
prim AS (
    SELECT btrim("deviceUserId") AS v, min(id) AS owner_pk
      FROM employees
     WHERE "deviceUserId" IS NOT NULL AND btrim("deviceUserId") <> ''
     GROUP BY 1
),
own AS (
    SELECT e.id AS emp_pk, e."employeeId" AS emp_no, btrim(e."deviceUserId") AS v,
           NULLIF(btrim(COALESCE(e."deviceUserIdAlt", '')), '') AS old_alt,
           (SELECT count(*) FROM roster r WHERE r.userid = btrim(e."deviceUserId")) AS n_rows,
           (SELECT min(r.uid) FROM roster r WHERE r.userid = btrim(e."deviceUserId")) AS one_uid
      FROM employees e
     WHERE e."deviceUserId" IS NOT NULL AND btrim(e."deviceUserId") <> ''
),
wanted AS (
    SELECT o.emp_pk, o.emp_no, o.v, o.old_alt, o.n_rows, o.one_uid,
        CASE WHEN o.n_rows <> 1                      THEN NULL
             WHEN o.one_uid IS NULL                  THEN NULL
             WHEN o.one_uid = o.v                    THEN NULL
             WHEN o.one_uid IN (SELECT v FROM prim)  THEN NULL
             ELSE o.one_uid END AS new_alt
      FROM own o
),
changed AS (
    SELECT w.emp_pk, w.emp_no, w.v, w.old_alt, w.new_alt,
        CASE
            WHEN w.n_rows <> 1 OR w.one_uid IS NULL
                 THEN 'لا سطر وحيد في سجل الجهاز لمعرّفه الأساسي'
            WHEN w.new_alt IS NULL AND w.old_alt IS NOT NULL
                 THEN 'البديل رقم موظف آخر أساسي وحي — يُفرغ (خطر نسبة بصمة يتيمة)'
            WHEN w.new_alt IS NULL
                 THEN 'لا بديل آمن — يُفرغ'
            ELSE 'البديل = uid سجل الموظف نفسه (غير مملوك لغيره)'
        END AS reason
      FROM wanted w, gate g
     WHERE g.device_ok AND g.roster_ok
       AND w.old_alt IS DISTINCT FROM w.new_alt
),
backup AS (
    INSERT INTO attendance_device_alt_backup
        (source, employee_pk, employee_no, device_user_id, old_alt, new_alt, reason)
    SELECT '127', emp_pk, emp_no, v, old_alt, new_alt, reason FROM changed
    RETURNING id
),
upd AS (
    UPDATE employees e
       SET "deviceUserIdAlt" = c.new_alt
      FROM changed c
     WHERE e.id = c.emp_pk
    RETURNING e.id
)
SELECT (SELECT count(*) FROM changed) AS rows_changed,
       (SELECT count(*) FROM backup)  AS rows_backed_up,
       (SELECT count(*) FROM upd)     AS rows_updated,
       (SELECT count(*) FROM changed WHERE new_alt IS NULL)     AS cleared,
       (SELECT count(*) FROM changed WHERE new_alt IS NOT NULL) AS rewritten;

COMMIT;

-- إثبات ما بعد التطبيق: يجب أن يكون صفرًا
SELECT count(*) AS alts_colliding_with_a_live_primary
  FROM employees e
 WHERE NULLIF(btrim(COALESCE(e."deviceUserIdAlt", '')), '') IS NOT NULL
   AND EXISTS (SELECT 1 FROM employees o
                WHERE o.id <> e.id AND btrim(o."deviceUserId") = btrim(e."deviceUserIdAlt"));
