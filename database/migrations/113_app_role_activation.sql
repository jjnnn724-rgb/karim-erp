-- 113_app_role_activation.sql — تفعيل دور التطبيق + تطهير سجل GRANT
-- ═══════════════════════════════════════════════════════════════════════
-- الهدف: تشغيل التطبيق بدور محدود الصلاحيات (karim_app) بدل superuser،
--        مع تطهير الامتيازات الموروثة (PUBLIC) التي منحتها migration 003.
--
-- الخلفية (migration 104):
--   · karim_app أُنشئ NOLOGIN + DML على 212 جدولاً + سحب امتيازات PUBLIC.
--   · خطوة التفعيل كانت مؤجَّلة: "ALTER ROLE karim_app LOGIN PASSWORD …"
--     ثم DB_USER=karim_app في .env.
--   · observó: PUBLIC ما زال يحمل SELECT على 4 جداول + INSERT على جدول
--     (جداول أُنشئت بعد 104 أو مُنحت صراحةً).
--
-- لماذا OWNER وليس mere DML؟
--   التطبيق ينفّذ DDL وقت التشغيل في مواضع (idempotent):
--     · ALTER TABLE … ADD COLUMN IF NOT EXISTS  (attendance-portal, dispatch-notifier)
--     · CREATE TABLE IF NOT EXISTS              (hr-routes, …)
--     · CREATE INDEX IF NOT EXISTS
--   وALTER TABLE يتطلب ملكية الجدول ⇒ karma_app بلا ملكية يفشل.
--   ⇒ نجعله مالكًا لجداول التطبيق (يستطيع تعديلها) **دون** أن يكون superuser:
--     لا CREATEDB · لا REPLICATION · لا BYPASSRLS · لا قراءة قواعد أخرى.
--
-- idempotent: نعم (DO blocks + تحقّق من الملكية قبل النقل).
--
---rollback: استرجاع مالك الجداول إلى postgres + إعادة امتيازات PUBLIC:
--   DO $$ DECLARE r record BEGIN
--     FOR r IN SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
--               WHERE n.nspname='public' AND c.relkind='r' LOOP
--       EXECUTE format('ALTER TABLE %I OWNER TO postgres', r.relname);
--     END LOOP; END $$;
--   GRANT ALL ON ALL TABLES IN SCHEMA public TO PUBLIC;   -- غير مستحسن
--   GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO PUBLIC;

-- ─── 1) تفعيل الدخول للدور (كلمة المرور تُضبط وقت التشغيل خارج الـmigration) ───
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'karim_app') THEN
        CREATE ROLE karim_app NOLOGIN;
    END IF;
    EXECUTE 'ALTER ROLE karim_app LOGIN';
    EXECUTE 'ALTER ROLE karim_app NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS';
    COMMENT ON ROLE karim_app IS
        'دور تشغيل التطبيق. مالك جداول التطبيق (DDL وقت التشغيل) — ليس superuser. أعيدOwnership إلى postgres عند التراجع.';
END $$;

-- ─── 2) امتيازات المخططات ───
GRANT USAGE, CREATE ON SCHEMA public TO karim_app;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;

-- ─── 3) نقل ملكية جداول التطبيق و sequences إلى الدور المحدود ───
-- ملاحظة: الـsequences المرتبطة بعمود (serial) تتبع ملكية الجدول تلقائياً
--         ⇒ لا يجوز نقل ملكيتها مباشرة ("cannot change owner of sequence").
DO $$
DECLARE
    r record;
BEGIN
    FOR r IN
        SELECT c.relname, c.relkind
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relkind IN ('r', 'p', 'S', 'v', 'm')
          AND c.relowner <> (SELECT oid FROM pg_roles WHERE rolname = 'karim_app')
          -- نستثني الـsequences المرتبطة بعمود (serial/identity) — فهي تتبع
          -- ملكية الجدول تلقائياً ولا يجوز نقل ملكيتها مباشرة.
          AND NOT EXISTS (
              SELECT 1 FROM pg_depend d
              WHERE d.objid = c.oid
                AND d.deptype IN ('a', 'i')
                AND d.refobjid <> 0
                AND d.refobjsubid > 0
          )
    LOOP
        IF r.relkind = 'S' THEN
            EXECUTE format('ALTER SEQUENCE %I OWNER TO karim_app', r.relname);
        ELSIF r.relkind = 'm' THEN
            EXECUTE format('ALTER MATERIALIZED VIEW %I OWNER TO karim_app', r.relname);
        ELSIF r.relkind = 'v' THEN
            EXECUTE format('ALTER VIEW %I OWNER TO karim_app', r.relname);
        ELSE
            EXECUTE format('ALTER TABLE %I OWNER TO karim_app', r.relname);
        END IF;
    END LOOP;
END $$;

-- ─── 4) امتيازات التشغيل على الجداول/التسلسلات/الدوال ───
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO karim_app;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO karim_app;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO karim_app;

-- ─── 5) تطهير سجل GRANT: PUBLIC لا يملك شيئًا في مخططات التطبيق ───
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;

-- ─── 6) منع تسريب الامتيازات للمستقب�� (default privileges) ───
DO $$
DECLARE
    r record;
BEGIN
    FOR r IN SELECT rolname FROM pg_roles WHERE rolname IN ('postgres', 'karim_app') LOOP
        EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE ALL ON TABLES FROM PUBLIC', r.rolname);
        EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE ALL ON SEQUENCES FROM PUBLIC', r.rolname);
        EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM PUBLIC', r.rolname);
    END LOOP;
END $$;

-- ─── 7) جدول فحص سريع: يثبت أن دور التطبيق يستطيع الكتابة فعليًا ───
CREATE TABLE IF NOT EXISTS karim_app_role_probe (
    id BIGSERIAL PRIMARY KEY,
    note TEXT,
    at TIMESTAMPTZ DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON karim_app_role_probe TO karim_app;
GRANT USAGE, SELECT ON SEQUENCE karim_app_role_probe_id_seq TO karim_app;
