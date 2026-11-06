-- 137_journal_void_audit.sql — سجل التصحيح: من أبطل أي قيد، ومتى، ولماذا
-- ══════════════════════════════════════════════════════════════════════════════
-- Phase A (2026-11-06) — مكمّل لـ 136 (منع الحذف الصلب) وليس بديلًا عنه.
--
-- الفجوة المرصودة (Phase 0 / A5_REPORT): على الإنتاج لا يمكن إثبات من حذف
-- القيود ولا عددها — لا trigger تدقيق على journal_*، و pos_audit_logs بها
-- صف قيود واحد (0)، و system_reset_audit فارغ. تسعة فجوات entry_no داخلية
-- (20261003-0004، 20261005-0188/0197/0234/0245/0292/0333، 20261010-0796/0797)
-- هي الدليل المادي الوحيد، وهي لا تقول ولا فاعلًا ولا تاريخًا.
--
-- ما يضاف هنا (Additive بالكامل — لا يغيّر سطر قراءة واحدًا):
--   1) أربعة أعمدة nullable على journal_entries: voided_at/voided_by/
--      voided_by_name/void_reason. لا كسر لأي INSERT قائم (nullable).
--   2) جدول journal_ledger_audit ومحفّظان عليه: AFTER UPDATE OF status (كل
--      انتقال حالة) و BEFORE DELETE (أي حذف صلب سُمح به صراحةً عبر
--      coa.allow_hard_delete='on' — مهمة مرخّصة، تُترك بالدليل).
--   3) لا trigger على journal_lines: حذف الأسطر التالي لحذف الأب يسقط بـ
--      ON DELETE CASCADE فيغطيه سجل الأب (عدًّا ومبلغًا). الفجوة المتبقية —
--      تعديل/حذف سطور مباشرةً تحت أبٍ مُرحَّل — موثّقة G-01 في
--      docs/coa-audit-2026-11-05/A_VERIFY_PHASE_A.md وتنتظر قرار المالك.
--
-- بوابة التطبيق (حرفيًا كما في 136): staging أولًا → اختبارات → نسخة احتياطية
-- → موافقة مكتوبة على الإنتاج. الرجوع: 137_journal_void_audit_down.sql.
--
-- ترتيب النشر: 136 + 137 قبل إعادة تشغيل الـ backend على أي قاعدة. الكود يعمل
-- مع قاعدة غير مهاجرة (journal-void.js::hasVoidColumns) لكنه يسجّل الحالة فقط
-- بلا فاعل/سبب/سجل — أي أعمى تدقيقيًا، وهو أسوأ ما في الترتيبين.
-- ══════════════════════════════════════════════════════════════════════════════
BEGIN;

-- ─── 1) أعمدة الإبطال (nullable — صفر تغيير سلوكي) ──────────────────────────
ALTER TABLE public.journal_entries ADD COLUMN IF NOT EXISTS voided_at      TIMESTAMPTZ;
ALTER TABLE public.journal_entries ADD COLUMN IF NOT EXISTS voided_by      BIGINT;
ALTER TABLE public.journal_entries ADD COLUMN IF NOT EXISTS voided_by_name VARCHAR(120);
ALTER TABLE public.journal_entries ADD COLUMN IF NOT EXISTS void_reason    TEXT;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'journal_entries_voided_by_fkey') THEN
        ALTER TABLE public.journal_entries
            ADD CONSTRAINT journal_entries_voided_by_fkey
            FOREIGN KEY (voided_by) REFERENCES public.users(id) ON DELETE SET NULL;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_journal_voided_at ON public.journal_entries(voided_at) WHERE voided_at IS NOT NULL;

COMMENT ON COLUMN public.journal_entries.voided_at IS 'لحظة الإبطال — يملؤها مسار voidSourceJournals/voidJournalById';
COMMENT ON COLUMN public.journal_entries.void_reason IS 'سبب الإبطال التشغيلي (مراجعة/تعديل/حذف مستند)';

