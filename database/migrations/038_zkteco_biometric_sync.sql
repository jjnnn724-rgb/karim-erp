-- =====================================================
-- Migration 038: ZKTeco biometric sync (inside ERP)
-- مزامنة أجهزة البصمة داخل النظام — تعتمد كليًا على قاعدة
-- البيانات المثبتة، وتربط كل موظف برقمه على الجهاز ليظهر
-- حضوره/انصرافه في بوابة الموظف بلا تعارض مع التسجيل اليدوي.
-- ملاحظة: يُطبق نفس المحتوى تلقائيًا عبر backend/zkteco/schema.js
-- عند بدء التشغيل (IF NOT EXISTS في كل العبارات).
-- =====================================================

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
    source VARCHAR(20) NOT NULL DEFAULT 'device',
    "syncedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_attendance_logs_punch UNIQUE ("deviceId", "deviceUserId", "attendanceTime")
);
CREATE INDEX IF NOT EXISTS idx_attendance_logs_time ON attendance_logs("attendanceTime");
CREATE INDEX IF NOT EXISTS idx_attendance_logs_employee ON attendance_logs("employeeId", "attendanceTime");
CREATE INDEX IF NOT EXISTS idx_attendance_logs_unmapped ON attendance_logs("deviceId")
    WHERE "employeeId" IS NULL;

-- نقطة تفتيش المزامنة لكل جهاز (GREATEST — لا تراجع للخلف)
CREATE TABLE IF NOT EXISTS device_sync_state (
    "deviceId" BIGINT PRIMARY KEY REFERENCES attendance_devices(id) ON DELETE CASCADE,
    "lastRecordTime" TIMESTAMPTZ,
    "totalRead" BIGINT NOT NULL DEFAULT 0,
    "totalNew" BIGINT NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ربط كل موظف برقمه على جهاز البصمة
ALTER TABLE employees ADD COLUMN IF NOT EXISTS "deviceUserId" VARCHAR(64);
CREATE INDEX IF NOT EXISTS idx_employees_device_user ON employees("deviceUserId");
