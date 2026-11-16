-- ────────────────────────────────────────────────────────────
-- 155_buffet_link_audit.sql — سجل ربط مكوّنات البوفيه بأصناف المخزن
-- ────────────────────────────────────────────────────────────
-- كل ربط (من المحرك أو يدويًا من الشاشة) يُسجل مع:
--   من: actor (اسم/دور المسؤول) · ماذا: line_id ← inventory_id · لماذا: rule+score
-- الغاية: حوكمة بلا أرقام بلا مصدر — «من ربط ماذا ولماذا» ظاهر دائمًا.
-- ────────────────────────────────────────────────────────────

BEGIN;

CREATE TABLE IF NOT EXISTS buffet_link_audit (
    id           BIGSERIAL PRIMARY KEY,
    dish_id      BIGINT      NOT NULL,
    line_id      BIGINT      NOT NULL,
    ingredient   TEXT        NOT NULL,
    inventory_id BIGINT      REFERENCES inventory(id) ON DELETE SET NULL,
    rule         TEXT        NOT NULL DEFAULT '',
    score        NUMERIC(5,2),
    pack_kg      NUMERIC(12,4),
    actor        TEXT        NOT NULL DEFAULT '',
    applied_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_buffet_link_audit_line ON buffet_link_audit (line_id);
CREATE INDEX IF NOT EXISTS idx_buffet_link_audit_inv ON buffet_link_audit (inventory_id);

COMMENT ON TABLE buffet_link_audit IS 'سجل ربط سطور البوفيه بأصناف المخزن — من/ماذا/لماذا ولكل سطر.';

COMMIT;
