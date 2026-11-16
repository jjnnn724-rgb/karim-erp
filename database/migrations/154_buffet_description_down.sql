-- عكس 154_buffet_description.sql
BEGIN;
ALTER TABLE buffet_dishes DROP COLUMN IF EXISTS description;
COMMIT;
