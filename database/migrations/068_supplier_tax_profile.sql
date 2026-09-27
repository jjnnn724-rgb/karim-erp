-- 068_supplier_tax_profile.sql — Supplier tax profile + purchase VAT snapshots + centralized tax config
-- ────────────────────────────────────────────────────────────────────────────
-- Extends (never replaces): suppliers (BIGINT PK), "purchaseInvoices", chart_of_accounts.
-- Idempotent: safe to re-run via database/scripts/run-migration.js.
-- Rollback: database/scripts/rollback-068-supplier-tax-profile.sql (drops ONLY
--           what this file adds; pre-existing columns/tables are untouched).

-- ─── 0. pg_trgm for Arabic fuzzy search (safe on prod) ──────────────────────
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ─── 1. Supplier tax profile columns ───────────────────────────────────────
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS name_en TEXT;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS tax_registration_status VARCHAR(20) NOT NULL DEFAULT 'NOT_REGISTERED';
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS vat_number VARCHAR(15);
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS commercial_register VARCHAR(20);

-- Normalize any legacy/NULL statuses before adding CHECKs
UPDATE suppliers
   SET tax_registration_status = 'NOT_REGISTERED'
 WHERE tax_registration_status IS NULL
    OR tax_registration_status NOT IN ('REGISTERED', 'NOT_REGISTERED', 'EXEMPT');

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'suppliers_tax_status_chk') THEN
        ALTER TABLE suppliers ADD CONSTRAINT suppliers_tax_status_chk
            CHECK (tax_registration_status IN ('REGISTERED', 'NOT_REGISTERED', 'EXEMPT'));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'suppliers_vat_format_chk') THEN
        ALTER TABLE suppliers ADD CONSTRAINT suppliers_vat_format_chk
            CHECK (vat_number IS NULL OR vat_number ~ '^[0-9]{15}$');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'suppliers_tax_status_vat_chk') THEN
        ALTER TABLE suppliers ADD CONSTRAINT suppliers_tax_status_vat_chk CHECK (
               (tax_registration_status = 'REGISTERED' AND vat_number IS NOT NULL)
            OR (tax_registration_status = 'NOT_REGISTERED' AND vat_number IS NULL)
            OR (tax_registration_status = 'EXEMPT')
        );
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'suppliers_cr_format_chk') THEN
        ALTER TABLE suppliers ADD CONSTRAINT suppliers_cr_format_chk
            CHECK (commercial_register IS NULL OR commercial_register ~ '^[0-9A-Za-z-]{1,20}$');
    END IF;
END $$;

-- UNIQUE VAT (partial: many NULLs allowed, duplicates forbidden)
CREATE UNIQUE INDEX IF NOT EXISTS uq_suppliers_vat_number
    ON suppliers (vat_number) WHERE vat_number IS NOT NULL;

-- ─── 2. Smart-search indexes (server-side, parameterized; no bare ILIKE scan) ─
CREATE INDEX IF NOT EXISTS idx_suppliers_name_trgm
    ON suppliers USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_suppliers_vat_trgm
    ON suppliers USING gin (vat_number gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_suppliers_cr
    ON suppliers (commercial_register) WHERE commercial_register IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_suppliers_tax_status
    ON suppliers (tax_registration_status);

-- ─── 3. Purchase-invoice VAT + historical tax snapshot (ZATCA-critical) ─────
-- Snapshot columns are written ONCE at creation and never updated by supplier
-- profile changes — the invoice stays legally consistent with its own time.
ALTER TABLE "purchaseInvoices" ADD COLUMN IF NOT EXISTS subtotal_net NUMERIC(14,2) NOT NULL DEFAULT 0;
ALTER TABLE "purchaseInvoices" ADD COLUMN IF NOT EXISTS vat_total NUMERIC(14,2) NOT NULL DEFAULT 0;
ALTER TABLE "purchaseInvoices" ADD COLUMN IF NOT EXISTS tax_rate_snapshot NUMERIC(5,2);
ALTER TABLE "purchaseInvoices" ADD COLUMN IF NOT EXISTS tax_rule_code_snapshot VARCHAR(60);
ALTER TABLE "purchaseInvoices" ADD COLUMN IF NOT EXISTS supplier_name_snapshot TEXT;
ALTER TABLE "purchaseInvoices" ADD COLUMN IF NOT EXISTS supplier_vat_number_snapshot VARCHAR(15);
ALTER TABLE "purchaseInvoices" ADD COLUMN IF NOT EXISTS supplier_cr_snapshot VARCHAR(20);
ALTER TABLE "purchaseInvoices" ADD COLUMN IF NOT EXISTS supplier_tax_status_snapshot VARCHAR(20);
-- ZATCA readiness payload (nullable: purchases are received docs, not cleared
-- via Fatoora; fields exist so reporting/QR can be built without schema churn)
ALTER TABLE "purchaseInvoices" ADD COLUMN IF NOT EXISTS zatca_uuid TEXT;
ALTER TABLE "purchaseInvoices" ADD COLUMN IF NOT EXISTS zatca_qr TEXT;

-- Backfill legacy invoices: net = total (no VAT was ever computed), snapshots empty
UPDATE "purchaseInvoices"
   SET subtotal_net = COALESCE("totalAmount", 0)
 WHERE subtotal_net = 0 AND COALESCE("totalAmount", 0) <> 0;

CREATE INDEX IF NOT EXISTS idx_purchase_invoices_supplier_vat_snap
    ON "purchaseInvoices" (supplier_vat_number_snapshot)
    WHERE supplier_vat_number_snapshot IS NOT NULL;

-- ─── 4. Centralized tax configuration (single source of truth — no hardcode) ─
CREATE TABLE IF NOT EXISTS tax_config (
    id INT PRIMARY KEY CHECK (id = 1),
    standard_vat_rate NUMERIC(5,2) NOT NULL DEFAULT 15.00 CHECK (standard_vat_rate >= 0 AND standard_vat_rate <= 100),
    country_code CHAR(2) NOT NULL DEFAULT 'SA',
    currency CHAR(3) NOT NULL DEFAULT 'SAR',
    vat_law_ref TEXT NOT NULL DEFAULT 'KSA VAT Law — standard rate 15% since 1 July 2020 (ZATCA)',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO tax_config (id, standard_vat_rate, country_code, currency)
VALUES (1, 15.00, 'SA', 'SAR')
ON CONFLICT (id) DO NOTHING;

-- ─── 5. Supplier tax change audit log (who/when/old→new/reason) ─────────────
CREATE TABLE IF NOT EXISTS supplier_tax_audit (
    id BIGSERIAL PRIMARY KEY,
    supplier_id BIGINT NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
    changed_by TEXT,
    changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    old_status VARCHAR(20),
    new_status VARCHAR(20),
    old_vat VARCHAR(15),
    new_vat VARCHAR(15),
    reason TEXT
);
CREATE INDEX IF NOT EXISTS idx_supplier_tax_audit_supplier
    ON supplier_tax_audit (supplier_id, changed_at DESC);

-- ─── 6. Input VAT Receivable account (asset — existing tree is extended, not replaced)
INSERT INTO chart_of_accounts (id, code, name_ar, name_en, type, parent_code, is_postable)
SELECT COALESCE((SELECT MAX(id) FROM chart_of_accounts), 0) + 1,
       '1150', 'ضريبة القيمة المضافة مستردة (مدخلات)', 'Input VAT Receivable',
       'asset', NULL, true
WHERE NOT EXISTS (SELECT 1 FROM chart_of_accounts WHERE code = '1150');
