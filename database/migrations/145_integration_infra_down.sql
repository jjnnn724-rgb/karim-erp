-- 145_integration_infra_down.sql — رجوع هجرة 145
-- ──────────────────────────────────────────────────────────────────────────────
-- لا تُشغَّل قبل تطبيق 145 وبموافقة مالك صريحة.
--
-- تحذير: هذه الهجرة تحذف سجل التسليم والتدقيق (integration_events). الرجوع
-- مقبول فقط في بيئة اختبار، أو في إنتاج فارغ بلا أي صف مُرسل. أي رجوع إنتاجي
-- مع بيانات يحتاج نسخة احتياطية موثقة ونسخة من الجداول أولًا.
--
-- ترتيب الرجوع: triggers ← tables ← functions ← types. لا CASCADE.

BEGIN;

DROP TRIGGER IF EXISTS integration_events_no_truncate ON integration_events;
DROP TRIGGER IF EXISTS integration_events_no_modify ON integration_events;
DROP TRIGGER IF EXISTS integration_outbox_immutable ON integration_outbox;
DROP TRIGGER IF EXISTS integration_providers_touch ON integration_providers;

DROP TABLE IF EXISTS integration_events;
DROP TABLE IF EXISTS integration_outbox;
DROP TABLE IF EXISTS integration_credentials;
DROP TABLE IF EXISTS integration_providers;

DROP FUNCTION IF EXISTS integration_events_append_only();
DROP FUNCTION IF EXISTS integration_outbox_immutable_core();
DROP FUNCTION IF EXISTS integration_touch_updated_at();

DO $$ BEGIN
    DROP TYPE IF EXISTS integration_event_outcome;
    DROP TYPE IF EXISTS integration_event_direction;
    DROP TYPE IF EXISTS integration_outbox_status;
    DROP TYPE IF EXISTS integration_verification;
END $$;

COMMIT;
