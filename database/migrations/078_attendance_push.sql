-- 078_attendance_push.sql — Push channel for Face/Hikvision devices (ADDITIVE ONLY)
-- ─────────────────────────────────────────────────────────────────────────────
-- Purely additive, idempotent. No existing table/column is altered in a
-- breaking way. Safe on fresh and migrated databases.
--
--   attendance_device_tokens — per-device Bearer tokens (hash only, revocable)
--   attendance_push_queue   — SQL mirror queue (durable when Redis is down)
--   attendance_logs         — two nullable columns only (raw_payload, dedup_key)
-- ─────────────────────────────────────────────────────────────────────────────

-- Per-device tokens: only the SHA-256 hash is stored, never the raw token.
CREATE TABLE IF NOT EXISTS attendance_device_tokens (
    id BIGSERIAL PRIMARY KEY,
    "deviceId" BIGINT NOT NULL REFERENCES attendance_devices(id) ON DELETE CASCADE,
    token_hash VARCHAR(64) NOT NULL,
    name VARCHAR(100),
    revoked BOOLEAN NOT NULL DEFAULT FALSE,
    expires_at TIMESTAMPTZ,
    last_used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_device_token_hash UNIQUE (token_hash)
);
CREATE INDEX IF NOT EXISTS idx_device_tokens_device ON attendance_device_tokens("deviceId")
    WHERE revoked = FALSE;

-- SQL mirror queue: every push is persisted here first, so no punch is lost
-- when Redis/BullMQ is disabled (offline LAN) or crashing.
CREATE TABLE IF NOT EXISTS attendance_push_queue (
    id BIGSERIAL PRIMARY KEY,
    dedup_key VARCHAR(128) NOT NULL,
    "deviceId" BIGINT REFERENCES attendance_devices(id) ON DELETE SET NULL,
    device_user_id VARCHAR(64),
    employee_id BIGINT REFERENCES employees(id) ON DELETE SET NULL,
    punch_time TIMESTAMPTZ NOT NULL,
    verify_type SMALLINT NOT NULL DEFAULT 2,
    punch_state SMALLINT NOT NULL DEFAULT 0,
    raw_payload JSONB,
    status VARCHAR(20) NOT NULL DEFAULT 'queued',
    attempts INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    queued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    processed_at TIMESTAMPTZ,
    CONSTRAINT uq_push_queue_dedup UNIQUE (dedup_key),
    CONSTRAINT ck_push_queue_status CHECK (status IN ('queued','processing','done','failed','deduped'))
);
CREATE INDEX IF NOT EXISTS idx_push_queue_status ON attendance_push_queue(status, queued_at)
    WHERE status IN ('queued','processing');

-- Additive columns on the existing raw log (nullable → no backfill needed).
ALTER TABLE attendance_logs ADD COLUMN IF NOT EXISTS raw_payload JSONB;
ALTER TABLE attendance_logs ADD COLUMN IF NOT EXISTS dedup_key VARCHAR(128);
CREATE INDEX IF NOT EXISTS idx_attendance_logs_dedup ON attendance_logs(dedup_key)
    WHERE dedup_key IS NOT NULL;
