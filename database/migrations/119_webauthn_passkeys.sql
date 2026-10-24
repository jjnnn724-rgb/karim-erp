-- ════════════════════════════════════════════════════════════════════════════
-- 119_webauthn_passkeys.sql — مفاتيح المرور (WebAuthn) عاملًا ثانيًا
-- ────────────────────────────────────────────────────────────────────────────
-- additive فقط: جدولان جديدان، ولا تعديل على أي جدول قائم.
--
-- user_webauthn_credentials
--   المفتاح العام فقط هو ما يُخزَّن (لا سر). credential_id معرّف المتصفح
--   base64url، وcounter يزداد مع كل استخدام للأجهزة التي تعدّ (الهواتف
--   الحديثة تبقيه صفرًا لأنها توقّع بدون عدّاد).
--
-- webauthn_challenges
--   التحدّي عشوائي قصير العمر (5 دقائق) ويُحذف عند الاستهلاك: صفٌّ واحد لكل
--   عملية، فلا يصلح تحدٍّ قديم لإعادة التشغيل. origin يُخزَّن مع التحدّي كي
--   يُتحقَّق الطلب من نفس الأصل الذي طلب التحدّي.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE TABLE IF NOT EXISTS user_webauthn_credentials (
    id            BIGSERIAL PRIMARY KEY,
    user_id       BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    credential_id TEXT NOT NULL UNIQUE,
    public_key    BYTEA NOT NULL,
    counter       BIGINT NOT NULL DEFAULT 0,
    transports    TEXT[] NOT NULL DEFAULT '{}',
    device_label  TEXT,
    backed_up     BOOLEAN NOT NULL DEFAULT FALSE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_used_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_user_webauthn_user
    ON user_webauthn_credentials (user_id);

CREATE TABLE IF NOT EXISTS webauthn_challenges (
    id         BIGSERIAL PRIMARY KEY,
    user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    purpose    TEXT NOT NULL CHECK (purpose IN ('register', 'login')),
    challenge  TEXT NOT NULL,
    origin     TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_webauthn_challenges_lookup
    ON webauthn_challenges (user_id, purpose, challenge);

CREATE INDEX IF NOT EXISTS idx_webauthn_challenges_expiry
    ON webauthn_challenges (expires_at);

COMMIT;
