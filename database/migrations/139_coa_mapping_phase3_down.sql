-- 139_coa_mapping_phase3_down.sql — يسقط صفوف 139 فقط، وبشرط ألا تكون قد عُدّلت
-- ──────────────────────────────────────────────────────────────────────────────
-- القيمة يجب أن تطابق البذرة كي لا يُمحى قرار إداري لاحق (تغيير الحساب أو
-- تعطيل الصف). لا يمس أي صف من بذرة 134.

BEGIN;

DELETE FROM account_mapping
 WHERE (module, operation, role, account_code) IN (
   ('sales_pos','pos_sale','inventory_account','1200'),
   ('sales_pos','void','inventory_account','1200'),
   ('purchases','purchase_invoice','inventory_account','1200'),
   ('purchases','purchase_opening','inventory_account','1200'),
   ('purchases','purchase_opening','equity_account','3000'),
   ('procurement','supplier_payment','payable_account','2000'),
   ('procurement','supplier_payment','cash_account','1000'),
   ('procurement','supplier_payment','bank_account','1010')
 );

COMMIT;
