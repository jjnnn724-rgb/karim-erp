-- 047_attendance_decisions.sql — سجل قرارات محرك الحضور الذكي (قابل للمراجعة)
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS attendance_decisions (
    id BIGINT PRIMARY KEY,
    "employeeId" BIGINT REFERENCES employees(id) ON DELETE CASCADE,
    date VARCHAR(10),
    decision VARCHAR(30) NOT NULL,
    confidence NUMERIC(5,2),
    reason TEXT,
    punch_state SMALLINT,
    device_id BIGINT REFERENCES attendance_devices(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_attendance_decisions_emp ON attendance_decisions("employeeId", date);
