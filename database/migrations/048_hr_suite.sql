-- 048_hr_suite.sql — منظومة شؤون العاملين: سلف/جزاءات/عقود/تقييم/مسيرات
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS salary_advances (
    id BIGINT PRIMARY KEY,
    "employeeId" BIGINT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
    date VARCHAR(10) NOT NULL,
    monthly_deduction NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (monthly_deduction >= 0),
    remaining NUMERIC(12,2) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active','closed')),
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_advances_emp ON salary_advances("employeeId", status);

CREATE TABLE IF NOT EXISTS payroll_adjustments (
    id BIGINT PRIMARY KEY,
    "employeeId" BIGINT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    month VARCHAR(7) NOT NULL,
    kind VARCHAR(20) NOT NULL CHECK (kind IN ('penalty','bonus','deduction','allowance')),
    amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
    reason VARCHAR(255),
    created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_adjust_emp_month ON payroll_adjustments("employeeId", month);

CREATE TABLE IF NOT EXISTS employee_contracts (
    id BIGINT PRIMARY KEY,
    "employeeId" BIGINT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    start_date VARCHAR(10) NOT NULL,
    end_date VARCHAR(10) NOT NULL,
    salary NUMERIC(12,2),
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_contracts_emp ON employee_contracts("employeeId", end_date);

CREATE TABLE IF NOT EXISTS employee_evaluations (
    id BIGINT PRIMARY KEY,
    "employeeId" BIGINT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    period VARCHAR(7) NOT NULL,
    score SMALLINT NOT NULL CHECK (score BETWEEN 1 AND 5),
    notes TEXT,
    evaluator VARCHAR(255),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_eval_emp ON employee_evaluations("employeeId", period);

-- تطبيقات أقساط السلف شهريًا (idempotent: قسط واحد لكل سلفة شهريًا مهما أُعيد التوليد)
CREATE TABLE IF NOT EXISTS advance_applications (
    advance_id BIGINT NOT NULL REFERENCES salary_advances(id) ON DELETE CASCADE,
    month VARCHAR(7) NOT NULL,
    amount NUMERIC(12,2) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_advance_month UNIQUE (advance_id, month)
);

CREATE TABLE IF NOT EXISTS payroll_runs (
    month VARCHAR(7) PRIMARY KEY,
    status VARCHAR(20) NOT NULL DEFAULT 'posted',
    employee_count INT NOT NULL DEFAULT 0,
    total_basic NUMERIC(14,2) NOT NULL DEFAULT 0,
    total_overtime NUMERIC(14,2) NOT NULL DEFAULT 0,
    total_bonuses NUMERIC(14,2) NOT NULL DEFAULT 0,
    total_penalties NUMERIC(14,2) NOT NULL DEFAULT 0,
    total_advances NUMERIC(14,2) NOT NULL DEFAULT 0,
    total_net NUMERIC(14,2) NOT NULL DEFAULT 0,
    created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
