-- WhatsApp professional inbox workspace metadata.
CREATE TABLE IF NOT EXISTS wa_chat_meta (
    remote_jid VARCHAR(100) PRIMARY KEY,
    assigned_to BIGINT REFERENCES users(id) ON DELETE SET NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'open',
    priority VARCHAR(12) NOT NULL DEFAULT 'normal',
    tags JSONB NOT NULL DEFAULT '[]'::jsonb,
    internal_note TEXT,
    updated_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT wa_chat_meta_status CHECK (status IN ('open','pending','resolved','snoozed')),
    CONSTRAINT wa_chat_meta_priority CHECK (priority IN ('low','normal','high','urgent'))
);
CREATE INDEX IF NOT EXISTS idx_wa_chat_meta_status ON wa_chat_meta(status, priority, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_wa_chat_meta_assigned ON wa_chat_meta(assigned_to, status, updated_at DESC);
