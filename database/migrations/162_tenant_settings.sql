-- 162_tenant_settings.sql — إعدادات مستأجر (هوية/لغة/عملة/ضريبة)
-- ─────────────────────────────────────────────────────────────────────────────
-- يحل مشكلة fail-open في i18n-routes: كان أي عميل يأخذ نفس الاسم/الشعار/
-- العملة وضريبة 0.15 من البيئة عند غياب صف الإعدادات. الآن لكل مستأجر مفاتيحه.
-- مُلحق فقط: لا يعدّل جدول settings العالمي، ويبقى fallback له.

BEGIN;

CREATE TABLE IF NOT EXISTS tenant_settings (
    tenant_id  UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    key        TEXT NOT NULL,
    value      JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, key)
);

COMMENT ON TABLE tenant_settings IS
    'إعدادات لكل مستأجر: branding / locale / currency / tax_rate / timezone.';

-- بذرة المستأجر الأول من صف الإعدادات الحالي (بياناته لا تُحذف ولا تُغيّر).
INSERT INTO tenant_settings (tenant_id, key, value)
SELECT '00000000-0000-0000-0000-000000000001', 'branding',
       jsonb_strip_nulls(jsonb_build_object(
           'name', name, 'logo', logo, 'logoB64', "logoB64", 'currency', currency,
           'lowStockAlert', "lowStockAlert", 'workStartHour', "workStartHour",
           'hidden_nav_pages', hidden_nav_pages,
           'opening_balance_visible', "opening_balance_visible"
       ))
FROM settings WHERE id = 'main_settings'
ON CONFLICT (tenant_id, key) DO NOTHING;

INSERT INTO tenant_settings (tenant_id, key, value) VALUES
    ('00000000-0000-0000-0000-000000000001', 'locale', '"ar"'::jsonb),
    ('00000000-0000-0000-0000-000000000001', 'timezone', '"Asia/Riyadh"'::jsonb),
    ('00000000-0000-0000-0000-000000000001', 'tax_rate', '0.15'::jsonb)
ON CONFLICT (tenant_id, key) DO NOTHING;

-- نفس نمط العزل: متساهل بلا سياق، صارم معه.
ALTER TABLE tenant_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_settings FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_read ON tenant_settings;
CREATE POLICY tenant_read ON tenant_settings AS PERMISSIVE FOR ALL
  USING (current_setting('app.tenant_id', true) IS NULL
      OR current_setting('app.tenant_id', true) = ''
      OR tenant_id = saas_current_tenant_id())
  WITH CHECK (current_setting('app.tenant_id', true) IS NULL
      OR current_setting('app.tenant_id', true) = ''
      OR tenant_id = saas_current_tenant_id());
DROP POLICY IF EXISTS tenant_guard ON tenant_settings;
CREATE POLICY tenant_guard ON tenant_settings AS RESTRICTIVE FOR ALL
  USING (current_setting('app.tenant_id', true) IS NULL
      OR current_setting('app.tenant_id', true) = ''
      OR tenant_id = saas_current_tenant_id())
  WITH CHECK (current_setting('app.tenant_id', true) IS NULL
      OR current_setting('app.tenant_id', true) = ''
      OR tenant_id = saas_current_tenant_id());

COMMIT;
