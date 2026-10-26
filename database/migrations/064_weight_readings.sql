-- =====================================================
-- Migration 064: create missing weightReadings table
-- The scale-readings UI + schema-registry + zod all reference it,
-- but the table was never created, so every save failed.
-- صارم: الوزن يجب أن يكون موجبًا (قراءات الميزان قياسات فعلية).
-- =====================================================

CREATE TABLE IF NOT EXISTS "weightReadings" (
    id BIGINT PRIMARY KEY,
    weight NUMERIC(14,3) NOT NULL CHECK (weight > 0),
    unit VARCHAR(50),
    date VARCHAR(50),
    "itemId" BIGINT,
    "time" VARCHAR(50),
    "timestamp" VARCHAR(50),
    "itemName" VARCHAR(255),
    notes TEXT,
    "recordedBy" VARCHAR(100)
);

CREATE INDEX IF NOT EXISTS weight_readings_date_idx ON "weightReadings"(date);
CREATE INDEX IF NOT EXISTS weight_readings_item_idx ON "weightReadings"("itemId");
