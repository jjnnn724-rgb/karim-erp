-- 104_app_role_least_privilege.sql — دور مخصّص للتطبيق + سحب صلاحيات PUBLIC
-- ═══════════════════════════════════════════════════════════════════════════
-- المشكلة (تدقيق 2026-10-21): migration 003 أعطى PUBLIC صلاحيات كاملة على
-- كل الجداول والتسلسلات في public:
--     GRANT ALL ON ALL TABLES    IN SCHEMA public TO PUBLIC;
--     GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO PUBLIC;
-- أي دور في القاعدة (حتى دور بلا أي امتياز) كان读写 كل الجداول — بما فيها
-- الرواتب والحضور والفواتير. والأسوأ: الصلاحيات تُورَث تلقائيًا لكل جدول
-- جديد يُنشأ لاحقًا.
--
-- ما يفعله هذا الملف:
--   1. ينشئ دور karim_app (بلا دخول افتراضيًا — يفعّله المسؤول بكلمة يختارها).
--   2. يمنح دور karim_app فقط ما يحتاجه: DML على الجداول + USAGE على التسلسلات.
--   3. يسحب كل شيء من PUBLIC، ويمنح PUBLIC قراءة محدودة على جداول العرض.
--   4. يسحب الصلاحيات الافتراضية (default privileges) حتى لا تُمنح PUBLIC
--      تلقائيًا على الجداول المستقبلية.
--
-- ملاحظات مهمة:
--   · التطبيق الحالي يتصل بـ DB_USER=postgres (superuser) → يتجاوز كل
--     الصلاحيات، فالتطبيق الحالي لا يتأثر إطلاقًا بهذا الملف.
--     التحويل إلى دور مخصّص خطوة تالية: ALTER ROLE karim_app LOGIN PASSWORD … ثم
--     DB_USER=karim_app في .env.
--   · idempotent: يمكن إعادة تشغيله بلا أثر.
--   · التراجع: GRANT ALL ON ALL TABLES IN SCHEMA public TO PUBLIC;
--     GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO PUBLIC;

-- ── 1) دور التطبيق ───────────────────────────────────────────────────────
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'karim_app') THEN
        CREATE ROLE karim_app NOLOGIN;
        COMMENT ON ROLE karim_app IS
            'دور تشغيل Karim ERP. يفعّله المسؤول: ALTER ROLE karim_app LOGIN PASSWORD ''<password>'' — ولا تُوضع كلمة المرور في ملفات الترحيل.';
    END IF;
END $$;

-- ── 2) منح دور التطبيق ما يحتاجه ────────────────────────────────────────
-- DML كامل على جداول public (التطبيق ينشئ/يقرأ/يعدّل/يحذف صفوفًا).
GRANT USAGE ON SCHEMA public TO karim_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO karim_app;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO karim_app;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO karim_app;

-- ── 3) سحب كل شيء من PUBLIC ──────────────────────────────────────────────
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;

-- ── 4) منع توارث الصلاحيات في الجداول المستقبلية ────────────────────────
-- بدون هذا السطر: كل جدول ينشئه مشغّل الترحيلات لاحقًا يرث GRANT ALL
-- لـPUBLIC تلقائيًا (وهو بالضبط ما حدث في 003).
DO $$
DECLARE
    r record;
BEGIN
    FOR r IN SELECT rolname FROM pg_roles WHERE rolcanlogin AND rolname <> 'postgres' LOOP
        EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE ALL ON TABLES FROM PUBLIC', r.rolname);
        EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE ALL ON SEQUENCES FROM PUBLIC', r.rolname);
    END LOOP;
END $$;

-- ── 5) جداول العرض التي يُسمح لـPUBLIC بقراءتها فقط ──────────────────────
-- قراءة عامة لا تكتب: شاشات المنيو العامة وملفات الإعداد المقروءة فقط.
GRANT SELECT ON TABLE menu_board_settings TO PUBLIC;
GRANT SELECT ON TABLE public.inventory TO PUBLIC;
GRANT SELECT ON TABLE public.inventory_location_balances TO PUBLIC;

-- ── 6) سجل التدقيق: append-only للجميع (كما كان) ─────────────────────────
GRANT SELECT, INSERT ON TABLE pos_audit_logs TO PUBLIC;
REVOKE UPDATE, DELETE, TRUNCATE ON TABLE pos_audit_logs FROM PUBLIC;

-- ── 7) أعمدة إعدادات الواجهة (قابلة للاستمرار عبر CRUD) ────────────────────
-- هذه الأعمدة كان يُحفظها الـCRUD ثم تُسقَط بصمت (ليست في whitelist
-- جدول settings)، فأي مفتاح في لوحة الإعدادات كان يضيع بلا خطأ.
ALTER TABLE public.settings
    ADD COLUMN IF NOT EXISTS opening_balance_visible BOOLEAN DEFAULT true,
    ADD COLUMN IF NOT EXISTS pos_legacy_mode VARCHAR(20) DEFAULT 'off',
    ADD COLUMN IF NOT EXISTS pos_official_path VARCHAR(255) DEFAULT '';

-- تهيئة الصف الرئيسي بقيم افتراضية صريحة (idempotent)
UPDATE public.settings SET
    opening_balance_visible = true
WHERE id = 'main_settings' AND opening_balance_visible IS NULL;
UPDATE public.settings SET
    pos_legacy_mode = 'off'
WHERE id = 'main_settings' AND (pos_legacy_mode IS NULL OR pos_legacy_mode = '');
UPDATE public.settings SET
    pos_official_path = ''
WHERE id = 'main_settings' AND pos_official_path IS NULL;

-- ── 8) توثيق ─────────────────────────────────────────────────────────────
COMMENT ON ROLE karim_app IS
    'دور تشغيل Karim ERP (DML بلا DDL). التفعيل: ALTER ROLE karim_app LOGIN PASSWORD ''<random>'' ثم DB_USER=karim_app في .env. لا تُخزَّن كلمة المرور في المستودع.';
