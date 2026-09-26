-- Consent-based WhatsApp campaigns. Every campaign requires explicit admin approval.
CREATE TABLE IF NOT EXISTS wa_campaigns (
    id BIGSERIAL PRIMARY KEY,
    name VARCHAR(160) NOT NULL,
    template_name VARCHAR(120) NOT NULL,
    lang VARCHAR(2) NOT NULL DEFAULT 'ar',
    status VARCHAR(16) NOT NULL DEFAULT 'draft',
    scheduled_at TIMESTAMPTZ,
    created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
    approved_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
    approved_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT wa_campaign_status CHECK (status IN ('draft','approved','running','paused','completed','cancelled')),
    CONSTRAINT wa_campaign_lang CHECK (lang IN ('ar','en'))
);
CREATE TABLE IF NOT EXISTS wa_campaign_recipients (
    id BIGSERIAL PRIMARY KEY,
    campaign_id BIGINT NOT NULL REFERENCES wa_campaigns(id) ON DELETE CASCADE,
    remote_jid VARCHAR(100) NOT NULL,
    vars JSONB NOT NULL DEFAULT '[]'::jsonb,
    consent BOOLEAN NOT NULL DEFAULT false,
    status VARCHAR(16) NOT NULL DEFAULT 'pending',
    outbox_id BIGINT REFERENCES wa_outbox(id) ON DELETE SET NULL,
    last_error TEXT,
    sent_at TIMESTAMPTZ,
    UNIQUE (campaign_id, remote_jid),
    CONSTRAINT wa_campaign_recipient_status CHECK (status IN ('pending','queued','sent','failed','skipped'))
);
CREATE INDEX IF NOT EXISTS idx_wa_campaign_due ON wa_campaigns(status, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_wa_campaign_recipients ON wa_campaign_recipients(campaign_id, status, consent);
