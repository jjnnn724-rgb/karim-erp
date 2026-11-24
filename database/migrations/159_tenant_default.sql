-- 159_tenant_default.sql — كل إدراج جديد يرث المستأجر الحالي تلقائياً
-- ─────────────────────────────────────────────────────────────────────────────
-- بدون هذا الافتراض، أي INSERT تحت سياق مستأجر سيضع tenant_id = NULL
-- فيرفضه WITH_CHECK في سياسات RLS (158) — أي أن البيع سينكسر في وضع SaaS.
-- عند غياب السياق يعود الافتراض بـNULL، فيبقى السلوك الحالي كما هو تماماً.

BEGIN;

ALTER TABLE users              ALTER COLUMN tenant_id SET DEFAULT saas_current_tenant_id();
ALTER TABLE employees          ALTER COLUMN tenant_id SET DEFAULT saas_current_tenant_id();
ALTER TABLE attendance         ALTER COLUMN tenant_id SET DEFAULT saas_current_tenant_id();
ALTER TABLE pos_orders         ALTER COLUMN tenant_id SET DEFAULT saas_current_tenant_id();
ALTER TABLE pos_shift_sessions ALTER COLUMN tenant_id SET DEFAULT saas_current_tenant_id();
ALTER TABLE pos_day_closes     ALTER COLUMN tenant_id SET DEFAULT saas_current_tenant_id();
ALTER TABLE expenses           ALTER COLUMN tenant_id SET DEFAULT saas_current_tenant_id();
ALTER TABLE revenues           ALTER COLUMN tenant_id SET DEFAULT saas_current_tenant_id();
ALTER TABLE journal_entries    ALTER COLUMN tenant_id SET DEFAULT saas_current_tenant_id();
ALTER TABLE "purchaseInvoices" ALTER COLUMN tenant_id SET DEFAULT saas_current_tenant_id();

COMMIT;
