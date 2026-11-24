-- 143_coa_mapping_read_paths_down.sql — يسقط صفوف 143 فقط، وبشرط مطابقة القيمة المبذورة.
-- ──────────────────────────────────────────────────────────────────────────────
-- تعديل إداري لاحق (حساب مختلف/صف معطّل) لا يُمحى بالرجوع. لا يمس أي صف آخر.

BEGIN;

-- الرجوع قرار صيانة صريح: تجاوز قفل «الحساب عليه قيود مرحّلة» (142) داخل هذه
-- المعاملة فقط. بدونه يفشل الحذف على قاعدة فيها حركة فعلية على 1010/1000/4000.
SET LOCAL coa.allow_mapping_change = 'on';
SET LOCAL coa.mapping_change_reason = 'rollback 143 (maintenance window)';

DELETE FROM account_mapping
 WHERE (module, operation, role, account_code) IN (
   ('reports','cash_flow','cash_account','1000'),
   ('reports','cash_flow','bank_account','1010'),
   ('reports','cfo_summary','cash_account','1000'),
   ('reports','cfo_summary','bank_account','1010'),
   ('reports','cfo_summary','revenue_account','4000'),
   ('reports','bank_reconciliation','bank_account','1010')
 );

COMMIT;
