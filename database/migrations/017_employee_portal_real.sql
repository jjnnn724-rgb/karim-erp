BEGIN;

-- Real employee-card and QR lifecycle fields.
ALTER TABLE employees ADD COLUMN IF NOT EXISTS "cardIssuedAt" TIMESTAMPTZ;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS "qrVersion" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS "qrTokenHash" VARCHAR(128);
ALTER TABLE employees ADD COLUMN IF NOT EXISTS "qrTokenEncrypted" TEXT;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS "cardStatus" VARCHAR(30) NOT NULL DEFAULT 'active';

-- Auditable attendance timestamps and source metadata.
ALTER TABLE attendance ADD COLUMN IF NOT EXISTS "checkInAt" TIMESTAMPTZ;
ALTER TABLE attendance ADD COLUMN IF NOT EXISTS "checkOutAt" TIMESTAMPTZ;
ALTER TABLE attendance ADD COLUMN IF NOT EXISTS "workMinutes" INTEGER;
ALTER TABLE attendance ADD COLUMN IF NOT EXISTS "source" VARCHAR(30) NOT NULL DEFAULT 'manual';
ALTER TABLE attendance ADD COLUMN IF NOT EXISTS "operatorId" BIGINT;

-- One attendance row per employee per calendar day.
CREATE UNIQUE INDEX IF NOT EXISTS uq_attendance_employee_date ON attendance("employeeId", date);
CREATE INDEX IF NOT EXISTS idx_attendance_date_employee ON attendance(date, "employeeId");
CREATE INDEX IF NOT EXISTS idx_employees_card_id ON employees("cardId");
CREATE INDEX IF NOT EXISTS idx_employees_qr_hash ON employees("qrTokenHash");

COMMIT;
