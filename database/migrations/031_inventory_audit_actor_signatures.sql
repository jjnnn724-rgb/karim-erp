-- مطاعم الشرفه العالمي v3.1.0 — complete inventory audit actor/signature fields
-- Idempotent compatibility migration for databases that already applied 030.
BEGIN;
ALTER TABLE inventory_audits ADD COLUMN IF NOT EXISTS counted_by BIGINT;
ALTER TABLE inventory_audits ADD COLUMN IF NOT EXISTS submitted_by BIGINT;
ALTER TABLE inventory_audits ADD COLUMN IF NOT EXISTS submit_signature_data TEXT;
ALTER TABLE inventory_audits ADD COLUMN IF NOT EXISTS submit_signature_hash VARCHAR(128);
COMMIT;

