-- ═══════════════════════════════════════════════════════════════════
-- 103_dept_cashier_links.sql — ربط الأقسام بكاشيراتها المعيَّنين (إضافي 100%)
-- ───────────────────────────────────────────────────────────────────
-- الطلب (2026-10-19): «عايز أقدر أربط القسم بالكاشير المعين» — الربط اليوم
-- خريطة ثابتة مكتوبة في الكود (features/departments.js:17 وv2/data/dept-detail.js:18)
-- لا تُعدَّل إلا بترقية كود. هذا الجدول ينقل القرار إلى البيانات.
--
-- 1) جدول dept_cashier_links: صنف واحد لكل (قسم، كاشير) — كاشير واحد أساسي
--    لكل قسم (قيد جزئي)، والباقِ ثانوي. الحذف من الأقسام يُمسح الروابط تتابعيًا.
-- 2) بذرة من الخريطة المكتوبة حرفيًا: كاشير 1→CAF · 4و5→external_sales ·
--    6→G · 9→open_buffet — حتى يبقى إيراد البطاقات مطابقًا تمامًا لليوم عند
--    قراءة الروابط من القاعدة بدل الكود (صفر انحراف في الأرقام).
-- 3) cashier_no هو رقم الكاشير الخام (المطابق لـ ys_cc_<no> في deptId داخل
--    revenues، والعمود cashier_no في ys_mirror_orders) — لا تُحرَّك أي بيانات.
--
-- رجوع آمن: جدول جديد وحده؛ حذفه لا يمس أي جدول آخر:
--   DROP TABLE IF EXISTS dept_cashier_links;
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS dept_cashier_links (
    id          BIGINT PRIMARY KEY,
    dept_code   VARCHAR(50)  NOT NULL REFERENCES departments(code) ON DELETE CASCADE,
    cashier_no  VARCHAR(20)  NOT NULL,
    is_primary  BOOLEAN      NOT NULL DEFAULT TRUE,
    notes       VARCHAR(255),
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT dept_cashier_links_unique UNIQUE (dept_code, cashier_no),
    CONSTRAINT dept_cashier_links_cashier_no_check CHECK (cashier_no ~ '^[0-9]{1,6}$')
);

CREATE INDEX IF NOT EXISTS idx_dept_cashier_links_dept ON dept_cashier_links (dept_code);
CREATE INDEX IF NOT EXISTS idx_dept_cashier_links_cashier ON dept_cashier_links (cashier_no);

-- كاشير أساسي واحد لكل قسم (قيد جزئي) — الخادم يُخفّض الباقِ قبل الكتابة،
-- وهذا القيد يحمي السلامة حتى مع التزامن.
CREATE UNIQUE INDEX IF NOT EXISTS dept_cashier_links_one_primary
    ON dept_cashier_links (dept_code) WHERE is_primary;

-- ─── بذرة مطابقة لخريطة الكود الحالية (لا تُكتب فوق تعديل المالك) ───────
INSERT INTO dept_cashier_links (id, dept_code, cashier_no, is_primary, notes)
SELECT s.id, s.dept_code, s.cashier_no, s.is_primary, 'بذرة 103 من خريطة الكود (طلب 2026-10-05)'
FROM (VALUES
    (9101, 'CAF',            '1', TRUE),
    (9102, 'external_sales', '4', TRUE),
    (9103, 'external_sales', '5', FALSE),
    (9104, 'G',              '6', TRUE),
    (9105, 'open_buffet',    '9', TRUE)
) AS s(id, dept_code, cashier_no, is_primary)
WHERE EXISTS (SELECT 1 FROM departments d WHERE d.code = s.dept_code)
  AND NOT EXISTS (
      SELECT 1 FROM dept_cashier_links l
       WHERE l.dept_code = s.dept_code AND l.cashier_no = s.cashier_no
  );
