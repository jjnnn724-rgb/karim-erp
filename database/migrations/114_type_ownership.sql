-- 114_type_ownership.sql — نقل ملكية الأنواع (enum/composite) إلى دور التطبيق
-- ═══════════════════════════════════════════════════════════════════════
-- الخلفية (migration 113 نقل الجداول والـsequences إلى karim_app، والأنواع
-- بقيت مع postgres):
--   · التطبيق ينفّذ DDL وقت التشغيل، ومنها:
--       ALTER TYPE pos_zatca_status ADD VALUE IF NOT EXISTS 'skipped_cancelled';
--     وALTER TYPE يتطلب **ملكية النوع** ⇒ دور التطبيق بلا ملكية يفشل:
--       ERROR: must be owner of type pos_zatca_status   (SQLSTATE 42501)
--   · النتيجة: ensureZatcaSchema() يفشل عند كل إقلاع ⇒
--       [zatca-settings] boot schema failed
--       و[zatca-poller] يخطئ كل 15 ثانية (عاصفة أخطاء تملأ السجل).
--
-- لماذا نصلح الملكية ولماذا هي الأولى:
--   · القيم الناقصة للـenum موجودة أصلًا (أُضيفت قبل التحويل إلى الدور
--     المحدود) ⇒ لا حاجة لـADD VALUE هنا؛ الخلل هو الملكية وحدها.
--   · نفس المبدأ الذي حركة 113 طبّقته على الجداول: التطبيق مالك ما
--     يعدّله وقت التشغيل، وبغير ذلك يفشل صامتًا عند كل إقلاع.
--   · أنواع الإضافات (pgcrypto/pg_trgm) ملكها postgres بحكم الإضافة نفسها
--     وهي ليست في public ⇒ لا يمسّها هذا الملف.
--
-- idempotent: نعم (DO blocks + فحص الملكية قبل النقل).
--
-- ---rollback: إعادة الأنواع إلى postgres:
--   DO $$ DECLARE r record BEGIN
--     FOR r IN SELECT t.typname FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
--               WHERE n.nspname = 'public' AND t.typtype = 'e' LOOP
--       EXECUTE format('ALTER TYPE public.%I OWNER TO postgres', r.typname);
--     END LOOP; END $$;

-- ─── 1) نقل ملكية الأنواع إلى دور التطبيق ────────────────────────────────
-- ملاحظة ١: النوع composite مربوط بجدوله ⇒ لا يُنقل بـALTER TYPE (PostgreSQL
--             يرفض: "is a table's row type") — يُنقل الجدول في البند ٢
--             ومعه نوعه تلقائيًا.
-- ملاحظة ٢: أنواع الإضافات (pgcrypto/pg_trgm) ليست في public ⇒ لا تمسّها.
DO $$
DECLARE
    r record;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'karim_app') THEN
        RAISE NOTICE 'دور karim_app غير موجود — تخطّى نقل الملكية.';
        RETURN;
    END IF;
    FOR r IN
        SELECT t.typname
        FROM pg_type t
        JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE n.nspname = 'public'
          AND t.typtype IN ('e', 'd')
          AND t.typrelid = 0
          AND t.typowner <> (SELECT oid FROM pg_roles WHERE rolname = 'karim_app')
    LOOP
        EXECUTE format('ALTER TYPE public.%I OWNER TO karim_app', r.typname);
    END LOOP;
END $$;

-- ─── 2) جدول الفحص وتسلسله: أنشأهما 113 بعد نقل الجداول ⇒ بقيا postgres ──
DO $$
DECLARE
    r record;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'karim_app') THEN
        RETURN;
    END IF;
    FOR r IN
        SELECT c.relname, c.relkind
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relkind IN ('r', 'S')
          AND c.relname LIKE 'karim_app_role_probe%'
          AND c.relowner <> (SELECT oid FROM pg_roles WHERE rolname = 'karim_app')
    LOOP
        IF r.relkind = 'S' THEN
            EXECUTE format('ALTER SEQUENCE public.%I OWNER TO karim_app', r.relname);
        ELSE
            EXECUTE format('ALTER TABLE public.%I OWNER TO karim_app', r.relname);
        END IF;
    END LOOP;
END $$;

-- ─── 3) إثبات: لم يبقَ نوع مستقلّ في public خارج ملكية دور التطبيق ───────
DO $$
DECLARE leftover int;
BEGIN
    SELECT count(*) INTO leftover
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public'
      AND t.typtype IN ('e', 'd')
      AND t.typrelid = 0
      AND t.typowner <> (SELECT oid FROM pg_roles WHERE rolname = 'karim_app');
    IF leftover > 0 THEN
        RAISE NOTICE 'بقي % أنواع مستقلة خارج ملكية دور التطبيق (تُراجع يدويًا).', leftover;
    ELSE
        RAISE NOTICE 'كل الأنواع المستقلة في public تعود لدور التطبيق.';
    END IF;
END $$;
