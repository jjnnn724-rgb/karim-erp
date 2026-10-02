-- 089_settings_hidden_nav.sql — إدارة ظهور أقسام القائمة الجانبية إداريًا
-- ────────────────────────────────────────────────────────────────────────────
-- UPGRADE 2026-10-01: الأدمن يقدر يخفي/يظهر أي قسم من القائمة الجانبية من
-- شاشة الإعدادات (بطلب المالك: «أقدر أحذف أو أضيف أو أعدل أي شي أنا الأدمن»).
-- الإخفاء عرض فقط (الصفحات تعمل عبر الروابط الداخلية) وحراسة: الرئيسية والإعدادات
-- لا تُخفَيان (منع حجب النظام عن نفسه).
-- Purely ADDITIVE. Idempotent.

ALTER TABLE settings ADD COLUMN IF NOT EXISTS hidden_nav_pages TEXT DEFAULT NULL;

-- البذرة: سجل الصرف مخفي افتراضيًا (طلب المالك) — قابل للإظهار من الإعدادات
UPDATE settings SET hidden_nav_pages = 'dispatch'
WHERE id = 'main_settings' AND hidden_nav_pages IS NULL;
