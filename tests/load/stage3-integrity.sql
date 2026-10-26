-- بطارية نزاهة البيانات — على النسخة karim_erp_stage3 (قراءة فقط)
\echo === I1 unbalanced posted journals ===
SELECT e.id, e.entry_no, SUM(l.debit) AS dr, SUM(l.credit) AS cr
FROM journal_entries e JOIN journal_lines l ON l.entry_id = e.id
WHERE e.status = 'posted' GROUP BY e.id, e.entry_no
HAVING ABS(SUM(l.debit) - SUM(l.credit)) > 0.01;

\echo === I2 inventory.qty vs SUM(on_hand) mismatches ===
SELECT i.id, i.name, i.qty AS qty_projection, COALESCE(SUM(b.on_hand), 0) AS sum_balances
FROM inventory i LEFT JOIN inventory_location_balances b ON b.inventory_id = i.id
GROUP BY i.id, i.name, i.qty
HAVING ABS(i.qty - COALESCE(SUM(b.on_hand), 0)) > 0.001 LIMIT 15;

\echo === I3 ledger replay vs balances (items with ledger history only) ===
SELECT b.inventory_id, b.location_id, b.on_hand, COALESCE(l.sum_delta, 0) AS ledger_sum
FROM inventory_location_balances b
LEFT JOIN (SELECT inventory_id, location_id, SUM(quantity_delta) AS sum_delta
           FROM inventory_ledger GROUP BY 1, 2) l
  ON l.inventory_id = b.inventory_id AND l.location_id = b.location_id
WHERE b.on_hand <> COALESCE(l.sum_delta, 0) AND b.on_hand <> 0 LIMIT 15;

\echo === I4a orphan revenues.pos_order_id ===
SELECT count(*) AS orphan_pos_revenues FROM revenues r
WHERE r.pos_order_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM pos_orders o WHERE o.id = r.pos_order_id);

\echo === I4b orphan pos_stock_movements ===
SELECT count(*) AS orphan_pos_moves FROM pos_stock_movements m
WHERE NOT EXISTS (SELECT 1 FROM pos_orders o WHERE o.id = m.order_id);

\echo === I4c orphan inventory_ledger (inventory_id) ===
SELECT count(*) AS orphan_ledger FROM inventory_ledger l
WHERE NOT EXISTS (SELECT 1 FROM inventory i WHERE i.id = l.inventory_id);

\echo === I5a payroll duplicates (employeeId, month) ===
SELECT "employeeId", month, count(*) AS copies FROM payroll GROUP BY 1, 2 HAVING count(*) > 1 LIMIT 10;

\echo === I5b duplicate purchase invoice numbers ===
SELECT "invoiceNumber", count(*) FROM "purchaseInvoices" GROUP BY 1 HAVING count(*) > 1 LIMIT 10;

\echo === I5c duplicate pos invoice counter per department ===
SELECT department_id, invoice_counter, count(*) FROM pos_orders GROUP BY 1, 2 HAVING count(*) > 1 LIMIT 10;

\echo === I6 negative stock anywhere ===
SELECT 'balance' AS src, inventory_id, location_id, on_hand AS val FROM inventory_location_balances WHERE on_hand < 0
UNION ALL SELECT 'qty', id, NULL, qty FROM inventory WHERE qty < 0 LIMIT 10;

\echo === I7 costless outbound ledger rows ===
SELECT count(*) AS costless_outbound FROM inventory_ledger
WHERE quantity_delta < 0 AND (unit_cost IS NULL OR unit_cost = 0);

\echo === I8 issued pos_orders modified after issue (hash chain guard check) ===
SELECT count(*) AS modified_issued FROM pos_orders
WHERE status IN ('issued', 'reported') AND updated_at > created_at + interval '10 seconds';

\echo === I9 GL balance global ===
SELECT SUM(l.debit) AS total_dr, SUM(l.credit) AS total_cr,
       ABS(SUM(l.debit) - SUM(l.credit)) <= 0.01 AS balanced
FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id WHERE e.status = 'posted';

\echo === DONE ===
