-- 153 down: إسقاط جدول قفل الدخول الدائم.
DROP INDEX IF EXISTS idx_login_lockouts_first_at;
DROP INDEX IF EXISTS idx_login_lockouts_lock_until;
DROP TABLE IF EXISTS login_lockouts;
