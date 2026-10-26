-- ═══════════════════════════════════════════════════════════════════════════
-- 034_dept_heads_requisitions.sql — Task 19
-- حسابات رؤساء الأقسام + سلسلة اعتماد طلبات الصرف:
--   رئيس القسم ينشئ الطلب → الشيف العمومي يعتمده → المخازن تصرف → القسم يستلم
-- Idempotent: safe to run multiple times.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── 1) ربط المستخدم بقسمه (رؤساء الأقسام) ────────────────────────────────
ALTER TABLE users ADD COLUMN IF NOT EXISTS dept_code VARCHAR(50);

-- ─── 2) أعمدة اعتماد الشيف العمومي على إذن الصرف ──────────────────────────
ALTER TABLE dispatches ADD COLUMN IF NOT EXISTS "creatorRole" VARCHAR(50);
ALTER TABLE dispatches ADD COLUMN IF NOT EXISTS "needsChefApproval" BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE dispatches ADD COLUMN IF NOT EXISTS "chefApprovedAt" TIMESTAMPTZ;
ALTER TABLE dispatches ADD COLUMN IF NOT EXISTS "chefApprovedBy" VARCHAR(100);
ALTER TABLE dispatches ADD COLUMN IF NOT EXISTS "chefApprovalSignatureData" TEXT;
ALTER TABLE dispatches ADD COLUMN IF NOT EXISTS "chefApprovalSignatureHash" VARCHAR(64);
ALTER TABLE dispatches ADD COLUMN IF NOT EXISTS "chefRejectedAt" TIMESTAMPTZ;
ALTER TABLE dispatches ADD COLUMN IF NOT EXISTS "chefRejectedBy" VARCHAR(100);
ALTER TABLE dispatches ADD COLUMN IF NOT EXISTS "chefRejectionSignatureData" TEXT;
ALTER TABLE dispatches ADD COLUMN IF NOT EXISTS "chefRejectionSignatureHash" VARCHAR(64);

-- فهرسة الاستعلامات الشائعة (طلبات بانتظار الشيف / طلبات قسم معين)
CREATE INDEX IF NOT EXISTS idx_dispatches_chef_queue
  ON dispatches ("needsChefApproval", status) WHERE "needsChefApproval" = TRUE;
CREATE INDEX IF NOT EXISTS idx_dispatches_dept_code ON dispatches ("deptCode");

-- ─── 3) الأقسام الجديدة الخمسة (جدول أقسام ERP) ───────────────────────────
INSERT INTO departments (id, code, name, icon, color)
SELECT s.id, s.code, s.name, s.icon, s.color
FROM (VALUES
  (4001, 'salads',         'قسم السلطات',            '🥗', '#4CAF50'),
  (4002, 'sweets',         'قسم الحلواني',           '🍰', '#E91E63'),
  (4003, 'bakery',         'قسم الخباز',             '🥖', '#D4A843'),
  (4004, 'hot_kitchen',    'قسم المطبخ العام الساخن','🔥', '#F44336'),
  (4005, 'external_sales', 'قسم البيع الخارجي',      '🚚', '#2196F3')
) AS s(id, code, name, icon, color)
WHERE NOT EXISTS (SELECT 1 FROM departments d WHERE d.code = s.code);

-- ─── 4) نفس الأقسام في نقطة البيع (POS) مع legacy_dept_code ───────────────
INSERT INTO pos_departments (code, name_ar, name_en, legacy_dept_code, is_active, sort_order)
SELECT s.code, s.name_ar, s.name_en, s.legacy, TRUE, s.sort
FROM (VALUES
  ('erp_salads',         'قسم السلطات',             'Salads',         'salads',         71),
  ('erp_sweets',         'قسم الحلواني',            'Confectionery',  'sweets',         72),
  ('erp_bakery',         'قسم الخباز',              'Bakery',         'bakery',         73),
  ('erp_hot_kitchen',    'قسم المطبخ العام الساخن', 'Hot Kitchen',    'hot_kitchen',    74),
  ('erp_external_sales', 'قسم البيع الخارجي',       'External Sales', 'external_sales', 75)
) AS s(code, name_ar, name_en, legacy, sort)
WHERE NOT EXISTS (SELECT 1 FROM pos_departments p WHERE p.code = s.code);

