-- 059_wa_scheduler_nlu.sql — Scheduled Messages + NLU Analytics Tables
-- ════════════════════════════════════════════════════════════════════════════════
-- v5.0 Enterprise-grade features:
--   1. wa_scheduled_messages — one-time & recurring scheduled messages
--   2. wa_conversation_history — AI conversation memory (NLU context)
--   3. wa_nlu_analytics — intent detection analytics & training data

-- ─── Scheduled Messages ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS wa_scheduled_messages (
    id              BIGSERIAL PRIMARY KEY,
    remote_jid      TEXT NOT NULL,
    body            TEXT,
    template_name   TEXT,
    template_vars   JSONB DEFAULT '[]'::jsonb,
    recurrence      VARCHAR(20) DEFAULT 'once',   -- once | daily | weekly | monthly
    scheduled_at    TIMESTAMPTZ NOT NULL,
    next_run_at     TIMESTAMPTZ,
    sent_at         TIMESTAMPTZ,
    outbox_id       BIGINT,
    status          VARCHAR(20) DEFAULT 'pending', -- pending | sent | failed | cancelled
    last_error      TEXT,
    created_by      TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_wa_sched_due ON wa_scheduled_messages (scheduled_at)
    WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_wa_sched_jid ON wa_scheduled_messages (remote_jid);
CREATE INDEX IF NOT EXISTS idx_wa_sched_recur ON wa_scheduled_messages (next_run_at)
    WHERE status = 'pending' AND recurrence IN ('daily', 'weekly', 'monthly');

-- ─── Conversation History (AI Memory) ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS wa_conversation_history (
    id              BIGSERIAL PRIMARY KEY,
    remote_jid      TEXT NOT NULL,
    direction       VARCHAR(10) NOT NULL,         -- inbound | outbound
    body            TEXT,
    intent          VARCHAR(50),                  -- NLU detected intent
    intent_confidence  REAL,
    entities        JSONB DEFAULT '{}'::jsonb,
    sentiment       VARCHAR(20),                  -- positive | neutral | negative | angry
    language        VARCHAR(5) DEFAULT 'ar',
    is_ai_reply     BOOLEAN DEFAULT false,
    ai_source       VARCHAR(20),                 -- llm | nlu | rule | router
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_wa_conv_jid ON wa_conversation_history (remote_jid, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_wa_conv_intent ON wa_conversation_history (intent);
CREATE INDEX IF NOT EXISTS idx_wa_conv_time ON wa_conversation_history (created_at DESC);

-- Auto-cleanup: keep only last 90 days of conversation history
-- (run via pg_cron or application-level periodic cleanup)

-- ─── NLU Analytics & Training Data ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS wa_nlu_analytics (
    id              BIGSERIAL PRIMARY KEY,
    remote_jid      TEXT,
    message_text    TEXT,
    detected_intent VARCHAR(50),
    confidence      REAL,
    actual_intent   VARCHAR(50),                 -- corrected by admin for training
    language        VARCHAR(5),
    sentiment       VARCHAR(20),
    entities        JSONB DEFAULT '{}'::jsonb,
    ambiguous       BOOLEAN DEFAULT false,
    was_routed_to   VARCHAR(20),                 -- rule | router | ai | fallback
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_wa_nlu_intent ON wa_nlu_analytics (detected_intent);
CREATE INDEX IF NOT EXISTS idx_wa_nlu_time ON wa_nlu_analytics (created_at DESC);

-- ─── Quick command templates for admin ────────────────────────────────────────
INSERT INTO wa_settings (key, value, updated_at)
VALUES ('nlu_enabled', 'true', NOW())
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW();

INSERT INTO wa_settings (key, value, updated_at)
VALUES ('scheduler_enabled', 'true', NOW())
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW();

INSERT INTO wa_settings (key, value, updated_at)
VALUES ('ai_provider', 'ollama', NOW())
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW();
