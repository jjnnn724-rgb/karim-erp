-- ══════════════════════════════════════════════════════════════════════════════
-- 158_audit_allow_actor_null.sql — السماح بإخلاء actor_user_id عند حذف مستخدم
-- ══════════════════════════════════════════════════════════════════════════════
-- المشكلة (اكتُشفت 2026-11-20 أثناء تشغيل اختبارات dept-transfer):
--   pos_audit_logs.actor_user_id REFERENCES users(id) ON DELETE SET NULL
--   لكن حارس append-only (003 §5.4) يمنع *أي* UPDATE — ومنه UPDATE الذي
--   تُصدره Postgres نفسها لتنفيذ SET NULL. النتيجة: حذف أي مستخدم له سجل
--   تدقيق يفشل برسالة مضلّلة «pos_audit_logs is append-only…».
--
-- الحل: السماح بحالة واحدة فقط — تحويل actor_user_id من قيمة إلى NULL مع
--   بقاء *كل* الأعمدة الأخرى كما هي حرفيًا. أي تعديل آخر يبقى مرفوضًا.
--   سلامة سلسلة الحمض محفوظة: pos_audit_chain_payload (118) لا يشمل
--   actor_user_id، فيبقى entry_hash صالحًا للتحقق.
--
-- ملاحظة: actor_username / actor_role نصّيان ومحفوظان مع السجل، فالتدقيق
--   لا يفقد هوية الفاعل بعد حذف حسابه.
-- ══════════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION trg_fn_pos_prevent_audit_modification()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    -- الاستثناء الوحيد: تنفيذ ON DELETE SET NULL لمفتاح actor_user_id.
    IF TG_OP = 'UPDATE'
       AND OLD.actor_user_id IS NOT NULL
       AND NEW.actor_user_id IS NULL
       AND NEW.occurred_at    IS NOT DISTINCT FROM OLD.occurred_at
       AND NEW.actor_username IS NOT DISTINCT FROM OLD.actor_username
       AND NEW.actor_role     IS NOT DISTINCT FROM OLD.actor_role
       AND NEW.actor_ip       IS NOT DISTINCT FROM OLD.actor_ip
       AND NEW.action         IS NOT DISTINCT FROM OLD.action
       AND NEW.table_name     IS NOT DISTINCT FROM OLD.table_name
       AND NEW.row_pk         IS NOT DISTINCT FROM OLD.row_pk
       AND NEW.data_before    IS NOT DISTINCT FROM OLD.data_before
       AND NEW.data_after     IS NOT DISTINCT FROM OLD.data_after
       AND NEW.reason         IS NOT DISTINCT FROM OLD.reason
       AND NEW.request_id     IS NOT DISTINCT FROM OLD.request_id
       AND NEW.metadata       IS NOT DISTINCT FROM OLD.metadata
       AND NEW.prev_hash      IS NOT DISTINCT FROM OLD.prev_hash
       AND NEW.entry_hash     IS NOT DISTINCT FROM OLD.entry_hash
    THEN
        RETURN NEW;
    END IF;

    RAISE EXCEPTION 'pos_audit_logs is append-only: UPDATE and DELETE are forbidden (attempt by user %, role %)',
        current_setting('app.user_id', true), current_setting('app.user_role', true);
END $$;

COMMIT;
