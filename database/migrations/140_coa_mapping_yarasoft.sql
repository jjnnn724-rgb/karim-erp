-- 140_coa_mapping_yarasoft.sql — دور النقدية في الافتتاحي (Phase 3 — جسر يارسوفت)
-- ──────────────────────────────────────────────────────────────────────────────
-- 134 بذرت `yarasoft.prebooks.equity_account` (3100) فقط، وبذرت في
-- `yarasoft.gl_bridge` الحسابين (1000/4000). bridgePreBooksToGl يقرأ النقدية
-- أيضًا، فتُبذر هنا بنفس القيمة الحالية — لا تغيير سلوكي.
--
-- Additive فقط: ON CONFLICT DO NOTHING. الإنتاج لا يُلمس إلا بأمر المالك.

BEGIN;

INSERT INTO account_mapping (module, operation, role, account_code, note) VALUES
('yarasoft','prebooks','cash_account','1000','legacy constant — bridgePreBooksToGl')
ON CONFLICT (module, operation, role) DO NOTHING;

COMMIT;
