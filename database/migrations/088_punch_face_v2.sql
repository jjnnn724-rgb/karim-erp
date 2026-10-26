-- 088_punch_face_v2.sql — Face verification v2: ArcFace R100 embeddings (server-side)
-- ────────────────────────────────────────────────────────────────────────────
-- UPGRADE 2026-10-01: face-api (128-d, client) → ArcFace ResNet100 (512-d,
-- server-side via onnxruntime-node). Server-side matching removes the client
-- camera/model variance that caused "enrolled but rejected".
--
-- Model: face-recognition-resnet100-arcface-onnx — Apache-2.0 (OpenVINO OMZ /
-- onnx/models) — LFW 99.68%. Input 1x3x112x112 RGB (x-127.5)/127.5 → fc1 512.
--
-- Purely ADDITIVE. Idempotent. Ships OFF (punch_face_v2_enabled=false, G4).
-- v1 (face-api descriptors) keeps working until the owner flips the switch.

CREATE TABLE IF NOT EXISTS punch_face_templates_v2 (
    id          BIGSERIAL PRIMARY KEY,
    user_id     BIGINT NOT NULL UNIQUE,
    embeddings  JSONB NOT NULL,            -- مصفوفة حتى 8 متجهات × 512 قيمة (L2-normalized)
    model       VARCHAR(60) NOT NULL DEFAULT 'arcface-r100-omz',
    enrolled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    enrolled_by VARCHAR(100),
    active      BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE INDEX IF NOT EXISTS idx_punch_face_templates_v2_user_active
    ON punch_face_templates_v2 (user_id) WHERE active = TRUE;

INSERT INTO punch_settings (key, value) VALUES
    ('punch_face_v2_enabled',  'false'),
    ('punch_face_v2_threshold', '0.42')   -- تشابه cosine (نفس الشخص ≥ 0.45 عادة)
ON CONFLICT (key) DO NOTHING;
