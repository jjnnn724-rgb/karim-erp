-- توحيد سياسة tenant_isolation مع التصميم المعلن في migration 158:
--   • غياب app.tenant_id (الوضع العادي قبل تفعيل SaaS) ⇒ الصفوف القديمة متاحة.
--   • وجوده ⇒ عزل صارم على tenant_id.
-- الترحيل idempotent: يعيد إنشاء السياسة لأي جدول يحمل الاسم القديم فقط.
-- لا يلمس البيانات، ولا يغيّر FORCE ROW LEVEL SECURITY.
DO $$
DECLARE
    t record;
BEGIN
    FOR t IN
        SELECT schemaname, tablename
        FROM pg_policies
        WHERE policyname = 'tenant_isolation'
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I.%I', t.schemaname, t.tablename);
        EXECUTE format($policy$
            CREATE POLICY tenant_isolation ON %I.%I
                AS PERMISSIVE FOR ALL TO PUBLIC
                USING (
                    current_setting('app.tenant_id', true) IS NULL
                    OR current_setting('app.tenant_id', true) = ''
                    OR tenant_id::text = current_setting('app.tenant_id', true)
                )
                WITH CHECK (
                    current_setting('app.tenant_id', true) IS NULL
                    OR current_setting('app.tenant_id', true) = ''
                    OR tenant_id::text = current_setting('app.tenant_id', true)
                )
        $policy$, t.schemaname, t.tablename);
    END LOOP;
END $$;
