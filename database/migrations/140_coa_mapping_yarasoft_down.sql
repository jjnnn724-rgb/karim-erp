-- 140_coa_mapping_yarasoft_down.sql — يسقط صف 140 فقط وبشرط مطابقة القيمة المبذورة.

BEGIN;

DELETE FROM account_mapping
 WHERE module = 'yarasoft' AND operation = 'prebooks'
   AND role = 'cash_account' AND account_code = '1000';

COMMIT;
