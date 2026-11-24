-- 142_account_mapping_guardrails_down.sql — يسقط الحراس فقط
-- ⚠ سجل التدقيق account_mapping_audit لا يُسقط: أثر رقابي يُحفظ حتى لو رجعنا
-- عن الحارس (قرار مالك + نسخة احتياطية مطلوبان للطوارئ).
BEGIN;

DROP TRIGGER IF EXISTS trg_account_mapping_audit ON public.account_mapping;
DROP TRIGGER IF EXISTS trg_account_mapping_guard ON public.account_mapping;
DROP FUNCTION IF EXISTS public.trg_fn_account_mapping_audit();
DROP FUNCTION IF EXISTS public.trg_fn_account_mapping_guard();
DROP TABLE IF EXISTS account_mapping_type_rule;

COMMIT;
