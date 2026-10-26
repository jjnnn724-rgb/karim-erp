-- 083_password_vault.sql — خزنة كلمات المرور القابلة للاسترجاع (إضافية فقط)
-- نسخة AES-256-GCM تُكتب عند كل تعيين كلمة مرور؛ القراءة عبر مسار أدمن حصريًا.
-- bcrypt يبقى هو أداة التحقق من الدخول — هذا العمود للاسترجاع الإداري فقط.
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_vault TEXT;
