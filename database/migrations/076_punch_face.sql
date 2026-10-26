-- 076_punch_face.sql — Face recognition for the self-service punch (L5+)
-- ────────────────────────────────────────────────────────────────────────────
-- Spec: docs/SPEC-employee-pwa-attendance-geofence-v1.md
-- Plan: docs/PLAN-safe-rollout-playbook-v1.md
--
-- تصميم أمان مهم: نُخزّن "بصمة الوجه" كمتجه عددي (descriptor من 128 قيمة
-- يُنتجه نموذج face_recognition) ولا نُخزّن صورة الوجه إطلاقًا — المتجه
-- غير قابل للعكس إلى وجه (بيانات حيوية) — خصوصية §5.5.
--
-- Purely ADDITIVE. Idempotent. Ships OFF (punch_face_enabled=false, G4).
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS punch_face_templates (
    id          BIGSERIAL PRIMARY KEY,
    user_id     BIGINT NOT NULL UNIQUE,
    descriptor  JSONB NOT NULL,
    enrolled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    enrolled_by VARCHAR(100),
    active      BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE INDEX IF NOT EXISTS idx_punch_face_templates_user_active
    ON punch_face_templates (user_id) WHERE active = TRUE;

-- المسافة بين وجه الموظف والقالب تُسجَّل مع كل محاولة (شفافية + ضبط حد القرار)
ALTER TABLE punch_attempts ADD COLUMN IF NOT EXISTS face_distance NUMERIC(6,4);

INSERT INTO punch_settings (key, value) VALUES
    ('punch_face_enabled',   'false'),
    ('punch_face_threshold', '0.55')
ON CONFLICT (key) DO NOTHING;
