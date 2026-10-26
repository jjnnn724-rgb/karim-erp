-- Migration 015: Database-backed held POS orders
BEGIN;

CREATE TABLE IF NOT EXISTS pos_held_orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id BIGINT NOT NULL REFERENCES pos_shift_sessions(id) ON DELETE CASCADE,
    department_id BIGINT NOT NULL REFERENCES pos_departments(id) ON DELETE RESTRICT,
    cashier_id BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    items JSONB NOT NULL,
    cart_discount JSONB,
    total_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_pos_held_orders_session
    ON pos_held_orders(session_id, created_at DESC);

COMMIT;
