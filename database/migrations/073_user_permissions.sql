-- 073_user_permissions.sql — Individual user permission grants (additive over roles)
-- ────────────────────────────────────────────────────────────────────────────
-- Grants can only ADD access on top of the user's role — never remove it.
-- Every change is audit-logged with actor + reason.
-- Idempotent.

CREATE TABLE IF NOT EXISTS user_permissions (
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    perm_key VARCHAR(60) NOT NULL,
    granted_by TEXT,
    granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, perm_key)
);
CREATE INDEX IF NOT EXISTS idx_user_permissions_user ON user_permissions (user_id);

CREATE TABLE IF NOT EXISTS permission_audit (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL,
    perm_key VARCHAR(60) NOT NULL,
    action VARCHAR(10) NOT NULL CHECK (action IN ('grant', 'revoke')),
    acted_by TEXT,
    reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_permission_audit_user ON permission_audit (user_id, created_at DESC);
