-- 066: وحدات الطلب الثانوية لكل صنف (شكارة/كرتون/شوال/جالون...)
-- تشغيلها: node database/scripts/run-migration.js database/migrations/066_secondary_units.sql
-- كل عنصر: {"uom":"شكارة","factor":50} — factor = كم وحدة أساسية (المخزنة) في هذه الوحدة
-- مثال: أرز مخزّن بالكجم + شكارة = 50 كجم → طلب 2 شكارة يُحوَّل تلقائيًا إلى 100 كجم
BEGIN;

ALTER TABLE inventory
    ADD COLUMN IF NOT EXISTS secondary_units JSONB DEFAULT NULL;

COMMENT ON COLUMN inventory.secondary_units IS
    'وحدات طلب ثانوية للصنف: [{uom,factor}] — factor = عدد الوحدات الأساسية في الوحدة الثانوية. يُستخدم لتحويل الكميات في أذون الصرف تلقائيًا';

COMMIT;
