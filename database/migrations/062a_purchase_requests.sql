-- =====================================================
-- Migration 062a: جداول طلبات الشراء (سلسلة الموافقات)
-- كانت تُنشأ وقت تشغيل فقط (ensurePurchaseRequestSchema) — الترحيل 063
-- يعتمد عليها قبله، فالتثبيت النظيف كان يفشل. نفس الـ DDL هنا (متكرر بأمان).
-- =====================================================

CREATE TABLE IF NOT EXISTS purchase_requests (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    request_number TEXT UNIQUE NOT NULL,
    items JSONB NOT NULL DEFAULT '[]',
    notes TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    created_by BIGINT, creator_name TEXT, creator_role TEXT,
    chef_approved_by BIGINT, chef_approved_name TEXT, chef_approved_at TIMESTAMPTZ,
    chef_signature_data TEXT, chef_signature_hash TEXT, chef_notes TEXT,
    gm_approved_by BIGINT, gm_approved_name TEXT, gm_approved_at TIMESTAMPTZ,
    gm_signature_data TEXT, gm_signature_hash TEXT, gm_notes TEXT,
    rejected_by BIGINT, rejected_name TEXT, rejected_at TIMESTAMPTZ, rejection_reason TEXT,
    rejection_signature_data TEXT, rejection_signature_hash TEXT,
    last_event_hash TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS purchase_request_events (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    request_id BIGINT NOT NULL REFERENCES purchase_requests(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL,
    from_status TEXT, to_status TEXT NOT NULL,
    actor_user_id BIGINT, actor_name TEXT, actor_role TEXT,
    signature_hash TEXT,
    event_payload JSONB NOT NULL DEFAULT '{}',
    previous_event_hash TEXT,
    event_hash TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS purchase_requests_status_idx ON purchase_requests(status);
CREATE INDEX IF NOT EXISTS purchase_request_events_request_idx ON purchase_request_events(request_id);
