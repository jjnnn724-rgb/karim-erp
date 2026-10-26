-- 051: التقفيل اليومي لكاشيرية ياراسوفت (1، 4و5، 6، 9) — لقطة ثابتة لعدد الفواتير والإجمالي لكل يوم
CREATE TABLE IF NOT EXISTS ys_daily_closings (
    id BIGSERIAL PRIMARY KEY,
    day DATE NOT NULL,
    dept_code VARCHAR(50) NOT NULL,
    display_ar VARCHAR(255),
    invoices INTEGER NOT NULL DEFAULT 0,
    total NUMERIC(14,2) NOT NULL DEFAULT 0,
    notes TEXT,
    closed_by BIGINT,
    closed_by_name VARCHAR(255),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_ys_daily_closings
    ON ys_daily_closings (day, dept_code);
CREATE INDEX IF NOT EXISTS idx_ys_daily_closings_day
    ON ys_daily_closings (day DESC);
