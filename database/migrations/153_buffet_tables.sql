-- ────────────────────────────────────────────────────────────
-- 153_buffet_tables.sql — كوست أصناف بوفيه الشرفة العالمي
-- ────────────────────────────────────────────────────────────
-- مصدر البيانات: "بوفيه-الشرفة-المنيو-والوصفات.html"
-- (مستخرجة من منيو-غداء-وعشاء-7-ايام-جديد.xlsx — 2026-11).
--
-- ثلاث جداول + دالة مساعدة فقط — لا تعديل على أي جدول قائم:
--   buffet_dishes      — الأصناف (65 صنف مستورد من الملف)
--   buffet_ingredients — مكونات كل صنف + ربط اختياري بـ inventory
--   buffet_week        — خطة الأسبوع (7 أيام × غداء/عشاء)
--   pack_kg_for(...)   — استخراج الكيلوجرامات داخل عبوة معلومة وزنها
--
-- التكلفة **لا تُخزَّن** — تُحسب حيًّا من inventory.avgCost وقت الطلب
-- (buffet-logic.js) حتى تنعكس أي زيادة/نقص في السعر تلقائيًا.
-- المكوّنات بلا ربط تظهر «بدون تسعير» — لا أرقام مقدّرة تُخزَّن.
-- pack_kg: عدد الكيلوجرامات داخل وحدة المخزن (مثال: كيس ملح 50 كيلو)
-- — يسمح بحساب تكلفة الكيلو من سعر الكيس «تقديري» ويُعرض موسومًا.
-- ────────────────────────────────────────────────────────────

BEGIN;

CREATE TABLE IF NOT EXISTS buffet_dishes (
    id          BIGSERIAL PRIMARY KEY,
    name        TEXT        NOT NULL,
    category    TEXT        NOT NULL DEFAULT '',
    freq        INTEGER     NOT NULL DEFAULT 1 CHECK (freq >= 0),
    yields      TEXT        NOT NULL DEFAULT '',
    notes       TEXT        NOT NULL DEFAULT '',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT buffet_dishes_name_key UNIQUE (name)
);

CREATE TABLE IF NOT EXISTS buffet_ingredients (
    id           BIGSERIAL PRIMARY KEY,
    dish_id      BIGINT      NOT NULL REFERENCES buffet_dishes(id) ON DELETE CASCADE,
    position     INTEGER     NOT NULL DEFAULT 0,
    name         TEXT        NOT NULL,
    qty          NUMERIC(14,4) NOT NULL DEFAULT 0 CHECK (qty >= 0),
    unit         TEXT        NOT NULL DEFAULT '',
    inventory_id BIGINT      REFERENCES inventory(id) ON DELETE SET NULL,
    pack_kg      NUMERIC(12,4) CHECK (pack_kg IS NULL OR pack_kg > 0),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT buffet_ingredients_dish_position_key UNIQUE (dish_id, position)
);
CREATE INDEX IF NOT EXISTS idx_buffet_ingredients_dish
    ON buffet_ingredients (dish_id);
CREATE INDEX IF NOT EXISTS idx_buffet_ingredients_inventory
    ON buffet_ingredients (inventory_id) WHERE inventory_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS buffet_week (
    day       TEXT   NOT NULL,
    meal      TEXT   NOT NULL,
    position  INTEGER NOT NULL,
    dish_id   BIGINT NOT NULL REFERENCES buffet_dishes(id) ON DELETE CASCADE,
    PRIMARY KEY (day, meal, position)
);

COMMENT ON TABLE buffet_dishes IS 'أصناف بوفيه الشرفة العالمي — بنود المنيو (65 صنفًا من ملف الوصفات).';
COMMENT ON TABLE buffet_ingredients IS 'مكونات أصناف البوفيه — كل سطر يربط اختياريًا بصنف المخزن لحساب التكلفة حيًّا.';
COMMENT ON TABLE buffet_week IS 'خطة البوفيه الأسبوعية — (اليوم، الوجبة، الترتيب) بأصناف المنيو.';
COMMENT ON COLUMN buffet_ingredients.inventory_id IS 'ربط المكوّن بصنف المخزن — NULL = «بدون تسعير» حتى يجري الربط أو يُعتمد صنف جديد.';
COMMENT ON COLUMN buffet_ingredients.pack_kg IS 'الكيلوجرامات داخل وحدة المخزن إذا كانت التعبئة (كيس/شدة/كرتون) — يُمكّن تحويل سعر التعبئة إلى سعر الكيلو لتكلفة «تقديري» معلومة.';

-- pack_kg_for(inv, line_unit): يرجع عدد الكيلوجرامات داخل وحدة صنف المخزن
-- إذا كان اسم الصنف يحمل «… N كيلو …» (مثل: «ملح ناعم 50 كيلو-كيس» → 50)
-- وإلا NULL. لا تُستدعى إلا للأسطر ذات الوحدات الوزنية.
CREATE OR REPLACE FUNCTION pack_kg_for(inv BIGINT, line_unit TEXT)
RETURNS NUMERIC AS $$
DECLARE
    inv_name  TEXT;
    inv_unit  TEXT;
    kg        NUMERIC;
BEGIN
    SELECT name, unit INTO inv_name, inv_unit FROM inventory WHERE id = inv;
    IF inv_name IS NULL THEN RETURN NULL; END IF;
    IF lower(COALESCE(inv_unit, '')) = ANY (ARRAY['kg','كيلو','كيلو جرام','كيلوجرام','كيلو غرام']) THEN
        RETURN NULL;
    END IF;
    IF lower(COALESCE(line_unit, '')) NOT IN ('kg','كيلو','كيلو جرام','كيلوجرام','كيلو غرام','جرام','جم','غرام','g','mg') THEN
        RETURN NULL;
    END IF;
    SELECT (regexp_match(inv_name, '(\d+(?:[\.,]\d+)?)\s*كيلو'))[1]::NUMERIC INTO kg;
    IF kg IS NULL OR kg <= 0 THEN RETURN NULL; END IF;
    RETURN kg;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION pack_kg_for(BIGINT, TEXT) IS 'يستخرج كيلوجرامات التعبئة من اسم صنف المخزن — لتكلفة الكيلو «تقديري» موسومة.';

COMMIT;
