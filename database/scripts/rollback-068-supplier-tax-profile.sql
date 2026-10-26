-- rollback-068-supplier-tax-profile.sql — Rollback for 068_supplier_tax_profile.sql
-- ────────────────────────────────────────────────────────────────────────────
-- Drops ONLY objects added by migration 068. Pre-existing suppliers /
-- purchaseInvoices / chart rows are preserved (columns are dropped, rows kept).
-- Run manually with psql — NEVER place this file inside database/migrations/.
-- WARNING: dropping snapshot columns destroys historical tax evidence. Take a
-- pg_dump backup first (npm run backup).

BEGIN;

-- 6. Input VAT account (only if no journal lines reference it)
DELETE FROM chart_of_accounts
 WHERE code = '1150'
   AND NOT EXISTS (SELECT 1 FROM journal_lines WHERE account_code = '1150');

-- 5. Audit log
DROP TABLE IF EXISTS supplier_tax_audit;

-- 4. Tax config
DROP TABLE IF EXISTS tax_config;

-- 3. Invoice snapshot columns
ALTER TABLE "purchaseInvoices" DROP COLUMN IF EXISTS zatca_qr;
ALTER TABLE "purchaseInvoices" DROP COLUMN IF EXISTS zatca_uuid;
ALTER TABLE "purchaseInvoices" DROP COLUMN IF EXISTS supplier_tax_status_snapshot;
ALTER TABLE "purchaseInvoices" DROP COLUMN IF EXISTS supplier_cr_snapshot;
ALTER TABLE "purchaseInvoices" DROP COLUMN IF EXISTS supplier_vat_number_snapshot;
ALTER TABLE "purchaseInvoices" DROP COLUMN IF EXISTS supplier_name_snapshot;
ALTER TABLE "purchaseInvoices" DROP COLUMN IF EXISTS tax_rule_code_snapshot;
ALTER TABLE "purchaseInvoices" DROP COLUMN IF EXISTS tax_rate_snapshot;
ALTER TABLE "purchaseInvoices" DROP COLUMN IF EXISTS vat_total;
ALTER TABLE "purchaseInvoices" DROP COLUMN IF EXISTS subtotal_net;

-- 2. Search indexes
DROP INDEX IF EXISTS idx_suppliers_tax_status;
DROP INDEX IF EXISTS idx_suppliers_cr;
DROP INDEX IF EXISTS idx_suppliers_vat_trgm;
DROP INDEX IF EXISTS idx_suppliers_name_trgm;

-- 1. Supplier tax profile (constraints first, then columns)
ALTER TABLE suppliers DROP CONSTRAINT IF EXISTS suppliers_cr_format_chk;
ALTER TABLE suppliers DROP CONSTRAINT IF EXISTS suppliers_tax_status_vat_chk;
ALTER TABLE suppliers DROP CONSTRAINT IF EXISTS suppliers_vat_format_chk;
ALTER TABLE suppliers DROP CONSTRAINT IF EXISTS suppliers_tax_status_chk;
DROP INDEX IF EXISTS uq_suppliers_vat_number;
ALTER TABLE suppliers DROP COLUMN IF EXISTS commercial_register;
ALTER TABLE suppliers DROP COLUMN IF EXISTS vat_number;
ALTER TABLE suppliers DROP COLUMN IF EXISTS tax_registration_status;
ALTER TABLE suppliers DROP COLUMN IF EXISTS email;
ALTER TABLE suppliers DROP COLUMN IF EXISTS name_en;

-- NOTE: pg_trgm extension is shared infra — left installed on purpose.

COMMIT;
