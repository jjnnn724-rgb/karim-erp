-- 139_coa_mapping_phase3.sql — أدوار الخريطة الناقصة للوحدات المربوطة في Phase 3
-- ──────────────────────────────────────────────────────────────────────────────
-- 134 بذرت 25 دورًا من الثوابت القائمة. الوحدات التي رُبطت في Phase 3 تحتاج
-- أدوارًا إضافية (المخزون المقابل لـ COGS، ورأس المال في الرصيد الافتتاحي،
-- ودفعات الموردين) — القيم هي الثوابت الحالية حرفيًا: صفر تغيير سلوكي.
--
-- Additive فقط: INSERT ... ON CONFLICT DO NOTHING — إعادة التطبيق آمنة، ولا
-- يمس أي صف قائم (تعديل الخريطة بعد ذلك يتم من الجدول لا من الهجرة).
-- ملاحظة: هذا الملف لا يُطبَّق تلقائيًا؛ الإنتاج يحتاج أمر المالك الحرفي.

BEGIN;

INSERT INTO account_mapping (module, operation, role, account_code, note) VALUES
('sales_pos','pos_sale','inventory_account','1200','legacy constant — الطرف الدائن لـ COGS في قيد البيع'),
('sales_pos','void','inventory_account','1200','legacy constant — pos-void-lines.js'),
('purchases','purchase_invoice','inventory_account','1200','legacy constant — accounting-routes.js'),
('purchases','purchase_opening','inventory_account','1200','legacy constant — postOpeningToLedger'),
('purchases','purchase_opening','equity_account','3000','legacy constant — رأس المال رصيد افتتاحي'),
('procurement','supplier_payment','payable_account','2000','legacy constant — procurement-routes.js'),
('procurement','supplier_payment','cash_account','1000','legacy constant'),
('procurement','supplier_payment','bank_account','1010','legacy constant')
ON CONFLICT (module, operation, role) DO NOTHING;

COMMIT;
