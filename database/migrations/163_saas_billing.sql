-- 163_saas_billing.sql — أساس الاشتراكات والحدود (Planning / Quotas)
-- ─────────────────────────────────────────────────────────────────────────────
-- additive بالكامل: لا يلمس أي جدول مالي أو محاسبي. لا يضيف بوابة دفع بعد —
-- بوابة الدفع/الفوترة تأتي في مرحلة لاحقة بعد حسم اختيار المالك.
-- الحدود تُقرأ من جدول plans ولا تُفرض إلا عند تفعيل وضع SaaS.

BEGIN;

CREATE TABLE IF NOT EXISTS plans (
    id                       TEXT PRIMARY KEY,
    name                     TEXT NOT NULL,
    max_branches             INTEGER NOT NULL DEFAULT 1,
    max_users                INTEGER NOT NULL DEFAULT 5,
    max_sales_per_month      INTEGER,             -- NULL = غير محدود
    max_storage_mb           INTEGER NOT NULL DEFAULT 100,
    price_monthly            NUMERIC(12,2) NOT NULL DEFAULT 0,
    currency                 CHAR(3) NOT NULL DEFAULT 'SAR',
    active                   BOOLEAN NOT NULL DEFAULT TRUE
);

COMMENT ON TABLE plans IS 'كتالوج خطط الاشتراك — Free/Pro/Enterprise قابل للتعديل بلا ترحيل.';

CREATE TABLE IF NOT EXISTS subscriptions (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID NOT NULL UNIQUE REFERENCES tenants(id) ON DELETE RESTRICT,
    plan_id             TEXT NOT NULL REFERENCES plans(id) ON DELETE RESTRICT,
    status              TEXT NOT NULL DEFAULT 'trial'
                        CHECK (status IN ('trial','active','past_due','canceled')),
    current_period_start TIMESTAMPTZ NOT NULL DEFAULT now(),
    current_period_end   TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE subscriptions IS 'اشتراك كل مستأجر — ارتباط مباشر بـtenant_id.';

CREATE TABLE IF NOT EXISTS usage_counters (
    tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    period_start DATE NOT NULL DEFAULT (now() AT TIME ZONE 'UTC')::date,
    metric       TEXT NOT NULL CHECK (metric IN ('sales','users','branches','storage_mb')),
    value        BIGINT NOT NULL DEFAULT 0,
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, period_start, metric)
);

COMMENT ON TABLE usage_counters IS 'عدادات الاستخدام الشهرية لكل مستأجر — تُقرأ لحساب تجاوز الحدود.';

INSERT INTO plans (id, name, max_branches, max_users, max_sales_per_month, max_storage_mb, price_monthly, currency)
VALUES
    ('free',      'مجاني',      1,  5,  100,   100,   0,    'SAR'),
    ('pro',       'احترافي',    5,  50, NULL,  5000,  700,  'SAR'),
    ('enterprise','مؤسسي',     999, 999, NULL, 100000, 0,   'SAR')
ON CONFLICT (id) DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_subscriptions_tenant_id ON subscriptions (tenant_id);
CREATE INDEX IF NOT EXISTS idx_usage_counters_tenant_period ON usage_counters (tenant_id, period_start);

-- عزل المستأجر على الجداول التي تحمل tenant_id.
DO $$
DECLARE t text; cond text := $c$
    current_setting('app.tenant_id', true) IS NULL
    OR current_setting('app.tenant_id', true) = ''
    OR tenant_id = saas_current_tenant_id()
$c$;
BEGIN
    FOREACH t IN ARRAY ARRAY['subscriptions','usage_counters'] LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
        EXECUTE format('DROP POLICY IF EXISTS tenant_read ON %I', t);
        EXECUTE format('CREATE POLICY tenant_read ON %I AS PERMISSIVE FOR ALL USING (%s) WITH CHECK (%s)', t, cond, cond);
        EXECUTE format('DROP POLICY IF EXISTS tenant_guard ON %I', t);
        EXECUTE format('CREATE POLICY tenant_guard ON %I AS RESTRICTIVE FOR ALL USING (%s) WITH CHECK (%s)', t, cond, cond);
    END LOOP;
END $$;

COMMIT;
