-- Migration 032: enforce a server-managed first-login password rotation flag.
BEGIN;

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT FALSE;

-- A legacy initial admin may still use the public password 1234. The Node
-- migration script verifies the bcrypt value and replaces it with a random
-- bootstrap password; this flag prevents operational access until rotation.
UPDATE users
SET must_change_password = TRUE
WHERE username = 'admin' AND password = '__SETUP_PENDING__';

COMMIT;
