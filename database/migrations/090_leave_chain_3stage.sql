-- 090_leave_chain_3stage.sql — سلسلة الإجازات: 3 مراحل بطلب المالك (2026-10-01)
-- ────────────────────────────────────────────────────────────────────────────
-- الموظف ← مديره المباشر (رئيس القسم) ← المدير العام ← شؤون العاملين (تقفل).
-- إلغاء مرحلة مدير التشغيل: الطلبات العالقة لديه تتقدم للمدير العام (اجتازت
-- المدير المباشر فعلًا). السجلات المكتملة/المرفوضة لا تُمس (أحداثها مؤرشفة).
-- Idempotent — آمن على القواعد الجديدة والمرحّلة.
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS leave_approval_workflows (
    id BIGSERIAL PRIMARY KEY,
    leave_request_id BIGINT NOT NULL UNIQUE,
    current_stage VARCHAR(40) NOT NULL DEFAULT 'direct_manager',
    status VARCHAR(30) NOT NULL DEFAULT 'in_progress',
    current_note TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS leave_approval_events (
    id BIGSERIAL PRIMARY KEY,
    workflow_id BIGINT NOT NULL REFERENCES leave_approval_workflows(id) ON DELETE CASCADE,
    stage VARCHAR(40) NOT NULL,
    action VARCHAR(30) NOT NULL,
    note TEXT,
    actor_user_id BIGINT,
    actor_role VARCHAR(40),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_leave_workflows_stage_status
    ON leave_approval_workflows(current_stage, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_leave_events_workflow
    ON leave_approval_events(workflow_id, created_at DESC);

INSERT INTO leave_approval_workflows (
    leave_request_id, current_stage, status, current_note, completed_at
)
SELECT lr.id,
       CASE WHEN lr.status = 'approved' THEN 'hr' ELSE 'direct_manager' END,
       CASE
           WHEN lr.status = 'approved' THEN 'completed'
           WHEN lr.status = 'rejected' THEN 'rejected'
           ELSE 'in_progress'
       END,
       COALESCE(lr."rejectionReason", lr.reason),
       CASE WHEN lr.status = 'approved' THEN CURRENT_TIMESTAMP ELSE NULL END
  FROM "leaveRequests" lr
ON CONFLICT (leave_request_id) DO NOTHING;

UPDATE leave_approval_workflows SET current_stage='general_manager', updated_at=CURRENT_TIMESTAMP
 WHERE current_stage='operations_manager' AND status='in_progress';
