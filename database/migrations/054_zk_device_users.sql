-- 054_zk_device_users.sql — تخزين مستخدمي جهاز البصمة (أسماء + أرقام)
-- قراءة فقط من الجهاز — لا يؤثر على أي بيانات تشغيلية.
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
