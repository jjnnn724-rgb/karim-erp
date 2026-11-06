-- 137_journal_void_audit_down.sql — رجوع مرحلي لـ 137 (للاختبار/الطوارئ فقط)
-- ⚠ لا تشغّلها على الإنتاج إلا بقرار مالك + نسخة احتياطية مؤكدة.
-- ترجع ما أضافته 137 وحدها. الأعمدة nullable فلا فقدان بيانات لأي صف قائم؛
-- حذف جدول السجل يفقد تاريخ الإبطالات المُسجَّل — صدّره أولًا إن لزم:
--   COPY journal_ledger_audit TO '/tmp/journal_ledger_audit.csv' CSV HEADER;
BEGIN;

-- ترتيب الرجوع: 138 يكتب في هذا الجدول من محفّظ على journal_lines. لو أُبقي
-- محفّظ 138 وحُذف الجدول، انهار كل إدراج/حذف سطر بعد ذلك. ارجع 138 أولًا.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_trigger t
                 JOIN pg_class c ON c.oid = t.tgrelid
                WHERE t.tgname = 'trg_journal_lines_audit' AND c.relname = 'journal_lines'
                  AND NOT t.tginternal) THEN
        RAISE EXCEPTION '138 لم يُرجع بعد: محفّظ trg_journal_lines_audit ما زال يكتب في journal_ledger_audit — شغّل 138_journal_lines_audit_down.sql أولًا'
            USING ERRCODE = 'P0001';
    END IF;
END $$;

DROP TRIGGER IF EXISTS trg_journal_delete_audit ON public.journal_entries;
DROP FUNCTION IF EXISTS public.trg_fn_journal_delete_audit();

DROP TRIGGER IF EXISTS trg_journal_status_audit ON public.journal_entries;
DROP FUNCTION IF EXISTS public.trg_fn_journal_status_audit();

DROP TABLE IF EXISTS public.journal_ledger_audit;

DROP INDEX IF EXISTS public.idx_journal_voided_at;
ALTER TABLE public.journal_entries DROP CONSTRAINT IF EXISTS journal_entries_voided_by_fkey;
ALTER TABLE public.journal_entries DROP COLUMN IF EXISTS void_reason;
ALTER TABLE public.journal_entries DROP COLUMN IF EXISTS voided_by_name;
ALTER TABLE public.journal_entries DROP COLUMN IF EXISTS voided_by;
ALTER TABLE public.journal_entries DROP COLUMN IF EXISTS voided_at;

COMMIT;
