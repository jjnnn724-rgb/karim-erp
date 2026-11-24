-- 156_tenant_columns.sql — أعمدة tenant_id على الجداول التجارية العشرة
-- ─────────────────────────────────────────────────────────────────────────────
-- نفس بذرة الجداول في 102_branches.sql:34-43 و106_branch_autostamp.sql:47-56.
-- additive بالكامل: العمود nullable الآن، والفهارس جاهزة، ولا RLS مُفعّل.
-- الـbackfill وتفعيل السياسات ترحيل/flag منفصلان بعد التحقق من خط الأساس الرقمي.

BEGIN;

ALTER TABLE users                 ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE RESTRICT;
ALTER TABLE employees             ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE RESTRICT;
ALTER TABLE attendance            ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE RESTRICT;
ALTER TABLE pos_orders            ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE RESTRICT;
ALTER TABLE pos_shift_sessions    ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE RESTRICT;
ALTER TABLE pos_day_closes        ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE RESTRICT;
ALTER TABLE expenses              ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE RESTRICT;
ALTER TABLE revenues              ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE RESTRICT;
ALTER TABLE journal_entries       ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE RESTRICT;
ALTER TABLE "purchaseInvoices"    ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_users_tenant_id              ON users (tenant_id);
CREATE INDEX IF NOT EXISTS idx_employees_tenant_id          ON employees (tenant_id);
CREATE INDEX IF NOT EXISTS idx_attendance_tenant_id         ON attendance (tenant_id);
CREATE INDEX IF NOT EXISTS idx_pos_orders_tenant_id         ON pos_orders (tenant_id);
CREATE INDEX IF NOT EXISTS idx_pos_shift_sessions_tenant_id ON pos_shift_sessions (tenant_id);
CREATE INDEX IF NOT EXISTS idx_pos_day_closes_tenant_id     ON pos_day_closes (tenant_id);
CREATE INDEX IF NOT EXISTS idx_expenses_tenant_id           ON expenses (tenant_id);
CREATE INDEX IF NOT EXISTS idx_revenues_tenant_id           ON revenues (tenant_id);
CREATE INDEX IF NOT EXISTS idx_journal_entries_tenant_id    ON journal_entries (tenant_id);
CREATE INDEX IF NOT EXISTS idx_purchase_invoices_tenant_id  ON "purchaseInvoices" (tenant_id);

COMMIT;
