-- 087_employee_shift_history.sql — تاريخ سريان الدوام (2026-10)
-- تغيير الدوام يسري من تاريخ مستقبلي (افتراضيًا بكره) ولا يمس حسابات الأيام السابقة.
-- additive فقط: جدول جديد + فهرس. لا تعديل على employees.

CREATE TABLE IF NOT EXISTS employee_shift_history (
    id BIGSERIAL PRIMARY KEY,
    employee_id BIGINT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    shift_start VARCHAR(5) NOT NULL,
    shift_karim NUMERIC(5,2) NOT NULL,
    day_off SMALLINT,
    effective_from DATE NOT NULL,
    created_by BIGINT,
    created_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(employee_id, effective_from)
);
CREATE INDEX IF NOT EXISTS idx_shift_hist_emp ON employee_shift_history(employee_id, effective_from);
