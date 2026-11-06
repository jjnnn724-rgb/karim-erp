-- 141_coa_mapping_stock_transfer_down.sql — يسقط صفوف 141 فقط وبشرط مطابقة القيمة المبذورة.

BEGIN;

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
