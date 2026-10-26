-- 050: مرايا يارسوفت (عملاء + أصول ثابتة) — قراءة فقط من Oracle
CREATE TABLE IF NOT EXISTS ys_customers (
    id BIGSERIAL PRIMARY KEY,
    code VARCHAR(50) NOT NULL UNIQUE,
    name VARCHAR(255),
    phones VARCHAR(255),
    address VARCHAR(255),
    active VARCHAR(10),
    synced_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS ys_assets (
    id BIGSERIAL PRIMARY KEY,
    asset_id VARCHAR(50) NOT NULL UNIQUE,
    name VARCHAR(255),
    type_name VARCHAR(255),
    buy_date DATE,
    buy_price NUMERIC(14,2) NOT NULL DEFAULT 0,
    supplier VARCHAR(255),
    barcode VARCHAR(100),
    synced_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
