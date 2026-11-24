-- 160_dispatch_lifecycle.sql — إلغاء وإرجاع وإبطال دون محو المستند المالي
BEGIN;

ALTER TABLE dispatches ADD COLUMN IF NOT EXISTS "cancelledAt" TIMESTAMPTZ;
ALTER TABLE dispatches ADD COLUMN IF NOT EXISTS "cancelledBy" VARCHAR(255);
ALTER TABLE dispatches ADD COLUMN IF NOT EXISTS "cancellationReason" TEXT;
ALTER TABLE dispatches ADD COLUMN IF NOT EXISTS "reopenedAt" TIMESTAMPTZ;
ALTER TABLE dispatches ADD COLUMN IF NOT EXISTS "reopenedBy" VARCHAR(255);
ALTER TABLE dispatches ADD COLUMN IF NOT EXISTS "reopenReason" TEXT;
ALTER TABLE dispatches ADD COLUMN IF NOT EXISTS "voidedAt" TIMESTAMPTZ;
ALTER TABLE dispatches ADD COLUMN IF NOT EXISTS "voidedBy" VARCHAR(255);
ALTER TABLE dispatches ADD COLUMN IF NOT EXISTS "voidReason" TEXT;
ALTER TABLE dispatches ADD COLUMN IF NOT EXISTS "voidedJournalCount" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE expenses ADD COLUMN IF NOT EXISTS "voidedAt" TIMESTAMPTZ;
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS "voidedBy" VARCHAR(255);
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS "voidReason" TEXT;

ALTER TABLE "kitchenReturns" ADD COLUMN IF NOT EXISTS "voidedAt" TIMESTAMPTZ;
ALTER TABLE "kitchenReturns" ADD COLUMN IF NOT EXISTS "voidedBy" VARCHAR(255);
ALTER TABLE "kitchenReturns" ADD COLUMN IF NOT EXISTS "voidReason" TEXT;

CREATE INDEX IF NOT EXISTS idx_dispatches_voided_at ON dispatches ("voidedAt");
CREATE INDEX IF NOT EXISTS idx_kitchenreturns_dispatch_active
    ON "kitchenReturns" ("dispatchId") WHERE "voidedAt" IS NULL;

COMMIT;
