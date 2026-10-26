-- 070_employee_day_off.sql — Weekly day off per employee (0=Sunday..6=Saturday)
-- ────────────────────────────────────────────────────────────────────────────
-- Idempotent. Powers the paper rosters' fixed weekly rest day.

ALTER TABLE employees ADD COLUMN IF NOT EXISTS day_off SMALLINT;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'employees_day_off_chk') THEN
        ALTER TABLE employees ADD CONSTRAINT employees_day_off_chk
            CHECK (day_off IS NULL OR (day_off >= 0 AND day_off <= 6));
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_employees_day_off
    ON employees (day_off) WHERE day_off IS NOT NULL;
