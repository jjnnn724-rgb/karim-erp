-- =====================================================
-- Migration 007: Force-migrate ALL plaintext passwords to bcrypt
-- =====================================================
-- This migration runs in PostgreSQL using pgcrypto's crypt() function.
-- However, pgcrypto does NOT support bcrypt ($2a$/$2b$/$2y$) — it uses
-- its own Blowfish-based crypt format. Therefore we cannot do this in
-- pure SQL and the actual migration is performed by a Node.js script
-- (scripts/migrate-plaintext-passwords.js) that uses bcryptjs.
--
-- This SQL file exists only to:
--   1. Be tracked in the migration log (for traceability)
--   2. Add an index to detect any future unmigrated passwords
--   3. Document the policy: plaintext passwords are FORBIDDEN
--
-- ⚠️ Run `node scripts/migrate-plaintext-passwords.js` BEFORE starting
--    the backend in production. The script:
--      - Finds every user whose password does NOT match /^$2[aby]\$/
--      - Hashes each one with bcrypt (12 rounds) using a known default
--        (for seed users with password '1234', we hash '1234')
--      - For unknown plaintext passwords, generates a random 24-char
--        password and writes it to userData/orphan-passwords.json
--      - Updates the users row and sets password_migrated_at = NOW()
--
-- After this migration is applied, the login handler in
-- backend/cashier-module/jwt-middleware.js will REJECT any password
-- that is not bcrypt-hashed, with no plaintext fallback.
-- =====================================================

-- Index for detecting unmigrated users (will be empty after migration script runs)
CREATE INDEX IF NOT EXISTS idx_users_password_plaintext
ON users (id)
WHERE password IS NOT NULL
  AND password NOT LIKE '$2a$%'
  AND password NOT LIKE '$2b$%'
  AND password NOT LIKE '$2y$%';

-- Verification query (run after migrate-plaintext-passwords.js):
--   SELECT COUNT(*) FROM users
--   WHERE password NOT LIKE '$2a$%'
--     AND password NOT LIKE '$2b$%'
--     AND password NOT LIKE '$2y$%';
-- Expected: 0 (zero unmigrated passwords)

-- Add a comment to the users table documenting the policy
COMMENT ON TABLE users IS
'Users table. As of 2026-07-17, ALL password values MUST be bcrypt-hashed ($2a$/$2b$/$2y$). Plaintext passwords are rejected at login with no fallback. See migration 007 and scripts/migrate-plaintext-passwords.js.';
