-- 049: surrogate id for generic CRUD/sort on keyless HR tables (month stays PK)
ALTER TABLE payroll_runs ADD COLUMN IF NOT EXISTS id BIGSERIAL UNIQUE;
ALTER TABLE advance_applications ADD COLUMN IF NOT EXISTS id BIGSERIAL UNIQUE;
