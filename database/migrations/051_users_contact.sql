-- 051: users.email/phone كانت في schema-registry كحقول قابلة للكتابة
-- لكن الأعمدة غير موجودة في قاعدة البيانات (كانت تسبب 500 عند الإرسال).
ALTER TABLE users ADD COLUMN IF NOT EXISTS email VARCHAR(255);
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone VARCHAR(20);
