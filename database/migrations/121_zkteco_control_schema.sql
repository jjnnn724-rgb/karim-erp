-- 121_zkteco_control_schema.sql
-- توحيد مخطط التحكم بالبصمة: الأعمدة/الجداول التي كانت تُنشأ يدويًا تصبح جزءًا
-- من سلسلة المهجرات، حتى تعمل قاعدة نظيفة بنفس سلوك الإنتاج.
-- idempotent بالكامل — لا تعديل على بيانات قائمة.

ALTER TABLE attendance_logs
    ADD COLUMN IF NOT EXISTS ignored BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS "ignoredReason" TEXT,
    ADD COLUMN IF NOT EXISTS "ignoredBy" VARCHAR(64),
    ADD COLUMN IF NOT EXISTS "ignoredAt" TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS zk_control_audit (
    id BIGSERIAL PRIMARY KEY,
    action VARCHAR(120) NOT NULL,
    "actorId" BIGINT,
    "actorName" VARCHAR(160),
    "actorRole" VARCHAR(80),
    reason TEXT,
    detail JSONB NOT NULL DEFAULT '{}'::jsonb,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_zk_control_audit_created
    ON zk_control_audit ("createdAt" DESC, id DESC);
