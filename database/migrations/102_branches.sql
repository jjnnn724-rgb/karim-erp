-- ═══════════════════════════════════════════════════════════════════
-- 102_branches.sql — الأساس متعدد الفروع (إضافي 100% — لا يهدم شيئًا)
-- ───────────────────────────────────────────────────────────────────
-- 1) جدول branches مع بذرة «الفرع الرئيسي» MAIN.
-- 2) عمود branch_id Nullable على جداول العمليات العشرة — الوضع الحالي
--    (كل الفروع NULL = بلا تصفية) يبقى سلوكه حرفيًا كما هو.
-- 3) Backfill: إسناد الصفوف القائمة إلى MAIN حتى لا يتيم شيء.
-- رجوع آمن: العمود nullable ولا قيود فريدة جديدة؛ DROP COLUMN إن لزم.
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS branches (
    id          INTEGER PRIMARY KEY,
    code        TEXT UNIQUE NOT NULL,
    name_ar     TEXT NOT NULL,
    name_en     TEXT,
    currency    CHAR(3) NOT NULL DEFAULT 'SAR',
    timezone    TEXT NOT NULL DEFAULT 'Asia/Riyadh',
    address     TEXT,
    phone       TEXT,
    is_active   BOOLEAN NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- التسلسل: SERIAL اليدوي ليتوافق مع أسلوب الـmigrations القديمة
CREATE SEQUENCE IF NOT EXISTS branches_id_seq;
ALTER TABLE branches ALTER COLUMN id SET DEFAULT nextval('branches_id_seq');

INSERT INTO branches (code, name_ar, name_en, currency)
VALUES ('MAIN', 'الفرع الرئيسي', 'Main Branch', 'SAR')
ON CONFLICT (code) DO NOTHING;

-- ─── جداول العمليات — عمود الفرع على الأبرز فقط ────────────────────
ALTER TABLE users              ADD COLUMN IF NOT EXISTS branch_id INTEGER REFERENCES branches(id);
ALTER TABLE employees          ADD COLUMN IF NOT EXISTS branch_id INTEGER REFERENCES branches(id);
ALTER TABLE attendance         ADD COLUMN IF NOT EXISTS branch_id INTEGER REFERENCES branches(id);
ALTER TABLE pos_orders         ADD COLUMN IF NOT EXISTS branch_id INTEGER REFERENCES branches(id);
ALTER TABLE pos_shift_sessions ADD COLUMN IF NOT EXISTS branch_id INTEGER REFERENCES branches(id);
ALTER TABLE pos_day_closes     ADD COLUMN IF NOT EXISTS branch_id INTEGER REFERENCES branches(id);
ALTER TABLE expenses           ADD COLUMN IF NOT EXISTS branch_id INTEGER REFERENCES branches(id);
ALTER TABLE revenues           ADD COLUMN IF NOT EXISTS branch_id INTEGER REFERENCES branches(id);
ALTER TABLE journal_entries    ADD COLUMN IF NOT EXISTS branch_id INTEGER REFERENCES branches(id);
ALTER TABLE "purchaseInvoices" ADD COLUMN IF NOT EXISTS branch_id INTEGER REFERENCES branches(id);

-- ─── فهارس — مطلوبة فور بدء التصفية by branch ──────────────────────
CREATE INDEX IF NOT EXISTS idx_users_branch              ON users(branch_id);
CREATE INDEX IF NOT EXISTS idx_employees_branch          ON employees(branch_id);
CREATE INDEX IF NOT EXISTS idx_attendance_branch         ON attendance(branch_id);
CREATE INDEX IF NOT EXISTS idx_pos_orders_branch         ON pos_orders(branch_id);
CREATE INDEX IF NOT EXISTS idx_pos_shift_sessions_branch ON pos_shift_sessions(branch_id);
CREATE INDEX IF NOT EXISTS idx_pos_day_closes_branch     ON pos_day_closes(branch_id);
CREATE INDEX IF NOT EXISTS idx_expenses_branch           ON expenses(branch_id);
CREATE INDEX IF NOT EXISTS idx_revenues_branch           ON revenues(branch_id);
CREATE INDEX IF NOT EXISTS idx_journal_entries_branch    ON journal_entries(branch_id);
CREATE INDEX IF NOT EXISTS idx_purchaseinvoices_branch   ON "purchaseInvoices"(branch_id);

-- ─── Backfill: كل الموجود حاليًا يصير فرع MAIN (مرة واحدة) ─────────
WITH main AS (SELECT id FROM branches WHERE code = 'MAIN')
UPDATE users              SET branch_id = main.id FROM main WHERE users.branch_id IS NULL;
WITH main AS (SELECT id FROM branches WHERE code = 'MAIN')
UPDATE employees          SET branch_id = main.id FROM main WHERE employees.branch_id IS NULL;
WITH main AS (SELECT id FROM branches WHERE code = 'MAIN')
UPDATE attendance         SET branch_id = main.id FROM main WHERE attendance.branch_id IS NULL;
WITH main AS (SELECT id FROM branches WHERE code = 'MAIN')
UPDATE pos_orders         SET branch_id = main.id FROM main WHERE pos_orders.branch_id IS NULL;
WITH main AS (SELECT id FROM branches WHERE code = 'MAIN')
UPDATE pos_shift_sessions SET branch_id = main.id FROM main WHERE pos_shift_sessions.branch_id IS NULL;
WITH main AS (SELECT id FROM branches WHERE code = 'MAIN')
UPDATE pos_day_closes     SET branch_id = main.id FROM main WHERE pos_day_closes.branch_id IS NULL;
WITH main AS (SELECT id FROM branches WHERE code = 'MAIN')
UPDATE expenses           SET branch_id = main.id FROM main WHERE expenses.branch_id IS NULL;
WITH main AS (SELECT id FROM branches WHERE code = 'MAIN')
UPDATE revenues           SET branch_id = main.id FROM main WHERE revenues.branch_id IS NULL;
WITH main AS (SELECT id FROM branches WHERE code = 'MAIN')
UPDATE journal_entries    SET branch_id = main.id FROM main WHERE journal_entries.branch_id IS NULL;
WITH main AS (SELECT id FROM branches WHERE code = 'MAIN')
UPDATE "purchaseInvoices" SET branch_id = main.id FROM main WHERE "purchaseInvoices".branch_id IS NULL;
