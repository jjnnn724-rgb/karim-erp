-- 065: أقسام المطبخ الفرعية الناقصة + قسم البوفيه المفتوح
-- يشغّلها: node database/scripts/run-migration.js database/migrations/065_kitchen_sections_cards.sql
-- آمن تمامًا على التكرار (WHERE NOT EXISTS)
BEGIN;

-- البوفيه المفتوح (يستقبل توزيعات أوامر الإنتاج — إيراده من كاشير 9)
INSERT INTO departments (id, code, name, icon, color, parent_code)
SELECT 7201, 'open_buffet', 'البوفيه المفتوح', '🍽', '#8B5CF6', 'kitchen'
WHERE NOT EXISTS (SELECT 1 FROM departments WHERE code = 'open_buffet');

-- الاستيورد (المخزن/الستور) فرع من المطبخ
INSERT INTO departments (id, code, name, icon, color, parent_code)
SELECT 7202, 'storeroom', 'الاستيورد', '🧊', '#00838F', 'kitchen'
WHERE NOT EXISTS (SELECT 1 FROM departments WHERE code = 'storeroom');

-- الصالة الساخنة فرع من المطبخ
INSERT INTO departments (id, code, name, icon, color, parent_code)
SELECT 7203, 'hot_hall', 'الصالة الساخنة', '🔥', '#E64A19', 'kitchen'
WHERE NOT EXISTS (SELECT 1 FROM departments WHERE code = 'hot_hall');

-- أي قسم فرعي للمطبخ فُقد ربطه يُعاد ربطه (ما عدا المطبخ نفسه)
UPDATE departments SET parent_code = 'kitchen'
WHERE code IN ('salads','sweets','bakery','hot_kitchen','butcher','fnb','kstore','storeroom','hot_hall','open_buffet')
  AND (parent_code IS NULL OR parent_code <> 'kitchen');

COMMIT;
