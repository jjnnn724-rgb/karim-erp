-- 147_employee_wps_bank_down.sql — تراجع هجرة مدد
-- حذف الأعمدة يفقد بيانات أُدخلت يدويًا؛ لا تُستخدم إلا على قاعدة اختبار
-- أو بعد تصدير البيانات والنسخ الاحتياطي.

BEGIN;

ALTER TABLE employees DROP CONSTRAINT IF EXISTS employees_iban_fmt;
ALTER TABLE employees DROP CONSTRAINT IF EXISTS employees_nationality_fmt;
ALTER TABLE employees DROP CONSTRAINT IF EXISTS employees_gosi_number_fmt;

ALTER TABLE employees DROP COLUMN IF EXISTS gosi_number;
ALTER TABLE employees DROP COLUMN IF EXISTS nationality;
ALTER TABLE employees DROP COLUMN IF EXISTS iban;

COMMIT;
