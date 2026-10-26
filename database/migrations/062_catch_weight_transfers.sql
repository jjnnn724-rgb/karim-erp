-- =====================================================
-- Migration 062: Catch Weight على التحويلات بين المخازن
-- وزن مزدوج متوازٍ: الكمية الأساسية (kg فعلي) + عدد التعبئة (كرتون)
-- يبقى on_hand/reserved/in_transit بالكيلو (صح محاسبيًا)،
-- وأعمدة التعبئة بيان موازٍ لكل مرحلة (طلب/حجز/شحن/استلام)
-- =====================================================

ALTER TABLE inventory_transfer_items
    ADD COLUMN IF NOT EXISTS packaging_uom VARCHAR(20) DEFAULT NULL,
    ADD COLUMN IF NOT EXISTS catch_weight_uom VARCHAR(20) DEFAULT NULL,
    ADD COLUMN IF NOT EXISTS requested_packaging_qty NUMERIC(10,3) DEFAULT NULL,
    ADD COLUMN IF NOT EXISTS reserved_packaging_qty NUMERIC(10,3) DEFAULT NULL,
    ADD COLUMN IF NOT EXISTS dispatched_packaging_qty NUMERIC(10,3) DEFAULT NULL,
    ADD COLUMN IF NOT EXISTS received_packaging_qty NUMERIC(10,3) DEFAULT NULL;

COMMENT ON COLUMN inventory_transfer_items.packaging_uom IS 'وحدة التعبئة للصنف Catch Weight (كرتون) — نسخة وقت إنشاء البند';
COMMENT ON COLUMN inventory_transfer_items.catch_weight_uom IS 'وحدة الوزن الفعلي (kg) — نسخة وقت إنشاء البند';
COMMENT ON COLUMN inventory_transfer_items.requested_packaging_qty IS 'عدد التعبئة المطلوب (كرتون) — موازٍ لـ requested_qty بالكيلو';
COMMENT ON COLUMN inventory_transfer_items.reserved_packaging_qty IS 'عدد التعبئة المحجوز عند الاعتماد';
COMMENT ON COLUMN inventory_transfer_items.dispatched_packaging_qty IS 'عدد التعبئة المشحون فعليًا عند الشحن';
COMMENT ON COLUMN inventory_transfer_items.received_packaging_qty IS 'عدد التعبئة المستلم فعليًا عند الاستلام';

CREATE INDEX IF NOT EXISTS idx_transfer_items_catch_weight
    ON inventory_transfer_items (transfer_id)
    WHERE requested_packaging_qty IS NOT NULL
       OR dispatched_packaging_qty IS NOT NULL
       OR received_packaging_qty IS NOT NULL;
