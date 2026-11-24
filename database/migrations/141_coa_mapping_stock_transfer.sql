-- 141_coa_mapping_stock_transfer.sql — أدوار صرف/إرجاع المخزون والتحويلات (Phase 3)
-- ──────────────────────────────────────────────────────────────────────────────
-- postDispatchToLedger / postReturnToLedger (5000/1200)، وتسويات المصنع
-- ونقل التكلفة وفرق المصنع في dept-transfer-routes.js (4000/5000).
-- أسماء العمليات = source_type الفعلي في journal_entries، فتُقرأ من الجدول
-- مباشرة عند التشخيص. القيم هي الثوابت الحالية حرفيًا: صفر تغيير سلوكي.
--
-- Additive فقط: ON CONFLICT DO NOTHING. الإنتاج لا يُلمس إلا بأمر المالك.

BEGIN;

INSERT INTO account_mapping (module, operation, role, account_code, note) VALUES
('inventory','stock_dispatch','cogs_account','5000','legacy constant — accounting-routes.js postDispatchToLedger'),
('inventory','stock_dispatch','inventory_account','1200','legacy constant — الطرف الدائن للصرف'),
('inventory','stock_return','cogs_account','5000','legacy constant — postReturnToLedger'),
('inventory','stock_return','inventory_account','1200','legacy constant — الطرف المدين للإرجاع'),
('dept_transfer','factory_settlement','revenue_account','4000','legacy constant — postFactoryJournal'),
('dept_transfer','factory_settlement','expense_account','5000','legacy constant — تحميل المنفذ'),
('dept_transfer','inventory_transfer','cost_account','5000','legacy constant — postTransferJournal (5000/5000 بمركزين)'),
('dept_transfer','factory_variance_close','revenue_account','4000','legacy constant — إقفال فرق المصنع'),
('dept_transfer','factory_variance_close','expense_account','5000','legacy constant')
ON CONFLICT (module, operation, role) DO NOTHING;

COMMIT;
