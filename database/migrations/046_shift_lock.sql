-- 046_shift_lock.sql — قفل يوم الوردية بعد الإغلاق التلقائي (لأشخاص معينين)
-- ────────────────────────────────────────────────────────────────────────────
-- auto_lock: بعد إغلاق الصف تلقائيًا (checkout_inferred) لا تُقبل أي بصمة
-- لاحقة لذلك اليوم (دخولًا أو خروجًا) — من يخرج انتهى يومه ولو عاد وبصم.
-- التعديل اليدوي للمدير يبقى متاحًا دائمًا. تُدار من حساب المدير فقط.
ALTER TABLE employees ADD COLUMN IF NOT EXISTS auto_lock BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS idx_employees_auto_lock ON employees(auto_lock) WHERE auto_lock = true;
