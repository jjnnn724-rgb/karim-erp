-- 157_tenant_backfill.sql — إسناد البيانات الحالية إلى المستأجر الأول
-- ─────────────────────────────────────────────────────────────────────────────
-- يُطبَّق على النسخة المنفصلة فقط بعد نجاح خط الأساس الرقمي.
-- لا يغيّر أي مبلغ أو كمية — يملأ عمود tenant_id فقط (WHERE tenant_id IS NULL).
-- لا يُفعّل أي RLS في هذا الملف.

BEGIN;

INSERT INTO tenants (id, slug, name, status, locale, currency, timezone)
VALUES ('00000000-0000-0000-0000-000000000001', 'main', 'المؤسسة الحالية', 'active', 'ar', 'SAR', 'Asia/Riyadh')
ON CONFLICT (id) DO NOTHING;

UPDATE users                 SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;
UPDATE employees             SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;
UPDATE attendance            SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;
UPDATE pos_orders            SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;
UPDATE pos_shift_sessions    SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;
UPDATE pos_day_closes        SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;
UPDATE expenses              SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;
UPDATE revenues              SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;
UPDATE journal_entries       SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;
UPDATE "purchaseInvoices"    SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;

COMMIT;
