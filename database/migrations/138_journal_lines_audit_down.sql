-- 138_journal_lines_audit_down.sql — رجوع مرحلي لـ 138 (للاختبار/الطوارئ فقط)
-- ⚠ لا تشغّلها على الإنتاج إلا بقرار مالك + نسخة احتياطية مؤكدة.
-- ترجع ما أضافته 138 فقط: المحفّظ والدالة وتضييق CHECK مرة أخرى.
-- ملاحظة: صفوف line_change لا يسعها البقاء تحت CHECK الضيّق، فتُمحى هنا —
-- هي دليل رصد التلاعب، فلذلك انسخها (CREATE TABLE ... AS SELECT) قبل التشغيل لو
-- كانت مطلوبة. الرجوع عن الحذف نفسه: 137_..._down ثم إعادة 137 يحذفان الجدول كاملًا.
BEGIN;

DROP TRIGGER IF EXISTS trg_journal_lines_audit ON public.journal_lines;
DROP FUNCTION IF EXISTS public.trg_fn_journal_lines_audit();

DELETE FROM public.journal_ledger_audit WHERE action = 'line_change';

ALTER TABLE public.journal_ledger_audit
    DROP CONSTRAINT IF EXISTS journal_ledger_audit_action_check;
ALTER TABLE public.journal_ledger_audit
    ADD CONSTRAINT journal_ledger_audit_action_check
    CHECK (action IN ('void', 'unvoid', 'status_change', 'hard_delete'));

-- السجل يجب أن يقول الحقيقة بعد الرجوع: بدون هذا يحسب المشغّل 138 مطبَّقة
-- ولا يُعيدها عند الترقية التالية (الرجوع اليدوي بـpsql لا يلمس schema_migrations).
DO $$
BEGIN
    IF to_regclass('public.schema_migrations') IS NOT NULL THEN
        DELETE FROM public.schema_migrations
         WHERE version IN ('138_journal_lines_audit.sql', '138_journal_lines_audit_down.sql');
    END IF;
END $$;

COMMIT;
