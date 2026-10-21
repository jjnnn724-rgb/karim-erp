-- 095_journal_db_invariants.sql — Stage 8 Financial Core (Enterprise, 2026-10-03)
-- رفع ضمانتي النواة المالية من مستوى التطبيق إلى مستوى القاعدة:
-- 1) التوازن عند الالتزام: أي قيد status='posted' يجب أن يتوازن عند COMMIT
--    (CONSTRAINT TRIGGER مؤجَّل — يرى الأسطر بعد اكتمالها). التسامح ±0.01
--    مطابق لسياسة postJournal (round2 لكل سطر). المسودات مستثناة عمدًا.
-- 2) حصانة هوية القيد المنشور: date/memo/source_type/source_id لا تُعدَّل
--    بعد النشر (التصحيح دائمًا بقيود عكسية/إبطال). تغيير status مسموح
--    (draft→posted، posted→void عبر المسارات المرخصة).
-- ملاحظة نطاق (موثقة في 07): حذف القيود المنشورة يبقى مسموحًا مؤقتًا لأن
-- مسارات تشغيلية قائمة تعتمد عليه (purge expense / dispatch delete) —
-- التحويل لـ void-first قرار لاحق منفصل.
BEGIN;

CREATE OR REPLACE FUNCTION public.trg_fn_journal_posted_balance()
RETURNS trigger AS $$
DECLARE
    v_lines int;
    v_diff numeric;
BEGIN
    IF NEW.status = 'posted' THEN
        SELECT COUNT(*)::int,
               COALESCE(SUM(debit),0) - COALESCE(SUM(credit),0)
          INTO v_lines, v_diff
          FROM public.journal_lines WHERE entry_id = NEW.id;
        -- منشور بلا سطرين على الأقل = قيد غير صالح (مطابق لسياسة postJournal)
        IF v_lines < 2 THEN
            RAISE EXCEPTION 'UNBALANCED_POSTED_JOURNAL: % منشور بـ % سطر فقط (المطلوب ≥2)', NEW.id, v_lines
                USING ERRCODE = '23514';
        END IF;
        IF ABS(v_diff) > 0.011 THEN
            RAISE EXCEPTION 'UNBALANCED_POSTED_JOURNAL: % مدين≠دائن عند الالتزام (فرق %)', NEW.id, v_diff
                USING ERRCODE = '23514';
        END IF;
    END IF;
    RETURN NULL;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_journal_posted_balance ON public.journal_entries;
CREATE CONSTRAINT TRIGGER trg_journal_posted_balance
    AFTER INSERT OR UPDATE OF status ON public.journal_entries
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION public.trg_fn_journal_posted_balance();

CREATE OR REPLACE FUNCTION public.trg_fn_journal_posted_identity()
RETURNS trigger AS $$
BEGIN
    IF OLD.status = 'posted' THEN
        IF NEW.date <> OLD.date
           OR NEW.memo IS DISTINCT FROM OLD.memo
           OR NEW.source_type <> OLD.source_type
           OR NEW.source_id IS DISTINCT FROM OLD.source_id THEN
            RAISE EXCEPTION 'POSTED_JOURNAL_IMMUTABLE: حقول هوية القيد المنشور لا تُعدَّل (%) — التصحيح بقيود عكسية أو إبطال', OLD.id
                USING ERRCODE = '23514';
        END IF;
    END IF;
    RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_journal_posted_identity ON public.journal_entries;
CREATE TRIGGER trg_journal_posted_identity
    BEFORE UPDATE ON public.journal_entries
    FOR EACH ROW EXECUTE FUNCTION public.trg_fn_journal_posted_identity();

COMMIT;
