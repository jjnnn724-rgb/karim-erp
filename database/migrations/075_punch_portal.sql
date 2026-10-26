-- 075_punch_portal.sql — Employee self-service punch (portal) infrastructure
-- ────────────────────────────────────────────────────────────────────────────
-- Spec: docs/SPEC-employee-pwa-attendance-geofence-v1.md
-- Plan: docs/PLAN-safe-rollout-playbook-v1.md (step S1)
--
-- Purely ADDITIVE: three new objects only — no existing table/column is
-- touched. Safe on fresh and migrated databases. Idempotent.
--
--   punch_attempts  — full audit trail of every punch attempt (accepted or
--                     rejected, with the exact reject reason)
--   punch_devices   — device binding per user account (anti-sharing, L4)
--   punch_settings  — live kill-switches and geofence configuration
--                     (everything ships OFF per safety contract G4)
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS punch_attempts (
    id            BIGSERIAL PRIMARY KEY,
    user_id       BIGINT,
    username      VARCHAR(100),
    employee_id   BIGINT,
    attempted_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    remote_ip     VARCHAR(64),
    network_ok    BOOLEAN,
    has_location  BOOLEAN,
    accuracy_m    NUMERIC(8, 2),
    fix_age_s     INTEGER,
    distance_m    NUMERIC(10, 2),
    radius_m      INTEGER,
    device_id     VARCHAR(80),
    decision      VARCHAR(10) NOT NULL DEFAULT 'rejected',
    reject_code   VARCHAR(60),
    engine_result JSONB,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'punch_attempts_decision_chk') THEN
        ALTER TABLE punch_attempts ADD CONSTRAINT punch_attempts_decision_chk
            CHECK (decision IN ('accepted', 'rejected'));
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_punch_attempts_user_time
    ON punch_attempts (user_id, attempted_at DESC);
CREATE INDEX IF NOT EXISTS idx_punch_attempts_decision_time
    ON punch_attempts (decision, attempted_at DESC);
CREATE INDEX IF NOT EXISTS idx_punch_attempts_reject_code
    ON punch_attempts (reject_code, attempted_at DESC);

-- ─── Device binding (L4): one active device per user account ───────────────

CREATE TABLE IF NOT EXISTS punch_devices (
    id          BIGSERIAL PRIMARY KEY,
    user_id     BIGINT NOT NULL,
    device_id   VARCHAR(80) NOT NULL,
    device_name VARCHAR(120),
    bound_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    bound_ip    VARCHAR(64),
    last_seen_at TIMESTAMPTZ,
    active      BOOLEAN NOT NULL DEFAULT TRUE,
    UNIQUE (user_id, device_id)
);

CREATE INDEX IF NOT EXISTS idx_punch_devices_user_active
    ON punch_devices (user_id) WHERE active = TRUE;

-- ─── Live configuration / kill-switches (contract G4: born OFF) ────────────

CREATE TABLE IF NOT EXISTS punch_settings (
    key        VARCHAR(60) PRIMARY KEY,
    value      TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_by VARCHAR(100)
);

INSERT INTO punch_settings (key, value) VALUES
    ('punch_portal_enabled',   'false'),
    ('punch_geofence_enabled', 'false'),
    ('punch_device_binding',   'true'),
    ('punch_selfie_enabled',   'false'),
    ('punch_radius_meters',    '120'),
    ('punch_max_accuracy_m',   '50'),
    ('punch_max_fix_age_s',    '30')
ON CONFLICT (key) DO NOTHING;
