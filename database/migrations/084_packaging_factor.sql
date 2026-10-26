-- 084_packaging_factor.sql — معامل وحدة التعبئة + تفعيل الوزن المتغير (إضافية فقط)
-- لحم يُستلم بالكيلو والمطبخ يطلبه بالكرتون: packaging_qty_per_base = متوسط
-- محتوى وحدة التعبئة (كرتون = كم كجم) — يُستخدم لتقدير الطلب والعرض.
ALTER TABLE inventory ADD COLUMN IF NOT EXISTS packaging_qty_per_base NUMERIC(12,3);
COMMENT ON COLUMN inventory.packaging_qty_per_base IS 'متوسط محتوى وحدة التعبئة بالوحدة الأساسية (كرتون = كم كجم)';

-- تفعيل الوزن المتغير لأصناف اللحوم المستوردة حديثًا (نفس نمط 060 + عجل)
UPDATE inventory
SET catch_weight_enabled = true,
    packaging_uom = COALESCE(NULLIF(packaging_uom,''), 'كرتون'),
    catch_weight_uom = COALESCE(NULLIF(catch_weight_uom,''), 'كجم')
WHERE catch_weight_enabled = false
  AND (name ~ 'لحم|لحوم|عجل|meat|beef|chicken|دجاج');
