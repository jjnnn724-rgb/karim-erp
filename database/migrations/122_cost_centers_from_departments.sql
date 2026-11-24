-- ═══════════════════════════════════════════════════════════════════════════
-- 122_cost_centers_from_departments.sql — استكمال سجل مراكز التكلفة من الأقسام
-- ═══════════════════════════════════════════════════════════════════════════
-- المشكلة: cost_centers كان يُملأ عند أول اعتماد صرف فقط (ensureCostCenters)،
-- فبقيت أقسام تشغيلية بلا مركز تكلفة — ومنها أقسام تحمل كلفة صرف فعلية
-- (butcher, storeroom, bakery) وأقسام تُسند إليها الإيرادات (open_buffet,
-- hot_kitchen, kstore, fnb, B.F). التقرير يقرأ الأقسام من departments، لكن
-- أي معالجة لاحقة على cost_centers (تعبئة القيود، فلترة الأستاذ) تحتاج الصف.
--
-- الحل: كل قسم تشغيلي (ليس قناة مبيعات يارا ys_*) يصبح مركز تكلفة، برمز
-- مطابق حرفيًا لدالة التطبيع الوحيدة في accounting-routes.js:
--     UPPER(REPLACE_DISALLOWED_TO '_') ثم أول 20 حرفًا
-- أي أن الربط بين القسم ومركز التكلفة ليس خريطة جديدة بل قاعدة الاسم نفسها
-- التي يطبّقها ترحيل إذن الصرف أصلًا — لا ازدواج ولا انحراف.
--
-- إضافي 100% وidempotent: ON CONFLICT DO NOTHING، ولا يُعدَّل اسم مركز موجود
-- (تعديل المالك يبقى). لا يُنشئ مركزًا لقنوات البيع ys_cc_N ولا ys_b4_ext.
--
-- رجوع آمن: احذف الصفوف التي أنشأها هذا الملف فقط (لم تكن موجودة قبله):
--   DELETE FROM cost_centers c
--    WHERE c.created_at >= '<وقت التطبيق>'
--      AND NOT EXISTS (SELECT 1 FROM journal_lines l WHERE l.cost_center_code = c.code);
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

INSERT INTO cost_centers (code, name_ar)
SELECT UPPER(LEFT(REGEXP_REPLACE(d.code, '[^A-Za-z0-9_-]', '_', 'g'), 20)) AS code,
       d.name
  FROM departments d
 WHERE d.code IS NOT NULL
   AND d.code <> ''
   -- قنوات يارا ليست أقسامًا تشغيلية: لا مركز تكلفة لها.
   AND d.code NOT LIKE 'ys\_%' ESCAPE '\'
   AND UPPER(LEFT(REGEXP_REPLACE(d.code, '[^A-Za-z0-9_-]', '_', 'g'), 20))
       ~ '^[A-Z0-9_-]{1,20}$'
ON CONFLICT (code) DO NOTHING;

COMMIT;
