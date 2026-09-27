-- 067: البنية التحتية للأحداث اللحظية المؤسسية (توجيه v7.1 §6)
-- event_outbox (صندوق الصادر المعاملاتي) + client_event_ack (اعتراف العملاء)
-- + idempotency_keys (تعميم نمط pos_idempotency_keys على بقية العمليات الحرجة)
-- تشغيلها: node database/scripts/run-migration.js database/migrations/067_event_infrastructure.sql
-- آمنة تمامًا: كل العناصر IF NOT EXISTS — لا تمس أي جدول قائم ولا أي بيانات.
BEGIN;

-- ─── 1) تسلسل عالمي رتيب للأحداث ────────────────────────────────────────────
CREATE SEQUENCE IF NOT EXISTS rt_event_seq;

-- ─── 2) صندوق الصادر: حدث العمل + إدراجه = نفس معاملة قاعدة البيانات ────────
CREATE TABLE IF NOT EXISTS event_outbox (
    id                BIGSERIAL PRIMARY KEY,
    event_id          UUID UNIQUE NOT NULL DEFAULT gen_random_uuid(),
    sequence          BIGINT UNIQUE NOT NULL DEFAULT nextval('rt_event_seq'),
    event_type        TEXT NOT NULL,
    event_version     INTEGER NOT NULL DEFAULT 1,
    aggregate_type    TEXT,
    aggregate_id      TEXT,
    branch_id         BIGINT NULL,
    payload           JSONB NOT NULL DEFAULT '{}'::jsonb,
    routing_metadata  JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    published_at      TIMESTAMPTZ NULL,
    claim_id          UUID NULL,
    claimed_at        TIMESTAMPTZ NULL,
    attempts          INTEGER NOT NULL DEFAULT 0,
    last_error        TEXT NULL
);

-- الفهارس مشتقة من أنماط الاستعلام الفعلية (التوجيه §6-A) — لا فهارس عمياء
CREATE INDEX IF NOT EXISTS idx_outbox_pending
    ON event_outbox (published_at, sequence) WHERE published_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_outbox_claims
    ON event_outbox (claim_id, claimed_at) WHERE claim_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_outbox_type_time
    ON event_outbox (event_type, created_at);

-- ─── 3) اعتراف العملاء: checkpoint لكل تثبيت عميل موثق ──────────────────────
CREATE TABLE IF NOT EXISTS client_event_ack (
    installation_id TEXT PRIMARY KEY,
    user_id         BIGINT,
    last_sequence   BIGINT NOT NULL DEFAULT 0,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── 4) مفاتيح التعيين الفريد للعمليات الحرجة (نمط §14) ─────────────────────
CREATE TABLE IF NOT EXISTS idempotency_keys (
    key          TEXT PRIMARY KEY,
    user_id      BIGINT,
    endpoint     TEXT,
    request_hash TEXT,
    response     JSONB,
    status       TEXT NOT NULL DEFAULT 'NEW'
                 CHECK (status IN ('NEW','IN_PROGRESS','COMPLETED','FAILED')),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at   TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_idem_expiry ON idempotency_keys (expires_at);

COMMENT ON TABLE event_outbox IS
    'Transactional outbox: إدراج حدث العمل داخل نفس معاملة العمل ثم نشره لاحقًا عبر الناشر — لا فقد أحداث';
COMMENT ON TABLE client_event_ack IS
    'آخر تسلسل اعترف به كل تثبيت عميل — أساس الاستعادة والفرق بين الحي والمعترف';
COMMENT ON TABLE idempotency_keys IS
    'تعيين فريد عام للعمليات الحرجة: نفس المفتاح+نفس الجسم=نفس الرد، مفتاح واحد تنفيذ واحد';

COMMIT;
