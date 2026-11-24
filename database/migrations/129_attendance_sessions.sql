-- ═══════════════════════════════════════════════════════════════════════════
-- 129_attendance_sessions.sql
-- محرّك الجلسات: البصمة حدث، واليوم ناتج قابل لإعادة البناء
-- ───────────────────────────────────────────────────────────────────────────
-- راجع docs/ATTENDANCE-ROOT-FIX.md. الجدول يحفظ نتيجة بناء اليوم من البصمات
-- الخام (backend/attendance-sessions.js) — لا قرارًا يُتّخذ لحظة وصول البصمة.
--
-- • مفتاح فريد (employeeId, shiftDate, seq): إعادة البناء = DELETE ثم INSERT
--   لنفس اليوم داخل معاملة ⇒ نفس البصمات تُنتج نفس الصفوف دائمًا (idempotent).
-- • cost/reason: القرار قابل للتفسير — المدير يرى لماذا اقترنت هذه البصمة بتلك.
-- • builtAt/builtBy: من بنى اليوم ومتى (المحرّك أو سكربت إصلاح معتمد).
--
-- idempotent: CREATE TABLE/INDEX IF NOT EXISTS.
-- ROLLBACK: DROP TABLE IF EXISTS attendance_sessions;
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE TABLE IF NOT EXISTS attendance_sessions (
    id BIGSERIAL PRIMARY KEY,
    "employeeId" BIGINT NOT NULL,
    "shiftDate" DATE NOT NULL,
    seq SMALLINT NOT NULL,
    "inAt" TIMESTAMPTZ NOT NULL,
    "outAt" TIMESTAMPTZ NOT NULL,
    minutes INTEGER NOT NULL,
    cost NUMERIC(10, 2),
    source VARCHAR(24) NOT NULL DEFAULT 'builder',
    "builtAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "builtBy" VARCHAR(120),
    CONSTRAINT attendance_sessions_positive_minutes CHECK (minutes > 0),
    CONSTRAINT attendance_sessions_order CHECK ("outAt" > "inAt"),
    CONSTRAINT attendance_sessions_unique UNIQUE ("employeeId", "shiftDate", seq)
);

COMMENT ON TABLE attendance_sessions IS
    'جلسات اليوم المشتقة من البصمات الخام — تُعاد بناؤها بنفس الناتج دائمًا (idempotent).';
COMMENT ON COLUMN attendance_sessions.cost IS
    'تكلفة قرار الاقتران (ساعات) — تشرح للمدير سبب اختيار هذه الجلسة.';
COMMENT ON COLUMN attendance_sessions.seq IS
    'ترتيب الجلسة داخل يوم الوردية (١، ٢… لوردية مقسمة).';

CREATE INDEX IF NOT EXISTS idx_attendance_sessions_employee_date
    ON attendance_sessions ("employeeId", "shiftDate" DESC);

CREATE INDEX IF NOT EXISTS idx_attendance_sessions_open
    ON attendance_sessions ("shiftDate")
    WHERE "outAt" IS NULL;

COMMIT;
