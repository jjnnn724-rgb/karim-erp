-- ═══════════════════════════════════════════════════════════════════════════
-- 035_dept_panel_infrastructure.sql — Task 28
-- بنية لوحة رئيس القسم (dept-panel):
--   1) departments.parent_code — هرمية الأقسام (المطبخ وله 7 أقسام فرعية)
--   2) أقسام المطبخ الفرعية السبعة: salads/sweets/bakery/hot_kitchen/butcher/fnb/kstore
--   3) ربط مخازن الأقسام (inventory_locations.dept_code) بأقسامها
--   4) حساب رئيس قسم المأكولات السريعة (fnb)
-- Idempotent: safe to run multiple times.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── 1) هرمية الأقسام: parent_code يشير إلى القسم الأب ────────────────────
ALTER TABLE departments ADD COLUMN IF NOT EXISTS parent_code VARCHAR(50);

-- القيد مرجعي ذاتيًا — أنشئه فقط إن لم يوجد (اسم ثابت للفحص الآمن)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'departments_parent_code_fkey') THEN
        ALTER TABLE departments ADD CONSTRAINT departments_parent_code_fkey
            FOREIGN KEY (parent_code) REFERENCES departments(code) ON DELETE SET NULL;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_departments_parent_code ON departments (parent_code);

-- ─── 2) الأقسام الفرعية الناقصة الثلاثة تحت المطبخ ─────────────────────────
-- departments.id بلا تسلسل → معرفات صريحة ثابتة تُكمل نطاق 034 (7101..7105)
INSERT INTO departments (id, code, name, icon, color, parent_code)
SELECT s.id, s.code, s.name, s.icon, s.color, 'kitchen'
FROM (VALUES
  (7106, 'butcher', 'قسم الجزار',  '🥩', '#C62828'),
  (7107, 'fnb',     'قسم المأكولات السريعة', '🍔', '#FF9800'),
  (7108, 'kstore',  'متجر المطبخ', '🧊', '#00838F')
) AS s(id, code, name, icon, color)
WHERE NOT EXISTS (SELECT 1 FROM departments d WHERE d.code = s.code);

-- الأقسام الفرعية الخمسة الموجودة مسبقًا (من 034) تُربط بالمطبخ
UPDATE departments
SET parent_code = 'kitchen'
WHERE code IN ('salads', 'sweets', 'bakery', 'hot_kitchen')
  AND (parent_code IS NULL OR parent_code <> 'kitchen');

-- المطبخ نفسه بلا أب (قسم رئيسي) — وحماية من دورة مرجعية
UPDATE departments SET parent_code = NULL WHERE code = 'kitchen';

-- ─── 3) نفس الأقسام الجديدة في نقطة البيع (POS) مع legacy_dept_code ────────
INSERT INTO pos_departments (code, name_ar, name_en, legacy_dept_code, is_active, sort_order)
SELECT s.code, s.name_ar, s.name_en, s.legacy, TRUE, s.sort
FROM (VALUES
  ('erp_butcher', 'قسم الجزار',           'Butcher',   'butcher', 76),
  ('erp_fnb',     'قسم المأكولات السريعة','Fast Food', 'fnb',     77),
  ('erp_kstore',  'متجر المطبخ',          'K-Store',   'kstore',  78)
) AS s(code, name_ar, name_en, legacy, sort)
WHERE NOT EXISTS (SELECT 1 FROM pos_departments p WHERE p.code = s.code);

-- ─── 4) ربط مخازن الأقسام بأقسامها (عمود dept_code موجود منذ البناء السابق،
--        يُضاف هنا بشرط IF NOT EXISTS لتثبيتات جديدة كاملة من الصفر) ─────────
ALTER TABLE inventory_locations ADD COLUMN IF NOT EXISTS dept_code VARCHAR(50);

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inventory_locations_dept_code_fkey') THEN
        ALTER TABLE inventory_locations ADD CONSTRAINT inventory_locations_dept_code_fkey
            FOREIGN KEY (dept_code) REFERENCES departments(code) ON DELETE SET NULL;
    END IF;
END $$;

-- ترقية المخازن القسمية الموجودة: كل STORE-* يُربط بقسمه إن كان بلا ربط
UPDATE inventory_locations l
SET dept_code = m.dept_code
FROM (VALUES
  ('STORE-SALADS',      'salads'),
  ('STORE-SWEETS',      'sweets'),
  ('STORE-BAKERY',      'bakery'),
  ('STORE-HOT-KITCHEN', 'hot_kitchen'),
  ('STORE-EXTERNAL',    'external_sales')
) AS m(store_code, dept_code)
WHERE l.code = m.store_code
  AND (l.dept_code IS NULL OR l.dept_code <> m.dept_code);

-- ─── 5) حساب رئيس قسم المأكولات السريعة ────────────────────────────────────
-- كلمة المرور كالحسابات التجريبية: Karim2026Demo (bcrypt)
INSERT INTO users (id, username, password, role, name, active, dept_code)
VALUES (9008, 'head_fnb', '$2a$12$jYWL3oqWiunKSHD641Q4Neh72XBs0WbKVLqwweRgbStw/hjF.pJI6', 'dept_head', 'رئيس قسم المأكولات السريعة', TRUE, 'fnb')
ON CONFLICT (id) DO NOTHING;

INSERT INTO users (id, username, password, role, name, active, dept_code)
SELECT s.id, s.username, s.password, s.role, s.name, TRUE, s.dept_code
FROM (VALUES
  (9008, 'head_fnb', '$2a$12$jYWL3oqWiunKSHD641Q4Neh72XBs0WbKVLqwweRgbStw/hjF.pJI6', 'dept_head', 'رئيس قسم المأكولات السريعة', 'fnb'::VARCHAR)
) AS s(id, username, password, role, name, dept_code)
WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.username = s.username);
