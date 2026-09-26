-- 037_password_self_recovery.sql — استعادة كلمة المرور الذاتية للموظف
-- ────────────────────────────────────────────────────────────────────────────
-- المشكلة: الموظف الذي نسي كلمة مروره لا يستطيع الدخول إطلاقًا — لا يوجد
-- بريد ولا SMS في بيئة المطعم، والبديل الوحيد كان المدير يضع كلمة مرور جديدة
-- هو بنفسه (يعرفها الموظف ويحتاج شاشة الإدارة).
--
-- الحل: رمز استعادة لمرة واحدة (6 أرقام) يُصدره المدير من لوحة المستخدمين،
-- يُشارك شفهيًا مع الموظف، ويستخدمه الموظف بنفسه في شاشة الدخول لضبط كلمة
-- مرور جديدة. الرمز يُخزن مجزأً SHA-256 (لا يُخزن خامًا أبدًا)، صلاحيته
-- 10 دقائق، محاولات فاشلة محدودة (5) قبل قفله، ويسحب كل جلسات التجديد
-- القائمة عند نجاح الاستعادة.
CREATE TABLE IF NOT EXISTS pos_password_reset_codes (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    code_hash VARCHAR(64) NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    used_at TIMESTAMPTZ,
    created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- فهرس مسار التحقق: آخر رمز غير مستخدم لمستخدم معين
CREATE INDEX IF NOT EXISTS idx_pos_pwreset_user_active
    ON pos_password_reset_codes(user_id, created_at DESC)
    WHERE used_at IS NULL;

-- قيم التدقيق الجديدة في الـ ENUM (كانت ستُفشل كتابة سجل التدقيق صامتة)
ALTER TYPE pos_audit_action ADD VALUE IF NOT EXISTS 'PASSWORD_RESET_CODE_ISSUED';
ALTER TYPE pos_audit_action ADD VALUE IF NOT EXISTS 'PASSWORD_SELF_RESET';
