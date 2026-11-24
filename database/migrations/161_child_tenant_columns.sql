-- 161_child_tenant_columns.sql — تغطية الجداول الفرعية بسياق المستأجر
-- ─────────────────────────────────────────────────────────────────────────────
-- الجداول الستة دي كانت خارج البذرة العشرية الأصلية (102_branches.sql)؛
-- بدونها يبقى عزل البيع ناقص: الطلب معزول لكن سطوره ومدفوعاته لا.
-- الـbackfill من الجدول الأب (order_id / entry_id) لا من قيمة ثابتة،
-- عشان الصفوف تُنسب لصاحبها الحقيقي حتى لو اتنقل مستأجر في المستقبل.

BEGIN;

ALTER TABLE pos_order_items        ADD COLUMN IF NOT EXISTS tenant_id UUID DEFAULT saas_current_tenant_id() REFERENCES tenants(id) ON DELETE RESTRICT;
ALTER TABLE pos_invoice_payments   ADD COLUMN IF NOT EXISTS tenant_id UUID DEFAULT saas_current_tenant_id() REFERENCES tenants(id) ON DELETE RESTRICT;
ALTER TABLE pos_pending_prints     ADD COLUMN IF NOT EXISTS tenant_id UUID DEFAULT saas_current_tenant_id() REFERENCES tenants(id) ON DELETE RESTRICT;
ALTER TABLE pos_zatca_invoice_queue ADD COLUMN IF NOT EXISTS tenant_id UUID DEFAULT saas_current_tenant_id() REFERENCES tenants(id) ON DELETE RESTRICT;
ALTER TABLE journal_lines          ADD COLUMN IF NOT EXISTS tenant_id UUID DEFAULT saas_current_tenant_id() REFERENCES tenants(id) ON DELETE RESTRICT;
ALTER TABLE inventory_ledger       ADD COLUMN IF NOT EXISTS tenant_id UUID DEFAULT saas_current_tenant_id() REFERENCES tenants(id) ON DELETE RESTRICT;

UPDATE pos_order_items i SET tenant_id = o.tenant_id
  FROM pos_orders o WHERE i.order_id = o.id AND i.tenant_id IS NULL;
UPDATE pos_invoice_payments p SET tenant_id = o.tenant_id
  FROM pos_orders o WHERE p.order_id = o.id AND p.tenant_id IS NULL;
UPDATE pos_pending_prints p SET tenant_id = o.tenant_id
  FROM pos_orders o WHERE p.order_id = o.id AND p.tenant_id IS NULL;
UPDATE pos_zatca_invoice_queue q SET tenant_id = o.tenant_id
  FROM pos_orders o WHERE q.order_id = o.id AND q.tenant_id IS NULL;
UPDATE journal_lines l SET tenant_id = e.tenant_id
  FROM journal_entries e WHERE l.entry_id = e.id AND l.tenant_id IS NULL;
-- inventory_ledger بلا أب مباشر يحمل tenant_id ⇒ يرث الافتراض (المستأجر الحالي
-- وقت التشغيل / المستأجر الأول وقت الـbackfill). موثّق كحد معروف.
UPDATE inventory_ledger SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_pos_order_items_tenant_id         ON pos_order_items (tenant_id);
CREATE INDEX IF NOT EXISTS idx_pos_invoice_payments_tenant_id    ON pos_invoice_payments (tenant_id);
CREATE INDEX IF NOT EXISTS idx_pos_pending_prints_tenant_id      ON pos_pending_prints (tenant_id);
CREATE INDEX IF NOT EXISTS idx_pos_zatca_invoice_queue_tenant_id ON pos_zatca_invoice_queue (tenant_id);
CREATE INDEX IF NOT EXISTS idx_journal_lines_tenant_id           ON journal_lines (tenant_id);
CREATE INDEX IF NOT EXISTS idx_inventory_ledger_tenant_id        ON inventory_ledger (tenant_id);

-- نفس نمط 158: متساهل بلا سياق، صارم معه، وrestrictive يمنع التجاوز.
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
        'pos_order_items', 'pos_invoice_payments', 'pos_pending_prints',
        'pos_zatca_invoice_queue', 'journal_lines', 'inventory_ledger'
    ] LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
        EXECUTE format('DROP POLICY IF EXISTS tenant_read ON %I', t);
        EXECUTE format('CREATE POLICY tenant_read ON %I AS PERMISSIVE FOR ALL USING (%s) WITH CHECK (%s)', t, cond, cond);
        EXECUTE format('DROP POLICY IF EXISTS tenant_guard ON %I', t);
        EXECUTE format('CREATE POLICY tenant_guard ON %I AS RESTRICTIVE FOR ALL USING (%s) WITH CHECK (%s)', t, cond, cond);
    END LOOP;
END $$;

COMMIT;
