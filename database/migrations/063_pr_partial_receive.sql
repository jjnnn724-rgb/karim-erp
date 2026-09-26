-- =====================================================
-- Migration 063: حالة الاستلام الجزئي لطلبات الشراء
-- partially_fulfilled = استُلم جزء والباقي قابل للاستلام لاحقًا
-- =====================================================

ALTER TABLE purchase_requests DROP CONSTRAINT IF EXISTS purchase_requests_status_check;
ALTER TABLE purchase_requests
    ADD CONSTRAINT purchase_requests_status_check
    CHECK (status IN ('pending','chef_approved','approved','partially_fulfilled','fulfilled','rejected','cancelled'));
