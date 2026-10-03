-- 094_opening_balances_ledger.sql — FIX R16 (Enterprise Stage 7, 2026-10-03)
-- الدليل (Stage 3 / I3): أصناف بأرصدة on_hand بلا أي صف دفتر (بذر تاريخي قبل
-- عصر الدفتر) — إعادة تشغيل الدفتر لا تستنتجها. يُنشأ صف opening_balance
-- لكل (صنف، موقع) له رصيد ≠ 0 دون أي سجل دفتر سابق، بمفتاح idempotency
-- يمنع التكرار عند إعادة التشغيل. لا يعدّل أي سجل تاريخي — يضيف خط أساس فقط.
INSERT INTO public.inventory_ledger
    (transaction_type, inventory_id, location_id, quantity_delta, unit,
     unit_cost, total_cost, reference_type, business_date, idempotency_key, reason)
SELECT 'opening_balance', b.inventory_id, b.location_id, b.on_hand,
       COALESCE(NULLIF(i.unit, ''), 'وحدة'),
       COALESCE(i."avgCost", 0), ROUND(b.on_hand * COALESCE(i."avgCost", 0), 4),
       'migration_094', CURRENT_DATE,
       'm094-opening:' || b.inventory_id || ':' || b.location_id,
       'رصيد افتتاحي موثق — توفيق دفتر المخزون مع الأرصدة الموروثة سابقًا (migration 094)'
FROM public.inventory_location_balances b
JOIN public.inventory i ON i.id = b.inventory_id
WHERE b.on_hand <> 0
  AND NOT EXISTS (
      SELECT 1 FROM public.inventory_ledger l
      WHERE l.inventory_id = b.inventory_id AND l.location_id = b.location_id
  );
