-- 154_post113_grants_down.sql — تراجع منح ما بعد 113
-- يسحب الامتيازات الافتراضية التي أضافها 154 (المستقبل فقط). منح الجداول
-- القائمة تُترك عمدًا: سحبها قد يكسر تشغيلًا يعتمد عليها، والتراجع الآمن
-- هو إيقاف التوريث المستقبلي لا تجريد الصلاحيات الحالية.

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'karim_app') THEN
        EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLES FROM karim_app';
        EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE USAGE, SELECT, UPDATE ON SEQUENCES FROM karim_app';
        EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE karim_app IN SCHEMA public REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLES FROM karim_app';
        EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE karim_app IN SCHEMA public REVOKE USAGE, SELECT, UPDATE ON SEQUENCES FROM karim_app';
    END IF;
END $$;
