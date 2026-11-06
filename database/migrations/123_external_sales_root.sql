-- ═══════════════════════════════════════════════════════════════════
-- 123_external_sales_root.sql
-- قرار المالك 2026-11-02: فصل «قسم البيع الخارجي» عن المطبخ
-- ───────────────────────────────────────────────────────────────────
-- external_sales كان parent_code='kitchen' → كل تجميع شجري (لوحة قسم
-- المطبخ، سجل أذوناته، بطاقة المطبخ التجميعية، P&L، تفاصيل تكلفة القسم،
-- وراثة الكاشيرين 4 و5 لبطاقة المطبخ) كان يبتلع أرقام البيع الخارجي.
--
-- القرار: يجعله قسمًا رئيسيًا مستقلًا (parent_code = NULL). لا حذف ولا
-- تعديل لأي بيانات مالية — سطر واحد في جدول departments.
--
-- ملاحظة: استثناءات CARD_STANDALONE / COST_CARD_STANDALONE في الكود تبقى
-- حارسًا إضافيًا (لا نفع إزالتها هنا)؛ الفصل نفسه يحدث من الشجرة.
--
-- idempotent: الشرط parent_code IS NOT NULL يجعل التشغيل الثاني يaffected
-- 0 صفوف (تعادل آمنة بلا أثر).
-- ═══════════════════════════════════════════════════════════════════

BEGIN;

-- معاينة قبل التعديل (يُطبع فقط — لا يغيّر شيئًا)
SELECT code, name, parent_code
  FROM departments
 WHERE code = 'external_sales';

UPDATE departments
   SET parent_code = NULL
 WHERE code = 'external_sales'
   AND parent_code IS NOT NULL;

COMMIT;

-- تحقق بعد التعديل
SELECT code, name, parent_code
  FROM departments
 WHERE code = 'external_sales';
