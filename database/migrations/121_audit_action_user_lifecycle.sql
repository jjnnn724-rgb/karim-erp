-- ═══════════════════════════════════════════════════════════════════════════
-- 121_audit_action_user_lifecycle.sql — قيم دورة حياة المستخدم في سجل التدقيق
-- ═══════════════════════════════════════════════════════════════════════════
-- المشكلة (2026-10-27): مسارات إدارة المستخدمين واستعادة كلمة المرور تكتب
-- أربع قيم خارج نوع pos_audit_action، فيرفضها PostgreSQL ويُبتلع الخطأ في
-- .catch — أي أن إنشاء المستخدم وتعديله وتعطيله ورفض رمز الاستعادة لا تصل
-- إلى سلسلة hash إطلاقًا.
--
-- additive فقط: إضافة قيم النوع، بلا تعديل جداول أو صفوف.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

ALTER TYPE pos_audit_action ADD VALUE IF NOT EXISTS 'USER_CREATED';
ALTER TYPE pos_audit_action ADD VALUE IF NOT EXISTS 'USER_UPDATED';
ALTER TYPE pos_audit_action ADD VALUE IF NOT EXISTS 'USER_DEACTIVATED';
ALTER TYPE pos_audit_action ADD VALUE IF NOT EXISTS 'PASSWORD_RESET_CODE_DENIED';

COMMIT;
