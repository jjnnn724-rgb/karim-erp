-- 155_tenants_foundation.sql — أساس تعدد المستأجرين (DDL فقط، بلا بيانات)
-- ─────────────────────────────────────────────────────────────────────────────
-- ترحيل additive بالكامل: جداول جديدة لا تلمس أي جدول قائم.
-- يُطبَّق على نسخة منفصلة أولاً عبر:
--   node scripts/saas-migrate-guard.js --target=karim_tenant_dev \
--     --migration=155_tenants_foundation.sql --i-confirm-copy --dry-run
-- لا يُفعّل أي RLS في هذا الملف — التفعيل بflag منفصل بعد اكتمال السياق.

BEGIN;

CREATE TABLE IF NOT EXISTS tenants (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug        VARCHAR(63) NOT NULL UNIQUE
                CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
    name        TEXT NOT NULL,
    status      TEXT NOT NULL DEFAULT 'active'
                CHECK (status IN ('active', 'trial', 'suspended', 'deleted')),
    plan_id     TEXT,
    locale      TEXT NOT NULL DEFAULT 'ar',
    currency    TEXT NOT NULL DEFAULT 'SAR',
    timezone    TEXT NOT NULL DEFAULT 'Asia/Riyadh',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE tenants IS 'كيان المستأجر (SaaS). كل بيانات الأعمال تُربط به لاحقاً عبر tenant_id.';

CREATE TABLE IF NOT EXISTS tenant_domains (
    tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    hostname    TEXT NOT NULL UNIQUE,
    verified_at TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, hostname)
);

COMMENT ON TABLE tenant_domains IS 'نطاقات المستأجرين — حل المستأجر من Host يملكه الخادم لا من ترويسة عميل.';

CREATE TABLE IF NOT EXISTS tenant_users (
    tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id      BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role_in_tenant TEXT NOT NULL DEFAULT 'member',
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, user_id)
);

COMMENT ON TABLE tenant_users IS 'عضوية المستخدم في مستأجر — المفتاح المركّب يمنع تزوير tid في JWT.';

-- قراءة آمنة لمتغير الجلسة: current_setting(..., true) لا يرمي عند الغياب.
-- تُستخدم لاحقاً في سياسات RLS، ومتاحة الآن للمراجعة والتدقيق.
CREATE OR REPLACE FUNCTION saas_current_tenant_id() RETURNS UUID
LANGUAGE sql STABLE AS $$
    SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid;
$$;

COMMENT ON FUNCTION saas_current_tenant_id() IS
    'معرّف المستأجر من SET LOCAL app.tenant_id — يُضبط داخل معاملة الطلب فقط.';

COMMIT;
