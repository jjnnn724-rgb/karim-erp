-- 053: محرك واتساب (Baileys) — صندوق وارد/صادر + منع تكرار + قواعد رد + إعدادات
-- ────────────────────────────────────────────────────────────────────────────
-- idempotency على مستوى القاعدة: wa_processed(remote_jid, msg_id) فريد،
-- وwa_outbox.client_key فريد — إعادة التشغيل أو تكرار التسليم لا تخلق ازدواجًا.

CREATE TABLE IF NOT EXISTS wa_inbox (
    id              BIGSERIAL PRIMARY KEY,
    remote_jid      VARCHAR(100) NOT NULL,
    msg_id          VARCHAR(120) NOT NULL,
    is_group        BOOLEAN NOT NULL DEFAULT false,
    sender_jid      VARCHAR(100),
    sender_pushname VARCHAR(255),
    msg_type        VARCHAR(40) NOT NULL DEFAULT 'text',
    body            TEXT,
    ts_ms           BIGINT,
    status          VARCHAR(16) NOT NULL DEFAULT 'received',
    rule_id         BIGINT,
    reply_outbox_id BIGINT,
    error           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    processed_at    TIMESTAMPTZ,
    CONSTRAINT wa_inbox_status CHECK (status IN ('received','processed','failed','replied'))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_wa_inbox_msg ON wa_inbox (remote_jid, msg_id);
CREATE INDEX IF NOT EXISTS idx_wa_inbox_status ON wa_inbox (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_wa_inbox_chat ON wa_inbox (remote_jid, created_at DESC);

CREATE TABLE IF NOT EXISTS wa_processed (
    remote_jid  VARCHAR(100) NOT NULL,
    msg_id      VARCHAR(120) NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (remote_jid, msg_id)
);

CREATE TABLE IF NOT EXISTS wa_outbox (
    id              BIGSERIAL PRIMARY KEY,
    client_key      VARCHAR(120) NOT NULL,
    remote_jid      VARCHAR(100) NOT NULL,
    body            TEXT NOT NULL,
    status          VARCHAR(16) NOT NULL DEFAULT 'pending',
    attempts        INTEGER NOT NULL DEFAULT 0,
    next_retry_at   TIMESTAMPTZ,
    last_error      TEXT,
    sent_msg_id     VARCHAR(120),
    created_by      BIGINT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    sent_at         TIMESTAMPTZ,
    CONSTRAINT wa_outbox_status CHECK (status IN ('pending','sending','sent','failed'))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_wa_outbox_client ON wa_outbox (client_key);
CREATE INDEX IF NOT EXISTS idx_wa_outbox_due ON wa_outbox (status, next_retry_at) WHERE status IN ('pending','failed');

CREATE TABLE IF NOT EXISTS wa_rules (
    id              BIGSERIAL PRIMARY KEY,
    name            VARCHAR(120) NOT NULL,
    match_type      VARCHAR(16) NOT NULL DEFAULT 'exact',
    pattern         TEXT NOT NULL,
    response        TEXT NOT NULL,
    enabled         BOOLEAN NOT NULL DEFAULT true,
    priority        INTEGER NOT NULL DEFAULT 100,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT wa_rules_match CHECK (match_type IN ('exact','contains','command'))
);

CREATE TABLE IF NOT EXISTS wa_chat_settings (
    remote_jid      VARCHAR(100) PRIMARY KEY,
    auto_reply      BOOLEAN NOT NULL DEFAULT true,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS wa_events (
    id              BIGSERIAL PRIMARY KEY,
    kind            VARCHAR(40) NOT NULL,
    ref             VARCHAR(200),
    detail          TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_wa_events_kind ON wa_events (kind, created_at DESC);

-- منع تكرار البذور: نفس الاسم+النوع+النمط = صف واحد
CREATE UNIQUE INDEX IF NOT EXISTS uq_wa_rules_name ON wa_rules (name, match_type, pattern);

-- إعدادات المحرك (أرقام الإدارة المصرح لها بتقرير واتساب)
CREATE TABLE IF NOT EXISTS wa_settings (
    key         VARCHAR(80) PRIMARY KEY,
    value       TEXT NOT NULL DEFAULT '',
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