-- ─── 2) جدول سجل التصحيح ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.journal_ledger_audit (
    id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    at            TIMESTAMPTZ   NOT NULL DEFAULT now(),
    action        VARCHAR(16)   NOT NULL CHECK (action IN ('void','unvoid','status_change','hard_delete')),
    entry_id      BIGINT        NOT NULL,
    entry_no      VARCHAR(40)   NOT NULL,
    entry_date    DATE          NOT NULL,
    source_type   VARCHAR(60)   NOT NULL,
    source_id     VARCHAR(160),
    from_status   VARCHAR(12),
    to_status     VARCHAR(12),
    line_count    INT,
    debit_total   NUMERIC(14,2),
    actor_user_id BIGINT        REFERENCES public.users(id) ON DELETE SET NULL,
    actor_name    VARCHAR(120),
    reason        TEXT,
    db_user       TEXT          NOT NULL DEFAULT SESSION_USER
);
CREATE INDEX IF NOT EXISTS idx_jla_entry ON public.journal_ledger_audit(entry_no, at);
CREATE INDEX IF NOT EXISTS idx_jla_time  ON public.journal_ledger_audit(at);
CREATE INDEX IF NOT EXISTS idx_jla_action ON public.journal_ledger_audit(action, at);

-- ─── 2a) انتقال الحالة ⇒ صف سجل ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.trg_fn_journal_status_audit()
RETURNS trigger AS $$
BEGIN
    IF NEW.status = OLD.status THEN
        RETURN NULL;
    END IF;
    INSERT INTO public.journal_ledger_audit
        (action, entry_id, entry_no, entry_date, source_type, source_id,
         from_status, to_status, line_count, debit_total, actor_user_id, actor_name, reason)
    SELECT CASE
               WHEN NEW.status = 'void' THEN 'void'
               WHEN OLD.status = 'void' THEN 'unvoid'
               ELSE 'status_change'
           END,
           NEW.id, NEW.entry_no, NEW.date, NEW.source_type, NEW.source_id,
           OLD.status, NEW.status,
           (SELECT COUNT(*)::int FROM public.journal_lines l WHERE l.entry_id = NEW.id),
           (SELECT COALESCE(SUM(l.debit), 0)::numeric(14,2) FROM public.journal_lines l WHERE l.entry_id = NEW.id),
           NEW.voided_by, NEW.voided_by_name, NEW.void_reason;
    RETURN NULL;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_journal_status_audit ON public.journal_entries;
CREATE TRIGGER trg_journal_status_audit
    AFTER UPDATE OF status ON public.journal_entries
    FOR EACH ROW EXECUTE FUNCTION public.trg_fn_journal_status_audit();

-- ─── 2b) الحذف الصلب المرخّص ⇒ أثر لا يُمحى مع المحو ─────────────────────────
-- 136 يرفض حذف المرحّل؛ ما يمرّ هو المسودات/المُبطلة أو مهمة مرخّصة تضع
-- SET LOCAL coa.allow_hard_delete = 'on'. حذف الأسطر يحدث بـ ON DELETE CASCADE
-- مع الأب، فالتدقيق عند الأب (بعدّ الأسطر وإجمالي المدين) يغطيها: BEFORE DELETE
-- يرى الأسطر قبل زوالها.
CREATE OR REPLACE FUNCTION public.trg_fn_journal_delete_audit()
RETURNS trigger AS $$
BEGIN
    INSERT INTO public.journal_ledger_audit
        (action, entry_id, entry_no, entry_date, source_type, source_id,
         from_status, to_status, line_count, debit_total, actor_name, reason)
    SELECT 'hard_delete', OLD.id, OLD.entry_no, OLD.date, OLD.source_type, OLD.source_id,
           OLD.status, NULL,
           (SELECT COUNT(*)::int FROM public.journal_lines l WHERE l.entry_id = OLD.id),
           (SELECT COALESCE(SUM(l.debit), 0)::numeric(14,2) FROM public.journal_lines l WHERE l.entry_id = OLD.id),
           OLD.voided_by_name,
           CASE WHEN COALESCE(current_setting('coa.allow_hard_delete', TRUE), '') = 'on'
                THEN 'حذف صلب تحت بوابة coa.allow_hard_delete=on' ELSE NULL END;
    RETURN OLD;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_journal_delete_audit ON public.journal_entries;
CREATE TRIGGER trg_journal_delete_audit
    BEFORE DELETE ON public.journal_entries
    FOR EACH ROW EXECUTE FUNCTION public.trg_fn_journal_delete_audit();

COMMIT;
