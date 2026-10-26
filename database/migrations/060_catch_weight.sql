-- =====================================================
-- Migration 060: Catch Weight (الوزن المتغير) للأصناف
-- يدعم صنف اللحوم: طلب بالكرتون + صرف بالوزن الفعلي
-- =====================================================

-- 1) إضافة أعمدة Catch Weight لجدول inventory
ALTER TABLE inventory
    ADD COLUMN IF NOT EXISTS catch_weight_enabled BOOLEAN DEFAULT false,
    ADD COLUMN IF NOT EXISTS inventory_uom VARCHAR(20) DEFAULT 'kg',
    ADD COLUMN IF NOT EXISTS packaging_uom VARCHAR(20) DEFAULT NULL,
    ADD COLUMN IF NOT EXISTS catch_weight_uom VARCHAR(20) DEFAULT 'kg';

COMMENT ON COLUMN inventory.catch_weight_enabled IS 'تفعيل الوزن المتغير: قبول وحدتين متوازيتين عند الصرف (عدد كراتين + وزن فعلي)';
COMMENT ON COLUMN inventory.inventory_uom IS 'الوحدة الأساسية للمخزون (KG) — المعتمدة في الجرد والتقييم';
COMMENT ON COLUMN inventory.packaging_uom IS 'وحدة الطلب والتعبئة (Box) — كرتون';
COMMENT ON COLUMN inventory.catch_weight_uom IS 'وحدة الوزن الفعلي عند الصرف (KG افتراضي)';

-- 2) تفعيل Catch Weight على صنف اللحوم تلقائيًا
-- بنطابق اسم الصنف على كلمات: لحم / لحوم / meat
UPDATE inventory
SET catch_weight_enabled = true,
    inventory_uom = 'kg',
    packaging_uom = 'كرتون',
    catch_weight_uom = 'kg',
    unit = 'kg'
WHERE catch_weight_enabled = false
  AND (
    LOWER(name) LIKE '%لحم%'
    OR LOWER(name) LIKE '%لحوم%'
    OR LOWER(name) LIKE '%meat%'
    OR LOWER(name) LIKE '%beef%'
    OR LOWER(name) LIKE '%chicken%'
    OR LOWER(name) LIKE '%دجاج%'
  );

-- 3) إضافة أعمدة Catch Weight لجدول inventoryTx (حركات المخزون)
ALTER TABLE "inventoryTx"
    ADD COLUMN IF NOT EXISTS catch_weight_qty NUMERIC(10,3) DEFAULT NULL,
    ADD COLUMN IF NOT EXISTS catch_weight_unit VARCHAR(20) DEFAULT NULL;

COMMENT ON COLUMN "inventoryTx".catch_weight_qty IS 'عدد وحدات التعبئة (الكراتين) عند الصرف — بيان إحصائي';
COMMENT ON COLUMN "inventoryTx".catch_weight_unit IS 'وحدة التعبئة المستخدمة (كرتون)';

-- 4) إضافة أعمدة Catch Weight لجدول inventory_ledger
ALTER TABLE inventory_ledger
    ADD COLUMN IF NOT EXISTS catch_weight_qty NUMERIC(10,3) DEFAULT NULL,
    ADD COLUMN IF NOT EXISTS catch_weight_unit VARCHAR(20) DEFAULT NULL;

-- 5) فهرسة سريعة للبحث عن أصناف Catch Weight
CREATE INDEX IF NOT EXISTS idx_inventory_catch_weight
    ON inventory (catch_weight_enabled) WHERE catch_weight_enabled = true;
