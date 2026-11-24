-- 141_coa_mapping_stock_transfer_down.sql — يسقط صفوف 141 فقط وبشرط مطابقة القيمة المبذورة.

BEGIN;

-- نفس مبرر 143_down: الحسابات 5000/1200/4000 عليها قيود مرحّلة، والقفل يمنع
-- الحذف إلا باعتماد صريح. الرجوع نفسه هو الاعتماد، ومقصور على هذه المعاملة.
SET LOCAL coa.allow_mapping_change = 'on';
SET LOCAL coa.mapping_change_reason = 'rollback 141 (maintenance window)';

DELETE FROM account_mapping
 WHERE (module, operation, role, account_code) IN (
   ('inventory','stock_dispatch','cogs_account','5000'),
   ('inventory','stock_dispatch','inventory_account','1200'),
   ('inventory','stock_return','cogs_account','5000'),
   ('inventory','stock_return','inventory_account','1200'),
   ('dept_transfer','factory_settlement','revenue_account','4000'),
   ('dept_transfer','factory_settlement','expense_account','5000'),
   ('dept_transfer','inventory_transfer','cost_account','5000'),
   ('dept_transfer','factory_variance_close','revenue_account','4000'),
   ('dept_transfer','factory_variance_close','expense_account','5000')
 );

COMMIT;
