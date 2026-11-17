-- 157_buffet_name_en.sql — الاسم الإنجليزي للصنف (عنوان الكرت ثنائي اللغة)
ALTER TABLE buffet_dishes ADD COLUMN IF NOT EXISTS name_en text;

COMMENT ON COLUMN buffet_dishes.name_en IS 'اسم الصنف بالإنجليزية — عنوان الكرت/الوصفة ثنائي اللغة بجانب الاسم العربي';
