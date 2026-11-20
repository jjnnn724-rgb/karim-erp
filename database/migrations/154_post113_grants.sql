-- 154_post113_grants.sql — سد فجوة الامتيازات لما بعد ترحيل 113
-- ════════════════════════════════════════════════════════════════════════════
-- المشكلة (كشفها CI على قاعدة جديدة مُرحّلة بالترتيب، 2026-11-20):
--   · 104 يمنح karim_app DML على الجداول الموجودة وقتها + يسحب PUBLIC.
--   · 113 يعيد المنح الشامل وينقل الملكية — لكن كل ما يُنشأ بعدهما (مثل
--     journal_ledger_audit في 137، وjournal_lines_audit في 138) يولد بلا أي
--     منح لـkarim_app، ولا توجد ALTER DEFAULT PRIVILEGES تمنحه للمستقبل.
--   · النتيجة: أي اتصال بأقل صلاحية (karim_app) يفشل على جداول ما بعد 113 —
--     وظهر عمليًا: DELETE FROM cost_centers يطلق SET NULL على journal_lines
--     فيستدعي محفّز التدقيق الذي يكتب journal_ledger_audit ⇒ permission denied.
-- الإصلاح (idempotent وآمن على الإنتاج):
--   1) إعادة المنح الشاملة لـkarim_app على كل الموجود (يغطي ما بعد 113).
--   2) امتيازات افتراضية للمستقبل كي لا تتكرر الفجوة مع أي ترحيل تالٍ:
--      · لمنشئ الجداول postgres: تتطلب superuser (تُنفّذ فقط إن توفرت).
--      · لـkarim_app نفسه: يملك تغيير امتيازاته الافتراضية دائمًا.
-- لا يمس بيانات ولا بنية — منح فقط. الدور المفقود ⇒ يتخطى بأمان (قاعدة بلا 104).

DO $$
DECLARE
    is_super boolean;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'karim_app') THEN
        RETURN;
    END IF;
    SELECT rolsuper INTO is_super FROM pg_roles WHERE rolname = current_user;

    EXECUTE 'GRANT USAGE ON SCHEMA public TO karim_app';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO karim_app';
    EXECUTE 'GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO karim_app';
    EXECUTE 'GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO karim_app';

    -- امتيازات المستقبل لما ينشئه postgres (العدّاد/الإنتاج كمسؤول):
    -- تغيير امتيازات دور آخر يتطلب superuser — يُنفّذ فقط إن توفرت الصلاحية.
    IF is_super THEN
        EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO karim_app';
        EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO karim_app';
    END IF;

    -- امتيازات المستقبل لما ينشئه karim_app نفسه (يملك تغيير امتيازاته دائمًا):
    EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE karim_app IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO karim_app';
    EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE karim_app IN SCHEMA public GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO karim_app';
END $$;
