-- 116_user_mfa.sql — المصادقة الثنائية (TOTP) لحسابات الإدارة
-- ────────────────────────────────────────────────────────────────────────────
-- السرّ يُخزَّن مشفّرًا (AES-256-GCM عبر password-vault) ولا يُرجع في أي API.
-- عمود pending منفصل عن المؤكَّد: إعادة التسجيل لا تمسح السر العامل قبل
-- تأكيد الجديد — وإلا أُقفل صاحب الجهاز المفقود خارج حسابه بضغطة واحدة.
-- recovery_codes: مصفوفة JSON من SHA-256 (ملح = معرّف المستخدم)، كل رمز يُحذف
-- عند استعماله. last_used_step يمنع إعادة استعمال نفس الرمز داخل نافذة 30ث.
CREATE TABLE IF NOT EXISTS user_mfa (
    user_id             BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    secret_enc          TEXT,
    pending_secret_enc  TEXT,
    pending_created_at  TIMESTAMPTZ,
    confirmed_at        TIMESTAMPTZ,
    last_used_step      BIGINT,
    recovery_codes      TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_user_mfa_confirmed ON user_mfa (confirmed_at);
