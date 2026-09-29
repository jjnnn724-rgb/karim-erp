-- 077_punch_location_hardening.sql — Multi-fix GPS + strict geofence + lockout
-- ────────────────────────────────────────────────────────────────────────────
-- Spec: docs/SPEC-employee-pwa-attendance-geofence-v1.md
-- تحصين تحديد الموقع (طلب المالك 2026-09-29): دقة أعلى ومقاومة تلاعب أقوى.
--
--   punch_multi_fix_required : السيرفر يطالب بقراءات GPS متعددة (≥2) ويحللها
--                              (تجميد/انتقال مستحيل/تشتت) — يرفض القناع الواحد
--   punch_strict_geofence    : النطاق الصارم — منطقة الغموض (المسافة ± الدقة
--                              تمتد خارج النطاق) تُرفض بدل التسامح معها
--   punch_max_rejects_10m    : قفل مؤقت للموظف بعد هذا العدد من الرفض في 10 دقائق
--
-- Purely additive settings. Idempotent.
-- ────────────────────────────────────────────────────────────────────────────

INSERT INTO punch_settings (key, value) VALUES
    ('punch_multi_fix_required', 'true'),
    ('punch_strict_geofence',    'false'),
    ('punch_max_rejects_10m',    '5')
ON CONFLICT (key) DO NOTHING;
