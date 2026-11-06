-- 135_coa_global_sections_down.sql — رجوع مرحلي لـ 135 (للاختبار/الطوارئ فقط)
-- ⚠ لا تحذف أي حساب عليه حركة — الحسابات الجديدة بلا حركة إطلاقًا عند التطبيق.
BEGIN;
DELETE FROM chart_of_accounts
 WHERE code IN ('8103','8102','8101','81','8',
                '7205','7204','7203','7202','7201','72',
                '7104','7103','7102','7101','71')
   AND NOT EXISTS (SELECT 1 FROM journal_lines l WHERE l.account_code = chart_of_accounts.code);
COMMIT;
