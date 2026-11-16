-- عكس 153_buffet_tables.sql — حذف جداول البوفيه فقط (لا يمس أي بيانات قائمة).
BEGIN;
DROP TABLE IF EXISTS buffet_week;
DROP TABLE IF EXISTS buffet_ingredients;
DROP TABLE IF EXISTS buffet_dishes;
DROP FUNCTION IF EXISTS pack_kg_for(BIGINT, TEXT);
COMMIT;