-- ─── 5) حساب الشيف العمومي + حسابات رؤساء الأقسام ─────────────────────────
-- كلمة المرور لكل الحسابات التجريبية: Karim2026Demo (bcrypt)
-- users.id عمود bigint بلا تسلسل → معرّفات صريحة ثابتة (idempotent عبر ON CONFLICT)
INSERT INTO users (id, username, password, role, name, active, dept_code) VALUES
  (9001, 'chef',             '$2a$12$ohT7mclJKByMAuAlAMb/eua9ZriQjpuyPhV7/wElohikZIQyDzbBG', 'kitchen',    'الشيف العمومي',              TRUE, NULL),
  (9007, 'keeper',           '$2a$12$E5VR7z0B3xc1xr29UFIHrezqaNExS0JRgKfqen8ZO4LSvC68DHQry', 'warehouse',  'أمين المخازن',               TRUE, NULL),
  (9002, 'head_salads',      '$2a$12$jYWL3oqWiunKSHD641Q4Neh72XBs0WbKVLqwweRgbStw/hjF.pJI6', 'dept_head',  'رئيس قسم السلطات',           TRUE, 'salads'),
  (9003, 'head_sweets',      '$2a$12$BgB2u.5vTrIre1CFl3X0aO2SkwmFI.k.rvF5yjEk61pRUNKjHLEme', 'dept_head',  'رئيس قسم الحلواني',          TRUE, 'sweets'),
  (9004, 'head_bakery',      '$2a$12$8EMzPYbjr6DpAbw4giku1O6g/tVJ2Knvou.wWFFsOEAdI7IQI219m', 'dept_head',  'رئيس قسم الخباز',            TRUE, 'bakery'),
  (9005, 'head_hot_kitchen', '$2a$12$oa4573AlFlXfK7fM/RWTy.GBblfqLFwUwk3CRkucisMvNaX040r0W', 'dept_head',  'رئيس قسم المطبخ الساخن',     TRUE, 'hot_kitchen'),
  (9006, 'head_external',    '$2a$12$3qyB7uT6axw7j4WYGPzqMex5zCMPgmMD4FFoMAZ0ReS2WtihyMKsO', 'dept_head',  'رئيس قسم البيع الخارجي',     TRUE, 'external_sales')
ON CONFLICT (id) DO NOTHING;

INSERT INTO users (id, username, password, role, name, active, dept_code)
SELECT s.id, s.username, s.password, s.role, s.name, TRUE, s.dept_code
FROM (VALUES
  (9001, 'chef',             '$2a$12$ohT7mclJKByMAuAlAMb/eua9ZriQjpuyPhV7/wElohikZIQyDzbBG', 'kitchen',    'الشيف العمومي',              NULL::VARCHAR),
  (9007, 'keeper',           '$2a$12$E5VR7z0B3xc1xr29UFIHrezqaNExS0JRgKfqen8ZO4LSvC68DHQry', 'warehouse',  'أمين المخازن',               NULL::VARCHAR),
  (9002, 'head_salads',      '$2a$12$jYWL3oqWiunKSHD641Q4Neh72XBs0WbKVLqwweRgbStw/hjF.pJI6', 'dept_head',  'رئيس قسم السلطات',           'salads'::VARCHAR),
  (9003, 'head_sweets',      '$2a$12$BgB2u.5vTrIre1CFl3X0aO2SkwmFI.k.rvF5yjEk61pRUNKjHLEme', 'dept_head',  'رئيس قسم الحلواني',          'sweets'::VARCHAR),
  (9004, 'head_bakery',      '$2a$12$8EMzPYbjr6DpAbw4giku1O6g/tVJ2Knvou.wWFFsOEAdI7IQI219m', 'dept_head',  'رئيس قسم الخباز',            'bakery'::VARCHAR),
  (9005, 'head_hot_kitchen', '$2a$12$oa4573AlFlXfK7fM/RWTy.GBblfqLFwUwk3CRkucisMvNaX040r0W', 'dept_head',  'رئيس قسم المطبخ الساخن',     'hot_kitchen'::VARCHAR),
  (9006, 'head_external',    '$2a$12$3qyB7uT6axw7j4WYGPzqMex5zCMPgmMD4FFoMAZ0ReS2WtihyMKsO', 'dept_head',  'رئيس قسم البيع الخارجي',     'external_sales'::VARCHAR)
) AS s(id, username, password, role, name, dept_code)
WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.username = s.username);
