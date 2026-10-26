-- ═══════════════════════════════════════════════════════════════════════════
-- 120_audit_action_completion.sql — إكمال قيم سجل التدقيق
-- ═══════════════════════════════════════════════════════════════════════════
-- المشكلة (2026-10-26): العمود action من نوع ENUM، لكن الكود يكتب 17 قيمة
-- مختلفة والقيم المسموحة في القاعدة 10 فقط. كل كتابة خارج القائمة تفشل بخطأ
-- «invalid input value for enum pos_audit_action»، والخطأ مبلوع بـ .catch
-- في كل موضع — فتسقط أحداث المصادقة والتدقيق بصمت:
--   • تسجيل/تعطيل المصادقة الثنائية واسترداد رموزها
--   • إبطال الجلسات (فرديًا وبقية الأجهزة)
--   • أحداث WebAuthn (تسجيل، دخول، إزالة)
--   • إغلاق اليوم وإعادة تصنيف مبيعات Yara
-- النتيجة: سلسلة hash (118) سليمة لكنها خالية من أهم الأحداث الأمنية —
--_chain محمي و_المحتوى مفقود. هذا الترحيل يضيف القيم الناقصة فقط.
--
-- additive فقط: لا تعديل على أي جدول ولا على أي صف قائم.
-- ADD VALUE لا يمكن استخدامه في نفس معاملة الإضافة على PostgreSQL < 12،
-- والخادم 18.6 فالنوع يُضاف ويُستخدم معًا بلا مشكلة.
--
-- ملاحظة: لا تُحذف أي قيمة قائمة — قد تشير إليها سجلات قديمة.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- المصادقة الثنائية
ALTER TYPE pos_audit_action ADD VALUE IF NOT EXISTS 'MFA_ENROLLED';
ALTER TYPE pos_audit_action ADD VALUE IF NOT EXISTS 'MFA_DISABLED';
ALTER TYPE pos_audit_action ADD VALUE IF NOT EXISTS 'MFA_RECOVERY_CODE_USED';
ALTER TYPE pos_audit_action ADD VALUE IF NOT EXISTS 'MFA_RECOVERY_CODES_REGENERATED';
ALTER TYPE pos_audit_action ADD VALUE IF NOT EXISTS 'MFA_ADMIN_RESET';

-- الجلسات
ALTER TYPE pos_audit_action ADD VALUE IF NOT EXISTS 'SESSION_REVOKED';
ALTER TYPE pos_audit_action ADD VALUE IF NOT EXISTS 'SESSION_REVOKED_OTHERS';

-- مفاتيح المرور (WebAuthn)
ALTER TYPE pos_audit_action ADD VALUE IF NOT EXISTS 'WEBAUTHN_REGISTERED';
ALTER TYPE pos_audit_action ADD VALUE IF NOT EXISTS 'WEBAUTHN_REMOVED';
ALTER TYPE pos_audit_action ADD VALUE IF NOT EXISTS 'WEBAUTHN_LOGIN';

-- عمليات أخرى
ALTER TYPE pos_audit_action ADD VALUE IF NOT EXISTS 'CLOSE_DAY';
ALTER TYPE pos_audit_action ADD VALUE IF NOT EXISTS 'YS_RECLASSIFY';

-- تثبيت كلمة مرور admin من .env عند الإقلاع
ALTER TYPE pos_audit_action ADD VALUE IF NOT EXISTS 'ADMIN_PASSWORD_PINNED';

COMMIT;
