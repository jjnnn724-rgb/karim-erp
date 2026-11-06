-- 136_coa_journal_void_only.sql — [اختياري — قرار مالك صريح مطلوب] — لا تُطبّق افتراضيًا
-- ══════════════════════════════════════════════════════════════════════════════
-- المشكلة (R-04): حذف قيد status='posted' صلب ما زال ممكنًا من مسارات تشغيلية:
--   · backend/finance-routes.js        — DELETE FROM journal_entries WHERE source_type='supplier_payment'
--   · backend/server.js:1159           — source_type='expense'
--   · backend/dispatch… (server)       — source_type='dispatch'
-- هذا يخالف "سجل غير قابل للمحو" بعد النشر.
--
-- الحل: منع الحذف الصلب على posted بإطلاق، إلا لجلسة تضع صراحةً:
--   SET LOCAL coa.allow_hard_delete = 'on';   -- للمهام المرخصة بعد تحويلها لـ void
--
-- البوابة (لا تُلغي إلا بموافقة حرفية من المالك):
--   1) تحويل مسارات الـ purge إلى منطق void/عكس (archival) مع اختبارات.
--   2) التحقق أن لا شيء آخر يعتمد على الحذف الصلب (grep + اختبارات تشغيلية).
--   3) نسخة احتياطية + تطبيق على staging أولًا + موافقة قرار مكتوب.
-- ══════════════════════════════════════════════════════════════════════════════
BEGIN;

CREATE OR REPLACE FUNCTION public.trg_fn_journal_no_hard_delete()
RETURNS trigger AS $$
BEGIN
    IF OLD.status = 'posted'
       AND COALESCE(current_setting('coa.allow_hard_delete', TRUE), '') <> 'on' THEN
        RAISE EXCEPTION 'POSTED_JOURNAL_NO_HARD_DELETE: القيد % منشور — التصحيح عبر void/قيد عكسي فقط. (للمهام المرخصة: SET LOCAL coa.allow_hard_delete = ''on'')', OLD.id
            USING ERRCODE = '23514';
    END IF;
    RETURN OLD;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_journal_no_hard_delete ON public.journal_entries;
CREATE TRIGGER trg_journal_no_hard_delete
    BEFORE DELETE ON public.journal_entries
    FOR EACH ROW EXECUTE FUNCTION public.trg_fn_journal_no_hard_delete();

COMMIT;
