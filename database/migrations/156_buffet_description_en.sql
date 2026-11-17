-- 156_buffet_description_en.sql — وصف الأصناف بالإنجليزية (ثنائي اللغة) لبطاقات البوفيه
-- قبل التشغيل: npm run backup (نسخة إلزامية) — العمود إضافي اختياري، لا يمس بيانات قائمة.
ALTER TABLE buffet_dishes ADD COLUMN IF NOT EXISTS description_en text;

COMMENT ON COLUMN buffet_dishes.description_en IS 'وصف الصنف بالإنجليزية (ثنائي اللغة مع description العربية) — بطاقة الصنف والورقة الرسمية';
