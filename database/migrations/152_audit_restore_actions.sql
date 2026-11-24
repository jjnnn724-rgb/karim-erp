-- 152_audit_restore_actions.sql — قيم تدقيق لتأمين الاستعادة (تأمين 2026-11, M1)
-- خطوة التحقق الإضافي قبل الاستعادة + الاستعادة نفسها تُسجَّلان في pos_audit_logs،
-- والعمود action من نوع ENUM — بلا هاتين القيمتين يُبتلع السجل بخطأ
-- «invalid input value for enum pos_audit_action» (نفس دافع 120/121).
ALTER TYPE pos_audit_action ADD VALUE IF NOT EXISTS 'RESTORE_STEPUP_ISSUED';
ALTER TYPE pos_audit_action ADD VALUE IF NOT EXISTS 'SYSTEM_RESTORE';
