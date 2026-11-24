-- 138_journal_lines_audit.sql — رصد التلاعب بسطور القيد المرحّل (لا تعطيل)
-- ══════════════════════════════════════════════════════════════════════════════
-- Phase A / الفجوة G-01 (انظر docs/coa-audit-2026-11-05/A_VERIFY_PHASE_A.md):
-- 136 يمنع حذف الأب المرحّل، و095 يمنع تعديل هويته — لكن سطور القيد المرحّل
-- كانت قابلة للحذف/التعديل مباشرةً بـSQL بلا أي أثر (قياس V1b: سطران مُمحوان
-- بقبول وبلا صف سجل).
--
-- ليه رصد مش رفض؟ محفّظ رفض السليم محتاج استثناء «الأب مُنشأ في نفس المعاملة»
-- (وإلا أُجهض كل ترحيل: postJournal يُدرج الأب posted ثم سطوره في المعاملة نفسها)،
-- ولا يردع من يملك psql لأنه يفتح coa.allow_hard_delete بنفسه. فالكرّة التشغيلية
-- (إجهاض ترحيل واختبارات) مضمونة والردع صفر. الرصد يعطي الدليل الذي لا يُقدَّر
-- بثمن: من حرّك سطرًا في تاريخ مُغلق، ومتى، وما القيمة التي زالت.
--
-- الاستثناء الصحيح: الاستعلام عن xmin للأب — xmin::text = pg_current_xact_id()::text
-- يعني هذا الصف كُتب في هذه المعاملة (الحالة الطبيعية للترحيل، ولأي قيد أُبطل/أُعيد
-- في نفس المعاملة) ⇒ لا سجل. غير ذلك ⇒ الأب تاريخ مكتمل ⇒ أي مساس بسطره حدث
-- خارج مسار الترحيل ويُسجَّل. (مقارنة نصية لمعرف المعاملة: دقيقة لحالة «نفس
-- المعاملة»، وميلاد الـxid بعد ~4 مليار معاملة يجعلها متحفّظة نظريًا لا عملية.)
--
-- Additive بالكامل: لا يغيّر أي سطر قراءة، ولا يمنع أي كتابة. الرجوع: 138_..._down.sql.
-- ══════════════════════════════════════════════════════════════════════════════
BEGIN;

ALTER TABLE public.journal_ledger_audit
    DROP CONSTRAINT IF EXISTS journal_ledger_audit_action_check;
ALTER TABLE public.journal_ledger_audit
    ADD CONSTRAINT journal_ledger_audit_action_check
    CHECK (action IN ('void', 'unvoid', 'status_change', 'hard_delete', 'line_change'));

CREATE OR REPLACE FUNCTION public.trg_fn_journal_lines_audit()
RETURNS trigger AS $$
DECLARE
    v_entry_id  BIGINT;
    v_status    TEXT;
    v_same_tx   BOOLEAN;
    v_detail    TEXT;
    v_row       RECORD;
BEGIN
    v_entry_id := COALESCE(NEW.entry_id, OLD.entry_id);
    SELECT e.status, (e.xmin::text = pg_current_xact_id()::text)
      INTO v_status, v_same_tx
      FROM public.journal_entries e
     WHERE e.id = v_entry_id;

    -- مسودة/مُبطل، أو أب كُتب في نفس المعاملة (هذا هو الترحيل الطبيعي) ⇒ صمت
    IF v_status IS DISTINCT FROM 'posted' OR COALESCE(v_same_tx, TRUE) THEN
        RETURN NULL;
    END IF;

    v_detail := CASE TG_OP
        WHEN 'INSERT' THEN 'سطر جديد على قيد مرحّل #' || NEW.id ||
                           ' (' || NEW.account_code || ': ' || NEW.debit || '/' || NEW.credit || ')'
        WHEN 'DELETE' THEN 'حذف سطر #' || OLD.id || ' من قيد مرحّل (' ||
                           OLD.account_code || ': ' || OLD.debit || '/' || OLD.credit || ')'
        ELSE 'تعديل سطر #' || OLD.id || ' (' || OLD.account_code || ': ' || OLD.debit || '/' || OLD.credit ||
             ' ← ' || NEW.account_code || ': ' || NEW.debit || '/' || NEW.credit || ')'
    END;

    FOR v_row IN
        SELECT e.id, e.entry_no, e.date, e.source_type, e.source_id, e.status
          FROM public.journal_entries e
         WHERE e.id = v_entry_id
    LOOP
        INSERT INTO public.journal_ledger_audit
            (action, entry_id, entry_no, entry_date, source_type, source_id,
             from_status, to_status, line_count, debit_total, actor_name, reason)
        SELECT 'line_change', v_row.id, v_row.entry_no, v_row.date, v_row.source_type, v_row.source_id,
               v_row.status, v_row.status,
               (SELECT COUNT(*)::int FROM public.journal_lines l WHERE l.entry_id = v_row.id),
               (SELECT COALESCE(SUM(l.debit), 0)::numeric(14,2) FROM public.journal_lines l WHERE l.entry_id = v_row.id),
               NULL, 'مساس بسطر خارج مسار الترحيل — ' || v_detail || ' | ' || SESSION_USER;
    END LOOP;
    RETURN NULL;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_journal_lines_audit ON public.journal_lines;
CREATE TRIGGER trg_journal_lines_audit
    AFTER INSERT OR UPDATE OR DELETE ON public.journal_lines
    FOR EACH ROW EXECUTE FUNCTION public.trg_fn_journal_lines_audit();

COMMENT ON CONSTRAINT journal_ledger_audit_action_check ON public.journal_ledger_audit IS
    'line_change = مساس بسطر قيد مرحّل من خارج معاملة إنشائه (رصد G-01، لا رفض)';

COMMIT;
