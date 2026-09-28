-- 072_ys_mirror_payments.sql — Payment split + table/zone on the cashier mirror
-- ────────────────────────────────────────────────────────────────────────────
-- CC_BILLS3 carries per-method paid amounts (CASH/SPAN/CRDT/MBL_PYD).

ALTER TABLE ys_mirror_orders ADD COLUMN IF NOT EXISTS pay_cash NUMERIC(14,2) NOT NULL DEFAULT 0;
ALTER TABLE ys_mirror_orders ADD COLUMN IF NOT EXISTS pay_network NUMERIC(14,2) NOT NULL DEFAULT 0;
ALTER TABLE ys_mirror_orders ADD COLUMN IF NOT EXISTS pay_credit NUMERIC(14,2) NOT NULL DEFAULT 0;
ALTER TABLE ys_mirror_orders ADD COLUMN IF NOT EXISTS pay_mobile NUMERIC(14,2) NOT NULL DEFAULT 0;
ALTER TABLE ys_mirror_orders ADD COLUMN IF NOT EXISTS table_name TEXT;
ALTER TABLE ys_mirror_orders ADD COLUMN IF NOT EXISTS zone_name TEXT;
ALTER TABLE ys_mirror_orders ADD COLUMN IF NOT EXISTS printed BOOLEAN NOT NULL DEFAULT FALSE;
