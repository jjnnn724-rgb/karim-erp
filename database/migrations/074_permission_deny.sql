-- 074_permission_deny.sql — Explicit DENY overrides role (and grants)
-- ────────────────────────────────────────────────────────────────────────────
-- user_permissions gains effect ('grant'|'deny'). Deny wins over everything
-- except the admin role (admin stays absolute). Audit covers all transitions.
-- Safe on empty/fresh table. Idempotent.

ALTER TABLE user_permissions ADD COLUMN IF NOT EXISTS effect VARCHAR(10) NOT NULL DEFAULT 'grant';

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_permissions_effect_chk') THEN
        ALTER TABLE user_permissions ADD CONSTRAINT user_permissions_effect_chk
            CHECK (effect IN ('grant', 'deny'));
    END IF;
END $$;

ALTER TABLE permission_audit DROP CONSTRAINT IF EXISTS permission_audit_action_check;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'permission_audit_action_chk') THEN
        ALTER TABLE permission_audit ADD CONSTRAINT permission_audit_action_chk
            CHECK (action IN ('grant', 'revoke', 'deny', 'undeny'));
    END IF;
END $$;
