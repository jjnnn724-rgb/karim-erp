-- ════════════════════════════════════════════════════════════════════════════
-- 117_refresh_session_identity.sql — هوية جلسة ثابتة عبر تدوير رمز التحديث
-- ────────────────────────────────────────────────────────────────────────────
-- كان كل تدوير يحذف صفًا ويُدرج آخر، فيضيع «متى بدأت الجلسة» ويستحيل أن
-- تعرض شاشةُ الجلسات جهازًا واحدًا ثابت الهوية. العمودان هنا additive فقط:
--
--   session_id   : هوية تُنشأ عند الدخول وتُحمل في رمز الوصول (sid) وفي كل
--                  تدوير لاحق — بها تُعرف الجلسة ويُبطَل جهاز بعينه.
--   last_seen_at : آخر لحظة استُخدم فيها الرمز (يُحدَّث عند كل تدوير).
--
-- الصفوف القديمة تُستكمل بهويتها الحالية (id) فلا تختفي من الشاشة. لا قيد
-- NOT NULL: سكربتات الاختبار والتنظيف تُدرج صفوفًا بلا هوية، وكسرُها لا يشتري
-- شيئًا — الكود يولّد الهوية دائمًا في مسار الإصدار.
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE pos_refresh_tokens ADD COLUMN IF NOT EXISTS session_id UUID;
ALTER TABLE pos_refresh_tokens ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ;

UPDATE pos_refresh_tokens SET session_id = id WHERE session_id IS NULL;
UPDATE pos_refresh_tokens SET last_seen_at = issued_at WHERE last_seen_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_pos_refresh_tokens_user_session
    ON pos_refresh_tokens (user_id, session_id)
    WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_pos_refresh_tokens_session
    ON pos_refresh_tokens (session_id)
    WHERE revoked_at IS NULL;
