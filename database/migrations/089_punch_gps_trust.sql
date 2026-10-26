-- 089_punch_gps_trust.sql — GPS trust hardening: teleport + realism audit
-- ────────────────────────────────────────────────────────────────────────────
-- UPGRADE 2026-10-01: تقوية الجي بي اس للبصمة ضد التزييف (Fake GPS):
--   • punch_teleport_check / punch_max_teleport_kmh: فحص التنقل المستحيل بين
--     بصمتين مقبولتين (آخر بصمة للموظف vs الحالية) — يصطاد مشاركة الحسابات
--     والتزييف المتنقل (المعيار الصناعي: سرعة مستحيلة = تنقل لا سيارة).
--   • punch_attempts: أعمدة تدقيق جديدة (lat/lng الأفضل + trust_score/Signals)
--     حتى تُبنى بصمة الموقع التاريخية لكل موظف وتُفحص التنقلات.
--
-- Purely additive + idempotent. Safe on fresh and migrated databases.
-- ────────────────────────────────────────────────────────────────────────────

ALTER TABLE punch_attempts ADD COLUMN IF NOT EXISTS lat NUMERIC(10, 7);
ALTER TABLE punch_attempts ADD COLUMN IF NOT EXISTS lng NUMERIC(10, 7);
ALTER TABLE punch_attempts ADD COLUMN IF NOT EXISTS trust_score INTEGER;
ALTER TABLE punch_attempts ADD COLUMN IF NOT EXISTS trust_signals TEXT;
ALTER TABLE punch_attempts ADD COLUMN IF NOT EXISTS teleport_kmh NUMERIC(10, 1);

CREATE INDEX IF NOT EXISTS idx_punch_attempts_user_accepted_time
    ON punch_attempts (user_id, attempted_at DESC)
    WHERE decision = 'accepted';

INSERT INTO punch_settings (key, value) VALUES
    ('punch_teleport_check',   'true'),
    ('punch_max_teleport_kmh', '250')
ON CONFLICT (key) DO NOTHING;
