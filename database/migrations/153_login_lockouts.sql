-- 153: قفل الدخول الدائم (R18++) — كان in-memory يتصفّر بإعادة التشغيل.
-- جدول صغير بمفتاح (IP+username)؛ الكود يتراجع إلى الذاكرة إن لم يُطبق الترحيل
-- (نشر آمن: الكود أولًا ثم الترحيل بلا انقطاع).
CREATE TABLE IF NOT EXISTS login_lockouts (
    key         TEXT PRIMARY KEY,
    fails       INTEGER NOT NULL DEFAULT 0,
    first_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    lock_until  TIMESTAMPTZ,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_login_lockouts_lock_until ON login_lockouts (lock_until);
CREATE INDEX IF NOT EXISTS idx_login_lockouts_first_at ON login_lockouts (first_at);
