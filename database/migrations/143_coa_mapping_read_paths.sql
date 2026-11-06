-- 143_coa_mapping_read_paths.sql — أدوار مسارات القراءة (Phase 3)
-- ──────────────────────────────────────────────────────────────────────────────
-- ثلاثة مسارات كانت تقرأ الحسابات كثوابت inline:
--   GET /cash-flow      (accounting-periods.js)  → 1000/1010
--   GET /cfo-summary    (accounting-routes.js)   → 1000/1010 ونقدية/بنك + 4000
--   GET/POST /bank-*    (accounting-growth.js)   → 1010
-- المسارات صارت تقرأ role من account_mapping والثوابت هي الافتراضي الممرَّر،
-- فهذه الهجرة لا تغيّر أي رقم — فقط تجعل التغيير الإداري ممكنًا ومُدقَّقًا.
--
-- Additive فقط: ON CONFLICT DO NOTHING. الإنتاج لا يُلمس إلا بأمر المالك.
-- (بعد 142: الأدوار asset/asset/revenue كلها مسموحة في account_mapping_type_rule)

BEGIN;

INSERT INTO account_mapping (module, operation, role, account_code, note) VALUES
('reports','cash_flow','cash_account','1000','legacy constant — accounting-periods.js GET /cash-flow'),
('reports','cash_flow','bank_account','1010','legacy constant — accounting-periods.js GET /cash-flow'),
('reports','cfo_summary','cash_account','1000','legacy constant — accounting-routes.js GET /cfo-summary'),
('reports','cfo_summary','bank_account','1010','legacy constant — accounting-routes.js GET /cfo-summary'),
('reports','cfo_summary','revenue_account','4000','legacy constant — CFO booked-revenue reconciliation'),
('reports','bank_reconciliation','bank_account','1010','legacy constant — accounting-growth.js bank statements/rec')
ON CONFLICT (module, operation, role) DO NOTHING;

COMMIT;
