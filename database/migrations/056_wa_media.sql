-- 056_wa_media.sql — Karim ERP WhatsApp Engine: media support
-- Adds media columns to wa_inbox (received) and wa_outbox (queued to send).
-- Idempotent: safe to apply multiple times.

ALTER TABLE wa_inbox
    ADD COLUMN IF NOT EXISTS media_type VARCHAR(20),
    ADD COLUMN IF NOT EXISTS media_path TEXT,
    ADD COLUMN IF NOT EXISTS media_mime VARCHAR(100);

ALTER TABLE wa_outbox
    ADD COLUMN IF NOT EXISTS media_type VARCHAR(20),
    ADD COLUMN IF NOT EXISTS media_path TEXT,
    ADD COLUMN IF NOT EXISTS caption TEXT;

CREATE INDEX IF NOT EXISTS idx_wa_inbox_media ON wa_inbox(media_type);
CREATE INDEX IF NOT EXISTS idx_wa_outbox_media ON wa_outbox(media_type);

INSERT INTO wa_settings (key, value) VALUES ('wa_migration_056', '2026-09-20')
ON CONFLICT (key) DO UPDATE SET value = '2026-09-20';
