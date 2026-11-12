-- 147_employee_wps_bank.sql — بيانات مصرفية/تأمينية للموظف (متطلبات مدد)
-- ──────────────────────────────────────────────────────────────────────────────
-- هجرة GATE 06 — إضافية فقط، قابلة للعدم (NULL)، بلا أي تعبئة رجعية.
-- لا تغيّر حسابًا ماليًا ولا صفًا قائمًا؛ تفتح فقط أماكن للحقول التي يتطلبها
-- ملف حماية الأجور: IBAN، الجنسية (سعودي/غير سعودي)، رقم التأمينات.
-- الإنتاج لا يُلمس إلا بأمر مالك صريح + نسخة احتياطية.
--
-- الرجوع: 147_employee_wps_bank_down.sql
--
-- CHECKs تحمي القاعدة من قيم مكسورة، لكن التحقق الفعلي (mod-97) في الكود
-- عند الكتابة عبر /api/integration/wps/employees/:id/bank.

BEGIN;

ALTER TABLE employees ADD COLUMN IF NOT EXISTS iban VARCHAR(34);
ALTER TABLE employees ADD COLUMN IF NOT EXISTS nationality VARCHAR(2);
ALTER TABLE employees ADD COLUMN IF NOT EXISTS gosi_number VARCHAR(12);

DO $$ BEGIN
    ALTER TABLE employees ADD CONSTRAINT employees_iban_fmt
        CHECK (iban IS NULL OR iban ~ '^SA[0-9]{22}$');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE employees ADD CONSTRAINT employees_nationality_fmt
        CHECK (nationality IS NULL OR nationality ~ '^[A-Z]{2}$');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE employees ADD CONSTRAINT employees_gosi_number_fmt
        CHECK (gosi_number IS NULL OR gosi_number ~ '^[0-9]{6,12}$');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMENT ON COLUMN employees.iban IS
    'IBAN سعودي بصيغة SA + 22 رقمًا — يُلزم به ملف WPS (Mudad)؛ لا يظهر كاملًا في أي شاشة قراءة';
COMMENT ON COLUMN employees.nationality IS
    'رمز ISO-3166-1 ألفا-2؛ SA = سعودي، غير ذلك = وافد — أساس تصنيف اشتراك التأمينات';
COMMENT ON COLUMN employees.gosi_number IS
    'رقم المشترك في التأمينات الاجتماعية — لا يُخترع، يُدخل يدويًا بعد التحقق';

COMMIT;
