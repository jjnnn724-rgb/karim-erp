-- 134_coa_foundation_down.sql — رجوع مرحلي لـ 134 (للاختبار/الطوارئ فقط)
-- ⚠ لا تشغّلها على الإنتاج إلا بقرار مالك + نسخة احتياطية مؤكدة.
-- ترجع كل ما أضافته 134 فقط — لا تمس قيود/حسابات/شجرة قائمة أو مايجر قبلها.
BEGIN;

DROP TRIGGER IF EXISTS trg_coa_lock_posted_semantics ON public.chart_of_accounts;
DROP FUNCTION IF EXISTS public.trg_fn_coa_lock_posted_semantics();

DROP TRIGGER IF EXISTS trg_coa_no_cycle ON public.chart_of_accounts;
DROP FUNCTION IF EXISTS public.trg_fn_coa_no_cycle();

DROP TABLE IF EXISTS posting_failures;
DROP TABLE IF EXISTS account_mapping;
DROP TABLE IF EXISTS account_fs_mapping;

ALTER TABLE chart_of_accounts DROP CONSTRAINT IF EXISTS coa_normal_balance_check;
DROP INDEX IF EXISTS idx_coa_fs_classification;
DROP INDEX IF EXISTS idx_coa_suspense;

ALTER TABLE chart_of_accounts
    DROP COLUMN IF EXISTS updated_at,
    DROP COLUMN IF EXISTS updated_by,
    DROP COLUMN IF EXISTS created_by,
    DROP COLUMN IF EXISTS effective_to,
    DROP COLUMN IF EXISTS effective_from,
    DROP COLUMN IF EXISTS accounting_policy_ref,
    DROP COLUMN IF EXISTS is_reconcilable,
    DROP COLUMN IF EXISTS is_suspense,
    DROP COLUMN IF EXISTS is_control,
    DROP COLUMN IF EXISTS tax_category,
    DROP COLUMN IF EXISTS cash_flow_class,
    DROP COLUMN IF EXISTS fs_classification,
    DROP COLUMN IF EXISTS normal_balance,
    DROP COLUMN IF EXISTS account_subtype;

COMMIT;
