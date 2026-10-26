-- 010_inventory_barcode.sql
-- The frontend's inventory module (scan-to-add, barcode dedup checks) reads/writes
-- item.barcode, but migration 001 never created that column. Add it now so the
-- inventory REST endpoint can actually persist it.
ALTER TABLE inventory ADD COLUMN IF NOT EXISTS barcode VARCHAR(100);

-- Speed up the "is this barcode already used?" lookup done on every add/edit.
CREATE INDEX IF NOT EXISTS idx_inventory_barcode ON inventory(barcode) WHERE barcode IS NOT NULL;
