-- Karim ERP v3.1.0 — Revenue idempotency at database level
BEGIN;

ALTER TABLE revenues ADD COLUMN IF NOT EXISTS pos_order_id UUID;

UPDATE revenues
SET pos_order_id = m.order_id::uuid
FROM (
    SELECT id, substring(notes FROM 'order=([0-9a-fA-F-]{36})') AS order_id
    FROM revenues
    WHERE notes ~ 'order=[0-9a-fA-F-]{36}'
) AS m
WHERE revenues.id = m.id
  AND revenues.pos_order_id IS NULL
  AND m.order_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_revenues_pos_order_id
    ON revenues(pos_order_id)
    WHERE pos_order_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_revenues_pos_order_id ON revenues(pos_order_id);

COMMIT;
