-- 036_printer_management.sql — Task 36 (التسليم): إدارة الطابعات الحرارية للطباعة الأوتوماتيك
-- ────────────────────────────────────────────────────────────────────────────
-- pos_printers كانت تفتقد عمودَي name و kind. عمود kind يقود التراجع الذكي
-- في عامل الطباعة (print-worker):
--   مهام الإيصالات  (printer_id = 'pos-<قسم>')  تتراجع لأي طابعة receipt متصلة
--   مهام المطبخ KOT (printer_id = 'kot-<قسم>')  تتراجع لأي طابعة kot متصلة
-- بذلك لا تكدس مهام البيع ولا تفشل لمجرد أن قسمًا معينًا بلا طابعة مسجلة.

ALTER TABLE pos_printers ADD COLUMN IF NOT EXISTS name VARCHAR(80);
ALTER TABLE pos_printers ADD COLUMN IF NOT EXISTS kind VARCHAR(10) NOT NULL DEFAULT 'receipt';

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pos_printers_kind_check') THEN
        ALTER TABLE pos_printers
            ADD CONSTRAINT pos_printers_kind_check CHECK (kind IN ('receipt','kot'));
    END IF;
END $$;

-- الصفوف القديمة: اشتقاق kind من بادئة المعرف القياسية
UPDATE pos_printers SET kind = 'kot' WHERE id LIKE 'kot-%';
