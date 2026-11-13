-- ═══════════════════════════════════════════════════════════════════════════
-- 151_audit_action_price_and_unbalanced.sql — استكمال قيم سجل التدقيق (جولة 2)
-- ═══════════════════════════════════════════════════════════════════════════
-- السبب (2026-11-14، تدقيق شامل): الكود يكتب قيمتين غير موجودتين في نوع
-- pos_audit_action، فكل كتابة تفشل بصمت بـ .catch وتسقط أحداث:
--   • PRODUCT_PRICE_CHANGE        — تعديل سعر البيع من شاشة الكاشير (shift-routes.js)
--   • INVOICE_UNBALANCED_REJECTED — رفض فاتورة غير متوازنة (complete-sale.js)
-- نفس نمط 120: additive فقط، لا تعديل على صفوف قائمة.
-- ملاحظة: لا تُحذف أي قيمة قائمة — قد تشير إليها سجلات قديمة.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

ALTER TYPE pos_audit_action ADD VALUE IF NOT EXISTS 'PRODUCT_PRICE_CHANGE';
ALTER TYPE pos_audit_action ADD VALUE IF NOT EXISTS 'INVOICE_UNBALANCED_REJECTED';

COMMIT;
