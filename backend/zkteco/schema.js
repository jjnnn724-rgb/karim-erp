/**
 * zkteco/schema.js — مخطط مزامنة البصمة داخل قاعدة البيانات المثبتة
 * ────────────────────────────────────────────────────────────────────────────
 * كل شيء يعتمد كليًا على PostgreSQL المثبت (لا ملفات ولا SQLite):
 *   • attendance_devices  سجل أجهزة البصمة (الهوية الثابتة = الرقم التسلسلي)
 *   • attendance_logs     كل بصمة خام مرة واحدة بالضبط (idempotent)
 *   • device_sync_state   نقطة تفتيش لكل جهاز (لا تعود للخلف)
 *   • employees."deviceUserId"  ربط كل موظف برقمه على جهاز البصمة
 *
 * يُطبق تلقائيًا عند بدء الخادم (idempotent) وكذلك ملف migration 038.
 */

'use strict';

const { pool } = require('../shared-pool');
const { logger } = require('../logger');

const SCHEMA_SQL = `
-- ─── حماية من تعارض جداول الخدمة المستقلة القديمة (snake_case) ───
-- إذا وُجدت جداول من مشروع مزامنة قديم منفصل، تُعاد تسميتها مع فهارسها
-- للحفاظ على أي بيانات ولتوفير أسماء المخطط الجديد.
DO $$
DECLARE r record;
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'attendance_devices')
       AND NOT EXISTS (SELECT 1 FROM information_schema.columns
                       WHERE table_name = 'attendance_devices' AND column_name = 'ipAddress') THEN
        ALTER TABLE attendance_devices RENAME TO attendance_devices_legacy_standalone;
        FOR r IN SELECT indexname FROM pg_indexes
                 WHERE tablename = 'attendance_devices_legacy_standalone' LOOP
            EXECUTE format('ALTER INDEX %I RENAME TO legacy_%s', r.indexname, r.indexname);
        END LOOP;
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'attendance_logs')
       AND NOT EXISTS (SELECT 1 FROM information_schema.columns
                       WHERE table_name = 'attendance_logs' AND column_name = 'attendanceTime') THEN
        ALTER TABLE attendance_logs RENAME TO attendance_logs_legacy_standalone;
        FOR r IN SELECT indexname FROM pg_indexes
                 WHERE tablename = 'attendance_logs_legacy_standalone' LOOP
            EXECUTE format('ALTER INDEX %I RENAME TO legacy_%s', r.indexname, r.indexname);
        END LOOP;
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'device_sync_state')
       AND NOT EXISTS (SELECT 1 FROM information_schema.columns
                       WHERE table_name = 'device_sync_state' AND column_name = 'deviceId') THEN
        ALTER TABLE device_sync_state RENAME TO device_sync_state_legacy_standalone;
        FOR r IN SELECT indexname FROM pg_indexes
                 WHERE tablename = 'device_sync_state_legacy_standalone' LOOP
            EXECUTE format('ALTER INDEX %I RENAME TO legacy_%s', r.indexname, r.indexname);
        END LOOP;
    END IF;
END $$;

-- أجهزة البصمة (الهوية الثابتة عبر device_uid = الرقم التسلسلي)
CREATE TABLE IF NOT EXISTS attendance_devices (
    id BIGSERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    "ipAddress" VARCHAR(64) NOT NULL,
    port INTEGER NOT NULL DEFAULT 4370,
    "commKey" INTEGER NOT NULL DEFAULT 0,
    enabled BOOLEAN NOT NULL DEFAULT true,
    "syncIntervalSeconds" INTEGER NOT NULL DEFAULT 30,
    "deviceUid" VARCHAR(100),
    "deviceName" VARCHAR(100),
    firmware VARCHAR(100),
    platform VARCHAR(100),
    status VARCHAR(20) NOT NULL DEFAULT 'unknown',
    "lastSyncAt" TIMESTAMPTZ,
    "lastError" TEXT,
    "lastErrorAt" TIMESTAMPTZ,
    "totalSynced" BIGINT NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_attendance_devices_endpoint UNIQUE ("ipAddress", port),
    CONSTRAINT ck_attendance_devices_port CHECK (port BETWEEN 1 AND 65535),
    CONSTRAINT ck_attendance_devices_commkey CHECK ("commKey" BETWEEN 0 AND 65535),
    CONSTRAINT ck_attendance_devices_interval CHECK ("syncIntervalSeconds" BETWEEN 5 AND 86400),
    CONSTRAINT ck_attendance_devices_status CHECK (status IN ('unknown','online','offline','disabled','syncing'))
);
CREATE INDEX IF NOT EXISTS idx_attendance_devices_uid ON attendance_devices("deviceUid");

-- كل بصمة خام تُخزن مرة واحدة بالضبط (idempotent) — سجل تدقيق دائم
CREATE TABLE IF NOT EXISTS attendance_logs (
    id BIGSERIAL PRIMARY KEY,
    "deviceId" BIGINT NOT NULL REFERENCES attendance_devices(id) ON DELETE CASCADE,
    "deviceUserId" VARCHAR(64) NOT NULL,
    "employeeId" BIGINT REFERENCES employees(id) ON DELETE SET NULL,
    "attendanceTime" TIMESTAMPTZ NOT NULL,
    "verifyType" SMALLINT NOT NULL DEFAULT 1,
    "punchState" SMALLINT NOT NULL DEFAULT 0,
    -- لا default: كل كاتب يعلن مصدره صراحةً (device / portal / manual) — 2026-11-07
    source VARCHAR(20) NOT NULL,
    "syncedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_attendance_logs_punch UNIQUE ("deviceId", "deviceUserId", "attendanceTime"),
    CONSTRAINT attendance_logs_source_allowed CHECK (source IN ('device', 'portal', 'manual'))
);
-- تصحيح بصمةٍ خام واحدة (2026-11-06): الصفُّ يبقى في الدفتر ولا يُحذف،
-- ويُستثنى من بناء الحضور ومن المطابقة حتى تُستعاد — أثرٌ دائمٌ قابل للعكس.
ALTER TABLE attendance_logs ADD COLUMN IF NOT EXISTS ignored BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE attendance_logs ADD COLUMN IF NOT EXISTS "ignoredReason" TEXT;
ALTER TABLE attendance_logs ADD COLUMN IF NOT EXISTS "ignoredBy" VARCHAR(120);
ALTER TABLE attendance_logs ADD COLUMN IF NOT EXISTS "ignoredAt" TIMESTAMPTZ;
-- الحذر لجدولٍ قائم: القيد يُضاف NOT VALID (الصفوف القديمة تبقى، والجديد يُرفض)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'attendance_logs_source_allowed') THEN
        ALTER TABLE attendance_logs ADD CONSTRAINT attendance_logs_source_allowed
            CHECK (source IN ('device', 'portal', 'manual')) NOT VALID;
    END IF;
END $$;
-- لا مصدر ضمني على جدولٍ قائم أيضًا: الكاتب يعلن مصدره.
ALTER TABLE attendance_logs ALTER COLUMN source DROP DEFAULT;
CREATE INDEX IF NOT EXISTS idx_attendance_logs_ignored
    ON attendance_logs("attendanceTime") WHERE ignored;
CREATE INDEX IF NOT EXISTS idx_attendance_logs_time ON attendance_logs("attendanceTime");
CREATE INDEX IF NOT EXISTS idx_attendance_logs_employee ON attendance_logs("employeeId", "attendanceTime");
CREATE INDEX IF NOT EXISTS idx_attendance_logs_unmapped ON attendance_logs("deviceId")
    WHERE "employeeId" IS NULL;
-- الربط المتأخر يبحث برقم الجهاز في البصمات غير المنسوبة فقط (مركز التحكم)
CREATE INDEX IF NOT EXISTS idx_attendance_logs_unmapped_uid
    ON attendance_logs (btrim("deviceUserId")) WHERE "employeeId" IS NULL;

-- نقطة تفتيش المزامنة لكل جهاز (GREATEST — لا تراجع للخلف)
CREATE TABLE IF NOT EXISTS device_sync_state (
    "deviceId" BIGINT PRIMARY KEY REFERENCES attendance_devices(id) ON DELETE CASCADE,
    "lastRecordTime" TIMESTAMPTZ,
    "totalRead" BIGINT NOT NULL DEFAULT 0,
    "totalNew" BIGINT NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ربط كل موظف برقمه على جهاز البصمة (بوابة الموظف تعتمد عليه)
ALTER TABLE employees ADD COLUMN IF NOT EXISTS "deviceUserId" VARCHAR(64);
ALTER TABLE employees ADD COLUMN IF NOT EXISTS "deviceUserIdAlt" VARCHAR(64);
CREATE INDEX IF NOT EXISTS idx_employees_device_user ON employees("deviceUserId");
CREATE INDEX IF NOT EXISTS idx_employees_device_user_alt ON employees("deviceUserIdAlt");

-- مستخدمو الجهاز المخزنون (أسماء + أرقام للربط) — قراءة فقط من الجهاز
CREATE TABLE IF NOT EXISTS zk_device_users (
    id BIGSERIAL PRIMARY KEY,
    "deviceId" BIGINT NOT NULL REFERENCES attendance_devices(id) ON DELETE CASCADE,
    uid INTEGER,
    "userId" VARCHAR(24) NOT NULL,
    name VARCHAR(255),
    privilege INTEGER,
    card BIGINT,
    punches INTEGER NOT NULL DEFAULT 0,
    "lastSeenAt" TIMESTAMPTZ,
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE ("deviceId", "userId")
);
CREATE INDEX IF NOT EXISTS idx_zk_device_users_device ON zk_device_users ("deviceId");

-- سجل إجراءات مركز التحكم (تشغيل/إيقاف المحرك، إعادة بناء الأيام)
-- يُكتب ولا يُعدَّل ولا يُحذف — أثرٌ دائم لمن فعل ماذا ولماذا.
CREATE TABLE IF NOT EXISTS zk_control_audit (
    id BIGSERIAL PRIMARY KEY,
    action VARCHAR(32) NOT NULL,
    "actorId" BIGINT,
    "actorName" VARCHAR(120),
    "actorRole" VARCHAR(40),
    reason TEXT,
    detail JSONB NOT NULL DEFAULT '{}'::jsonb,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_zk_control_audit_created
    ON zk_control_audit ("createdAt" DESC);
`;

/** @type {Promise<void>|null} ضمان تطبيق المخطط مرة واحدة فقط */
let ensured = null;

/** تطبيق المخطط مرة واحدة (idempotent) */
function ensureZktecoSchema() {
  if (!ensured) {
    ensured = (async () => {
      await pool.query(SCHEMA_SQL);
      logger.info(
        '[ZKTECO_SCHEMA] مخطط مزامنة البصمة جاهز (attendance_devices / attendance_logs / device_sync_state / employees.deviceUserId)'
      );
    })().catch(error => {
      ensured = null;
      throw error;
    });
  }
  return ensured;
}

module.exports = { ensureZktecoSchema, SCHEMA_SQL };
