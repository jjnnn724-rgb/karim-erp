-- 136_coa_journal_void_only_down.sql — رجوع بوابة منع الحذف الصلب
-- ⚠ لا تشغّلها على الإنتاج إلا بقرار مالك + نسخة احتياطية مؤكدة.
-- تُسقط المحفّظ والدالة فقط: لا بيانات تُفقد (منع الحذف لا يخزّن شيئًا).
-- الغاؤها يعيد فتح الحذف الصلب على القيود المرحّلة — أي أن البوابة A1 تُرفض
-- بعدها مباشرة، فلا تُشغَّل إلا مؤقتًا لمهمة مرخّصة ثم يُعاد تطبيق 136.
BEGIN;

DROP TRIGGER IF EXISTS trg_journal_no_hard_delete ON public.journal_entries;
DROP FUNCTION IF EXISTS public.trg_fn_journal_no_hard_delete();

COMMIT;
