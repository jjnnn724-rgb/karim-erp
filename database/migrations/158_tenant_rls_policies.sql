-- 158_tenant_rls_policies.sql — عزل المستأجر على مستوى PG (مرحلة انتقالية آمنة)
-- ─────────────────────────────────────────────────────────────────────────────
-- سياستان لكل جدول:
--   tenant_read   (PERMISSIVE): تسمح بكل الصفوف إذا لم يُضبط app.tenant_id،
--                 وإلا تسمح بصفوف المستأجر فقط. ⇒ الكود القديم بلا سياق لا ينكسر.
--   tenant_guard  (RESTRICTIVE): تُ AND مع أي سياسات POS قديمة ⇒ لا يمكن تجاوز
--                 قيد المستأجر حتى لو سمحت السياسات القديمة بصفوف أخرى.
-- لا يُغيّر هذا الترحيل أي صف أو رقماً؛ يضيف قواعد وصول فقط.

BEGIN;

DO $$
DECLARE
    t text;
    cond text := $cond$
        current_setting('app.tenant_id', true) IS NULL
        OR current_setting('app.tenant_id', true) = ''
        OR tenant_id = saas_current_tenant_id()
    $cond$;
BEGIN
    FOREACH t IN ARRAY ARRAY[
        'users', 'employees', 'attendance', 'pos_orders', 'pos_shift_sessions',
        'pos_day_closes', 'expenses', 'revenues', 'journal_entries', 'purchaseInvoices'
    ] LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);

        EXECUTE format('DROP POLICY IF EXISTS tenant_read ON %I', t);
        EXECUTE format(
            'CREATE POLICY tenant_read ON %I AS PERMISSIVE FOR ALL USING (%s) WITH CHECK (%s)',
            t, cond, cond);

        EXECUTE format('DROP POLICY IF EXISTS tenant_guard ON %I', t);
        EXECUTE format(
            'CREATE POLICY tenant_guard ON %I AS RESTRICTIVE FOR ALL USING (%s) WITH CHECK (%s)',
            t, cond, cond);
    END LOOP;
END $$;

COMMENT ON POLICY tenant_read ON users IS
    'انتقالي: بلا سياق ⇒ كل الصفوف؛ مع سياق ⇒ المستأجر فقط.';

COMMIT;
