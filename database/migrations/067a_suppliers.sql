-- =====================================================
-- Migration 067a: الموردون ومدفوعاتهم (أساس المشتريات)
-- كانت تُنشأ وقت تشغيل فقط (ensureProcurementSchema) — الترحيل 068 يعتمد
-- على جدول suppliers قبله، فالتثبيت النظيف كان يفشل. نفس الـ DDL (متكرر بأمان).
-- =====================================================

CREATE TABLE IF NOT EXISTS suppliers (
    id BIGINT PRIMARY KEY,
    name TEXT NOT NULL,
    phone TEXT,
    category TEXT,
    address TEXT,
    notes TEXT,
    "openingBalance" NUMERIC(12,2) NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updatedAt" TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS supplier_payments (
    id BIGINT PRIMARY KEY,
    "supplierId" BIGINT NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
    amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
    method VARCHAR(30) NOT NULL DEFAULT 'cash',
    date VARCHAR(50) NOT NULL,
    "invoiceId" BIGINT,
    notes TEXT,
    "createdBy" VARCHAR(100),
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT supplier_payments_method_chk CHECK (method IN ('cash','bank','card','cheque'))
);

CREATE INDEX IF NOT EXISTS supplier_payments_supplier_idx ON supplier_payments("supplierId");
CREATE INDEX IF NOT EXISTS supplier_payments_invoice_idx ON supplier_payments("invoiceId");
CREATE UNIQUE INDEX IF NOT EXISTS suppliers_active_name_uniq ON suppliers (lower(name)) WHERE is_active;

ALTER TABLE "purchaseInvoices" ADD COLUMN IF NOT EXISTS "supplierId" BIGINT;
ALTER TABLE "purchaseInvoices" ADD COLUMN IF NOT EXISTS "paidAmount" NUMERIC(12,2);
ALTER TABLE "purchaseInvoices" ADD COLUMN IF NOT EXISTS "paymentStatus" VARCHAR(20);
CREATE INDEX IF NOT EXISTS purchase_invoices_supplier_idx ON "purchaseInvoices"("supplierId");
CREATE INDEX IF NOT EXISTS purchase_invoices_status_idx ON "purchaseInvoices"("paymentStatus");
