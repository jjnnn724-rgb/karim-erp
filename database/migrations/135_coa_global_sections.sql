-- 135_coa_global_sections.sql — إضافات الأقسام العالمية 7000 "أخرى" و8000 "رقابية محكومة"
-- ══════════════════════════════════════════════════════════════════════════════
-- Phase 2 (Additive فقط) — لا تلمس أي حساب قائم ولا تعيد ترقيمه.
-- 7000: جذران مستقلان متسقّا النوع (لا جذر مختلط الإيراد/المصروف):
--        71 «إيرادات أخرى» (revenue) — 7101..7104
--        72 «مصروفات وأعباء أخرى» (expense) — 7201..7205
-- 8000: حسابات رقابية/وسيطة محكومة — جذر 8 (asset) — تُنشأ مغلقة
--        (is_postable=FALSE) حتى يعتمد المالك سياسة تفعيلها بواجهة حوكمة (Phase 5)
--        — لا تُستخدم لإخفاء أخطاء.
-- المعرفات 9002+ لتفادي أي تصادم مع الهويات اليدوية (حتى 8004 اليوم).
-- ON CONFLICT DO NOTHING — آمنة لإعادة التشغيل.
-- ══════════════════════════════════════════════════════════════════════════════
BEGIN;

-- ─── القسم 7000: جذران مستقلان متسقّا النوع ───────────────────────────────────
INSERT INTO chart_of_accounts (id, code, name_ar, name_en, type, parent_code, is_postable) VALUES
(9002, '71', 'إيرادات أخرى', 'Other Income', 'revenue', NULL, false),
(9003, '72', 'مصروفات وأعباء أخرى', 'Other Expenses & Charges', 'expense', NULL, false),
(9011, '7101', 'إيرادات استثمارية وفوائد مقبوضة', 'Investment Income & Interest', 'revenue', '71', true),
(9012, '7102', 'أرباح فروق العملة', 'FX Gains', 'revenue', '71', true),
(9013, '7103', 'أرباح بيع أصول', 'Gain on Disposal of Assets', 'revenue', '71', true),
(9014, '7104', 'أرباح غير تشغيلية أخرى ومتنوعة', 'Miscellaneous Non-Operating Income', 'revenue', '71', true),
(9021, '7201', 'خسائر فروق العملة', 'FX Losses', 'expense', '72', true),
(9022, '7202', 'خسائر بيع أصول', 'Loss on Disposal of Assets', 'expense', '72', true),
(9023, '7203', 'تكاليف التمويل والفوائد المدفوعة', 'Finance Costs & Interest Paid', 'expense', '72', true),
(9024, '7204', 'خسائر ائتمانية متوقعة (ECL)', 'Expected Credit Losses', 'expense', '72', true),
(9025, '7205', 'بنود غير متكررة — تحت بند مراجعة', 'Non-Recurring Items (Review)', 'expense', '72', true)
ON CONFLICT (code) DO NOTHING;

UPDATE chart_of_accounts SET normal_balance = 'credit', fs_classification = 'IS' WHERE code IN ('71','7101','7102','7103','7104');
UPDATE chart_of_accounts SET normal_balance = 'debit',  fs_classification = 'IS' WHERE code IN ('72','7201','7202','7203','7204','7205');

-- ─── القسم 8000: حسابات رقابية/وسيطة محكومة (مغلقة حتى حوكمة Phase 5) ──────────
INSERT INTO chart_of_accounts (id, code, name_ar, name_en, type, parent_code, is_postable) VALUES
(9101, '8',    'حسابات رقابية وسيطة محكومة', 'Controlled Suspense & Clearing', 'asset', NULL, false),
(9102, '81',   'حسابات وسيطة ومطلوب تصفيتها', 'Suspense & Clearing Accounts', 'asset', '8', false),
(9111, '8101', 'وسيط تسوية نقاط البيع والشبكة — معلق', 'POS / Mada Clearing — Pending', 'asset', '81', false),
(9112, '8102', 'وسيط تحويلات وفرق بين الأقسام', 'Inter-Department Suspense', 'asset', '81', false),
(9113, '8103', 'وسيط فروق الجرد والتسويات', 'Inventory Count Variance Suspense', 'asset', '81', false)
ON CONFLICT (code) DO NOTHING;

UPDATE chart_of_accounts
   SET normal_balance = 'debit',
       fs_classification = 'BS',
       is_suspense = TRUE,
       is_reconcilable = TRUE,
       accounting_policy_ref = 'P-CTRL-8000: يتطلب رصيد صفري قبل الإقفال، مالك محدد، تقرير أسبوعي، وتنبيه عند تجاوز الحد'
 WHERE code IN ('8','81','8101','8102','8103');

COMMIT;
