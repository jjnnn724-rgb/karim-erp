-- 044_auto_checkout.sql — انصراف تلقائي اختياري لكل موظف (تحكم المدير فقط)
-- ────────────────────────────────────────────────────────────────────────────
-- auto_checkout: إغلاق صف الحضور المفتوح تلقائيًا عند نهاية الوردية المتوقعة
-- (لمن ينسى بصمة الخروج) — القيمة مُستنتجة ومُعلَّمة، وبصمة حقيقية لاحقة لا
-- تُمسح أبدًا (الاستكمال يملأ الفراغ فقط ويتوقف عند أول بصمة خروج حقيقية).
ALTER TABLE employees ADD COLUMN IF NOT EXISTS auto_checkout BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS idx_employees_auto_checkout ON employees(auto_checkout) WHERE auto_checkout = true;
