-- ════════════════════════════════════════════════════════════════════════
-- Migration 011: Missing columns identified during frontend↔backend audit
-- ────────────────────────────────────────────────────────────────────────
-- The frontend wiring (persistCreate/persistUpdate) sends fields that were
-- never created by migration 001. This migration adds them safely using
-- ADD COLUMN IF NOT EXISTS — idempotent, safe to run multiple times.
-- ════════════════════════════════════════════════════════════════════════
BEGIN;

-- ────────────────────────────────────────────────────────────────────────
-- leaveRequests — request/approval/rejection lifecycle tracking
-- ────────────────────────────────────────────────────────────────────────
ALTER TABLE "leaveRequests" ADD COLUMN IF NOT EXISTS reason TEXT;
ALTER TABLE "leaveRequests" ADD COLUMN IF NOT EXISTS "requestDate" VARCHAR(50);
ALTER TABLE "leaveRequests" ADD COLUMN IF NOT EXISTS "requestedBy" BIGINT;
ALTER TABLE "leaveRequests" ADD COLUMN IF NOT EXISTS "approvedBy" BIGINT;
ALTER TABLE "leaveRequests" ADD COLUMN IF NOT EXISTS "approvedDate" VARCHAR(50);
ALTER TABLE "leaveRequests" ADD COLUMN IF NOT EXISTS "rejectionReason" TEXT;
ALTER TABLE "leaveRequests" ADD COLUMN IF NOT EXISTS "rejectedBy" BIGINT;
ALTER TABLE "leaveRequests" ADD COLUMN IF NOT EXISTS "rejectedDate" VARCHAR(50);

-- ────────────────────────────────────────────────────────────────────────
-- dispatches — approval/rejection workflow metadata
-- ────────────────────────────────────────────────────────────────────────
ALTER TABLE dispatches ADD COLUMN IF NOT EXISTS "approvedDate" VARCHAR(50);
ALTER TABLE dispatches ADD COLUMN IF NOT EXISTS "approvedBy" VARCHAR(100);
ALTER TABLE dispatches ADD COLUMN IF NOT EXISTS "approveNotes" TEXT;
ALTER TABLE dispatches ADD COLUMN IF NOT EXISTS "approvedItems" JSONB;
ALTER TABLE dispatches ADD COLUMN IF NOT EXISTS "rejectionReason" TEXT;
ALTER TABLE dispatches ADD COLUMN IF NOT EXISTS "rejectedBy" VARCHAR(100);
ALTER TABLE dispatches ADD COLUMN IF NOT EXISTS "rejectedDate" VARCHAR(50);

-- ────────────────────────────────────────────────────────────────────────
-- kitchenReturns — full lifecycle metadata
-- ────────────────────────────────────────────────────────────────────────
ALTER TABLE "kitchenReturns" ADD COLUMN IF NOT EXISTS reason TEXT;
ALTER TABLE "kitchenReturns" ADD COLUMN IF NOT EXISTS "dispatchId" VARCHAR(255);
ALTER TABLE "kitchenReturns" ADD COLUMN IF NOT EXISTS "deptCode" VARCHAR(50);
ALTER TABLE "kitchenReturns" ADD COLUMN IF NOT EXISTS "deptName" VARCHAR(255);
ALTER TABLE "kitchenReturns" ADD COLUMN IF NOT EXISTS "totalValue" NUMERIC(10,2);
ALTER TABLE "kitchenReturns" ADD COLUMN IF NOT EXISTS "createdBy" VARCHAR(100);

-- ────────────────────────────────────────────────────────────────────────
-- weightReadings — full metadata (operator, timestamp, notes)
-- ────────────────────────────────────────────────────────────────────────
ALTER TABLE "weightReadings" ADD COLUMN IF NOT EXISTS "time" VARCHAR(50);
ALTER TABLE "weightReadings" ADD COLUMN IF NOT EXISTS "timestamp" VARCHAR(50);
ALTER TABLE "weightReadings" ADD COLUMN IF NOT EXISTS "itemName" VARCHAR(255);
ALTER TABLE "weightReadings" ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE "weightReadings" ADD COLUMN IF NOT EXISTS "recordedBy" VARCHAR(100);

-- ────────────────────────────────────────────────────────────────────────
-- attendance — operator notes (e.g. "مسح QR", "late arrival reason")
-- ────────────────────────────────────────────────────────────────────────
ALTER TABLE attendance ADD COLUMN IF NOT EXISTS notes TEXT;

-- ────────────────────────────────────────────────────────────────────────
-- expenses — cost categorization for reporting
-- ────────────────────────────────────────────────────────────────────────
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS category VARCHAR(100);
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS "adjustmentType" VARCHAR(50);

COMMIT;
